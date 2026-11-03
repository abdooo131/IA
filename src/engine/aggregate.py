"""Panels per entity and period for the demand model.

A panel row holds, for one entity (current colour product, style, collection or the store) and one period
(day, ISO week starting Monday, or month): views, units, revenue, cost, price, reference price, spend,
impressions, adstock, size availability and calendar flags. Everything is keyed to current variants and
products through lineage before it is summed. Every query filters on the tenant.
"""
from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import date, timedelta

import numpy as np
import pandas as pd

from .lineage import current_variant, product_shares, rekey_products, rekeyed_sales, replaced_on
from .tenants import Tenant

log = logging.getLogger(__name__)

GRAINS = ("day", "week", "month")
LEVELS = ("product", "style", "collection", "store")
DECAY = {"day": 0.6, "week": 0.3, "month": 0.1}
FLAGS = ("payday", "white_friday_week", "ramadan", "eid_al_fitr", "eid_al_adha", "promo")
STORE_ENTITY = "__store__"
OTHER_PRODUCT = "__other__"      # sales/spend/views not tied to a known product (pool, deleted variants): store only
PIXEL_MIN_DAYS = 56              # 8 weeks of pixel data before pixel views replace landing sessions (per period)
REF_PRICE_DAYS = 180
FULL_AVAILABILITY = 0.8
PANEL_COLUMNS = ["entity_id", "period_start", "views", "views_estimated", "units", "revenue", "cost",
                 "missing_cost", "price", "ref_price", "spend", "impressions", "adstock", "size_availability",
                 "no_stock_data", *FLAGS, "n_days", "period_days", "views_days"]

# Calendar data (not store data): Gregorian first days as observed in Egypt; moon sighting may shift them a day.
# year: (first day of Ramadan, first day of Eid al Fitr, first day of Eid al Adha)
_ISLAMIC = {
    2022: (date(2022, 4, 2), date(2022, 5, 2), date(2022, 7, 9)),
    2023: (date(2023, 3, 23), date(2023, 4, 21), date(2023, 6, 28)),
    2024: (date(2024, 3, 11), date(2024, 4, 10), date(2024, 6, 16)),
    2025: (date(2025, 3, 1), date(2025, 3, 30), date(2025, 6, 6)),
    2026: (date(2026, 2, 18), date(2026, 3, 20), date(2026, 5, 27)),
    2027: (date(2027, 2, 8), date(2027, 3, 10), date(2027, 5, 16)),
    2028: (date(2028, 1, 28), date(2028, 2, 26), date(2028, 5, 5)),
}
EID_AL_FITR_DAYS = 3
EID_AL_ADHA_DAYS = 4


# ---------------------------------------------------------------- pure helpers

def adstock(spend, decay: float) -> np.ndarray:
    """Geometric carry over: x_t = s_t + decay * x_{t-1}. Missing spend counts as 0."""
    s = pd.to_numeric(pd.Series(list(spend), dtype=object), errors="coerce").fillna(0.0).to_numpy(float)
    out = np.empty_like(s)
    carry = 0.0
    for i, x in enumerate(s):
        carry = x + decay * carry
        out[i] = carry
    return out


def period_start(d: date, grain: str) -> date:
    if grain == "day":
        return d
    if grain == "week":
        return d - timedelta(days=d.weekday())
    if grain == "month":
        return d.replace(day=1)
    raise ValueError(f"unknown grain {grain!r}")


def _period_days(start: date, grain: str) -> int:
    """Calendar length of the period starting at `start`."""
    if grain == "day":
        return 1
    if grain == "week":
        return 7
    nxt = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return (nxt - start).days


def _last_friday_of_november(year: int) -> date:
    d = date(year, 11, 30)
    while d.weekday() != 4:
        d -= timedelta(days=1)
    return d


_warned_years: set[int] = set()


def _warn_islamic_range(start: date, end: date) -> None:
    """Log once per year when dates fall outside the hard coded Islamic calendar (Ramadan and Eid flags are 0)."""
    missing = [y for y in range(start.year, end.year + 1) if y not in _ISLAMIC and y not in _warned_years]
    if missing:
        _warned_years.update(missing)
        log.warning("no Islamic calendar dates for %s (covered %d to %d): Ramadan and Eid flags are 0; extend"
                    " aggregate._ISLAMIC", ", ".join(map(str, missing)), min(_ISLAMIC), max(_ISLAMIC))


def day_flags(start: date, end: date, promo_days=()) -> pd.DataFrame:
    """0/1 calendar flags per day (index: date, columns: FLAGS) for start..end inclusive."""
    idx = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    _warn_islamic_range(start, end)
    marked: dict[str, set[date]] = defaultdict(set)
    for y in range(start.year - 1, end.year + 2):
        wf = _last_friday_of_november(y)
        marked["white_friday_week"].update(wf - timedelta(days=k) for k in range(7))
        if y in _ISLAMIC:
            ramadan, fitr, adha = _ISLAMIC[y]
            marked["ramadan"].update(ramadan + timedelta(days=k) for k in range((fitr - ramadan).days))
            marked["eid_al_fitr"].update(fitr + timedelta(days=k) for k in range(EID_AL_FITR_DAYS))
            marked["eid_al_adha"].update(adha + timedelta(days=k) for k in range(EID_AL_ADHA_DAYS))
    marked["promo"] = set(promo_days)
    df = pd.DataFrame(0.0, index=pd.Index(idx, dtype=object), columns=list(FLAGS))
    for f in FLAGS:
        if f == "payday":
            df[f] = [1.0 if d.day >= 25 else 0.0 for d in idx]
        else:
            df[f] = [1.0 if d in marked[f] else 0.0 for d in idx]
    return df


def _mode_price(unit_prices: pd.Series) -> float:
    """Most common whole currency price; ties go to the higher (full) price."""
    if unit_prices.empty:
        return float("nan")
    counts = Counter(unit_prices.round().astype(float))
    top = max(counts.values())
    return max(p for p, c in counts.items() if c == top)


def _in_stock(stock: pd.DataFrame, variants: list[str], days: pd.DatetimeIndex) -> pd.DataFrame:
    """days x variants matrix of 1.0 (in stock) / 0.0.

    A day is in stock when available summed across locations is > 0; a missing day carries the last known
    level forward; days before a variant's first stock record (or a variant with none) count as in stock.
    """
    if not len(days) or not variants:
        return pd.DataFrame(index=days, columns=variants, dtype=float)
    s = stock[stock["variant_id"].isin(variants)]
    wide = s.pivot_table(index="date", columns="variant_id", values="available", aggfunc="sum")
    wide = wide.reindex(columns=variants)
    full = wide.reindex(wide.index.union(days)).sort_index().ffill().reindex(days)
    return (full > 0).astype(float).where(full.notna(), 1.0)


def _drop_replaced_stock(stock: pd.DataFrame, replaced: dict, cv) -> pd.DataFrame:
    """Stock rows (date, variant_id, ...) without the rows of replaced variants dated on or after their
    replacement date (I4); a replaced variant with no known date contributes no stock to its replacement."""
    if stock.empty or not replaced:
        return stock

    def cutoff(v):
        if v not in replaced or cv.get(v, v) == v:        # not replaced (or a lineage cycle): all rows
            return date.max
        return replaced[v] or date.min

    keep = [d < cutoff(v) for d, v in zip(stock["date"], stock["variant_id"])]
    return stock[keep].reset_index(drop=True)


# ---------------------------------------------------------------- tenant data (loaded once)

class TenantData:
    """Everything the panels need for one tenant, re-keyed to current variants and products."""

    def __init__(self, conn, t: Tenant):
        self.t = t
        p = {"tenant_id": t.tenant_id}
        q = lambda sql, cols: pd.DataFrame(conn.execute(sql, p).fetchall(), columns=cols)  # noqa: E731
        cv = current_variant(conn, t)

        prods = q("SELECT variant_id, product_id, handle, size, unit_cost FROM products"
                  " WHERE tenant_id = %(tenant_id)s ORDER BY variant_id",
                  ["variant_id", "product_id", "handle", "size", "unit_cost"])
        prods["size"] = prods["size"].fillna("").astype(str)
        prods["unit_cost"] = [float(x) if x is not None else np.nan for x in prods["unit_cost"]]
        prods["current"] = [cv.get(v, v) == v for v in prods["variant_id"]]   # False: replaced through lineage
        self.products = prods
        self.known = set(prods["product_id"])
        self.product_of = dict(zip(prods["variant_id"], prods["product_id"]))
        self.style_of = {r["product_id"]: r["style_id"] for r in conn.execute(
            "SELECT product_id, style_id FROM product_style WHERE tenant_id = %(tenant_id)s", p)}
        self.collections_of: dict[str, list[str]] = defaultdict(list)
        for r in conn.execute("SELECT product_id, collection_id FROM product_collection"
                              " WHERE tenant_id = %(tenant_id)s ORDER BY collection_id", p):
            self.collections_of[r["product_id"]].append(r["collection_id"])

        sales = rekeyed_sales(conn, t)
        sales = sales.merge(prods[["variant_id", "unit_cost"]], on="variant_id", how="left")
        sales["product_id"] = self._product_key(sales["product_id"])
        sales["date"] = pd.to_datetime(sales["date"])
        self.sales = sales

        stock = q("SELECT date, variant_id, SUM(available) AS available FROM stock_daily"
                  " WHERE tenant_id = %(tenant_id)s GROUP BY date, variant_id", ["date", "variant_id", "available"])
        stock = _drop_replaced_stock(stock, replaced_on(conn, t), cv)
        stock["variant_id"] = [cv.get(v, v) for v in stock["variant_id"]]
        stock["date"] = pd.to_datetime(stock["date"])
        stock["available"] = stock["available"].astype(float)
        self.stock = stock.groupby(["date", "variant_id"], as_index=False)["available"].sum()

        pix = q("SELECT date, product_id, SUM(views) AS views FROM funnel_daily WHERE tenant_id = %(tenant_id)s"
                " AND variant_id = '' GROUP BY date, product_id", ["date", "product_id", "views"])
        pix["date"] = pd.to_datetime(pix["date"])
        pix["views"] = pix["views"].astype(float)
        shares = product_shares(conn, t, cv)
        pix = rekey_products(pix, shares, ["views"])          # rolled up before the lineage was confirmed
        pix["product_id"] = self._product_key(pix["product_id"])
        self.pixel = pix
        sv = q("SELECT variant_id, SUM(size_views) AS size_views FROM funnel_daily WHERE tenant_id = %(tenant_id)s"
               " AND variant_id <> '' GROUP BY variant_id", ["variant_id", "size_views"])
        sv["variant_id"] = [cv.get(v, v) for v in sv["variant_id"]]
        self.size_views = sv.groupby("variant_id")["size_views"].sum().astype(float)

        land = q("SELECT date, handle, sessions FROM landing_sessions WHERE tenant_id = %(tenant_id)s",
                 ["date", "handle", "sessions"])
        land["date"] = pd.to_datetime(land["date"])
        land["sessions"] = land["sessions"].astype(float)
        handle_products: dict[str, set[str]] = defaultdict(set)
        for v, pid, h in prods[["variant_id", "product_id", "handle"]].itertuples(index=False):
            if h:
                handle_products[h.lower()].add(self.product_of.get(cv.get(v, v), pid))
        self.landing = self._landing_by_product(land, handle_products)
        self.landing_raw = land

        spend = q("SELECT date, product_id, SUM(spend) AS spend, SUM(impressions) AS impressions"
                  " FROM spend_by_product WHERE tenant_id = %(tenant_id)s GROUP BY date, product_id",
                  ["date", "product_id", "spend", "impressions"])
        spend["date"] = pd.to_datetime(spend["date"])
        spend[["spend", "impressions"]] = spend[["spend", "impressions"]].astype(float)
        spend = rekey_products(spend, shares, ["spend", "impressions"])   # I5: lineage after attribution
        spend["product_id"] = self._product_key(spend["product_id"])
        self.spend = spend

        self.promo_days = {r["date"] for r in conn.execute(
            "SELECT date FROM calendar WHERE tenant_id = %(tenant_id)s AND flags -> 'promo' = 'true'::jsonb", p)}
        self._views_source()
        self._daily: pd.DataFrame | None = None
        self._curves: dict[str, dict[str, float]] = {}
        self._panels: dict[tuple[str, str], pd.DataFrame] = {}

    # ------------------------------------------------------------ keys and sources

    def _product_key(self, s: pd.Series) -> pd.Series:
        return pd.Series([v if v in self.known else OTHER_PRODUCT for v in s], index=s.index, dtype=object)

    @staticmethod
    def _landing_by_product(land: pd.DataFrame, handle_products: dict[str, set[str]]) -> pd.DataFrame:
        rows = []
        for d, h, n in land[["date", "handle", "sessions"]].itertuples(index=False):
            pids = sorted(handle_products.get((h or "").lower(), ())) or [OTHER_PRODUCT]
            rows.extend((d, pid, n / len(pids)) for pid in pids)     # a split old handle: equal shares
        df = pd.DataFrame(rows, columns=["date", "product_id", "views"])
        return df.groupby(["date", "product_id"], as_index=False)["views"].sum()

    def _views_source(self) -> None:
        """Two views sources, stitched per period in panel(): pixel views and landing sessions / landing share.

        pixel_ready: the pixel has >= 8 weeks of days, so periods inside the pixel window use pixel views and
        earlier periods landing views. Before that, landing views wherever they exist (pixel only when the
        tenant has no landing data at all).
        """
        self.pixel_ready = self.pixel["date"].nunique() >= PIXEL_MIN_DAYS
        self.landing_share = 1.0
        pix_day = self.pixel.groupby("date")["views"].sum()
        land_day = self.landing_raw.groupby("date")["sessions"].sum()
        both = pix_day.index.intersection(land_day.index)
        if len(both) and pix_day[both].sum() > 0 and land_day[both].sum() > 0:
            self.landing_share = float(land_day[both].sum() / pix_day[both].sum())
        self.landing_views = self.landing.assign(views=self.landing["views"] / self.landing_share)
        self.views = pd.concat([self.pixel, self.landing_views]) if len(self.landing_views) else self.pixel
        win = lambda df: (df["date"].min(), df["date"].max()) if len(df) else None  # noqa: E731
        self.pixel_window, self.landing_window = win(self.pixel), win(self.landing_views)

    def date_range(self) -> pd.DatetimeIndex:
        dates = [df["date"] for df in (self.sales, self.spend, self.views) if len(df)]
        if not dates:
            return pd.DatetimeIndex([])
        all_dates = pd.concat(dates)
        return pd.date_range(all_dates.min(), all_dates.max(), freq="D")

    # ------------------------------------------------------------ size curve and availability

    def size_curve(self, style_id: str) -> dict[str, float]:
        """Share of demand per size for a style: in-stock sales rates blended with pixel size views."""
        if style_id in self._curves:
            return self._curves[style_id]
        pids = {p for p, s in self.style_of.items() if s == style_id}
        var = self.products[self.products["product_id"].isin(pids) & self.products["current"]]
        if var.empty:
            return {}
        size_of = dict(zip(var["variant_id"], var["size"]))
        sizes = sorted(set(size_of.values()))
        variants = list(size_of)
        sales = self.sales[self.sales["variant_id"].isin(variants)]
        stock = self.stock[self.stock["variant_id"].isin(variants)]
        seen = pd.concat([sales["date"], stock["date"]])
        rate, sales_n = dict.fromkeys(sizes, 0.0), 0.0
        if len(sales):
            days = pd.date_range(seen.min(), seen.max(), freq="D")
            ins = _in_stock(stock, variants, days)
            qty = sales.groupby(["date", "variant_id"])["qty"].sum()
            flag = np.array([ins.at[d, v] for d, v in qty.index])
            sold = (qty * flag).groupby(level="variant_id").sum()
            in_days = ins.sum()
            units, exposure = defaultdict(float), defaultdict(float)
            for v in variants:
                units[size_of[v]] += float(sold.get(v, 0.0))
                exposure[size_of[v]] += float(in_days[v])
            for s in sizes:
                rate[s] = max(units[s], 0.0) / exposure[s] if exposure[s] > 0 else 0.0
            sales_n = sum(max(units[s], 0.0) for s in sizes)
        views = defaultdict(float)
        for v in variants:
            views[size_of[v]] += float(self.size_views.get(v, 0.0))
        pixel_n = sum(views.values())
        tot_rate = sum(rate.values())
        w_s = sales_n if tot_rate > 0 else 0.0
        w_p = pixel_n
        if w_s + w_p <= 0:
            curve = {s: 1.0 / len(sizes) for s in sizes}
        else:
            curve = {s: (w_s * (rate[s] / tot_rate if tot_rate > 0 else 0.0)
                         + w_p * (views[s] / pixel_n if pixel_n > 0 else 0.0)) / (w_s + w_p) for s in sizes}
        self._curves[style_id] = curve
        return curve

    def _in_stock_matrix(self, days: pd.DatetimeIndex) -> pd.DataFrame:
        """days x every stocked variant in stock matrix (see _in_stock), built once from one pivot of all stock."""
        if not len(days) or self.stock.empty:
            return pd.DataFrame(index=days, dtype=float)
        wide = self.stock.pivot_table(index="date", columns="variant_id", values="available", aggfunc="sum")
        full = wide.reindex(wide.index.union(days)).sort_index().ffill().reindex(days)
        return (full > 0).astype(float).where(full.notna(), 1.0)

    def _availability(self, days: pd.DatetimeIndex) -> tuple[pd.DataFrame, dict[str, bool]]:
        """days x products size availability, and per product whether it has no stock data at all."""
        stocked = set(self.stock["variant_id"])
        matrix = self._in_stock_matrix(days)            # one pivot, then column lookups per product (I9)
        out, no_stock = {}, {}
        for pid, var in self.products.groupby("product_id"):
            var = var[var["current"]] if var["current"].any() else var
            variants = list(var["variant_id"])
            no_stock[pid] = not stocked.intersection(variants)
            if no_stock[pid]:
                out[pid] = np.ones(len(days))
                continue
            sizes = sorted(set(var["size"]))
            curve = self.size_curve(self.style_of[pid]) if pid in self.style_of else {}
            share = {s: curve.get(s, 0.0) for s in sizes}
            tot = sum(share.values())
            share = {s: v / tot for s, v in share.items()} if tot > 0 else {s: 1.0 / len(sizes) for s in sizes}
            ins = matrix.reindex(columns=variants).fillna(1.0)     # a variant with no stock rows: in stock
            avail = np.zeros(len(days))
            for s in sizes:
                cols = [v for v, z in zip(var["variant_id"], var["size"]) if z == s]
                avail += share[s] * ins[cols].max(axis=1).to_numpy()
            out[pid] = avail
        return pd.DataFrame(out, index=days), no_stock

    # ------------------------------------------------------------ daily product frame

    def daily(self) -> pd.DataFrame:
        """Dense (product_id, date) frame of daily inputs; OTHER_PRODUCT collects what has no product."""
        if self._daily is not None:
            return self._daily
        days = self.date_range()
        ents = sorted(self.known) + [OTHER_PRODUCT]
        idx = pd.MultiIndex.from_product([ents, days], names=["product_id", "date"])
        s = self.sales.assign(cost=self.sales["qty"] * self.sales["unit_cost"],
                              miss=self.sales["unit_cost"].isna())
        g = s.groupby(["product_id", "date"])
        d = pd.DataFrame(index=idx)
        d["units"] = g["qty"].sum().reindex(idx, fill_value=0).astype(float)
        d["revenue"] = g["line_value"].sum().reindex(idx, fill_value=0).astype(float)
        d["missing_cost"] = g["miss"].any().reindex(idx, fill_value=False).astype(bool)
        d["cost"] = g["cost"].sum().reindex(idx, fill_value=0).astype(float).where(~d["missing_cost"])
        sp = self.spend.groupby(["product_id", "date"])
        d["spend"] = sp["spend"].sum().reindex(idx, fill_value=0.0)
        d["impressions"] = sp["impressions"].sum().reindex(idx, fill_value=0.0)
        dts = idx.get_level_values("date")
        for col, src, window in (("views_pixel", self.pixel, self.pixel_window),
                                 ("views_landing", self.landing_views, self.landing_window)):
            v = src.groupby(["product_id", "date"])["views"].sum().reindex(idx, fill_value=0.0)
            if window is None:
                v[:] = np.nan
            else:
                v[(dts < window[0]) | (dts > window[1])] = np.nan     # outside the source's window: unknown
            d[col] = v
        avail, no_stock = self._availability(days)
        long = avail.rename_axis(index="date", columns="product_id").stack()
        d["size_availability"] = long.swaplevel().reindex(idx) if len(long) else np.nan   # OTHER_PRODUCT: NaN
        d["no_stock_data"] = [no_stock.get(p, True) for p in idx.get_level_values("product_id")]
        self._daily = d
        return d

    # ------------------------------------------------------------ entities

    def _style_collection(self) -> dict[str, str]:
        votes: dict[str, Counter] = defaultdict(Counter)
        for pid, cols in self.collections_of.items():
            if pid in self.style_of:
                votes[self.style_of[pid]].update(cols)
        return {s: min(c for c, n in cnt.items() if n == max(cnt.values())) for s, cnt in votes.items()}

    def entities_of(self, level: str) -> dict[str, list[str]]:
        """product_id -> entity ids at `level` (a product may sit in several collections)."""
        if level == "product":
            return {p: [p] for p in self.known}
        if level == "style":
            return {p: [s] for p, s in self.style_of.items() if p in self.known}
        if level == "collection":
            return {p: list(c) for p, c in self.collections_of.items() if p in self.known}
        if level == "store":
            return {p: [STORE_ENTITY] for p in [*self.known, OTHER_PRODUCT]}
        raise ValueError(f"unknown level {level!r}")

    def parent_of(self, level: str) -> dict[str, tuple[str, str]]:
        """entity -> (parent level, parent entity): product -> style -> collection (if any) -> store."""
        store = ("store", STORE_ENTITY)
        if level == "product":
            return {p: ("style", self.style_of[p]) if p in self.style_of else store for p in self.known}
        if level == "style":
            sc = self._style_collection()
            return {s: ("collection", sc[s]) if s in sc else store for s in set(self.style_of.values())}
        if level == "collection":
            return {c: store for cols in self.collections_of.values() for c in cols}
        return {}

    # ------------------------------------------------------------ panel

    def panel(self, grain: str, level: str) -> pd.DataFrame:
        """The (grain, level) panel; built once per TenantData, a copy is returned (callers may modify it)."""
        if grain not in GRAINS:
            raise ValueError(f"unknown grain {grain!r}")
        if (grain, level) not in self._panels:
            self._panels[(grain, level)] = self._build_panel(grain, level)
        return self._panels[(grain, level)].copy()

    def _build_panel(self, grain: str, level: str) -> pd.DataFrame:
        mapping = self.entities_of(level)
        daily = self.daily()
        if daily.empty or not mapping:
            return pd.DataFrame(columns=PANEL_COLUMNS)
        d = daily.reset_index()
        d["entity_id"] = d["product_id"].map(mapping)
        d = d.dropna(subset=["entity_id"]).explode("entity_id")
        if d.empty:
            return pd.DataFrame(columns=PANEL_COLUMNS)
        weight = d.groupby("product_id")["units"].sum().clip(lower=0) + 1e-9
        d["w"] = d["product_id"].map(weight).where(d["size_availability"].notna(), 0.0)
        d["wa"] = d["w"] * d["size_availability"].fillna(0.0)
        e = d.groupby(["entity_id", "date"]).agg(
            units=("units", "sum"), revenue=("revenue", "sum"), cost=("cost", "sum"),
            missing_cost=("missing_cost", "any"), spend=("spend", "sum"), impressions=("impressions", "sum"),
            views_pixel=("views_pixel", lambda x: x.sum(min_count=1)),
            views_landing=("views_landing", lambda x: x.sum(min_count=1)), wa=("wa", "sum"), w=("w", "sum"),
            no_stock_data=("no_stock_data", "all"))
        e["size_availability"] = np.where(e["w"] > 0, e["wa"] / e["w"].where(e["w"] > 0, 1.0), 1.0)
        e = e.reset_index()
        active = ((e["units"] != 0) | (e["spend"] > 0) | (e["views_pixel"].fillna(0) > 0)
                  | (e["views_landing"].fillna(0) > 0))
        first = e[active].groupby("entity_id")["date"].min()
        e = e[e["entity_id"].isin(first.index)]
        e = e[e["date"] >= e["entity_id"].map(first)]
        if e.empty:
            return pd.DataFrame(columns=PANEL_COLUMNS)

        days = self.date_range()
        e["period_start"] = [period_start(x.date(), grain) for x in e["date"]]
        e["n_days"] = 1
        agg = {"units": "sum", "revenue": "sum", "cost": "sum", "missing_cost": "any", "spend": "sum",
               "impressions": "sum", "size_availability": "mean", "no_stock_data": "all", "n_days": "sum",
               "views_pixel": lambda x: x.sum(min_count=1), "views_landing": lambda x: x.sum(min_count=1),
               "pixel_days": "sum", "landing_days": "sum"}
        e["pixel_days"] = e["views_pixel"].notna().astype(int)
        e["landing_days"] = e["views_landing"].notna().astype(int)
        out = e.groupby(["entity_id", "period_start"]).agg(agg).reset_index()
        out = self._stitch_views(out)
        out["period_days"] = [_period_days(p, grain) for p in out["period_start"]]
        out = out.join(self._period_flags(days[0].date(), days[-1].date(), grain), on="period_start")
        out["cost"] = out["cost"].where(~out["missing_cost"])

        ref = self._ref_prices(mapping, days[-1])
        out["ref_price"] = out["entity_id"].map(ref).astype(float)
        unit_price = (out["revenue"] / out["units"]).where((out["units"] > 0) & (out["revenue"] > 0))
        out["price"] = unit_price.groupby(out["entity_id"]).transform(lambda x: x.ffill().bfill())
        out["price"] = out["price"].fillna(out["ref_price"])
        out = out.sort_values(["entity_id", "period_start"]).reset_index(drop=True)
        out["adstock"] = out.groupby("entity_id")["spend"].transform(
            lambda x: pd.Series(adstock(x, DECAY[grain]), index=x.index))
        return out[PANEL_COLUMNS]

    def _stitch_views(self, out: pd.DataFrame) -> pd.DataFrame:
        """Choose one views source per period: pixel inside its window once pixel_ready, landing before."""
        has_p, has_l = out["views_pixel"].notna(), out["views_landing"].notna()
        if self.pixel_ready:
            in_pixel = pd.Series([p >= self.pixel_window[0].date() for p in out["period_start"]], index=out.index)
            use_p = has_p & (in_pixel | ~has_l)
        elif self.landing_window is None:
            use_p = has_p
        else:
            use_p = pd.Series(False, index=out.index)
        use_l = ~use_p & has_l
        out["views"] = np.where(use_p, out["views_pixel"], np.where(use_l, out["views_landing"], np.nan))
        out["views_days"] = np.where(use_p, out["pixel_days"], np.where(use_l, out["landing_days"], 0))
        out["views_estimated"] = use_l
        return out

    def _period_flags(self, first: date, last: date, grain: str) -> pd.DataFrame:
        """Fraction of the calendar days of each period that carry each flag (whole periods, not just data days)."""
        end = last
        while period_start(end + timedelta(days=1), grain) == period_start(last, grain):
            end += timedelta(days=1)
        f = day_flags(period_start(first, grain), end, self.promo_days)
        return f.groupby([period_start(d, grain) for d in f.index]).mean()

    def _ref_prices(self, mapping: dict[str, list[str]], last: pd.Timestamp) -> dict[str, float]:
        """Most common full price per entity: mode of whole-unit line prices in the 180 days to the last date."""
        s = self.sales[(self.sales["qty"] > 0) & (self.sales["line_value"] > 0)].copy()
        s["unit"] = s["line_value"] / s["qty"]
        s["entity_id"] = s["product_id"].map(mapping)
        s = s.dropna(subset=["entity_id"]).explode("entity_id")
        recent = s[s["date"] > last - pd.Timedelta(days=REF_PRICE_DAYS)]
        out = {}
        for ent, g in s.groupby("entity_id"):
            r = recent[recent["entity_id"] == ent]
            out[ent] = _mode_price((r if len(r) else g)["unit"])
        return out


# ---------------------------------------------------------------- public API

def build_panel(conn, t: Tenant, grain: str, level: str) -> pd.DataFrame:
    """One row per entity and period, from the entity's first activity to the tenant's last data date.

    Columns: PANEL_COLUMNS. views come per period from the pixel inside its window once it has 8 weeks of
    days, else from landing sessions / landing_share (views_estimated); NaN when no source covers the period.
    n_days = data days, period_days = calendar days, views_days = days the chosen views source covers; cost is NaN (missing_cost)
    when any sold variant lacks a unit cost; size_availability is 1.0 with no_stock_data when the products
    have no stock records; flags are the fraction of days in the period carrying the flag.
    """
    return TenantData(conn, t).panel(grain, level)


def size_curve(conn, t: Tenant, style_id: str) -> dict[str, float]:
    """size -> share of the style's demand ({} for a style with no variants in this tenant)."""
    return TenantData(conn, t).size_curve(style_id)
