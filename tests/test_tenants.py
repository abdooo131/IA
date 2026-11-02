import pytest

from engine import db, tenants


def test_migrate_idempotent(conn):
    assert db.migrate(conn) == []
    assert db.migrate(conn) == []
    n = conn.execute("SELECT count(*) AS n FROM schema_migrations").fetchone()["n"]
    assert n >= 1
    for t in ["tenants", "products", "sales_lines", "orders", "calendar",
              "model_params", "forecasts", "forecast_accuracy"]:
        assert conn.execute("SELECT to_regclass(%s) AS r", (t,)).fetchone()["r"] is not None


def test_add_tenant_reads_tz_currency_from_shop(conn, fake_clients, monkeypatch):
    monkeypatch.setenv("EVE_SHOPIFY_TOKEN", "shpat_x")
    monkeypatch.setenv("EVE_META_TOKEN", "meta_x")
    t = tenants.add_tenant(conn, "Eve Chantelle", "chantelleve.myshopify.com", "EVE_SHOPIFY_TOKEN",
                           "EVE_META_TOKEN", ["496801511811310", "1222339613363462"], "EVE")
    assert t.tenant_id and t.timezone == "Africa/Cairo" and t.currency == "EGP"
    assert t.main_location_id == "gid://shopify/Location/222"
    assert len(t.pixel_key) >= 32
    assert tenants.get_tenant(conn, t.tenant_id) == t
    assert tenants.list_tenants(conn) == [t]
    assert [c[0] for c in fake_clients.meta.calls] == ["act_496801511811310", "act_1222339613363462"]


def test_add_tenant_rejects_currency_mismatch(conn, fake_clients):
    with pytest.raises(ValueError, match="currency"):
        tenants.add_tenant(conn, "X", "x.myshopify.com", "X_S", "X_M", ["999"], "X")
    assert tenants.list_tenants(conn) == []


def test_token_never_stored(conn, fake_clients, monkeypatch):
    monkeypatch.setenv("EVE_SHOPIFY_TOKEN", "shpat_SECRET_VALUE")
    monkeypatch.setenv("EVE_META_TOKEN", "EAAG_META_SECRET")
    tenants.add_tenant(conn, "Eve", "e.myshopify.com", "EVE_SHOPIFY_TOKEN", "EVE_META_TOKEN",
                       ["496801511811310"], "EVE")
    tables = [r["tablename"] for r in conn.execute(
        "SELECT tablename FROM pg_tables WHERE schemaname='public'")]
    for tbl in tables:
        dump = conn.execute(f"SELECT coalesce(string_agg(to_json(x)::text, ' '), '') AS s FROM {tbl} x").fetchone()["s"]
        assert "SECRET" not in dump
    row = conn.execute("SELECT shopify_token_env, meta_token_env FROM tenants").fetchone()
    assert row == {"shopify_token_env": "EVE_SHOPIFY_TOKEN", "meta_token_env": "EVE_META_TOKEN"}


def test_clients_use_env_token_and_urls(monkeypatch, tenant_a):
    seen = {}

    class R:
        def raise_for_status(self): pass
        def json(self): return {"data": {"ok": 1}}

    def post(url, json=None, headers=None, timeout=None):
        seen["post"] = (url, headers); return R()

    def get(url, params=None, timeout=None):
        seen["get"] = (url, params); return R()

    monkeypatch.setattr("engine.tenants.requests.post", post)
    monkeypatch.setattr("engine.tenants.requests.get", get)
    monkeypatch.setenv("A_SHOPIFY_TOKEN", "tok1")
    monkeypatch.setenv("A_META_TOKEN", "tok2")
    assert tenants.shopify_client(tenant_a).graphql("query Q { x }") == {"ok": 1}
    assert seen["post"] == ("https://a.myshopify.com/admin/api/2025-10/graphql.json",
                            {"X-Shopify-Access-Token": "tok1"})
    tenants.meta_client(tenant_a).get("act_1", {"fields": "currency"})
    assert seen["get"] == ("https://graph.facebook.com/v23.0/act_1",
                           {"fields": "currency", "access_token": "tok2"})


def test_tenant_isolation_helper(conn, tenant_a, tenant_b):
    for t, oid in ((tenant_a, "A1"), (tenant_b, "B1")):
        conn.execute("INSERT INTO orders (tenant_id, order_id, date, total) VALUES (%s,%s,'2026-01-01',10)",
                     (t.tenant_id, oid))
    conn.commit()
    rows = db.scoped(conn, tenant_a).query(
        "SELECT order_id FROM orders WHERE tenant_id = %(tenant_id)s")
    assert [r["order_id"] for r in rows] == ["A1"]
    assert [r["order_id"] for r in db.scoped(conn, tenant_b.tenant_id).query(
        "SELECT order_id FROM orders WHERE tenant_id = %(tenant_id)s")] == ["B1"]
    with pytest.raises(ValueError):
        db.scoped(conn, tenant_a).query("SELECT * FROM orders")
    with pytest.raises(ValueError):
        db.scoped(conn, tenant_a).query(
            "SELECT * FROM orders WHERE tenant_id = %(tenant_id)s", {"tenant_id": tenant_b.tenant_id})
