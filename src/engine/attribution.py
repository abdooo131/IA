"""Attribute Meta spend, impressions and purchases to current colour products; credit orders to products.

Spend priority per ad and day: catalog breakdown, ad name (PRODUCT_FORMAT_ANGLE), manual map, shared pool
(split by revenue share). Impressions and Meta purchases always follow the same split as spend.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, timedelta
from typing import Iterable

import pandas as pd

from .lineage import current_variant, product_shares, rekeyed_sales
from .tenants import Tenant

log = logging.getLogger(__name__)

POOL_PRODUCT = "__pool__"
UNKNOWN_PRODUCT = "__unknown__"
TRAILING_DAYS = 28
_COLS = ["product_id", "method", "spend", "impressions", "meta_purchases"]
_F = ("spend", "impressions", "purchases")


# ---------------------------------------------------------------- pure helpers

def parse_ad_name(name: str | None, known_handles: Iterable[str]) -> str | None:
    """PRODUCT_FORMAT_ANGLE -> the Shopify handle in PRODUCT (case insensitive), or None."""
    if not name:
        return None
    first = str(name).split("_", 1)[0].strip().lower()
    if not first:
        return None
    for h in known_handles:
        if h and h.lower() == first:
            return h
    return None


def order_credit(order_lines: pd.DataFrame, ad_product: str | None) -> dict[str, float]:
    """Credit per product for one order (columns product_id, line_value). Credits sum to 1.

    The ad's product gets 1.0 when it is in the order; otherwise line value / order value
    (equal split for a zero value order).
    """
    if order_lines is None or len(order_lines) == 0:
        return {}
    value = order_lines.groupby("product_id")["line_value"].sum().astype(float).clip(lower=0)
    if ad_product is not None and ad_product in value.index:
        return {p: (1.0 if p == ad_product else 0.0) for p in value.index}
    total = float(value.sum())
    if total <= 0:
        return {p: 1.0 / len(value) for p in value.index}
    return {p: float(v) / total for p, v in value.items()}


def _normalise(shares: dict[str, float]) -> dict[str, float]:
    pos = {k: float(v) for k, v in shares.items() if float(v) > 0}
    tot = sum(pos.values())
    if tot > 0:
        return {k: v / tot for k, v in pos.items()}
    return {k: 1.0 / len(shares) for k in shares} if shares else {}


# ---------------------------------------------------------------- context (loaded once per run)

class _Ctx:
    def __init__(self, conn, t: Tenant):
        self.conn, self.t = conn, t
        p = {"tenant_id": t.tenant_id}
        self.cv = current_variant(conn, t)
        self.var_product: dict[str, str] = {}
        by_handle: dict[str, tuple[str, set[str]]] = {}
        for r in conn.execute("SELECT variant_id, product_id, handle FROM products"
                              " WHERE tenant_id = %(tenant_id)s", p):
            self.var_product[r["variant_id"]] = r["product_id"]
            if r["handle"]:
                by_handle.setdefault(r["handle"].lower(), (r["handle"], set()))[1].add(r["variant_id"])
        self.handles = {h: v for h, v in by_handle.values()}  # handle -> variant ids

        sales = rekeyed_sales(conn, t)
        sales = sales[sales["product_id"].notna()]
        self.rev: dict[date, dict[str, float]] = defaultdict(dict)
        if len(sales):
            for (d, pid), v in sales.groupby(["date", "product_id"])["line_value"].sum().items():
                self.rev[d][pid] = float(v)

        self.shares = product_shares(conn, t, self.cv)     # a manual map naming an old product follows lineage
        self.manual_raw: dict[str, dict[str, float]] = defaultdict(dict)
        for r in conn.execute("SELECT ad_id, product_id, share FROM ad_product_map"
                              " WHERE tenant_id = %(tenant_id)s", p):
            self.manual_raw[r["ad_id"]][r["product_id"]] = float(r["share"])

        self.ad_names: dict[str, str | None] = {}
        for r in conn.execute("SELECT DISTINCT ON (ad_id) ad_id, ad_name FROM ad_spend_daily"
                              " WHERE tenant_id = %(tenant_id)s AND ad_name IS NOT NULL"
                              " ORDER BY ad_id, date DESC", p):
            self.ad_names[r["ad_id"]] = r["ad_name"]
        self.catalog_ads = {r["ad_id"] for r in conn.execute(
            "SELECT DISTINCT ad_id FROM catalog_spend_daily WHERE tenant_id = %(tenant_id)s", p)}

    def manual(self, ad_id: str, day: date) -> dict[str, float]:
        """The ad's manual map on `day`, re-keyed to current products (split by the row date, see ProductShares)."""
        raw = self.manual_raw.get(ad_id)
        if not raw:
            return {}
        out: dict[str, float] = defaultdict(float)
        for pid, share in raw.items():
            for cur, w in self.shares.on(pid, day).items():
                out[cur] += share * w
        return _normalise(dict(out))

    def product_of_catalog(self, catalog_id: str) -> str | None:
        v = self.cv.get(catalog_id)
        return self.var_product.get(v) if v is not None else None

    def handle_products(self, handle: str) -> list[str]:
        """Current products behind a handle (several when an old multi colour product was split)."""
        out = {self.var_product[self.cv.get(v, v)] for v in self.handles.get(handle, ())
               if self.cv.get(v, v) in self.var_product}
        return sorted(out)

    def name_weights(self, handle: str, day: date) -> dict[str, float]:
        prods = self.handle_products(handle)
        if len(prods) <= 1:
            return {p: 1.0 for p in prods}
        rev = {p: self.rev.get(day, {}).get(p, 0.0) for p in prods}
        return _normalise(rev) if sum(rev.values()) > 0 else {p: 1.0 / len(prods) for p in prods}

    def pool_weights(self, day: date) -> dict[str, float]:
        rev = dict(self.rev.get(day, {}))
        if sum(rev.values()) <= 0:
            rev = defaultdict(float)
            for i in range(1, TRAILING_DAYS + 1):
                for p, v in self.rev.get(day - timedelta(days=i), {}).items():
                    rev[p] += v
        return _normalise(dict(rev)) if sum(rev.values()) > 0 else {}

    def ad_name_weights(self, ad_id: str, name: str | None, day: date) -> tuple[dict[str, float], str | None]:
        h = parse_ad_name(name, self.handles)
        if h:
            w = self.name_weights(h, day)
            if w:
                return w, "name"
        m = self.manual(ad_id, day)
        if m:
            return m, "manual"
        return {}, None


# ---------------------------------------------------------------- daily attribution

def _attribute(ctx: _Ctx, day: date) -> tuple[pd.DataFrame, list[dict]]:
    p = {"tenant_id": ctx.t.tenant_id, "day": day}
    ads = {(r["account_id"], r["ad_id"]): r for r in ctx.conn.execute(
        "SELECT account_id, ad_id, ad_name, spend, impressions, purchases FROM ad_spend_daily"
        " WHERE tenant_id = %(tenant_id)s AND date = %(day)s", p)}
    cats: dict[tuple, list[dict]] = defaultdict(list)
    for r in ctx.conn.execute(
            "SELECT account_id, ad_id, catalog_product_id, spend, impressions, purchases FROM catalog_spend_daily"
            " WHERE tenant_id = %(tenant_id)s AND date = %(day)s", p):
        cats[(r["account_id"], r["ad_id"])].append(r)

    parts: list[tuple[str, str, float, float, float]] = []
    pool = [0.0, 0.0, 0.0]
    unmapped: list[dict] = []

    def to_pool(vals, acct, ad, name, cat_id, reason):
        for i in range(3):
            pool[i] += vals[i]
        if any(vals):
            unmapped.append({"date": day, "account_id": acct, "ad_id": ad, "ad_name": name,
                             "catalog_product_id": cat_id, "spend": vals[0], "impressions": vals[1],
                             "purchases": vals[2], "reason": reason})

    for key in sorted(set(ads) | set(cats)):
        acct, ad = key
        row = ads.get(key)
        name = row["ad_name"] if row else None
        name = name or ctx.ad_names.get(ad)
        total = [float(row[f]) for f in _F] if row else [0.0, 0.0, 0.0]
        resid = list(total)
        if key in cats:
            csum = [0.0, 0.0, 0.0]
            for c in cats[key]:
                vals = [float(c[f]) for f in _F]
                for i in range(3):
                    csum[i] += vals[i]
                pid = ctx.product_of_catalog(c["catalog_product_id"])
                if pid is None:
                    to_pool(vals, acct, ad, name, c["catalog_product_id"], "unknown_catalog_id")
                else:
                    parts.append((pid, "catalog", *vals))
            resid = [max(total[i] - csum[i], 0.0) for i in range(3)]
        if not any(resid):
            continue
        weights, method = ctx.ad_name_weights(ad, name, day)
        if method:
            for pid, w in weights.items():
                parts.append((pid, method, *(resid[i] * w for i in range(3))))
        else:
            to_pool(resid, acct, ad, name, None, "no_mapping")

    if any(pool):
        weights = ctx.pool_weights(day) or {POOL_PRODUCT: 1.0}
        for pid, w in weights.items():
            parts.append((pid, "pool", *(pool[i] * w for i in range(3))))

    if not parts:
        return pd.DataFrame(columns=_COLS), unmapped
    df = pd.DataFrame(parts, columns=["product_id", "method", "spend", "impressions", "meta_purchases"])
    df = df.groupby(["product_id", "method"], as_index=False).sum()
    return df[_COLS].sort_values(["product_id", "method"]).reset_index(drop=True), unmapped


def attribute_day(conn, t: Tenant, day: date) -> pd.DataFrame:
    """Spend, impressions and Meta purchases of one day by current product and method (catalog|name|manual|pool).

    Conservation: totals equal the ad level totals, unless catalog rows exceed their ad's total (then the
    catalog rows win and the day total is higher). Catalog rows with no ad level row are kept as is.
    """
    return _attribute(_Ctx(conn, t), day)[0]


# ---------------------------------------------------------------- order credit

def _order_ad_product(ctx: _Ctx, ad_id: str | None, order_products: set[str], day: date) -> str | None:
    """The one product an order's ad promotes, if any. Catalog ads promote many, so give none."""
    if not ad_id or ad_id in ctx.catalog_ads:
        return None
    h = parse_ad_name(ctx.ad_names.get(ad_id), ctx.handles)
    cands = set(ctx.handle_products(h)) if h else set()
    m = ctx.manual(ad_id, day) if not cands else {}
    if m:
        cands = set(m) if len(m) == 1 else set()
    if not cands:
        return None
    hit = cands & order_products
    if len(hit) == 1:
        return next(iter(hit))
    return next(iter(cands)) if len(cands) == 1 else None


def run_attribution(conn, t: Tenant, since: date, until: date) -> None:
    """Recompute spend_by_product, unmapped_spend_log (per day) and order_credits (per order) for since..until.

    Idempotent: deletes the tenant's rows in the range, then inserts. Commits.
    """
    ctx = _Ctx(conn, t)
    p = {"tenant_id": t.tenant_id, "since": since, "until": until}
    for tbl in ("spend_by_product", "unmapped_spend_log", "order_credits"):
        conn.execute(f"DELETE FROM {tbl} WHERE tenant_id = %(tenant_id)s AND date BETWEEN %(since)s AND %(until)s", p)

    spend_rows, unmapped_rows, credit_rows = [], [], []
    day = since
    while day <= until:
        df, unmapped = _attribute(ctx, day)
        spend_rows.extend((t.tenant_id, day, r.product_id, r.method, float(r.spend), float(r.impressions),
                           float(r.meta_purchases)) for r in df.itertuples(index=False))
        unmapped_rows.extend((t.tenant_id, u["date"], u["account_id"], u["ad_id"], u["ad_name"],
                              u["catalog_product_id"], u["spend"], u["impressions"], u["purchases"], u["reason"])
                             for u in unmapped)
        if unmapped:
            log.warning("tenant %s %s: %.2f spend unmapped (%d rows) goes to the pool", t.tenant_id, day,
                        sum(u["spend"] for u in unmapped), len(unmapped))
        day += timedelta(days=1)

    orders = conn.execute(
        "SELECT order_id, date, utm_content FROM orders WHERE tenant_id = %(tenant_id)s"
        " AND date BETWEEN %(since)s AND %(until)s", p).fetchall()
    if orders:
        sales = rekeyed_sales(conn, t)
        sales = sales[sales["order_id"].isin([o["order_id"] for o in orders])].copy()
        sales["product_id"] = sales["product_id"].fillna(UNKNOWN_PRODUCT)
        lines = dict(tuple(sales.groupby("order_id"))) if len(sales) else {}
        for o in orders:
            ol = lines.get(o["order_id"])
            if ol is None:
                continue
            ad_prod = _order_ad_product(ctx, o["utm_content"], set(ol["product_id"]), o["date"])
            credit_rows.extend((t.tenant_id, o["order_id"], pid, c, ad_prod, o["date"])
                               for pid, c in order_credit(ol, ad_prod).items())
    with conn.cursor() as cur:                       # batched inserts (I9)
        cur.executemany("INSERT INTO spend_by_product (tenant_id, date, product_id, method, spend, impressions,"
                        " meta_purchases) VALUES (%s,%s,%s,%s,%s,%s,%s)", spend_rows)
        cur.executemany("INSERT INTO unmapped_spend_log (tenant_id, date, account_id, ad_id, ad_name,"
                        " catalog_product_id, spend, impressions, purchases, reason)"
                        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", unmapped_rows)
        cur.executemany("INSERT INTO order_credits (tenant_id, order_id, product_id, credit, ad_product_id, date)"
                        " VALUES (%s,%s,%s,%s,%s,%s)", credit_rows)
    conn.commit()
