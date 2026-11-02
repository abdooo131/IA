import pytest
import requests

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


def test_add_tenant_uses_primary_location_and_warns_on_timezone(conn, fake_clients):
    """I6: the main location is the shop's primary location (location query without id), not the first by name.
    M1: an ad account in another timezone is accepted with a warning."""
    warnings = []
    t = tenants.add_tenant(conn, "Eve", "e.myshopify.com", "S", "M", ["496801511811310", "1222339613363462"], "EVE",
                           warnings=warnings)
    assert t.main_location_id == "gid://shopify/Location/222"
    q = [c for c in fake_clients.shopify.calls if c[0] == "ShopInfo"]
    assert q and "locations" not in tenants.SHOP_INFO_QUERY
    assert len(warnings) == 1 and "1222339613363462" in warnings[0] and "Europe/London" in warnings[0]
    assert all(c[1]["fields"] == "currency,timezone_name" for c in fake_clients.meta.calls)


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


class _Resp:
    def __init__(self, body, status=200, headers=None):
        self._body, self.status_code, self.headers = body, status, headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Error")

    def json(self):
        return self._body


def test_clients_use_env_token_and_urls(monkeypatch, tenant_a):
    """C3: the Meta token travels in an Authorization header, never in the URL or query params."""
    seen = {}

    def post(url, json=None, headers=None, timeout=None):
        seen["post"] = (url, headers); return _Resp({"data": {"ok": 1}})

    def get(url, params=None, headers=None, timeout=None):
        seen["get"] = (url, params, headers); return _Resp({"id": "act_1"})

    monkeypatch.setattr("engine.tenants.requests.post", post)
    monkeypatch.setattr("engine.tenants.requests.get", get)
    monkeypatch.setenv("A_SHOPIFY_TOKEN", "tok1")
    monkeypatch.setenv("A_META_TOKEN", "tok2")
    assert tenants.shopify_client(tenant_a).graphql("query Q { x }") == {"ok": 1}
    assert seen["post"] == ("https://a.myshopify.com/admin/api/2025-10/graphql.json",
                            {"X-Shopify-Access-Token": "tok1"})
    tenants.meta_client(tenant_a).get("act_1", {"fields": "currency"})
    assert seen["get"] == ("https://graph.facebook.com/v23.0/act_1", {"fields": "currency"},
                           {"Authorization": "Bearer tok2"})
    assert "tok2" not in repr(seen["get"][:2])


def test_missing_env_var_names_the_variable(monkeypatch, tenant_a):
    monkeypatch.delenv("A_SHOPIFY_TOKEN", raising=False)
    monkeypatch.delenv("A_META_TOKEN", raising=False)
    with pytest.raises(tenants.MissingTokenError, match="A_SHOPIFY_TOKEN"):
        tenants.shopify_client(tenant_a).graphql("query Q { x }")
    with pytest.raises(tenants.MissingTokenError, match="A_META_TOKEN"):
        tenants.meta_client(tenant_a).get("act_1")


def test_shopify_retries_throttled_and_http_errors(monkeypatch, tenant_a):
    waits = []
    monkeypatch.setattr(tenants, "_sleep", waits.append)
    monkeypatch.setenv("A_SHOPIFY_TOKEN", "tok1")
    throttled = {"errors": [{"message": "Throttled", "extensions": {"code": "THROTTLED"}}],
                 "extensions": {"cost": {"requestedQueryCost": 500, "actualQueryCost": None,
                                         "throttleStatus": {"maximumAvailable": 1000, "currentlyAvailable": 100,
                                                            "restoreRate": 50}}}}
    replies = [_Resp({}, 429, {"Retry-After": "2"}), _Resp({}, 503), _Resp(throttled), _Resp({"data": {"ok": 1}})]
    monkeypatch.setattr("engine.tenants.requests.post", lambda *a, **k: replies.pop(0))
    assert tenants.shopify_client(tenant_a).graphql("query Q { x }") == {"ok": 1}
    assert waits[0] == 2.0                      # Retry-After honoured
    assert waits[2] == pytest.approx((500 - 100) / 50 + 0.5)     # waits for the bucket to refill
    # a non throttle error is not retried
    monkeypatch.setattr("engine.tenants.requests.post",
                        lambda *a, **k: _Resp({"errors": [{"message": "Field x doesn't exist"}]}))
    with pytest.raises(RuntimeError, match="doesn't exist"):
        tenants.shopify_client(tenant_a).graphql("query Q { x }")


def test_meta_retries_transient_codes_and_5xx(monkeypatch, tenant_a):
    waits = []
    monkeypatch.setattr(tenants, "_sleep", waits.append)
    monkeypatch.setenv("A_META_TOKEN", "EAAGsecretsecretsecretsecret1234")
    replies = [_Resp({"error": {"code": 17, "message": "User request limit reached"}}, 400),
               _Resp({}, 502), _Resp({"error": {"code": 80004, "message": "too many calls"}}, 400),
               _Resp({"data": [1]})]
    monkeypatch.setattr("engine.tenants.requests.get", lambda *a, **k: replies.pop(0))
    assert tenants.meta_client(tenant_a).get("act_1/insights") == {"data": [1]}
    assert len(waits) == 3
    monkeypatch.setattr("engine.tenants.requests.get", lambda *a, **k: _Resp(
        {"error": {"code": 190, "message": "Invalid token EAAGsecretsecretsecretsecret1234 access_token=x"}}, 400))
    with pytest.raises(tenants.MetaError) as e:
        tenants.meta_client(tenant_a).get("act_1/insights")
    assert "EAAGsecret" not in str(e.value) and "access_token=x" not in str(e.value)
    assert len(waits) == 3                      # code 190 is not retried


def test_redact(monkeypatch, tenant_a):
    monkeypatch.setenv("A_META_TOKEN", "plain-meta-token-value")
    msg = ("HTTPError for url: https://graph.facebook.com/v23.0/act_1?access_token=abc123&fields=x "
           "token plain-meta-token-value shpat_0123456789abcdef EAAB0123456789abcdefghijklmnop Bearer zzz.yyy")
    out = tenants.redact(msg, tenant_a)
    for secret in ("abc123", "plain-meta-token-value", "shpat_0123456789abcdef", "EAAB0123456789abcdefghijklmnop",
                   "zzz.yyy"):
        assert secret not in out
    assert "fields=x" in out


def test_meta_client_redacts_tenant_token_whatever_the_env_name(monkeypatch, tenant_a):
    """N2: the token value is removed even when its env var name does not end in TOKEN and it has no known shape."""
    tenant_a.meta_token_env = "A_META_KEY"
    monkeypatch.setenv("A_META_KEY", "plainsecretvalue123")
    monkeypatch.setattr("engine.tenants.requests.get", lambda *a, **k: _Resp(
        {"error": {"code": 190, "message": "Invalid OAuth token plainsecretvalue123"}}, 400))
    with pytest.raises(tenants.MetaError) as e:
        tenants.MetaClient(tenant_a).get("act_1")
    assert "plainsecretvalue123" not in str(e.value) and "code 190" in str(e.value)
    assert "plainsecretvalue123" not in tenants.redact("x plainsecretvalue123", env_names=["A_META_KEY"])


def test_set_main_location(conn, tenant_a):
    t = tenants.set_main_location(conn, tenant_a, "gid://shopify/Location/999")
    assert t.main_location_id == "gid://shopify/Location/999"
    assert tenants.set_main_location(conn, tenant_a, "1234").main_location_id == "gid://shopify/Location/1234"
    with pytest.raises(ValueError):
        tenants.set_main_location(conn, tenant_a, "gid://shopify/Product/1")


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
