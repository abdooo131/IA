"""Shopify ingest: products, orders (with refunds, UTM, customer key), stock, landing sessions, transfers.

All dates are local dates in the tenant timezone. All GraphQL operations are named
(the test fakes resolve fixtures by operation name).
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, unquote, urlsplit
from zoneinfo import ZoneInfo

from .tenants import Tenant, shopify_client

COLOUR_OPTIONS = {"colour", "color", "اللون"}
SIZE_OPTIONS = {"size", "المقاس"}


# ---------------------------------------------------------------- helpers

def _pages(client, query: str, variables: dict, field: str):
    """Yield nodes of connection `data[field]`, following Admin GraphQL cursors."""
    after = None
    while True:
        data = client.graphql(query, {**variables, "after": after})
        conn_ = data[field]
        yield from conn_["nodes"]
        info = conn_["pageInfo"]
        if not info["hasNextPage"]:
            return
        after = info["endCursor"]


def _local_date(ts: str, tz: str) -> date:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(ZoneInfo(tz)).date()


def _nodes(connection: dict, what: str) -> list[dict]:
    """Nodes of a nested connection fetched with a fixed `first:`; raise rather than truncate silently."""
    if ((connection.get("pageInfo") or {}).get("hasNextPage")):
        raise RuntimeError(f"{what} has more than one page; refusing to ingest truncated data")
    return connection["nodes"]


def _money(m: dict | None) -> float:
    return float(m["shopMoney"]["amount"]) if m else 0.0


# ---------------------------------------------------------------- identity

def normalise_phone(phone: str | None) -> str | None:
    """Egyptian numbers to +20XXXXXXXXXX (from 01X.., +201.., 00201.., 201..). Other
    internationally formatted numbers keep their +digits. Unusable input gives None."""
    if not phone:
        return None
    s = phone.strip()
    digits = re.sub(r"\D", "", s)
    if not digits:
        return None
    if digits.startswith("0020") and len(digits) == 14:
        return "+" + digits[2:]
    if digits.startswith("20") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("01") and len(digits) == 11:
        return "+20" + digits[1:]
    if s.startswith("+") and 8 <= len(digits) <= 15:
        return "+" + digits
    if digits.startswith("00") and 10 <= len(digits) <= 17:
        return "+" + digits[2:]
    return None


def customer_key(phone: str | None, email: str | None, customer_id: str | None) -> str | None:
    """Spec 15: normalised phone, else lower case email, else Shopify customer id."""
    p = normalise_phone(phone)
    if p:
        return p
    if email and email.strip():
        return email.strip().lower()
    return customer_id or None


# ---------------------------------------------------------------- products

PRODUCTS_QUERY = """
query Products($after: String) {
  products(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title status createdAt
      variants(first: 100) { pageInfo { hasNextPage } nodes {
        id sku selectedOptions { name value }
        inventoryItem { id unitCost { amount } }
      } }
    }
  }
}
"""


def sync_products(conn, t: Tenant) -> int:
    """Upsert every variant; returns the number of variants seen."""
    client = shopify_client(t)
    n = 0
    for p in _pages(client, PRODUCTS_QUERY, {}, "products"):
        for v in _nodes(p["variants"], f"product {p['id']} variants"):
            opts = {o["name"].strip().lower(): o["value"] for o in v["selectedOptions"]}
            colour = next((val for k, val in opts.items() if k in COLOUR_OPTIONS), None)
            size = next((val for k, val in opts.items() if k in SIZE_OPTIONS), None)
            item = v.get("inventoryItem") or {}
            cost = (item.get("unitCost") or {}).get("amount")
            conn.execute(
                "INSERT INTO products (tenant_id, variant_id, product_id, handle, title, colour, size, sku,"
                " inventory_item_id, unit_cost, status, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (tenant_id, variant_id) DO UPDATE SET product_id=EXCLUDED.product_id,"
                " handle=EXCLUDED.handle, title=EXCLUDED.title, colour=EXCLUDED.colour, size=EXCLUDED.size,"
                " sku=EXCLUDED.sku, inventory_item_id=EXCLUDED.inventory_item_id,"
                " unit_cost=EXCLUDED.unit_cost, status=EXCLUDED.status, created_at=EXCLUDED.created_at",
                (t.tenant_id, v["id"], p["id"], p["handle"], p["title"], colour, size, v.get("sku"),
                 item.get("id"), None if cost is None else float(cost), p.get("status"), p.get("createdAt")))
            n += 1
    conn.commit()
    return n


# ---------------------------------------------------------------- orders

ORDERS_QUERY = """
query Orders($after: String, $query: String) {
  orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt cancelledAt email phone
      customer { id email phone }
      totalPriceSet { shopMoney { amount } }
      customerJourneySummary { lastVisit { landingPage utmParameters { source content } } }
      lineItems(first: 100) { pageInfo { hasNextPage } nodes {
        id quantity variant { id } discountedTotalSet { shopMoney { amount } }
      } }
      refunds { id createdAt refundLineItems(first: 100) { pageInfo { hasNextPage } nodes {
        quantity subtotalSet { shopMoney { amount } } lineItem { variant { id } }
      } } }
    }
  }
}
"""


FIRST_ORDER_QUERY = """
query FirstOrder {
  orders(first: 1, sortKey: CREATED_AT) { nodes { createdAt } }
}
"""


def first_order_date(t: Tenant) -> date | None:
    """Local date of the store's oldest order (start of the full history ingest); None for a store with no orders."""
    nodes = shopify_client(t).graphql(FIRST_ORDER_QUERY)["orders"]["nodes"]
    return _local_date(nodes[0]["createdAt"], t.timezone) if nodes else None


def _utm(order: dict) -> tuple[str | None, str | None]:
    visit = ((order.get("customerJourneySummary") or {}).get("lastVisit")) or {}
    utm = visit.get("utmParameters") or {}
    source, content = utm.get("source"), utm.get("content")
    if not (source or content) and visit.get("landingPage"):
        q = parse_qs(urlsplit(visit["landingPage"]).query)
        source = (q.get("utm_source") or [None])[0]
        content = (q.get("utm_content") or [None])[0]
    return source or None, content or None


def ingest_orders(conn, t: Tenant, since: date, until: date) -> int:
    """Ingest orders updated on/after `since` and created on/before `until` (local dates).

    Selecting by update time catches refunds and cancellations of older orders. Each order is replaced
    wholesale (delete + reinsert), so re-runs are idempotent. Cancelled orders produce no rows (and
    remove rows from an earlier run). Refunds become negative sales_lines on the refund's local date.
    Returns the number of orders written.
    """
    client = shopify_client(t)
    # Explicit UTC bounds from the tenant's local midnights, so boundary orders are not lost.
    tz = ZoneInfo(t.timezone)
    utc = ZoneInfo("UTC")
    lo = datetime.combine(since, datetime.min.time(), tz).astimezone(utc)
    hi = datetime.combine(until + timedelta(days=1), datetime.min.time(), tz).astimezone(utc)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    q = f"updated_at:>='{lo.strftime(fmt)}' AND created_at:<'{hi.strftime(fmt)}'"
    n = 0
    for o in _pages(client, ORDERS_QUERY, {"query": q}, "orders"):
        created = _local_date(o["createdAt"], t.timezone)
        if created > until:
            continue
        conn.execute("DELETE FROM sales_lines WHERE tenant_id=%s AND order_id=%s", (t.tenant_id, o["id"]))
        conn.execute("DELETE FROM orders WHERE tenant_id=%s AND order_id=%s", (t.tenant_id, o["id"]))
        if o.get("cancelledAt"):
            continue
        cust = o.get("customer") or {}
        key = customer_key(cust.get("phone") or o.get("phone"), cust.get("email") or o.get("email"), cust.get("id"))
        source, content = _utm(o)
        conn.execute(
            "INSERT INTO orders (tenant_id, order_id, date, customer_key, utm_source, utm_content, total)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (t.tenant_id, o["id"], created, key, source, content, _money(o["totalPriceSet"])))
        rows = []
        for li in _nodes(o["lineItems"], f"order {o['id']} lineItems"):
            if li.get("variant"):          # deleted variants cannot be keyed; skipped
                rows.append((created, li["variant"]["id"], li["quantity"], _money(li["discountedTotalSet"])))
        for rf in o.get("refunds") or []:
            rdate = _local_date(rf["createdAt"], t.timezone)
            for rl in _nodes(rf["refundLineItems"], f"refund {rf['id']} refundLineItems"):
                variant = (rl.get("lineItem") or {}).get("variant")
                if variant:
                    rows.append((rdate, variant["id"], -rl["quantity"], -_money(rl["subtotalSet"])))
        for d, variant_id, qty, value in rows:
            conn.execute(
                "INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value, customer_key)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s)", (t.tenant_id, o["id"], d, variant_id, qty, value, key))
        n += 1
    conn.commit()
    return n


# ---------------------------------------------------------------- stock

STOCK_QUERY = """
query StockLevels($after: String) {
  productVariants(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id inventoryItem { inventoryLevels(first: 50) { nodes {
      location { id name }
      quantities(names: ["available", "on_hand"]) { name quantity }
    } } } }
  }
}
"""


def snapshot_stock(conn, t: Tenant, day: date) -> int:
    """Store today's real inventory levels for `day`. Returns rows written."""
    client = shopify_client(t)
    n = 0
    for v in _pages(client, STOCK_QUERY, {}, "productVariants"):
        for lvl in ((v.get("inventoryItem") or {}).get("inventoryLevels") or {}).get("nodes", []):
            qty = {x["name"]: x["quantity"] for x in lvl["quantities"]}
            loc = lvl["location"]
            conn.execute(
                "INSERT INTO locations (tenant_id, location_id, name) VALUES (%s,%s,%s)"
                " ON CONFLICT (tenant_id, location_id) DO UPDATE SET name=EXCLUDED.name",
                (t.tenant_id, loc["id"], loc.get("name")))
            conn.execute(
                "INSERT INTO stock_daily (tenant_id, date, variant_id, location_id, available, on_hand, reconstructed)"
                " VALUES (%s,%s,%s,%s,%s,%s,FALSE) ON CONFLICT (tenant_id, date, variant_id, location_id)"
                " DO UPDATE SET available=EXCLUDED.available, on_hand=EXCLUDED.on_hand, reconstructed=FALSE",
                (t.tenant_id, day, v["id"], loc["id"], qty.get("available", 0), qty.get("on_hand", 0)))
            n += 1
    conn.commit()
    return n


def reconstruct_stock(conn, t: Tenant, until: date) -> int:
    """Fill days before the first real snapshot of each (variant, location), walking backwards.

    `until` is the earliest day to reconstruct (inclusive). Going from the end of day d to the end of
    day d-1: add back units sold on d (net of refunds) and subtract units received on d. Sales and
    receipts are attributed to the tenant's main location (sales lines carry no location); other
    locations stay flat. Rows are flagged reconstructed=true; real snapshots are never overwritten.
    Previous reconstructed rows from `until` onward are replaced, so reruns are idempotent.
    """
    tid = t.tenant_id
    conn.execute("DELETE FROM stock_daily WHERE tenant_id=%s AND reconstructed AND date>=%s", (tid, until))
    first = conn.execute(
        "SELECT DISTINCT ON (variant_id, location_id) variant_id, location_id, date, available, on_hand"
        " FROM stock_daily WHERE tenant_id=%s AND NOT reconstructed"
        " ORDER BY variant_id, location_id, date", (tid,)).fetchall()
    sold: dict = defaultdict(int)
    for r in conn.execute("SELECT variant_id, date, sum(qty) q FROM sales_lines WHERE tenant_id=%s AND date>=%s"
                          " GROUP BY variant_id, date", (tid, until)):
        sold[(r["variant_id"], r["date"])] = int(r["q"])
    recv: dict = defaultdict(int)
    for r in conn.execute("SELECT variant_id, location_id, date, sum(qty) q FROM stock_receipts"
                          " WHERE tenant_id=%s AND date>=%s GROUP BY variant_id, location_id, date", (tid, until)):
        recv[(r["variant_id"], r["location_id"], r["date"])] = int(r["q"])
    n = 0
    for f in first:
        v, loc = f["variant_id"], f["location_id"]
        avail, on_hand = f["available"], f["on_hand"]
        is_main = loc == t.main_location_id
        d = f["date"]
        while d > until:
            if is_main:
                delta = sold[(v, d)] - recv[(v, loc, d)]
            else:
                delta = -recv[(v, loc, d)]
            avail, on_hand = avail + delta, on_hand + delta
            d -= timedelta(days=1)
            conn.execute(
                "INSERT INTO stock_daily (tenant_id, date, variant_id, location_id, available, on_hand, reconstructed)"
                " VALUES (%s,%s,%s,%s,%s,%s,TRUE) ON CONFLICT DO NOTHING", (tid, d, v, loc, avail, on_hand))
            n += 1
    conn.commit()
    return n


# ---------------------------------------------------------------- landing sessions

LANDING_QUERY = """
query LandingSessions($q: String!) {
  shopifyqlQuery(query: $q) {
    parseErrors
    tableData { columns { name dataType } rows }
  }
}
"""

_PRODUCT_PATH = re.compile(r"^(?:/[A-Za-z]{2}(?:-[A-Za-z]{2,4})?)?/products/([^/]+)$")


def landing_path_to_handle(path: str | None) -> str | None:
    """'/ar/products/foo/?variant=1' -> 'foo'; non product paths -> None."""
    if not path:
        return None
    p = urlsplit(path).path.rstrip("/")
    m = _PRODUCT_PATH.match(p)
    return unquote(m.group(1)) if m else None


def ingest_landing_sessions(conn, t: Tenant, since: date, until: date) -> int:
    """Daily sessions per product handle via ShopifyQL; replaces the range. Returns rows written."""
    ql = (f"FROM sessions SHOW sessions GROUP BY landing_page_path, day "
          f"SINCE {since.isoformat()} UNTIL {until.isoformat()}")
    res = shopify_client(t).graphql(LANDING_QUERY, {"q": ql})["shopifyqlQuery"]
    if res.get("parseErrors"):
        raise RuntimeError(f"ShopifyQL errors: {res['parseErrors']}")
    totals: dict = defaultdict(int)
    for row in (res.get("tableData") or {}).get("rows", []):
        handle = landing_path_to_handle(row.get("landing_page_path"))
        if handle:
            totals[(date.fromisoformat(str(row["day"])[:10]), handle)] += int(float(row["sessions"]))
    conn.execute("DELETE FROM landing_sessions WHERE tenant_id=%s AND date BETWEEN %s AND %s",
                 (t.tenant_id, since, until))
    for (d, handle), sessions in totals.items():
        conn.execute("INSERT INTO landing_sessions (tenant_id, date, handle, sessions) VALUES (%s,%s,%s,%s)",
                     (t.tenant_id, d, handle, sessions))
    conn.commit()
    return len(totals)


# ---------------------------------------------------------------- transfers

TRANSFER_QUERY = """
query InventoryTransferById($id: ID!) {
  inventoryTransfer(id: $id) {
    id referenceName status
    lineItems(first: 250) { nodes {
      inventoryItem { id } totalQuantity shippedQuantity processableQuantity
    } }
  }
}
"""


def fetch_transfer(t: Tenant, transfer_id: str) -> dict:
    """Read a transfer: {id, reference_name, status, lines:[{inventory_item_id,total,shipped,received}]}.

    received = shipped - processable (units shipped but not yet received are still processable).
    """
    tr = shopify_client(t).graphql(TRANSFER_QUERY, {"id": transfer_id})["inventoryTransfer"]
    if tr is None:
        raise KeyError(f"transfer {transfer_id} not found")
    return {
        "id": tr["id"], "reference_name": tr["referenceName"], "status": tr["status"],
        "lines": [{"inventory_item_id": li["inventoryItem"]["id"], "total": li["totalQuantity"],
                   "shipped": li["shippedQuantity"],
                   "received": li["shippedQuantity"] - li["processableQuantity"]}
                  for li in tr["lineItems"]["nodes"]],
    }
