"""Per SKU stock position and selling facts shared by replenishment, health, pricing and the tracker."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd


def stock_metrics(con, settings, as_of: dt.date) -> pd.DataFrame:
    dv = con.execute("SELECT * FROM dim_variant").df()
    inv = con.execute(
        """SELECT v.variant_id, sum(l.on_hand) on_hand, sum(l.available) available, sum(l.committed) AS "committed",
                  sum(l.incoming) incoming, count(*) inv_records
           FROM raw_inventory_levels l JOIN raw_variants v ON v.inventory_item_id = l.inventory_item_id GROUP BY 1"""
    ).df()
    sales = con.execute("SELECT * FROM fact_sales_daily").df()
    sales["date"] = pd.to_datetime(sales["date"]).dt.date
    dem = con.execute(
        "SELECT variant_id, date, stockout_flag FROM fact_demand_daily WHERE date > ?", [as_of - dt.timedelta(days=90)]
    ).df()
    # Length of the stockout run still open at the as of date
    trail = con.execute(
        """WITH d AS (SELECT variant_id, date, stockout_flag FROM fact_demand_daily),
                last_in AS (SELECT variant_id, max(date) FILTER (WHERE NOT stockout_flag) AS last_in_stock,
                                   min(date) AS first_date, max(date) AS last_date FROM d GROUP BY 1)
           SELECT variant_id,
                  CASE WHEN last_in_stock IS NULL THEN date_diff('day', first_date, last_date) + 1
                       ELSE date_diff('day', last_in_stock, last_date) END AS days_out
           FROM last_in"""
    ).df().set_index("variant_id")["days_out"]

    dv["created_date"] = pd.to_datetime(dv["created_date"]).dt.date
    m = dv.merge(inv, on="variant_id", how="left")
    m["has_inventory_record"] = m["inv_records"].notna()
    for c in ("on_hand", "available", "committed", "incoming"):
        m[c] = m[c].fillna(0)
    m["on_hand"] = np.where(m["on_hand"].isna() | ((m["on_hand"] == 0) & (m["available"] != 0)),
                            m["available"] + m["committed"], m["on_hand"])
    # Committed units are already sold, so they come off the shelf stock
    m["position"] = m["on_hand"] - m["committed"] + m["incoming"]

    def window(days, col="units_gross"):
        cut = as_of - dt.timedelta(days=days)
        s = sales[(sales["date"] > cut) & (sales["date"] <= as_of)]
        return s.groupby("variant_id")[col].sum()

    for d in (7, 30, 60, 90):
        m[f"sold_{d}"] = m["variant_id"].map(window(d)).fillna(0)
    m["returned_90"] = m["variant_id"].map(window(90, "units_returned")).fillna(0)
    m["return_rate_90"] = np.where(m["sold_90"] > 0, m["returned_90"] / m["sold_90"].where(m["sold_90"] > 0, 1), np.nan)
    rev_days = int(settings["replenishment"]["abc_window_days"])
    m["revenue_net_window"] = m["variant_id"].map(window(rev_days, "revenue_net")).fillna(0)
    last_sale = sales[sales["units_gross"] > 0].groupby("variant_id")["date"].max()
    m["last_sale_date"] = m["variant_id"].map(last_sale)
    m["days_since_last_sale"] = [(as_of - d).days if isinstance(d, dt.date) else None for d in m["last_sale_date"]]

    so = dem.groupby("variant_id")["stockout_flag"].mean()
    m["stockout_share_90"] = m["variant_id"].map(so).fillna(0)
    dem = dem.sort_values(["variant_id", "date"])
    starts = dem.groupby("variant_id")["stockout_flag"].apply(lambda s: int((s.astype(int).diff().fillna(s.iloc[0]) == 1).sum()))
    m["stockout_episodes_90"] = m["variant_id"].map(starts).fillna(0).astype(int)
    m["days_out_of_stock_now"] = m["variant_id"].map(trail).fillna(0).astype(int)
    max_days = int(settings.get("cleaning", "stockout", "max_impute_days", default=90))
    m["is_long_stockout"] = m["days_out_of_stock_now"] > max_days

    m["cost_basis"] = np.where(m["unit_cost"].fillna(0) > 0, "unit cost", "price (cost missing)")
    m["unit_value"] = np.where(m["unit_cost"].fillna(0) > 0, m["unit_cost"], m["price"])
    m["stock_value"] = np.maximum(m["on_hand"], 0) * m["unit_value"].fillna(0)
    sold_90 = m["sold_90"]
    m["sell_through_90"] = np.where(sold_90 + np.maximum(m["on_hand"], 0) > 0,
                                    sold_90 / (sold_90 + np.maximum(m["on_hand"], 0)).where(sold_90 + np.maximum(m["on_hand"], 0) > 0, 1), np.nan)
    sold_30 = m["sold_30"]
    m["sell_through_30"] = np.where(sold_30 + np.maximum(m["on_hand"], 0) > 0,
                                    sold_30 / (sold_30 + np.maximum(m["on_hand"], 0)).where(sold_30 + np.maximum(m["on_hand"], 0) > 0, 1), np.nan)

    h = settings["health"]
    dead_days = int(h["dead_days"])
    dead_units = m["variant_id"].map(window(dead_days)).fillna(0)
    old_enough = [(as_of - d).days >= dead_days if isinstance(d, dt.date) else False for d in m["created_date"]]
    m["is_dead"] = (dead_units <= h["dead_max_units"]) & (m["on_hand"] > 0) & np.array(old_enough)
    m["is_dead_reportable"] = m["is_dead"] & (m["stock_value"] >= h["dead_min_value"])
    slow_days = int(h["slow_window_days"])
    slow_sold = m["variant_id"].map(window(slow_days)).fillna(0)
    slow_st = np.where(slow_sold + np.maximum(m["on_hand"], 0) > 0,
                       slow_sold / (slow_sold + np.maximum(m["on_hand"], 0)).where(slow_sold + np.maximum(m["on_hand"], 0) > 0, 1), np.nan)
    m["is_slow"] = ~m["is_dead"] & (slow_sold > 0) & (slow_st < h["slow_sell_through_target"]) & (m["on_hand"] > 0)
    return m
