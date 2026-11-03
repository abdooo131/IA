"""Sample store for the demo screen: a seeded synthetic Shopify store and Meta account answered in process.

Demo Boutique (EGP, Africa/Cairo) sells five colour products of four styles:

* Silk Dress Black and Red: strong sellers with a good ad response (SCALE).
* Linen Shirt Blue: size M sells out for long stretches (RESTOCK FIRST).
* Wool Coat Grey: high ad spend, weak sales (CUT SPEND).
* Cotton Tee White: no unit cost (missing_cost), price raised 40 percent in August 2026.

Orders run for 14 months up to 2026-11-01, with daily Meta spend per product on ads named
`<handle>_VID_LIFESTYLE`, landing page sessions, stock history with the sold out windows and two suppliers
(lead times 21 and 45 days). `DemoShopify` and `DemoMeta` answer the engine's named GraphQL operations and the
Meta insights path; `install` patches them into the engine modules of the demo process only. Pushing a PO creates
a fake transfer id in memory: nothing real is ever called.
"""
from __future__ import annotations

import json
import math
import random
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from . import cli, db, tenants
from .tenants import Tenant

TODAY = date(2026, 11, 2)            # demo local today: the decided month is 2026-10
START = date(2025, 9, 1)             # first order and spend day (14 months of history)
SEED = 7
DEMO_DB_NAME = "engine_demo"
LOCATION = "gid://shopify/Location/1"
ACCOUNT = "900000000000001"
TENANT_NAME = "Demo Boutique"


@dataclass(frozen=True)
class DemoProduct:
    number: int
    handle: str
    title: str
    colour: str
    price: float
    base: float                      # base daily demand
    response: float                  # demand per ln(1 + spend / 40)
    sizes: tuple                     # ((variant number, size, unit cost or None), ...)
    ad_spend: float                  # base daily spend


PRODUCTS = (
    DemoProduct(10, "silk-dress-black", "Silk Dress Black", "Black", 950.0, 1.2, 0.9,
                ((101, "S", 380.0), (102, "M", 380.0), (103, "L", 380.0)), 260),
    DemoProduct(11, "silk-dress-red", "Silk Dress Red", "Red", 950.0, 0.8, 0.7,
                ((111, "S", 380.0), (112, "M", 380.0), (113, "L", 380.0)), 180),
    DemoProduct(20, "linen-shirt-blue", "Linen Shirt Blue", "Blue", 650.0, 1.6, 0.6,
                ((201, "S", 210.0), (202, "M", 210.0), (203, "L", 210.0)), 200),
    DemoProduct(30, "wool-coat-grey", "Wool Coat Grey", "Grey", 2400.0, 0.15, 0.05,
                ((301, "M", 1500.0), (302, "L", 1500.0)), 420),
    DemoProduct(40, "cotton-tee-white", "Cotton Tee White", "White", 350.0, 2.0, 0.3,
                ((401, "S", None), (402, "M", None), (403, "L", None)), 90),
)
SIZE_SHARE = {"S": 0.25, "M": 0.45, "L": 0.30}
SUPPLIERS = (("Cairo Atelier", "factory", 21, 6), ("Istanbul Mill", "external", 45, 10))


def gid(kind: str, n) -> str:
    return f"gid://shopify/{kind}/{n}"


def _money(x: float) -> dict:
    return {"shopMoney": {"amount": f"{x:.2f}"}}


def _days(a: date, b: date) -> list[date]:
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


def in_stock(variant_no: int, d: date) -> bool:
    """Linen shirt M sells out for long stretches; silk dress black L is out in summer; the rest is stocked."""
    if variant_no == 202 and (date(2026, 6, 1) <= d <= date(2026, 7, 20) or d >= date(2026, 9, 25)):
        return False
    if variant_no == 103 and date(2026, 7, 1) <= d <= date(2026, 8, 15):
        return False
    return True


def stock_on(p: DemoProduct, size: str, variant_no: int, d: date) -> int:
    if not in_stock(variant_no, d):
        return 0
    return 6 if p.number == 20 and size == "L" else 40


def price_on(p: DemoProduct, d: date) -> float:
    if p.number == 40 and d >= date(2026, 8, 1):          # tee priced up 40 percent in August
        return round(p.price * 1.4)
    return p.price


class DemoStore:
    """The generated store: spend, Meta purchases and orders per day, fixed by the seed; plus the fake
    transfers created by pushing POs (in memory)."""

    def __init__(self, start: date = START, today: date = TODAY, seed: int = SEED):
        self.start, self.today, self.end = start, today, today - timedelta(days=1)
        rng = random.Random(seed)
        season = lambda d: 1.3 if d.month in (3, 4, 11, 12) else 1.0       # noqa: E731
        self.spend = {(p.number, d): round(p.ad_spend * season(d) * (0.8 + 0.4 * rng.random()), 2)
                      for p in PRODUCTS for d in _days(start, self.end)}
        self.orders = self._orders(rng)
        self.purchases = {k: max(0, int(v / 300 + rng.random())) for k, v in self.spend.items()}
        self.transfers: dict[str, dict] = {}

    def _orders(self, rng: random.Random) -> list[dict]:
        out, n = [], 0
        for d in _days(self.start, self.end):
            for p in PRODUCTS:
                price = price_on(p, d)
                mean = (p.base + p.response * math.log1p(self.spend[(p.number, d)] / 40)) * (price / p.price) ** -2.5
                if d.day >= 25:
                    mean *= 1.25
                k = sum(1 for _ in range(30) if rng.random() < mean / 30)
                for _ in range(k):
                    size = rng.choices(list(SIZE_SHARE), weights=list(SIZE_SHARE.values()))[0]
                    cand = [v for v in p.sizes if v[1] == size]
                    if not cand or not in_stock(cand[0][0], d):
                        continue                    # a lost sale: that size is sold out
                    n += 1
                    cust = rng.randint(1, 2500)
                    utm = {"lastVisit": {"landingPage": None,
                                         "utmParameters": {"source": "facebook", "content": f"ad{p.number}"}}} \
                        if rng.random() < 0.6 else None
                    out.append({
                        "id": gid("Order", n), "createdAt": f"{d.isoformat()}T{8 + n % 12:02d}:00:00Z",
                        "cancelledAt": None, "email": None, "phone": None,
                        "customer": {"id": gid("Customer", cust), "email": None, "phone": f"010{cust:08d}"},
                        "totalPriceSet": _money(price), "customerJourneySummary": utm,
                        "lineItems": {"pageInfo": {"hasNextPage": False}, "nodes": [
                            {"id": gid("LineItem", n), "quantity": 1,
                             "variant": {"id": gid("ProductVariant", cand[0][0])},
                             "discountedTotalSet": _money(price)}]},
                        "refunds": []})
        return out


# ---------------------------------------------------------------- fake clients

def _page(field: str, nodes: list) -> dict:
    return {field: {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": nodes}}


class DemoShopify:
    """Answers the engine's named Shopify GraphQL operations from the DemoStore; returns the response data."""

    def __init__(self, store: DemoStore):
        self.store = store
        self.calls: list[tuple[str, dict | None]] = []

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        m = re.search(r"\b(?:query|mutation)\s+(\w+)", query)
        op = m.group(1) if m else ""
        self.calls.append((op, variables))
        handler = getattr(self, f"_op_{op}", None)
        if handler is None:
            raise RuntimeError(f"the sample store does not answer {op or 'this query'}")
        return handler(variables or {})

    def _op_ShopInfo(self, v):
        return {"shop": {"ianaTimezone": "Africa/Cairo", "currencyCode": "EGP"},
                "location": {"id": LOCATION, "name": "Warehouse"}}

    def _op_Products(self, v):
        nodes = [{"id": gid("Product", p.number), "handle": p.handle, "title": p.title, "status": "ACTIVE",
                  "createdAt": "2025-08-01T09:00:00Z", "variants": {"pageInfo": {"hasNextPage": False}, "nodes": [
                      {"id": gid("ProductVariant", vn), "sku": f"{p.handle}-{size}",
                       "selectedOptions": [{"name": "Color", "value": p.colour}, {"name": "Size", "value": size}],
                       "inventoryItem": {"id": gid("InventoryItem", vn),
                                         "unitCost": {"amount": str(cost)} if cost else None}}
                      for vn, size, cost in p.sizes]}}
                 for p in PRODUCTS]
        return _page("products", nodes)

    def _op_Orders(self, v):
        lo, hi = re.findall(r"'([^']+)'", v["query"])
        return _page("orders", [o for o in self.store.orders if lo <= o["createdAt"] < hi])

    def _op_FirstOrder(self, v):
        return {"orders": {"nodes": [{"createdAt": self.store.orders[0]["createdAt"]}] if self.store.orders else []}}

    def _op_LandingSessions(self, v):
        since, until = re.search(r"SINCE (\S+) UNTIL (\S+)", v["q"]).groups()
        rows = [{"landing_page_path": f"/products/{p.handle}", "day": d.isoformat(),
                 "sessions": str(int(25 + self.store.spend.get((p.number, d), 0) / 4))}
                for d in _days(date.fromisoformat(since), date.fromisoformat(until)) for p in PRODUCTS]
        return {"shopifyqlQuery": {"parseErrors": [], "tableData": {"columns": [], "rows": rows}}}

    def _op_StockLevels(self, v):
        d = self.store.end
        nodes = [{"id": gid("ProductVariant", vn), "inventoryItem": {
            "id": gid("InventoryItem", vn), "inventoryLevels": {"pageInfo": {"hasNextPage": False}, "nodes": [{
                "location": {"id": LOCATION, "name": "Warehouse"},
                "quantities": [{"name": "available", "quantity": stock_on(p, size, vn, d)},
                               {"name": "on_hand", "quantity": stock_on(p, size, vn, d)}]}]}}}
            for p in PRODUCTS for vn, size, _ in p.sizes]
        return _page("productVariants", nodes)

    # transfers: pushing a PO creates a fake transfer; syncing receipts reads it back as fully received
    def _op_TransferByReference(self, v):
        tag = re.search(r"tag:'([^']+)'", v["query"]).group(1)
        return _page("inventoryTransfers", [
            {"id": tid, "referenceName": tr["reference"], "status": tr["status"]}
            for tid, tr in self.store.transfers.items() if tr["reference"] == tag])

    def _op_InventoryTransferCreate(self, v):
        inp = v["input"]
        tid = gid("InventoryTransfer", f"demo{len(self.store.transfers) + 1}")
        self.store.transfers[tid] = {"reference": inp["referenceName"], "status": "DRAFT",
                                     "lines": [(li["inventoryItemId"], li["quantity"]) for li in inp["lineItems"]]}
        return {"inventoryTransferCreate": {"inventoryTransfer": {"id": tid, "status": "DRAFT"}, "userErrors": []}}

    def _set_status(self, tid: str, field: str, status: str) -> dict:
        tr = self.store.transfers.get(tid)
        if tr is None:
            return {field: {"inventoryTransfer": None, "userErrors": [{"field": ["id"], "message": "not found"}]}}
        tr["status"] = status
        return {field: {"inventoryTransfer": {"id": tid, "status": status}, "userErrors": []}}

    def _op_InventoryTransferMarkReady(self, v):
        return self._set_status(v["id"], "inventoryTransferMarkAsReadyToShip", "READY_TO_SHIP")

    def _op_InventoryTransferCancel(self, v):
        return self._set_status(v["id"], "inventoryTransferCancel", "CANCELED")

    def _op_InventoryTransferById(self, v):
        tr = self.store.transfers.get(v["id"])
        if tr is None:
            return {"inventoryTransfer": None}
        return {"inventoryTransfer": {
            "id": v["id"], "referenceName": tr["reference"], "status": tr["status"],
            "lineItems": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": [
                {"inventoryItem": {"id": item}, "totalQuantity": q, "shippedQuantity": q, "processableQuantity": 0}
                for item, q in tr["lines"]]}}}


class DemoMeta:
    """Answers the Meta ad account and insights paths from the DemoStore."""

    def __init__(self, store: DemoStore):
        self.store = store
        self.calls: list[tuple[str, dict | None]] = []

    def get(self, path: str, params: dict | None = None) -> dict:
        path, params = path.strip("/"), params or {}
        self.calls.append((path, params))
        if path == f"act_{ACCOUNT}":
            return {"currency": "EGP", "timezone_name": "Africa/Cairo"}
        if path != f"act_{ACCOUNT}/insights":
            raise RuntimeError(f"the sample store does not answer {path}")
        if "breakdowns" in params:
            return {"data": []}
        r = json.loads(params["time_range"])
        lo, hi = max(date.fromisoformat(r["since"]), self.store.start), min(date.fromisoformat(r["until"]),
                                                                            self.store.end)
        rows = []
        for p in PRODUCTS:
            for d in _days(lo, hi):
                sp = self.store.spend[(p.number, d)]
                rows.append({"campaign_id": "c1", "campaign_name": "Prospecting", "adset_id": "s1",
                             "ad_id": f"ad{p.number}", "ad_name": f"{p.handle}_VID_LIFESTYLE",
                             "date_start": d.isoformat(), "date_stop": d.isoformat(), "spend": str(sp),
                             "impressions": str(int(sp * 55)), "clicks": str(int(sp / 6)),
                             "actions": [{"action_type": "omni_purchase",
                                          "value": str(self.store.purchases[(p.number, d)])}]})
        return {"data": rows}


def install(store: DemoStore, setter: Callable = setattr) -> tuple[DemoShopify, DemoMeta]:
    """Patch the fake clients (and the demo's local today) into the engine modules. Only for a demo process or
    a test (pass monkeypatch.setattr as setter so it is undone)."""
    from . import ingest_meta, ingest_shopify, purchasing
    shop, meta = DemoShopify(store), DemoMeta(store)
    for mod in (tenants, ingest_shopify, ingest_meta, purchasing):
        if hasattr(mod, "shopify_client"):
            setter(mod, "shopify_client", lambda t: shop)
        if hasattr(mod, "meta_client"):
            setter(mod, "meta_client", lambda t: meta)
    setter(cli, "local_today", lambda t: store.today)
    setter(purchasing, "_local_today", lambda t: store.today)
    return shop, meta


# ---------------------------------------------------------------- database

def demo_url(url: str, name: str = DEMO_DB_NAME) -> str:
    """The same server and credentials as url, with database `name`."""
    return make_conninfo(url, dbname=name)


def reset_database(url: str) -> None:
    """Create the database of url if missing, then wipe it (drop and recreate the public schema)."""
    name = conninfo_to_dict(url).get("dbname")
    if not name:
        raise ValueError("the demo database URL names no database")
    try:
        c = psycopg.connect(url, autocommit=True)
    except psycopg.OperationalError:
        with psycopg.connect(make_conninfo(url, dbname="postgres"), autocommit=True) as admin:
            admin.execute(f'CREATE DATABASE "{name}"')
        c = psycopg.connect(url, autocommit=True)
    with c:
        c.execute("DROP SCHEMA IF EXISTS public CASCADE")
        c.execute("CREATE SCHEMA public")


def load(conn, store: DemoStore) -> Tenant:
    """Load the sample store into an empty (migrated or not) database through the fake clients, which must be
    installed: tenant, a first cycle (ingest), stock history, suppliers, then the monthly cycle again."""
    db.migrate(conn)
    row = conn.execute(
        "INSERT INTO tenants (name, shop_domain, shopify_token_env, meta_token_env, meta_account_ids, timezone,"
        " currency, po_prefix, main_location_id, pixel_key) VALUES (%s, 'demo-boutique.myshopify.com',"
        " 'DEMO_SHOPIFY_TOKEN', 'DEMO_META_TOKEN', %s, 'Africa/Cairo', 'EGP', 'DEMO', %s, %s) RETURNING tenant_id",
        (TENANT_NAME, [ACCOUNT], LOCATION, "demo-pixel-key")).fetchone()
    conn.execute("INSERT INTO locations (tenant_id, location_id, name) VALUES (%s, %s, 'Warehouse')",
                 (row["tenant_id"], LOCATION))
    conn.commit()
    t = tenants.get_tenant(conn, row["tenant_id"])

    _, ok, err = cli.run_cycle(conn, t, store.today)          # ingests products, orders, spend and sessions
    if not ok:
        raise RuntimeError(f"demo first cycle failed: {err}")
    rows = [(t.tenant_id, d, gid("ProductVariant", vn), LOCATION, stock_on(p, size, vn, d), stock_on(p, size, vn, d))
            for p in PRODUCTS for vn, size, _ in p.sizes for d in _days(store.start, store.end)]
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO stock_daily (tenant_id, date, variant_id, location_id, available, on_hand)"
                        " VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", rows)
    sup = {}
    for name, kind, lead, pack in SUPPLIERS:
        sup[name] = conn.execute("INSERT INTO suppliers (tenant_id, name, kind, lead_time_days, pack_multiple)"
                                 " VALUES (%s,%s,%s,%s,%s) RETURNING supplier_id",
                                 (t.tenant_id, name, kind, lead, pack)).fetchone()["supplier_id"]
    for p in PRODUCTS:
        conn.execute("INSERT INTO product_suppliers (tenant_id, supplier_id, product_id, moq) VALUES (%s,%s,%s,12)",
                     (t.tenant_id, sup["Istanbul Mill" if p.number == 30 else "Cairo Atelier"], gid("Product", p.number)))
    conn.commit()

    _, ok, err = cli.run_cycle(conn, t, store.today)
    if not ok:
        raise RuntimeError(f"demo cycle failed: {err}")
    return t
