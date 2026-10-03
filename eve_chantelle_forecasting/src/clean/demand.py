"""Clean layer builder: exclusions, cancellations, returns, daily sales, promo flags, outlier caps,
stockout adjustment, size curves and the discrepancy report."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from src import db
from src.clean import discrepancies, outliers, stockouts
from src.clean.dims import build_dims
from src.config import parse_date
from src.features.calendar import build_calendar

SOURCE_NAMES = {0: "", 1: "snapshot", 2: "current_stock", 3: "inferred"}


def resolve_as_of(con, settings) -> dt.date:
    cfg = settings.get("forecast", "as_of", default="auto")
    if cfg and str(cfg).lower() != "auto":
        return parse_date(cfg)
    tz = settings["store"]["timezone"]
    row = con.execute("SELECT last_synced_at FROM sync_state WHERE entity = 'orders'").fetchone()
    if row and row[0] is not None:
        return pd.Timestamp(row[0]).tz_localize("UTC").tz_convert(tz).date() - dt.timedelta(days=1)
    row = con.execute("SELECT max(processed_at) FROM raw_orders").fetchone()
    if row and row[0] is not None:
        return pd.Timestamp(row[0]).tz_localize("UTC").tz_convert(tz).date()
    raise RuntimeError("No orders in the warehouse. Run python main.py sync first.")


def _local_date(ts: pd.Series, tz: str) -> pd.Series:
    return pd.to_datetime(ts).dt.tz_localize("UTC").dt.tz_convert(tz).dt.date


def prepare_lines(con, settings, dim_variant: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    tz = settings["store"]["timezone"]
    orders = con.execute("SELECT * FROM raw_orders").df()
    lines = con.execute("SELECT * FROM raw_line_items").df()
    refunds = con.execute("SELECT * FROM raw_refunds").df()

    exclude_tags = {t.lower() for t in settings.get("cleaning", "exclude_order_tags", default=[])}
    tag_sets = orders["tags"].fillna("").map(lambda s: {t.strip().lower() for t in s.split(",") if t.strip()})
    orders["order_date"] = _local_date(orders["processed_at"], tz)
    orders["cancelled_date"] = _local_date(orders["cancelled_at"], tz)
    orders["excluded_test"] = orders["is_test"].fillna(False) | tag_sets.map(lambda s: bool(s & exclude_tags))
    orders["excluded_zero"] = (
        bool(settings.get("cleaning", "exclude_zero_value_orders", default=True))
        & (orders["total_price"].fillna(-1) == 0)
        & ~orders["excluded_test"]
    )
    orders["cancelled"] = orders["cancelled_at"].notna()

    lines = lines.merge(
        orders[["order_id", "name", "order_date", "cancelled_date", "cancel_reason", "cancelled",
                 "excluded_test", "excluded_zero", "location_id"]],
        on="order_id", how="left",
    )

    # Repair lines whose variant was deleted when the SKU still matches exactly one variant
    known = set(dim_variant["variant_id"])
    sku_counts = dim_variant[dim_variant["sku"].notna()].groupby("sku")["variant_id"].agg(list)
    unique_sku = {s: v[0] for s, v in sku_counts.items() if len(v) == 1}
    missing = lines["variant_id"].isna() | ~lines["variant_id"].isin(known)
    lines["variant_id_mapped"] = lines["variant_id"].where(~missing, lines["sku"].map(unique_sku))
    lines["remapped"] = missing & lines["variant_id_mapped"].notna()
    lines.loc[missing & lines["variant_id_mapped"].isna(), "variant_id"] = None

    if not refunds.empty:
        ref = refunds.groupby("line_item_id").agg(refunded=("quantity", "sum"), refund_value=("subtotal", "sum"))
        lines = lines.merge(ref, left_on="line_item_id", right_index=True, how="left")
    else:
        lines["refunded"] = 0
        lines["refund_value"] = 0.0
    lines["refunded"] = lines["refunded"].fillna(0)
    lines["refund_value"] = lines["refund_value"].fillna(0)
    cur = lines["current_quantity"].fillna(lines["quantity"])
    # Gross units: quantity minus units removed by order edits. Refunds are added back because they are returns.
    lines["gross_units"] = np.clip(cur + lines["refunded"], 0, lines["quantity"])
    lines["returned_units"] = np.minimum(lines["refunded"], lines["gross_units"])
    lines["discounted_unit_price"] = lines["discounted_unit_price"].fillna(lines["original_unit_price"])
    lines["valid"] = (
        ~lines["cancelled"].fillna(False)
        & ~lines["excluded_test"].fillna(False)
        & ~lines["excluded_zero"].fillna(False)
        & lines["variant_id_mapped"].notna()
    )
    locs = con.execute("SELECT location_id FROM raw_locations WHERE is_active ORDER BY location_id").fetchall()
    default_loc = locs[0][0] if locs else "online"
    lines["location_id"] = lines["location_id"].fillna(default_loc)

    stats = {
        "orders_total": int(len(orders)),
        "orders_cancelled": int(orders["cancelled"].sum()),
        "orders_excluded_test_or_internal": int(orders["excluded_test"].sum()),
        "orders_excluded_zero_value": int(orders["excluded_zero"].sum()),
        "lines_broken_mapping": int((lines["variant_id_mapped"].isna()).sum()),
        "lines_remapped_by_sku": int(lines["remapped"].sum()),
    }
    return lines, stats


def build_sales_daily(lines: pd.DataFrame, as_of: dt.date) -> pd.DataFrame:
    v = lines[lines["valid"] & (lines["order_date"] <= as_of)].copy()
    v["revenue_gross"] = v["discounted_unit_price"] * v["gross_units"]
    v["list_value"] = v["original_unit_price"].fillna(v["discounted_unit_price"]) * v["gross_units"]
    v["refund_value"] = np.where(
        v["refund_value"] > 0, v["refund_value"], v["discounted_unit_price"] * v["returned_units"]
    )
    g = (
        v.groupby(["order_date", "variant_id_mapped", "location_id"])
        .agg(
            units_gross=("gross_units", "sum"),
            units_returned=("returned_units", "sum"),
            revenue_gross=("revenue_gross", "sum"),
            refund_value=("refund_value", "sum"),
            list_value=("list_value", "sum"),
        )
        .reset_index()
        .rename(columns={"order_date": "date", "variant_id_mapped": "variant_id"})
    )
    c = lines[lines["cancelled"].fillna(False) & ~lines["excluded_test"].fillna(False) & lines["variant_id_mapped"].notna()]
    c = (
        c[c["order_date"] <= as_of]
        .groupby(["order_date", "variant_id_mapped", "location_id"])["quantity"].sum()
        .rename("units_cancelled").reset_index()
        .rename(columns={"order_date": "date", "variant_id_mapped": "variant_id"})
    )
    s = g.merge(c, on=["date", "variant_id", "location_id"], how="outer")
    for col in ("units_gross", "units_returned", "revenue_gross", "refund_value", "list_value", "units_cancelled"):
        s[col] = s[col].fillna(0)
    s["units_net"] = s["units_gross"] - s["units_returned"]
    s["revenue_net"] = s["revenue_gross"] - s["refund_value"]
    s["avg_selling_price"] = np.where(s["units_gross"] > 0, s["revenue_gross"] / s["units_gross"].where(s["units_gross"] > 0, 1), np.nan)
    s["discount_depth"] = np.where(s["list_value"] > 0, 1 - s["revenue_gross"] / s["list_value"].where(s["list_value"] > 0, 1), 0.0)
    cols = ["date", "variant_id", "location_id", "units_gross", "units_cancelled", "units_returned", "units_net",
            "revenue_gross", "revenue_net", "list_value", "avg_selling_price", "discount_depth"]
    return s[cols].sort_values(["variant_id", "date", "location_id"]).reset_index(drop=True)


def build_cancellations(lines: pd.DataFrame) -> pd.DataFrame:
    c = lines[lines["cancelled"].fillna(False) & ~lines["excluded_test"].fillna(False)].copy()
    c["value"] = c["discounted_unit_price"].fillna(0) * c["quantity"]
    c = c.rename(columns={"name": "order_name", "variant_id_mapped": "variant_id_final"})
    return c[["order_id", "order_name", "order_date", "cancelled_date", "cancel_reason", "variant_id_final", "sku",
              "quantity", "value"]].rename(columns={"variant_id_final": "variant_id"})


def build_unfulfilled(lines: pd.DataFrame, as_of: dt.date) -> pd.DataFrame:
    u = lines[lines["valid"] & (lines["unfulfilled_quantity"].fillna(0) > 0)].copy()
    u["age_days"] = [(as_of - d).days if d else None for d in u["order_date"]]
    u = u.rename(columns={"name": "order_name"})
    return u[["order_id", "order_name", "order_date", "variant_id_mapped", "sku", "unfulfilled_quantity", "age_days"]].rename(
        columns={"variant_id_mapped": "variant_id"}
    )


def build_demand(con, settings, ctx, dim_variant, sales, as_of):
    """Daily demand matrix, promo flags, outlier caps, stockout detection and adjustment."""
    cl = settings["cleaning"]
    tz = settings["store"]["timezone"]
    sales_v = sales.groupby(["variant_id", "date"]).agg(
        units=("units_gross", "sum"), revenue=("revenue_gross", "sum"), list_value=("list_value", "sum")
    ).reset_index()
    first_sale = sales_v[sales_v["units"] > 0].groupby("variant_id")["date"].min()
    global_start = min(first_sale.min(), as_of) if len(first_sale) else as_of - dt.timedelta(days=365)

    dv = dim_variant[dim_variant["variant_id"].isin(first_sale.index) | dim_variant["active"]].copy()
    dv = dv.sort_values(["product_id", "variant_id"]).reset_index(drop=True)
    dates = pd.date_range(global_start, as_of, freq="D").date
    t_count, v_count = len(dates), len(dv)
    d_index = {d: i for i, d in enumerate(dates)}
    v_index = {v: i for i, v in enumerate(dv["variant_id"])}
    product_idx, product_keys = pd.factorize(dv["product_id"])

    start_dates = [
        min([d for d in (first_sale.get(v), c) if d is not None and not pd.isna(d)], default=as_of)
        for v, c in zip(dv["variant_id"], dv["created_date"])
    ]
    start_idx = np.array([d_index.get(max(d, global_start), 0) if d <= as_of else t_count for d in start_dates])
    valid = np.arange(t_count)[None, :] >= start_idx[:, None]

    obs = np.zeros((v_count, t_count))
    rev = np.zeros((v_count, t_count))
    lst = np.zeros((v_count, t_count))
    sv = sales_v[sales_v["variant_id"].isin(v_index) & (sales_v["date"] >= global_start)]
    vi = sv["variant_id"].map(v_index).to_numpy()
    ti = sv["date"].map(d_index).to_numpy()
    obs[vi, ti] = sv["units"].to_numpy()
    rev[vi, ti] = sv["revenue"].to_numpy()
    lst[vi, ti] = sv["list_value"].to_numpy()

    # Promo flags: variant discount depth, promo events, or a store wide discount day
    thr = float(cl.get("promo_discount_threshold", 0.15))
    depth = np.where(lst > 0, 1 - rev / np.where(lst > 0, lst, 1), 0.0)
    cal = build_calendar(settings, global_start, as_of)
    event_promo = cal["event_promo"].to_numpy().astype(bool)
    store_units = obs.sum(axis=0)
    store_depth = np.where(lst.sum(axis=0) > 0, 1 - rev.sum(axis=0) / np.maximum(lst.sum(axis=0), 1e-9), 0)
    store_promo = (store_depth >= thr) & (store_units >= cl.get("store_promo_min_units", 10))
    promo = ((depth >= thr) & (obs > 0)) | event_promo[None, :] | store_promo[None, :]
    promo &= valid

    capped, cap_mask, cap_thr = outliers.cap_outliers(
        obs, valid, promo, float(cl.get("outlier_k", 5)), float(cl.get("outlier_min_cap_units", 5))
    )
    cap_rows = np.argwhere(cap_mask)
    cap_log = pd.DataFrame(
        {
            "run_id": ctx.run_id,
            "date": [dates[t] for _, t in cap_rows],
            "variant_id": [dv["variant_id"].iat[v] for v, _ in cap_rows],
            "original": [obs[v, t] for v, t in cap_rows],
            "capped": [capped[v, t] for v, t in cap_rows],
            "threshold": [cap_thr[v] for v, _ in cap_rows],
        }
    )

    snaps = con.execute(
        "SELECT date, variant_id, sum(available) AS available FROM fact_inventory_snapshot GROUP BY 1, 2"
    ).df()
    avail = np.full((v_count, t_count), np.nan)
    if not snaps.empty:
        snaps["date"] = pd.to_datetime(snaps["date"]).dt.date
        snaps = snaps[snaps["variant_id"].isin(v_index) & snaps["date"].isin(d_index)]
        avail[snaps["variant_id"].map(v_index).to_numpy(), snaps["date"].map(d_index).to_numpy()] = snaps["available"].to_numpy()
    cur = con.execute(
        """SELECT v.variant_id, sum(l.available) AS available FROM raw_inventory_levels l
           JOIN raw_variants v ON v.inventory_item_id = l.inventory_item_id GROUP BY 1"""
    ).df().set_index("variant_id")["available"]
    current_avail = np.array([cur.get(v, 1) for v in dv["variant_id"]], dtype=float)

    so_cfg = cl.get("stockout", {})
    stockout, source = stockouts.detect(capped, valid, avail, current_avail, product_idx, so_cfg)
    shares = stockouts.size_shares(capped, valid, stockout, product_idx, int(cl.get("size_curve_window_days", 180)))
    adjusted, est = stockouts.adjust(capped, valid, stockout, product_idx, shares, so_cfg)

    run = stockouts.run_lengths(stockout)
    max_days = int(so_cfg.get("max_impute_days", 90))
    long_out = pd.DataFrame({
        "variant_id": dv["variant_id"], "sku": dv["sku"], "active": dv["active"], "days_out": run[:, -1],
    })
    long_out = long_out[long_out["active"] & (long_out["days_out"] > max_days)]
    vv, tt = np.nonzero(valid)
    demand = pd.DataFrame(
        {
            "date": np.array(dates)[tt],
            "variant_id": dv["variant_id"].to_numpy()[vv],
            "observed_demand": obs[vv, tt],
            "capped_demand": capped[vv, tt],
            "stockout_flag": stockout[vv, tt],
            "stockout_source": [SOURCE_NAMES[s] for s in source[vv, tt]],
            "promo_flag": promo[vv, tt],
            "outlier_capped": cap_mask[vv, tt],
            "adjusted_demand": adjusted[vv, tt],
        }
    )
    curves = pd.DataFrame(
        {
            "variant_id": dv["variant_id"],
            "product_id": dv["product_id"],
            "color": dv["color"],
            "size": dv["size"],
            "share": shares,
        }
    )
    stats = {
        "variants_in_demand_grid": int(v_count),
        "history_start": global_start,
        "days": int(t_count),
        "stockout_days_snapshot": int((source == 1).sum()),
        "stockout_days_current_stock": int((source == 2).sum()),
        "stockout_days_inferred": int((source == 3).sum()),
        "units_added_by_stockout_adjustment": float((adjusted - capped)[stockout].sum()),
        "outlier_caps": int(cap_mask.sum()),
        "promo_variant_days": int(promo.sum()),
    }
    stats["long_stockouts"] = long_out
    return demand, curves, cap_log, stats


def build_clean_layer(con, settings, ctx) -> dict:
    as_of = resolve_as_of(con, settings)
    dim_product, dim_variant = build_dims(con, settings)
    lines, line_stats = prepare_lines(con, settings, dim_variant)
    sales = build_sales_daily(lines, as_of)
    cancellations = build_cancellations(lines)
    unfulfilled = build_unfulfilled(lines, as_of)
    demand, curves, cap_log, dstats = build_demand(con, settings, ctx, dim_variant, sales, as_of)

    snaps = con.execute("SELECT * FROM fact_inventory_snapshot").df()
    if not snaps.empty:
        snaps["date"] = pd.to_datetime(snaps["date"]).dt.date
    inv_levels = con.execute("SELECT * FROM raw_inventory_levels").df()
    disc = discrepancies.run_checks(dim_variant, lines, sales, snaps, inv_levels, as_of)
    long_out = dstats.pop("long_stockouts")
    if len(long_out):
        extra = pd.DataFrame({
            "type": "long stockout", "variant_id": long_out["variant_id"], "sku": long_out["sku"],
            "detail": [f"Active but out of stock for {d} days. Demand is no longer imputed. Archive it or restock it"
                       for d in long_out["days_out"]],
            "problem_kind": discrepancies.PROCESS, "severity": "medium", "units": None,
        })
        disc = pd.concat([d for d in (disc, extra) if len(d)], ignore_index=True)
    dstats["long_stockout_skus"] = int(len(long_out))
    disc.insert(0, "run_id", ctx.run_id)

    db.replace_table(con, "dim_product", dim_product)
    db.replace_table(con, "dim_variant", dim_variant)
    db.replace_table(con, "fact_sales_daily", sales)
    db.replace_table(con, "fact_cancellations", cancellations)
    db.replace_table(con, "fact_unfulfilled", unfulfilled)
    db.replace_table(con, "fact_demand_daily", demand)
    db.replace_table(con, "size_curves", curves)
    db.replace_table(con, "discrepancies", disc)
    db.append(con, "cap_log", cap_log)

    if not dim_variant["supplier_confirmed"].all():
        unconfirmed = sorted(dim_variant.loc[~dim_variant["supplier_confirmed"], "supplier"].unique())
        ctx.warn(
            "Lead time, MOQ and pack size are not confirmed for: " + ", ".join(unconfirmed)
            + ". Using config placeholders, pack of 6 by default. Please confirm in config/suppliers.yaml."
        )
    unassigned = dim_variant[dim_variant["active"] & ~dim_variant["supplier_known"]]
    if len(unassigned):
        ctx.warn(f"{len(unassigned)} active variants have no supplier rule and fall back to {unassigned['supplier'].iloc[0]}.")
    return {"as_of": as_of, **line_stats, **dstats, "discrepancies": int(len(disc)), "cancelled_lines": int(len(cancellations))}
