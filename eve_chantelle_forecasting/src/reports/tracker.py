"""Merchandise tracker (the mirch file), regenerated from Shopify data on every run."""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.common import no_hyphen


def status_and_action(row, settings, md_pct=None, markup_pct=None) -> tuple[str, str]:
    """One alert status and one recommended action per SKU."""
    h = settings["health"]
    if row["is_dead"]:
        return "Dead stock", (f"Mark down {md_pct:.0f} percent, no reorder" if md_pct else "Clear or bundle, no reorder")
    if row["days_to_stockout"] <= h["low_stock_days"] and row["daily_forecast_30"] > 0:
        return "Low stock", (f"Reorder {int(row['order_qty'])}" if row["order_qty"] > 0 else "Chase incoming stock")
    if row["order_qty"] > 0:
        return "At reorder point", f"Reorder {int(row['order_qty'])}"
    if row["days_cover_position"] > h["overstock_cover_days"]:
        return "Overstock", (f"Mark down {md_pct:.0f} percent" if md_pct else "Hold buying")
    if row["is_slow"]:
        return "Slow stock", (f"Mark down {md_pct:.0f} percent" if md_pct else "Watch")
    if markup_pct:
        return "Healthy", f"Consider markup {markup_pct:.0f} percent"
    return "Healthy", "Hold"


def build(health: dict, md: pd.DataFrame, mu: pd.DataFrame, settings) -> dict:
    r = health["repl"].copy()
    md_map = md.set_index("variant_id")["markdown_pct"].to_dict() if len(md) else {}
    mu_map = mu.set_index("variant_id")["markup_pct"].to_dict() if len(mu) else {}
    sa = [status_and_action(x, settings, md_map.get(x["variant_id"]), mu_map.get(x["variant_id"])) for _, x in r.iterrows()]
    r["alert_status"] = [s for s, _ in sa]
    r["recommended_action"] = [no_hyphen(a) for _, a in sa]
    r["days_of_cover"] = r["days_cover_position"].replace(np.inf, np.nan).round(0)
    cols = {
        "product_title": "Product", "sku": "SKU", "color": "Color", "size": "Size", "collection": "Collection",
        "product_type": "Product type", "supplier": "Supplier", "price": "Price", "on_hand": "On hand",
        "available": "Available", "committed": "Committed", "incoming": "Incoming", "sold_7": "Sold 7 days",
        "sold_30": "Sold 30 days", "sold_90": "Sold 90 days", "sell_through_30": "Sell through 30 days",
        "sell_through_90": "Sell through 90 days", "return_rate_90": "Return rate 90 days", "days_of_cover": "Days of cover",
        "forecast_4w": "Forecast next 4 weeks", "forecast_8w": "Forecast next 8 weeks", "abc": "ABC", "xyz": "XYZ",
        "demand_class": "Demand class", "confidence": "Forecast confidence", "alert_status": "Alert status",
        "recommended_action": "Recommended action", "stock_value": "Stock value",
    }
    sku = r.sort_values(["collection", "product_title", "color", "size"])[list(cols)].rename(columns=cols)
    prod = (
        r.groupby(["collection", "product_title"])
        .agg(SKUs=("sku", "count"), On_hand=("on_hand", "sum"), Incoming=("incoming", "sum"), Sold_30=("sold_30", "sum"),
             Sold_90=("sold_90", "sum"), Forecast_4w=("forecast_4w", "sum"), Forecast_8w=("forecast_8w", "sum"),
             Stock_value=("stock_value", "sum"), Low_stock_SKUs=("alert_status", lambda s: int((s == "Low stock").sum())),
             Reorder_units=("order_qty", "sum"))
        .reset_index()
    )
    with np.errstate(all="ignore"):
        prod["Sell_through_90"] = prod["Sold_90"] / (prod["Sold_90"] + prod["On_hand"].clip(lower=0))
        prod["Days_of_cover"] = (prod["On_hand"] + prod["Incoming"]) / (prod["Forecast_4w"] / 28)
    prod = prod.rename(columns={"collection": "Collection", "product_title": "Product"})
    status = r["alert_status"].value_counts().rename_axis("Alert status").reset_index(name="SKUs")
    return {"By SKU": sku, "By product": prod, "Status counts": status}
