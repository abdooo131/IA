import logging
from datetime import date

import pandas as pd
import pytest

from engine import attribution

D = date(2025, 7, 10)


def vid(n):
    return f"gid://shopify/ProductVariant/{n}"


def pid(n):
    return f"gid://shopify/Product/{n}"


P_BLACK, P_RED, P_OLD = pid(1), pid(2), pid(9)
V_BLACK, V_RED = vid(101), vid(102)
V_OLD_BLACK, V_OLD_RED = vid(901), vid(902)


def seed_products(conn, t):
    rows = [
        (V_BLACK, P_BLACK, "silk-dress-black", "Black"),
        (V_RED, P_RED, "silk-dress-red", "Red"),
        (V_OLD_BLACK, P_OLD, "silk-dress", "Black"),
        (V_OLD_RED, P_OLD, "silk-dress", "Red"),
    ]
    for v, p, h, c in rows:
        conn.execute("INSERT INTO products (tenant_id, variant_id, product_id, handle, colour) VALUES (%s,%s,%s,%s,%s)",
                     (t.tenant_id, v, p, h, c))
    for o, n in ((V_OLD_BLACK, V_BLACK), (V_OLD_RED, V_RED)):
        conn.execute("INSERT INTO variant_lineage (tenant_id, old_variant_id, new_variant_id, method, confirmed)"
                     " VALUES (%s,%s,%s,'sku',TRUE)", (t.tenant_id, o, n))
    conn.commit()


def add_ad(conn, t, ad, name, spend, imps=1000, purchases=2, day=D, account="acc1"):
    conn.execute("INSERT INTO ad_spend_daily (tenant_id, date, account_id, ad_id, ad_name, spend, impressions,"
                 " purchases) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", (t.tenant_id, day, account, ad, name, spend, imps, purchases))


def add_cat(conn, t, ad, cat_id, spend, imps=0, purchases=0, day=D, account="acc1"):
    conn.execute("INSERT INTO catalog_spend_daily (tenant_id, date, account_id, ad_id, catalog_product_id, spend,"
                 " impressions, purchases) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                 (t.tenant_id, day, account, ad, cat_id, spend, imps, purchases))


def add_sale(conn, t, order, variant, value, day=D, utm=None, qty=1):
    conn.execute("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value)"
                 " VALUES (%s,%s,%s,%s,%s,%s)", (t.tenant_id, order, day, variant, qty, value))
    conn.execute("INSERT INTO orders (tenant_id, order_id, date, utm_content, total) VALUES (%s,%s,%s,%s,%s)"
                 " ON CONFLICT DO NOTHING", (t.tenant_id, order, day, utm, value))


def by(df):
    return {(r.product_id, r.method): (r.spend, r.impressions, r.meta_purchases) for r in df.itertuples()}


@pytest.fixture
def t(conn, tenant_a):
    seed_products(conn, tenant_a)
    return tenant_a


def test_catalog_maps_to_current_variant_via_lineage(conn, t):
    add_ad(conn, t, "ad1", "catalog_ad", 100, 5000, 4)
    add_cat(conn, t, "ad1", "shopify_EG_9_901", 60, 3000, 3)   # old variant, catalog form
    add_cat(conn, t, "ad1", "102", 40, 2000, 1)                # new variant, bare id
    conn.commit()
    r = by(attribution.attribute_day(conn, t, D))
    assert r == {(P_BLACK, "catalog"): (60, 3000, 3), (P_RED, "catalog"): (40, 2000, 1)}


def test_name_convention(conn, t):
    assert attribution.parse_ad_name("SILK-Dress-Red_video_hook", ["silk-dress-red"]) == "silk-dress-red"
    assert attribution.parse_ad_name("other_video_hook", ["silk-dress-red"]) is None
    assert attribution.parse_ad_name(None, ["x"]) is None
    add_ad(conn, t, "ad1", "SILK-DRESS-RED_video_hook1", 50, 800, 1)
    conn.commit()
    assert by(attribution.attribute_day(conn, t, D)) == {(P_RED, "name"): (50, 800, 1)}


def test_name_of_archived_product_splits_by_revenue(conn, t):
    add_ad(conn, t, "ad1", "silk-dress_video_a", 100, 1000, 4)
    add_sale(conn, t, "o1", V_OLD_BLACK, 300)  # re-keyed to black
    add_sale(conn, t, "o2", V_RED, 100)
    conn.commit()
    r = by(attribution.attribute_day(conn, t, D))
    assert r[(P_BLACK, "name")] == pytest.approx((75, 750, 3))
    assert r[(P_RED, "name")] == pytest.approx((25, 250, 1))


def test_name_of_archived_product_equal_split_without_revenue(conn, t):
    add_ad(conn, t, "ad1", "silk-dress_video_a", 100)
    conn.commit()
    r = by(attribution.attribute_day(conn, t, D))
    assert r[(P_BLACK, "name")][0] == pytest.approx(50) and r[(P_RED, "name")][0] == pytest.approx(50)


def test_manual_map(conn, t):
    add_ad(conn, t, "ad1", "untitled", 100, 1000, 4)
    for p, s in ((P_BLACK, 3), (P_RED, 1)):
        conn.execute("INSERT INTO ad_product_map (tenant_id, ad_id, product_id, share) VALUES (%s,'ad1',%s,%s)",
                     (t.tenant_id, p, s))
    conn.commit()
    r = by(attribution.attribute_day(conn, t, D))
    assert r[(P_BLACK, "manual")] == pytest.approx((75, 750, 3))
    assert r[(P_RED, "manual")] == pytest.approx((25, 250, 1))


def test_pool_by_revenue_share(conn, t):
    add_ad(conn, t, "ad1", "untitled", 100, 1000, 5)
    add_sale(conn, t, "o1", V_BLACK, 800)
    add_sale(conn, t, "o2", V_RED, 200)
    conn.commit()
    r = by(attribution.attribute_day(conn, t, D))
    assert r[(P_BLACK, "pool")] == pytest.approx((80, 800, 4))
    assert r[(P_RED, "pool")] == pytest.approx((20, 200, 1))


def test_pool_falls_back_to_trailing_revenue_then_pool_row(conn, t):
    add_ad(conn, t, "ad1", "untitled", 100)
    conn.commit()
    assert by(attribution.attribute_day(conn, t, D)) == {(attribution.POOL_PRODUCT, "pool"): (100, 1000, 2)}
    add_sale(conn, t, "o1", V_RED, 50, day=date(2025, 6, 20))
    conn.commit()
    assert by(attribution.attribute_day(conn, t, D)) == {(P_RED, "pool"): (100, 1000, 2)}
    add_sale(conn, t, "o0", V_RED, 50, day=date(2025, 5, 1))  # outside 28 days: ignored
    conn.commit()
    assert by(attribution.attribute_day(conn, t, D)) == {(P_RED, "pool"): (100, 1000, 2)}


def test_unknown_to_pool_and_logged(conn, t, caplog):
    add_ad(conn, t, "ad1", "catalog_ad", 100, 1000, 2)
    add_cat(conn, t, "ad1", "shopify_EG_5_777", 30, 300, 1)  # unknown variant
    add_cat(conn, t, "ad1", "101", 50, 500, 1)
    add_ad(conn, t, "ad2", "mystery", 20, 100, 0)
    add_sale(conn, t, "o1", V_RED, 10)
    conn.commit()
    with caplog.at_level(logging.WARNING, logger="engine.attribution"):
        attribution.run_attribution(conn, t, D, D)
    assert any("unmapped" in m for m in caplog.messages)
    log = conn.execute("SELECT * FROM unmapped_spend_log WHERE tenant_id=%s ORDER BY ad_id", (t.tenant_id,)).fetchall()
    assert [(r["ad_id"], r["reason"], float(r["spend"])) for r in log] == [
        ("ad1", "unknown_catalog_id", 30.0), ("ad1", "no_mapping", 20.0), ("ad2", "no_mapping", 20.0)]
    assert log[0]["catalog_product_id"] == "shopify_EG_5_777"
    rows = {(r["product_id"], r["method"]): float(r["spend"]) for r in conn.execute(
        "SELECT * FROM spend_by_product WHERE tenant_id=%s", (t.tenant_id,))}
    assert rows == {(P_BLACK, "catalog"): 50.0, (P_RED, "pool"): 70.0}


def test_totals_conserved(conn, t):
    add_ad(conn, t, "ad1", "catalog_ad", 100, 1000, 5)
    add_cat(conn, t, "ad1", "101", 60, 600, 3)          # residual 40 continues to name/pool
    add_ad(conn, t, "ad2", "silk-dress_x_y", 33.33, 777, 1)
    add_ad(conn, t, "ad3", "untitled", 11.11, 111, 3)
    add_ad(conn, t, "ad4", "manual_ad", 7, 70, 1)
    conn.execute("INSERT INTO ad_product_map (tenant_id, ad_id, product_id, share) VALUES (%s,'ad4',%s,1)",
                 (t.tenant_id, P_BLACK))
    add_ad(conn, t, "adx", "other_day", 99, 9, 9, day=date(2025, 7, 11))
    add_sale(conn, t, "o1", V_BLACK, 70)
    add_sale(conn, t, "o2", V_RED, 30)
    conn.commit()
    df = attribution.attribute_day(conn, t, D)
    assert df["spend"].sum() == pytest.approx(100 + 33.33 + 11.11 + 7)
    assert df["impressions"].sum() == pytest.approx(1000 + 777 + 111 + 70)
    assert df["meta_purchases"].sum() == pytest.approx(5 + 1 + 3 + 1)
    assert set(df["method"]) == {"catalog", "name", "manual", "pool"}


def test_run_attribution_idempotent_and_tenant_scoped(conn, t, tenant_b):
    add_ad(conn, t, "ad1", "silk-dress-red_v_a", 10)
    conn.execute("INSERT INTO ad_spend_daily (tenant_id, date, account_id, ad_id, ad_name, spend) VALUES"
                 " (%s,%s,'accB','ad1','silk-dress-red_v_a',999)", (tenant_b.tenant_id, D))
    conn.commit()
    for _ in range(2):
        attribution.run_attribution(conn, t, D, D)
    rows = conn.execute("SELECT spend FROM spend_by_product WHERE tenant_id=%s", (t.tenant_id,)).fetchall()
    assert [float(r["spend"]) for r in rows] == [10.0]
    assert conn.execute("SELECT count(*) AS n FROM spend_by_product WHERE tenant_id=%s",
                        (tenant_b.tenant_id,)).fetchone()["n"] == 0


def lines(*pairs):
    return pd.DataFrame(pairs, columns=["product_id", "line_value"])


def test_credit_value_split():
    c = attribution.order_credit(lines(("a", 800), ("b", 200)), None)
    assert c == pytest.approx({"a": 0.8, "b": 0.2})


def test_credit_ad_source_wins():
    c = attribution.order_credit(lines(("a", 800), ("b", 200)), "b")
    assert c == {"a": 0.0, "b": 1.0}


def test_credit_ad_product_not_in_order_falls_back_to_value_split():
    c = attribution.order_credit(lines(("a", 800), ("b", 200)), "zzz")
    assert c == pytest.approx({"a": 0.8, "b": 0.2})


def test_credit_zero_value_equal_split():
    assert attribution.order_credit(lines(("a", 0), ("b", 0)), None) == {"a": 0.5, "b": 0.5}


def test_run_attribution_order_credits(conn, t):
    add_ad(conn, t, "adR", "silk-dress-red_v_a", 10)
    add_ad(conn, t, "adC", "catalog", 10)
    add_cat(conn, t, "adC", "101", 10)
    add_sale(conn, t, "o1", V_BLACK, 800, utm="adR")
    add_sale(conn, t, "o1", V_RED, 200, utm="adR")
    add_sale(conn, t, "o2", V_BLACK, 800, utm="adC")
    add_sale(conn, t, "o2", V_OLD_RED, 200, utm="adC")
    conn.commit()
    for _ in range(2):
        attribution.run_attribution(conn, t, D, D)
    rows = conn.execute("SELECT order_id, product_id, credit, ad_product_id FROM order_credits"
                        " WHERE tenant_id=%s", (t.tenant_id,)).fetchall()
    got = {(r["order_id"], r["product_id"]): (float(r["credit"]), r["ad_product_id"]) for r in rows}
    assert got == {("o1", P_BLACK): (0.0, P_RED), ("o1", P_RED): (1.0, P_RED),
                   ("o2", P_BLACK): (0.8, None), ("o2", P_RED): (0.2, None)}


def test_lineage_confirmed_after_attribution_moves_product_spend_and_credits(conn, tenant_a):
    """I5: spend and order credits attributed to an old product before its lineage was confirmed are read as
    the current product's in every reader (panels, CPA, CAC)."""
    from engine import aggregate, customers, lineage
    t = tenant_a
    for v, p, h, c, created in ((V_BLACK, P_BLACK, "silk-dress-black", "Black", "2025-08-01"),
                                (V_OLD_BLACK, P_OLD, "silk-dress", "Black", "2025-01-01")):
        conn.execute("INSERT INTO products (tenant_id, variant_id, product_id, handle, title, colour, status,"
                     " created_at) VALUES (%s,%s,%s,%s,'Silk Dress',%s,'ACTIVE',%s)", (t.tenant_id, v, p, h, c, created))
    add_ad(conn, t, "adOld", "silk-dress_v_a", 30)
    add_sale(conn, t, "o1", V_OLD_BLACK, 500, utm="adOld")
    conn.execute("UPDATE orders SET customer_key = 'c1' WHERE tenant_id = %s", (t.tenant_id,))
    conn.commit()
    attribution.run_attribution(conn, t, D, D)
    assert {r["product_id"] for r in conn.execute("SELECT product_id FROM spend_by_product WHERE tenant_id=%s",
                                                   (t.tenant_id,))} == {P_OLD}
    lineage.confirm(conn, t, V_OLD_BLACK, V_BLACK)

    panel = aggregate.build_panel(conn, t, "month", "product").set_index("entity_id")
    assert panel.loc[P_BLACK, "spend"] == pytest.approx(30) and panel.loc[P_BLACK, "units"] == 1
    assert P_OLD not in panel.index or panel.loc[P_OLD, "spend"] == 0
    cpa = customers.cpa(conn, t, "2025-07", "product").set_index("entity_id")
    assert cpa.loc[P_BLACK, "spend"] == pytest.approx(30) and cpa.loc[P_BLACK, "order_credits"] == pytest.approx(1)
    assert P_OLD not in cpa.index
    cac = customers.cac(conn, t, "2025-07", "product").set_index("entity_id")
    assert cac.loc[P_BLACK, "new_customers"] == pytest.approx(1)


def test_product_shares_split_old_multi_colour_product():
    from engine.lineage import rekey_products
    df = pd.DataFrame({"product_id": ["old", "x"], "spend": [10.0, 4.0]})
    out = rekey_products(df, {"old": {"a": 0.5, "b": 0.5}}, ["spend"])
    assert sorted(zip(out["product_id"], out["spend"])) == [("a", 5.0), ("b", 5.0), ("x", 4.0)]
