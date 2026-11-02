import math

import numpy as np
import pandas as pd
import pytest

from engine import aggregate, backtest, model
from test_model import seed_tenant, synthetic_panel


def _forecast_rows(panel, factors):
    """Forecast = actual * factor for the first len(factors) complete rows of the first entity."""
    done = panel[panel.n_days >= panel.period_days]
    first = done[done.entity_id == done.entity_id.iloc[0]].iloc[: len(factors)]
    return pd.DataFrame({"entity_id": first.entity_id.values, "period_start": first.period_start.values,
                         "units": first.units.values * np.array(factors)}), first


def test_mape_known(conn, tenant_a):
    style, prods = seed_tenant(conn, tenant_a, 1)
    panel = aggregate.build_panel(conn, tenant_a, "week", "product")
    rows, first = _forecast_rows(panel, [1.2, 0.8, 1.2, 0.8])
    assert (first.units > 0).all()
    backtest.record_forecasts(conn, tenant_a, "runA", "product", "week", rows)
    assert backtest.score_run(conn, tenant_a, "runA") == pytest.approx(0.2)
    acc = conn.execute("SELECT entity_id, period, params FROM forecast_accuracy WHERE tenant_id = %s AND run_id = 'runA'"
                       " ORDER BY period", (tenant_a.tenant_id,)).fetchall()
    assert len(acc) == 4
    assert acc[0]["params"]["actual"] == first.units.iloc[0]
    assert acc[0]["params"]["predicted"] == pytest.approx(first.units.iloc[0] * 1.2)
    assert acc[0]["params"]["ape"] == pytest.approx(0.2)
    # idempotent: rescoring and re-recording leave one row per forecast
    backtest.record_forecasts(conn, tenant_a, "runA", "product", "week", rows)
    assert backtest.score_run(conn, tenant_a, "runA") == pytest.approx(0.2)
    n = lambda tb: conn.execute(f"SELECT count(*) AS n FROM {tb} WHERE tenant_id = %s", (tenant_a.tenant_id,)).fetchone()["n"]
    assert n("forecasts") == 4 and n("forecast_accuracy") == 4
    f = conn.execute("SELECT grain, params FROM forecasts WHERE tenant_id = %s ORDER BY period", (tenant_a.tenant_id,)).fetchone()
    assert f["grain"] == "week" and f["params"]["level"] == "product" and f["params"]["units"] == pytest.approx(rows.units.iloc[0])


def test_zero_actual_skipped(conn, tenant_a):
    style, prods = seed_tenant(conn, tenant_a, 1)
    panel = aggregate.build_panel(conn, tenant_a, "week", "product")
    ent = prods[0]
    done = panel[(panel.entity_id == ent) & (panel.n_days >= panel.period_days)]
    zero_week, ok_week = done.period_start.iloc[3], done.period_start.iloc[4]
    conn.execute("DELETE FROM sales_lines WHERE tenant_id = %s AND date >= %s AND date < %s AND variant_id IN"
                 " (SELECT variant_id FROM products WHERE tenant_id = %s AND product_id = %s)",
                 (tenant_a.tenant_id, zero_week, zero_week + pd.Timedelta(days=7), tenant_a.tenant_id, ent))
    conn.commit()
    actual = aggregate.build_panel(conn, tenant_a, "week", "product").set_index(["entity_id", "period_start"]).units
    assert actual[(ent, zero_week)] == 0 and actual[(ent, ok_week)] > 0
    rows = pd.DataFrame({"entity_id": [ent, ent], "period_start": [zero_week, ok_week],
                         "units": [5.0, actual[(ent, ok_week)] * 1.5]})
    backtest.record_forecasts(conn, tenant_a, "r0", "product", "week", rows)
    assert backtest.score_run(conn, tenant_a, "r0") == pytest.approx(0.5)
    acc = {r["period"]: r["params"] for r in conn.execute(
        "SELECT period, params FROM forecast_accuracy WHERE tenant_id = %s AND run_id = 'r0'", (tenant_a.tenant_id,)).fetchall()}
    assert acc[zero_week]["ape"] is None and acc[zero_week]["actual"] == 0 and acc[zero_week]["predicted"] == 5.0
    assert acc[ok_week]["ape"] == pytest.approx(0.5)
    # nothing scorable -> None
    backtest.record_forecasts(conn, tenant_a, "r1", "product", "week", rows.iloc[:1])
    assert backtest.score_run(conn, tenant_a, "r1") is None


def test_future_and_incomplete_periods_not_scored(conn, tenant_a):
    style, prods = seed_tenant(conn, tenant_a, 1)
    panel = aggregate.build_panel(conn, tenant_a, "week", "product")
    ent = prods[0]
    last = panel[panel.entity_id == ent].period_start.max()
    rows = pd.DataFrame({"entity_id": [ent, ent, "nobody"], "period_start": [last, last + pd.Timedelta(days=700), last],
                         "units": [3.0, 3.0, 3.0]})
    backtest.record_forecasts(conn, tenant_a, "rf", "product", "week", rows)
    full = panel[(panel.entity_id == ent) & (panel.period_start == last)].iloc[0]
    assert full.n_days >= full.period_days or backtest.score_run(conn, tenant_a, "rf") is None
    backtest.score_run(conn, tenant_a, "rf")
    n = conn.execute("SELECT count(*) AS n FROM forecast_accuracy WHERE tenant_id = %s", (tenant_a.tenant_id,)).fetchone()["n"]
    assert n == (1 if full.n_days >= full.period_days else 0)


def test_score_run_tenant_isolated(conn, tenant_a, tenant_b):
    _, pa = seed_tenant(conn, tenant_a, 1)
    seed_tenant(conn, tenant_b, 2)
    panel = aggregate.build_panel(conn, tenant_a, "week", "product")
    rows, _ = _forecast_rows(panel, [1.1, 1.1])
    backtest.record_forecasts(conn, tenant_a, "same", "product", "week", rows)
    backtest.record_forecasts(conn, tenant_b, "same", "product", "week", rows)     # b has no such entity
    assert backtest.score_run(conn, tenant_a, "same") == pytest.approx(0.1)
    assert backtest.score_run(conn, tenant_b, "same") is None
    assert conn.execute("SELECT count(*) AS n FROM forecast_accuracy WHERE tenant_id = %s",
                        (tenant_b.tenant_id,)).fetchone()["n"] == 0


def _panels(n=40):
    return {"store": synthetic_panel(n=n, entity=aggregate.STORE_ENTITY), "product": synthetic_panel(n=n, seed=3, entity="P")}


def _with_period_cols(panels):
    for df in panels.values():
        df["n_days"] = df["period_days"] = df["views_days"] = 7
    return panels


def test_never_sees_future(monkeypatch):
    panels = _with_period_cols(_panels())
    parents = {"product": {"P": ("store", aggregate.STORE_ENTITY)}}
    seen = []
    real = model.fit_entity

    def spy(df, parent=None):
        seen.append(df["period_start"].max())
        return real(df, parent)

    monkeypatch.setattr(model, "fit_entity", spy)
    base = backtest.backtest_panels(panels, parents, "week", "product", folds=3)
    cutoffs = sorted(base.cutoff.unique())
    assert len(cutoffs) == 3
    assert max(seen) < max(cutoffs)
    # absurd future values (units, views, spend at and after the cutoff) change nothing for that fold's fit
    c = cutoffs[0]
    bad = {lv: df.copy() for lv, df in panels.items()}
    for df in bad.values():
        fut = df.period_start > c
        df.loc[fut, ["units", "views", "revenue"]] = 1e9
    other = backtest.backtest_panels(bad, parents, "week", "product", folds=3)
    a = base[base.cutoff == c].set_index("entity_id")
    b = other[other.cutoff == c].set_index("entity_id")
    assert a.predicted.to_numpy() == pytest.approx(b.predicted.to_numpy(), rel=1e-12)
    assert a.actual.to_numpy() == pytest.approx(b.actual.to_numpy())
    # and every fit of that fold saw only earlier periods
    seen.clear()
    backtest.backtest_panels(panels, parents, "week", "product", folds=1)
    assert max(seen) < sorted(base.cutoff.unique())[-1]


def test_rolling_backtest_synthetic_and_db(conn, tenant_a):
    assert backtest.mape(pd.DataFrame({"predicted": [], "actual": []})) is None
    res = backtest.backtest_panels(_with_period_cols(_panels(60)), {"product": {"P": ("store", aggregate.STORE_ENTITY)}},
                                   "week", "product", folds=3)
    assert len(res) == 3 and set(res.columns) >= {"entity_id", "cutoff", "predicted", "actual", "ape"}
    assert np.isfinite(backtest.mape(res)) and backtest.mape(res) < 0.5
    seed_tenant(conn, tenant_a, 1)
    m = backtest.rolling_backtest(conn, tenant_a, "week", "product", folds=3)
    assert m is not None and math.isfinite(m) and 0 <= m < 1.5
    assert backtest.rolling_backtest(conn, tenant_a, "week", "style", folds=2) is not None
