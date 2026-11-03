"""Funnel roll-up: pixel_events -> funnel_daily, keyed to current variants and products."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .. import lineage
from ..tenants import Tenant


def rollup_funnel(conn, t: Tenant, day: date, cv=None, prod_of: dict | None = None) -> int:
    """Rebuild funnel_daily for one tenant local day (delete then insert). Returns rows written.

    Product level row (variant_id ''): views, atc, orders. Variant rows: size_views, size_views_unavailable.
    Old variants map to the current variant and its product through confirmed lineage. cv (lineage map) and
    prod_of (variant -> product) may be passed in when rolling up many days.
    """
    tz = ZoneInfo(t.timezone)
    lo = datetime.combine(day, time.min, tz)                       # local midnight .. next local midnight,
    hi = datetime.combine(day + timedelta(days=1), time.min, tz)   # a ts range so pixel_events_idx is used
    p = {"tenant_id": t.tenant_id, "day": day, "lo": lo, "hi": hi}
    events = conn.execute(
        "SELECT session_hash, event, product_id, variant_id, available FROM pixel_events"
        " WHERE tenant_id = %(tenant_id)s AND ts >= %(lo)s AND ts < %(hi)s", p).fetchall()
    cv = cv if cv is not None else lineage.current_variant(conn, t)
    if prod_of is None:
        prod_of = {r["variant_id"]: r["product_id"] for r in conn.execute(
            "SELECT variant_id, product_id FROM products WHERE tenant_id = %(tenant_id)s", p)}

    views, orders, size, size_un = defaultdict(set), defaultdict(set), defaultdict(set), defaultdict(set)
    atc = defaultdict(int)
    for e in events:
        v = e["variant_id"]
        cur = cv.get(v, v) if v else None
        pid = prod_of.get(cur) if cur else None
        pid = pid or e["product_id"]
        if not pid:
            continue
        s, ev = e["session_hash"], e["event"]
        if ev == "product_viewed":
            views[pid].add(s)
        elif ev == "product_added_to_cart":
            atc[pid] += 1
        elif ev == "checkout_completed":
            orders[pid].add(s)
        elif ev == "size_selected" and cur:
            size[(pid, cur)].add(s)
            if e["available"] is False:
                size_un[(pid, cur)].add(s)

    rows = []
    for pid in set(views) | set(atc) | set(orders):
        rows.append((pid, "", len(views[pid]), 0, 0, atc[pid], len(orders[pid])))
    for (pid, cur), sess in size.items():
        rows.append((pid, cur, 0, len(sess), len(size_un[(pid, cur)]), 0, 0))

    conn.execute("DELETE FROM funnel_daily WHERE tenant_id = %(tenant_id)s AND date = %(day)s", p)
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO funnel_daily (tenant_id, date, product_id, variant_id, views, size_views,"
            " size_views_unavailable, atc, orders) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [(t.tenant_id, day, *r) for r in rows])
    conn.commit()
    return len(rows)
