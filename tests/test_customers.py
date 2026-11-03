import math
from datetime import date

import pytest

from engine import attribution, customers
from engine.ingest_shopify import customer_key

PHONE = "+201000000001"


def vid(n):
    return f"gid://shopify/ProductVariant/{n}"


def pid(n):
    return f"gid://shopify/Product/{n}"


PA, PB = pid(1), pid(2)
VA, VB = vid(101), vid(102)


def seed_products(conn, t, cost_a=40, cost_b=20):
    for v, p, h, c in ((VA, PA, "dress-a", cost_a), (VB, PB, "dress-b", cost_b)):
        conn.execute("INSERT INTO products (tenant_id, variant_id, product_id, handle, unit_cost)"
                     " VALUES (%s,%s,%s,%s,%s)", (t.tenant_id, v, p, h, c))
    conn.commit()


def add_order(conn, t, order, day, lines, key=PHONE, utm_source=None, utm_content=None):
    """lines: [(variant, qty, value)]"""
    conn.execute("INSERT INTO orders (tenant_id, order_id, date, customer_key, utm_source, utm_content, total)"
                 " VALUES (%s,%s,%s,%s,%s,%s,%s)",
                 (t.tenant_id, order, day, key, utm_source, utm_content, sum(v for _, _, v in lines)))
    for v, q, val in lines:
        conn.execute("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value, customer_key)"
                     " VALUES (%s,%s,%s,%s,%s,%s,%s)", (t.tenant_id, order, day, v, q, val, key))


def add_spend(conn, t, product, day, spend, purchases=0):
    conn.execute("INSERT INTO spend_by_product (tenant_id, date, product_id, method, spend, meta_purchases)"
                 " VALUES (%s,%s,%s,'catalog',%s,%s)", (t.tenant_id, day, product, spend, purchases))


def credit(conn, t):
    """Compute order_credits over the order dates, keeping the hand seeded spend_by_product rows."""
    conn.commit()
    keep = conn.execute("SELECT * FROM spend_by_product WHERE tenant_id = %s", (t.tenant_id,)).fetchall()
    lo, hi = conn.execute("SELECT MIN(date) AS lo, MAX(date) AS hi FROM orders WHERE tenant_id = %s",
                          (t.tenant_id,)).fetchone().values()
    attribution.run_attribution(conn, t, lo, hi)
    conn.execute("DELETE FROM spend_by_product WHERE tenant_id = %s", (t.tenant_id,))
    for r in keep:
        conn.execute("INSERT INTO spend_by_product (tenant_id, date, product_id, method, spend, impressions,"
                     " meta_purchases) VALUES (%(tenant_id)s,%(date)s,%(product_id)s,%(method)s,%(spend)s,"
                     "%(impressions)s,%(meta_purchases)s)", r)
    conn.commit()


def row(df, eid):
    return df[df["entity_id"] == eid].iloc[0]


def test_guest_and_account_same_phone_is_one_customer(conn, tenant_a):
    seed_products(conn, tenant_a)
    guest = customer_key("0100 000 0001", None, None)
    account = customer_key("+201000000001", "x@y.com", "gid://shopify/Customer/9")
    assert guest == account == PHONE
    add_order(conn, tenant_a, "o1", date(2025, 1, 5), [(VA, 1, 100)], key=guest)
    add_order(conn, tenant_a, "o2", date(2025, 1, 9), [(VA, 1, 100)], key=account)
    conn.commit()
    fo = customers.first_orders(conn, tenant_a)
    assert list(fo["order_id"]) == ["o1"] and list(fo["customer_key"]) == [PHONE]


def test_first_order_tie_breaks_on_order_id_and_skips_no_key(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_order(conn, tenant_a, "o2", date(2025, 1, 5), [(VA, 1, 100)])
    add_order(conn, tenant_a, "o1", date(2025, 1, 5), [(VA, 1, 100)])
    add_order(conn, tenant_a, "o3", date(2025, 1, 5), [(VA, 1, 100)], key=None)
    conn.commit()
    assert list(customers.first_orders(conn, tenant_a)["order_id"]) == ["o1"]


def test_meta_attribution_by_source_and_ad_id(conn, tenant_a):
    seed_products(conn, tenant_a)
    conn.execute("INSERT INTO ad_spend_daily (tenant_id, date, account_id, ad_id) VALUES (%s,%s,'a','AD1')",
                 (tenant_a.tenant_id, date(2025, 1, 1)))
    for i, (src, content) in enumerate([("Facebook", None), ("ig", None), ("google", None), ("igloo", None),
                                        (None, "AD1"), (None, "AD2")]):
        add_order(conn, tenant_a, f"o{i}", date(2025, 1, 5), [(VA, 1, 10)], key=f"k{i}",
                  utm_source=src, utm_content=content)
    conn.commit()
    fo = customers.first_orders(conn, tenant_a).set_index("order_id")["meta"]
    assert dict(fo) == {"o0": True, "o1": True, "o2": False, "o3": False, "o4": True, "o5": False}


def test_repeat_orders_not_new(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_order(conn, tenant_a, "o1", date(2025, 1, 5), [(VA, 1, 100)])
    add_order(conn, tenant_a, "o2", date(2025, 2, 5), [(VA, 1, 100)])
    add_spend(conn, tenant_a, PA, date(2025, 1, 6), 300)
    add_spend(conn, tenant_a, PA, date(2025, 2, 6), 300)
    credit(conn, tenant_a)
    jan, feb = customers.cac(conn, tenant_a, "2025-01", "product"), customers.cac(conn, tenant_a, "2025-02", "product")
    assert row(jan, PA)["new_customers"] == 1 and row(jan, PA)["blended_cac"] == 300
    assert row(feb, PA)["new_customers"] == 0 and row(feb, PA)["blended_cac"] is None
    assert row(feb, customers.STORE)["blended_cac"] is None


def test_cac_uses_credit_split(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_order(conn, tenant_a, "o1", date(2025, 1, 5), [(VA, 1, 800), (VB, 1, 200)], utm_source="facebook")
    add_spend(conn, tenant_a, PA, date(2025, 1, 6), 100)
    add_spend(conn, tenant_a, PB, date(2025, 1, 6), 100)
    credit(conn, tenant_a)
    df = customers.cac(conn, tenant_a, "2025-01", "product", lift={PA: 0.5})
    a, b = row(df, PA), row(df, PB)
    assert a["new_customers"] == pytest.approx(0.8) and a["blended_cac"] == pytest.approx(125)
    assert b["new_customers"] == pytest.approx(0.2) and b["blended_cac"] == pytest.approx(500)
    assert a["paid_cac"] == pytest.approx(100 / (0.8 * 0.5))      # lift applies to A only
    assert b["paid_cac"] == pytest.approx(500)
    s = row(df, customers.STORE)
    assert s["new_customers"] == 1 and s["blended_cac"] == pytest.approx(200)


def test_paid_cac_none_without_meta_orders_and_pool_in_store_row(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_order(conn, tenant_a, "o1", date(2025, 1, 5), [(VA, 1, 100)], utm_source="google")
    add_spend(conn, tenant_a, PA, date(2025, 1, 6), 100)
    add_spend(conn, tenant_a, attribution.POOL_PRODUCT, date(2025, 1, 6), 50)
    credit(conn, tenant_a)
    df = customers.cac(conn, tenant_a, "2025-01", "product")
    assert row(df, PA)["paid_cac"] is None and row(df, PA)["spend"] == 100
    assert attribution.POOL_PRODUCT not in set(df["entity_id"])
    assert row(df, customers.STORE)["spend"] == 150


def test_meta_cpa_applies_meta_factor(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_spend(conn, tenant_a, PA, date(2025, 1, 6), 8000, purchases=100)
    conn.commit()
    df = customers.cpa(conn, tenant_a, "2025-01", "product", meta_factor=0.8)
    assert row(df, PA)["meta_cpa"] == pytest.approx(100)
    assert row(df, PA)["shopify_cpa"] is None           # no orders: None, not inf
    assert row(customers.cpa(conn, tenant_a, "2025-01", "product"), PA)["meta_cpa"] == pytest.approx(80)


def test_cpa_per_order_not_unit(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_order(conn, tenant_a, "o1", date(2025, 1, 5), [(VA, 5, 500)], key="k1")
    add_order(conn, tenant_a, "o2", date(2025, 1, 7), [(VA, 1, 100)], key="k2")
    add_spend(conn, tenant_a, PA, date(2025, 1, 6), 200)
    credit(conn, tenant_a)
    df = customers.cpa(conn, tenant_a, "2025-01", "product")
    assert row(df, PA)["order_credits"] == pytest.approx(2) and row(df, PA)["shopify_cpa"] == pytest.approx(100)
    assert row(df, PA)["meta_cpa"] is None
    for col in ("meta_cpa", "shopify_cpa"):
        assert all(v is None or math.isfinite(v) for v in df[col])


def test_style_level_groups_products(conn, tenant_a):
    seed_products(conn, tenant_a)
    conn.execute("INSERT INTO styles (tenant_id, style_id, name) VALUES (%s,'S1','Dress')", (tenant_a.tenant_id,))
    for p in (PA, PB):
        conn.execute("INSERT INTO product_style (tenant_id, product_id, style_id) VALUES (%s,%s,'S1')",
                     (tenant_a.tenant_id, p))
    add_order(conn, tenant_a, "o1", date(2025, 1, 5), [(VA, 1, 800), (VB, 1, 200)])
    add_spend(conn, tenant_a, PA, date(2025, 1, 6), 100)
    add_spend(conn, tenant_a, PB, date(2025, 1, 6), 100)
    credit(conn, tenant_a)
    df = customers.cac(conn, tenant_a, "2025-01", "style")
    assert row(df, "S1")["new_customers"] == pytest.approx(1) and row(df, "S1")["blended_cac"] == pytest.approx(200)


def test_customer_value_12m_with_refund_and_window(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_order(conn, tenant_a, "o1", date(2024, 1, 10), [(VA, 1, 100)])           # profit 60
    add_order(conn, tenant_a, "o2", date(2024, 6, 10), [(VA, 1, 100)])           # profit 60
    add_order(conn, tenant_a, "o3", date(2025, 1, 10), [(VA, 1, 100)])           # outside 12m window
    conn.execute("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value, customer_key)"
                 " VALUES (%s,'o2',%s,%s,-1,-100,%s)", (tenant_a.tenant_id, date(2024, 7, 1), VA, PHONE))  # refund -60
    credit(conn, tenant_a)
    df = customers.customer_value(conn, tenant_a, "product", as_of=date(2026, 1, 1))
    r = row(df, PA)
    assert r["value_12m"] == pytest.approx(60) and r["flags"] == [] and r["customers"] == pytest.approx(1)


def test_missing_cost_uses_store_margin(conn, tenant_a):
    seed_products(conn, tenant_a, cost_a=40, cost_b=None)
    add_order(conn, tenant_a, "o1", date(2024, 1, 10), [(VA, 1, 100)], key="k1")                 # known: margin 0.6
    add_order(conn, tenant_a, "o2", date(2024, 1, 10), [(VB, 1, 200)], key="k2")                 # unknown: 200 * 0.6
    credit(conn, tenant_a)
    df = customers.customer_value(conn, tenant_a, "product", as_of=date(2026, 1, 1))
    assert row(df, PA)["value_12m"] == pytest.approx(60) and row(df, PA)["flags"] == []
    assert row(df, PB)["value_12m"] == pytest.approx(120) and row(df, PB)["flags"] == ["missing_cost"]


def test_no_cost_anywhere_gives_none(conn, tenant_a):
    seed_products(conn, tenant_a, cost_a=None, cost_b=None)
    add_order(conn, tenant_a, "o1", date(2024, 1, 10), [(VA, 1, 100)])
    credit(conn, tenant_a)
    r = row(customers.customer_value(conn, tenant_a, "product", as_of=date(2026, 1, 1)), PA)
    assert r["value_12m"] is None and r["flags"] == ["missing_cost"]


def _cohorts(conn, t):
    """Mature customers (product A): 100 profit on day 0 and 100 more at month 6 -> 12m value 200, value at age 2 = 100."""
    for i in range(3):
        add_order(conn, t, f"m{i}a", date(2024, 1, 1), [(VA, 1, 140)], key=f"m{i}")      # profit 100
        add_order(conn, t, f"m{i}b", date(2024, 7, 1), [(VA, 1, 140)], key=f"m{i}")      # profit 100


def test_young_cohort_scaled(conn, tenant_a):
    seed_products(conn, tenant_a)
    _cohorts(conn, tenant_a)
    add_order(conn, tenant_a, "y1", date(2025, 11, 1), [(VB, 1, 70)], key="young")        # profit 50, age 2 at as_of
    credit(conn, tenant_a)
    df = customers.customer_value(conn, tenant_a, "product", as_of=date(2026, 1, 15))
    assert row(df, PA)["value_12m"] == pytest.approx(200) and row(df, PA)["flags"] == []
    assert row(df, PB)["value_12m"] == pytest.approx(100)         # 50 observed * ratio 200 / 100
    assert row(df, PB)["flags"] == []


def test_young_cohort_without_mature_is_unscaled_and_flagged(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_order(conn, tenant_a, "y1", date(2025, 11, 1), [(VB, 1, 70)], key="young")
    credit(conn, tenant_a)
    r = row(customers.customer_value(conn, tenant_a, "product", as_of=date(2026, 1, 15)), PB)
    assert r["value_12m"] == pytest.approx(50) and r["flags"] == ["young_unscaled"]


def test_product_value_is_credit_weighted(conn, tenant_a):
    seed_products(conn, tenant_a)
    add_order(conn, tenant_a, "o1", date(2024, 1, 10), [(VA, 1, 100)], key="k1")                 # profit 60, credit 1 to A
    add_order(conn, tenant_a, "o2", date(2024, 1, 10), [(VA, 1, 300), (VB, 1, 100)], key="k2")   # profit 260+80 = 340
    credit(conn, tenant_a)
    r = row(customers.customer_value(conn, tenant_a, "product", as_of=date(2026, 1, 1)), PA)
    assert r["value_12m"] == pytest.approx((1 * 60 + 0.75 * 340) / 1.75)


def test_tenants_isolated(conn, tenant_a, tenant_b):
    seed_products(conn, tenant_a)
    seed_products(conn, tenant_b)
    # same ids and customer in both tenants; tenant_b competes with bigger numbers and an earlier first order
    add_order(conn, tenant_a, "o1", date(2025, 1, 5), [(VA, 1, 100)], utm_source="facebook")
    add_order(conn, tenant_b, "o1", date(2024, 12, 5), [(VA, 3, 900)])
    add_order(conn, tenant_b, "ob2", date(2025, 1, 6), [(VA, 3, 900)], key="other")
    add_spend(conn, tenant_a, PA, date(2025, 1, 6), 100, purchases=2)
    add_spend(conn, tenant_b, PA, date(2025, 1, 6), 9999, purchases=50)
    credit(conn, tenant_a)
    credit(conn, tenant_b)
    fo = customers.first_orders(conn, tenant_a)
    assert list(fo["date"]) == [date(2025, 1, 5)] and bool(fo["meta"][0])
    c = customers.cac(conn, tenant_a, "2025-01", "product")
    assert row(c, PA)["spend"] == 100 and row(c, PA)["new_customers"] == 1 and row(c, customers.STORE)["spend"] == 100
    p = customers.cpa(conn, tenant_a, "2025-01", "product")
    assert row(p, PA)["meta_purchases"] == 2 and row(p, PA)["order_credits"] == 1
    v = customers.customer_value(conn, tenant_a, "product", as_of=date(2026, 6, 1))
    assert row(v, PA)["value_12m"] == pytest.approx(60) and row(v, PA)["customers"] == 1


# ---------------------------------------------------------------- I9: vectorised customer value = reference loop

def _reference_customer_values(conn, t, months, as_of):
    """The pre-I9 per customer loop, kept as the reference for the vectorised implementation."""
    import pandas as pd
    from engine.lineage import rekeyed_sales
    fo = customers.first_orders(conn, t)
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


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_vectorised_customer_values_match_reference(conn, tenant_a, seed):
    import random
    from datetime import timedelta
    rnd = random.Random(seed)
    seed_products(conn, tenant_a, cost_a=40, cost_b=None if seed == 2 else 20)
    n = 0
    for c in range(25):
        start = date(2023, 1, 1) + timedelta(days=rnd.randint(0, 1000))
        if c == 0:
            start = date(2024, 1, 31)                    # month end clipping
        for j in range(rnd.randint(1, 5)):
            n += 1
            d = start + timedelta(days=0 if j == 0 else rnd.randint(0, 500))
            add_order(conn, tenant_a, f"o{n}", d, [(rnd.choice([VA, VB]), rnd.choice([1, 2, -1]), rnd.randint(50, 300))],
                      key=f"c{c}")
    add_order(conn, tenant_a, "edge1", date(2024, 2, 29), [(VA, 1, 100)], key="c0")   # Jan 31 + 1 month
    add_order(conn, tenant_a, "edge2", date(2025, 1, 31), [(VA, 1, 100)], key="c0")   # exactly + 12 months
    conn.commit()
    for as_of in (date(2025, 6, 15), date(2026, 3, 1), date(2024, 3, 31)):
        got, has = customers._customer_values(conn, tenant_a, 12, as_of)
        ref, ref_has = _reference_customer_values(conn, tenant_a, 12, as_of)
        assert has == ref_has
        g = got.set_index("customer_key").sort_index()
        r = ref.set_index("customer_key").sort_index()
        assert list(g.index) == list(r.index)
        for k in r.index:
            a, b = g.at[k, "value"], r.at[k, "value"]
            assert (a is None and b is None) or a == pytest.approx(b), (k, as_of)
            assert bool(g.at[k, "missing_cost"]) == bool(r.at[k, "missing_cost"])
            assert bool(g.at[k, "young_unscaled"]) == bool(r.at[k, "young_unscaled"])


def test_customer_values_without_sales_lines(conn, tenant_a):
    seed_products(conn, tenant_a)
    conn.execute("INSERT INTO orders (tenant_id, order_id, date, customer_key, total) VALUES (%s,'o1','2024-01-01','k',0)",
                 (tenant_a.tenant_id,))
    conn.commit()
    df, _ = customers._customer_values(conn, tenant_a, 12, date(2026, 1, 1))
    assert list(df["customer_key"]) == ["k"]
