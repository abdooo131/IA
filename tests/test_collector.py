import hashlib
import hmac
import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from engine import db, lineage
from engine.collector.app import create_app
from engine.collector.funnel import rollup_funnel
from conftest import TEST_URL

P = "gid://shopify/Product/"
V = "gid://shopify/ProductVariant/"


@pytest.fixture
def client(conn):
    return TestClient(create_app(lambda: db.connect(TEST_URL)))


def sig(key, body: bytes):
    return hmac.new(key.encode(), body, hashlib.sha256).hexdigest()


def post(client, t, payload, key=None, raw=None):
    body = raw if raw is not None else json.dumps(payload).encode()
    return client.post(f"/e/{t.tenant_id}", content=body, headers={"X-Signature": sig(key or t.pixel_key, body)})


def ev(event="product_viewed", sid="s1", ts="2026-03-01T10:00:00Z", **kw):
    d = {"event": event, "ts": ts, "session_id": sid, "product_id": "10", "variant_id": None, "available": None}
    d.update(kw)
    return d


def add_variant(conn, t, vid, pid, created="2026-01-01", status="ACTIVE", colour="Black", size="M"):
    conn.execute(
        "INSERT INTO products (tenant_id, variant_id, product_id, title, colour, size, status, created_at)"
        " VALUES (%s,%s,%s,'Tee',%s,%s,%s,%s)", (t.tenant_id, V + vid, P + pid, colour, size, status, created))
    conn.commit()


def test_bad_signature_401(client, conn, tenant_a):
    assert post(client, tenant_a, ev(), key="wrong").status_code == 401
    r = client.post(f"/e/{tenant_a.tenant_id}", content=b"{}")
    assert r.status_code == 401
    assert conn.execute("SELECT count(*) n FROM pixel_events").fetchone()["n"] == 0


def test_unknown_tenant_404(client, tenant_a):
    body = json.dumps(ev()).encode()
    r = client.post("/e/9999", content=body, headers={"X-Signature": sig(tenant_a.pixel_key, body)})
    assert r.status_code == 404


def test_valid_event_204_and_ids_normalised(client, conn, tenant_a):
    assert post(client, tenant_a, ev(variant_id=V + "7")).status_code == 204
    r = conn.execute("SELECT product_id, variant_id FROM pixel_events").fetchone()
    assert (r["product_id"], r["variant_id"]) == (P + "10", V + "7")


def test_bad_requests(client, tenant_a):
    assert post(client, tenant_a, None, raw=b"not json").status_code == 400
    assert post(client, tenant_a, ev(event="page_viewed")).status_code == 400
    assert post(client, tenant_a, ev("checkout_completed")).status_code == 400
    big = b" " * (16 * 1024 + 1)
    assert post(client, tenant_a, None, raw=big).status_code == 413


def test_cors(client, tenant_a):
    r = client.options(f"/e/{tenant_a.tenant_id}", headers={
        "Origin": "https://x.com", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-signature"})
    assert r.headers["access-control-allow-origin"] == "*"


def test_session_hashed_not_raw(client, conn, tenant_a):
    post(client, tenant_a, ev(sid="visitor-abc-123"))
    row = conn.execute("SELECT * FROM pixel_events").fetchone()
    assert row["session_hash"] == hashlib.sha256(f"{tenant_a.pixel_key}:visitor-abc-123".encode()).hexdigest()
    assert "visitor-abc-123" not in json.dumps({k: str(v) for k, v in row.items()})


def test_checkout_writes_row_per_line_item(client, conn, tenant_a):
    items = [{"product_id": "10", "variant_id": "1", "qty": 1}, {"product_id": "11", "variant_id": "2", "qty": 2}]
    assert post(client, tenant_a, ev("checkout_completed", product_id=None, line_items=items)).status_code == 204
    assert conn.execute("SELECT count(*) n FROM pixel_events").fetchone()["n"] == 2


def test_views_unique_per_session_per_day(client, conn, tenant_a):
    add_variant(conn, tenant_a, "1", "10")
    for sid in ("s1", "s1", "s2"):
        post(client, tenant_a, ev(sid=sid, variant_id="1"))
    post(client, tenant_a, ev(sid="s3", variant_id="1", ts="2026-03-02T10:00:00Z"))
    post(client, tenant_a, ev("product_added_to_cart", sid="s1", variant_id="1"))
    post(client, tenant_a, ev("product_added_to_cart", sid="s1", variant_id="1"))
    assert rollup_funnel(conn, tenant_a, date(2026, 3, 1)) == 1
    r = conn.execute("SELECT * FROM funnel_daily WHERE tenant_id=%s AND date='2026-03-01'",
                     (tenant_a.tenant_id,)).fetchone()
    assert (r["product_id"], r["variant_id"], r["views"], r["atc"]) == (P + "10", "", 2, 2)
    assert rollup_funnel(conn, tenant_a, date(2026, 3, 1)) == 1  # idempotent
    assert conn.execute("SELECT count(*) n FROM funnel_daily").fetchone()["n"] == 1


def test_day_uses_tenant_timezone(client, conn, tenant_a):
    add_variant(conn, tenant_a, "1", "10")
    post(client, tenant_a, ev(variant_id="1", ts="2026-03-01T22:30:00Z"))  # Cairo: 03-02 00:30 (+02:00)
    assert rollup_funnel(conn, tenant_a, date(2026, 3, 1)) == 0
    assert rollup_funnel(conn, tenant_a, date(2026, 3, 2)) == 1


def test_unavailable_size_counted(client, conn, tenant_a):
    add_variant(conn, tenant_a, "1", "10")
    post(client, tenant_a, ev("size_selected", sid="s1", variant_id="1", available=False))
    post(client, tenant_a, ev("size_selected", sid="s1", variant_id="1", available=False))
    post(client, tenant_a, ev("size_selected", sid="s2", variant_id="1", available=True))
    rollup_funnel(conn, tenant_a, date(2026, 3, 1))
    r = conn.execute("SELECT * FROM funnel_daily WHERE variant_id=%s", (V + "1",)).fetchone()
    assert (r["size_views"], r["size_views_unavailable"]) == (2, 1)


def test_rollup_maps_old_variant_via_lineage(client, conn, tenant_a):
    add_variant(conn, tenant_a, "1", "10", status="ARCHIVED")
    add_variant(conn, tenant_a, "2", "20", created="2026-02-01")
    lineage.confirm(conn, tenant_a, V + "1", V + "2")
    post(client, tenant_a, ev(sid="s1", product_id="10", variant_id="1"))
    post(client, tenant_a, ev(sid="s2", product_id="20", variant_id="2"))
    post(client, tenant_a, ev("size_selected", sid="s1", product_id=None, variant_id="1", available=False))
    post(client, tenant_a, ev("checkout_completed", sid="s2", product_id=None,
                              line_items=[{"product_id": "10", "variant_id": "1", "qty": 1}]))
    rollup_funnel(conn, tenant_a, date(2026, 3, 1))
    rows = conn.execute("SELECT * FROM funnel_daily WHERE tenant_id=%s ORDER BY variant_id",
                        (tenant_a.tenant_id,)).fetchall()
    assert {r["product_id"] for r in rows} == {P + "20"}
    prod = next(r for r in rows if r["variant_id"] == "")
    assert (prod["views"], prod["orders"]) == (2, 1)
    var = next(r for r in rows if r["variant_id"] == V + "2")
    assert (var["size_views"], var["size_views_unavailable"]) == (1, 1)


def test_rollup_is_tenant_scoped(client, conn, tenant_a, tenant_b):
    add_variant(conn, tenant_a, "1", "10")
    post(client, tenant_a, ev(variant_id="1"))
    assert rollup_funnel(conn, tenant_b, date(2026, 3, 1)) == 0
    assert conn.execute("SELECT count(*) n FROM funnel_daily WHERE tenant_id=%s", (tenant_b.tenant_id,)).fetchone()["n"] == 0


def test_import_does_not_connect():
    import importlib
    m = importlib.import_module("engine.collector.app")
    assert callable(m.create_app)


def test_weird_tenant_ids_404(client, tenant_a):
    for tid in ("99999999999999999999", "%C2%B2", "-1", "abc"):
        assert client.post(f"/e/{tid}", content=b"{}").status_code == 404


def test_chunked_oversize_413(client, tenant_a):
    def gen():
        for _ in range(40):
            yield b" " * 1024
    body = b" " * 10
    r = client.post(f"/e/{tenant_a.tenant_id}", content=gen(), headers={"X-Signature": sig(tenant_a.pixel_key, body)})
    assert r.status_code == 413
    def small():
        yield json.dumps(ev()).encode()
    b = json.dumps(ev()).encode()
    r = client.post(f"/e/{tenant_a.tenant_id}", content=small(), headers={"X-Signature": sig(tenant_a.pixel_key, b)})
    assert r.status_code == 204
