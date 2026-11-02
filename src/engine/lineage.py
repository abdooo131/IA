"""Product lineage: match old variants to their per-colour replacements, group styles, re-key history."""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from zoneinfo import ZoneInfo

import pandas as pd

from .tenants import Tenant

VARIANT_GID = "gid://shopify/ProductVariant/"
_CATALOG_RE = re.compile(r"^shopify_[A-Za-z]{2}_(\d+)_(\d+)$")


# ---------------------------------------------------------------- text helpers

def normalise_title(title: str, colour_words: set[str]) -> str:
    """Lower case, drop colour words (whole words), drop punctuation, collapse spaces."""
    s = (title or "").lower()
    for w in sorted({c.strip().lower() for c in colour_words if c and c.strip()}, key=len, reverse=True):
        s = re.sub(r"(?<!\w)" + re.escape(w) + r"(?!\w)", " ", s)
    s = re.sub(r"[\W_]+", " ", s)
    return " ".join(s.split())


def _norm(v: str | None) -> str:
    return " ".join((v or "").lower().split())


def _slug(s: str) -> str:
    return re.sub(r"[\W_]+", "-", (s or "").lower()).strip("-")


def catalog_to_variant(catalog_id: str) -> str | None:
    """Meta catalog retailer id (`shopify_EG_<productId>_<variantId>` or a bare variant id) -> variant GID.

    Pure parser; returns None when the text is neither form. A GID is returned unchanged.
    """
    s = str(catalog_id or "").strip()
    if s.startswith(VARIANT_GID) and s[len(VARIANT_GID):].isdigit():
        return s
    m = _CATALOG_RE.match(s)
    if m:
        return VARIANT_GID + m.group(2)
    if s.isdigit():
        return VARIANT_GID + s
    return None


# ---------------------------------------------------------------- data access

def _products(conn, t: Tenant) -> list[dict]:
    return conn.execute(
        "SELECT variant_id, product_id, handle, title, colour, size, sku, status, created_at"
        " FROM products WHERE tenant_id = %(tenant_id)s ORDER BY variant_id",
        {"tenant_id": t.tenant_id}).fetchall()


def _colour_words(rows: list[dict]) -> set[str]:
    return {_norm(r["colour"]) for r in rows if r["colour"] and _norm(r["colour"])}


def _local_date(ts, tz: str) -> date | None:
    return ts.astimezone(ZoneInfo(tz)).date() if ts else None


def _product_info(rows: list[dict]) -> dict[str, dict]:
    info: dict[str, dict] = {}
    for r in rows:
        p = info.setdefault(r["product_id"], {"status": r["status"], "title": r["title"], "handle": r["handle"],
                                              "created_at": r["created_at"], "colours": set()})
        if r["colour"] and _norm(r["colour"]):
            p["colours"].add(_norm(r["colour"]))
    return info


# ---------------------------------------------------------------- matching

def propose_matches(conn, t: Tenant) -> pd.DataFrame:
    """Match old variants to new ones, store the pairs in variant_lineage and return them.

    Old: product status not ACTIVE, or more than one distinct colour. New candidates: variants of ACTIVE
    single colour products created later than the old product. Order: identical SKU, then normalised base
    title + colour (or colour in the new handle) + size. Exactly one candidate auto confirms; several are
    stored unconfirmed for review. Already confirmed old variants are left alone.
    """
    rows = _products(conn, t)
    info = _product_info(rows)
    words = _colour_words(rows)
    base = {pid: normalise_title(p["title"], words) for pid, p in info.items()}

    def is_old(pid):
        p = info[pid]
        return p["status"] != "ACTIVE" or len(p["colours"]) > 1

    def is_new(pid):
        p = info[pid]
        return p["status"] == "ACTIVE" and len(p["colours"]) == 1

    new_rows = [r for r in rows if is_new(r["product_id"])]
    by_sku = defaultdict(list)
    by_title_size = defaultdict(list)
    for r in new_rows:
        if r["sku"] and r["sku"].strip():
            by_sku[r["sku"].strip().lower()].append(r)
        by_title_size[(base[r["product_id"]], _norm(r["size"]))].append(r)

    confirmed_old = {r["old_variant_id"] for r in conn.execute(
        "SELECT old_variant_id FROM variant_lineage WHERE tenant_id = %(tenant_id)s AND confirmed",
        {"tenant_id": t.tenant_id})}

    found: list[tuple[dict, list[dict], str]] = []
    for o in rows:
        pid = o["product_id"]
        if not is_old(pid) or o["variant_id"] in confirmed_old:
            continue
        ocreated = info[pid]["created_at"]

        def later(c):
            created = info[c["product_id"]]["created_at"]
            return (ocreated is not None and created is not None and created > ocreated
                    and c["product_id"] != pid)

        method = "sku"
        cands = [c for c in by_sku.get((o["sku"] or "").strip().lower(), []) if later(c)] if o["sku"] else []
        if not cands:
            method = "title"
            ocol = _norm(o["colour"])
            cands = []
            for c in by_title_size.get((base[pid], _norm(o["size"])), []):
                if not later(c):
                    continue
                handle = _slug(info[c["product_id"]]["handle"] or "")
                if ocol and (_norm(c["colour"]) == ocol or f"-{_slug(ocol)}-" in f"-{handle}-"):
                    cands.append(c)
        if cands:
            found.append((o, cands, method))

    conn.execute(
        "DELETE FROM variant_lineage WHERE tenant_id = %(tenant_id)s AND NOT confirmed AND method <> 'manual'",
        {"tenant_id": t.tenant_id})
    out = []
    for o, cands, method in found:
        n = len(cands)
        for c in cands:
            eff = _local_date(info[c["product_id"]]["created_at"], t.timezone)
            conn.execute(
                "INSERT INTO variant_lineage (tenant_id, old_variant_id, new_variant_id, effective_date,"
                " method, confirmed, candidates) VALUES (%s,%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (tenant_id, old_variant_id, new_variant_id) DO NOTHING",
                (t.tenant_id, o["variant_id"], c["variant_id"], eff, method, n == 1, n))
            out.append({"old_variant_id": o["variant_id"], "new_variant_id": c["variant_id"], "method": method,
                        "candidates": n, "confirmed": n == 1, "effective_date": eff})
    conn.commit()
    return pd.DataFrame(out, columns=["old_variant_id", "new_variant_id", "method", "candidates",
                                      "confirmed", "effective_date"])


def confirm(conn, t: Tenant, old_variant_id: str, new_variant_id: str) -> None:
    """Confirm a proposed pair, or record a manual one. Other unconfirmed candidates of the old variant are dropped."""
    if old_variant_id == new_variant_id:
        raise ValueError("a variant cannot replace itself")
    rows = {r["variant_id"]: r for r in _products(conn, t)}
    if old_variant_id not in rows or new_variant_id not in rows:
        raise ValueError("unknown variant for this tenant")
    p = {"tenant_id": t.tenant_id, "old": old_variant_id, "new": new_variant_id}
    hit = conn.execute(
        "UPDATE variant_lineage SET confirmed = TRUE, candidates = 1 WHERE tenant_id = %(tenant_id)s"
        " AND old_variant_id = %(old)s AND new_variant_id = %(new)s", p).rowcount
    if not hit:
        eff = _local_date(rows[new_variant_id]["created_at"], t.timezone)
        conn.execute(
            "INSERT INTO variant_lineage (tenant_id, old_variant_id, new_variant_id, effective_date, method,"
            " confirmed, candidates) VALUES (%(tenant_id)s, %(old)s, %(new)s, %(eff)s, 'manual', TRUE, 1)",
            {**p, "eff": eff})
    conn.execute(
        "DELETE FROM variant_lineage WHERE tenant_id = %(tenant_id)s AND old_variant_id = %(old)s"
        " AND new_variant_id <> %(new)s AND NOT confirmed", p)
    conn.commit()


# ---------------------------------------------------------------- styles

def build_styles(conn, t: Tenant) -> int:
    """One style per normalised base title (products linked by confirmed lineage are merged).

    Writes styles and product_style (colour NULL for multi colour products). Style ids are
    deterministic (`<tenant_id>-<slug of base title>`), so reruns are idempotent. Returns styles written.
    """
    rows = _products(conn, t)
    info = _product_info(rows)
    words = _colour_words(rows)
    parent = {pid: pid for pid in info}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        parent[find(a)] = find(b)

    first_by_title: dict[str, str] = {}
    base = {}
    for pid, p in info.items():
        base[pid] = normalise_title(p["title"], words) or _norm(p["title"]) or pid
        union(pid, first_by_title.setdefault(base[pid], pid))
    pid_of = {r["variant_id"]: r["product_id"] for r in rows}
    for r in conn.execute(
            "SELECT old_variant_id, new_variant_id FROM variant_lineage"
            " WHERE tenant_id = %(tenant_id)s AND confirmed", {"tenant_id": t.tenant_id}):
        if r["old_variant_id"] in pid_of and r["new_variant_id"] in pid_of:
            union(pid_of[r["old_variant_id"]], pid_of[r["new_variant_id"]])

    groups = defaultdict(list)
    for pid in info:
        groups[find(pid)].append(pid)
    styles, links = {}, []
    for members in groups.values():
        name = min(base[m] for m in members)
        sid = f"{t.tenant_id}-{_slug(name) or 'style'}"
        styles[sid] = name
        for m in members:
            cols = sorted(info[m]["colours"])
            colour = None
            if len(cols) == 1:
                colour = next(r["colour"].strip() for r in rows if r["product_id"] == m and r["colour"])
            links.append((t.tenant_id, m, sid, colour))

    p = {"tenant_id": t.tenant_id}
    conn.execute("DELETE FROM product_style WHERE tenant_id = %(tenant_id)s", p)
    for sid, name in styles.items():
        conn.execute(
            "INSERT INTO styles (tenant_id, style_id, name) VALUES (%s,%s,%s)"
            " ON CONFLICT (tenant_id, style_id) DO UPDATE SET name = EXCLUDED.name", (t.tenant_id, sid, name))
    for link in links:
        conn.execute("INSERT INTO product_style (tenant_id, product_id, style_id, colour) VALUES (%s,%s,%s,%s)",
                     link)
    conn.execute("DELETE FROM styles WHERE tenant_id = %(tenant_id)s AND NOT (style_id = ANY(%(keep)s))",
                 {**p, "keep": list(styles)})
    conn.commit()
    return len(styles)


# ---------------------------------------------------------------- re-keying

class VariantMap(dict):
    """variant id -> current variant id, which also resolves Meta catalog ids of known variants on lookup."""

    def __init__(self, data, numeric: dict[str, str]):
        super().__init__(data)
        self._numeric = numeric  # numeric variant id -> stored variant id

    def _resolve(self, key):
        gid = catalog_to_variant(key) if isinstance(key, str) else None
        if gid is None:
            return None
        stored = self._numeric.get(gid[len(VARIANT_GID):])
        return dict.get(self, stored) if stored is not None else None

    def __missing__(self, key):
        v = self._resolve(key)
        if v is None:
            raise KeyError(key)
        return v

    def get(self, key, default=None):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        v = self._resolve(key)
        return default if v is None else v

    def __contains__(self, key):
        return dict.__contains__(self, key) or self._resolve(key) is not None


def _tail(variant_id: str) -> str:
    return variant_id.rsplit("/", 1)[-1]


def current_variant(conn, t: Tenant) -> dict[str, str]:
    """Any historical variant id or Meta catalog id -> current variant id.

    Only confirmed lineage re-keys; chains are followed (A->B->C gives C); ids in a cycle are left as is.
    Every known variant maps to itself when it was not replaced. Catalog ids (`shopify_EG_<product>_<variant>`
    or the bare variant id) of known variants resolve through the same mapping.
    """
    known = [r["variant_id"] for r in _products(conn, t)]
    nxt: dict[str, tuple] = {}
    for r in conn.execute(
            "SELECT old_variant_id, new_variant_id, effective_date FROM variant_lineage"
            " WHERE tenant_id = %(tenant_id)s AND confirmed", {"tenant_id": t.tenant_id}):
        key = (r["effective_date"] or date.min, r["new_variant_id"])
        if r["old_variant_id"] not in nxt or key > nxt[r["old_variant_id"]]:
            nxt[r["old_variant_id"]] = key
    step = {o: k[1] for o, k in nxt.items()}

    mapping: dict[str, str] = {}
    for v in set(known) | set(step) | set(step.values()):
        seen, cur = {v}, v
        while cur in step:
            cur = step[cur]
            if cur in seen:
                cur = v  # cycle: keep own history
                break
            seen.add(cur)
        mapping[v] = cur
    numeric = {_tail(v): v for v in known}
    data = dict(mapping)
    for tail, v in numeric.items():
        data.setdefault(tail, mapping[v])
    return VariantMap(data, numeric)


def rekeyed_sales(conn, t: Tenant) -> pd.DataFrame:
    """Sales lines keyed to the current variant.

    Columns: date, order_id, variant_id (current), product_id (current), style_id, colour, size, qty, line_value.
    Lines for variants unknown to products keep their variant id with empty product fields.
    """
    p = {"tenant_id": t.tenant_id}
    sales = pd.DataFrame(conn.execute(
        "SELECT date, order_id, variant_id, qty, line_value FROM sales_lines WHERE tenant_id = %(tenant_id)s"
        " ORDER BY date, order_id, variant_id", p).fetchall(),
        columns=["date", "order_id", "variant_id", "qty", "line_value"])
    cols = ["date", "order_id", "variant_id", "product_id", "style_id", "colour", "size", "qty", "line_value"]
    if sales.empty:
        return pd.DataFrame(columns=cols)
    cv = current_variant(conn, t)
    sales["variant_id"] = [cv.get(v, v) for v in sales["variant_id"]]
    meta = pd.DataFrame(conn.execute(
        "SELECT p.variant_id, p.product_id, ps.style_id, p.colour, p.size FROM products p"
        " LEFT JOIN product_style ps ON ps.tenant_id = p.tenant_id AND ps.product_id = p.product_id"
        " WHERE p.tenant_id = %(tenant_id)s", p).fetchall(),
        columns=["variant_id", "product_id", "style_id", "colour", "size"])
    out = sales.merge(meta, on="variant_id", how="left")
    out["line_value"] = out["line_value"].astype(float)
    out["qty"] = out["qty"].astype(int)
    return out[cols].reset_index(drop=True)
