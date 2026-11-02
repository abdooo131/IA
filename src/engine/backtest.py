"""Forecast storage, scoring and rolling backtests (Spec F35: forecasts and decisions are stored and scored later).

Convention: a `forecasts` row's params JSONB holds {"level", "units", "true_demand", "revenue", ...} predicted
values for (entity, period, grain). `score_run` compares them with the actual units of the aggregate panel
once the period is complete. MAPE is a fraction (0.25 = 25 %), over rows with actual > 0.
"""
from __future__ import annotations

import math

import pandas as pd
from psycopg.types.json import Jsonb

from . import model
from .aggregate import FLAGS, LEVELS, TenantData
from .tenants import Tenant


def _json_num(x):
    """Plain JSON value: NaN / inf / missing become None, numpy scalars become Python ones."""
    if x is None:
        return None
    if hasattr(x, "item"):
        x = x.item()
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return x


def _complete(df: pd.DataFrame) -> pd.Series:
    """Rows whose period has fully ended and is fully covered by data (the last, running period is not)."""
    if "n_days" not in df or "period_days" not in df:
        return pd.Series(True, index=df.index)
    return df["n_days"] >= df["period_days"]


def mape(scored: pd.DataFrame) -> float | None:
    """Mean of |predicted - actual| / actual over rows with actual > 0; None when there are none."""
    if scored is None or len(scored) == 0:
        return None
    ok = scored[scored["actual"] > 0]
    if ok.empty:
        return None
    return float(((ok["predicted"] - ok["actual"]).abs() / ok["actual"]).mean())


# ---------------------------------------------------------------- stored forecasts

def record_forecasts(conn, t: Tenant, run_id: str, level: str, grain: str, rows: pd.DataFrame) -> int:
    """Store predictions for a run. rows: entity_id, period_start, units (+ optional true_demand, revenue, ...).

    Idempotent per (tenant, run_id): earlier forecasts of the run are deleted, then inserted again.
    Returns the number of rows stored.
    """
    if level not in LEVELS:
        raise ValueError(f"unknown level {level!r}")
    extra = [c for c in rows.columns if c not in ("entity_id", "period_start", "units")]
    conn.execute("DELETE FROM forecasts WHERE tenant_id = %s AND run_id = %s", (t.tenant_id, run_id))
    for r in rows.to_dict("records"):
        params = {"level": level, "units": _json_num(r["units"]), **{c: _json_num(r[c]) for c in extra}}
        conn.execute("INSERT INTO forecasts (tenant_id, run_id, entity_id, period, grain, params) VALUES (%s,%s,%s,%s,%s,%s)",
                     (t.tenant_id, run_id, str(r["entity_id"]), pd.Timestamp(r["period_start"]).date(), grain, Jsonb(params)))
    conn.commit()
    return len(rows)


def score_run(conn, t: Tenant, run_id: str) -> float | None:
    """Score a run's forecasts against actual units; store forecast_accuracy rows; return the MAPE.

    Periods without a complete actual row are skipped (not stored, not scored). A zero actual is stored with
    ape None and left out of the MAPE. Returns None when no row has actual > 0. Rerunning replaces the rows.
    """
    fc = conn.execute("SELECT entity_id, period, grain, params FROM forecasts WHERE tenant_id = %s AND run_id = %s"
                      " ORDER BY period, entity_id", (t.tenant_id, run_id)).fetchall()
    actuals: dict[tuple[str, str], pd.Series] = {}
    data = TenantData(conn, t) if fc else None
    scored = []
    for f in fc:
        lv, grain = f["params"].get("level"), f["grain"]
        if lv not in LEVELS or f["params"].get("units") is None:
            continue
        if (lv, grain) not in actuals:                     # one panel per level and grain
            panel = data.panel(grain, lv)
            panel = panel[_complete(panel)] if len(panel) else panel
            actuals[(lv, grain)] = (panel.assign(period_start=pd.to_datetime(panel["period_start"]).dt.date)
                                    .set_index(["entity_id", "period_start"])["units"]) if len(panel) else pd.Series(dtype=float)
        key = (f["entity_id"], f["period"])
        if key not in actuals[(lv, grain)].index:
            continue
        actual = float(actuals[(lv, grain)][key])
        pred = float(f["params"]["units"])
        scored.append({"entity_id": f["entity_id"], "period": f["period"], "predicted": pred, "actual": actual,
                       "ape": abs(pred - actual) / actual if actual > 0 else None})
    conn.execute("DELETE FROM forecast_accuracy WHERE tenant_id = %s AND run_id = %s", (t.tenant_id, run_id))
    for s in scored:
        conn.execute("INSERT INTO forecast_accuracy (tenant_id, run_id, entity_id, period, params) VALUES (%s,%s,%s,%s,%s)",
                     (t.tenant_id, run_id, s["entity_id"], s["period"],
                      Jsonb({"predicted": s["predicted"], "actual": s["actual"], "ape": s["ape"]})))
    conn.commit()
    return mape(pd.DataFrame(scored, columns=["predicted", "actual"]))


# ---------------------------------------------------------------- rolling backtest

def backtest_panels(panels: dict[str, pd.DataFrame], parents: dict[str, dict], grain: str, level: str,
                    folds: int = 3) -> pd.DataFrame:
    """Pure core of rolling_backtest. One row per (fold cutoff, entity) with actual > 0.

    Fold k = 1..folds: the cutoff is the start of the k-th last complete period of the `level` panel. Every
    level is cut to period_start < cutoff before fitting (parents first, via model.fit_panel); the cutoff
    period is then predicted from its own spend adstock, price, availability and flags.
    Columns: cutoff, entity_id, predicted, actual, ape.
    """
    cols = ["cutoff", "entity_id", "predicted", "actual", "ape"]
    panel = panels.get(level)
    if panel is None or panel.empty:
        return pd.DataFrame(columns=cols)
    periods = sorted(panel.loc[_complete(panel), "period_start"].unique())
    out = []
    for cutoff in periods[::-1][:max(folds, 0)]:
        history = {lv: df[df["period_start"] < cutoff] for lv, df in panels.items()}
        fitted = model.fit_panel(history, parents, level, grain).get(level, {})
        test = panel[(panel["period_start"] == cutoff) & _complete(panel)]
        for row in test.to_dict("records"):
            p = fitted.get(row["entity_id"])
            actual = float(row["units"])
            if p is None or not actual > 0:
                continue
            pred = model.predict(p, row.get("adstock"), row.get("price"), row.get("size_availability"),
                                 {f: row.get(f) for f in FLAGS})["units"]
            out.append({"cutoff": cutoff, "entity_id": row["entity_id"], "predicted": float(pred), "actual": actual,
                        "ape": abs(pred - actual) / actual})
    return pd.DataFrame(out, columns=cols)


def rolling_backtest(conn, t: Tenant, grain: str, level: str, folds: int = 3) -> float | None:
    """Mean APE (a fraction) of one-period-ahead unit forecasts over the last `folds` complete periods.

    The panel is built once; each fold fits on periods strictly before its cutoff only. Entities with no
    history before the cutoff or zero actual units are not scorable. Returns None only when nothing is
    scorable (never NaN).
    """
    if level not in LEVELS:
        raise ValueError(f"unknown level {level!r}")
    data = TenantData(conn, t)
    chain = list(reversed(LEVELS))
    chain = chain[:chain.index(level) + 1]
    panels = {lv: data.panel(grain, lv) for lv in chain}
    parents = {lv: data.parent_of(lv) for lv in chain}
    return mape(backtest_panels(panels, parents, grain, level, folds))
