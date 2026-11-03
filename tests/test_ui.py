"""Local web screen: pages, safety (Host, Origin, CSRF), PO actions, setup (tokens to the env file only), the
background cycle with its progress endpoint, and the sample store.

Demo backed tests run on a copy of a sample store database built once per session (engine_test_ui_tpl, a sibling
of the test DB); setup tests use the conftest test DB and fake clients.
"""
import os
import re
import stat
import time

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import make_conninfo

from engine import db, demo, tenants
from engine.ui.app import UiConfig, create_app
from conftest import TEST_URL

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
TEMPLATE_URL = make_conninfo(TEST_URL, dbname="engine_test_ui_tpl")
DEMO_URL = make_conninfo(TEST_URL, dbname="engine_test_ui")
PAGES = ["/", "/lost-sales", "/scorecard", "/scorecard?level=product", "/pos", "/plan", "/run", "/setup"]


def _admin(sql):
    with psycopg.connect(make_conninfo(TEST_URL, dbname="postgres"), autocommit=True) as c:
        c.execute(sql)


@pytest.fixture(scope="session")
def demo_template():
    """The sample store, loaded once through its own fake clients into a template database."""
    mp = pytest.MonkeyPatch()
    try:
        demo.reset_database(TEMPLATE_URL)
        store = demo.DemoStore()
        demo.install(store, mp.setattr)
        with db.connect(TEMPLATE_URL) as c:
            demo.load(c, store)
    finally:
        mp.undo()
    return TEMPLATE_URL


@pytest.fixture
def demo_env(demo_template, monkeypatch):
    """A fresh copy of the sample store database, the demo fake clients installed, and the demo tenant."""
    _admin("DROP DATABASE IF EXISTS engine_test_ui WITH (FORCE)")
    _admin("CREATE DATABASE engine_test_ui TEMPLATE engine_test_ui_tpl")
    store = demo.DemoStore()
    shop, meta = demo.install(store, monkeypatch.setattr)
    with db.connect(DEMO_URL) as c:
        t = tenants.list_tenants(c)[0]
    return {"store": store, "shop": shop, "meta": meta, "tenant": t}


def make_client(tmp_path, url=DEMO_URL, is_demo=True, **kw):
    cfg = UiConfig(port=PORT, connect=lambda: db.connect(url), demo=is_demo, env_file=tmp_path / "engine_env", **kw)
    app = create_app(cfg)
    return app, TestClient(app, base_url=BASE)


@pytest.fixture
def ui(demo_env, tmp_path):
    app, client = make_client(tmp_path)
    return app, client


def post(app, client, path, data=None, **kw):
    return client.post(path, data={"csrf": app.state.csrf, **(data or {})}, follow_redirects=False, **kw)


def po_state(po):
    with db.connect(DEMO_URL) as c:
        return c.execute("SELECT state, transfer_id FROM purchase_orders WHERE po_number = %s", (po,)).fetchone()


# ---------------------------------------------------------------- sample store

def test_demo_store_decisions(demo_template):
    with db.connect(demo_template) as c:
        run = c.execute("SELECT run_id FROM runs WHERE status = 'done' ORDER BY started_at DESC LIMIT 1").fetchone()
        dec = {r["entity_id"]: r["decision"] for r in c.execute(
            "SELECT entity_id, decision FROM decisions WHERE run_id = %s AND level = 'style'", (run["run_id"],))}
        drafts = c.execute("SELECT count(*) AS n FROM purchase_orders WHERE state = 'draft'").fetchone()["n"]
        cur = c.execute("SELECT DISTINCT currency FROM tenants").fetchall()
    assert {"SCALE", "RESTOCK FIRST", "CUT SPEND"} <= set(dec.values())
    assert dec == {"1-silk-dress": "SCALE", "1-linen-shirt": "RESTOCK FIRST", "1-wool-coat": "CUT SPEND",
                   "1-cotton-tee": "SCALE"}
    assert drafts == 2 and [r["currency"] for r in cur] == ["EGP"]


# ---------------------------------------------------------------- pages

def test_every_page_renders(ui):
    app, client = ui
    for path in PAGES:
        r = client.get(path)
        assert r.status_code == 200, (path, r.text[:500])
        assert "Sample store, made up data" in r.text
        assert "Traceback" not in r.text
    assert client.get("/static/style.css").status_code == 200


def test_overview_shows_decisions_status_and_counts(ui):
    app, client = ui
    html = client.get("/").text
    for text in ("Silk Dress", "Linen Shirt", "Wool Coat", "Cotton Tee", "Silk Dress Black", "SCALE", "RESTOCK FIRST",
                 "CUT SPEND", "2026-10", "EGP", "missing_cost", "Draft purchase orders"):
        assert text in html, text
    assert re.search(r'class="count[^"]*"[^>]*>\s*2\s*<', html)            # two draft POs
    assert "gid://" not in html


def test_lost_sales_scorecard_plan(ui):
    app, client = ui
    lost = client.get("/lost-sales").text
    assert "Linen Shirt" in lost and "<svg" in lost and "Lost to stock" in lost and "Unexplained" in lost
    score = client.get("/scorecard").text
    assert "Profit per" in score and "(POAS)" in score and "Silk Dress" in score and "data-sort" in score
    prod = client.get("/scorecard?level=product").text
    assert "Silk Dress Black" in prod and "gid://" not in prod and "missing_cost" in prod
    plan = client.get("/plan").text
    assert "DEMOPO202611001" in plan and "Wool Coat" in plan


def test_purchase_order_pages(ui):
    app, client = ui
    lst = client.get("/pos").text
    assert "DEMOPO202611001" in lst and "DEMOPO202611002" in lst and "Cairo Atelier" in lst
    po = client.get("/pos/DEMOPO202611001").text
    assert "Linen Shirt Blue" in po and "Approve" in po and 'name="qty_' in po
    assert client.get("/pos/NOPE").status_code == 404


def test_pages_choose_tenant_and_run(ui, demo_env):
    app, client = ui
    t = demo_env["tenant"]
    with db.connect(DEMO_URL) as c:
        runs = [r["run_id"] for r in c.execute("SELECT run_id FROM runs ORDER BY started_at")]
    r = client.get(f"/?tenant={t.tenant_id}&run={runs[0]}")
    assert r.status_code == 200 and runs[0] in r.text
    assert runs[1] in client.get("/").text                 # default: the latest done run


# ---------------------------------------------------------------- safety

def test_wrong_host_rejected(ui):
    app, client = ui
    for base in ("http://evil.example:8765", "http://127.0.0.1:9999", "http://localhost.evil.example:8765"):
        r = TestClient(app, base_url=base).get("/")
        assert r.status_code == 400, base
    assert TestClient(app, base_url=f"http://localhost:{PORT}").get("/").status_code == 200


def test_every_post_needs_the_csrf_token(ui):
    app, client = ui
    posts = [r.path.replace("{po}", "DEMOPO202611001") for r in app.routes if "POST" in getattr(r, "methods", ())]
    assert len(posts) >= 10
    for path in posts:
        assert client.post(path, data={}, follow_redirects=False).status_code == 403, path
        assert client.post(path, data={"csrf": "wrong"}, follow_redirects=False).status_code == 403, path
    assert po_state("DEMOPO202611001")["state"] == "draft"


def test_cross_origin_post_rejected(ui):
    app, client = ui
    r = post(app, client, "/pos/DEMOPO202611001/approve", headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    assert po_state("DEMOPO202611001")["state"] == "draft"
    r = post(app, client, "/pos/DEMOPO202611001/approve", headers={"Origin": BASE})
    assert r.status_code == 303 and po_state("DEMOPO202611001")["state"] == "approved"


# ---------------------------------------------------------------- purchase orders

def test_approve_with_edits_then_push_with_confirmation(ui, demo_env):
    app, client = ui
    with db.connect(DEMO_URL) as c:
        lines = c.execute("SELECT variant_id, qty_suggested FROM po_lines WHERE po_number = 'DEMOPO202611001'"
                          " ORDER BY variant_id").fetchall()
    first = lines[0]["variant_id"]
    r = post(app, client, "/pos/DEMOPO202611001/approve", {f"qty_{first}": "5"})
    assert r.status_code == 303
    with db.connect(DEMO_URL) as c:
        got = {r["variant_id"]: r["qty_approved"] for r in c.execute(
            "SELECT variant_id, qty_approved FROM po_lines WHERE po_number = 'DEMOPO202611001'")}
    assert got[first] == 5 and all(got[ln["variant_id"]] == ln["qty_suggested"] for ln in lines[1:])

    # the first click only asks; nothing reaches the (fake) Shopify
    page = client.get("/pos/DEMOPO202611001?confirm=push").text
    assert "Yes, send" in page and "confirm()" not in page
    assert post(app, client, "/pos/DEMOPO202611001/push").status_code == 400
    assert not [op for op, _ in demo_env["shop"].calls if op.startswith("InventoryTransfer")]
    r = post(app, client, "/pos/DEMOPO202611001/push", {"confirm": "yes"})
    assert r.status_code == 303
    row = po_state("DEMOPO202611001")
    assert row["state"] == "pushed" and row["transfer_id"].startswith("gid://shopify/InventoryTransfer/demo")
    assert [op for op, _ in demo_env["shop"].calls if op.startswith("InventoryTransfer")] == \
        ["InventoryTransferCreate", "InventoryTransferMarkReady"]

    r = post(app, client, "/pos/sync", {"next": "/pos"})
    assert r.status_code == 303 and po_state("DEMOPO202611001")["state"] == "received"


def test_push_without_approval_is_refused_readably(ui, demo_env):
    app, client = ui
    r = post(app, client, "/pos/DEMOPO202611002/push", {"confirm": "yes"})
    assert r.status_code == 400
    assert "only an approved PO can be pushed" in r.text and "Traceback" not in r.text
    assert po_state("DEMOPO202611002")["state"] == "draft"
    assert not [op for op, _ in demo_env["shop"].calls if op.startswith("InventoryTransfer")]


def test_cancel_needs_confirmation(ui):
    app, client = ui
    assert post(app, client, "/pos/DEMOPO202611002/cancel").status_code == 400
    assert po_state("DEMOPO202611002")["state"] == "draft"
    assert "Yes, cancel" in client.get("/pos/DEMOPO202611002?confirm=cancel").text
    assert post(app, client, "/pos/DEMOPO202611002/cancel", {"confirm": "yes"}).status_code == 303
    assert po_state("DEMOPO202611002")["state"] == "cancelled"


def test_shopify_error_is_shown_redacted(ui, demo_env, monkeypatch):
    app, client = ui
    monkeypatch.setenv("DEMO_SHOPIFY_TOKEN", "shpat_supersecret0123456789")

    def boom(query, variables=None):
        raise RuntimeError("Shopify said no to shpat_supersecret0123456789")
    monkeypatch.setattr(demo_env["shop"], "graphql", boom)
    assert post(app, client, "/pos/DEMOPO202611001/approve").status_code == 303
    r = post(app, client, "/pos/DEMOPO202611001/push", {"confirm": "yes"})
    assert r.status_code == 502
    assert "Shopify said no" in r.text and "shpat_supersecret" not in r.text and "[REDACTED]" in r.text
    assert po_state("DEMOPO202611001")["state"] == "approved"


# ---------------------------------------------------------------- run

def test_cycle_runs_in_background_with_progress(ui, demo_env):
    app, client = ui
    t = demo_env["tenant"]
    r = post(app, client, "/run/cycle")
    assert r.status_code == 303
    again = post(app, client, "/run/cycle")                 # a second click shows the running one
    assert again.status_code == 303
    seen_running = client.get(f"/api/progress?tenant={t.tenant_id}").json()
    assert seen_running["job"]["kind"] == "cycle"
    app.state.jobs.wait(t.tenant_id, timeout=120)
    p = client.get(f"/api/progress?tenant={t.tenant_id}").json()
    assert p["job"]["state"] == "done" and p["run"]["status"] == "done"
    names = [s["name"] for s in p["run"]["stages"]]
    assert names[:3] == ["sync_products", "ingest_orders", "ingest_spend"] and "run_decisions" in names
    assert all(s["status"] in ("done", "warning", "failed") and s["seconds"] is not None for s in p["run"]["stages"])
    with db.connect(DEMO_URL) as c:
        assert c.execute("SELECT count(*) AS n FROM runs").fetchone()["n"] == 3     # one new run, not two
        assert c.execute("SELECT count(*) AS n FROM purchase_orders WHERE state NOT IN ('draft')").fetchone()["n"] == 0
    assert not [op for op, _ in demo_env["shop"].calls if op.startswith("InventoryTransfer")]
    assert "Run monthly cycle" in client.get("/run").text


def test_snapshot_button(ui, demo_env):
    app, client = ui
    r = post(app, client, "/run/snapshot")
    assert r.status_code == 303
    assert "stock rows" in client.get(r.headers["location"]).text


# ---------------------------------------------------------------- setup (sample store)

def test_setup_lists_and_actions(ui, demo_env):
    app, client = ui
    html = client.get("/setup").text
    assert "Cairo Atelier" in html and "Istanbul Mill" in html and "Main location" in html
    assert post(app, client, "/setup/supplier", {"name": "Alex Knits", "kind": "external", "lead_time": "30",
                                                 "pack": "4", "moq": "8", "target": "style:1-wool-coat"}).status_code == 303
    assert post(app, client, "/setup/promo", {"start": "2026-11-20", "end": "2026-11-22"}).status_code == 303
    assert post(app, client, "/setup/location", {"location": "gid://shopify/Location/1"}).status_code == 303
    bad = post(app, client, "/setup/supplier", {"name": "X", "kind": "boat", "lead_time": "3", "pack": "1", "moq": "0",
                                                "target": ""})
    assert bad.status_code == 400 and "kind must be factory or external" in bad.text
    with db.connect(DEMO_URL) as c:
        assert c.execute("SELECT ps.style_id FROM suppliers s JOIN product_suppliers ps USING (tenant_id, supplier_id)"
                         " WHERE s.name = 'Alex Knits'").fetchone()["style_id"] == "1-wool-coat"
        assert c.execute("SELECT count(*) AS n FROM calendar WHERE flags -> 'promo' = 'true'").fetchone()["n"] == 3
    assert "Alex Knits" in client.get("/setup").text


def test_lineage_confirm_and_ad_map(ui, demo_env):
    app, client = ui
    t = demo_env["tenant"]
    with db.connect(DEMO_URL) as c:
        c.execute("INSERT INTO variant_lineage (tenant_id, old_variant_id, new_variant_id, method, candidates)"
                  " VALUES (%s, 'gid://shopify/ProductVariant/101', 'gid://shopify/ProductVariant/111', 'title', 2)",
                  (t.tenant_id,))
        c.execute("INSERT INTO unmapped_spend_log (tenant_id, date, account_id, ad_id, ad_name, spend, reason)"
                  " VALUES (%s, '2026-10-05', %s, 'ad77', 'mystery ad', 123.5, 'no product')", (t.tenant_id, demo.ACCOUNT))
        c.commit()
    html = client.get("/setup").text
    assert "mystery ad" in html and "Silk Dress Black" in html and "Confirm" in html
    overview = client.get("/").text
    assert "Colour matches to review" in overview and "Unmapped ad spend" in overview
    assert post(app, client, "/setup/lineage/confirm", {"old": "gid://shopify/ProductVariant/101",
                                                        "new": "gid://shopify/ProductVariant/111"}).status_code == 303
    r = post(app, client, "/setup/ad-map", {"ad_id": "ad77", "product_1": "silk-dress-black", "share_1": "3",
                                            "product_2": "gid://shopify/Product/11", "share_2": "1"})
    assert r.status_code == 303
    with db.connect(DEMO_URL) as c:
        assert c.execute("SELECT confirmed FROM variant_lineage WHERE old_variant_id = 'gid://shopify/ProductVariant/101'"
                         ).fetchone()["confirmed"]
        shares = {r["product_id"]: float(r["share"]) for r in c.execute(
            "SELECT product_id, share FROM ad_product_map WHERE ad_id = 'ad77'")}
    assert shares == {"gid://shopify/Product/10": 3.0, "gid://shopify/Product/11": 1.0}


def test_demo_refuses_to_write_tokens(ui, tmp_path):
    app, client = ui
    r = post(app, client, "/setup/store", {"name": "Eve", "shop": "eve.myshopify.com", "shopify_token": "shpat_x123456",
                                           "meta_token": "EAAx", "meta_accounts": "1", "po_prefix": "EVE"})
    assert r.status_code == 400 and "shpat_x123456" not in r.text
    assert not (tmp_path / "engine_env").exists()


# ---------------------------------------------------------------- setup (connect a store, test DB)

def test_connect_store_writes_tokens_to_env_file_only(conn, fake_clients, tmp_path, monkeypatch):
    for module in ("engine.ingest_shopify", "engine.ingest_meta"):      # the history job never leaves the process
        monkeypatch.setattr(f"{module}.shopify_client", lambda t: fake_clients.shopify)
    monkeypatch.setattr("engine.ingest_meta.meta_client", lambda t: fake_clients.meta)
    for name in ("TENANT_C_SHOPIFY_TOKEN", "TENANT_C_META_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(os, "environ", os.environ.copy())      # the process env changes are undone
    env_file = tmp_path / "engine_env"
    env_file.write_text('# mine\nexport OTHER="keep"\nexport TENANT_C_SHOPIFY_TOKEN="old"\n')
    app, client = make_client(tmp_path, url=TEST_URL, is_demo=False)
    shop_token, meta_token = "shpat_c0ffee1234567890", "EAAsecretmetatoken1234567890abcd"
    r = post(app, client, "/setup/store", {
        "name": "Tenant C", "shop": "c.myshopify.com", "shopify_token": shop_token, "meta_token": meta_token,
        "meta_accounts": "496801511811310", "po_prefix": "C"})
    assert r.status_code == 303, r.text
    page = client.get(r.headers["location"]).text
    for html in (r.text, page, client.get("/setup").text):
        assert shop_token not in html and meta_token not in html
    text = env_file.read_text()
    assert f'export TENANT_C_SHOPIFY_TOKEN="{shop_token}"' in text and f'export TENANT_C_META_TOKEN="{meta_token}"' in text
    assert 'export OTHER="keep"' in text and "# mine" in text and text.count("TENANT_C_SHOPIFY_TOKEN") == 1
    assert stat.S_IMODE(env_file.stat().st_mode) == 0o600
    assert os.environ["TENANT_C_SHOPIFY_TOKEN"] == shop_token
    row = conn.execute("SELECT * FROM tenants WHERE name = 'Tenant C'").fetchone()
    assert row["shopify_token_env"] == "TENANT_C_SHOPIFY_TOKEN" and row["meta_token_env"] == "TENANT_C_META_TOKEN"
    assert shop_token not in str(row) and meta_token not in str(row)
    app.state.jobs.wait(row["tenant_id"], timeout=60)      # the history job (fails on the bare fixtures, readably)
    p = client.get(f"/api/progress?tenant={row['tenant_id']}").json()
    assert p["job"]["kind"] == "history" and p["job"]["stages"][0]["name"] == "sync_products"
    assert p["job"]["state"] in ("done", "failed") and p["run"] is None
    assert shop_token not in str(p) and meta_token not in str(p)


def test_connect_store_new_env_file_and_error_redacted(conn, fake_clients, tmp_path, monkeypatch):
    monkeypatch.setattr(os, "environ", os.environ.copy())
    app, client = make_client(tmp_path, url=TEST_URL, is_demo=False)

    def boom(query, variables=None):
        raise RuntimeError("Shopify rejected shpat_badbadbad123456")
    monkeypatch.setattr(fake_clients.shopify, "graphql", boom)
    r = post(app, client, "/setup/store", {"name": "Eve", "shop": "eve.myshopify.com",
                                           "shopify_token": "shpat_badbadbad123456", "meta_token": "EAAmeta987654321xyz",
                                           "meta_accounts": "1", "po_prefix": "EVE"})
    assert r.status_code == 502 and "Shopify rejected" in r.text
    assert "shpat_badbadbad123456" not in r.text and "EAAmeta987654321xyz" not in r.text
    assert stat.S_IMODE((tmp_path / "engine_env").stat().st_mode) == 0o600
    assert conn.execute("SELECT count(*) AS n FROM tenants").fetchone()["n"] == 0


def test_no_tenant_goes_to_setup(conn, tmp_path):
    app, client = make_client(tmp_path, url=TEST_URL, is_demo=False)
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/setup"
    html = client.get("/setup").text
    assert "Connect a store" in html and 'type="password"' in html


def test_database_unreachable_shows_setup_page(tmp_path):
    def down():
        raise psycopg.OperationalError("connection refused")
    app = create_app(UiConfig(port=PORT, connect=down, env_file=tmp_path / "e", database_configured=True))
    client = TestClient(app, base_url=BASE)
    for path in ("/", "/pos", "/setup"):
        r = client.get(path)
        assert r.status_code == 503 and "database" in r.text.lower() and "Traceback" not in r.text
    app = create_app(UiConfig(port=PORT, connect=down, env_file=tmp_path / "e", database_configured=False))
    r = TestClient(app, base_url=BASE).get("/")
    assert r.status_code == 503 and "DATABASE_URL" in r.text
