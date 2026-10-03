"""Price history and price elasticity per product, falling back to collection, product type, then a default.

Weekly model per product: ln(units + 0.5) = a + e * ln(price index) + trend + event controls.
Price index is the realized selling price over the product's reference (median list) price, so both
discounts and list price changes identify e. White Friday is a control, so its event lift is not
mistaken for price response.
"""
from __future__ import annotations

import datetime as dt
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm

from src.features.calendar import build_calendar

CONTROL_EVENTS = ["ev_white_friday", "ev_eid_fitr_pre", "ev_eid_adha_pre", "ev_ramadan", "ev_valentines_pre", "ev_wedding_season"]


def price_history(con, as_of: dt.date) -> pd.DataFrame:
    """Daily realized price per variant from orders, plus list price snapshots where they exist."""
    s = con.execute(
        """SELECT date, variant_id, sum(units_gross) units, sum(revenue_gross) revenue, sum(list_value) list_value
           FROM fact_sales_daily WHERE units_gross > 0 GROUP BY 1, 2"""
    ).df()
    s["date"] = pd.to_datetime(s["date"]).dt.date
    s["realized_price"] = s["revenue"] / s["units"]
    s["list_price"] = s["list_value"] / s["units"]
    snaps = con.execute("SELECT date, variant_id, price, compare_at_price FROM fact_price_history").df()
    snaps["date"] = pd.to_datetime(snaps["date"]).dt.date
    return s.merge(snaps, on=["date", "variant_id"], how="outer").sort_values(["variant_id", "date"])


def weekly_product_panel(con, settings, as_of: dt.date) -> pd.DataFrame:
    dv = con.execute("SELECT variant_id, product_id, collection, product_type FROM dim_variant").df()
    dem = con.execute("SELECT date, variant_id, adjusted_demand FROM fact_demand_daily").df()
    sales = con.execute(
        "SELECT date, variant_id, sum(revenue_gross) revenue, sum(list_value) list_value, sum(units_gross) units "
        "FROM fact_sales_daily GROUP BY 1, 2"
    ).df()
    for d in (dem, sales):
        d["date"] = pd.to_datetime(d["date"]).dt.date
    dem = dem.merge(dv, on="variant_id")
    sales = sales.merge(dv, on="variant_id")
    start = min(dem["date"])
    week = lambda d: (as_of - d).days // 7  # 0 is the latest week  # noqa: E731
    dem["wk"] = dem["date"].map(week)
    sales["wk"] = sales["date"].map(week)
    units = dem.groupby(["product_id", "wk"])["adjusted_demand"].sum().rename("units")
    rev = sales.groupby(["product_id", "wk"])[["revenue", "list_value", "units"]].sum()
    rev["asp"] = rev["revenue"] / rev["units"].where(rev["units"] > 0)
    sales["unit_list"] = sales["list_value"] / sales["units"].where(sales["units"] > 0)
    ref = sales.groupby("product_id")["unit_list"].median().rename("ref_price")
    panel = units.to_frame().join(rev[["asp"]], how="left").reset_index()
    panel = panel.merge(ref, left_on="product_id", right_index=True, how="left")
    panel["price_index"] = panel["asp"] / panel["ref_price"]
    panel = panel.merge(dv.drop_duplicates("product_id")[["product_id", "collection", "product_type"]], on="product_id")

    cal = build_calendar(settings, start, as_of)
    cal["wk"] = cal["date"].map(week)
    ev = cal.groupby("wk")[CONTROL_EVENTS].sum().reset_index()
    panel = panel.merge(ev, on="wk", how="left").fillna({c: 0 for c in CONTROL_EVENTS})
    days = cal.groupby("wk").size().rename("days").reset_index()
    panel = panel.merge(days, on="wk")
    return panel[(panel["days"] == 7) & panel["price_index"].between(0.3, 2.0)]


def _fit(df: pd.DataFrame, fixed_effects: bool) -> tuple[float, float, int] | None:
    y = np.log(df["units"] + 0.5)
    X = pd.DataFrame({"lnp": np.log(df["price_index"]), "trend": -df["wk"] / 52.0})
    for c in CONTROL_EVENTS:
        if df[c].std() > 0:
            X[c] = df[c] / 7.0
    if fixed_effects and df["product_id"].nunique() > 1:
        X = pd.concat([X, pd.get_dummies(df["product_id"], prefix="p", drop_first=True, dtype=float)], axis=1)
    X = sm.add_constant(X, has_constant="add")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            fit = sm.OLS(y, X.astype(float)).fit()
        except Exception:
            return None
    return float(fit.params["lnp"]), float(fit.bse["lnp"]), int(len(df))


def estimate(con, settings, as_of: dt.date) -> pd.DataFrame:
    """One row per product: elasticity, its level of estimation, confidence and a plain reason."""
    p = settings["pricing"]
    lo, hi = p["elasticity_bounds"]
    disc_ratio = p["discount_week_ratio"]
    min_disc = p["min_discount_weeks"]
    panel = weekly_product_panel(con, settings, as_of)
    panel["discounted"] = (panel["price_index"] < disc_ratio) & (panel["ev_white_friday"] == 0)

    def attempt(df, fe):
        if df["discounted"].sum() < min_disc or (~df["discounted"]).sum() < 8:
            return None
        r = _fit(df, fe)
        if r is None:
            return None
        e, se, n = r
        if not (e < 0 and se > 0 and abs(e / se) >= 1.65):
            return None
        return float(np.clip(e, lo, hi)), se, n, int(df["discounted"].sum())

    cache = {}
    rows = []
    for pid, g in panel.groupby("product_id"):
        res = attempt(g, False)
        level = "product"
        if res is None:
            coll = g["collection"].iloc[0]
            key = ("collection", coll)
            if key not in cache:
                cache[key] = attempt(panel[panel["collection"] == coll], True)
            res, level = cache[key], "collection"
        if res is None:
            pt = g["product_type"].iloc[0]
            key = ("type", pt)
            if key not in cache:
                cache[key] = attempt(panel[panel["product_type"] == pt], True)
            res, level = cache[key], "product type"
        if res is None:
            rows.append({"product_id": pid, "elasticity": p["default_elasticity"], "level": "default",
                         "confidence": "low", "std_error": None, "weeks": len(g), "discount_weeks": int(g["discounted"].sum()),
                         "reason": "Not enough clean price changes, using the default elasticity"})
            continue
        e, se, n, nd = res
        conf = "high" if level == "product" and se < 0.4 and nd >= 6 else "medium" if level != "default" and se < 0.8 else "low"
        rows.append({"product_id": pid, "elasticity": e, "level": level, "confidence": conf, "std_error": se,
                     "weeks": n, "discount_weeks": nd,
                     "reason": f"Estimated at {level} level from {n} weeks, {nd} of them discounted"})
    return pd.DataFrame(rows)


def markdown_episodes(con, as_of: dt.date, min_depth: float = 0.1, min_days: int = 5) -> pd.DataFrame:
    """Past markdowns per product: depth, length and the sales lift versus the 28 days before."""
    dv = con.execute("SELECT variant_id, product_id FROM dim_variant").df()
    s = con.execute(
        "SELECT date, variant_id, units_gross, revenue_gross, list_value FROM fact_sales_daily"
    ).df().merge(dv, on="variant_id")
    s["date"] = pd.to_datetime(s["date"]).dt.date
    d = s.groupby(["product_id", "date"])[["units_gross", "revenue_gross", "list_value"]].sum().reset_index()
    d["depth"] = 1 - d["revenue_gross"] / d["list_value"].where(d["list_value"] > 0)
    out = []
    for pid, g in d.groupby("product_id"):
        g = g.set_index("date").sort_index()
        full = pd.date_range(g.index.min(), as_of).date
        g = g.reindex(full)
        units = g["units_gross"].fillna(0).to_numpy()
        depth = g["depth"].to_numpy()
        on = np.nan_to_num(depth, nan=0) >= min_depth
        i = 0
        while i < len(on):
            if on[i]:
                j = i
                gap = 0
                while j + 1 < len(on) and (on[j + 1] or (np.isnan(depth[j + 1]) and gap < 2)):
                    gap = gap + 1 if not on[j + 1] else 0
                    j += 1
                if j - i + 1 >= min_days and i >= 28:
                    before = units[i - 28 : i].mean()
                    during = units[i : j + 1].mean()
                    out.append({
                        "product_id": pid, "start": full[i], "end": full[j], "days": j - i + 1,
                        "depth": float(np.nanmean(depth[i : j + 1])), "units_per_day_before": float(before),
                        "units_per_day_during": float(during),
                        "lift": float(during / before) if before > 0 else None,
                    })
                i = j + 1
            else:
                i += 1
    return pd.DataFrame(out)
