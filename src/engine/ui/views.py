"""Data for the screen's pages: names instead of ids, plain language labels, money in the tenant currency.

Every query filters tenant_id. Report numbers come from the engine (cli.build_report, the decisions table of a run,
the PO and plan tables); nothing here recomputes a metric.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

from .. import cli
from ..tenants import Tenant

PO_STATES = ("draft", "approved", "pushed", "partially_received", "received", "cancelled")
PO_STATE_LABELS = {"draft": "Draft (waiting for you)", "approved": "Approved, not sent yet",
                   "pushed": "Sent to Shopify", "partially_received": "Partly received", "received": "Received",
                   "cancelled": "Cancelled"}

# decision -> (css class, what it means in plain words)
DECISIONS = {
    "SCALE": ("scale", "Doing well: more ad money here should pay off."),
    "RESTOCK FIRST": ("restock", "Selling out: order more stock before spending more on ads."),
    "FIX PRICE": ("price", "The price is holding sales back: review the price."),
    "CUT SPEND": ("cut", "Ads cost more than they bring back: lower the ad budget."),
    "KILL": ("kill", "Losing money month after month: stop the ads and do not reorder."),
    "TEST": ("test", "Too new to judge: keep testing."),
    "MAINTAIN": ("maintain", "Steady: keep things as they are."),
}

STAGE_LABELS = {
    "sync_products": "Read products", "ingest_orders": "Read orders", "ingest_spend": "Read Meta ad spend",
    "ingest_landing_sessions": "Read page visits", "rollup_funnel": "Storefront pixel totals",
    "lineage": "Match old and new colours", "run_attribution": "Split ad spend over products",
    "meta_factor": "Meta count correction", "fit": "Fit demand models", "score_runs": "Check earlier forecasts",
    "run_decisions": "Decide per product", "suggest_pos": "Suggest purchase orders",
    "forward_plan": "3 month plan", "rolling_backtest": "Forecast accuracy test",
}


# ---------------------------------------------------------------- formatting

def _num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, Decimal):
        v = float(v)
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def fmt_money(v, currency: str) -> str:
    x = _num(v)
    if x is None:
        return "–"
    return f"{currency} {x:,.0f}" if abs(x) >= 100 or x == 0 else f"{currency} {x:,.2f}"


def fmt_num(v, nd: int = 0) -> str:
    x = _num(v)
    return "–" if x is None else f"{x:,.{nd}f}"


def fmt_pct(v) -> str:
    x = _num(v)
    return "–" if x is None else f"{x * 100:.1f}%" if abs(x) < 0.1 else f"{x * 100:.0f}%"


def fmt_date(v) -> str:
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, date):
        return v.isoformat()
    return "" if v is None else str(v)[:10]


def flags_of(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [f for f in v.split(",") if f]
    if isinstance(v, dict):
        return [k for k, on in v.items() if on]
    return [str(f) for f in v]


FLAG_LABELS = {"missing_cost": "no unit cost", "views_estimated": "visits estimated", "few_periods": "little history"}


def plain_rule(rule: str | None, currency: str) -> str:
    """The rule text of a decision in plain words (the stored rule stays available as the technical text)."""
    if not rule:
        return ""
    s = re.sub(r"^[A-Z ]+:\s*", "", rule)
    s = re.sub(r"stock cover (\S+) days < lead time (\S+)", r"stock lasts \1 days, less than the \2 days restocking"
               r" takes", s)
    for old, new in (
        ("marginal POAS", f"profit from the next {currency} of ads"),
        ("marginal ROAS", f"sales from the next {currency} of ads"),
        ("POAS", f"profit per {currency} of ads"), ("ROAS", f"sales per {currency} of ads"),
        ("paid CAC", "the ad cost of a new customer"), ("customer value 12m", "a customer's 12 month profit"),
        ("lost_stock", "sales lost to empty sizes"), ("lost_price", "sales lost to price"),
        ("true_demand", "real demand"), ("size availability", "sizes in stock"),
        ("stock cover", "stock lasts"),
        ("usable periods", "periods of history"), ("(missing cost)", "(no unit cost, so sales stand in for profit)"),
        (" >= ", " is at least "), (" <= ", " is at most "), (" < ", " is below "), (" > ", " is above "),
    ):
        s = s.replace(old, new)
    return s[:1].upper() + s[1:]


# ---------------------------------------------------------------- names

def names(conn, t: Tenant) -> dict[str, dict]:
    """Display names: product id -> title, style id -> name, variant id -> (title, size)."""
    prod, var = {}, {}
    for r in conn.execute("SELECT variant_id, product_id, title, size, sku FROM products WHERE tenant_id = %s",
                          (t.tenant_id,)):
        prod.setdefault(r["product_id"], r["title"] or r["product_id"])
        var[r["variant_id"]] = (r["title"] or r["product_id"], r["size"] or "", r["sku"] or "")
    styles = {r["style_id"]: (r["name"] or r["style_id"]).title()
              for r in conn.execute("SELECT style_id, name FROM styles WHERE tenant_id = %s", (t.tenant_id,))}
    return {"product": prod, "style": styles, "variant": var}


def entity_name(nm: dict, level: str, entity_id: str) -> str:
    return nm.get(level, {}).get(entity_id) or entity_id


# ---------------------------------------------------------------- runs

def runs(conn, t: Tenant, limit: int = 24) -> list[dict]:
    return conn.execute("SELECT run_id, month, status, started_at, finished_at FROM runs WHERE tenant_id = %s"
                        " ORDER BY started_at DESC LIMIT %s", (t.tenant_id, limit)).fetchall()


def stage_rows(stages: dict | None) -> list[dict]:
    """runs.stages as an ordered list: name, label, status, seconds, error."""
    out = []
    for name, info in sorted((stages or {}).items(), key=lambda kv: kv[1].get("seq", 99)):
        out.append({"name": name, "label": STAGE_LABELS.get(name, name), "status": info.get("status"),
                    "seconds": info.get("seconds"), "error": info.get("error")})
    return out


def last_run(conn, t: Tenant) -> dict | None:
    r = conn.execute("SELECT run_id, month, status, started_at, finished_at, stages FROM runs WHERE tenant_id = %s"
                     " ORDER BY started_at DESC LIMIT 1", (t.tenant_id,)).fetchone()
    if r is None:
        return None
    rows = stage_rows(r["stages"])
    return {**r, "stage_rows": rows, "warnings": [s for s in rows if s["status"] in ("warning", "failed")]}


# ---------------------------------------------------------------- overview

def _key_numbers(n: dict, currency: str) -> list[tuple[str, str]]:
    poas = _num(n.get("poas"))
    ratio = ("Profit per %s of ads (POAS)" % currency, fmt_num(poas, 2)) if poas is not None or \
        _num(n.get("roas")) is None else ("Sales per %s of ads (ROAS)" % currency, fmt_num(n.get("roas"), 2))
    return [("Sales", fmt_money(n.get("revenue"), currency)), ("Ad spend", fmt_money(n.get("spend"), currency)),
            ratio, ("Days of stock left", fmt_num(n.get("stock_cover_days")))]


def decision_cards(conn, t: Tenant, run_id: str, nm: dict) -> dict[str, list[dict]]:
    """level -> cards of the run's decisions (latest decided month of the run)."""
    rows = conn.execute(
        "SELECT level, entity_id, decision, rule, numbers, flags FROM decisions WHERE tenant_id = %s AND run_id = %s"
        " AND month = (SELECT max(month) FROM decisions WHERE tenant_id = %s AND run_id = %s)"
        " ORDER BY level DESC, entity_id", (t.tenant_id, run_id, t.tenant_id, run_id)).fetchall()
    out: dict[str, list[dict]] = {"style": [], "product": []}
    for r in rows:
        css, meaning = DECISIONS.get(r["decision"], ("maintain", ""))
        out.setdefault(r["level"], []).append({
            "name": entity_name(nm, r["level"], r["entity_id"]), "decision": r["decision"], "css": css,
            "meaning": meaning, "plain": plain_rule(r["rule"], t.currency), "rule": r["rule"],
            "numbers": _key_numbers(r["numbers"] or {}, t.currency), "flags": flags_of(r["flags"])})
    for cards in out.values():
        cards.sort(key=lambda c: c["name"])
    return out


def waiting(conn, t: Tenant) -> dict:
    """Things waiting for the user: draft POs, colour matches to review, ad spend no product is mapped to."""
    drafts = conn.execute("SELECT count(*) AS n FROM purchase_orders WHERE tenant_id = %s AND state = 'draft'",
                          (t.tenant_id,)).fetchone()["n"]
    pending = conn.execute("SELECT count(*) AS n FROM variant_lineage WHERE tenant_id = %s AND NOT confirmed",
                           (t.tenant_id,)).fetchone()["n"]
    ads = unmapped_ads(conn, t)
    return {"drafts": drafts, "lineage": pending, "unmapped_ads": len(ads),
            "unmapped_spend": sum(_num(a["spend"]) or 0.0 for a in ads)}


def unmapped_ads(conn, t: Tenant) -> list[dict]:
    """Ads whose spend went to the shared pool and that have no manual map yet, most spend first."""
    return conn.execute(
        "SELECT u.ad_id, max(u.ad_name) AS ad_name, max(u.reason) AS reason, sum(u.spend) AS spend,"
        " min(u.date) AS first_date, max(u.date) AS last_date FROM unmapped_spend_log u"
        " WHERE u.tenant_id = %s AND u.ad_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_product_map m"
        "  WHERE m.tenant_id = u.tenant_id AND m.ad_id = u.ad_id)"
        " GROUP BY u.ad_id ORDER BY sum(u.spend) DESC, u.ad_id", (t.tenant_id,)).fetchall()


# ---------------------------------------------------------------- lost sales

def lost_sales(report: dict, nm: dict) -> dict:
    """Bars per style on one shared scale: sold, lost to stock, lost to price (only a loss is drawn)."""
    rows = []
    for r in report["lost_sales"].to_dict("records"):
        sold, ls, lp = (_num(r["units"]) or 0.0), max(_num(r["lost_stock"]) or 0.0, 0.0), _num(r["lost_price"])
        rows.append({"name": entity_name(nm, "style", r["entity_id"]), "sold": sold, "lost_stock": ls,
                     "lost_price": lp, "lost_price_bar": max(lp or 0.0, 0.0), "true_demand": _num(r["true_demand"]),
                     "unexplained": _num(r["unexplained"])})
    scale = max([r["sold"] + r["lost_stock"] + r["lost_price_bar"] for r in rows] + [1e-9])
    width = 1000.0
    for r in rows:
        x = 0.0
        r["segments"] = []
        for key, css in (("sold", "seg-sold"), ("lost_stock", "seg-stock"), ("lost_price_bar", "seg-price")):
            w = r[key] / scale * width
            if w > 0:
                r["segments"].append({"x": round(x, 1), "w": round(w, 1), "css": css})
            x += w
    rows.sort(key=lambda r: -(r["sold"] + r["lost_stock"] + r["lost_price_bar"]))
    return {"rows": rows, "scale": scale}


# ---------------------------------------------------------------- scorecard

def scorecard_columns(currency: str) -> list[tuple[str, str, str, str]]:
    """(key, plain label, technical name, kind) for the Spec 32 scorecard."""
    c = currency
    return [
        ("views", "Product page visits", "views", "num"),
        ("cr", "Buy rate", "cr", "pct"),
        ("cr_full", "Buy rate, all sizes in stock", "cr_full", "pct"),
        ("size_availability", "Sizes in stock", "size_availability", "pct"),
        ("units", "Units sold", "units", "num"),
        ("lost_stock", "Lost to empty sizes", "lost_stock", "num1"),
        ("lost_price", "Lost to price", "lost_price", "num1"),
        ("true_demand", "Real demand", "true_demand", "num1"),
        ("revenue", "Sales", "revenue", "money"),
        ("gross_profit", "Gross profit", "gross_profit", "money"),
        ("spend", "Ad spend", "spend", "money"),
        ("impressions", "Ad views", "impressions", "num"),
        ("cpm", "Cost per 1,000 ad views", "CPM", "money"),
        ("meta_cpa", "Cost per order (Meta count)", "Meta CPA", "money"),
        ("shopify_cpa", "Cost per order (Shopify count)", "Shopify CPA", "money"),
        ("blended_cac", "Cost per new customer", "blended CAC", "money"),
        ("paid_cac", "Ad cost per new customer", "paid CAC", "money"),
        ("customer_value_12m", "Customer 12 month profit", "customer value 12m", "money"),
        ("poas", f"Profit per {c} of ads", "POAS", "ratio"),
        ("marginal_poas", f"Profit from the next {c} of ads", "marginal POAS", "ratio"),
        ("roas", f"Sales per {c} of ads", "ROAS", "ratio"),
        ("marginal_roas", f"Sales from the next {c} of ads", "marginal ROAS", "ratio"),
        ("stock_cover_days", "Days of stock left", "stock cover days", "num"),
        ("available", "In stock now", "available", "num"),
        ("on_order", "On order", "on order", "num"),
        ("restock_lift", "Sales lift after restock", "restock lift", "ratio"),
        ("meta_factor", "Meta count correction", "meta_factor", "ratio"),
    ]


def fmt_kind(v, kind: str, currency: str) -> str:
    return {"money": lambda: fmt_money(v, currency), "pct": lambda: fmt_pct(v), "ratio": lambda: fmt_num(v, 2),
            "num1": lambda: fmt_num(v, 1)}.get(kind, lambda: fmt_num(v))()


def scorecard(report: dict, nm: dict, level: str, t: Tenant) -> dict:
    cols = scorecard_columns(t.currency)
    df = report["scorecard"]
    rows = []
    for r in (df[df["level"] == level].to_dict("records") if len(df) else []):
        rows.append({"name": entity_name(nm, level, r["entity_id"]), "flags": flags_of(r.get("flags")),
                     "cells": [{"v": _num(r.get(k)), "text": fmt_kind(r.get(k), kind, t.currency)}
                               for k, _, _, kind in cols]})
    rows.sort(key=lambda r: r["name"])
    return {"columns": cols, "rows": rows}


# ---------------------------------------------------------------- plan

def plan(conn, t: Tenant, run_id: str, nm: dict) -> list[dict]:
    rows = conn.execute(
        "SELECT p.entity_id, p.month, p.spend, p.units, p.true_demand, p.revenue, p.profit, p.po_number,"
        " (SELECT d.decision FROM decisions d WHERE d.tenant_id = p.tenant_id AND d.run_id = p.run_id"
        "  AND d.level = 'style' AND d.entity_id = p.entity_id ORDER BY d.month DESC LIMIT 1) AS decision"
        " FROM product_plans p WHERE p.tenant_id = %s AND p.run_id = %s ORDER BY p.entity_id, p.month",
        (t.tenant_id, run_id)).fetchall()
    styles: dict[str, dict] = {}
    for r in rows:
        s = styles.setdefault(r["entity_id"], {
            "name": entity_name(nm, "style", r["entity_id"]), "decision": r["decision"],
            "css": DECISIONS.get(r["decision"], ("maintain", ""))[0], "months": [], "pos": []})
        s["months"].append(r)
        if r["po_number"] and r["po_number"] not in s["pos"]:
            s["pos"].append(r["po_number"])
    return sorted(styles.values(), key=lambda s: s["name"])


# ---------------------------------------------------------------- purchase orders

def po_groups(conn, t: Tenant) -> list[dict]:
    df = cli._pos(conn, t, open_only=False)
    by = defaultdict(list)
    for r in df.to_dict("records"):
        by[r["state"]].append(r)
    return [{"state": s, "label": PO_STATE_LABELS[s], "pos": by[s]} for s in PO_STATES if by.get(s)]


def po_detail(conn, t: Tenant, po_number: str, nm: dict) -> dict | None:
    po = conn.execute(
        "SELECT o.*, s.name AS supplier, s.lead_time_days FROM purchase_orders o LEFT JOIN suppliers s"
        " ON s.tenant_id = o.tenant_id AND s.supplier_id = o.supplier_id WHERE o.tenant_id = %s AND o.po_number = %s",
        (t.tenant_id, po_number)).fetchone()
    if po is None:
        return None
    lines = []
    for r in conn.execute("SELECT variant_id, qty_suggested, qty_approved, qty_received FROM po_lines"
                          " WHERE tenant_id = %s AND po_number = %s ORDER BY variant_id", (t.tenant_id, po_number)):
        title, size, sku = nm["variant"].get(r["variant_id"], (r["variant_id"], "", ""))
        lines.append({**r, "title": title, "size": size, "sku": sku})
    lines.sort(key=lambda ln: (ln["title"], ln["size"]))
    return {"po": po, "lines": lines, "label": PO_STATE_LABELS.get(po["state"], po["state"]),
            "totals": {k: sum(ln[k] or 0 for ln in lines) for k in ("qty_suggested", "qty_approved", "qty_received")}}


# ---------------------------------------------------------------- setup

def suppliers(conn, t: Tenant, nm: dict) -> list[dict]:
    rows = conn.execute(
        "SELECT s.supplier_id, s.name, s.kind, s.lead_time_days, s.pack_multiple, ps.style_id, ps.product_id, ps.moq"
        " FROM suppliers s LEFT JOIN product_suppliers ps ON ps.tenant_id = s.tenant_id"
        " AND ps.supplier_id = s.supplier_id WHERE s.tenant_id = %s ORDER BY s.name, ps.style_id, ps.product_id",
        (t.tenant_id,)).fetchall()
    for r in rows:
        r["makes"] = entity_name(nm, "style", r["style_id"]) + " (all colours)" if r["style_id"] else \
            entity_name(nm, "product", r["product_id"]) if r["product_id"] else ""
    return rows


def lineage_pending(conn, t: Tenant, nm: dict) -> list[dict]:
    rows = cli.lineage_pending(conn, t).to_dict("records")
    for r in rows:
        for side in ("old", "new"):
            title, size, _ = nm["variant"].get(r[f"{side}_variant_id"], (r[f"{side}_title"] or "", "", ""))
            r[f"{side}_label"] = f"{title} {size}".strip() or r[f"{side}_variant_id"]
    return rows


def ad_maps(conn, t: Tenant, nm: dict) -> list[dict]:
    rows = conn.execute("SELECT ad_id, product_id, share, share / sum(share) OVER (PARTITION BY ad_id) AS part"
                        " FROM ad_product_map WHERE tenant_id = %s ORDER BY ad_id, product_id",
                        (t.tenant_id,)).fetchall()
    for r in rows:
        r["product"] = entity_name(nm, "product", r["product_id"])
    return rows


def locations(conn, t: Tenant) -> list[dict]:
    return conn.execute("SELECT location_id, name FROM locations WHERE tenant_id = %s ORDER BY name, location_id",
                        (t.tenant_id,)).fetchall()


def promo_days(conn, t: Tenant, since: date) -> list[date]:
    return [r["date"] for r in conn.execute(
        "SELECT date FROM calendar WHERE tenant_id = %s AND flags -> 'promo' = 'true'::jsonb AND date >= %s"
        " ORDER BY date", (t.tenant_id, since))]


def promo_ranges(days: list[date]) -> list[tuple[date, date]]:
    out: list[list[date]] = []
    for d in days:
        if out and (d - out[-1][1]).days == 1:
            out[-1][1] = d
        else:
            out.append([d, d])
    return [(a, b) for a, b in out]
