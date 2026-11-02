import threading
import time
from dataclasses import asdict
from datetime import date, timedelta

import pytest
from psycopg.types.json import Jsonb

from engine import db, purchasing
from engine.model import DemandParams
from conftest import TEST_URL

D0 = date(2026, 8, 1)          # first history day; history runs 90 days to D0 + 89
DAYS = [D0 + timedelta(days=i) for i in range(90)]
LOC = "gid://shopify/Location/222"
ITEM = "gid://shopify/InventoryItem/{}".format


@pytest.fixture
def fakes(fake_clients, monkeypatch):
    for module in ("engine.purchasing", "engine.ingest_shopify"):
        monkeypatch.setattr(f"{module}.shopify_client", lambda t: fake_clients.shopify)
    return fake_clients


# ---------------------------------------------------------------- seeding helpers

def product(conn, t, pid, style, variants, status="ACTIVE"):
    """variants: [(variant_id, size, inventory_item_number)]"""
    conn.execute("INSERT INTO styles (tenant_id, style_id, name) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                 (t.tenant_id, style, style))
    for vid, size, item in variants:
        conn.execute("INSERT INTO products (tenant_id, variant_id, product_id, handle, title, size,"
                     " inventory_item_id, status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                     (t.tenant_id, vid, pid, pid.lower(), pid, size, ITEM(item), status))
    conn.execute("INSERT INTO product_style (tenant_id, product_id, style_id, colour) VALUES (%s,%s,%s,'Red')",
                 (t.tenant_id, pid, style))


def sales(conn, t, vid, days, qty, price=500.0):
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value)"
                        " VALUES (%s,%s,%s,%s,%s,%s)",
                        [(t.tenant_id, f"{vid}-{d}", d, vid, qty, qty * price) for d in days])


def stock(conn, t, vid, avail_by_day, loc=LOC):
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO stock_daily (tenant_id, date, variant_id, location_id, available, on_hand)"
                        " VALUES (%s,%s,%s,%s,%s,%s)",
                        [(t.tenant_id, d, vid, loc, a, max(a, 0)) for d, a in avail_by_day.items()])


def supplier(conn, t, name, lead=14, pack=1, style=None, product_id=None, moq=0):
    sid = conn.execute("INSERT INTO suppliers (tenant_id, name, kind, lead_time_days, pack_multiple)"
                       " VALUES (%s,%s,'factory',%s,%s) RETURNING supplier_id",
                       (t.tenant_id, name, lead, pack)).fetchone()["supplier_id"]
    conn.execute("INSERT INTO product_suppliers (tenant_id, supplier_id, style_id, product_id, moq)"
                 " VALUES (%s,%s,%s,%s,%s)", (t.tenant_id, sid, style, product_id, moq))
    return sid


def params(conn, t, run_id, pid, daily, grain="day"):
    per = {"day": 1, "week": 7, "month": 365.25 / 12}[grain]
    p = DemandParams(pid, baseline_v=daily * per, a=0.0, cr_ref=1.0, e=0.0, fallback=True,
                     level="product", grain=grain, n_periods=20)
    conn.execute("INSERT INTO model_params (tenant_id, run_id, entity_id, params) VALUES (%s,%s,%s,%s)",
                 (t.tenant_id, run_id, pid, Jsonb(asdict(p))))


def curve_product(conn, t, pid="P1", style="S1", s_qty=1, m_qty=3, avail=0):
    """Two sizes always in stock over the 90 days (S sells s_qty/day, M m_qty/day); `avail` left on day 91."""
    product(conn, t, pid, style, [(f"{pid}-S", "S", f"{pid}1"), (f"{pid}-M", "M", f"{pid}2")])
    for v, q in ((f"{pid}-S", s_qty), (f"{pid}-M", m_qty)):
        sales(conn, t, v, DAYS, q)
        stock(conn, t, v, {**{d: 50 for d in DAYS}, D0 + timedelta(days=90): avail})


def lines(conn, t, po):
    return {r["variant_id"]: r for r in conn.execute(
        "SELECT * FROM po_lines WHERE tenant_id = %s AND po_number = %s", (t.tenant_id, po))}


def po_row(conn, t, po):
    return conn.execute("SELECT * FROM purchase_orders WHERE tenant_id = %s AND po_number = %s",
                        (t.tenant_id, po)).fetchone()


def make_po(conn, t, po, state, lines_, transfer_id=None):
    """lines_: {variant_id: (qty_suggested, qty_approved, qty_received)}"""
    conn.execute("INSERT INTO purchase_orders (tenant_id, po_number, state, transfer_id) VALUES (%s,%s,%s,%s)",
                 (t.tenant_id, po, state, transfer_id))
    for v, (s, a, r) in lines_.items():
        conn.execute("INSERT INTO po_lines (tenant_id, po_number, variant_id, qty_suggested, qty_approved,"
                     " qty_received) VALUES (%s,%s,%s,%s,%s,%s)", (t.tenant_id, po, v, s, a, r))
    conn.commit()


# ---------------------------------------------------------------- suggestion

def test_need_uses_true_demand_not_sales(conn, tenant_a, caplog):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V-S", "S", 11), ("V-M", "M", 12)])
    sales(conn, t, "V-S", DAYS[:60], 1)              # S sold out for the last 30 days
    sales(conn, t, "V-M", DAYS, 1)
    stock(conn, t, "V-S", {d: (5 if i < 60 else 0) for i, d in enumerate(DAYS)})
    stock(conn, t, "V-M", {d: 10 for d in DAYS})
    supplier(conn, t, "Factory", lead=14, style="S1")
    make_po(conn, t, "OLD1", "pushed", {"V-M": (10, 6, 2)})      # 4 still on order
    make_po(conn, t, "OLD2", "draft", {"V-M": (50, None, 0)})    # drafts are not on order
    conn.commit()

    pos = purchasing.suggest_pos(conn, t, "run1")                # no params in run1: 90 day true demand
    assert len(pos) == 1
    got = lines(conn, t, pos[0])
    # true demand: 2/day every day (half the sizes in stock while 1 unit sold); sales averaged 1.67/day.
    # 2 * (14 + 30) = 88, size share 0.5 each, sd 0 so no safety.
    assert got["V-S"]["qty_suggested"] == 44                     # 44 - 0 available
    assert got["V-M"]["qty_suggested"] == 30                     # 44 - 10 available - 4 on order
    assert got["V-S"]["detail"]["flags"] == ["demand_fallback_90d"]
    assert got["V-S"]["detail"]["forecast"] == pytest.approx(44.0)
    assert po_row(conn, t, pos[0])["state"] == "draft"


def test_need_split_by_size_curve(conn, tenant_a):
    t = tenant_a
    curve_product(conn, t)                                       # curve S 0.25, M 0.75; nothing available
    supplier(conn, t, "Factory", lead=14, style="S1")
    params(conn, t, "run1", "P1", daily=4.0)
    params(conn, t, "runw", "P1", daily=4.0, grain="week")
    conn.commit()

    for run in ("run1", "runw"):                                 # weekly fit converted to a daily rate
        [po] = purchasing.suggest_pos(conn, t, run)
        got = lines(conn, t, po)
        assert got["P1-S"]["qty_suggested"] == 44                # 4 * 44 * 0.25
        assert got["P1-M"]["qty_suggested"] == 132               # 4 * 44 * 0.75
        assert got["P1-M"]["detail"]["flags"] == []

    # safety = 1.65 * sd * sqrt(lead), split by size share
    sales(conn, t, "P1-M", DAYS[-1:], 8)                         # one spike day
    conn.commit()
    [po] = purchasing.suggest_pos(conn, t, "run1")
    got = lines(conn, t, po)
    assert got["P1-M"]["detail"]["safety"] > 0
    s, m = got["P1-S"]["detail"], got["P1-M"]["detail"]
    assert m["safety"] / s["safety"] == pytest.approx(m["size_share"] / s["size_share"])


def test_pack_and_moq(conn, tenant_a):
    t = tenant_a
    curve_product(conn, t)
    supplier(conn, t, "Factory", lead=14, pack=6, style="S1", moq=300)
    params(conn, t, "run1", "P1", daily=4.0)
    conn.commit()
    [po] = purchasing.suggest_pos(conn, t, "run1")
    got = lines(conn, t, po)
    # need 44 / 132 -> pack 48 / 132 = 180 < 300; deficit 120 by forecast share 0.25 / 0.75 -> 78 / 222
    assert got["P1-S"]["qty_suggested"] == 78
    assert got["P1-M"]["qty_suggested"] == 222
    assert all(r["qty_suggested"] % 6 == 0 for r in got.values())

    conn.execute("UPDATE product_suppliers SET moq = 0 WHERE tenant_id = %s", (t.tenant_id,))
    conn.commit()
    [po] = purchasing.suggest_pos(conn, t, "run1")
    got = lines(conn, t, po)
    assert (got["P1-S"]["qty_suggested"], got["P1-M"]["qty_suggested"]) == (48, 132)


def test_kill_skipped(conn, tenant_a):
    t = tenant_a
    curve_product(conn, t, "P1", "S1")
    curve_product(conn, t, "P2", "S2")
    supplier(conn, t, "Factory", style="S1")
    conn.execute("INSERT INTO product_suppliers (tenant_id, supplier_id, style_id) "
                 "SELECT tenant_id, supplier_id, 'S2' FROM suppliers WHERE tenant_id = %s", (t.tenant_id,))
    params(conn, t, "run1", "P1", daily=4.0)
    params(conn, t, "run1", "P2", daily=4.0)
    conn.execute("INSERT INTO decisions (tenant_id, run_id, month, level, entity_id, decision) VALUES"
                 " (%s,'d1','2026-10-01','style','S1','KILL'),"
                 " (%s,'d1','2026-09-01','product','P2','KILL'), (%s,'d1','2026-10-01','product','P2','MAINTAIN')",
                 (t.tenant_id,) * 3)
    conn.commit()
    [po] = purchasing.suggest_pos(conn, t, "run1")
    assert set(lines(conn, t, po)) == {"P2-S", "P2-M"}           # S1 killed; P2's latest decision is MAINTAIN


def test_one_draft_per_supplier(conn, tenant_a, tenant_b, caplog):
    t = tenant_a
    curve_product(conn, t, "P1", "S1")
    curve_product(conn, t, "P2", "S1")
    curve_product(conn, t, "P3", "S3")
    curve_product(conn, t, "P4", "S4")                           # no supplier: skipped and logged
    f1 = supplier(conn, t, "F1", style="S1")
    f2 = supplier(conn, t, "F2", product_id="P3")
    supplier(conn, t, "F3", product_id="P2")                     # product row beats P2's style row
    for p in ("P1", "P2", "P3", "P4"):
        params(conn, t, "run1", p, daily=4.0)
    make_po(conn, t, "KEEP1", "approved", {"P1-S": (5, 5, 0)})
    conn.execute("UPDATE purchase_orders SET run_id = 'run1' WHERE tenant_id = %s", (t.tenant_id,))
    conn.commit()

    pos = purchasing.suggest_pos(conn, t, "run1")
    assert len(pos) == 3
    by_supplier = {po_row(conn, t, po)["supplier_id"]: set(lines(conn, t, po)) for po in pos}
    assert by_supplier[f1] == {"P1-S", "P1-M"} and by_supplier[f2] == {"P3-S", "P3-M"}
    assert "P4" in caplog.text
    # KEEP1 (approved) counts as on order for P1-S: 44 - 5
    f1_po = next(po for po in pos if po_row(conn, t, po)["supplier_id"] == f1)
    assert lines(conn, t, f1_po)["P1-S"]["qty_suggested"] == 39

    again = purchasing.suggest_pos(conn, t, "run1")              # replaces this run's drafts only
    assert len(again) == 3
    states = conn.execute("SELECT state, count(*) AS n FROM purchase_orders WHERE tenant_id = %s GROUP BY state",
                          (t.tenant_id,)).fetchall()
    assert {r["state"]: r["n"] for r in states} == {"draft": 3, "approved": 1}
    assert po_row(conn, t, "KEEP1")["state"] == "approved"
    assert purchasing.suggest_pos(conn, tenant_b, "run1") == []  # nothing leaks to the other tenant


def test_po_number_uses_tenant_prefix(conn, tenant_a, tenant_b):
    t = tenant_a
    curve_product(conn, t)
    supplier(conn, t, "Factory", style="S1")
    params(conn, t, "run1", "P1", daily=4.0)
    conn.commit()
    ym = purchasing._local_today(t).strftime("%Y%m")
    assert purchasing.suggest_pos(conn, t, "run1") == [f"APO{ym}001"]
    make_po(conn, t, f"APO{ym}007", "received", {})
    make_po(conn, t, "APO190001099", "received", {})             # other month: ignored
    make_po(conn, tenant_b, f"APO{ym}050", "received", {})       # other tenant: ignored
    assert purchasing.suggest_pos(conn, t, "run2") == [f"APO{ym}008"]


# ---------------------------------------------------------------- approve and push

def test_approve_po(conn, tenant_a):
    t = tenant_a
    make_po(conn, t, "APO1", "draft", {"V1": (10, None, 0), "V2": (4, None, 0)})
    with pytest.raises(ValueError):
        purchasing.approve_po(conn, t, "APO1", {"NOPE": 3})
    purchasing.approve_po(conn, t, "APO1", {"V2": 6})
    got = lines(conn, t, "APO1")
    assert (got["V1"]["qty_approved"], got["V2"]["qty_approved"]) == (10, 6)
    row = po_row(conn, t, "APO1")
    assert row["state"] == "approved" and row["approved_at"] is not None
    purchasing.approve_po(conn, t, "APO1", {"V2": 99})           # already approved: no op
    assert lines(conn, t, "APO1")["V2"]["qty_approved"] == 6
    make_po(conn, t, "APO2", "pushed", {"V1": (1, 1, 0)})
    with pytest.raises(ValueError):
        purchasing.approve_po(conn, t, "APO2")


def test_push_requires_approved(conn, tenant_a, fakes):
    t = tenant_a
    make_po(conn, t, "APO1", "draft", {"V1": (10, None, 0)})
    make_po(conn, t, "APO2", "cancelled", {"V1": (10, 10, 0)})
    for po in ("APO1", "APO2"):
        with pytest.raises(ValueError):
            purchasing.push_po(conn, t, po)
    with pytest.raises(KeyError):
        purchasing.push_po(conn, t, "MISSING")
    assert fakes.shopify.calls == []
    assert po_row(conn, t, "APO1")["state"] == "draft"


def _shopify_transfers(fakes, existing=None, delay=0.0):
    created = []

    def create(v):
        time.sleep(delay)
        created.append(v)
        return {"data": {"inventoryTransferCreate": {
            "inventoryTransfer": {"id": "gid://shopify/InventoryTransfer/900", "status": "DRAFT"}, "userErrors": []}}}

    fakes.shopify.respond("TransferByReference", lambda v: {"data": {"inventoryTransfers": {
        "nodes": existing or [], "pageInfo": {"hasNextPage": False, "endCursor": None}}}})
    fakes.shopify.respond("InventoryTransferCreate", create)
    fakes.shopify.respond("InventoryTransferMarkReady", lambda v: {"data": {"inventoryTransferMarkAsReadyToShip": {
        "inventoryTransfer": {"id": v["id"], "status": "READY_TO_SHIP"}, "userErrors": []}}})
    return created


def test_push_idempotent(conn, tenant_a, fakes):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V1", "S", 1101), ("V2", "M", 1102), ("V3", "L", 1103)])
    make_po(conn, t, "APO1", "draft", {"V1": (10, None, 0), "V2": (4, None, 0), "V3": (2, None, 0)})
    purchasing.approve_po(conn, t, "APO1", {"V3": 0})
    created = _shopify_transfers(fakes)

    tid = purchasing.push_po(conn, t, "APO1")
    assert tid == "gid://shopify/InventoryTransfer/900"
    assert [c[0] for c in fakes.shopify.calls] == [
        "TransferByReference", "InventoryTransferCreate", "InventoryTransferMarkReady"]
    assert fakes.shopify.calls[0][1]["query"] == "tag:'APO1'"
    assert created[0]["idempotencyKey"] == f"{t.tenant_id}-APO1"
    inp = created[0]["input"]
    assert inp["tags"] == ["APO1"]
    assert "originLocationId" not in inp
    assert inp["destinationLocationId"] == t.main_location_id and inp["referenceName"] == "APO1"
    assert inp["lineItems"] == [{"inventoryItemId": ITEM(1101), "quantity": 10},
                                {"inventoryItemId": ITEM(1102), "quantity": 4}]       # zero line skipped
    row = po_row(conn, t, "APO1")
    assert row["state"] == "pushed" and row["transfer_id"] == tid and row["pushed_at"] is not None

    n = len(fakes.shopify.calls)
    assert purchasing.push_po(conn, t, "APO1") == tid            # already pushed: no Shopify call
    assert len(fakes.shopify.calls) == n

    # a crash after create left the transfer in Shopify but the PO approved: reuse it, only mark it ready
    conn.execute("UPDATE purchase_orders SET state = 'approved', transfer_id = NULL WHERE tenant_id = %s",
                 (t.tenant_id,))
    conn.commit()
    fakes.shopify.calls.clear()
    created.clear()
    _shopify_transfers(fakes, existing=[
        {"id": "gid://shopify/InventoryTransfer/1", "referenceName": "APO10", "status": "DRAFT"},
        {"id": "gid://shopify/InventoryTransfer/2", "referenceName": "APO1", "status": "DRAFT"}])
    assert purchasing.push_po(conn, t, "APO1") == "gid://shopify/InventoryTransfer/2"
    assert [c[0] for c in fakes.shopify.calls] == ["TransferByReference", "InventoryTransferMarkReady"]


def test_concurrent_push_creates_one_transfer(conn, tenant_a, fakes):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V1", "S", 1101)])
    make_po(conn, t, "APO1", "approved", {"V1": (10, 10, 0)})
    created = _shopify_transfers(fakes, delay=0.3)
    results, errors = [], []

    def run():
        c = db.connect(TEST_URL)
        try:
            results.append(purchasing.push_po(c, t, "APO1"))
        except Exception as e:  # pragma: no cover - surfaced by the assert below
            errors.append(e)
        finally:
            c.close()

    threads = [threading.Thread(target=run) for _ in range(2)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert errors == [] and len(created) == 1
    assert results == ["gid://shopify/InventoryTransfer/900"] * 2


def test_push_raises_on_user_errors(conn, tenant_a, fakes):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V1", "S", 1101)])
    make_po(conn, t, "APO1", "approved", {"V1": (10, 10, 0)})
    _shopify_transfers(fakes)
    fakes.shopify.respond("InventoryTransferCreate", {"data": {"inventoryTransferCreate": {
        "inventoryTransfer": None, "userErrors": [{"field": ["input"], "message": "bad location"}]}}})
    with pytest.raises(RuntimeError, match="bad location"):
        purchasing.push_po(conn, t, "APO1")
    assert po_row(conn, t, "APO1")["state"] == "approved"


def test_cancel_po(conn, tenant_a, fakes):
    t = tenant_a
    make_po(conn, t, "APO1", "draft", {"V1": (1, None, 0)})
    make_po(conn, t, "APO2", "pushed", {"V1": (1, 1, 0)}, transfer_id="gid://shopify/InventoryTransfer/7")
    make_po(conn, t, "APO3", "partially_received", {"V1": (2, 2, 1)}, transfer_id="gid://shopify/InventoryTransfer/8")
    fakes.shopify.respond("InventoryTransferCancel", lambda v: {"data": {"inventoryTransferCancel": {
        "inventoryTransfer": {"id": v["id"], "status": "CANCELED"}, "userErrors": []}}})
    purchasing.cancel_po(conn, t, "APO1")
    assert fakes.shopify.calls == []
    purchasing.cancel_po(conn, t, "APO2")
    assert fakes.shopify.calls == [("InventoryTransferCancel", {"id": "gid://shopify/InventoryTransfer/7"})]
    assert po_row(conn, t, "APO1")["state"] == po_row(conn, t, "APO2")["state"] == "cancelled"
    with pytest.raises(ValueError):
        purchasing.cancel_po(conn, t, "APO3")


# ---------------------------------------------------------------- receipts

def _receipts(conn, t):
    return [(r["variant_id"], r["qty"], r["source"], r["location_id"]) for r in conn.execute(
        "SELECT * FROM stock_receipts WHERE tenant_id = %s ORDER BY id", (t.tenant_id,))]


def _transfer(received):
    return {"data": {"inventoryTransfer": {
        "id": "gid://shopify/InventoryTransfer/55", "referenceName": "APO1", "status": "IN_PROGRESS",
        "lineItems": {"nodes": [{"inventoryItem": {"id": ITEM(item)}, "totalQuantity": tot, "shippedQuantity": tot,
                                 "processableQuantity": tot - rec} for item, tot, rec in received]}}}}


def test_partial_receipt(conn, tenant_a, fakes):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V1", "S", 1101), ("V2", "M", 1102)])
    make_po(conn, t, "APO1", "pushed", {"V1": (20, 20, 0), "V2": (10, 10, 0)},
            transfer_id="gid://shopify/InventoryTransfer/55")
    # recorded fixture: item 1101 received 12 of 20, item 1102 nothing yet
    assert purchasing.sync_receipts(conn, t) == 1
    got = lines(conn, t, "APO1")
    assert (got["V1"]["qty_received"], got["V2"]["qty_received"]) == (12, 0)
    assert po_row(conn, t, "APO1")["state"] == "partially_received"
    assert _receipts(conn, t) == [("V1", 12, "APO1", t.main_location_id)]

    fakes.shopify.respond("InventoryTransferById", _transfer([(1101, 20, 20), (1102, 10, 10)]))
    assert purchasing.sync_receipts(conn, t) == 2
    assert po_row(conn, t, "APO1")["state"] == "received"
    assert _receipts(conn, t)[1:] == [("V1", 8, "APO1", t.main_location_id), ("V2", 10, "APO1", t.main_location_id)]
    day = conn.execute("SELECT DISTINCT date FROM stock_receipts WHERE tenant_id = %s", (t.tenant_id,)).fetchall()
    assert [r["date"] for r in day] == [purchasing._local_today(t)]


def test_received_qty_from_shopify(conn, tenant_a, tenant_b, fakes):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V1", "S", 1101), ("V2", "M", 1102)])
    make_po(conn, t, "APO1", "pushed", {"V1": (20, 20, 0), "V2": (10, 10, 0)},
            transfer_id="gid://shopify/InventoryTransfer/55")
    make_po(conn, tenant_b, "BPO1", "pushed", {"V1": (20, 20, 0)}, transfer_id="gid://shopify/InventoryTransfer/99")
    # Shopify says 15 of V1 and 10 of V2 arrived (fewer than the 20 approved): its numbers win
    fakes.shopify.respond("InventoryTransferById", _transfer([(1101, 20, 15), (1102, 10, 10)]))
    assert purchasing.sync_receipts(conn, t) == 2
    got = lines(conn, t, "APO1")
    assert (got["V1"]["qty_received"], got["V2"]["qty_received"]) == (15, 10)
    assert po_row(conn, t, "APO1")["state"] == "partially_received"
    assert purchasing.sync_receipts(conn, t) == 0                # unchanged: no new receipt rows
    assert sum(r[1] for r in _receipts(conn, t)) == 25
    assert [c[1]["id"] for c in fakes.shopify.calls] == ["gid://shopify/InventoryTransfer/55"] * 2
    assert lines(conn, tenant_b, "BPO1")["V1"]["qty_received"] == 0


def test_sync_leaves_cancelled_po_alone(conn, tenant_a, fakes):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V1", "S", 1101), ("V2", "M", 1102)])
    make_po(conn, t, "APO1", "pushed", {"V1": (20, 20, 0), "V2": (10, 10, 0)},
            transfer_id="gid://shopify/InventoryTransfer/55")

    def cancelled_meanwhile(v):                                  # another session cancels while Shopify is read
        with db.connect(TEST_URL) as other:
            other.execute("UPDATE purchase_orders SET state = 'cancelled' WHERE tenant_id = %s", (t.tenant_id,))
        return _transfer([(1101, 20, 12), (1102, 10, 0)])

    fakes.shopify.respond("InventoryTransferById", cancelled_meanwhile)
    assert purchasing.sync_receipts(conn, t) == 0
    assert po_row(conn, t, "APO1")["state"] == "cancelled"
    assert lines(conn, t, "APO1")["V1"]["qty_received"] == 0 and _receipts(conn, t) == []


def test_sync_failure_rolls_back(conn, tenant_a, fakes):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V1", "S", 1101), ("V2", "M", 1102)])
    make_po(conn, t, "APO1", "pushed", {"V1": (20, 20, 0)}, transfer_id="gid://shopify/InventoryTransfer/55")
    make_po(conn, t, "APO2", "pushed", {"V2": (10, 10, 0)}, transfer_id="gid://shopify/InventoryTransfer/56")

    def fetch(v):
        if v["id"].endswith("/56"):
            raise RuntimeError("Shopify down")
        return _transfer([(1101, 20, 20)])

    fakes.shopify.respond("InventoryTransferById", fetch)
    with pytest.raises(RuntimeError, match="Shopify down"):
        purchasing.sync_receipts(conn, t)
    assert conn.info.transaction_status.name == "IDLE"           # no open transaction, no locks held
    with db.connect(TEST_URL) as other:                          # APO1 committed before APO2 failed
        st = {r["po_number"]: r["state"] for r in other.execute(
            "SELECT po_number, state FROM purchase_orders WHERE tenant_id = %s", (t.tenant_id,))}
    assert st == {"APO1": "received", "APO2": "pushed"}
    assert lines(conn, t, "APO2")["V2"]["qty_received"] == 0


def test_restock_lift(conn, tenant_a):
    t = tenant_a
    product(conn, t, "P1", "S1", [("V1", "S", 1101)])
    d0 = date(2026, 9, 15)
    before = [d0 - timedelta(days=i) for i in range(1, 15)]
    after = [d0 + timedelta(days=i) for i in range(14)]
    stock(conn, t, "V1", {d: (3 if i < 7 else 0) for i, d in enumerate(before)})   # 7 in stock days before
    stock(conn, t, "V1", {d: 20 for d in after})
    sales(conn, t, "V1", before[:7], 1)                          # 1 per in stock day before
    sales(conn, t, "V1", after, 2)                               # 2 per in stock day after
    make_po(conn, t, "APO1", "received", {"V1": (20, 20, 20)})
    assert purchasing.restock_lift(conn, t, "APO1") is None      # no receipt yet
    conn.execute("INSERT INTO stock_receipts (tenant_id, date, variant_id, location_id, qty, source)"
                 " VALUES (%s,%s,'V1',%s,20,'APO1'), (%s,%s,'V1',%s,5,'APO1')",
                 (t.tenant_id, d0, LOC, t.tenant_id, d0 + timedelta(days=3), LOC))
    conn.commit()
    assert purchasing.restock_lift(conn, t, "APO1") == pytest.approx(2.0)

    make_po(conn, t, "APO2", "received", {"V9": (1, 1, 1)})      # no in stock days on either side
    conn.execute("INSERT INTO stock_receipts (tenant_id, date, variant_id, location_id, qty, source)"
                 " VALUES (%s,%s,'V9',%s,1,'APO2')", (t.tenant_id, d0, LOC))
    conn.commit()
    assert purchasing.restock_lift(conn, t, "APO2") is None
