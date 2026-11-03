"""Spend planner: multi period forecast with carry over, and the spend where marginal profit per spend hits a target."""
from __future__ import annotations

import math

import pandas as pd

from .aggregate import DECAY
from .model import DemandParams, _cr_full, _num, predict

HORIZON = {"day": 30, "week": 12, "month": 6}
MISSING_COST_TARGET = 3.0     # no unit cost: plan on revenue, marginal ROAS 3 (Spec 33)
COLUMNS = ["period", "spend", "views", "units", "lost_stock", "lost_price", "true_demand", "revenue", "profit",
           "roas", "poas", "marginal_poas", "missing_cost"]


def _plan(x, n: int, name: str, scalar_types=(int, float)) -> list:
    if x is None or isinstance(x, scalar_types + (dict,)):
        return [x] * n
    x = list(x)
    if len(x) != n:
        raise ValueError(f"{name} has {len(x)} entries, expected {n}")
    return x


def _simulate(p, spend, price, avail, flags, decay, adstock0):
    carry, out = adstock0, []
    for i, s in enumerate(spend):
        carry = s + decay * carry
        out.append(predict(p, carry, price[i], avail[i], flags[i]))
    return out


def _gross(res, price, unit_cost) -> float:
    return sum(r["units"] * (pr - unit_cost) for r, pr in zip(res, price))


def _ratio(num, den):
    v = num / den if den else None
    return v if v is not None and math.isfinite(v) else None


def forecast(p: DemandParams, budget, price_plan, stock_plan, grain: str, horizon: int | None = None, *,
             unit_cost: float | None = None, adstock0: float = 0.0, flags_plan=None) -> pd.DataFrame:
    """One row per future period. budget, price_plan, stock_plan, flags_plan: scalar or per period sequence.

    Columns: period, spend, views, units, lost_stock, lost_price, true_demand, revenue, profit, roas, poas,
    marginal_poas, missing_cost. profit = units * (price - unit_cost) - spend; poas = gross profit / spend;
    marginal_poas = d(total gross profit over the horizon)/d(this period's spend), carry over included.
    Zero spend gives roas/poas None; no unit_cost gives profit/poas/marginal_poas None and missing_cost True.
    """
    if grain not in DECAY:
        raise ValueError(f"unknown grain {grain!r}")
    n = HORIZON[grain] if horizon is None else int(horizon)
    decay = DECAY[grain]
    spend = [max(_num(s, 0.0), 0.0) for s in _plan(budget, n, "budget")]
    price = [_num(x, 0.0) for x in _plan(price_plan, n, "price_plan")]
    avail = [_num(x, 1.0) for x in _plan(stock_plan, n, "stock_plan")]
    flags = _plan(flags_plan, n, "flags_plan")
    adstock0 = max(_num(adstock0, 0.0), 0.0)
    res = _simulate(p, spend, price, avail, flags, decay, adstock0)
    base = _gross(res, price, unit_cost) if unit_cost is not None else None
    rows = []
    for i, r in enumerate(res):
        revenue = r["units"] * price[i]
        row = {"period": i, "spend": spend[i], "views": r["views"], "units": r["units"],
               "lost_stock": r["lost_stock"], "lost_price": r["lost_price"], "true_demand": r["true_demand"],
               "revenue": revenue, "profit": None, "roas": _ratio(revenue, spend[i]), "poas": None,
               "marginal_poas": None, "missing_cost": unit_cost is None}
        if unit_cost is not None:
            gross = r["units"] * (price[i] - unit_cost)
            row["profit"] = gross - spend[i]
            row["poas"] = _ratio(gross, spend[i])
            h = max(spend[i] * 1e-4, 1e-3)
            bumped = list(spend)
            bumped[i] += h
            up = _gross(_simulate(p, bumped, price, avail, flags, decay, adstock0), price, unit_cost)
            row["marginal_poas"] = _num((up - base) / h, 0.0)
        rows.append(row)
    return pd.DataFrame(rows, columns=COLUMNS).astype(object)


def _steady_margin(p: DemandParams, price: float, unit_cost: float | None, avail: float) -> float:
    """m: gross profit (revenue without unit_cost) per unit of a * ln(1 + adstock) response."""
    margin = price if unit_cost is None else price - _num(unit_cost, 0.0)
    conv = 1.0 if p.fallback else _cr_full(p, price)
    return conv * avail * margin


def steady_marginal_poas(p: DemandParams, spend: float, price: float, unit_cost: float | None,
                         size_availability: float, decay: float) -> float:
    """d(gross profit per period) / d(spend per period) at a steady `spend` per period (in p's grain).

    a * m / ((1 - decay) + spend), the derivative behind spend_at_marginal_poas. Without unit_cost the margin
    is the price, so the value is the marginal ROAS.
    """
    price, avail = _num(price, 0.0), min(max(_num(size_availability, 1.0), 0.0), 1.0)
    if p.a <= 0 or avail <= 0:
        return 0.0
    m = _steady_margin(p, price, unit_cost, avail)
    return _num(p.a * m / ((1.0 - decay) + max(_num(spend, 0.0), 0.0)), 0.0)


def spend_at_marginal_poas(p: DemandParams, price: float, unit_cost: float | None, size_availability: float,
                           decay: float, target: float = 1.0) -> float:
    """Steady state spend per period where marginal gross profit per unit of spend equals `target`.

    s* = max(0, a * m / target - (1 - decay)), m = cr_full * availability * (price - unit_cost)
    (fallback params: m = availability * (price - unit_cost)), i.e. steady_marginal_poas(s*) = target.
    Without unit_cost the margin is the price and the target is marginal ROAS 3.
    """
    price, avail = _num(price, 0.0), min(max(_num(size_availability, 1.0), 0.0), 1.0)
    if unit_cost is None:
        target = MISSING_COST_TARGET
    m = _steady_margin(p, price, unit_cost, avail)
    if p.a <= 0 or m <= 0 or avail <= 0 or target <= 0:
        return 0.0
    return _num(max(0.0, p.a * m / target - (1.0 - decay)), 0.0)
