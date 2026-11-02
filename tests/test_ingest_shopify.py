from datetime import date

import pytest

from conftest import load_fixture
from engine import ingest_shopify as ing

V101 = "gid://shopify/ProductVariant/101"
V102 = "gid://shopify/ProductVariant/102"
V201 = "gid://shopify/ProductVariant/201"
LOC_MAIN = "gid://shopify/Location/222"
O1, O2, O3, O4 = (f"gid://shopify/Order/{n}" for n in (1001, 1002, 1003, 1004))


@pytest.fixture
def api(fake_clients, monkeypatch):
    monkeypatch.setattr("engine.ingest_shopify.shopify_client", lambda t: fake_clients.shopify)
    return fake_clients


def _two_pages(api):
    pages = {None: "OrdersPage1", "CURSOR1": "OrdersPage2"}
    api.shopify.respond("Orders", lambda v: load_fixture("shopify", pages[v.get("after")]))


def _ingest(conn, t, api):
    _two_pages(api)
    return ing.ingest_orders(conn, t, date(2026, 3, 1), date(2026, 3, 31))


def _lines(conn, t, order):
    return conn.execute(
        "SELECT date, variant_id, qty, line_value FROM sales_lines WHERE tenant_id=%s AND order_id=%s"
        " ORDER BY date, variant_id, qty", (t.tenant_id, order)).fetchall()


def test_orders_paginated(conn, tenant_a, api):
    n = _ingest(conn, tenant_a, api)
    assert [c[1].get("after") for c in api.shopify.calls if c[0] == "Orders"] == [None, "CURSOR1"]
    assert n == 3
    ids = {r["order_id"] for r in conn.execute("SELECT order_id FROM orders WHERE tenant_id=%s", (tenant_a.tenant_id,))}
    assert ids == {O1, O3, O4}


def test_cancelled_excluded(conn, tenant_a, api):
    _ingest(conn, tenant_a, api)
    assert not conn.execute("SELECT 1 FROM orders WHERE order_id=%s", (O2,)).fetchall()
    assert not _lines(conn, tenant_a, O2)


def test_refund_on_refund_date(conn, tenant_a, api):
    _ingest(conn, tenant_a, api)
    rows = _lines(conn, tenant_a, O1)
    assert [(r["date"], r["variant_id"], r["qty"], float(r["line_value"])) for r in rows] == [
        (date(2026, 3, 2), V101, 2, 1000.0),
        (date(2026, 3, 2), V102, 1, 500.0),
        (date(2026, 3, 5), V101, -1, -500.0),
    ]


def test_local_date_bucketing_uses_tenant_tz(conn, tenant_a, api):
    # 2026-03-01T22:30Z is 2026-03-02 00:30 in Africa/Cairo (UTC+2)
    _ingest(conn, tenant_a, api)
    assert conn.execute("SELECT date FROM orders WHERE order_id=%s", (O1,)).fetchone()["date"] == date(2026, 3, 2)
    tenant_a.timezone = "America/Los_Angeles"
    ing.ingest_orders(conn, tenant_a, date(2026, 3, 1), date(2026, 3, 31))
    assert conn.execute("SELECT date FROM orders WHERE order_id=%s", (O1,)).fetchone()["date"] == date(2026, 3, 1)


def test_idempotent(conn, tenant_a, api):
    _ingest(conn, tenant_a, api)
    snap = lambda: (conn.execute("SELECT count(*) c FROM orders").fetchone()["c"],
                    conn.execute("SELECT count(*) c, sum(qty) q, sum(line_value) v FROM sales_lines").fetchone())
    first = snap()
    assert _ingest(conn, tenant_a, api) == 3
    assert snap() == first


def test_cancel_after_ingest_removes_rows(conn, tenant_a, api):
    _ingest(conn, tenant_a, api)
    page = load_fixture("shopify", "OrdersPage1")
    page["data"]["orders"]["nodes"][0]["cancelledAt"] = "2026-03-06T00:00:00Z"
    api.shopify.respond("Orders", lambda v: page if v.get("after") is None else load_fixture("shopify", "OrdersPage2"))
    ing.ingest_orders(conn, tenant_a, date(2026, 3, 1), date(2026, 3, 31))
    assert not _lines(conn, tenant_a, O1)


def test_utm_and_landing_fallback(conn, tenant_a, api):
    _ingest(conn, tenant_a, api)
    get = lambda o: conn.execute("SELECT utm_source, utm_content, total FROM orders WHERE order_id=%s", (o,)).fetchone()
    assert (get(O1)["utm_source"], get(O1)["utm_content"], float(get(O1)["total"])) == ("facebook", "ad123", 1500.0)
    assert (get(O3)["utm_source"], get(O3)["utm_content"]) == ("ig", "77")
    assert (get(O4)["utm_source"], get(O4)["utm_content"]) == (None, None)


def test_customer_keys_on_orders(conn, tenant_a, api):
    _ingest(conn, tenant_a, api)
    key = lambda o: conn.execute("SELECT customer_key k FROM orders WHERE order_id=%s", (o,)).fetchone()["k"]
    assert key(O1) == key(O4) == "+201012345678"
    assert key(O3) == "foo@example.com"
    assert {r["customer_key"] for r in conn.execute(
        "SELECT customer_key FROM sales_lines WHERE order_id=%s", (O1,))} == {"+201012345678"}


def test_line_without_variant_skipped(conn, tenant_a, api):
    _ingest(conn, tenant_a, api)
    assert [r["variant_id"] for r in _lines(conn, tenant_a, O4)] == [V102]


def test_orders_isolated_per_tenant(conn, tenant_a, tenant_b, api):
    _ingest(conn, tenant_a, api)
    assert conn.execute("SELECT count(*) c FROM orders WHERE tenant_id=%s", (tenant_b.tenant_id,)).fetchone()["c"] == 0
    _ingest(conn, tenant_b, api)
    assert conn.execute("SELECT count(*) c FROM orders").fetchone()["c"] == 6


def test_phone_normalised():
    keys = {ing.customer_key(p, None, None) for p in ("01012345678", "+201012345678", "00201012345678",
                                                      "201012345678", "+20 101 234 5678", "0101-234-5678")}
    assert keys == {"+201012345678"}
    assert ing.normalise_phone("garbage") is None
    assert ing.normalise_phone("") is None
    assert ing.normalise_phone("+14155550123") == "+14155550123"


def test_customer_key_fallback_order():
    assert ing.customer_key("01012345678", "A@b.com", "gid://c/1") == "+201012345678"
    assert ing.customer_key(None, " A@B.com ", "gid://c/1") == "a@b.com"
    assert ing.customer_key("n/a", None, "gid://c/1") == "gid://c/1"
    assert ing.customer_key(None, None, None) is None


def test_sync_products_and_missing_cost_null(conn, tenant_a, api):
    assert ing.sync_products(conn, tenant_a) == 3
    row = lambda v: conn.execute("SELECT * FROM products WHERE tenant_id=%s AND variant_id=%s",
                                 (tenant_a.tenant_id, v)).fetchone()
    assert float(row(V101)["unit_cost"]) == 250.0
    assert row(V102)["unit_cost"] is None
    assert row(V101)["handle"] == "silk-dress-black" and row(V101)["product_id"] == "gid://shopify/Product/10"
    assert row(V101)["inventory_item_id"] == "gid://shopify/InventoryItem/1101"
    # idempotent
    assert ing.sync_products(conn, tenant_a) == 3
    assert conn.execute("SELECT count(*) c FROM products").fetchone()["c"] == 3


def test_option_parsing_arabic_and_english(conn, tenant_a, api):
    ing.sync_products(conn, tenant_a)
    get = lambda v: conn.execute("SELECT colour, size FROM products WHERE variant_id=%s", (v,)).fetchone()
    assert (get(V101)["colour"], get(V101)["size"]) == ("Black", "S")
    assert (get(V201)["colour"], get(V201)["size"]) == ("أحمر", "L")


def test_snapshot_stock(conn, tenant_a, api):
    assert ing.snapshot_stock(conn, tenant_a, date(2026, 3, 10)) == 3
    r = conn.execute("SELECT available, on_hand, reconstructed FROM stock_daily WHERE variant_id=%s AND location_id=%s",
                     (V101, LOC_MAIN)).fetchone()
    assert (r["available"], r["on_hand"], r["reconstructed"]) == (10, 12, False)
    assert conn.execute("SELECT name FROM locations WHERE location_id=%s", (LOC_MAIN,)).fetchone()["name"] == "Main warehouse"
    assert ing.snapshot_stock(conn, tenant_a, date(2026, 3, 10)) == 3
    assert conn.execute("SELECT count(*) c FROM stock_daily").fetchone()["c"] == 3


def test_stock_reconstruction(conn, tenant_a, api):
    ing.snapshot_stock(conn, tenant_a, date(2026, 3, 10))   # V101 main: available 10, on_hand 12
    ins = lambda d, v, q: conn.execute(
        "INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value) VALUES (%s,'o',%s,%s,%s,1)",
        (tenant_a.tenant_id, d, v, q))
    ins(date(2026, 3, 10), V101, 2)    # sold on snapshot day: stock at end of 9th is 2 higher
    ins(date(2026, 3, 8), V101, 3)
    conn.execute("INSERT INTO stock_receipts (tenant_id, date, variant_id, location_id, qty) VALUES (%s,%s,%s,%s,5)",
                 (tenant_a.tenant_id, date(2026, 3, 9), V101, LOC_MAIN))
    conn.commit()
    n = ing.reconstruct_stock(conn, tenant_a, date(2026, 3, 7))
    got = {r["date"]: (r["available"], r["on_hand"], r["reconstructed"]) for r in conn.execute(
        "SELECT * FROM stock_daily WHERE variant_id=%s AND location_id=%s", (V101, LOC_MAIN))}
    assert got[date(2026, 3, 10)] == (10, 12, False)
    # end of 9th = 10 + 2 sold on the 10th (nothing received on the 10th)
    assert got[date(2026, 3, 9)] == (12, 14, True)
    # end of 8th = end of 9th + 0 sold on the 9th - 5 received on the 9th
    assert got[date(2026, 3, 8)] == (7, 9, True)
    # end of 7th = end of 8th + 3 sold on the 8th
    assert got[date(2026, 3, 7)] == (10, 12, True)
    assert date(2026, 3, 6) not in got
    # other location (no sales) stays flat; V102 flat at 0
    assert conn.execute("SELECT available FROM stock_daily WHERE variant_id=%s AND location_id=%s AND date=%s",
                        (V101, "gid://shopify/Location/333", date(2026, 3, 7))).fetchone()["available"] == 3
    assert n == 9   # 3 reconstructed days (7th to 9th) x 3 (variant, location) pairs
    # real snapshot rows untouched, reconstruction idempotent
    assert ing.reconstruct_stock(conn, tenant_a, date(2026, 3, 7)) == n
    assert conn.execute("SELECT count(*) c FROM stock_daily WHERE NOT reconstructed").fetchone()["c"] == 3


def test_landing_path_to_handle():
    f = ing.landing_path_to_handle
    assert f("/products/silk-dress-black") == "silk-dress-black"
    assert f("/products/silk-dress-black/") == "silk-dress-black"
    assert f("/ar/products/silk-dress-black?variant=1&utm_source=x") == "silk-dress-black"
    assert f("/en-gb/products/a-b/?x=1") == "a-b"
    assert f("/") is None and f("/collections/dresses") is None and f("/collections/x/products/y") is None
    assert f("/pages/products") is None and f("") is None


def test_ingest_landing_sessions(conn, tenant_a, api):
    n = ing.ingest_landing_sessions(conn, tenant_a, date(2026, 3, 1), date(2026, 3, 2))
    q = [v for name, v in api.shopify.calls if name == "LandingSessions"][0]["q"]
    assert "FROM sessions" in q and "SHOW sessions" in q and "GROUP BY landing_page_path, day" in q
    assert "SINCE 2026-03-01" in q and "UNTIL 2026-03-02" in q
    rows = {(r["date"], r["handle"]): r["sessions"] for r in conn.execute("SELECT * FROM landing_sessions")}
    assert rows == {(date(2026, 3, 1), "silk-dress-black"): 50, (date(2026, 3, 1), "fustan-ahmar"): 7,
                    (date(2026, 3, 2), "silk-dress-black"): 25}
    assert n == 3
    assert ing.ingest_landing_sessions(conn, tenant_a, date(2026, 3, 1), date(2026, 3, 2)) == 3
    assert conn.execute("SELECT count(*) c FROM landing_sessions").fetchone()["c"] == 3


def test_landing_parse_errors_raise(conn, tenant_a, api):
    api.shopify.respond("LandingSessions", {"data": {"shopifyqlQuery": {"parseErrors": ["bad"], "tableData": None}}})
    with pytest.raises(RuntimeError):
        ing.ingest_landing_sessions(conn, tenant_a, date(2026, 3, 1), date(2026, 3, 2))


def test_fetch_transfer(api, tenant_a):
    tr = ing.fetch_transfer(tenant_a, "gid://shopify/InventoryTransfer/55")
    assert tr["reference_name"] == "EVEPO202603001" and tr["status"] == "IN_PROGRESS"
    assert tr["lines"] == [
        {"inventory_item_id": "gid://shopify/InventoryItem/1101", "total": 20, "shipped": 20, "received": 12},
        {"inventory_item_id": "gid://shopify/InventoryItem/1102", "total": 10, "shipped": 10, "received": 0}]
