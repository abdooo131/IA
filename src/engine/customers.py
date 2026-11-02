"""Customers, acquisition cost (CPA, CAC) and customer value.

Identity is already resolved at ingest (`orders.customer_key`: normalised phone, else email, else Shopify id).
Per entity (current colour product or style) metrics use `spend_by_product` and `order_credits` (Task 5).
Spend that could not be assigned (`__pool__`) is excluded from entity rows and reported on a `__store__` row.
"""
from __future__ import annotations

import re
from datetime import date

import pandas as pd

from .attribution import POOL_PRODUCT, UNKNOWN_PRODUCT
from .lineage import rekeyed_sales
from .tenants import Tenant

STORE = "__store__"
_UNASSIGNED = {POOL_PRODUCT, UNKNOWN_PRODUCT}
_META_SOURCE = re.compile(r"^(facebook|fb|instagram|ig|meta)(?![a-z0-9])")


# ---------------------------------------------------------------- helpers

def _month_range(month: str) -> tuple[date, date]:
    start = pd.Timestamp(f"{month}-01")
    return start.date(), (start + pd.DateOffset(months=1)).date()


def _div(num, den) -> float | None:
    """num / den, None (never NaN or inf) when the denominator is zero or missing."""
    if den is None or pd.isna(den) or float(den) == 0.0 or num is None or pd.isna(num):
        return None
    return float(num) / float(den)


def _entity_map(conn, t: Tenant, level: str) -> dict[str, str]:
    """current product id -> entity id (identity for 'product'); products without a style drop at 'style'."""
    if level == "product":
        return {r["product_id"]: r["product_id"] for r in conn.execute(
            "SELECT DISTINCT product_id FROM products WHERE tenant_id = %(tenant_id)s", {"tenant_id": t.tenant_id})}
    if level == "style":
        return {r["product_id"]: r["style_id"] for r in conn.execute(
            "SELECT product_id, style_id FROM product_style WHERE tenant_id = %(tenant_id)s",
            {"tenant_id": t.tenant_id})}
    raise ValueError(f"level must be 'product' or 'style', got {level!r}")


def is_meta_source(source: str | None) -> bool:
    return bool(source) and _META_SOURCE.match(source.strip().lower()) is not None


def is_meta_order(utm_source: str | None, utm_content: str | None, ad_ids) -> bool:
    """The Meta attribution rule: utm_source is facebook|fb|instagram|ig|meta, or utm_content is a tenant ad id."""
    return is_meta_source(utm_source) or (utm_content in ad_ids if utm_content else False)


# ---------------------------------------------------------------- first orders

def first_orders(conn, t: Tenant) -> pd.DataFrame:
    """First ever order per customer (by date, then order id) over the full history.

    Columns: customer_key, order_id, date, meta (True when the order is attributed to Meta: utm_source is
    facebook|fb|instagram|ig|meta, or utm_content is an ad id of this tenant). Orders without a customer key
    are skipped.
    """
    p = {"tenant_id": t.tenant_id}
    rows = conn.execute(
        "SELECT DISTINCT ON (customer_key) customer_key, order_id, date, utm_source, utm_content FROM orders"
        " WHERE tenant_id = %(tenant_id)s AND customer_key IS NOT NULL"
        " ORDER BY customer_key, date, order_id", p).fetchall()
    ads = {r["ad_id"] for r in conn.execute(
        "SELECT DISTINCT ad_id FROM ad_spend_daily WHERE tenant_id = %(tenant_id)s", p)}
    out = pd.DataFrame(
        [{"customer_key": r["customer_key"], "order_id": r["order_id"], "date": r["date"],
          "meta": is_meta_order(r["utm_source"], r["utm_content"], ads)}
         for r in rows], columns=["customer_key", "order_id", "date", "meta"])
    return out.sort_values(["date", "order_id"]).reset_index(drop=True)


def _credits(conn, t: Tenant, level: str, start: date | None = None, end: date | None = None) -> pd.DataFrame:
    """order_credits as (order_id, entity_id, credit) summed per entity; unassigned products dropped."""
    rows = conn.execute(
        "SELECT order_id, product_id, credit FROM order_credits WHERE tenant_id = %(tenant_id)s",
        {"tenant_id": t.tenant_id}).fetchall()
    df = pd.DataFrame(rows, columns=["order_id", "product_id", "credit"])
    df["credit"] = df["credit"].astype(float)
    emap = _entity_map(conn, t, level)
    df["entity_id"] = df["product_id"].map(emap)
    df = df[df["entity_id"].notna() & ~df["product_id"].isin(_UNASSIGNED)]
    return df.groupby(["order_id", "entity_id"], as_index=False)["credit"].sum()


def _month_spend(conn, t: Tenant, month: str, level: str) -> tuple[pd.Series, pd.DataFrame, float]:
    """(spend per entity, per entity impressions/purchases frame, store total spend) for the month."""
    start, end = _month_range(month)
    rows = conn.execute(
        "SELECT product_id, SUM(spend) AS spend, SUM(meta_purchases) AS purchases FROM spend_by_product"
        " WHERE tenant_id = %(tenant_id)s AND date >= %(s)s AND date < %(e)s GROUP BY product_id",
        {"tenant_id": t.tenant_id, "s": start, "e": end}).fetchall()
    df = pd.DataFrame(rows, columns=["product_id", "spend", "purchases"])
    df[["spend", "purchases"]] = df[["spend", "purchases"]].astype(float)
    emap = _entity_map(conn, t, level)
    total = df[["spend", "purchases"]].sum()
    df = df[~df["product_id"].isin(_UNASSIGNED)]
    df["entity_id"] = df["product_id"].map(emap)
    ent = df[df["entity_id"].notna()].groupby("entity_id")[["spend", "purchases"]].sum()
    return ent, total


# ---------------------------------------------------------------- CPA

def cpa(conn, t: Tenant, month: str, level: str, meta_factor: float = 1.0) -> pd.DataFrame:
    """Cost per order for a month ('YYYY-MM') per entity plus a `__store__` row.

    Columns: entity_id, spend, meta_purchases, order_credits, meta_cpa, shopify_cpa.
    meta_cpa = spend / (meta_purchases * meta_factor); shopify_cpa = spend / sum of order credits (per order,
    not per unit). A zero denominator gives None.
    """
    start, end = _month_range(month)
    ent, total = _month_spend(conn, t, month, level)
    orders = {r["order_id"] for r in conn.execute(
        "SELECT order_id FROM orders WHERE tenant_id = %(tenant_id)s AND date >= %(s)s AND date < %(e)s",
        {"tenant_id": t.tenant_id, "s": start, "e": end})}
    cr = _credits(conn, t, level)
    cr = cr[cr["order_id"].isin(orders)].groupby("entity_id")["credit"].sum()
    rows = []
    for eid in sorted(set(ent.index) | set(cr.index)):
        spend = float(ent["spend"].get(eid, 0.0))
        mp = float(ent["purchases"].get(eid, 0.0))
        oc = float(cr.get(eid, 0.0))
        rows.append((eid, spend, mp, oc, _div(spend, mp * meta_factor), _div(spend, oc)))
    store_orders = float(len(orders))
    rows.append((STORE, float(total["spend"]), float(total["purchases"]), store_orders,
                 _div(total["spend"], total["purchases"] * meta_factor), _div(total["spend"], store_orders)))
    return pd.DataFrame(rows, columns=["entity_id", "spend", "meta_purchases", "order_credits",
                                       "meta_cpa", "shopify_cpa"])


# ---------------------------------------------------------------- CAC

def cac(conn, t: Tenant, month: str, level: str, lift: float | dict[str, float] = 1.0) -> pd.DataFrame:
    """Customer acquisition cost for a month per entity plus a `__store__` row.

    Columns: entity_id, spend, new_customers, meta_new_customers, blended_cac, paid_cac.
    new_customers = credits (Spec 13 split) of the first orders placed in the month. blended_cac = spend /
    new_customers. paid_cac = spend / (meta_new_customers * lift), where meta_new_customers counts only first
    orders attributed to Meta and lift (float, or entity id -> float, default 1.0) is the share of them that is
    incremental. A zero denominator gives None.
    """
    start, end = _month_range(month)
    ent, total = _month_spend(conn, t, month, level)
    fo = first_orders(conn, t)
    fo = fo[(fo["date"] >= start) & (fo["date"] < end)]
    meta_orders = set(fo.loc[fo["meta"], "order_id"])
    cr = _credits(conn, t, level)
    cr = cr[cr["order_id"].isin(set(fo["order_id"]))]
    new = cr.groupby("entity_id")["credit"].sum()
    meta_new = cr[cr["order_id"].isin(meta_orders)].groupby("entity_id")["credit"].sum()

    def lift_of(eid):
        return float(lift.get(eid, 1.0)) if isinstance(lift, dict) else float(lift)

    rows = []
    for eid in sorted(set(ent.index) | set(new.index)):
        spend = float(ent["spend"].get(eid, 0.0))
        n, m = float(new.get(eid, 0.0)), float(meta_new.get(eid, 0.0))
        rows.append((eid, spend, n, m, _div(spend, n), _div(spend, m * lift_of(eid))))
    n, m = float(len(fo)), float(fo["meta"].sum())
    store_lift = float(lift.get(STORE, 1.0)) if isinstance(lift, dict) else float(lift)
    rows.append((STORE, float(total["spend"]), n, m, _div(total["spend"], n),
                 _div(total["spend"], m * store_lift)))
    return pd.DataFrame(rows, columns=["entity_id", "spend", "new_customers", "meta_new_customers",
                                       "blended_cac", "paid_cac"])


# ---------------------------------------------------------------- customer value

def _customer_values(conn, t: Tenant, months: int, as_of: date) -> tuple[pd.DataFrame, bool]:
    """Per customer with a first order: order_id, value (None when not computable), missing_cost, young_unscaled.

    Returns (frame, store_has_cost).
    """
    fo = first_orders(conn, t)
    cols = ["customer_key", "order_id", "value", "missing_cost", "young_unscaled"]
    if fo.empty:
        return pd.DataFrame(columns=cols), False
    sales = rekeyed_sales(conn, t)
    orders = pd.DataFrame(conn.execute(
        "SELECT order_id, customer_key FROM orders WHERE tenant_id = %(tenant_id)s AND customer_key IS NOT NULL",
        {"tenant_id": t.tenant_id}).fetchall(), columns=["order_id", "customer_key"])
    sales = sales.merge(orders, on="order_id", how="inner")
    cost = pd.DataFrame(conn.execute(
        "SELECT variant_id, unit_cost FROM products WHERE tenant_id = %(tenant_id)s", {"tenant_id": t.tenant_id}
    ).fetchall(), columns=["variant_id", "unit_cost"])
    cost["unit_cost"] = pd.to_numeric(cost["unit_cost"], errors="coerce")
    sales = sales.merge(cost, on="variant_id", how="left")
    known = sales["unit_cost"].notna()
    store_has_cost = bool(known.any())
    ratio = None
    if store_has_cost:
        kv = sales.loc[known, "line_value"].sum()
        if kv > 0:
            ratio = float((kv - (sales.loc[known, "qty"] * sales.loc[known, "unit_cost"]).sum()) / kv)
    sales["profit"] = sales["line_value"] - sales["qty"] * sales["unit_cost"]
    sales.loc[~known, "profit"] = sales.loc[~known, "line_value"] * ratio if ratio is not None else float("nan")
    sales["unknown"] = ~known

    f = fo.set_index("customer_key")["date"]
    sales["first"] = sales["customer_key"].map(f)
    sales = sales[sales["first"].notna()].copy()
    by_cust = {k: g for k, g in sales.groupby("customer_key")}

    def cust_stats(key, first, n, inclusive):
        """(profit, has a line without cost, has an uncomputable line) in [first, first + n months)."""
        g = by_cust.get(key)
        if g is None:
            return 0.0, False, False
        end = (pd.Timestamp(first) + pd.DateOffset(months=n)).date()
        w = g[(g["date"] >= first) & ((g["date"] <= end) if inclusive else (g["date"] < end))]
        if w.empty:
            return 0.0, False, False
        return float(w["profit"].sum(skipna=False)), bool(w["unknown"].any()), bool(w["profit"].isna().any())

    recs = []
    for r in fo.itertuples(index=False):
        recs.append((r.customer_key, r.order_id, r.date,
                     (pd.Timestamp(r.date) + pd.DateOffset(months=months)).date() <= as_of))
    mature = [x for x in recs if x[3]]
    # store ratio: 12m value / value at the same age, by whole months of age
    ratios: dict[int, float] = {}
    if mature:
        full = {k: cust_stats(k, d, months, False)[0] for k, _, d, _ in mature}
        for a in range(months):
            num = den = 0.0
            for k, _, d, _ in mature:
                v12 = full[k]
                va = cust_stats(k, d, a, True)[0]
                if pd.notna(v12) and pd.notna(va):
                    num += v12
                    den += va
            if den > 0 and num > 0:
                ratios[a] = num / den

    out = []
    for key, oid, d, is_mature in recs:
        if is_mature:
            val, unk, nan = cust_stats(key, d, months, False)
            young_unscaled = False
        else:
            age = (as_of.year - d.year) * 12 + as_of.month - d.month - (1 if as_of.day < d.day else 0)
            age = max(age, 0)
            val, unk, nan = cust_stats(key, d, age, True)
            if age in ratios:
                val, young_unscaled = val * ratios[age], False
            else:
                young_unscaled = True
        out.append((key, oid, None if (nan or pd.isna(val)) else val, unk, young_unscaled))
    return pd.DataFrame(out, columns=cols), store_has_cost


def customer_value(conn, t: Tenant, level: str, months: int = 12, as_of: date | None = None) -> pd.DataFrame:
    """Average gross profit over `months` after a customer's first order, per entity whose first orders credit it.

    Columns: entity_id, customers (sum of first order credits), value_12m, flags (list of strings).
    Customer gross profit = sum(line_value - qty * unit_cost) over their lines in the window (refunds are negative
    lines). Lines with no unit cost use the store's average gross margin ratio (flag `missing_cost`); with no
    cost anywhere the value is None. Entity value is the credit weighted average over first orders. Cohorts
    younger than `months` are scaled by the store's mature cohort ratio (value at `months` / value at the same
    age); with no usable ratio they stay unscaled and carry flag `young_unscaled`.
    """
    as_of = as_of or date.today()
    cv, store_has_cost = _customer_values(conn, t, months, as_of)
    cr = _credits(conn, t, level)
    cols = ["entity_id", "customers", "value_12m", "flags"]
    if cv.empty or cr.empty:
        return pd.DataFrame(columns=cols)
    df = cr.merge(cv, on="order_id", how="inner")
    rows = []
    for eid, g in df.groupby("entity_id"):
        flags = set()
        if g["missing_cost"].any() or not store_has_cost:
            flags.add("missing_cost")
        if g["young_unscaled"].any():
            flags.add("young_unscaled")
        ok = g[g["value"].notna()]
        value = float((ok["credit"] * ok["value"]).sum() / ok["credit"].sum()) if ok["credit"].sum() > 0 else None
        rows.append((eid, float(g["credit"].sum()), value, sorted(flags)))
    return pd.DataFrame(rows, columns=cols)
