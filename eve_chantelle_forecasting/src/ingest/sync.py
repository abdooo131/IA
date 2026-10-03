"""Shopify sync: full history on the first run, incremental afterwards, plus daily stock and price snapshots.

The loaders take bulk JSONL files, so the demo fixture goes through exactly the same parsing code.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from src import db
from src.common import file_date
from src.ingest import bulk_queries as q
from src.ingest.shopify_client import MissingScopesError, ShopifyClient


def gid_tail(gid) -> str | None:
    """gid://shopify/Order/123 becomes 123. InventoryLevel ids keep only the numeric part before the query."""
    if gid is None:
        return None
    return str(gid).rsplit("/", 1)[-1].split("?")[0]


def gid_type(gid) -> str:
    return str(gid).split("/")[3] if gid and str(gid).startswith("gid://") else ""


def _money(node, key):
    try:
        return float(node[key]["shopMoney"]["amount"])
    except (KeyError, TypeError, ValueError):
        return None


def _ts(value):
    if not value:
        return None
    return pd.Timestamp(value).tz_convert("UTC").tz_localize(None) if pd.Timestamp(value).tzinfo else pd.Timestamp(value)


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with open(path, encoding="utf8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


# Parsers -------------------------------------------------------------------------------------------


def parse_orders(rows: list[dict]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    orders, lines, refunds = [], [], []
    for r in rows:
        t = gid_type(r.get("id"))
        if t == "Order":
            addr = r.get("shippingAddress") or {}
            orders.append(
                {
                    "order_id": gid_tail(r["id"]),
                    "name": r.get("name"),
                    "created_at": _ts(r.get("createdAt")),
                    "processed_at": _ts(r.get("processedAt") or r.get("createdAt")),
                    "updated_at": _ts(r.get("updatedAt")),
                    "cancelled_at": _ts(r.get("cancelledAt")),
                    "cancel_reason": r.get("cancelReason"),
                    "financial_status": r.get("displayFinancialStatus"),
                    "fulfillment_status": r.get("displayFulfillmentStatus"),
                    "source_name": r.get("sourceName"),
                    "tags": ",".join(r.get("tags") or []),
                    "discount_codes": ",".join(r.get("discountCodes") or []),
                    "total_discounts": _money(r, "totalDiscountsSet"),
                    "total_price": _money(r, "totalPriceSet"),
                    "is_test": bool(r.get("test")),
                    "shipping_city": addr.get("city"),
                    "shipping_governorate": addr.get("province"),
                    "customer_id": gid_tail((r.get("customer") or {}).get("id")),
                    "location_id": None,
                }
            )
            for rf in r.get("refunds") or []:
                edges = ((rf.get("refundLineItems") or {}).get("edges")) or []
                for e in edges:
                    n = e["node"]
                    li = gid_tail((n.get("lineItem") or {}).get("id"))
                    refunds.append(
                        {
                            "refund_line_id": f"{gid_tail(rf['id'])}_{li}",
                            "refund_id": gid_tail(rf["id"]),
                            "order_id": gid_tail(r["id"]),
                            "line_item_id": li,
                            "quantity": int(n.get("quantity") or 0),
                            "restock_type": n.get("restockType"),
                            "subtotal": _money(n, "subtotalSet"),
                            "created_at": _ts(rf.get("createdAt")),
                        }
                    )
        elif t == "LineItem":
            lines.append(
                {
                    "line_item_id": gid_tail(r["id"]),
                    "order_id": gid_tail(r.get("__parentId")),
                    "variant_id": gid_tail((r.get("variant") or {}).get("id")),
                    "product_id": gid_tail((r.get("product") or {}).get("id")),
                    "sku": r.get("sku"),
                    "quantity": int(r.get("quantity") or 0),
                    "current_quantity": int(r.get("currentQuantity") if r.get("currentQuantity") is not None else r.get("quantity") or 0),
                    "unfulfilled_quantity": int(r.get("unfulfilledQuantity") or 0),
                    "original_unit_price": _money(r, "originalUnitPriceSet"),
                    "discounted_unit_price": _money(r, "discountedUnitPriceAfterAllDiscountsSet"),
                    "total_discount": _money(r, "totalDiscountSet"),
                }
            )
    return pd.DataFrame(orders), pd.DataFrame(lines), pd.DataFrame(refunds)


def parse_products(rows: list[dict]) -> pd.DataFrame:
    products, collections = {}, {}
    for r in rows:
        t = gid_type(r.get("id"))
        if t == "Product":
            products[gid_tail(r["id"])] = {
                "product_id": gid_tail(r["id"]),
                "title": r.get("title"),
                "product_type": r.get("productType"),
                "vendor": r.get("vendor"),
                "tags": ",".join(r.get("tags") or []),
                "status": r.get("status"),
                "collections": "",
                "created_at": _ts(r.get("createdAt")),
                "published_at": _ts(r.get("publishedAt")),
                "updated_at": _ts(r.get("updatedAt")),
            }
        elif t == "Collection":
            collections.setdefault(gid_tail(r.get("__parentId")), []).append(r.get("title") or "")
    for pid, titles in collections.items():
        if pid in products:
            products[pid]["collections"] = "|".join(titles)
    return pd.DataFrame(list(products.values()))


def parse_variants(rows: list[dict], pulled_at: pd.Timestamp) -> tuple[pd.DataFrame, pd.DataFrame]:
    variants, levels = {}, []
    item_to_variant = {}
    for r in rows:
        t = gid_type(r.get("id"))
        if t == "ProductVariant":
            item = r.get("inventoryItem") or {}
            vid = gid_tail(r["id"])
            item_id = gid_tail(item.get("id"))
            item_to_variant[item_id] = vid
            price = r.get("price")
            cap = r.get("compareAtPrice")
            unit_cost = None
            if item.get("unitCost"):
                try:
                    unit_cost = float(item["unitCost"]["amount"])
                except (KeyError, TypeError, ValueError):
                    unit_cost = None
            variants[vid] = {
                "variant_id": vid,
                "product_id": gid_tail((r.get("product") or {}).get("id")),
                "sku": (r.get("sku") or None),
                "title": r.get("title"),
                "barcode": r.get("barcode"),
                "options_json": json.dumps(r.get("selectedOptions") or []),
                "price": float(price) if price not in (None, "") else None,
                "compare_at_price": float(cap) if cap not in (None, "") else None,
                "inventory_item_id": item_id,
                "unit_cost": unit_cost,
                "inventory_policy": r.get("inventoryPolicy"),
                "created_at": _ts(r.get("createdAt")),
                "updated_at": _ts(r.get("updatedAt")),
                "last_seen_at": pulled_at,
            }
        elif t == "InventoryLevel":
            q_map = {x["name"]: x.get("quantity") for x in r.get("quantities") or []}
            levels.append(
                {
                    "_parent": gid_tail(r.get("__parentId")),
                    "_parent_type": gid_type(r.get("__parentId")),
                    "location_id": gid_tail((r.get("location") or {}).get("id")),
                    "available": q_map.get("available"),
                    "committed": q_map.get("committed"),
                    "incoming": q_map.get("incoming"),
                    "on_hand": q_map.get("on_hand"),
                    "pulled_at": pulled_at,
                }
            )
    var_df = pd.DataFrame(list(variants.values()))
    lv = pd.DataFrame(levels)
    if not lv.empty:
        # The parent can be the variant row or the inventory item, depending on API version
        def to_item(row):
            if row["_parent_type"] == "InventoryItem":
                return row["_parent"]
            match = var_df.loc[var_df["variant_id"] == row["_parent"], "inventory_item_id"]
            return match.iloc[0] if len(match) else None

        lv["inventory_item_id"] = lv.apply(to_item, axis=1)
        lv = lv.drop(columns=["_parent", "_parent_type"])
        for c in ("available", "committed", "incoming", "on_hand"):
            lv[c] = pd.to_numeric(lv[c], errors="coerce").fillna(0).astype(int)
    return var_df, lv


# Loaders -------------------------------------------------------------------------------------------


def load_orders(con, rows: list[dict]) -> dict:
    orders, lines, refunds = parse_orders(rows)
    if orders.empty:
        return {"orders": 0, "line_items": 0, "refund_lines": 0}
    con.register("_ids", orders[["order_id"]])
    con.execute("DELETE FROM raw_line_items WHERE order_id IN (SELECT order_id FROM _ids)")
    # Refund rows are only replaced for orders whose refund detail was pulled in this batch
    refunded_orders = {gid_tail(r["id"]) for r in rows if gid_type(r.get("id")) == "Order" and r.get("refunds")}
    con.unregister("_ids")
    if refunded_orders:
        con.register("_rids", pd.DataFrame({"order_id": sorted(refunded_orders)}))
        con.execute("DELETE FROM raw_refunds WHERE order_id IN (SELECT order_id FROM _rids)")
        con.unregister("_rids")
    db.upsert(con, "raw_orders", orders, ["order_id"])
    db.append(con, "raw_line_items", lines)
    db.upsert(con, "raw_refunds", refunds, ["refund_line_id"])
    return {"orders": len(orders), "line_items": len(lines), "refund_lines": len(refunds)}


def load_products(con, rows: list[dict]) -> int:
    products = parse_products(rows)
    return db.upsert(con, "raw_products", products, ["product_id"])


def load_variants(con, rows: list[dict], pulled_at: pd.Timestamp, snapshot_date: dt.date) -> dict:
    variants, levels = parse_variants(rows, pulled_at)
    db.upsert(con, "raw_variants", variants, ["variant_id"])
    if not levels.empty:
        con.execute("DELETE FROM raw_inventory_levels")
        db.append(con, "raw_inventory_levels", levels)
    snap = write_snapshots(con, snapshot_date)
    return {"variants": len(variants), "inventory_levels": len(levels), **snap}


def write_snapshots(con, snapshot_date: dt.date) -> dict:
    """Store today's stock per variant per location and today's prices. Same day reruns overwrite."""
    inv = con.execute(
        """SELECT ?::DATE AS date, v.variant_id, l.location_id, l.on_hand, l.available, l.committed, l.incoming
           FROM raw_inventory_levels l JOIN raw_variants v ON v.inventory_item_id = l.inventory_item_id""",
        [snapshot_date],
    ).df()
    prices = con.execute(
        """SELECT ?::DATE AS date, variant_id, price, compare_at_price FROM raw_variants
           WHERE last_seen_at = (SELECT max(last_seen_at) FROM raw_variants)""",
        [snapshot_date],
    ).df()
    db.upsert(con, "fact_inventory_snapshot", inv, ["date", "variant_id", "location_id"])
    db.upsert(con, "fact_price_history", prices, ["date", "variant_id"])
    return {"inventory_snapshot_rows": len(inv), "price_snapshot_rows": len(prices)}


def load_locations(con, nodes: list[dict]) -> int:
    df = pd.DataFrame(
        [{"location_id": gid_tail(n["id"]), "name": n.get("name"), "is_active": bool(n.get("isActive", True))} for n in nodes]
    )
    return db.upsert(con, "raw_locations", df, ["location_id"])


def set_sync_state(con, entity: str, ts: pd.Timestamp, run_id: str):
    db.upsert(
        con,
        "sync_state",
        pd.DataFrame([{"entity": entity, "last_synced_at": ts, "last_run_id": run_id}]),
        ["entity"],
    )


def get_sync_state(con, entity: str):
    row = con.execute("SELECT last_synced_at FROM sync_state WHERE entity = ?", [entity]).fetchone()
    return row[0] if row else None


# Live sync -----------------------------------------------------------------------------------------


def _fetch_refund_details(client: ShopifyClient, order_rows: list[dict], batch: int) -> None:
    """Bulk exports cannot nest refund line items under a list, so they are fetched with a nodes query."""
    with_refunds = [r for r in order_rows if gid_type(r.get("id")) == "Order" and r.get("refunds")]
    by_id = {r["id"]: r for r in with_refunds}
    ids = list(by_id)
    for i in range(0, len(ids), batch):
        data = client.query(q.REFUND_DETAILS, {"ids": ids[i : i + batch]})
        for node in data["nodes"]:
            if node and node.get("id") in by_id:
                by_id[node["id"]]["refunds"] = node.get("refunds") or []


def run_sync(con, settings, ctx) -> dict:
    tz = ZoneInfo(settings["store"]["timezone"])
    started = pd.Timestamp.now(tz="UTC").tz_localize(None)
    today_local = dt.datetime.now(tz).date()
    raw_dir = settings.path("raw_dir")
    client = ShopifyClient.from_env(settings)

    required = settings.get("shopify", "required_scopes", default=[])
    missing = client.check_scopes(required)
    if missing:
        msg = "Missing Shopify scopes: " + ", ".join(missing) + ". Add them to the custom app and reinstall it."
        if "read_all_orders" in missing:
            msg += " read_all_orders is required to read orders older than 60 days."
        if settings.get("shopify", "strict_scopes", default=True):
            raise MissingScopesError(msg)
        ctx.warn(msg)

    summary = {}
    nodes, cursor = [], None
    while True:
        data = client.query(q.LOCATIONS, {"cursor": cursor})["locations"]
        nodes += [e["node"] for e in data["edges"]]
        if not data["pageInfo"]["hasNextPage"]:
            break
        cursor = data["pageInfo"]["endCursor"]
    summary["locations"] = load_locations(con, nodes)

    overlap = pd.Timedelta(minutes=settings.get("shopify", "incremental_overlap_minutes", default=60))

    def since(entity):
        last = get_sync_state(con, entity)
        return None if last is None else (pd.Timestamp(last) - overlap).strftime("%Y-%m-%dT%H:%M:%SZ")

    stamp = file_date(today_local)
    since_products = since("products")
    path = client.run_bulk(q.products_bulk(since_products), raw_dir / f"products_{stamp}.jsonl", ctx.info)
    summary["products"] = load_products(con, read_jsonl(path))
    summary["products_mode"] = "incremental" if since_products else "full"

    path = client.run_bulk(q.VARIANTS_BULK, raw_dir / f"variants_{stamp}.jsonl", ctx.info)
    summary.update(load_variants(con, read_jsonl(path), started, today_local))

    since_orders = since("orders")
    path = client.run_bulk(q.orders_bulk(since_orders), raw_dir / f"orders_{stamp}.jsonl", ctx.info)
    order_rows = read_jsonl(path)
    _fetch_refund_details(client, order_rows, settings.get("shopify", "refund_batch_size", default=50))
    summary.update(load_orders(con, order_rows))
    summary["orders_mode"] = "incremental" if since_orders else "full"

    for entity in ("products", "variants", "orders"):
        set_sync_state(con, entity, started, ctx.run_id)
    return summary
