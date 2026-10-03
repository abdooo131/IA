"""Inventory health: low stock, slow, dead, overstock, discrepancies, cancellations, unfulfilled queue."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from src.common import no_hyphen
from src.replenish.po import load_forecast


def days_to_stockout(stock: np.ndarray, F: np.ndarray) -> np.ndarray:
    """First day on which cumulative forecast demand exceeds the stock. Beyond the horizon it is extrapolated."""
    cum = np.cumsum(F, axis=1)
    H = F.shape[1]
    over = cum > stock[:, None]
    first = np.where(over.any(axis=1), over.argmax(axis=1) + 1, np.nan)
    avg = np.where(cum[:, -1] > 0, cum[:, -1] / H, np.nan)
    with np.errstate(all="ignore"):
        extra = np.where(np.isnan(first) & (avg > 0), stock / avg, np.nan)
    out = np.where(np.isnan(first), extra, first)
    out = np.where(stock <= 0, 0, out)
    return np.where(np.isnan(out), np.inf, out)


def build_health(con, settings, run_id: str, as_of: dt.date, repl: pd.DataFrame) -> dict:
    h = settings["health"]
    vids, F = load_forecast(con, run_id)
    fidx = {v: i for i, v in enumerate(vids)}
    r = repl.copy()
    rows = np.array([fidx[v] for v in r["variant_id"]])
    Fm = F[rows] if len(rows) else np.zeros((0, 1))
    shelf = np.maximum(r["on_hand"].to_numpy() - r["committed"].to_numpy(), 0)
    r["days_to_stockout"] = days_to_stockout(shelf, Fm)
    r["days_cover_position"] = days_to_stockout(np.maximum(r["position"].to_numpy(), 0), Fm)
    r["revenue_at_risk_per_day"] = r["daily_forecast_30"] * r["price"].fillna(0)

    low = r[(r["days_to_stockout"] <= h["low_stock_days"]) & ~r["is_dead"] & (r["daily_forecast_30"] > 0)].copy()
    low["cover_bought_days"] = np.where(low["daily_forecast_30"] > 0, low["order_qty"] / low["daily_forecast_30"], 0)
    low["action"] = [
        no_hyphen(f"Reorder {q} from {s}" if q > 0 else "Incoming stock covers it, chase the delivery" if inc > 0 else "Check reorder settings")
        for q, s, inc in zip(low["order_qty"], low["supplier"], low["incoming"])
    ]
    low = low.sort_values("revenue_at_risk_per_day", ascending=False)

    slow = r[r["is_slow"]].copy().sort_values("stock_value", ascending=False)
    dead = r[r["is_dead_reportable"]].copy().sort_values("stock_value", ascending=False)
    over = r[(r["days_cover_position"] > h["overstock_cover_days"]) & ~r["is_dead"] & (r["on_hand"] > 0)].copy()
    over["excess_units"] = np.maximum(
        over["position"] - over["daily_forecast_30"] * h["overstock_cover_days"], 0
    ).round()
    over["excess_value"] = over["excess_units"] * over["unit_value"].fillna(0)
    over = over.sort_values("excess_value", ascending=False)
    over_by_collection = (
        over.groupby("collection")
        .agg(SKUs=("sku", "count"), Excess_units=("excess_units", "sum"), Excess_value=("excess_value", "sum"))
        .reset_index().sort_values("Excess_value", ascending=False)
    )
    over_by_product = (
        over.groupby(["collection", "product_title"])
        .agg(SKUs=("sku", "count"), Excess_units=("excess_units", "sum"), Excess_value=("excess_value", "sum"))
        .reset_index().sort_values("Excess_value", ascending=False)
    )

    disc = con.execute("SELECT * FROM discrepancies").df()

    canc = con.execute("SELECT * FROM fact_cancellations").df()
    canc["order_date"] = pd.to_datetime(canc["order_date"]).dt.date
    c90 = canc[canc["order_date"] > as_of - dt.timedelta(days=90)]

    def canc_summary(c, label):
        return {
            "Window": label, "Orders": c["order_id"].nunique(), "Units": int(c["quantity"].sum()),
            "Value": float(c["value"].sum()),
        }

    canc_tot = pd.DataFrame([canc_summary(c90, "last 90 days"), canc_summary(canc, "all history")])
    reasons = (
        c90.groupby(c90["cancel_reason"].fillna("NOT GIVEN"))
        .agg(Orders=("order_id", "nunique"), Units=("quantity", "sum"), Value=("value", "sum"))
        .reset_index().rename(columns={"cancel_reason": "Reason"}).sort_values("Orders", ascending=False)
    )
    top_skus = (
        c90.groupby("sku", dropna=False)
        .agg(Orders=("order_id", "nunique"), Units=("quantity", "sum"), Value=("value", "sum"))
        .reset_index().sort_values("Units", ascending=False).head(25)
    )

    unf = con.execute("SELECT * FROM fact_unfulfilled").df()
    unf_sku = (
        unf.groupby(["variant_id", "sku"], dropna=False)
        .agg(Orders=("order_id", "nunique"), Units=("unfulfilled_quantity", "sum"), Oldest_days=("age_days", "max"))
        .reset_index().sort_values("Units", ascending=False)
    )
    if len(unf_sku):
        unf_sku = unf_sku.merge(r[["variant_id", "available", "on_hand"]], on="variant_id", how="left")

    return {
        "repl": r, "low": low, "slow": slow, "dead": dead, "over": over, "over_by_collection": over_by_collection,
        "over_by_product": over_by_product, "discrepancies": disc, "cancel_totals": canc_tot,
        "cancel_reasons": reasons, "cancel_top_skus": top_skus, "unfulfilled": unf_sku,
    }
