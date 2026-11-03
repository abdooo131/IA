from datetime import date

import pytest

from engine import calibrate
from engine.model import DemandParams


def order(conn, t, oid, day, source=None, content=None):
    conn.execute("INSERT INTO orders (tenant_id, order_id, date, utm_source, utm_content, total)"
                 " VALUES (%s,%s,%s,%s,%s,100)", (t.tenant_id, oid, day, source, content))


def meta_spend(conn, t, day, purchases, ad="ad1"):
    conn.execute("INSERT INTO ad_spend_daily (tenant_id, date, account_id, ad_id, spend, purchases)"
                 " VALUES (%s,%s,'acc',%s,10,%s)", (t.tenant_id, day, ad, purchases))


def test_meta_factor_ratio_and_cap(conn, tenant_a, tenant_b):
    t = tenant_a
    for i, s in enumerate(["facebook", "Instagram", "fb", "google", None, "meta"]):
        order(conn, t, f"o{i}", date(2026, 3, 5 + i), s)
    order(conn, t, "ad", date(2026, 3, 20), "email", "ad1")          # utm_content is an ad id of the tenant
    order(conn, t, "out", date(2026, 4, 1), "facebook")             # other month
    meta_spend(conn, t, date(2026, 3, 1), 6)
    meta_spend(conn, t, date(2026, 3, 2), 4, ad="ad2")
    order(conn, tenant_b, "b1", date(2026, 3, 5), "facebook")        # other tenant ignored
    assert calibrate.meta_factor(conn, t, "2026-03") == pytest.approx(0.5)   # 5 orders / 10 purchases
    row = conn.execute("SELECT * FROM calibration WHERE tenant_id=%s AND month='2026-03'", (t.tenant_id,)).fetchone()
    assert float(row["meta_factor"]) == pytest.approx(0.5) and row["utm_orders"] == 5
    assert row["meta_purchases"] == 10 and row["capped"] is False
    # upsert, cap low
    for i in range(10, 40):
        order(conn, t, f"x{i}", date(2026, 3, 10), "facebook")
    meta_spend(conn, t, date(2026, 3, 3), 1000, ad="ad3")
    assert calibrate.meta_factor(conn, t, "2026-03") == 0.2
    assert conn.execute("SELECT count(*) AS n FROM calibration").fetchone()["n"] == 1
    assert conn.execute("SELECT capped FROM calibration").fetchone()["capped"] is True
    # cap high, no purchases
    order(conn, t, "may1", date(2026, 5, 2), "facebook")
    order(conn, t, "may2", date(2026, 5, 3), "facebook")
    meta_spend(conn, t, date(2026, 5, 4), 1)
    assert calibrate.meta_factor(conn, t, "2026-05") == 1.5
    assert calibrate.meta_factor(conn, t, "2026-06") == 1.0


def test_lift_scales_a(conn, tenant_a, tenant_b):
    t = tenant_a
    conn.execute("INSERT INTO styles (tenant_id, style_id, name) VALUES (%s,'S1','s1'), (%s,'S2','s2')",
                 (t.tenant_id, t.tenant_id))
    conn.execute("INSERT INTO product_style (tenant_id, product_id, style_id) VALUES (%s,'P1','S1')", (t.tenant_id,))
    conn.commit()
    calibrate.set_lift(conn, t, "S1", 0.5, date(2026, 1, 1))
    calibrate.set_lift(conn, t, "S1", 0.8, date(2026, 2, 1))        # latest wins
    calibrate.set_lift(conn, t, "S1", 0.8, date(2026, 2, 1))        # upsert, no error
    calibrate.set_lift(conn, t, "S1", 0.9, date(2026, 2, 1))
    calibrate.set_lift(conn, tenant_b, "S1", 5.0, date(2026, 3, 1))
    ps = [DemandParams("S1", 10, 4.0, 0.1, -1, level="style"), DemandParams("S2", 10, 4.0, 0.1, -1, level="style")]
    out = calibrate.apply_lift(ps, conn, t)
    assert out[0].a == pytest.approx(3.6) and out[1].a == 4.0 and ps[0].a == 4.0
    pp = [DemandParams("P1", 10, 4.0, 0.1, -1, level="product"), DemandParams("P9", 10, 4.0, 0.1, -1, level="product")]
    out = calibrate.apply_lift(pp, conn, t)
    assert out[0].a == pytest.approx(3.6) and out[1].a == 4.0
