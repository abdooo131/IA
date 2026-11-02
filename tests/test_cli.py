"""CLI and monthly cycle: two tenants end to end through fake Shopify and Meta, never pushing a PO."""
import json
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from typer.testing import CliRunner

from engine import cli, db
from conftest import TEST_URL, FakeApis

TODAY = date(2026, 11, 2)          # tenant local today: previous complete month is 2026-10
START = date(2026, 8, 1)           # first order and spend day
END = TODAY - timedelta(days=1)
PUSH_OPS = {"InventoryTransferCreate", "InventoryTransferMarkReady", "InventoryTransferCancel"}

# products: (product number, handle, title, colour, price, [(variant number, size, unit cost)])
SHOPS = {
    "A": {"products": [(10, "silk-dress-black", "Silk Dress Black", "Black", 500.0,
                        [(101, "S", 250.0), (102, "M", 250.0)]),
                       (20, "fustan-ahmar", "Fustan Ahmar", "Red", 400.0, [(201, "L", 180.0)])],
          "ads": [("a1", "silk-dress-black_VID_X"), ("a9", "mystery_ad")]},
    "B": {"products": [(9010, "linen-shirt-blue", "Linen Shirt Blue", "Blue", 300.0,
                        [(90101, "S", 120.0), (90102, "M", 120.0)])],
          "ads": [("b1", "linen-shirt-blue_IMG_Y")]},
}
ACCOUNT = {"A": "496801511811310", "B": "1222339613363462"}


def gid(kind, n):
    return f"gid://shopify/{kind}/{n}"


def money(x):
    return {"shopMoney": {"amount": f"{x:.2f}"}}


def days(a, b):
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


# ---------------------------------------------------------------- fake store responses

def products_response(shop):
    nodes = []
    for pn, handle, title, colour, _, variants in SHOPS[shop]["products"]:
        nodes.append({"id": gid("Product", pn), "handle": handle, "title": title, "status": "ACTIVE",
                      "createdAt": "2026-01-01T09:00:00Z", "variants": {"pageInfo": {"hasNextPage": False}, "nodes": [
                          {"id": gid("ProductVariant", vn), "sku": f"{handle}-{size}",
                           "selectedOptions": [{"name": "Color", "value": colour}, {"name": "Size", "value": size}],
                           "inventoryItem": {"id": gid("InventoryItem", vn), "unitCost": {"amount": str(cost)}}}
                          for vn, size, cost in variants]}})
    return {"data": {"products": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": nodes}}}


def all_orders(shop):
    out, n = [], 0
    ad_id = SHOPS[shop]["ads"][0][0]
    for i, d in enumerate(days(START, END)):
        for j, (pn, handle, _, _, price, variants) in enumerate(SHOPS[shop]["products"]):
            n += 1
            vn = variants[(i + j) % len(variants)][0]
            qty = 1 + (i + j) % 3
            utm = {"lastVisit": {"landingPage": None, "utmParameters": {"source": "facebook", "content": ad_id}}} \
                if i % 2 == 0 else None
            out.append({
                "id": gid("Order", f"{pn}{n:05d}"), "createdAt": f"{d.isoformat()}T10:00:00Z", "cancelledAt": None,
                "email": None, "phone": None,
                "customer": {"id": gid("Customer", f"{pn}{n % 40}"), "email": None, "phone": f"010{pn:04d}{n % 40:04d}"},
                "totalPriceSet": money(qty * price), "customerJourneySummary": utm,
                "lineItems": {"pageInfo": {"hasNextPage": False}, "nodes": [
                    {"id": gid("LineItem", f"{pn}{n}"), "quantity": qty, "variant": {"id": gid("ProductVariant", vn)},
                     "discountedTotalSet": money(qty * price)}]},
                "refunds": []})
    return out


def orders_response(shop):
    orders = all_orders(shop)

    def respond(variables):
        lo, hi = re.findall(r"'([^']+)'", variables["query"])
        nodes = [o for o in orders if lo <= o["createdAt"] < hi]
        return {"data": {"orders": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": nodes}}}
    return respond


def landing_response(shop):
    def respond(variables):
        since, until = re.search(r"SINCE (\S+) UNTIL (\S+)", variables["q"]).groups()
        rows = [{"landing_page_path": f"/products/{p[1]}", "day": d.isoformat(), "sessions": str(60 + 7 * i % 23)}
                for i, d in enumerate(days(date.fromisoformat(since), date.fromisoformat(until)))
                for p in SHOPS[shop]["products"]]
        return {"data": {"shopifyqlQuery": {"parseErrors": [], "tableData": {"columns": [], "rows": rows}}}}
    return respond


def insights_response(shop):
    def respond(params):
        if "breakdowns" in params:
            return {"data": []}
        rng = json.loads(params["time_range"])
        lo, hi = max(date.fromisoformat(rng["since"]), START), min(date.fromisoformat(rng["until"]), END)
        rows = []
        for i, d in enumerate(days(START, END)):
            if not lo <= d <= hi:
                continue
            for k, (ad_id, name) in enumerate(SHOPS[shop]["ads"]):
                spend = 80 + (i % 7) * 20 + 10 * k
                rows.append({"campaign_id": "c1", "campaign_name": "C", "adset_id": "s1", "ad_id": ad_id,
                             "ad_name": name, "date_start": d.isoformat(), "date_stop": d.isoformat(),
                             "spend": str(spend), "impressions": str(spend * 40), "clicks": "5",
                             "actions": [{"action_type": "omni_purchase", "value": str(1 + i % 3)}]})
        return {"data": rows}
    return respond


def make_fakes(shop):
    f = FakeApis()
    f.shopify.respond("Products", products_response(shop))
    f.shopify.respond("Orders", orders_response(shop))
    f.shopify.respond("FirstOrder", {"data": {"orders": {"nodes": [{"createdAt": f"{START.isoformat()}T10:00:00Z"}]}}})
    f.shopify.respond("LandingSessions", landing_response(shop))
    f.meta.respond(f"act_{ACCOUNT[shop]}/insights", insights_response(shop))
    return f


@pytest.fixture
def env(conn, tenant_a, tenant_b, monkeypatch):
    """Both tenants wired to their own fake store; the CLI connects to the test DB and lives on TODAY."""
    fakes = {tenant_a.tenant_id: make_fakes("A"), tenant_b.tenant_id: make_fakes("B")}
    for module in ("engine.tenants", "engine.ingest_shopify", "engine.ingest_meta", "engine.purchasing"):
        monkeypatch.setattr(f"{module}.shopify_client", lambda t: fakes[t.tenant_id].shopify, raising=False)
        monkeypatch.setattr(f"{module}.meta_client", lambda t: fakes[t.tenant_id].meta, raising=False)
    monkeypatch.setattr(cli, "connect", lambda: db.connect(TEST_URL))
    monkeypatch.setattr(cli, "local_today", lambda t: TODAY)
    return fakes


runner = CliRunner()


def invoke(*args):
    r = runner.invoke(cli.app, [str(a) for a in args])
    assert r.exit_code == 0, f"{args} exited {r.exit_code}\n{r.output}\n{r.exception!r}"
    return r


def add_suppliers(conn, t, shop):
    for pn, *_ in SHOPS[shop]["products"]:
        invoke("suppliers", "add", f"Factory {shop}", "--tenant", t.name, "--kind", "factory", "--lead-time", 30,
               "--pack", 2, "--product", gid("Product", pn))


def entities(conn, t):
    """Every product, variant and style id the tenant owns."""
    ids = set()
    for r in conn.execute("SELECT variant_id, product_id FROM products WHERE tenant_id = %s", (t.tenant_id,)):
        ids |= {r["variant_id"], r["product_id"]}
    ids |= {r["style_id"] for r in conn.execute("SELECT style_id FROM styles WHERE tenant_id = %s", (t.tenant_id,))}
    return ids


OUTPUTS = [("decisions", "entity_id"), ("product_plans", "entity_id"), ("model_params", "entity_id"),
           ("forecasts", "entity_id"), ("spend_by_product", "product_id"), ("order_credits", "product_id"),
           ("po_lines", "variant_id"), ("funnel_daily", "product_id"), ("product_style", "product_id"),
           ("forecast_accuracy", "entity_id")]


# ---------------------------------------------------------------- tests

def test_cycle_end_to_end_two_tenants(conn, env, tenant_a, tenant_b):
    add_suppliers(conn, tenant_a, "A")
    add_suppliers(conn, tenant_b, "B")
    invoke("cycle", "--all-tenants")

    own = {tenant_a.tenant_id: entities(conn, tenant_a), tenant_b.tenant_id: entities(conn, tenant_b)}
    assert own[tenant_a.tenant_id] and own[tenant_b.tenant_id]
    assert not own[tenant_a.tenant_id] & own[tenant_b.tenant_id]
    for t, other in ((tenant_a, tenant_b), (tenant_b, tenant_a)):
        runs = conn.execute("SELECT * FROM runs WHERE tenant_id = %s", (t.tenant_id,)).fetchall()
        assert [r["status"] for r in runs] == ["done"]
        run = runs[0]
        assert run["month"] == "2026-10" and run["run_id"].startswith("202610-") and run["finished_at"]
        stages = run["stages"]
        assert sorted(stages, key=lambda s: stages[s]["seq"]) == list(cli.CYCLE_STAGES)
        assert all(s["status"] == "done" for s in stages.values())
        assert stages["ingest_orders"]["result"]["full_history"] is True
        assert stages["ingest_orders"]["result"]["since"] == START.isoformat()
        assert stages["ingest_orders"]["result"]["until"] == END.isoformat()
        assert stages["ingest_spend"]["result"]["since"] == START.isoformat()
        assert "mape" in stages["rolling_backtest"]["result"]

        n_dec = conn.execute("SELECT count(*) n FROM decisions WHERE tenant_id = %s AND run_id = %s"
                             " AND month = '2026-10-01'", (t.tenant_id, run["run_id"])).fetchone()["n"]
        n_plan = conn.execute("SELECT count(*) n FROM product_plans WHERE tenant_id = %s AND run_id = %s",
                              (t.tenant_id, run["run_id"])).fetchone()["n"]
        assert n_dec > 0 and n_plan > 0
        # forward_plan owns the style/month forecasts of the run; nothing else writes forecasts
        fc = conn.execute("SELECT DISTINCT grain, params->>'level' lv FROM forecasts WHERE tenant_id = %s",
                          (t.tenant_id,)).fetchall()
        assert [(r["grain"], r["lv"]) for r in fc] == [("month", "style")]
        levels = {(r["lv"], r["g"]) for r in conn.execute(
            "SELECT DISTINCT params->>'level' lv, params->>'grain' g FROM model_params WHERE tenant_id = %s",
            (t.tenant_id,))}
        assert {("style", "month"), ("product", "month"), ("store", "month"), ("product", "week"),
                ("product", "day"), ("style", "week"), ("style", "day")} <= levels

        # no output of t references the other tenant's entities
        for table, col in OUTPUTS:
            vals = {r["v"] for r in conn.execute(f"SELECT DISTINCT {col} AS v FROM {table} WHERE tenant_id = %s",
                                                 (t.tenant_id,))}
            assert not vals & own[other.tenant_id], table
            assert all(v in own[t.tenant_id] or v.startswith("__") for v in vals), (table, vals)


def test_cycle_never_pushes(conn, env, tenant_a):
    add_suppliers(conn, tenant_a, "A")
    invoke("cycle", "--tenant", tenant_a.name)
    invoke("cycle", "--tenant", str(tenant_a.tenant_id))       # second run: incremental, scores the first

    calls = [name for name, _ in env[tenant_a.tenant_id].shopify.calls]
    assert not PUSH_OPS & set(calls)
    states = [r["state"] for r in conn.execute("SELECT state FROM purchase_orders WHERE tenant_id = %s",
                                               (tenant_a.tenant_id,))]
    assert states and set(states) == {"draft"}
    assert conn.execute("SELECT count(*) n FROM po_lines WHERE tenant_id = %s AND qty_approved IS NOT NULL",
                        (tenant_a.tenant_id,)).fetchone()["n"] == 0

    first, second = conn.execute("SELECT run_id, stages FROM runs WHERE tenant_id = %s AND status = 'done'"
                                 " ORDER BY started_at", (tenant_a.tenant_id,)).fetchall()
    orders = second["stages"]["ingest_orders"]["result"]
    assert orders["full_history"] is False and orders["since"] == (END - timedelta(days=7)).isoformat()
    assert second["stages"]["ingest_spend"]["result"]["since"] == (END - timedelta(days=7)).isoformat()
    assert first["run_id"] in second["stages"]["score_runs"]["result"]
    order_queries = [v["query"] for name, v in env[tenant_a.tenant_id].shopify.calls if name == "Orders"]
    lo = datetime.combine(END - timedelta(days=7), time.min, ZoneInfo("Africa/Cairo")).astimezone(timezone.utc)
    assert f"updated_at:>='{lo:%Y-%m-%dT%H:%M:%SZ}'" in order_queries[-1]


def test_cycle_failing_stage_marks_run_failed_and_continues(conn, env, tenant_a, tenant_b, monkeypatch):
    def boom(conn, t, *a, **k):
        if t.tenant_id == tenant_a.tenant_id:
            raise RuntimeError("Meta is down")
        return (0, 0)
    monkeypatch.setattr(cli.ingest_meta, "ingest_spend", boom)
    r = runner.invoke(cli.app, ["cycle", "--all-tenants"])
    assert r.exit_code != 0
    status = {row["tenant_id"]: row for row in conn.execute("SELECT tenant_id, status, stages FROM runs")}
    assert status[tenant_a.tenant_id]["status"] == "failed"
    assert "Meta is down" in status[tenant_a.tenant_id]["stages"]["ingest_spend"]["error"]
    assert "fit" not in status[tenant_a.tenant_id]["stages"]
    assert status[tenant_b.tenant_id]["status"] == "done"


def test_report_sections(conn, env, tenant_a, tmp_path):
    add_suppliers(conn, tenant_a, "A")
    invoke("cycle", "--tenant", tenant_a.name)
    conn.execute("INSERT INTO variant_lineage (tenant_id, old_variant_id, new_variant_id, effective_date, method,"
                 " confirmed, candidates) VALUES (%s,%s,%s,'2026-01-01','title',false,2)",
                 (tenant_a.tenant_id, gid("ProductVariant", 101), gid("ProductVariant", 201)))
    conn.commit()
    run = conn.execute("SELECT run_id FROM runs WHERE tenant_id = %s", (tenant_a.tenant_id,)).fetchone()["run_id"]

    rep = cli.build_report(conn, tenant_a, run, "2026-10")
    assert set(rep) == set(cli.REPORT_SECTIONS)
    assert len(rep["scorecard"]) and len(rep["decisions"]) and len(rep["plan"]) and len(rep["open_pos"])
    assert {"lost_stock", "lost_price", "unexplained"} <= set(rep["lost_sales"].columns)
    assert set(rep["lost_sales"]["entity_id"]) <= set(rep["scorecard"]["entity_id"])
    assert list(rep["unmapped_ads"]["ad_id"]) == ["a9"]
    assert len(rep["lineage_pending"]) == 1

    out = tmp_path / "rep"
    r = invoke("report", "--tenant", tenant_a.name, "--out", out)
    for name in cli.REPORT_SECTIONS:
        assert (out / f"{name}.csv").exists(), name
        assert name in r.output
    assert "mystery_ad" in (out / "unmapped_ads.csv").read_text()


@pytest.mark.parametrize("args", [
    ["ingest"], ["snapshot_stock"], ["lineage", "propose"], ["lineage", "list"], ["lineage", "confirm", "a", "b"],
    ["attribute"], ["fit"], ["plan"], ["suppliers", "list"], ["suppliers", "add", "X", "--kind", "factory",
                                                              "--lead-time", "3"],
    ["po", "suggest"], ["po", "list"], ["po", "approve", "P1"], ["po", "push", "P1"], ["po", "sync"],
    ["po", "cancel", "P1"], ["decide"], ["report"], ["backtest"], ["cycle"]])
def test_commands_require_tenant(conn, env, args):
    r = runner.invoke(cli.app, args)
    assert r.exit_code != 0
    assert "--tenant" in r.output


def test_tenant_resolution_and_bad_values(conn, env, tenant_a):
    assert runner.invoke(cli.app, ["cycle", "--tenant", "A", "--all-tenants"]).exit_code != 0
    r = runner.invoke(cli.app, ["po", "list", "--tenant", "Nobody"])
    assert r.exit_code != 0 and "unknown tenant" in r.output
    assert runner.invoke(cli.app, ["po", "list", "--tenant", str(tenant_a.tenant_id)]).exit_code == 0
    r = runner.invoke(cli.app, ["plan", "--tenant", tenant_a.name])
    assert r.exit_code != 0 and "no done run" in r.output
    r = invoke("tenant", "list")
    assert "Tenant A" in r.output and "Tenant B" in r.output


def test_po_approve_and_push_only_by_their_commands(conn, env, tenant_a):
    add_suppliers(conn, tenant_a, "A")
    invoke("cycle", "--tenant", tenant_a.name)
    po = conn.execute("SELECT po_number FROM purchase_orders WHERE tenant_id = %s ORDER BY po_number",
                      (tenant_a.tenant_id,)).fetchone()["po_number"]
    line = conn.execute("SELECT variant_id FROM po_lines WHERE tenant_id = %s AND po_number = %s ORDER BY variant_id",
                        (tenant_a.tenant_id, po)).fetchone()["variant_id"]
    invoke("po", "approve", po, "--tenant", tenant_a.name, "--edit", f"{line}=7")
    r = conn.execute("SELECT o.state, l.qty_approved FROM purchase_orders o JOIN po_lines l USING (tenant_id, po_number)"
                     " WHERE o.tenant_id = %s AND o.po_number = %s AND l.variant_id = %s",
                     (tenant_a.tenant_id, po, line)).fetchone()
    assert (r["state"], r["qty_approved"]) == ("approved", 7)
    shop = env[tenant_a.tenant_id].shopify
    shop.respond("TransferByReference", {"data": {"inventoryTransfers": {
        "pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": []}}})
    shop.respond("InventoryTransferCreate", {"data": {"inventoryTransferCreate": {
        "inventoryTransfer": {"id": "gid://shopify/InventoryTransfer/1", "status": "DRAFT"}, "userErrors": []}}})
    shop.respond("InventoryTransferMarkReady", {"data": {"inventoryTransferMarkAsReadyToShip": {
        "inventoryTransfer": {"id": "gid://shopify/InventoryTransfer/1", "status": "READY_TO_SHIP"},
        "userErrors": []}}})
    invoke("po", "push", po, "--tenant", tenant_a.name)
    assert conn.execute("SELECT state FROM purchase_orders WHERE tenant_id = %s AND po_number = %s",
                        (tenant_a.tenant_id, po)).fetchone()["state"] == "pushed"
    assert "InventoryTransferCreate" in [n for n, _ in shop.calls]


def test_snapshot_stock_first_snapshot_reconstructs(conn, env, tenant_a):
    v = "gid://shopify/ProductVariant/101"
    conn.execute("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value)"
                 " VALUES (%s,'o1',%s,%s,2,1000)", (tenant_a.tenant_id, TODAY - timedelta(days=3), v))
    conn.commit()
    invoke("snapshot_stock", "--tenant", tenant_a.name)
    rows = conn.execute("SELECT date, available, reconstructed FROM stock_daily WHERE tenant_id = %s AND variant_id = %s"
                        " AND location_id = 'gid://shopify/Location/222' ORDER BY date", (tenant_a.tenant_id, v)).fetchall()
    assert rows[-1]["date"] == TODAY and not rows[-1]["reconstructed"] and rows[-1]["available"] == 10
    assert rows[0]["date"] == TODAY - timedelta(days=3) and rows[0]["reconstructed"]
    assert [r["date"] for r in rows] == days(TODAY - timedelta(days=3), TODAY)
    assert [r["available"] for r in rows] == [10, 10, 10, 10]          # end of day levels; the sale was on day 1
    invoke("snapshot_stock", "--tenant", tenant_a.name)             # later snapshots do not reconstruct again
    assert conn.execute("SELECT count(*) n FROM stock_daily WHERE tenant_id = %s AND reconstructed",
                        (tenant_a.tenant_id,)).fetchone()["n"] == 3 * 3


def test_meta_error_stores_no_token(conn, env, tenant_a, monkeypatch):
    """C3: a Meta HTTP error carrying the token (in its text or a URL) reaches neither runs.stages, the log nor
    the terminal; the real client sends the token as a Bearer header only."""
    secret = "EAAGsupersecretmetatoken0123456789"
    monkeypatch.setenv("A_META_TOKEN", secret)
    monkeypatch.setattr("engine.tenants._sleep", lambda s: None)
    sent = []

    class Resp:
        status_code = 400

        def json(self):
            return {"error": {"code": 190, "message": f"Malformed access token {secret}",
                              "fbtrace_id": f"https://graph.facebook.com/x?access_token={secret}"}}

    def get(url, params=None, headers=None, timeout=None):
        sent.append((url, params, headers))
        return Resp()
    monkeypatch.setattr("engine.tenants.requests.get", get)
    from engine import tenants as tn
    monkeypatch.setattr(cli.ingest_meta, "meta_client", tn.MetaClient)
    r = runner.invoke(cli.app, ["cycle", "--tenant", tenant_a.name])
    assert r.exit_code != 0
    run = conn.execute("SELECT status, stages FROM runs WHERE tenant_id = %s", (tenant_a.tenant_id,)).fetchone()
    assert run["status"] == "failed" and run["stages"]["ingest_spend"]["status"] == "failed"
    assert secret not in json.dumps(run["stages"]) and secret not in r.output
    assert "Malformed access token" in run["stages"]["ingest_spend"]["error"]
    assert sent and all(secret not in url and secret not in json.dumps(p) for url, p, _ in sent)
    assert sent[0][2] == {"Authorization": f"Bearer {secret}"}

    def leak(*a, **k):
        raise RuntimeError(f"400 Client Error for url: https://graph.facebook.com/v23.0/act_1?access_token={secret}")
    monkeypatch.setattr(cli.ingest_meta, "ingest_spend", leak)
    r = runner.invoke(cli.app, ["cycle", "--tenant", tenant_a.name])
    stages = json.dumps([x["stages"] for x in conn.execute("SELECT stages FROM runs WHERE tenant_id = %s",
                                                            (tenant_a.tenant_id,))])
    assert secret not in stages and secret not in r.output and "access_token=[REDACTED]" in stages


def test_optional_landing_stage_failure_is_a_warning(conn, env, tenant_a, monkeypatch):
    """I7: landing sessions (and the funnel roll-up) failing records a warning; the run still completes."""
    def boom(*a, **k):
        raise RuntimeError("Access denied for shopifyqlQuery field. Required access: `read_reports`")
    monkeypatch.setattr(cli.ingest_shopify, "ingest_landing_sessions", boom)
    monkeypatch.setattr(cli, "rollup_funnel", boom)
    add_suppliers(conn, tenant_a, "A")
    invoke("cycle", "--tenant", tenant_a.name)
    run = conn.execute("SELECT status, stages FROM runs WHERE tenant_id = %s", (tenant_a.tenant_id,)).fetchone()
    assert run["status"] == "done"
    assert run["stages"]["ingest_landing_sessions"]["status"] == "warning"
    assert "read_reports" in run["stages"]["ingest_landing_sessions"]["error"]
    assert run["stages"]["forward_plan"]["status"] == "done"


def test_cycle_bookkeeping_crash_marks_run_failed_and_next_tenant_runs(conn, env, tenant_a, tenant_b, monkeypatch):
    """M6: a crash outside a stage (here, recording a stage) still marks the run failed; every tenant gets its
    own connection, so tenant B runs normally."""
    real = cli._record_stage
    connections = []
    real_connect = cli.connect
    monkeypatch.setattr(cli, "connect", lambda: connections.append(1) or real_connect())

    def record(c, t, run_id, name, info):
        if t.tenant_id == tenant_a.tenant_id and name == "ingest_orders":
            raise RuntimeError("stages column locked")
        return real(c, t, run_id, name, info)
    monkeypatch.setattr(cli, "_record_stage", record)
    r = runner.invoke(cli.app, ["cycle", "--all-tenants"])
    assert r.exit_code != 0 and "stages column locked" in r.output
    status = {row["tenant_id"]: row["status"] for row in conn.execute("SELECT tenant_id, status FROM runs")}
    assert status == {tenant_a.tenant_id: "failed", tenant_b.tenant_id: "done"}
    assert len(connections) >= 3                    # tenant list + one per tenant


def _spend_dates(conn, t):
    return conn.execute("SELECT min(date) lo, max(date) hi, count(*) n FROM spend_by_product WHERE tenant_id = %s",
                        (t.tenant_id,)).fetchone()


def test_tenant_add_ingest_attributes_full_history(conn, env, tenant_a, tenant_b):
    """C1: tenant add ingests and attributes the full history; the next cycle keeps it."""
    f = make_fakes("A")
    env[None] = env[tenant_b.tenant_id + 1] = f              # the draft tenant, then the new tenant id
    invoke("tenant", "add", "--name", "Tenant C", "--shop", "c.myshopify.com", "--shopify-token-env", "C_S",
           "--meta-token-env", "C_M", "--meta-account", ACCOUNT["A"], "--po-prefix", "C")
    t = cli.tenants.get_tenant(conn, tenant_b.tenant_id + 1)
    got = _spend_dates(conn, t)
    assert got["lo"] == START and got["hi"] == END
    assert conn.execute("SELECT min(date) d FROM order_credits WHERE tenant_id = %s", (t.tenant_id,)).fetchone()["d"] \
        == START
    invoke("cycle", "--tenant", "Tenant C")
    assert _spend_dates(conn, t)["lo"] == START


def test_cycle_attributes_history_ingested_without_attribution(conn, env, tenant_a):
    """C1: history ingested without attribution (engine ingest) is attributed by the next cycle, not only the
    incremental window."""
    invoke("ingest", "--tenant", tenant_a.name)
    assert _spend_dates(conn, tenant_a)["n"] == 0
    invoke("cycle", "--tenant", tenant_a.name)
    run = conn.execute("SELECT stages FROM runs WHERE tenant_id = %s", (tenant_a.tenant_id,)).fetchone()["stages"]
    assert run["ingest_orders"]["result"]["full_history"] is False          # incremental ingest window
    assert run["run_attribution"]["result"]["since"] == START.isoformat()
    assert _spend_dates(conn, tenant_a)["lo"] == START
    n = conn.execute("SELECT count(*) n FROM orders o WHERE tenant_id = %s AND NOT EXISTS (SELECT 1 FROM"
                     " order_credits c WHERE c.tenant_id = o.tenant_id AND c.order_id = o.order_id)",
                     (tenant_a.tenant_id,)).fetchone()["n"]
    assert n == 0
    invoke("cycle", "--tenant", tenant_a.name)          # everything attributed: back to the incremental window
    run = conn.execute("SELECT stages FROM runs WHERE tenant_id = %s ORDER BY started_at DESC",
                       (tenant_a.tenant_id,)).fetchone()["stages"]
    assert run["run_attribution"]["result"]["since"] == (END - timedelta(days=7)).isoformat()
