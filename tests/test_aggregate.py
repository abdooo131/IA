from datetime import date, timedelta

import numpy as np
import pytest

from engine import aggregate

STYLE = "s-dress"
P1 = "gid://shopify/Product/1"


def vid(n):
    return f"gid://shopify/ProductVariant/{n}"


def days(start, n):
    return [start + timedelta(days=i) for i in range(n)]


def seed_style(conn, t, sizes, product=P1, handle="dress-black", style=STYLE, base=100, unit_cost=50):
    conn.execute("INSERT INTO styles (tenant_id, style_id, name) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                 (t.tenant_id, style, style))
    out = {}
    for i, s in enumerate(sizes):
        v = vid(base + i)
        conn.execute("INSERT INTO products (tenant_id, variant_id, product_id, handle, colour, size, unit_cost,"
                     " status) VALUES (%s,%s,%s,%s,'Black',%s,%s,'ACTIVE')", (t.tenant_id, v, product, handle, s,
                                                                             unit_cost))
        out[s] = v
    conn.execute("INSERT INTO product_style (tenant_id, product_id, style_id, colour) VALUES (%s,%s,%s,'Black')",
                 (t.tenant_id, product, style))
    conn.commit()
    return out


def sell(conn, t, variant, day, qty, price=100.0, order=None):
    order = order or f"o-{variant}-{day}"
    conn.execute("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value)"
                 " VALUES (%s,%s,%s,%s,%s,%s)", (t.tenant_id, order, day, variant, qty, qty * price))


def stock(conn, t, variant, day, available, location="L1"):
    conn.execute("INSERT INTO stock_daily (tenant_id, date, variant_id, location_id, available, on_hand)"
                 " VALUES (%s,%s,%s,%s,%s,%s)", (t.tenant_id, day, variant, location, available, available))


def test_adstock_values():
    assert np.allclose(aggregate.adstock([100, 0, 0, 50], 0.6), [100, 60, 36, 71.6])
    assert np.allclose(aggregate.adstock([10, None, float("nan")], 0.3), [10, 3, 0.9])
    assert aggregate.DECAY == {"day": 0.6, "week": 0.3, "month": 0.1}
    assert len(aggregate.adstock([], 0.5)) == 0


def test_size_curve_ignores_out_of_stock_periods(conn, tenant_a):
    v = seed_style(conn, tenant_a, ["S", "M"])
    for i, d in enumerate(days(date(2025, 6, 1), 20)):
        stock(conn, tenant_a, v["S"], d, 5)
        stock(conn, tenant_a, v["M"], d, 5 if i < 10 else 0)
        sell(conn, tenant_a, v["S"], d, 2)
        if i < 10:
            sell(conn, tenant_a, v["M"], d, 2)
    conn.commit()
    curve = aggregate.size_curve(conn, tenant_a, STYLE)
    assert curve == pytest.approx({"S": 0.5, "M": 0.5})   # naive unit share would be 2/3 vs 1/3


def test_size_curve_blends_pixel_by_sample_size(conn, tenant_a):
    v = seed_style(conn, tenant_a, ["S", "M"])
    d = date(2025, 6, 1)
    sell(conn, tenant_a, v["S"], d, 50)
    sell(conn, tenant_a, v["M"], d, 50)
    conn.execute("INSERT INTO funnel_daily (tenant_id, date, product_id, variant_id, size_views)"
                 " VALUES (%s,%s,%s,%s,300)", (tenant_a.tenant_id, d, P1, v["S"]))
    conn.commit()
    curve = aggregate.size_curve(conn, tenant_a, STYLE)
    # sales: 100 units, S 0.5; pixel: 300 sessions, S 1.0 -> (100*0.5 + 300*1.0) / 400
    assert curve == pytest.approx({"S": 0.875, "M": 0.125})


def test_size_availability(conn, tenant_a):
    v = seed_style(conn, tenant_a, ["S", "M", "L"])
    for i, d in enumerate(days(date(2025, 6, 1), 30)):
        for s in ("S", "L"):
            stock(conn, tenant_a, v[s], d, 3)
        m_in = i < 15
        stock(conn, tenant_a, v["M"], d, 0, "L1")
        stock(conn, tenant_a, v["M"], d, 1 if m_in else 0, "L2")   # summed across locations
        sell(conn, tenant_a, v["S"], d, 1)
        sell(conn, tenant_a, v["L"], d, 2)
        if m_in:
            sell(conn, tenant_a, v["M"], d, 2)
    conn.commit()
    assert aggregate.size_curve(conn, tenant_a, STYLE) == pytest.approx({"S": 0.2, "M": 0.4, "L": 0.4})
    panel = aggregate.build_panel(conn, tenant_a, "month", "product")
    row = panel.iloc[0]
    assert row.entity_id == P1 and row.period_start == date(2025, 6, 1)
    assert row.size_availability == pytest.approx(0.8)
    assert not row.no_stock_data


def test_panel_no_stock_data_and_missing_cost(conn, tenant_a):
    v = seed_style(conn, tenant_a, ["S"], unit_cost=None)
    sell(conn, tenant_a, v["S"], date(2025, 6, 2), 2)
    conn.commit()
    row = aggregate.build_panel(conn, tenant_a, "week", "product").iloc[0]
    assert row.size_availability == 1.0 and row.no_stock_data
    assert row.missing_cost and np.isnan(row.cost)
    assert np.isnan(row.views)                     # neither pixel nor landing data
    assert row.units == 2 and row.revenue == 200 and row.price == 100 and row.ref_price == 100


def test_panel_rollup_cost_spend_price_and_levels(conn, tenant_a):
    v = seed_style(conn, tenant_a, ["S"])
    seed_style(conn, tenant_a, ["S"], product="gid://shopify/Product/2", handle="dress-red", base=200)
    d0 = date(2025, 6, 2)                          # Monday
    sell(conn, tenant_a, v["S"], d0, 3, price=100)
    sell(conn, tenant_a, vid(200), d0, 1, price=80)
    sell(conn, tenant_a, v["S"], d0 + timedelta(days=1), -1, price=100)   # refund nets
    for p, s in ((P1, 30), ("gid://shopify/Product/2", 10), ("__pool__", 5)):
        conn.execute("INSERT INTO spend_by_product (tenant_id, date, product_id, method, spend, impressions)"
                     " VALUES (%s,%s,%s,'catalog',%s,%s)", (tenant_a.tenant_id, d0 + timedelta(days=7), p, s, s * 100))
    conn.commit()
    prod = aggregate.build_panel(conn, tenant_a, "week", "product")
    r = prod[(prod.entity_id == P1)].set_index("period_start")
    assert r.loc[d0, "units"] == 2 and r.loc[d0, "revenue"] == 200 and r.loc[d0, "cost"] == 100
    nxt = d0 + timedelta(days=7)
    assert r.loc[nxt, "spend"] == 30 and r.loc[nxt, "units"] == 0
    assert r.loc[nxt, "price"] == 100              # carried forward
    assert r.loc[nxt, "adstock"] == pytest.approx(30)
    style = aggregate.build_panel(conn, tenant_a, "week", "style").set_index("period_start")
    assert set(style.entity_id) == {STYLE}
    assert style.loc[d0, "units"] == 3 and style.loc[nxt, "spend"] == 40
    store = aggregate.build_panel(conn, tenant_a, "week", "store").set_index("period_start")
    assert store.loc[nxt, "spend"] == 45 and store.loc[nxt, "impressions"] == 4500
    assert store.entity_id.iloc[0] == aggregate.STORE_ENTITY
    assert aggregate.build_panel(conn, tenant_a, "week", "collection").empty


def test_views_from_pixel_or_landing(conn, tenant_a):
    seed_style(conn, tenant_a, ["S"])
    t = tenant_a.tenant_id
    start = date(2025, 6, 2)
    for d in days(start, 10):                      # 10 pixel days: under 8 weeks
        conn.execute("INSERT INTO funnel_daily (tenant_id, date, product_id, views) VALUES (%s,%s,%s,100)",
                     (t, d, P1))
        conn.execute("INSERT INTO landing_sessions (tenant_id, date, handle, sessions) VALUES (%s,%s,%s,25)",
                     (t, d, "dress-black"))
    conn.commit()
    p = aggregate.build_panel(conn, tenant_a, "day", "product").set_index("period_start")
    assert p.loc[start, "views"] == pytest.approx(100)      # 25 sessions / landing share 0.25
    assert p.views_estimated.all()

    for d in days(start + timedelta(days=10), 50):          # now 60 pixel days
        conn.execute("INSERT INTO funnel_daily (tenant_id, date, product_id, views) VALUES (%s,%s,%s,40)",
                     (t, d, P1))
    conn.commit()
    p = aggregate.build_panel(conn, tenant_a, "day", "product").set_index("period_start")
    assert p.loc[start + timedelta(days=20), "views"] == 40 and not p.views_estimated.any()


def test_calendar_flags():
    f = aggregate.day_flags(date(2025, 11, 20), date(2025, 12, 1))
    assert f.loc[date(2025, 11, 28), "white_friday_week"] == 1       # last Friday of Nov 2025
    assert f.loc[date(2025, 11, 22), "white_friday_week"] == 1
    assert f.loc[date(2025, 11, 21), "white_friday_week"] == 0
    assert f.loc[date(2025, 11, 25), "payday"] == 1 and f.loc[date(2025, 11, 24), "payday"] == 0
    r = aggregate.day_flags(date(2025, 3, 1), date(2025, 6, 30))
    assert r["ramadan"].sum() == 29 and r["eid_al_fitr"].sum() == 3 and r["eid_al_adha"].sum() == 4


def test_week_flag_is_fraction_and_promo(conn, tenant_a):
    v = seed_style(conn, tenant_a, ["S"])
    sell(conn, tenant_a, v["S"], date(2025, 11, 24), 1)          # Monday; 25..30 are paydays
    conn.execute("INSERT INTO calendar (tenant_id, date, flags) VALUES (%s,%s,'{\"promo\": true}')",
                 (tenant_a.tenant_id, date(2025, 11, 26)))
    conn.commit()
    row = aggregate.build_panel(conn, tenant_a, "week", "product").iloc[0]
    assert row.payday == pytest.approx(6 / 7)
    assert row.promo == pytest.approx(1 / 7)
    assert row.white_friday_week == pytest.approx(5 / 7)        # 22..28 Nov; week 24..30


def test_size_curve_skips_replaced_variants(conn, tenant_a):
    v = seed_style(conn, tenant_a, ["S", "M"])
    old = vid(900)                                  # old multi colour product had only S; replaced by v["S"]
    conn.execute("INSERT INTO products (tenant_id, variant_id, product_id, handle, size, status)"
                 " VALUES (%s,%s,'gid://shopify/Product/9','dress','S','ARCHIVED')", (tenant_a.tenant_id, old))
    conn.execute("INSERT INTO product_style (tenant_id, product_id, style_id) VALUES (%s,'gid://shopify/Product/9',%s)",
                 (tenant_a.tenant_id, STYLE))
    conn.execute("INSERT INTO variant_lineage (tenant_id, old_variant_id, new_variant_id, method, confirmed)"
                 " VALUES (%s,%s,%s,'sku',TRUE)", (tenant_a.tenant_id, old, v["S"]))
    for d in days(date(2025, 6, 1), 10):
        stock(conn, tenant_a, v["S"], d, 5)
        stock(conn, tenant_a, v["M"], d, 5)
        sell(conn, tenant_a, old if d.day < 5 else v["S"], d, 2)   # old history re keyed to the new S
        sell(conn, tenant_a, v["M"], d, 2)
    conn.commit()
    assert aggregate.size_curve(conn, tenant_a, STYLE) == pytest.approx({"S": 0.5, "M": 0.5})
    panel = aggregate.build_panel(conn, tenant_a, "month", "product")
    assert list(panel.entity_id) == [P1] and panel.units.iloc[0] == 40
