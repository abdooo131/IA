"""Purchasing (Spec 27 to 31): suggest POs from true demand, approve, push to Shopify, read receipts, restock lift.

Suggestion per current variant:
    need = forecast(lead_time + cover_days) * size_share + safety * size_share - available - on_order
    safety = 1.65 * sd(daily true demand, last 90 days) * sqrt(lead_time)        (product level)
rounded up to the supplier's pack multiple; a supplier row's group (its product, or every product of its style)
whose total is above 0 but below the row's MOQ is raised to MOQ by forecast share. KILL products and styles
get nothing.

The only Shopify writes in this module are inventoryTransferCreate, inventoryTransferMarkAsReadyToShip and
inventoryTransferCancel, and only for approved (or, for cancel, pushed) POs. Every query filters tenant_id.
"""
from __future__ import annotations

import logging
import math
import re
from collections import defaultdict
from dataclasses import fields
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from psycopg.types.json import Jsonb

from .aggregate import DECAY, TenantData
from .ingest_shopify import fetch_transfer
from .model import DemandParams, _num
from .planner import forecast
from .tenants import Tenant, shopify_client

log = logging.getLogger(__name__)

SERVICE_Z = 1.65                 # ~95% service level
SD_DAYS = 90
SPEND_DAYS = 30
MIN_AVAILABILITY = 0.2           # floor when dividing units by size availability
GRAIN_DAYS = {"day": 1.0, "week": 7.0, "month": 365.25 / 12}
GRAIN_PREFERENCE = ("day", "week", "month")
ON_ORDER_STATES = ("approved", "pushed", "partially_received")
RECEIVING_STATES = ("pushed", "partially_received")
LIFT_DAYS = 14
_EPS = 1e-9


def _local_today(t: Tenant) -> date:
    return datetime.now(ZoneInfo(t.timezone)).date()


# ---------------------------------------------------------------- GraphQL (named operations)

TRANSFER_BY_REFERENCE = """
query TransferByReference($query: String!, $after: String) {
  inventoryTransfers(first: 50, after: $after, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes { id referenceName status }
  }
}
"""

TRANSFER_CREATE = """
mutation InventoryTransferCreate($input: InventoryTransferCreateInput!) {
  inventoryTransferCreate(input: $input) {
    inventoryTransfer { id status }
    userErrors { field message }
  }
}
"""

TRANSFER_MARK_READY = """
mutation InventoryTransferMarkReady($id: ID!) {
  inventoryTransferMarkAsReadyToShip(id: $id) {
    inventoryTransfer { id status }
    userErrors { field message }
  }
}
"""

TRANSFER_CANCEL = """
mutation InventoryTransferCancel($id: ID!) {
  inventoryTransferCancel(id: $id) {
    inventoryTransfer { id status }
    userErrors { field message }
  }
}
"""


def _payload(data: dict, field: str) -> dict:
    out = data[field]
    errs = out.get("userErrors") or []
    if errs:
        raise RuntimeError(f"Shopify {field} failed: " + "; ".join(e.get("message", "") for e in errs))
    return out


# ---------------------------------------------------------------- suggestion inputs

def _load_params(conn, t: Tenant, run_id: str) -> dict[str, DemandParams]:
    """Product level DemandParams of the run, one per product (finest grain wins)."""
    names = {f.name for f in fields(DemandParams)}
    best: dict[str, tuple[int, DemandParams]] = {}
    for r in conn.execute("SELECT entity_id, params FROM model_params WHERE tenant_id = %s AND run_id = %s"
                          " AND params->>'level' = 'product'", (t.tenant_id, run_id)):
        p = DemandParams(**{k: v for k, v in r["params"].items() if k in names})
        rank = GRAIN_PREFERENCE.index(p.grain) if p.grain in GRAIN_PREFERENCE else len(GRAIN_PREFERENCE)
        if r["entity_id"] not in best or rank < best[r["entity_id"]][0]:
            best[r["entity_id"]] = (rank, p)
    return {k: v[1] for k, v in best.items()}


def _model_forecast(p: DemandParams, spend_daily: float, price: float, days: int) -> float:
    """True demand over `days` at full availability, from params of any grain converted to a daily rate."""
    grain = p.grain if p.grain in GRAIN_DAYS else "day"
    per = GRAIN_DAYS[grain]
    n = max(1, math.ceil(days / per))
    spend = max(spend_daily, 0.0) * per
    decay = DECAY[grain]
    f = forecast(p, spend, price, 1.0, grain, n, adstock0=spend / (1.0 - decay))   # steady state carry over
    daily = sum(_num(x, 0.0) for x in f["true_demand"]) / (n * per)
    return max(daily, 0.0) * days


def _killed(conn, t: Tenant) -> tuple[set[str], set[str]]:
    """(products, styles) whose most recent decision row is KILL."""
    rows = conn.execute(
        "SELECT DISTINCT ON (level, entity_id) level, entity_id, decision FROM decisions"
        " WHERE tenant_id = %s AND level IN ('product', 'style') ORDER BY level, entity_id, month DESC, id DESC",
        (t.tenant_id,)).fetchall()
    kill = [r for r in rows if r["decision"].upper() == "KILL"]
    return ({r["entity_id"] for r in kill if r["level"] == "product"},
            {r["entity_id"] for r in kill if r["level"] == "style"})


def _available(conn, t: Tenant) -> dict[str, int]:
    """Latest available per variant, summed over locations (each location's latest row)."""
    out: dict[str, int] = defaultdict(int)
    for r in conn.execute("SELECT DISTINCT ON (variant_id, location_id) variant_id, available FROM stock_daily"
                          " WHERE tenant_id = %s ORDER BY variant_id, location_id, date DESC", (t.tenant_id,)):
        out[r["variant_id"]] += r["available"]
    return out


def _on_order(conn, t: Tenant) -> dict[str, int]:
    rows = conn.execute(
        "SELECT l.variant_id, SUM(GREATEST(COALESCE(l.qty_approved, 0) - l.qty_received, 0)) AS q"
        " FROM po_lines l JOIN purchase_orders o ON o.tenant_id = l.tenant_id AND o.po_number = l.po_number"
        " WHERE l.tenant_id = %s AND o.state = ANY(%s) GROUP BY l.variant_id",
        (t.tenant_id, list(ON_ORDER_STATES))).fetchall()
    return {r["variant_id"]: int(r["q"]) for r in rows}


def _supplier_rows(conn, t: Tenant):
    rows = conn.execute(
        "SELECT ps.id, ps.supplier_id, ps.style_id, ps.product_id, ps.moq, s.lead_time_days, s.pack_multiple"
        " FROM product_suppliers ps JOIN suppliers s ON s.tenant_id = ps.tenant_id AND s.supplier_id = ps.supplier_id"
        " WHERE ps.tenant_id = %s ORDER BY ps.id", (t.tenant_id,)).fetchall()
    by_product = {r["product_id"]: r for r in rows if r["product_id"]}
    by_style = {r["style_id"]: r for r in rows if r["style_id"] and not r["product_id"]}
    return by_product, by_style


def _size_shares(variants: list[tuple[str, str]], curve: dict[str, float]) -> dict[str, float]:
    """variant -> share of the product's demand. Variants with no size or no curve share get an equal 1/n;
    the rest split what remains in proportion to the style's size curve."""
    n = len(variants)
    known = {v: curve.get(s, 0.0) for v, s in variants if s and curve.get(s, 0.0) > 0}
    shares = {v: 1.0 / n for v, _ in variants if v not in known}
    rest = 1.0 - len(shares) / n
    tot = sum(known.values())
    shares.update({v: rest * w / tot for v, w in known.items()})
    return shares


def _round_up(q: float, pack: int) -> int:
    pack = max(int(pack or 1), 1)
    return pack * max(math.ceil(q / pack - _EPS), 0)


def _product_demand(day: pd.DataFrame, p: DemandParams | None, lead: int, cover: int):
    """(forecast over lead + cover, sd of daily true demand over 90 days, flags) for one product."""
    flags: list[str] = []
    days = lead + cover
    if len(day):
        last = day["period_start"].max()
        recent = day[day["period_start"] > last - timedelta(days=SD_DAYS)]
        avail = recent["size_availability"].astype(float).fillna(1.0).clip(lower=MIN_AVAILABILITY)
        td = (recent["units"].astype(float) / avail).to_numpy()
        sd = float(np.std(td, ddof=1)) if len(td) > 1 else 0.0
        spend30 = day[day["period_start"] > last - timedelta(days=SPEND_DAYS)]["spend"].astype(float).sum()
        prices = day["price"].astype(float).dropna()
        price = float(prices.iloc[-1]) if len(prices) else None
    else:
        td, sd, spend30, price = np.array([]), 0.0, 0.0, None
    if p is not None:
        price = price if price is not None else _num(p.ref_price, 0.0)
        fc = _model_forecast(p, spend30 / SPEND_DAYS, price, days)
    else:
        flags.append("demand_fallback_90d")
        fc = (float(td.mean()) if len(td) else 0.0) * days
    return _num(fc, 0.0), _num(sd, 0.0), flags


def _next_po_numbers(conn, t: Tenant, n: int) -> list[str]:
    base = f"{t.po_prefix}PO{_local_today(t):%Y%m}"
    pat = re.compile(re.escape(base) + r"(\d+)$")
    used = [int(m.group(1)) for r in conn.execute(
        "SELECT po_number FROM purchase_orders WHERE tenant_id = %s", (t.tenant_id,))
        if (m := pat.match(r["po_number"]))]
    start = max(used, default=0) + 1
    return [f"{base}{i:03d}" for i in range(start, start + n)]


# ---------------------------------------------------------------- public API

def suggest_pos(conn, t: Tenant, run_id: str, cover_days: int = 30) -> list[str]:
    """Write one draft PO per supplier for the run's needs; returns the new PO numbers.

    Re running for the same run_id replaces that run's drafts (never approved or later POs). Products with no
    supplier are skipped and logged; products without params in the run use 90 day true demand (flagged).
    """
    data = TenantData(conn, t)
    params = _load_params(conn, t, run_id)
    kill_products, kill_styles = _killed(conn, t)
    by_product, by_style = _supplier_rows(conn, t)
    available, on_order = _available(conn, t), _on_order(conn, t)
    panel = data.panel("day", "product")
    panel_of = {pid: g.sort_values("period_start") for pid, g in panel.groupby("entity_id")} if len(panel) else {}

    prods = data.products
    prods = prods[prods["current"]] if len(prods) else prods      # variants not replaced through lineage
    status = {r["product_id"]: (r["status"] or "") for r in conn.execute(
        "SELECT DISTINCT ON (product_id) product_id, status FROM products WHERE tenant_id = %s", (t.tenant_id,))}

    # group (product_suppliers row) -> list of line dicts
    groups: dict[int, dict] = {}
    skipped: list[str] = []
    for pid, var in prods.groupby("product_id", sort=True):
        style = data.style_of.get(pid)
        if status.get(pid, "").upper() == "ARCHIVED" or pid in kill_products or (style and style in kill_styles):
            continue
        row = by_product.get(pid) or (by_style.get(style) if style else None)
        if row is None:
            skipped.append(pid)
            continue
        lead = int(row["lead_time_days"])
        fc, sd, flags = _product_demand(panel_of.get(pid, panel.iloc[0:0]), params.get(pid), lead, cover_days)
        safety = SERVICE_Z * sd * math.sqrt(lead)
        variants = list(zip(var["variant_id"], var["size"]))
        shares = _size_shares(variants, data.size_curve(style) if style else {})
        g = groups.setdefault(row["id"], {"row": row, "lines": []})
        for v, _ in variants:
            share = shares[v]
            avail, oo = available.get(v, 0), on_order.get(v, 0)
            need = max(fc * share + safety * share - avail - oo, 0.0)
            g["lines"].append({"variant_id": v, "qty": _round_up(need, row["pack_multiple"]), "detail": {
                "product_id": pid, "forecast": fc * share, "safety": safety * share, "available": avail,
                "on_order": oo, "need": need, "size_share": share, "lead_time_days": lead,
                "cover_days": cover_days, "flags": flags}})
    if skipped:
        log.warning("tenant %s run %s: no supplier for products %s; skipped", t.tenant_id, run_id, ", ".join(skipped))

    by_supplier: dict[int, list[dict]] = defaultdict(list)
    for g in groups.values():
        row, ls = g["row"], g["lines"]
        total = sum(x["qty"] for x in ls)
        moq = int(row["moq"] or 0)
        if 0 < total < moq:
            fc_tot = sum(x["detail"]["forecast"] for x in ls)
            for x in ls:
                w = x["detail"]["forecast"] / fc_tot if fc_tot > 0 else x["qty"] / total
                x["qty"] = _round_up(x["qty"] + (moq - total) * w, row["pack_multiple"])
                x["detail"]["moq_raised"] = True
        by_supplier[row["supplier_id"]].extend(x for x in ls if x["qty"] > 0)

    conn.execute("SELECT pg_advisory_xact_lock(hashtext('engine.purchasing'), %s)", (t.tenant_id,))
    conn.execute("DELETE FROM po_lines WHERE tenant_id = %s AND po_number IN (SELECT po_number FROM purchase_orders"
                 " WHERE tenant_id = %s AND run_id = %s AND state = 'draft')", (t.tenant_id, t.tenant_id, run_id))
    conn.execute("DELETE FROM purchase_orders WHERE tenant_id = %s AND run_id = %s AND state = 'draft'",
                 (t.tenant_id, run_id))
    suppliers = sorted(s for s, ls in by_supplier.items() if ls)
    numbers = _next_po_numbers(conn, t, len(suppliers))
    for po, sid in zip(numbers, suppliers):
        conn.execute("INSERT INTO purchase_orders (tenant_id, po_number, supplier_id, state, run_id)"
                     " VALUES (%s,%s,%s,'draft',%s)", (t.tenant_id, po, sid, run_id))
        for x in by_supplier[sid]:
            conn.execute("INSERT INTO po_lines (tenant_id, po_number, variant_id, qty_suggested, detail)"
                         " VALUES (%s,%s,%s,%s,%s)", (t.tenant_id, po, x["variant_id"], x["qty"], Jsonb(x["detail"])))
    conn.commit()
    return numbers


def _lock_po(conn, t: Tenant, po_number: str) -> dict:
    row = conn.execute("SELECT * FROM purchase_orders WHERE tenant_id = %s AND po_number = %s FOR UPDATE",
                       (t.tenant_id, po_number)).fetchone()
    if row is None:
        conn.rollback()
        raise KeyError(f"unknown PO {po_number}")
    return row


def approve_po(conn, t: Tenant, po_number: str, edits: dict[str, int] | None = None) -> None:
    """Set qty_approved (edits {variant_id: qty}, default qty_suggested) and move draft -> approved.

    Approving an approved PO is a no op; any other state raises ValueError.
    """
    try:
        row = _lock_po(conn, t, po_number)
        if row["state"] == "approved":
            conn.rollback()
            return
        if row["state"] != "draft":
            raise ValueError(f"PO {po_number} is {row['state']}; only a draft can be approved")
        variants = {r["variant_id"] for r in conn.execute(
            "SELECT variant_id FROM po_lines WHERE tenant_id = %s AND po_number = %s", (t.tenant_id, po_number))}
        edits = edits or {}
        bad = [v for v, q in edits.items() if v not in variants or int(q) < 0]
        if bad:
            raise ValueError(f"PO {po_number}: invalid edits for {bad}")
        conn.execute("UPDATE po_lines SET qty_approved = qty_suggested WHERE tenant_id = %s AND po_number = %s",
                     (t.tenant_id, po_number))
        for v, q in edits.items():
            conn.execute("UPDATE po_lines SET qty_approved = %s WHERE tenant_id = %s AND po_number = %s"
                         " AND variant_id = %s", (int(q), t.tenant_id, po_number, v))
        conn.execute("UPDATE purchase_orders SET state = 'approved', approved_at = now()"
                     " WHERE tenant_id = %s AND po_number = %s", (t.tenant_id, po_number))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def _find_transfer(client, po_number: str) -> dict | None:
    """The Shopify inventory transfer whose referenceName is exactly the PO number, if any."""
    after = None
    while True:
        conn_ = client.graphql(TRANSFER_BY_REFERENCE, {"query": po_number, "after": after})["inventoryTransfers"]
        for n in conn_["nodes"]:
            if n.get("referenceName") == po_number:
                return n
        info = conn_.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            return None
        after = info["endCursor"]


def push_po(conn, t: Tenant, po_number: str) -> str:
    """Create the Shopify inventory transfer for an approved PO and mark it ready to ship; returns its id.

    Idempotent: a pushed PO returns its transfer without calling Shopify, and an existing transfer with
    referenceName = PO number is reused. The PO row is locked so concurrent pushes create one transfer.
    """
    try:
        row = _lock_po(conn, t, po_number)
        if row["state"] in ("pushed", "partially_received", "received") and row["transfer_id"]:
            conn.rollback()
            return row["transfer_id"]
        if row["state"] != "approved":
            raise ValueError(f"PO {po_number} is {row['state']}; only an approved PO can be pushed")
        if not t.main_location_id:
            raise ValueError(f"tenant {t.tenant_id} has no main location")
        items = conn.execute(
            "SELECT l.variant_id, l.qty_approved, p.inventory_item_id FROM po_lines l LEFT JOIN products p"
            " ON p.tenant_id = l.tenant_id AND p.variant_id = l.variant_id"
            " WHERE l.tenant_id = %s AND l.po_number = %s AND l.qty_approved > 0 ORDER BY l.variant_id",
            (t.tenant_id, po_number)).fetchall()
        if not items:
            raise ValueError(f"PO {po_number} has no approved quantity")
        missing = [r["variant_id"] for r in items if not r["inventory_item_id"]]
        if missing:
            raise ValueError(f"PO {po_number}: no inventory item for {missing}")

        client = shopify_client(t)
        existing = _find_transfer(client, po_number)
        if existing is None:
            created = _payload(client.graphql(TRANSFER_CREATE, {"input": {
                "destinationLocationId": t.main_location_id, "referenceName": po_number,
                "lineItems": [{"inventoryItemId": r["inventory_item_id"], "quantity": int(r["qty_approved"])}
                              for r in items]}}), "inventoryTransferCreate")
            transfer = created["inventoryTransfer"]
        else:
            transfer = existing
        if (transfer.get("status") or "DRAFT").upper() == "DRAFT":
            _payload(client.graphql(TRANSFER_MARK_READY, {"id": transfer["id"]}), "inventoryTransferMarkAsReadyToShip")
        conn.execute("UPDATE purchase_orders SET state = 'pushed', transfer_id = %s, pushed_at = now()"
                     " WHERE tenant_id = %s AND po_number = %s", (transfer["id"], t.tenant_id, po_number))
        conn.commit()
        return transfer["id"]
    except Exception:
        conn.rollback()
        raise


def sync_receipts(conn, t: Tenant) -> int:
    """Read actual received quantities of pushed / partially received POs from Shopify; returns lines changed.

    Positive deltas become stock_receipts rows (tenant local today, main location, source = PO number).
    """
    item_variant = {r["inventory_item_id"]: r["variant_id"] for r in conn.execute(
        "SELECT inventory_item_id, variant_id FROM products WHERE tenant_id = %s AND inventory_item_id IS NOT NULL",
        (t.tenant_id,))}
    pos = conn.execute("SELECT po_number, transfer_id FROM purchase_orders WHERE tenant_id = %s AND state = ANY(%s)"
                       " AND transfer_id IS NOT NULL ORDER BY po_number", (t.tenant_id, list(RECEIVING_STATES))).fetchall()
    today, changed = _local_today(t), 0
    for po in pos:
        tr = fetch_transfer(t, po["transfer_id"])
        received: dict[str, int] = defaultdict(int)
        for li in tr["lines"]:
            v = item_variant.get(li["inventory_item_id"])
            if v is None:
                log.warning("tenant %s PO %s: transfer line for unknown inventory item %s",
                            t.tenant_id, po["po_number"], li["inventory_item_id"])
                continue
            received[v] += max(int(li["received"]), 0)
        lines = conn.execute("SELECT variant_id, qty_approved, qty_received FROM po_lines"
                             " WHERE tenant_id = %s AND po_number = %s FOR UPDATE",
                             (t.tenant_id, po["po_number"])).fetchall()
        for ln in lines:
            new = received.get(ln["variant_id"], 0)
            delta = new - ln["qty_received"]
            if delta == 0:
                continue
            changed += 1
            conn.execute("UPDATE po_lines SET qty_received = %s WHERE tenant_id = %s AND po_number = %s"
                         " AND variant_id = %s", (new, t.tenant_id, po["po_number"], ln["variant_id"]))
            if delta > 0:
                conn.execute("INSERT INTO stock_receipts (tenant_id, date, variant_id, location_id, qty, source)"
                             " VALUES (%s,%s,%s,%s,%s,%s)",
                             (t.tenant_id, today, ln["variant_id"], t.main_location_id, delta, po["po_number"]))
            ln["qty_received"] = new
        got = sum(ln["qty_received"] for ln in lines)
        complete = all(ln["qty_received"] >= (ln["qty_approved"] or 0) for ln in lines)
        state = "received" if complete and got > 0 else "partially_received" if got > 0 else "pushed"
        conn.execute("UPDATE purchase_orders SET state = %s WHERE tenant_id = %s AND po_number = %s",
                     (state, t.tenant_id, po["po_number"]))
    conn.commit()
    return changed


def cancel_po(conn, t: Tenant, po_number: str) -> None:
    """draft / approved -> cancelled; pushed -> cancel the Shopify transfer, then cancelled; received raises."""
    try:
        row = _lock_po(conn, t, po_number)
        if row["state"] == "cancelled":
            conn.rollback()
            return
        if row["state"] in ("partially_received", "received"):
            raise ValueError(f"PO {po_number} is {row['state']}; it cannot be cancelled")
        if row["state"] == "pushed" and row["transfer_id"]:
            _payload(shopify_client(t).graphql(TRANSFER_CANCEL, {"id": row["transfer_id"]}), "inventoryTransferCancel")
        conn.execute("UPDATE purchase_orders SET state = 'cancelled' WHERE tenant_id = %s AND po_number = %s",
                     (t.tenant_id, po_number))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def restock_lift(conn, t: Tenant, po_number: str) -> float | None:
    """Units per in stock variant day in the 14 days from the first receipt ÷ the 14 days before.

    In stock = available summed over locations > 0 on that day in stock_daily. None when either side has no
    in stock days or the before rate is 0.
    """
    first = conn.execute("SELECT MIN(date) AS d FROM stock_receipts WHERE tenant_id = %s AND source = %s",
                         (t.tenant_id, po_number)).fetchone()["d"]
    if first is None:
        return None
    variants = [r["variant_id"] for r in conn.execute(
        "SELECT variant_id FROM po_lines WHERE tenant_id = %s AND po_number = %s", (t.tenant_id, po_number))]
    if not variants:
        return None
    lo, hi = first - timedelta(days=LIFT_DAYS), first + timedelta(days=LIFT_DAYS)
    rows = conn.execute(
        "SELECT s.date, s.variant_id, COALESCE(u.units, 0) AS units FROM"
        " (SELECT date, variant_id FROM stock_daily WHERE tenant_id = %(t)s AND variant_id = ANY(%(v)s)"
        "  AND date >= %(lo)s AND date < %(hi)s GROUP BY date, variant_id HAVING SUM(available) > 0) s"
        " LEFT JOIN (SELECT date, variant_id, SUM(qty) AS units FROM sales_lines WHERE tenant_id = %(t)s"
        "  AND variant_id = ANY(%(v)s) AND date >= %(lo)s AND date < %(hi)s GROUP BY date, variant_id) u"
        " ON u.date = s.date AND u.variant_id = s.variant_id",
        {"t": t.tenant_id, "v": variants, "lo": lo, "hi": hi}).fetchall()
    side = {"before": [0.0, 0], "after": [0.0, 0]}
    for r in rows:
        s = side["after" if r["date"] >= first else "before"]
        s[0] += float(r["units"])
        s[1] += 1
    (ub, db_), (ua, da) = side["before"], side["after"]
    if db_ == 0 or da == 0 or ub <= 0:
        return None
    return (ua / da) / (ub / db_)
