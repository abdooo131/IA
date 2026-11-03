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


SHOPIFY_MAX_QUERY_COST = 1000
_TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|\$?\w+|[{}():\[\],!@]')


def _tokens(text):
    return [t for t in _TOKEN.findall(text)]


def _skip_parens(tok, i):
    """Index after the balanced (...) starting at tok[i]; returns (args dict of name -> raw value, index)."""
    args, depth, j = {}, 0, i
    while True:
        t = tok[j]
        if t == "(":
            depth += 1
        elif t == ")":
            depth -= 1
            if depth == 0:
                return args, j + 1
        elif depth == 1 and j + 2 < len(tok) and tok[j + 1] == ":" and re.fullmatch(r"\w+", t):
            args[t] = tok[j + 2]
        j += 1


def _selection_cost(tok, i, variables):
    """Cost of a selection set starting after '{' at tok[i]; returns (cost, index after the closing '}').

    Shopify's requested cost: an object field costs 1 plus its selection; a connection (a field with `first:`)
    costs 2 + first x (cost of one node); scalars cost 0; pageInfo is free; nodes/edges are the node itself.
    """
    total = 0
    while tok[i] != "}":
        name = tok[i]
        i += 1
        if name in ("...", "@"):
            continue
        args = {}
        if i < len(tok) and tok[i] == "(":
            args, i = _skip_parens(tok, i)
        while i < len(tok) and tok[i] == "@":            # directives
            i += 2
            if tok[i] == "(":
                _, i = _skip_parens(tok, i)
        if i < len(tok) and tok[i] == "{":
            inner, i = _selection_cost(tok, i + 1, variables)
            if name == "pageInfo":
                continue
            if "first" in args:
                raw = args["first"]
                n = int(variables.get(raw[1:], 0) if raw.startswith("$") else raw)
                total += 2 + n * inner
            elif name in ("nodes", "edges", "node"):
                total += 1 + inner
            else:
                total += 1 + inner
    return total, i + 1


def query_cost(query: str, variables: dict | None = None) -> int:
    """Requested cost estimate of a GraphQL operation, as Shopify computes it before running the query."""
    tok = _tokens(query)
    i = tok.index("{")
    return _selection_cost(tok, i + 1, variables or {})[0]


class FakeShopify(_Fake):
    kind = "shopify"

    def __init__(self, t=None):
        super().__init__()

    def graphql(self, query, variables=None):
        m = re.search(r"\b(?:query|mutation)\s+(\w+)", query)
        if not m:
            raise AssertionError("fake Shopify needs a named operation")
        cost = query_cost(query, variables)
        if cost > SHOPIFY_MAX_QUERY_COST:
            raise AssertionError(f"{m.group(1)}: requested query cost {cost} exceeds {SHOPIFY_MAX_QUERY_COST}")
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
