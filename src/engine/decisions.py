"""Monthly scorecard, decisions and the forward plan (Spec 32 to 35).

Levels: 'style' and 'product' (current colour product). Months are 'YYYY-MM'. Every query filters tenant_id.
Nothing returned is NaN: a value that cannot be computed is None, and a decision rule that needs a None input
does not fire.
"""
from __future__ import annotations

import logging
import math
from dataclasses import fields
from datetime import date, timedelta

import numpy as np
import pandas as pd
from psycopg.types.json import Jsonb

from . import calibrate, customers, planner
from .aggregate import DECAY, FULL_AVAILABILITY, TenantData
from .backtest import record_forecasts
from .customers import _month_range
from .model import DemandParams, _cr_full, _num, decompose
from .purchasing import GRAIN_DAYS, _available, _model_forecast, _on_order, _supplier_rows, restock_lift
from .tenants import Tenant

log = logging.getLogger(__name__)

LEVELS = ("style", "product")
GRAIN_PREFERENCE = ("month", "week", "day")     # params closest to the monthly scorecard first
DEFAULT_LEAD_TIME = 30
MIN_USABLE_PERIODS = 12
MIN_AGE_DAYS = 60
SCALE_MARGINAL_POAS = 1.5
VALUE_TO_CAC = 1.5
LOST_SHARE = 0.2
MISSING_COST_ROAS = planner.MISSING_COST_TARGET    # 3.0
MISSING_COST_RESTOCK_ROAS = MISSING_COST_ROAS * SCALE_MARGINAL_POAS     # 4.5
COVER_FORECAST_DAYS = 30
BISECT_STEPS = 60

SCORECARD_COLUMNS = [
    "entity_id", "level", "month", "as_of", "views", "cr", "cr_full", "size_availability", "units", "lost_stock",
    "lost_price", "true_demand", "revenue", "gross_profit", "spend", "impressions", "cpm", "meta_cpa",
    "shopify_cpa", "blended_cac", "paid_cac", "customer_value_12m", "poas", "marginal_poas", "roas",
    "marginal_roas", "stock_cover_days", "available", "on_order", "restock_lift", "meta_factor",
    "usable_periods", "first_sale_date", "flags"]
DECISION_COLUMNS = ["level", "entity_id", "month", "decision", "rule", "lead_time_days", "flags", "numbers"]
PLAN_COLUMNS = ["entity_id", "month", "period_start", "decision", "spend", "units", "true_demand", "revenue",
                "profit", "supply", "capped", "po_number"]


# ---------------------------------------------------------------- small helpers

def _clean(x) -> float | None:
    """Finite float or None (None, NaN, inf and non numbers all give None)."""
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _div(num, den) -> float | None:
    n, d = _clean(num), _clean(den)
    return n / d if n is not None and d else None


def _json(x):
    if isinstance(x, date):
        return x.isoformat()
    if isinstance(x, (list, tuple)):
        return [_json(v) for v in x]
    if hasattr(x, "item"):
        x = x.item()
    return _clean(x) if isinstance(x, float) else x


def _check_level(level: str) -> None:
    if level not in LEVELS:
        raise ValueError(f"level must be one of {LEVELS}, got {level!r}")


def _month_start(month: str) -> date:
    return _month_range(month)[0]


def _prev_month(month: str) -> str:
    return (_month_start(month) - timedelta(days=1)).strftime("%Y-%m")


def _grain(p: DemandParams) -> str:
    return p.grain if p.grain in GRAIN_DAYS else "month"


def _per_period(p: DemandParams, spend: float, days: float) -> float:
    """Spend per period of p's grain, from `spend` over `days` days (a month grain takes the month's spend)."""
    g = _grain(p)
    return spend if g == "month" else spend / max(days, 1.0) * GRAIN_DAYS[g]


# ---------------------------------------------------------------- inputs

def _load_params(conn, t: Tenant, level: str, run_id: str | None = None) -> dict[str, DemandParams]:
    """DemandParams per entity of `level` for run_id (default: the latest run with params for the level).

    Month grain preferred, then week, then day. Lift tests are applied (lift multiplies a, Spec 26).
    """
    if run_id is None:
        r = conn.execute("SELECT run_id FROM model_params WHERE tenant_id = %s AND params->>'level' = %s"
                         " ORDER BY created_at DESC, id DESC LIMIT 1", (t.tenant_id, level)).fetchone()
        if r is None:
            return {}
        run_id = r["run_id"]
    names = {f.name for f in fields(DemandParams)}
    best: dict[str, tuple[int, DemandParams]] = {}
    for r in conn.execute("SELECT entity_id, params FROM model_params WHERE tenant_id = %s AND run_id = %s"
                          " AND params->>'level' = %s ORDER BY id", (t.tenant_id, run_id, level)):
        p = DemandParams(**{k: v for k, v in r["params"].items() if k in names})
        rank = GRAIN_PREFERENCE.index(p.grain) if p.grain in GRAIN_PREFERENCE else len(GRAIN_PREFERENCE)
        if r["entity_id"] not in best or rank < best[r["entity_id"]][0]:
            best[r["entity_id"]] = (rank, p)
    lifted = calibrate.apply_lift([v[1] for v in best.values()], conn, t)
    return {p.entity_id: p for p in lifted}


def _meta_factor(conn, t: Tenant, month: str) -> float:
    r = conn.execute("SELECT meta_factor FROM calibration WHERE tenant_id = %s AND month = %s",
                     (t.tenant_id, month)).fetchone()
    return float(r["meta_factor"]) if r else calibrate.meta_factor(conn, t, month)


def _lifts(conn, t: Tenant, level: str, style_of: dict[str, str]) -> dict[str, float]:
    """Latest lift test factor per entity (a product takes its style's)."""
    by_style = {r["style_id"]: float(r["factor"]) for r in conn.execute(
        "SELECT DISTINCT ON (style_id) style_id, factor FROM lift_tests WHERE tenant_id = %s"
        " ORDER BY style_id, tested_on DESC", (t.tenant_id,))}
    if level == "style":
        return by_style
    return {pid: by_style[s] for pid, s in style_of.items() if s in by_style}


def _variants_of(data: TenantData, level: str) -> dict[str, set[str]]:
    """entity -> its current variant ids."""
    out: dict[str, set[str]] = {}
    mapping = data.entities_of(level)
    cur = data.products[data.products["current"]] if len(data.products) else data.products
    for v, pid in zip(cur["variant_id"], cur["product_id"]):
        for e in mapping.get(pid, []):
            out.setdefault(e, set()).add(v)
    return out


def _entity_costs(data: TenantData, level: str) -> dict[str, float | None]:
    """Mean unit cost of an entity's current variants; None when any of them has no cost."""
    out: dict[str, float | None] = {}
    mapping = data.entities_of(level)
    cur = data.products[data.products["current"]] if len(data.products) else data.products
    costs: dict[str, list[float]] = {}
    for pid, c in zip(cur["product_id"], cur["unit_cost"]):
        for e in mapping.get(pid, []):
            costs.setdefault(e, []).append(c)
    for e, cs in costs.items():
        out[e] = float(np.mean(cs)) if cs and all(_clean(c) is not None for c in cs) else None
    return out


def _sales_history(data: TenantData, level: str, as_of: date) -> dict[str, tuple[int, date | None]]:
    """entity -> (months with units > 0, first sale date) from lineage re-keyed sales up to as_of."""
    s = data.sales
    if s.empty:
        return {}
    mapping = data.entities_of(level)
    s = s[s["date"] <= pd.Timestamp(as_of)]
    s = s.assign(entity_id=s["product_id"].map(mapping)).dropna(subset=["entity_id"]).explode("entity_id")
    if s.empty:
        return {}
    units = s.groupby(["entity_id", s["date"].dt.to_period("M")])["qty"].sum()
    usable = (units > 0).groupby(level=0).sum()
    first = s[s["qty"] > 0].groupby("entity_id")["date"].min()
    return {e: (int(usable.get(e, 0)), first[e].date() if e in first.index else None) for e in usable.index}


def _restock_lifts(conn, t: Tenant, variants_of: dict[str, set[str]], as_of: date) -> dict[str, float | None]:
    """Restock lift of each entity's most recent received PO (first receipt on or before as_of)."""
    pos = conn.execute(
        "SELECT r.source AS po, MIN(r.date) AS d FROM stock_receipts r JOIN purchase_orders o"
        " ON o.tenant_id = r.tenant_id AND o.po_number = r.source WHERE r.tenant_id = %s"
        " GROUP BY r.source HAVING MIN(r.date) <= %s", (t.tenant_id, as_of)).fetchall()
    if not pos:
        return {}
    lines: dict[str, set[str]] = {}
    for r in conn.execute("SELECT po_number, variant_id FROM po_lines WHERE tenant_id = %s", (t.tenant_id,)):
        lines.setdefault(r["po_number"], set()).add(r["variant_id"])
    cache: dict[str, float | None] = {}
    out = {}
    for ent, vs in variants_of.items():
        cands = [(r["d"], r["po"]) for r in pos if lines.get(r["po"], set()) & vs]
        if cands:
            po = max(cands)[1]
            if po not in cache:
                cache[po] = _clean(restock_lift(conn, t, po))
            out[ent] = cache[po]
    return out


def lead_times(conn, t: Tenant, level: str, style_of: dict[str, str]) -> dict[str, int]:
    """Supplier lead_time_days per entity: product row first, then its style's row (a style: its own row, else
    the longest of its products' rows). Entities without a supplier are absent (caller defaults to 30)."""
    _check_level(level)
    by_product, by_style = _supplier_rows(conn, t)
    out: dict[str, int] = {}
    if level == "product":
        for pid in set(style_of) | set(by_product):
            row = by_product.get(pid) or by_style.get(style_of.get(pid))
            if row is not None:
                out[pid] = int(row["lead_time_days"])
        return out
    for s in set(style_of.values()) | set(by_style):
        if s in by_style:
            out[s] = int(by_style[s]["lead_time_days"])
        else:
            leads = [int(by_product[p]["lead_time_days"]) for p, st in style_of.items() if st == s and p in by_product]
            if leads:
                out[s] = max(leads)
    return out


def _decompose(p: DemandParams, row: dict, spend_daily: float, days: int) -> dict:
    """model.decompose on a month panel row. Params of a finer grain without actual views use the expected
    full availability demand over the month's days (from the planner forecast) as the level."""
    if _grain(p) == "month" or (not p.fallback and _clean(row.get("views")) is not None):
        return decompose(p, row)
    price = _num(row.get("price"), _num(p.ref_price, 0.0))
    avail = min(max(_num(row.get("size_availability"), 1.0), 0.0), 1.0)
    full = _model_forecast(p, spend_daily, price, days)
    units = _num(row.get("units"), 0.0)
    lost_stock = full * (1.0 - avail)
    if p.fallback:
        cr_full, lost_price = None, 0.0
    else:
        cr_full = _cr_full(p, price)
        views = full / cr_full if cr_full > 0 else 0.0
        lost_price = views * (p.cr_ref - cr_full) * avail
    return {"cr_full": cr_full, "units": units, "lost_stock": lost_stock, "lost_price": lost_price,
            "true_demand": units + lost_stock}


# ---------------------------------------------------------------- scorecard

def scorecard(conn, t: Tenant, month: str, level: str, run_id: str | None = None, *,
              data: TenantData | None = None) -> pd.DataFrame:
    """One row per entity with a month panel row in `month` (Spec 32). Columns: SCORECARD_COLUMNS.

    Actuals come from the month panel; cr_full, lost_stock, lost_price and true_demand from model.decompose with
    the entity's DemandParams (run_id, else the latest run with params for the level). CPA/CAC use the month's
    meta_factor and the lift tests; customer value is as of the month's last day. poas = gross profit / spend;
    marginal_poas = planner.steady_marginal_poas at the month's spend. Missing unit cost: gross_profit, poas
    and marginal_poas None and flag missing_cost (roas and marginal_roas are always given when computable).
    `data` lets callers share one TenantData across scorecards.
    """
    _check_level(level)
    data = data or TenantData(conn, t)
    start, end = _month_range(month)
    as_of = end - timedelta(days=1)
    panel = data.panel("month", level)
    rows = panel[panel["period_start"] == start] if len(panel) else panel
    if rows.empty:
        return pd.DataFrame(columns=SCORECARD_COLUMNS)

    params = _load_params(conn, t, level, run_id)
    mf = _meta_factor(conn, t, month)
    lift = _lifts(conn, t, level, data.style_of)
    cpa = customers.cpa(conn, t, month, level, mf).set_index("entity_id")
    cac = customers.cac(conn, t, month, level, lift=lift).set_index("entity_id")
    cv = customers.customer_value(conn, t, level, as_of=as_of).set_index("entity_id")
    history = _sales_history(data, level, as_of)
    variants_of = _variants_of(data, level)
    entity_cost = _entity_costs(data, level)
    stock, on_order = _available(conn, t, as_of), _on_order(conn, t)
    lifts = _restock_lifts(conn, t, variants_of, as_of)

    def look(df, ent, col):
        return _clean(df.at[ent, col]) if ent in df.index else None

    out = []
    for r in rows.to_dict("records"):
        ent = r["entity_id"]
        p = params.get(ent)
        flags: list[str] = []
        n_days = max(int(r["n_days"] or 0), 1)
        units = _num(r["units"], 0.0)
        revenue = _num(r["revenue"], 0.0)
        spend = _num(r["spend"], 0.0)
        views = _clean(r["views"])
        avail = _num(r["size_availability"], 1.0)
        price = _num(r["price"], _num(p.ref_price, 0.0) if p else 0.0)
        cost = _clean(r["cost"])
        if r["missing_cost"]:
            unit_cost = None
        elif units > 0 and cost is not None:
            unit_cost = cost / units
        else:
            unit_cost = entity_cost.get(ent)
        missing = unit_cost is None
        if missing:
            flags.append("missing_cost")
        gross_profit = None if missing else revenue - (cost or 0.0)

        d = {"cr_full": None, "lost_stock": None, "lost_price": None, "true_demand": None}
        mpoas = mroas = daily = None
        if p is None:
            flags.append("no_params")
        else:
            if _grain(p) != "month":
                flags.append(f"params_grain_{_grain(p)}")
            d = _decompose(p, r, spend / n_days, n_days)
            s_per, decay = _per_period(p, spend, n_days), DECAY[_grain(p)]
            mroas = planner.steady_marginal_poas(p, s_per, price, None, avail, decay)
            if not missing:
                mpoas = planner.steady_marginal_poas(p, s_per, price, unit_cost, avail, decay)
            daily = _model_forecast(p, spend / n_days, price, COVER_FORECAST_DAYS) / COVER_FORECAST_DAYS
        if views is None:
            flags.append("no_views")
        elif r["views_estimated"]:
            flags.append("views_estimated")
        if r["no_stock_data"]:
            flags.append("no_stock_data")
        if ent in cv.index and "young_unscaled" in (cv.at[ent, "flags"] or []):
            flags.append("young_unscaled")

        vs = variants_of.get(ent, set())
        available = max(sum(stock.get(v, 0) for v in vs), 0)
        usable, first = history.get(ent, (0, None))
        out.append({
            "entity_id": ent, "level": level, "month": month, "as_of": as_of,
            "views": views, "cr": _div(units, views), "cr_full": _clean(d["cr_full"]),
            "size_availability": _clean(r["size_availability"]), "units": units,
            "lost_stock": _clean(d["lost_stock"]), "lost_price": _clean(d["lost_price"]),
            "true_demand": _clean(d["true_demand"]), "revenue": revenue, "gross_profit": gross_profit,
            "spend": spend, "impressions": _num(r["impressions"], 0.0), "cpm": _div(spend * 1000.0, r["impressions"]),
            "meta_cpa": look(cpa, ent, "meta_cpa"), "shopify_cpa": look(cpa, ent, "shopify_cpa"),
            "blended_cac": look(cac, ent, "blended_cac"), "paid_cac": look(cac, ent, "paid_cac"),
            "customer_value_12m": look(cv, ent, "value_12m"),
            "poas": None if missing else _div(gross_profit, spend), "marginal_poas": _clean(mpoas),
            "roas": _div(revenue, spend), "marginal_roas": _clean(mroas),
            "stock_cover_days": _div(available, daily) if daily and daily > 0 else None,
            "available": float(available), "on_order": float(sum(on_order.get(v, 0) for v in vs)),
            "restock_lift": lifts.get(ent), "meta_factor": mf,
            "usable_periods": usable, "first_sale_date": first, "flags": flags})
    return pd.DataFrame(out, columns=SCORECARD_COLUMNS, dtype=object)


# ---------------------------------------------------------------- decision rules

def _get(row, key):
    v = row.get(key) if hasattr(row, "get") else getattr(row, key, None)
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def _as_date(x) -> date | None:
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return None
    if isinstance(x, pd.Timestamp):
        return x.date()
    if isinstance(x, date):
        return x
    try:
        return date.fromisoformat(str(x)[:10])
    except ValueError:
        return None


def _lt(a, b) -> bool:
    a, b = _clean(a), _clean(b)
    return a is not None and b is not None and a < b


def _le(a, b) -> bool:
    a, b = _clean(a), _clean(b)
    return a is not None and b is not None and a <= b


def _fmt(x, nd=2) -> str:
    v = _clean(x)
    return "None" if v is None else f"{v:.{nd}f}"


def _kill_month(r) -> bool:
    return (_lt(_get(r, "poas"), 1.0) and _lt(_get(r, "marginal_poas"), 1.0)
            and _le(FULL_AVAILABILITY, _get(r, "size_availability")))


def decide(row, history, lead_time) -> tuple[str, str]:
    """(decision, rule) for one scorecard row; history = previous scorecard rows of the entity, latest first.

    First match wins, in Spec 33 order: TEST, RESTOCK FIRST, FIX PRICE, SCALE, KILL, CUT SPEND, MAINTAIN.
    Rows flagged missing_cost: RESTOCK FIRST clause 1 uses marginal ROAS >= 4.5, SCALE uses ROAS >= 3, KILL
    cannot fire, CUT SPEND uses marginal ROAS < 3.
    A condition that needs a None input is false.
    """
    g = lambda k: _get(row, k)  # noqa: E731
    missing = "missing_cost" in (g("flags") or [])
    tag = " (missing cost)" if missing else ""
    mp, poas, avail = g("marginal_poas"), g("poas"), g("size_availability")
    td, ls, lp = g("true_demand"), g("lost_stock"), g("lost_price")

    usable = _clean(g("usable_periods"))
    if _lt(usable, MIN_USABLE_PERIODS):
        return "TEST", f"TEST: {usable:g} usable periods < {MIN_USABLE_PERIODS}"
    first, as_of = _as_date(g("first_sale_date")), _as_date(g("as_of"))
    age = (as_of - first).days if first and as_of else None
    if _lt(age, MIN_AGE_DAYS):
        return "TEST", f"TEST: first sale {first} is {age} days before {as_of} (< {MIN_AGE_DAYS} days)"

    cover = g("stock_cover_days")
    if missing:                                 # no unit cost: marginal ROAS >= 3 x 1.5 stands in for POAS >= 1.5
        mr = g("marginal_roas")
        if _le(MISSING_COST_RESTOCK_ROAS, mr) and _lt(cover, lead_time):
            return "RESTOCK FIRST", (f"RESTOCK FIRST: marginal ROAS {_fmt(mr)} >= {MISSING_COST_RESTOCK_ROAS:g} and"
                                     f" stock cover {_fmt(cover, 1)} days < lead time {_clean(lead_time):g}{tag}")
    elif _le(SCALE_MARGINAL_POAS, mp) and _lt(cover, lead_time):
        return "RESTOCK FIRST", (f"RESTOCK FIRST: marginal POAS {_fmt(mp)} >= {SCALE_MARGINAL_POAS} and stock cover"
                                 f" {_fmt(cover, 1)} days < lead time {_clean(lead_time):g}")
    if _clean(td) is not None and _lt(LOST_SHARE * _clean(td), ls):
        return "RESTOCK FIRST", f"RESTOCK FIRST: lost_stock {_fmt(ls, 1)} > 20% of true_demand {_fmt(td, 1)}{tag}"

    if _clean(td) is not None and _lt(LOST_SHARE * _clean(td), lp) and _le(FULL_AVAILABILITY, avail):
        return "FIX PRICE", (f"FIX PRICE: lost_price {_fmt(lp, 1)} > 20% of true_demand {_fmt(td, 1)} with size"
                             f" availability {_fmt(avail)} >= {FULL_AVAILABILITY}{tag}")

    paid, value = g("paid_cac"), g("customer_value_12m")
    if missing:
        roas = g("roas")
        if _le(MISSING_COST_ROAS, roas):
            return "SCALE", f"SCALE: ROAS {_fmt(roas)} >= {MISSING_COST_ROAS:g}{tag}"
    else:
        if _le(SCALE_MARGINAL_POAS, mp):
            return "SCALE", f"SCALE: marginal POAS {_fmt(mp)} >= {SCALE_MARGINAL_POAS}"
        if _clean(value) is not None and _le(paid, _clean(value) / VALUE_TO_CAC) and _le(1.0, mp):
            return "SCALE", (f"SCALE: paid CAC {_fmt(paid)} <= customer value 12m {_fmt(value)} / {VALUE_TO_CAC}"
                             f" and marginal POAS {_fmt(mp)} >= 1")

        prev = history[0] if history else None
        if prev is not None and _kill_month(row) and _kill_month(prev) and _lt(value, paid):
            pg = lambda k: _get(prev, k)  # noqa: E731
            return "KILL", (f"KILL: POAS {_fmt(poas)}, marginal POAS {_fmt(mp)} < 1 with size availability"
                            f" {_fmt(avail)} >= {FULL_AVAILABILITY} this month and POAS {_fmt(pg('poas'))},"
                            f" marginal POAS {_fmt(pg('marginal_poas'))}, availability"
                            f" {_fmt(pg('size_availability'))} last month; customer value 12m {_fmt(value)}"
                            f" < paid CAC {_fmt(paid)}")

    if missing:
        mr = g("marginal_roas")
        if _lt(mr, MISSING_COST_ROAS):
            return "CUT SPEND", f"CUT SPEND: marginal ROAS {_fmt(mr)} < {MISSING_COST_ROAS:g}{tag}"
    elif _lt(mp, 1.0):
        return "CUT SPEND", f"CUT SPEND: marginal POAS {_fmt(mp)} < 1"

    return "MAINTAIN", f"MAINTAIN: no rule matched (POAS {_fmt(poas)}, marginal POAS {_fmt(mp)}){tag}"


def run_decisions(conn, t: Tenant, run_id: str, month: str, data: TenantData | None = None) -> pd.DataFrame:
    """Decide every style and product for `month` with the previous month as history; store decisions rows.

    Idempotent per (tenant, run_id, month, level): earlier rows of that slice are replaced. numbers holds the
    scorecard values (plus lead_time_days), flags the scorecard flags. Returns DECISION_COLUMNS.
    """
    data = data or TenantData(conn, t)
    prev = _prev_month(month)
    start = _month_start(month)
    out = []
    for level in LEVELS:
        leads = lead_times(conn, t, level, data.style_of)
        cur = scorecard(conn, t, month, level, run_id, data=data)
        hist = {r["entity_id"]: r for r in scorecard(conn, t, prev, level, run_id, data=data).to_dict("records")}
        for r in cur.to_dict("records"):
            ent = r["entity_id"]
            lead = leads.get(ent, DEFAULT_LEAD_TIME)
            decision, rule = decide(r, [hist[ent]] if ent in hist else [], lead)
            numbers = {k: _json(v) for k, v in r.items() if k not in ("flags", "entity_id", "level")}
            numbers["lead_time_days"] = lead
            out.append({"level": level, "entity_id": ent, "month": month, "decision": decision, "rule": rule,
                        "lead_time_days": lead, "flags": list(r["flags"]), "numbers": numbers})
    try:
        conn.execute("DELETE FROM decisions WHERE tenant_id = %s AND run_id = %s AND month = %s AND level = ANY(%s)",
                     (t.tenant_id, run_id, start, list(LEVELS)))
        for d in out:
            conn.execute("INSERT INTO decisions (tenant_id, run_id, month, level, entity_id, decision, rule, numbers,"
                         " flags) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                         (t.tenant_id, run_id, start, d["level"], d["entity_id"], d["decision"], d["rule"],
                          Jsonb(d["numbers"]), Jsonb(d["flags"])))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return pd.DataFrame(out, columns=DECISION_COLUMNS, dtype=object)


# ---------------------------------------------------------------- forward plan

def _month_rows(p: DemandParams, spends: list[float], days: list[int], price: float, unit_cost: float | None,
                adstock0: float) -> list[dict]:
    """Monthly units and true demand (full availability) for monthly spends, carry over included.

    Month grain params forecast directly; finer grains forecast their own periods (spend spread evenly over each
    month's days) and sum them per month, scaled to the month's days.
    """
    g = _grain(p)
    if g == "month":
        f = planner.forecast(p, list(spends), price, 1.0, "month", len(spends), unit_cost=unit_cost, adstock0=adstock0)
        return [{"units": _num(u, 0.0), "true_demand": _num(td, 0.0)} for u, td in zip(f["units"], f["true_demand"])]
    per = GRAIN_DAYS[g]
    counts = [max(1, round(d / per)) for d in days]
    budget = [s * per / d for s, d, n in zip(spends, days, counts) for _ in range(n)]
    f = planner.forecast(p, budget, price, 1.0, g, len(budget), unit_cost=unit_cost, adstock0=adstock0)
    out, i = [], 0
    for d, n in zip(days, counts):
        scale = d / (n * per)
        out.append({"units": sum(_num(u, 0.0) for u in f["units"].iloc[i:i + n]) * scale,
                    "true_demand": sum(_num(x, 0.0) for x in f["true_demand"].iloc[i:i + n]) * scale})
        i += n
    return out


def _cap(p, wanted, days, price, unit_cost, adstock0, supply) -> list[dict]:
    """Month by month: keep the wanted spend while cumulative units fit supply; otherwise bisect the month's
    spend down until they fit; if the month at zero spend already exceeds what is left, spend 0 and sell it."""
    spends: list[float] = []
    left = supply
    out = []
    for i, want in enumerate(wanted):
        sim = lambda s: _month_rows(p, spends + [s], days[:i + 1], price, unit_cost, adstock0)[-1]  # noqa: E731
        r, s, capped = sim(want), want, False
        units, td = r["units"], r["true_demand"]
        if units > left + 1e-9:
            capped = True
            zero = sim(0.0)
            if zero["units"] >= left:
                s, units, td = 0.0, max(left, 0.0), zero["true_demand"]
            else:
                lo, hi = 0.0, want
                for _ in range(BISECT_STEPS):
                    mid = (lo + hi) / 2
                    if sim(mid)["units"] <= left:
                        lo = mid
                    else:
                        hi = mid
                r = sim(lo)
                s, units, td = lo, r["units"], r["true_demand"]
        spends.append(s)
        left -= units
        out.append({"spend": s, "units": units, "true_demand": td, "capped": capped})
    return out


def forward_plan(conn, t: Tenant, run_id: str, months: int = 3, data: TenantData | None = None) -> pd.DataFrame:
    """Per style with params in the run, the next `months` months after the last data month (Spec 34).

    Spend: planner.spend_at_marginal_poas (target 1.0, full availability) as monthly spend; 0 for KILL and the
    current monthly spend for TEST (the run's latest decision). Units are capped so cumulative units <= available
    + on order + this run's draft PO quantities (see _cap). Stores product_plans (idempotent per tenant and run,
    po_number = the run's draft PO covering the style) and records the plan as style/month forecasts.
    Returns PLAN_COLUMNS.
    """
    data = data or TenantData(conn, t)
    params = _load_params(conn, t, "style", run_id)
    panel = data.panel("month", "style")
    decided = {r["entity_id"]: r["decision"] for r in conn.execute(
        "SELECT DISTINCT ON (entity_id) entity_id, decision FROM decisions WHERE tenant_id = %s AND run_id = %s"
        " AND level = 'style' ORDER BY entity_id, month DESC, id DESC", (t.tenant_id, run_id))}
    variants_of = _variants_of(data, "style")
    entity_cost = _entity_costs(data, "style")
    stock, on_order = _available(conn, t), _on_order(conn, t)
    drafts: dict[str, list[tuple[str, int]]] = {}
    for r in conn.execute(
            "SELECT l.po_number, l.variant_id, l.qty_suggested FROM po_lines l JOIN purchase_orders o"
            " ON o.tenant_id = l.tenant_id AND o.po_number = l.po_number"
            " WHERE l.tenant_id = %s AND o.run_id = %s AND o.state = 'draft' ORDER BY l.po_number",
            (t.tenant_id, run_id)):
        drafts.setdefault(r["variant_id"], []).append((r["po_number"], int(r["qty_suggested"])))

    out = []
    if params and len(panel):
        last = max(panel["period_start"])
        starts = [(pd.Timestamp(last) + pd.DateOffset(months=i + 1)).date() for i in range(months)]
        days = [((pd.Timestamp(s) + pd.DateOffset(months=1)).date() - s).days for s in starts]
        for style, p in sorted(params.items()):
            hist = panel[panel["entity_id"] == style].sort_values("period_start")
            g, decision = _grain(p), decided.get(style)
            per, decay = GRAIN_DAYS[g], DECAY[g]
            price, unit_cost, spend_daily = _num(p.ref_price, 0.0), entity_cost.get(style), 0.0
            if len(hist):
                lr = hist.iloc[-1]
                price = _num(lr["price"], price)
                cost, units = _clean(lr["cost"]), _num(lr["units"], 0.0)
                if lr["missing_cost"]:
                    unit_cost = None
                elif units > 0 and cost is not None:
                    unit_cost = cost / units
                spend_daily = _num(lr["spend"], 0.0) / max(int(lr["n_days"] or 0), 1)
            adstock0 = spend_daily * per / (1.0 - decay)                       # steady state at current spend
            if decision == "KILL":
                wanted = [0.0] * months
            elif decision == "TEST":
                wanted = [spend_daily * d for d in days]
            else:
                s_per = planner.spend_at_marginal_poas(p, price, unit_cost, 1.0, decay, 1.0)
                wanted = [s_per if g == "month" else s_per / per * d for d in days]
            vs = variants_of.get(style, set())
            draft = [x for v in vs for x in drafts.get(v, [])]
            supply = float(max(sum(stock.get(v, 0) for v in vs), 0) + sum(on_order.get(v, 0) for v in vs)
                           + sum(q for _, q in draft))
            po = min((n for n, _ in draft), default=None)
            for s, d, r in zip(starts, days, _cap(p, wanted, days, price, unit_cost, adstock0, supply)):
                out.append({"entity_id": style, "month": s.strftime("%Y-%m"), "period_start": s, "decision": decision,
                            "spend": r["spend"], "units": r["units"], "true_demand": r["true_demand"],
                            "revenue": r["units"] * price,
                            "profit": None if unit_cost is None else r["units"] * (price - unit_cost) - r["spend"],
                            "supply": supply, "capped": r["capped"], "po_number": po})
    elif not params:
        log.warning("tenant %s run %s: no style params; empty plan", t.tenant_id, run_id)

    plan = pd.DataFrame(out, columns=PLAN_COLUMNS, dtype=object)
    try:
        conn.execute("DELETE FROM product_plans WHERE tenant_id = %s AND run_id = %s", (t.tenant_id, run_id))
        for r in out:
            conn.execute("INSERT INTO product_plans (tenant_id, run_id, entity_id, month, spend, units, true_demand,"
                         " revenue, profit, po_number) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                         (t.tenant_id, run_id, r["entity_id"], r["period_start"], r["spend"], r["units"],
                          r["true_demand"], r["revenue"], r["profit"], r["po_number"]))
        record_forecasts(conn, t, run_id, "style", "month",           # commits the plan rows too
                         pd.DataFrame(out, columns=PLAN_COLUMNS)[["entity_id", "period_start", "units", "true_demand",
                                                                  "revenue", "spend", "profit"]])
    except Exception:
        conn.rollback()
        raise
    return plan
