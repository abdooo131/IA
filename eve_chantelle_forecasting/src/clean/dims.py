"""dim_product and dim_variant: options parsed into color and size, supplier master applied."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

COLOR_NAMES = {"color", "colour", "لون", "اللون"}
SIZE_NAMES = {"size", "مقاس", "المقاس"}
BAND_NAMES = {"band", "band size"}
CUP_NAMES = {"cup", "cup size"}
# Collections that say nothing about the merchandise, skipped when choosing the main collection
GENERIC_COLLECTIONS = {"all", "all products", "home page", "frontpage", "new arrivals", "sale", "best sellers", "shop all"}


def parse_options(options_json: str) -> tuple[str | None, str | None]:
    try:
        opts = json.loads(options_json or "[]")
    except json.JSONDecodeError:
        return None, None
    color = size = band = cup = None
    for o in opts:
        name = str(o.get("name", "")).strip().lower()
        val = str(o.get("value", "")).strip()
        if name in COLOR_NAMES:
            color = val.upper()
        elif name in SIZE_NAMES:
            size = val.upper()
        elif name in BAND_NAMES:
            band = val.upper()
        elif name in CUP_NAMES:
            cup = val.upper()
    if size is None and (band or cup):
        size = f"{band or ''}{cup or ''}"
    return color, size


def main_collection(collections: str) -> str:
    items = [c for c in (collections or "").split("|") if c]
    for c in items:
        if c.strip().lower() not in GENERIC_COLLECTIONS:
            return c
    return items[0] if items else "NO COLLECTION"


def _match(rule: dict, row: pd.Series) -> bool:
    kind, value = rule.get("match"), str(rule.get("value", ""))
    v = value.lower()
    if kind == "vendor":
        return str(row.get("vendor") or "").lower() == v
    if kind == "product_type":
        return str(row.get("product_type") or "").lower() == v
    if kind == "sku_prefix":
        return str(row.get("sku") or "").lower().startswith(v)
    if kind == "title_contains":
        return v in str(row.get("product_title") or "").lower()
    if kind == "tag":
        return v in [t.strip().lower() for t in str(row.get("tags") or "").split(",")]
    if kind == "collection":
        return v in [c.strip().lower() for c in str(row.get("collections_all") or "").split("|")]
    return False


def apply_suppliers(dv: pd.DataFrame, suppliers_cfg: dict) -> pd.DataFrame:
    defaults = suppliers_cfg.get("defaults") or {}
    sups = suppliers_cfg.get("suppliers") or {}
    rules = suppliers_cfg.get("rules") or []
    overrides = suppliers_cfg.get("sku_overrides") or {}
    fallback = suppliers_cfg.get("fallback_supplier", "UNASSIGNED")
    out = []
    for _, row in dv.iterrows():
        supplier = fallback
        for rule in rules:
            if _match(rule, row):
                supplier = rule["supplier"]
                break
        ov = overrides.get(row.get("sku")) or {}
        supplier = ov.get("supplier", supplier)
        sc = {**defaults, **(sups.get(supplier) or {}), **ov}
        out.append(
            {
                "supplier": supplier,
                "pack_size": int(sc.get("pack_size", 6)),
                "moq": int(sc.get("moq_units", sc.get("pack_size", 6))),
                "lead_time_days": int(sc.get("lead_time_days", 30)),
                "currency": sc.get("currency", "EGP"),
                "supplier_confirmed": bool(sc.get("confirmed", False)),
                "pack_default_used": "pack_size" not in (sups.get(supplier) or {}) and "pack_size" not in ov,
                "supplier_known": supplier in sups,
            }
        )
    return pd.concat([dv.reset_index(drop=True), pd.DataFrame(out)], axis=1)


def build_dims(con, settings) -> tuple[pd.DataFrame, pd.DataFrame]:
    tz = settings["store"]["timezone"]
    prod = con.execute("SELECT * FROM raw_products").df()
    var = con.execute("SELECT * FROM raw_variants").df()
    latest_seen = var["last_seen_at"].max() if len(var) else None

    prod["collection"] = prod["collections"].map(main_collection)
    prod["created_date"] = pd.to_datetime(prod["created_at"]).dt.tz_localize("UTC").dt.tz_convert(tz).dt.date

    parsed = var["options_json"].map(parse_options)
    var["color"] = [p[0] or "NO COLOR" for p in parsed]
    var["size"] = [p[1] or "ONE SIZE" for p in parsed]

    dv = var.merge(
        prod[["product_id", "title", "product_type", "vendor", "tags", "status", "collection", "collections"]],
        on="product_id",
        how="left",
    ).rename(columns={"title_y": "product_title", "title_x": "variant_title", "collections": "collections_all"})
    dv["product_title"] = dv["product_title"].fillna("UNKNOWN PRODUCT")
    dv["product_type"] = dv["product_type"].fillna("").replace("", "UNTYPED")
    dv["collection"] = dv["collection"].fillna("NO COLLECTION")
    dv["status"] = dv["status"].fillna("UNKNOWN").str.upper()
    dv["regular_price"] = np.fmax(dv["price"].fillna(0), dv["compare_at_price"].fillna(0))
    dv["created_date"] = pd.to_datetime(dv["created_at"]).dt.tz_localize("UTC").dt.tz_convert(tz).dt.date
    dv["seen_in_latest_pull"] = dv["last_seen_at"] == latest_seen
    dv["active"] = dv["seen_in_latest_pull"] & (dv["status"] == "ACTIVE")

    # Price bands from quartiles of active regular prices, fixed edges so the same data gives the same bands
    act_prices = dv.loc[dv["active"], "regular_price"]
    if len(act_prices) >= 4:
        edges = np.unique(np.quantile(act_prices, [0.25, 0.5, 0.75]))
        dv["price_band"] = "band_" + (np.searchsorted(edges, dv["regular_price"], side="right") + 1).astype(str)
    else:
        dv["price_band"] = "band_1"

    dv = apply_suppliers(dv, settings.suppliers)
    keep = [
        "variant_id", "sku", "barcode", "product_id", "product_title", "variant_title", "product_type", "vendor",
        "color", "size", "collection", "collections_all", "tags", "supplier", "pack_size", "lead_time_days", "moq",
        "unit_cost", "currency", "price", "compare_at_price", "regular_price", "price_band", "status", "active",
        "seen_in_latest_pull", "created_date", "inventory_item_id", "inventory_policy", "supplier_confirmed",
        "pack_default_used", "supplier_known",
    ]
    dim_variant = dv[keep].copy()

    n_var = dim_variant.groupby("product_id").size().rename("n_variants")
    sup = dim_variant.groupby("product_id")["supplier"].agg(lambda s: s.mode().iloc[0] if len(s) else "UNASSIGNED")
    dim_product = (
        prod[["product_id", "title", "product_type", "vendor", "collection", "status", "created_date"]]
        .merge(n_var, on="product_id", how="left")
        .merge(sup.rename("supplier"), on="product_id", how="left")
    )
    dim_product["n_variants"] = dim_product["n_variants"].fillna(0).astype(int)
    return dim_product, dim_variant
