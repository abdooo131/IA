"""Data and process discrepancy checks. Every finding says whether it is a data problem or a process problem."""
from __future__ import annotations

import pandas as pd

DATA = "data problem"
PROCESS = "process problem"


def _row(kind, variant_id, sku, detail, problem, severity, units=None):
    return {
        "type": kind,
        "variant_id": variant_id,
        "sku": sku,
        "detail": detail,
        "problem_kind": problem,
        "severity": severity,
        "units": units,
    }


def run_checks(
    dim_variant: pd.DataFrame,
    lines: pd.DataFrame,
    sales_daily: pd.DataFrame,
    snapshots: pd.DataFrame,
    inv_levels: pd.DataFrame,
    as_of,
) -> pd.DataFrame:
    out = []
    active = dim_variant[dim_variant["active"]]

    # Duplicate SKUs
    dup = active[active["sku"].notna()].groupby("sku")["variant_id"].apply(list)
    for sku, vids in dup[dup.map(len) > 1].items():
        for vid in vids:
            out.append(_row("duplicate sku", vid, sku, f"SKU used by {len(vids)} active variants", DATA, "high"))

    # Variants without SKU
    for _, r in active[active["sku"].isna() | (active["sku"].astype(str).str.strip() == "")].iterrows():
        out.append(
            _row("variant without sku", r["variant_id"], None,
                 f"{r['product_title']} {r['color']} {r['size']} has no SKU in Shopify", DATA, "medium")
        )

    # Broken variant mapping on order lines
    if not lines.empty:
        broken = lines[lines["variant_id"].isna() & ~lines["remapped"]]
        for sku, g in broken.groupby(broken["sku"].fillna("NO SKU")):
            out.append(
                _row("broken variant mapping", None, sku,
                     f"{len(g)} order lines with no matching variant, excluded from demand",
                     DATA, "medium", int(g["quantity"].sum()))
            )
        remapped = lines[lines["remapped"]]
        for sku, g in remapped.groupby("sku"):
            out.append(
                _row("variant remapped by sku", g["variant_id_mapped"].iloc[0], sku,
                     f"{len(g)} order lines pointed at a deleted variant, matched by SKU", DATA, "low",
                     int(g["quantity"].sum()))
            )

    # Sales on SKUs with no inventory record
    with_inv = set(inv_levels["inventory_item_id"].dropna()) if not inv_levels.empty else set()
    recent = sales_daily[pd.to_datetime(sales_daily["date"]) > pd.Timestamp(as_of) - pd.Timedelta(days=90)]
    sold = set(recent.loc[recent["units_gross"] > 0, "variant_id"])
    for _, r in dim_variant[dim_variant["variant_id"].isin(sold)].iterrows():
        if r["inventory_item_id"] not in with_inv:
            out.append(
                _row("sales with no inventory record", r["variant_id"], r["sku"],
                     "Sold in the last 90 days but Shopify has no inventory level for it", DATA, "high")
            )

    # Negative stock in the latest snapshot
    if not snapshots.empty:
        last = snapshots[snapshots["date"] == snapshots["date"].max()]
        neg = last.groupby("variant_id")[["available", "on_hand"]].sum()
        neg = neg[(neg["available"] < 0) | (neg["on_hand"] < 0)]
        sku_map = dim_variant.set_index("variant_id")["sku"]
        for vid, r in neg.iterrows():
            out.append(
                _row("negative stock", vid, sku_map.get(vid),
                     f"Available {int(r['available'])}, on hand {int(r['on_hand'])}. Oversold or a receipt was not recorded",
                     PROCESS, "high")
            )

        # Units sold versus stock decrements between consecutive daily snapshots
        snap = snapshots.groupby(["variant_id", "date"])[["on_hand", "incoming"]].sum().reset_index()
        snap = snap.sort_values(["variant_id", "date"])
        snap["prev_on_hand"] = snap.groupby("variant_id")["on_hand"].shift()
        snap["prev_date"] = snap.groupby("variant_id")["date"].shift()
        snap = snap[snap["prev_date"].notna()]
        snap = snap[(pd.to_datetime(snap["date"]) - pd.to_datetime(snap["prev_date"])).dt.days == 1]
        units = sales_daily.groupby(["variant_id", "date"])["units_gross"].sum()
        snap["sold"] = [units.get((v, d), 0) for v, d in zip(snap["variant_id"], snap["date"])]
        snap["drop"] = snap["prev_on_hand"] - snap["on_hand"]
        bad = snap[snap["drop"] > snap["sold"] + 2]
        sku_map = dim_variant.set_index("variant_id")["sku"]
        for vid, g in bad.groupby("variant_id"):
            unexplained = int((g["drop"] - g["sold"]).sum())
            out.append(
                _row("stock drop larger than sales", vid, sku_map.get(vid),
                     f"{len(g)} days where on hand fell more than units sold, {unexplained} units unexplained. "
                     "Check manual adjustments, damages or shrinkage",
                     PROCESS, "medium", unexplained)
            )

    # Missing unit cost on active variants
    no_cost = active[active["unit_cost"].isna() | (active["unit_cost"] <= 0)]
    if len(no_cost):
        for _, r in no_cost.iterrows():
            out.append(
                _row("missing unit cost", r["variant_id"], r["sku"],
                     "No unit cost in Shopify, PO and dead stock values fall back to price", DATA, "low")
            )

    # Zero price lines on real orders
    if not lines.empty and "valid" in lines:
        zero = lines[lines["valid"] & (lines["discounted_unit_price"].fillna(0) <= 0) & lines["variant_id"].notna()]
        for vid, g in zero.groupby("variant_id"):
            out.append(
                _row("zero price sale", vid, g["sku"].iloc[0],
                     f"{len(g)} order lines sold at zero price on non test orders. Gift or manual order without a tag",
                     PROCESS, "low", int(g["quantity"].sum()))
            )

    cols = ["type", "variant_id", "sku", "detail", "problem_kind", "severity", "units"]
    return pd.DataFrame(out, columns=cols)
