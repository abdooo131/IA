from datetime import date, datetime, timezone

import pandas as pd
import pytest

from engine import lineage

COLOURS = ["Black", "Red", "Blue", "Green", "White"]
SIZES = ["S", "M", "L", "XL"]
OLD_CREATED = datetime(2025, 1, 1, 9, tzinfo=timezone.utc)
# 22:30 UTC on 10 June is already 11 June in Cairo (UTC+3 in summer)
NEW_CREATED = datetime(2025, 6, 10, 22, 30, tzinfo=timezone.utc)
SPLIT = date(2025, 6, 11)


def vid(n):
    return f"gid://shopify/ProductVariant/{n}"


def pid(n):
    return f"gid://shopify/Product/{n}"


def add_variant(conn, t, variant, product, title, colour, size, sku, status, created, handle=None):
    conn.execute(
        "INSERT INTO products (tenant_id, variant_id, product_id, handle, title, colour, size, sku, status, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (t.tenant_id, variant, product, handle or title.lower().replace(" ", "-"), title, colour, size, sku,
         status, created))


def old_vid(ci, si):
    return vid(1000 + ci * 10 + si)


def new_vid(ci, si, offset=2000):
    return vid(offset + ci * 10 + si)


def seed_old(conn, t, with_sku=True):
    for ci, c in enumerate(COLOURS):
        for si, s in enumerate(SIZES):
            add_variant(conn, t, old_vid(ci, si), pid(1), "Silk Dress", c, s,
                        f"SD-{c[:3].upper()}-{s}" if with_sku else None, "ARCHIVED", OLD_CREATED)


def seed_new(conn, t, with_sku=True, skip=(), offset=2000, pid_base=10):
    for ci, c in enumerate(COLOURS):
        if c in skip:
            continue
        for si, s in enumerate(SIZES):
            add_variant(conn, t, new_vid(ci, si, offset), pid(pid_base + ci), f"Silk Dress - {c}", c, s,
                        f"SD-{c[:3].upper()}-{s}" if with_sku else None, "ACTIVE", NEW_CREATED,
                        handle=f"silk-dress-{c.lower()}")


@pytest.fixture
def split(conn, tenant_a):
    seed_old(conn, tenant_a)
    seed_new(conn, tenant_a)
    conn.commit()
    return tenant_a


def test_normalise_title():
    words = {"black", "dark blue", "أسود"}
    assert lineage.normalise_title("Silk Dress - Black", words) == "silk dress"
    assert lineage.normalise_title("Silk Dress / Dark Blue", words) == "silk dress"
    assert lineage.normalise_title("فستان حرير - أسود", words) == "فستان حرير"
    assert lineage.normalise_title("Blackout Dress", words) == "blackout dress"  # whole words only
    assert lineage.normalise_title("  Silk   Dress ", words) == "silk dress"


def test_sku_match_first(conn, split):
    df = lineage.propose_matches(conn, split)
    assert len(df) == 20
    assert set(df["method"]) == {"sku"}
    assert (df["candidates"] == 1).all() and df["confirmed"].all()
    m = dict(zip(df["old_variant_id"], df["new_variant_id"]))
    assert m[old_vid(1, 2)] == new_vid(1, 2)
    assert set(df["effective_date"]) == {SPLIT}
    stored = conn.execute("SELECT count(*) AS n FROM variant_lineage WHERE confirmed").fetchone()["n"]
    assert stored == 20


def test_title_colour_size_match(conn, tenant_a):
    seed_old(conn, tenant_a, with_sku=False)
    seed_new(conn, tenant_a, with_sku=False)
    conn.commit()
    df = lineage.propose_matches(conn, tenant_a)
    assert len(df) == 20 and set(df["method"]) == {"title"} and df["confirmed"].all()
    m = dict(zip(df["old_variant_id"], df["new_variant_id"]))
    assert m[old_vid(3, 1)] == new_vid(3, 1)


def test_title_match_by_colour_in_handle(conn, tenant_a):
    # new product's colour option is in another language; the handle carries the English colour
    seed_old(conn, tenant_a, with_sku=False)
    add_variant(conn, tenant_a, vid(9001), pid(90), "Silk Dress - أسود", "أسود", "S", None, "ACTIVE", NEW_CREATED,
                handle="silk-dress-black")
    conn.commit()
    df = lineage.propose_matches(conn, tenant_a)
    assert dict(zip(df["old_variant_id"], df["new_variant_id"])) == {old_vid(0, 0): vid(9001)}


def test_ambiguous_goes_to_review(conn, split):
    # a second ACTIVE Black product created later: Black variants now have two candidates
    for si, s in enumerate(SIZES):
        add_variant(conn, split, new_vid(0, si, 3000), pid(99), "Silk Dress - Black", "Black", s, None, "ACTIVE",
                    datetime(2025, 7, 1, tzinfo=timezone.utc), handle="silk-dress-black-2")
    # drop SKUs of the first Black product so matching falls to title for those
    conn.execute("UPDATE products SET sku=NULL WHERE tenant_id=%s AND product_id=%s", (split.tenant_id, pid(10)))
    conn.commit()
    df = lineage.propose_matches(conn, split)
    black_old = {old_vid(0, si) for si in range(4)}
    amb = df[df["old_variant_id"].isin(black_old)]
    assert len(amb) == 8 and (amb["candidates"] == 2).all() and not amb["confirmed"].any()
    assert df[~df["old_variant_id"].isin(black_old)]["confirmed"].all()
    cv = lineage.current_variant(conn, split)
    for o in black_old:
        assert cv[o] == o  # never re-keyed while ambiguous
    # reviewer picks one
    lineage.confirm(conn, split, old_vid(0, 0), new_vid(0, 0, 3000))
    assert lineage.current_variant(conn, split)[old_vid(0, 0)] == new_vid(0, 0, 3000)
    left = conn.execute("SELECT count(*) AS n FROM variant_lineage WHERE old_variant_id=%s", (old_vid(0, 0),)).fetchone()
    assert left["n"] == 1


def test_ambiguous_sku_not_resolved_by_title(conn, split):
    # same SKU on two new products -> review, even though title+colour+size would single one out
    add_variant(conn, split, vid(9100), pid(98), "Other", "Black", "S", "SD-BLA-S", "ACTIVE",
                datetime(2025, 7, 1, tzinfo=timezone.utc))
    conn.commit()
    df = lineage.propose_matches(conn, split)
    row = df[df["old_variant_id"] == old_vid(0, 0)]
    assert len(row) == 2 and (row["candidates"] == 2).all() and not row["confirmed"].any()
    assert set(row["method"]) == {"sku"}


def test_unmatched_keeps_history(conn, tenant_a):
    seed_old(conn, tenant_a)
    seed_new(conn, tenant_a, skip=("White",))
    conn.commit()
    df = lineage.propose_matches(conn, tenant_a)
    white = {old_vid(4, si) for si in range(4)}
    assert len(df) == 16 and not set(df["old_variant_id"]) & white
    cv = lineage.current_variant(conn, tenant_a)
    for w in white:
        assert cv[w] == w
    assert cv[old_vid(0, 0)] == new_vid(0, 0)


def test_active_single_colour_products_are_not_old(conn, split):
    df = lineage.propose_matches(conn, split)
    new_ids = {new_vid(ci, si) for ci in range(5) for si in range(4)}
    assert not set(df["old_variant_id"]) & new_ids


def test_new_must_be_created_later(conn, tenant_a):
    seed_old(conn, tenant_a)
    seed_new(conn, tenant_a)
    conn.execute("UPDATE products SET created_at=%s WHERE tenant_id=%s AND status='ACTIVE'",
                 (datetime(2024, 1, 1, tzinfo=timezone.utc), tenant_a.tenant_id))
    conn.commit()
    assert lineage.propose_matches(conn, tenant_a).empty


def test_propose_is_idempotent_and_keeps_confirmed(conn, split):
    lineage.propose_matches(conn, split)
    lineage.propose_matches(conn, split)
    n = conn.execute("SELECT count(*) AS n FROM variant_lineage").fetchone()["n"]
    assert n == 20


def test_styles_group_old_and_new(conn, split):
    lineage.propose_matches(conn, split)
    assert lineage.build_styles(conn, split) == 1
    rows = conn.execute("SELECT * FROM product_style WHERE tenant_id=%s ORDER BY product_id",
                        (split.tenant_id,)).fetchall()
    assert len(rows) == 6 and len({r["style_id"] for r in rows}) == 1
    by = {r["product_id"]: r["colour"] for r in rows}
    assert by[pid(1)] is None
    assert {by[pid(10 + i)] for i in range(5)} == set(COLOURS)
    style = conn.execute("SELECT * FROM styles WHERE tenant_id=%s", (split.tenant_id,)).fetchone()
    assert style["name"] == "silk dress" and style["style_id"] == f"{split.tenant_id}-silk-dress"
    assert lineage.build_styles(conn, split) == 1  # idempotent
    assert conn.execute("SELECT count(*) AS n FROM product_style").fetchone()["n"] == 6


def seed_sales(conn, t):
    """Old variants sell before the split, new variants after. Returns expected units per ISO week."""
    expected = {}
    n = 0
    plan = [(date(2025, 6, 2), old_vid, 3), (date(2025, 6, 9), old_vid, 2),
            (date(2025, 6, 11), new_vid, 4), (date(2025, 6, 18), new_vid, 5)]
    for d, fn, qty in plan:
        for ci in range(5):
            n += 1
            conn.execute("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value)"
                         " VALUES (%s,%s,%s,%s,%s,%s)", (t.tenant_id, f"o{n}", d, fn(ci, 1), qty, qty * 100))
        wk = pd.Timestamp(d).to_period("W").start_time.date()
        expected[wk] = expected.get(wk, 0) + 5 * qty
    conn.commit()
    return expected


def test_continuous_sales_across_split(conn, split):
    expected = seed_sales(conn, split)
    lineage.propose_matches(conn, split)
    lineage.build_styles(conn, split)
    df = lineage.rekeyed_sales(conn, split)
    assert list(df.columns) == ["date", "order_id", "variant_id", "product_id", "style_id", "colour", "size",
                                "qty", "line_value"]
    assert df["style_id"].nunique() == 1
    # every line points at a current (new) variant, so nothing is double counted under old ids
    assert set(df["product_id"]) == {pid(10 + i) for i in range(5)}
    df["week"] = pd.to_datetime(df["date"]).dt.to_period("W").dt.start_time.dt.date
    weekly = df.groupby("week")["qty"].sum().to_dict()
    assert weekly == expected
    assert df["qty"].sum() == sum(expected.values()) == 70
    assert df["line_value"].sum() == 7000
    assert set(df["colour"]) == set(COLOURS)  # colour of the old sale follows the new variant


def test_rekeyed_sales_keeps_unmatched_and_unknown(conn, tenant_a):
    seed_old(conn, tenant_a)
    conn.execute("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value)"
                 " VALUES (%s,'o1','2025-03-01',%s,1,50), (%s,'o2','2025-03-01','gid://shopify/ProductVariant/1',2,80)",
                 (tenant_a.tenant_id, old_vid(0, 0), tenant_a.tenant_id))
    conn.commit()
    lineage.build_styles(conn, tenant_a)
    df = lineage.rekeyed_sales(conn, tenant_a).set_index("order_id")
    assert df.loc["o1", "variant_id"] == old_vid(0, 0) and df.loc["o1", "product_id"] == pid(1)
    assert df.loc["o2", "variant_id"] == "gid://shopify/ProductVariant/1" and pd.isna(df.loc["o2", "product_id"])
    assert lineage.rekeyed_sales(conn, tenant_a.__class__(**{**tenant_a.__dict__, "tenant_id": 9999})).empty


def test_meta_old_catalog_id_resolves(conn, split):
    lineage.propose_matches(conn, split)
    cv = lineage.current_variant(conn, split)
    old, new = old_vid(2, 3), new_vid(2, 3)
    assert cv[old] == new and cv[new] == new
    old_n, new_n = old.rsplit("/", 1)[1], new.rsplit("/", 1)[1]
    assert cv[f"shopify_EG_1_{old_n}"] == new            # old catalog id
    assert cv[f"shopify_EG_12_{new_n}"] == new           # new catalog id
    assert cv[old_n] == new and cv[new_n] == new         # bare variant ids
    assert cv.get("shopify_SA_1_" + old_n) == new        # other country code
    assert "shopify_EG_1_424242" not in cv and cv.get("shopify_EG_1_424242") is None
    assert "junk" not in cv


def test_catalog_to_variant_parser():
    assert lineage.catalog_to_variant("shopify_EG_123_456") == vid(456)
    assert lineage.catalog_to_variant("456") == vid(456)
    assert lineage.catalog_to_variant(vid(456)) == vid(456)
    assert lineage.catalog_to_variant("shopify_EG_123") is None
    assert lineage.catalog_to_variant("abc") is None
    assert lineage.catalog_to_variant("") is None


def link(conn, t, old, new, confirmed=True):
    conn.execute("INSERT INTO variant_lineage (tenant_id, old_variant_id, new_variant_id, effective_date, method,"
                 " confirmed, candidates) VALUES (%s,%s,%s,'2025-01-01','manual',%s,1)",
                 (t.tenant_id, old, new, confirmed))
    conn.commit()


def test_chains_resolve_to_latest_and_cycles_are_guarded(conn, tenant_a):
    for n in (1, 2, 3, 4, 5):
        add_variant(conn, tenant_a, vid(n), pid(n), f"P{n}", None, None, None, "ACTIVE", OLD_CREATED)
    link(conn, tenant_a, vid(1), vid(2))
    link(conn, tenant_a, vid(2), vid(3))
    link(conn, tenant_a, vid(4), vid(5), confirmed=False)
    cv = lineage.current_variant(conn, tenant_a)
    assert cv[vid(1)] == vid(3) and cv[vid(2)] == vid(3) and cv[vid(3)] == vid(3)
    assert cv[vid(4)] == vid(4)  # unconfirmed never re-keys
    link(conn, tenant_a, vid(3), vid(1))  # cycle 1 -> 2 -> 3 -> 1
    cv = lineage.current_variant(conn, tenant_a)
    assert {cv[vid(1)], cv[vid(2)], cv[vid(3)]} == {vid(1), vid(2), vid(3)}  # terminates, history kept


def test_confirm_manual_and_validation(conn, tenant_a):
    add_variant(conn, tenant_a, vid(1), pid(1), "A", None, None, None, "ARCHIVED", OLD_CREATED)
    add_variant(conn, tenant_a, vid(2), pid(2), "B", None, None, None, "ACTIVE", NEW_CREATED)
    conn.commit()
    lineage.confirm(conn, tenant_a, vid(1), vid(2))
    r = conn.execute("SELECT * FROM variant_lineage").fetchone()
    assert r["method"] == "manual" and r["confirmed"] and r["effective_date"] == SPLIT
    assert lineage.current_variant(conn, tenant_a)[vid(1)] == vid(2)
    with pytest.raises(ValueError):
        lineage.confirm(conn, tenant_a, vid(1), vid(1))
    with pytest.raises(ValueError):
        lineage.confirm(conn, tenant_a, vid(1), vid(777))


def test_lineage_isolated_per_tenant(conn, tenant_a, tenant_b):
    for t in (tenant_a, tenant_b):
        seed_old(conn, t)
        seed_new(conn, t)
    conn.commit()
    lineage.propose_matches(conn, tenant_a)
    assert lineage.build_styles(conn, tenant_a) == 1
    assert conn.execute("SELECT count(*) AS n FROM variant_lineage WHERE tenant_id=%s",
                        (tenant_b.tenant_id,)).fetchone()["n"] == 0
    assert conn.execute("SELECT count(*) AS n FROM styles WHERE tenant_id=%s",
                        (tenant_b.tenant_id,)).fetchone()["n"] == 0
    cv_b = lineage.current_variant(conn, tenant_b)
    assert cv_b[old_vid(0, 0)] == old_vid(0, 0)
    lineage.propose_matches(conn, tenant_b)
    assert conn.execute("SELECT count(*) AS n FROM variant_lineage WHERE tenant_id=%s",
                        (tenant_a.tenant_id,)).fetchone()["n"] == 20
