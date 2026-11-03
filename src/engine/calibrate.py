"""Calibration: Meta purchases -> Shopify orders factor per month, and lift test scaling of the ad response."""
from __future__ import annotations

from dataclasses import replace
from datetime import date

from .customers import _month_range, is_meta_order
from .model import DemandParams
from .tenants import Tenant

FACTOR_MIN, FACTOR_MAX = 0.2, 1.5


def meta_factor(conn, t: Tenant, month: str) -> float:
    """Shopify orders attributed to Meta (UTM rule of customers.py) / Meta purchases in `month` ('YYYY-MM').

    Capped to [0.2, 1.5]; 1.0 when Meta reported no purchases. Upserts the calibration row.
    """
    start, end = _month_range(month)
    p = {"tenant_id": t.tenant_id, "start": start, "end": end}
    ads = {r["ad_id"] for r in conn.execute(
        "SELECT DISTINCT ad_id FROM ad_spend_daily WHERE tenant_id = %(tenant_id)s", p)}
    orders = conn.execute(
        "SELECT utm_source, utm_content FROM orders WHERE tenant_id = %(tenant_id)s"
        " AND date >= %(start)s AND date < %(end)s", p).fetchall()
    utm_orders = sum(1 for r in orders if is_meta_order(r["utm_source"], r["utm_content"], ads))
    purchases = float(conn.execute(
        "SELECT COALESCE(SUM(purchases), 0) AS n FROM ad_spend_daily WHERE tenant_id = %(tenant_id)s"
        " AND date >= %(start)s AND date < %(end)s", p).fetchone()["n"])
    if purchases > 0:
        raw = utm_orders / purchases
        factor = min(max(raw, FACTOR_MIN), FACTOR_MAX)
        capped = factor != raw
    else:
        factor, capped = 1.0, False
    conn.execute(
        "INSERT INTO calibration (tenant_id, month, meta_factor, utm_orders, meta_purchases, capped)"
        " VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (tenant_id, month) DO UPDATE SET meta_factor = EXCLUDED.meta_factor,"
        " utm_orders = EXCLUDED.utm_orders, meta_purchases = EXCLUDED.meta_purchases, capped = EXCLUDED.capped",
        (t.tenant_id, month, factor, utm_orders, purchases, capped))
    conn.commit()
    return float(factor)


def set_lift(conn, t: Tenant, style_id: str, factor: float, tested_on: date) -> None:
    """Store (or replace) a lift test result for a style."""
    conn.execute(
        "INSERT INTO lift_tests (tenant_id, style_id, factor, tested_on) VALUES (%s,%s,%s,%s)"
        " ON CONFLICT (tenant_id, style_id, tested_on) DO UPDATE SET factor = EXCLUDED.factor",
        (t.tenant_id, style_id, factor, tested_on))
    conn.commit()


def apply_lift(params: list[DemandParams], conn, t: Tenant) -> list[DemandParams]:
    """Copies of params with `a` times the latest lift factor of the entity's style (inputs are not mutated)."""
    p = {"tenant_id": t.tenant_id}
    lifts = {r["style_id"]: float(r["factor"]) for r in conn.execute(
        "SELECT DISTINCT ON (style_id) style_id, factor FROM lift_tests WHERE tenant_id = %(tenant_id)s"
        " ORDER BY style_id, tested_on DESC", p)}
    style_of = {r["product_id"]: r["style_id"] for r in conn.execute(
        "SELECT product_id, style_id FROM product_style WHERE tenant_id = %(tenant_id)s", p)}
    out = []
    for q in params:
        style = style_of.get(q.entity_id) if q.level == "product" else q.entity_id if q.level == "style" else None
        f = lifts.get(style)
        out.append(replace(q, a=q.a * f, seasonal=dict(q.seasonal), flags=list(q.flags)) if f is not None
                   else replace(q, seasonal=dict(q.seasonal), flags=list(q.flags)))
    return out
