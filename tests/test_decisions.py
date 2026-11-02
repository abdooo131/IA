import math
from dataclasses import asdict
from datetime import date, timedelta

import pytest
from psycopg.types.json import Jsonb

from engine import decisions
from engine.model import DemandParams

AS_OF = date(2026, 10, 31)
LOC = "gid://shopify/Location/222"


# ---------------------------------------------------------------- pure rule tests

def row(**kw):
    """A healthy entity that matches no rule but MAINTAIN."""
    base = {"entity_id": "S1", "usable_periods": 24, "first_sale_date": date(2024, 1, 1), "as_of": AS_OF,
            "poas": 1.2, "marginal_poas": 1.2, "roas": 4.0, "marginal_roas": 3.5, "size_availability": 0.95,
            "lost_stock": 0.0, "lost_price": 0.0, "true_demand": 100.0, "stock_cover_days": 90.0,
            "paid_cac": 200.0, "customer_value_12m": 250.0, "flags": []}
    base.update(kw)
    return base


KILLABLE = dict(poas=0.5, marginal_poas=0.4, size_availability=0.9, customer_value_12m=100.0, paid_cac=300.0)


def test_rule_test():
    d, rule = decisions.decide(row(usable_periods=5), [], 30)
    assert d == "TEST" and "5 usable periods < 12" in rule
    d, rule = decisions.decide(row(first_sale_date=AS_OF - timedelta(days=30)), [], 30)
    assert d == "TEST" and "30 days" in rule


def test_rule_restock_first():
    d, rule = decisions.decide(row(marginal_poas=2.0, stock_cover_days=10.0), [], 30)
    assert d == "RESTOCK FIRST" and "2.00 >= 1.5" in rule and "10.0 days < lead time 30" in rule
    d, rule = decisions.decide(row(lost_stock=30.0), [], 30)
    assert d == "RESTOCK FIRST" and "lost_stock 30.0 > 20% of true_demand 100.0" in rule
    assert decisions.decide(row(marginal_poas=2.0, stock_cover_days=40.0), [], 30)[0] == "SCALE"


def test_rule_fix_price():
    d, rule = decisions.decide(row(lost_price=25.0), [], 30)
    assert d == "FIX PRICE" and "lost_price 25.0 > 20% of true_demand 100.0" in rule
    assert decisions.decide(row(lost_price=25.0, size_availability=0.7), [], 30)[0] == "MAINTAIN"


def test_rule_scale():
    d, rule = decisions.decide(row(marginal_poas=1.6), [], 30)
    assert d == "SCALE" and "marginal POAS 1.60 >= 1.5" in rule


def test_rule_kill():
    d, rule = decisions.decide(row(**KILLABLE), [row(**KILLABLE)], 30)
    assert d == "KILL"
    assert "POAS 0.50" in rule and "customer value 12m 100.00 < paid CAC 300.00" in rule
    assert decisions.decide(row(**KILLABLE), [], 30)[0] == "CUT SPEND"     # needs two months


def test_rule_cut_spend():
    d, rule = decisions.decide(row(marginal_poas=0.8, poas=1.1), [], 30)
    assert d == "CUT SPEND" and "marginal POAS 0.80 < 1" in rule


def test_rule_maintain():
    d, rule = decisions.decide(row(), [row()], 30)
    assert d == "MAINTAIN" and rule.startswith("MAINTAIN")


def test_price_problem_is_fix_price():
    bad = dict(KILLABLE, lost_price=40.0)
    d, rule = decisions.decide(row(**bad), [row(**bad)], 30)
    assert d == "FIX PRICE"


def test_entry_product_with_high_value_is_scale():
    r = row(poas=0.8, marginal_poas=1.1, paid_cac=300.0, customer_value_12m=600.0)
    d, rule = decisions.decide(r, [row(poas=0.8, marginal_poas=0.9)], 30)
    assert d == "SCALE"
    assert "paid CAC 300.00 <= customer value 12m 600.00 / 1.5" in rule


def test_kill_requires_low_customer_value():
    assert decisions.decide(row(**KILLABLE), [row(**KILLABLE)], 30)[0] == "KILL"
    loyal = dict(KILLABLE, customer_value_12m=400.0)
    assert decisions.decide(row(**loyal), [row(**loyal)], 30)[0] == "CUT SPEND"
    unknown = dict(KILLABLE, customer_value_12m=None)
    assert decisions.decide(row(**unknown), [row(**unknown)], 30)[0] == "CUT SPEND"
    sold_out_last_month = dict(KILLABLE, size_availability=0.7)
    assert decisions.decide(row(**KILLABLE), [row(**sold_out_last_month)], 30)[0] == "CUT SPEND"


def test_none_inputs_never_crash():
    empty = {k: None for k in row()}
    assert decisions.decide(empty, [empty], None)[0] == "MAINTAIN"
    assert decisions.decide(row(poas=float("nan"), marginal_poas=None), [], 30)[0] == "MAINTAIN"


def test_missing_cost_rules():
    miss = dict(poas=None, marginal_poas=None, flags=["missing_cost"])
    d, rule = decisions.decide(row(roas=3.5, **miss), [], 30)
    assert d == "SCALE" and "ROAS 3.50 >= 3" in rule and "missing cost" in rule
    killable = dict(KILLABLE, poas=None, marginal_poas=None, roas=1.0, marginal_roas=2.0, flags=["missing_cost"])
    d, rule = decisions.decide(row(**killable), [row(**killable)], 30)
    assert d == "CUT SPEND" and "marginal ROAS 2.00 < 3" in rule
    assert decisions.decide(row(lost_stock=50.0, **miss), [], 30)[0] == "RESTOCK FIRST"


# ---------------------------------------------------------------- DB helpers

def days(start, end):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def product(conn, t, pid, style, sizes, cost=400.0):
    conn.execute("INSERT INTO styles (tenant_id, style_id, name) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                 (t.tenant_id, style, style))
    for s in sizes:
        conn.execute("INSERT INTO products (tenant_id, variant_id, product_id, handle, title, size, unit_cost, status)"
                     " VALUES (%s,%s,%s,%s,%s,%s,%s,'ACTIVE')",
                     (t.tenant_id, f"{pid}-{s}", pid, pid.lower(), pid, s, cost))
    conn.execute("INSERT INTO product_style (tenant_id, product_id, style_id, colour) VALUES (%s,%s,%s,'Red')",
                 (t.tenant_id, pid, style))


def sales(conn, t, vid, ds, qty, price=500.0):
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO sales_lines (tenant_id, order_id, date, variant_id, qty, line_value)"
                        " VALUES (%s,%s,%s,%s,%s,%s)",
                        [(t.tenant_id, f"{vid}-{d}", d, vid, qty, qty * price) for d in ds])


def stock(conn, t, vid, avail_by_day):
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO stock_daily (tenant_id, date, variant_id, location_id, available, on_hand)"
                        " VALUES (%s,%s,%s,%s,%s,%s)",
                        [(t.tenant_id, d, vid, LOC, a, max(a, 0)) for d, a in avail_by_day.items()])


def spend(conn, t, pid, ds, per_day, impressions=10000.0):
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO spend_by_product (tenant_id, date, product_id, method, spend, impressions)"
                        " VALUES (%s,%s,%s,'name',%s,%s)", [(t.tenant_id, d, pid, per_day, impressions) for d in ds])


def params(conn, t, run, entity, level, baseline, a=0.0, grain="month", fallback=True, cr_ref=1.0, ref_price=500.0):
    p = DemandParams(entity, baseline_v=baseline, a=a, cr_ref=cr_ref, e=0.0, fallback=fallback,
                     ref_price=ref_price, level=level, grain=grain, n_periods=20)
    conn.execute("INSERT INTO model_params (tenant_id, run_id, entity_id, params) VALUES (%s,%s,%s,%s)",
                 (t.tenant_id, run, entity, Jsonb(asdict(p))))


def supplier(conn, t, lead, style=None, product_id=None):
    sid = conn.execute("INSERT INTO suppliers (tenant_id, name, kind, lead_time_days) VALUES (%s,%s,'factory',%s)"
                       " RETURNING supplier_id", (t.tenant_id, f"F{lead}{style}{product_id}", lead)).fetchone()["supplier_id"]
    conn.execute("INSERT INTO product_suppliers (tenant_id, supplier_id, style_id, product_id) VALUES (%s,%s,%s,%s)",
                 (t.tenant_id, sid, style, product_id))


def no_nan(df):
    for r in df.to_dict("records"):
        for k, v in r.items():
            assert not (isinstance(v, float) and math.isnan(v)), k


# ---------------------------------------------------------------- DB tests

def test_sold_out_sizes_not_kill(conn, tenant_a, tenant_b):
    """14 months of history; size M sells out for the last two months while ads keep running at a loss."""
    t = tenant_a
    d0, cut, end = date(2025, 9, 1), date(2026, 9, 1), date(2026, 10, 31)
    product(conn, t, "P1", "S1", ["S", "M"])
    sales(conn, t, "P1-S", days(d0, end), 2)
    sales(conn, t, "P1-M", days(d0, cut - timedelta(days=1)), 2)
    stock(conn, t, "P1-S", {d0: 50})
    stock(conn, t, "P1-M", {d0: 50, cut: 0})
    spend(conn, t, "P1", days(d0, end), 300.0)
    supplier(conn, t, 30, style="S1")
    params(conn, t, "r1", "S1", "style", baseline=124.0)      # 4 units/day at full availability
    params(conn, t, "r1", "P1", "product", baseline=124.0)
    conn.commit()

    sc = decisions.scorecard(conn, t, "2026-10", "style", "r1")
    no_nan(sc)
    r = sc.set_index("entity_id").loc["S1"]
    assert r["size_availability"] == pytest.approx(0.5, abs=0.01)
    assert r["units"] == 62
    assert r["lost_stock"] == pytest.approx(62.0, rel=0.02)
    assert r["true_demand"] == pytest.approx(124.0, rel=0.02)
    assert r["poas"] == pytest.approx(62 * 100 / 9300)                   # < 1
    assert r["cpm"] == pytest.approx(30.0)
    assert r["usable_periods"] == 14 and r["first_sale_date"] == d0
    d, rule = decisions.decide(r.to_dict(), [r.to_dict()], 30)
    assert d == "RESTOCK FIRST" and "lost_stock" in rule
    # the same economics with every size in stock and low customer value would be killed
    healthy = dict(r.to_dict(), size_availability=0.9, lost_stock=0.0, customer_value_12m=10.0, paid_cac=300.0,
                   marginal_poas=0.2)
    assert decisions.decide(healthy, [healthy], 30)[0] == "KILL"

    out = decisions.run_decisions(conn, t, "r1", "2026-10")
    assert set(zip(out["level"], out["entity_id"], out["decision"])) == {
        ("style", "S1", "RESTOCK FIRST"), ("product", "P1", "RESTOCK FIRST")}
    decisions.run_decisions(conn, t, "r1", "2026-10")                    # idempotent
    stored = conn.execute("SELECT * FROM decisions WHERE tenant_id = %s ORDER BY level", (t.tenant_id,)).fetchall()
    assert len(stored) == 2
    assert stored[1]["numbers"]["poas"] == pytest.approx(62 * 100 / 9300)
    assert stored[1]["numbers"]["first_sale_date"] == "2025-09-01"
    assert stored[1]["rule"].startswith("RESTOCK FIRST")
    assert decisions.run_decisions(conn, tenant_b, "r1", "2026-10").empty
    assert conn.execute("SELECT count(*) AS n FROM decisions WHERE tenant_id = %s",
                        (tenant_b.tenant_id,)).fetchone()["n"] == 0


def test_lineage_history_counts_for_test_rule(conn, tenant_a):
    t = tenant_a
    product(conn, t, "OLD", "S2", ["S"])
    product(conn, t, "NEW", "S2", ["S"])
    sales(conn, t, "OLD-S", days(date(2024, 10, 1), date(2026, 9, 30)), 1)
    sales(conn, t, "NEW-S", days(date(2026, 10, 1), date(2026, 10, 31)), 1)
    conn.commit()

    sc = decisions.scorecard(conn, t, "2026-10", "product").set_index("entity_id")
    assert sc.loc["NEW", "usable_periods"] == 1
    assert decisions.decide(sc.loc["NEW"].to_dict(), [], 30)[0] == "TEST"   # own history: one month

    conn.execute("INSERT INTO variant_lineage (tenant_id, old_variant_id, new_variant_id, effective_date, method,"
                 " confirmed) VALUES (%s,'OLD-S','NEW-S','2026-10-01','title',true)", (t.tenant_id,))
    conn.commit()
    sc = decisions.scorecard(conn, t, "2026-10", "product")
    assert list(sc["entity_id"]) == ["NEW"]                               # OLD's sales now belong to NEW
    r = sc.set_index("entity_id").loc["NEW"].to_dict()
    assert r["usable_periods"] == 25
    assert r["first_sale_date"] == date(2024, 10, 1)
    assert "no_params" in r["flags"]
    assert decisions.decide(r, [], 30)[0] != "TEST"


def test_missing_cost_flag(conn, tenant_a):
    t = tenant_a
    d0, end = date(2025, 6, 1), date(2026, 10, 31)
    product(conn, t, "P3", "S3", ["S"], cost=None)
    sales(conn, t, "P3-S", days(d0, end), 2)
    spend(conn, t, "P3", days(d0, end), 100.0)
    params(conn, t, "r1", "P3", "product", baseline=40.0, a=5.0)
    conn.commit()

    sc = decisions.scorecard(conn, t, "2026-10", "product", "r1")
    no_nan(sc)
    r = sc.iloc[0].to_dict()
    assert r["gross_profit"] is None and r["poas"] is None and r["marginal_poas"] is None
    assert "missing_cost" in r["flags"]
    assert r["roas"] == pytest.approx(62 * 500 / 3100)                    # 10
    # steady state marginal ROAS: a * price / ((1 - 0.1) + monthly spend)
    assert r["marginal_roas"] == pytest.approx(5.0 * 500 / (0.9 + 3100))
    d, rule = decisions.decide(r, [r], 30)
    assert d == "SCALE" and "missing cost" in rule


def test_plan_capped_by_stock(conn, tenant_a):
    t = tenant_a
    product(conn, t, "P1", "S1", ["S", "M"], cost=200.0)
    product(conn, t, "P9", "S9", ["S"], cost=200.0)
    for v in ("P1-S", "P1-M", "P9-S"):
        sales(conn, t, v, days(date(2026, 9, 1), date(2026, 10, 31)), 1)
    stock(conn, t, "P1-S", {date(2026, 10, 31): 3})
    stock(conn, t, "P1-M", {date(2026, 10, 31): 2})
    stock(conn, t, "P9-S", {date(2026, 10, 31): 1000})
    # 5 on order (approved, nothing received yet); 5 suggested in this run's draft
    conn.execute("INSERT INTO purchase_orders (tenant_id, po_number, state) VALUES (%s,'APO0','approved')", (t.tenant_id,))
    conn.execute("INSERT INTO po_lines (tenant_id, po_number, variant_id, qty_suggested, qty_approved)"
                 " VALUES (%s,'APO0','P1-M',5,5)", (t.tenant_id,))
    conn.execute("INSERT INTO purchase_orders (tenant_id, po_number, state, run_id) VALUES (%s,'APO1','draft','r1')",
                 (t.tenant_id,))
    conn.execute("INSERT INTO po_lines (tenant_id, po_number, variant_id, qty_suggested) VALUES (%s,'APO1','P1-S',5)",
                 (t.tenant_id,))
    params(conn, t, "r1", "S1", "style", baseline=5.0, a=2.0)           # units = 5 + 2 ln(1 + adstock)
    params(conn, t, "r1", "S9", "style", baseline=1.0, a=2.0)
    conn.execute("INSERT INTO decisions (tenant_id, run_id, month, level, entity_id, decision)"
                 " VALUES (%s,'r1','2026-10-01','style','S9','KILL')", (t.tenant_id,))
    conn.commit()

    plan = decisions.forward_plan(conn, t, "r1")
    no_nan(plan)
    s1 = plan[plan["entity_id"] == "S1"].reset_index(drop=True)
    assert list(s1["month"]) == ["2026-11", "2026-12", "2027-01"]
    assert (s1["supply"] == 15).all()
    assert s1["units"].sum() <= 15 + 1e-6
    # uncapped: spend 2 * 300 - 0.9 = 599.1 gives 17.8 units > 15, so month 1 spend is cut to e^5 - 1
    assert s1.loc[0, "units"] == pytest.approx(15.0, abs=1e-3)
    assert s1.loc[0, "spend"] == pytest.approx(math.exp(5) - 1, rel=1e-3)
    assert s1.loc[0, "profit"] == pytest.approx(15 * 300 - s1.loc[0, "spend"], rel=1e-6)
    assert list(s1.loc[1:, "spend"]) == [0.0, 0.0] and list(s1.loc[1:, "units"]) == [0.0, 0.0]
    assert (s1.loc[1:, "true_demand"] > 0).all() and s1["capped"].all()
    assert (s1["po_number"] == "APO1").all()
    s9 = plan[plan["entity_id"] == "S9"]
    assert (s9["spend"] == 0).all() and (s9["decision"] == "KILL").all() and s9["po_number"].isna().all()

    decisions.forward_plan(conn, t, "r1")                                # idempotent
    rows = conn.execute("SELECT * FROM product_plans WHERE tenant_id = %s AND entity_id = 'S1' ORDER BY month",
                        (t.tenant_id,)).fetchall()
    assert len(rows) == 3 and rows[0]["month"] == date(2026, 11, 1) and rows[0]["po_number"] == "APO1"
    assert float(rows[0]["units"]) == pytest.approx(15.0, abs=1e-3)
    fc = conn.execute("SELECT * FROM forecasts WHERE tenant_id = %s AND entity_id = 'S1' ORDER BY period",
                      (t.tenant_id,)).fetchall()
    assert len(fc) == 3 and fc[0]["grain"] == "month" and fc[0]["params"]["level"] == "style"
    assert fc[0]["params"]["units"] == pytest.approx(15.0, abs=1e-3)


def test_plan_baseline_above_supply(conn, tenant_a):
    t = tenant_a
    product(conn, t, "P1", "S1", ["S"], cost=200.0)
    sales(conn, t, "P1-S", days(date(2026, 10, 1), date(2026, 10, 31)), 1)
    stock(conn, t, "P1-S", {date(2026, 10, 31): 4})
    params(conn, t, "r1", "S1", "style", baseline=30.0, a=2.0)
    conn.commit()
    s1 = decisions.forward_plan(conn, t, "r1", months=2)
    assert list(s1["spend"]) == [0.0, 0.0]
    assert list(s1["units"]) == [pytest.approx(4.0), 0.0]
    assert s1.loc[0, "true_demand"] == pytest.approx(30.0)
    assert s1["po_number"].isna().all()
