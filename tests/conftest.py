"""Shared fixtures: real Postgres test DB, two tenants, and a fake Shopify/Meta client.

Fake client API (reuse in later tasks):
  fake_clients (fixture) -> FakeApis, already monkeypatched into engine.tenants
    (shopify_client / meta_client). Add other modules with
    fake_clients.patch(monkeypatch, "engine.ingest_shopify").
  fake_clients.shopify.graphql(query, variables): finds the operation name in the
    query text (`query Name` / `mutation Name`) and returns the JSON in
    tests/fixtures/shopify/<Name>.json (the object holds the full response; the
    client returns its "data"). Override with fake_clients.shopify.respond(Name, obj_or_callable).
  fake_clients.meta.get(path, params): returns tests/fixtures/meta/<path with / -> __>.json;
    override with fake_clients.meta.respond(path, obj_or_callable(params)).
  Every call is recorded in .calls as (name_or_path, variables_or_params). No network.
"""
import json
import os
import re
from pathlib import Path

import psycopg
import pytest

from engine import db, tenants

FIXTURES = Path(__file__).parent / "fixtures"
TEST_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres@localhost:5432/engine_test")


def load_fixture(kind: str, name: str):
    return json.loads((FIXTURES / kind / f"{name}.json").read_text())


class _Fake:
    kind = ""

    def __init__(self):
        self.overrides = {}
        self.calls = []

    def respond(self, key, response):
        self.overrides[key] = response

    def _resolve(self, key, arg):
        r = self.overrides[key] if key in self.overrides else load_fixture(self.kind, key.replace("/", "__"))
        return r(arg) if callable(r) else r


class FakeShopify(_Fake):
    kind = "shopify"

    def __init__(self, t=None):
        super().__init__()

    def graphql(self, query, variables=None):
        m = re.search(r"\b(?:query|mutation)\s+(\w+)", query)
        if not m:
            raise AssertionError("fake Shopify needs a named operation")
        self.calls.append((m.group(1), variables))
        return self._resolve(m.group(1), variables)["data"]


class FakeMeta(_Fake):
    kind = "meta"

    def __init__(self, t=None):
        super().__init__()

    def get(self, path, params=None):
        self.calls.append((path, params))
        return self._resolve(path.strip("/"), params)


class FakeApis:
    def __init__(self):
        self.shopify = FakeShopify()
        self.meta = FakeMeta()

    def patch(self, monkeypatch, module="engine.tenants"):
        monkeypatch.setattr(f"{module}.shopify_client", lambda t: self.shopify)
        monkeypatch.setattr(f"{module}.meta_client", lambda t: self.meta)


@pytest.fixture
def fake_clients(monkeypatch):
    apis = FakeApis()
    apis.patch(monkeypatch)
    return apis


@pytest.fixture(scope="session")
def _schema():
    with psycopg.connect(TEST_URL, autocommit=True) as c:
        c.execute("DROP SCHEMA public CASCADE")
        c.execute("CREATE SCHEMA public")
    with db.connect(TEST_URL) as c:
        db.migrate(c)


@pytest.fixture
def conn(_schema):
    c = db.connect(TEST_URL)
    names = [r["tablename"] for r in c.execute(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'")]
    if names:
        c.execute("TRUNCATE " + ", ".join(names) + " RESTART IDENTITY CASCADE")
        c.commit()
    yield c
    c.rollback()
    c.close()


def _insert_tenant(conn, name, domain, prefix, accounts):
    row = conn.execute(
        "INSERT INTO tenants (name, shop_domain, shopify_token_env, meta_token_env, meta_account_ids,"
        " timezone, currency, po_prefix, main_location_id, pixel_key)"
        " VALUES (%s,%s,%s,%s,%s,'Africa/Cairo','EGP',%s,'gid://shopify/Location/222',%s)"
        " RETURNING " + ", ".join(tenants._COLS),
        (name, domain, f"{prefix}_SHOPIFY_TOKEN", f"{prefix}_META_TOKEN", accounts, prefix, f"pixel-{prefix}"),
    ).fetchone()
    conn.commit()
    return tenants.Tenant(**row)


@pytest.fixture
def tenant_a(conn):
    return _insert_tenant(conn, "Tenant A", "a.myshopify.com", "A", ["496801511811310"])


@pytest.fixture
def tenant_b(conn):
    return _insert_tenant(conn, "Tenant B", "b.myshopify.com", "B", ["1222339613363462"])
