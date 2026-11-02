"""Demand model: traffic x conversion, with lost sales split into stock and price causes (Spec 22 to 25).

Per entity:  views   = baseline_v + a * ln(1 + adstock) + sum_k seasonal_k * flag_k      (OLS, a >= 0)
             cr_full = cr_ref * (price / ref_price) ^ e                                  (e in [-6, 0])
             units   = views * cr_full * size_availability
Without views (fallback): units = size_availability * (baseline + a * ln(1 + adstock) + seasonal).
Entities with too little data inherit a, seasonal and e from their parent (product -> style -> collection
-> store); parents are fitted first. Nothing returned is NaN or infinite.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd
from psycopg.types.json import Jsonb

from .aggregate import FLAGS, FULL_AVAILABILITY, LEVELS, STORE_ENTITY, TenantData
from .tenants import Tenant

MIN_PERIODS = 12          # usable periods needed to fit a, seasonal and e from own data
MIN_PRICE_LEVELS = 3      # distinct (rounded) prices needed to fit e
MIN_PERIODS_NO_PARENT = 3  # below this a store level fit keeps a = 0
E_MIN, E_MAX = -6.0, 0.0


@dataclass
class DemandParams:
    entity_id: str
    baseline_v: float          # baseline views (fallback: baseline units at full availability)
    a: float                   # response to ln(1 + adstock), >= 0
    cr_ref: float              # conversion at ref_price with every size in stock
    e: float                   # price elasticity in [-6, 0]
    seasonal: dict[str, float] = field(default_factory=dict)   # flag -> effect on views (fallback: units)
    inherited: bool = False    # any of a, seasonal, e, cr_ref came from the parent
    fallback: bool = False     # no views: fitted directly on units
    ref_price: float | None = None
    mean_level: float = 0.0    # mean of the fitted series (views, or units / availability); scales inheritance
    level: str | None = None
    grain: str | None = None
    n_periods: int = 0
    flags: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- numeric helpers

def _num(x, default: float) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


def _ln1p(adstock) -> np.ndarray:
    return np.log1p(np.clip(np.nan_to_num(np.asarray(adstock, float), nan=0.0), 0.0, None))


def _ols(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    return np.nan_to_num(coef, nan=0.0, posinf=0.0, neginf=0.0)


def _price_ratio(price, ref_price) -> float:
    p, r = _num(price, 0.0), _num(ref_price, 0.0)
    return p / r if p > 0 and r > 0 else 1.0


def _cr_full(p: DemandParams, price) -> float:
    return _num(p.cr_ref * _price_ratio(price, p.ref_price) ** p.e, p.cr_ref)


def _season(p: DemandParams, flags) -> float:
    flags = flags or {}
    return sum(v * _num(flags.get(k), 0.0) for k, v in p.seasonal.items())


# ---------------------------------------------------------------- fitting

def _fit_level(df: pd.DataFrame, y: np.ndarray, parent: DemandParams | None, flags: list[str]):
    """baseline + a * ln(1 + adstock) + seasonal on the rows of df (y aligned). Returns baseline, a, seasonal, mean."""
    seasonal = dict.fromkeys(FLAGS, 0.0)
    n = len(y)
    if n == 0:
        return 0.0, 0.0, seasonal, 0.0
    x = _ln1p(df["adstock"])
    F = {f: df[f].to_numpy(float) for f in FLAGS if f in df}
    mean = float(np.mean(y))
    if n >= MIN_PERIODS:
        cols = [f for f, v in F.items() if np.ptp(v) > 0]
        use_a = np.ptp(x) > 0
        X = np.column_stack([np.ones(n)] + ([x] if use_a else []) + [F[f] for f in cols])
        coef = _ols(X, y)
        a = float(coef[1]) if use_a else 0.0
        if a < 0:
            flags.append("a_clipped")
            a, use_a = 0.0, False
            coef = _ols(np.column_stack([np.ones(n)] + [F[f] for f in cols]), y)
        for f, c in zip(cols, coef[2 if use_a else 1:]):
            seasonal[f] = float(c)
        return float(coef[0]), a, seasonal, mean
    if parent is not None:
        scale = mean / parent.mean_level if parent.mean_level > 0 else 0.0
        a = max(parent.a * scale, 0.0)
        for f, v in parent.seasonal.items():
            seasonal[f] = v * scale
        flags.extend(["inherited_a", "inherited_seasonal"])
    else:
        a = 0.0
        if n >= MIN_PERIODS_NO_PARENT and np.ptp(x) > 0:
            a = max(float(_ols(np.column_stack([np.ones(n), x]), y)[1]), 0.0)
        flags.append("few_periods")
    s = sum(seasonal[f] * F[f] for f in F) if F else 0.0
    return float(np.mean(y - a * x - s)), a, seasonal, mean


def _fit_conversion(df: pd.DataFrame, parent: DemandParams | None, flags: list[str]) -> tuple[float, float]:
    """e by OLS of ln(cr_full_obs) on ln(price / ref_price); cr_ref from the same rows given e."""
    v = df["views"].to_numpy(float)
    u = df["units"].to_numpy(float)
    av = df["size_availability"].to_numpy(float)
    price = df["price"].to_numpy(float)
    ref = df["ref_price"].to_numpy(float)
    ok = (av >= FULL_AVAILABILITY) & (v > 0) & (u > 0)
    ratio = np.array([_price_ratio(p, r) for p, r in zip(price, ref)])
    valid_price = np.isfinite(price) & (price > 0) & np.isfinite(ref) & (ref > 0)
    levels = len(set(np.round(price[ok & valid_price])))
    x = np.log(ratio[ok])
    if ok.sum() >= MIN_PERIODS and levels >= MIN_PRICE_LEVELS and np.ptp(x) > 0:
        y = np.log(u[ok] / (v[ok] * av[ok]))
        e = float(_ols(np.column_stack([np.ones(len(x)), x]), y)[1])
        if not E_MIN <= e <= E_MAX:
            flags.append("e_clipped")
        e = min(max(e, E_MIN), E_MAX)
    elif parent is not None:
        e = parent.e
        flags.append("inherited_e")
    else:
        e = 0.0
        flags.append("e_default")
    if ok.any():
        expo = float(np.sum(v[ok] * av[ok] * ratio[ok] ** e))
        cr = float(np.sum(u[ok])) / expo if expo > 0 else 0.0
    elif parent is not None:
        cr = parent.cr_ref
        flags.extend(["no_conversion_data", "inherited_cr"])
    else:
        seen = (v > 0) & np.isfinite(av) & (av > 0)
        expo = float(np.sum(v[seen] * av[seen]))
        cr = max(float(np.nansum(u[seen])), 0.0) / expo if expo > 0 else 0.0
        flags.append("no_conversion_data")
    return e, cr


def fit_entity(df: pd.DataFrame, parent: DemandParams | None = None) -> DemandParams | None:
    """Fit one entity's panel rows (sorted by period). None when there are no rows."""
    if df is None or len(df) == 0:
        return None
    df = df.sort_values("period_start").reset_index(drop=True)
    flags: list[str] = []
    ref = df["ref_price"].dropna()
    ref_price = _num(ref.iloc[-1], 0.0) if len(ref) else None
    views = pd.to_numeric(df["views"], errors="coerce")
    if views.notna().any():
        rows = df[views.notna()].assign(views=views[views.notna()])
        baseline, a, seasonal, mean = _fit_level(rows, rows["views"].to_numpy(float), parent, flags)
        e, cr_ref = _fit_conversion(rows, parent, flags)
        fallback = False
    else:
        av = df["size_availability"].astype(float)
        rows = df[av >= FULL_AVAILABILITY]
        if rows.empty:
            rows = df[av > 0]
        y = (rows["units"].astype(float) / rows["size_availability"].astype(float)).to_numpy()
        baseline, a, seasonal, mean = _fit_level(rows, y, parent, flags)
        e = parent.e if parent is not None else 0.0
        cr_ref = parent.cr_ref if parent is not None else 0.0
        fallback = True
        flags.append("fallback")
    if df.get("views_estimated", pd.Series(dtype=bool)).fillna(False).astype(bool).any():
        flags.append("views_estimated")
    if df.get("missing_cost", pd.Series(dtype=bool)).fillna(False).astype(bool).any():
        flags.append("missing_cost")
    if len(df.get("no_stock_data", [])) and df["no_stock_data"].fillna(True).astype(bool).all():
        flags.append("no_stock_data")
    return DemandParams(
        entity_id=str(df["entity_id"].iloc[0]),
        baseline_v=_num(baseline, 0.0), a=max(_num(a, 0.0), 0.0), cr_ref=max(_num(cr_ref, 0.0), 0.0),
        e=min(max(_num(e, 0.0), E_MIN), E_MAX), seasonal={k: _num(v, 0.0) for k, v in seasonal.items()},
        inherited=any(f.startswith("inherited") for f in flags), fallback=fallback, ref_price=ref_price,
        mean_level=_num(mean, 0.0), n_periods=len(df), flags=flags)


# ---------------------------------------------------------------- prediction

def predict(p: DemandParams, adstock, price, size_availability, flags=None) -> dict:
    """views, cr_full, units, lost_stock, lost_price, true_demand, unexplained for one period.

    Fallback params give views and cr_full None and lost_price 0.0.
    """
    avail = min(max(_num(size_availability, 1.0), 0.0), 1.0)
    level = max(p.baseline_v + p.a * float(_ln1p([_num(adstock, 0.0)])[0]) + _season(p, flags), 0.0)
    if p.fallback:
        units, lost = level * avail, level * (1.0 - avail)
        return {"views": None, "cr_full": None, "units": units, "lost_stock": lost, "lost_price": 0.0,
                "true_demand": units + lost, "unexplained": 0.0}
    return _split(p, level, _cr_full(p, price), avail, None)


def _split(p: DemandParams, views: float, cr_full: float, avail: float, actual_units: float | None) -> dict:
    model_units = views * cr_full * avail
    units = model_units if actual_units is None else actual_units
    lost_stock = views * cr_full * (1.0 - avail)
    lost_price = views * (p.cr_ref - cr_full) * avail
    out = {"views": views, "cr_full": cr_full, "units": units, "lost_stock": lost_stock, "lost_price": lost_price,
           "true_demand": units + lost_stock, "unexplained": views * p.cr_ref - units - lost_stock - lost_price}
    return {k: _num(v, 0.0) for k, v in out.items()}


def decompose(p: DemandParams, row) -> dict:
    """The same split applied to an actual panel row (actual units, actual views when present), for reporting."""
    get = row.get if hasattr(row, "get") else (lambda k, d=None: getattr(row, k, d))
    avail = min(max(_num(get("size_availability"), 1.0), 0.0), 1.0)
    flags = {f: get(f) for f in FLAGS}
    units = _num(get("units"), 0.0)
    level = max(p.baseline_v + p.a * float(_ln1p([_num(get("adstock"), 0.0)])[0]) + _season(p, flags), 0.0)
    if p.fallback:
        lost = level * (1.0 - avail)
        return {"views": None, "cr_full": None, "units": units, "lost_stock": lost, "lost_price": 0.0,
                "true_demand": units + lost, "unexplained": _num(level - units - lost, 0.0)}
    views = _num(get("views"), level)
    return _split(p, views, _cr_full(p, get("price")), avail, units)


# ---------------------------------------------------------------- fit all entities of a level

def fit_all(conn, t: Tenant, grain: str, level: str, run_id: str) -> list[DemandParams]:
    """Fit every entity at `level`, parents first, and store one model_params row per entity.

    Rerunning the same (run_id, grain, level) replaces its rows.
    """
    if level not in LEVELS:
        raise ValueError(f"unknown level {level!r}")
    data = TenantData(conn, t)
    chain = list(reversed(LEVELS))                       # store, collection, style, product
    chain = chain[:chain.index(level) + 1]
    fitted: dict[str, dict[str, DemandParams]] = {}
    last_period: dict[str, object] = {}
    for lv in chain:
        panel = data.panel(grain, lv)
        parents = data.parent_of(lv)
        fitted[lv] = {}
        for ent, g in panel.groupby("entity_id", sort=True):
            plv, pid = parents.get(ent, ("store", STORE_ENTITY))
            parent = fitted.get(plv, {}).get(pid) or fitted.get("store", {}).get(STORE_ENTITY)
            p = fit_entity(g, parent if lv != "store" else None)
            if p is None:
                continue
            p.level, p.grain = lv, grain
            fitted[lv][ent] = p
            if lv == level:
                last_period[ent] = g["period_start"].max()

    out = list(fitted[level].values())
    conn.execute("DELETE FROM model_params WHERE tenant_id = %s AND run_id = %s AND params->>'level' = %s"
                 " AND params->>'grain' = %s", (t.tenant_id, run_id, level, grain))
    for p in out:
        conn.execute("INSERT INTO model_params (tenant_id, run_id, entity_id, period, params) VALUES (%s,%s,%s,%s,%s)",
                     (t.tenant_id, run_id, p.entity_id, last_period[p.entity_id], Jsonb(asdict(p))))
    conn.commit()
    return out
