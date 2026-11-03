import math

import pytest

from engine.model import DemandParams, predict
from engine.planner import forecast, spend_at_marginal_poas, steady_marginal_poas

COLS = ["period", "spend", "views", "units", "lost_stock", "lost_price", "true_demand", "revenue", "profit",
        "roas", "poas", "marginal_poas", "missing_cost"]


def P(**kw):
    d = dict(entity_id="x", baseline_v=100.0, a=20.0, cr_ref=0.05, e=-1.0, ref_price=100.0, level="style")
    d.update(kw)
    return DemandParams(**d)


def test_default_horizons():
    p = P()
    for grain, n in (("day", 30), ("week", 12), ("month", 6)):
        df = forecast(p, 100, 100, 1.0, grain)
        assert len(df) == n and list(df["period"]) == list(range(n))
    assert len(forecast(p, 100, 100, 1.0, "day", 5)) == 5
    assert list(forecast(p, 100, 100, 1.0, "day", 3).columns) == COLS


def test_zero_budget_baseline():
    p = P()
    df = forecast(p, 0, 100, 1.0, "week", unit_cost=40)
    base = predict(p, 0.0, 100, 1.0)
    assert all(df["units"] == pytest.approx(base["units"]))
    assert all(df["spend"] == 0) and all(r is None for r in df["roas"]) and all(r is None for r in df["poas"])
    assert df["profit"].iloc[0] == pytest.approx(base["units"] * 60)
    # carry over from earlier spend lifts the first periods
    df2 = forecast(p, 0, 100, 1.0, "week", unit_cost=40, adstock0=500)
    assert df2["units"].iloc[0] > df2["units"].iloc[1] > df2["units"].iloc[-1] >= df["units"].iloc[0]


def test_forecast_values_and_plans():
    p = P(seasonal={"promo": 30.0})
    df = forecast(p, [100, 0, 50], [100, 90, 80], [1.0, 0.5, 1.0], "day", 3, unit_cost=40,
                  flags_plan=[None, {"promo": 1}, None])
    a1 = 100.0
    r0 = predict(p, a1, 100, 1.0)
    assert df["units"].iloc[0] == pytest.approx(r0["units"])
    assert df["revenue"].iloc[0] == pytest.approx(r0["units"] * 100)
    assert df["roas"].iloc[0] == pytest.approx(df["revenue"].iloc[0] / 100)
    assert df["poas"].iloc[0] == pytest.approx(r0["units"] * 60 / 100)
    assert df["profit"].iloc[0] == pytest.approx(r0["units"] * 60 - 100)
    r1 = predict(p, 60.0, 90, 0.5, {"promo": 1})                       # decay 0.6 for day
    assert df["units"].iloc[1] == pytest.approx(r1["units"]) and df["lost_stock"].iloc[1] == pytest.approx(r1["lost_stock"])
    assert df["spend"].iloc[2] == 50


def test_marginal_poas_decreasing():
    df = forecast(P(), [100, 400, 1600, 6400], 100, 1.0, "month", 4, unit_cost=40)
    m = list(df["marginal_poas"])
    assert all(x > 0 for x in m) and m == sorted(m, reverse=True) and m[0] > m[-1]


def test_marginal_poas_includes_carryover():
    # last period has no future carry; same spend earlier has higher marginal value
    df = forecast(P(), 100, 100, 1.0, "week", 4, unit_cost=40)
    m = list(df["marginal_poas"])
    assert m[0] > m[-1]


def test_missing_cost_flag_and_no_nan():
    df = forecast(P(), 100, 100, 1.0, "week", 3)
    assert all(df["missing_cost"]) and all(x is None for x in df["profit"]) and all(x is None for x in df["poas"])
    assert all(x is None for x in df["marginal_poas"]) and all(df["roas"] > 0)
    df = forecast(P(), 0, 100, 1.0, "week", 3, unit_cost=40)
    assert not any(df["missing_cost"])
    for c in df.columns:
        for v in df[c]:
            assert v is None or not (isinstance(v, float) and (math.isnan(v) or math.isinf(v)))


def test_fallback_params_forecast():
    p = P(fallback=True, cr_ref=0.0, e=0.0)
    df = forecast(p, 100, 100, 0.5, "week", 2, unit_cost=40)
    assert all(v is None for v in df["views"]) and df["units"].iloc[0] > 0


def test_spend_at_marginal_one():
    p, price, cost, decay = P(), 100.0, 40.0, 0.3
    s = spend_at_marginal_poas(p, price, cost, 1.0, decay)
    m = p.cr_ref * (price / p.ref_price) ** p.e * (price - cost)
    assert s == pytest.approx(p.a * m - (1 - decay))
    # check numerically against steady state gross profit derivative
    def gp(x):
        u = (p.baseline_v + p.a * math.log1p(x / (1 - decay))) * p.cr_ref * (price / p.ref_price) ** p.e
        return u * (price - cost)
    h = 1e-4
    assert (gp(s + h) - gp(s - h)) / (2 * h) == pytest.approx(1.0, rel=1e-3)
    assert spend_at_marginal_poas(p, price, cost, 1.0, decay, target=2.0) < s


def test_steady_marginal_poas_matches_optimal_spend():
    p, price, cost, decay = P(), 100.0, 40.0, 0.3
    s = spend_at_marginal_poas(p, price, cost, 1.0, decay, target=1.5)
    assert steady_marginal_poas(p, s, price, cost, 1.0, decay) == pytest.approx(1.5)
    m = p.cr_ref * (price / p.ref_price) ** p.e * price
    assert steady_marginal_poas(p, 50.0, price, None, 1.0, decay) == pytest.approx(p.a * m / (0.7 + 50.0))
    assert steady_marginal_poas(P(a=0.0), 50.0, price, cost, 1.0, decay) == 0.0
    assert steady_marginal_poas(p, float("nan"), None, None, None, decay) == 0.0


def test_lower_availability_lowers_optimal_spend():
    p = P()
    assert spend_at_marginal_poas(p, 100, 40, 0.5, 0.3) < spend_at_marginal_poas(p, 100, 40, 1.0, 0.3)
    assert spend_at_marginal_poas(p, 100, 40, 0.0, 0.3) == 0.0


def test_missing_cost_uses_roas_3():
    p, decay = P(), 0.3
    s = spend_at_marginal_poas(p, 100, None, 1.0, decay)
    m = p.cr_ref * 100.0
    assert s == pytest.approx(p.a * m / 3.0 - (1 - decay))
    assert s > 0


def test_planner_edge_cases():
    p = P()
    assert spend_at_marginal_poas(p, 40, 40, 1.0, 0.3) == 0.0
    assert spend_at_marginal_poas(p, 30, 40, 1.0, 0.3) == 0.0
    assert spend_at_marginal_poas(P(a=0.0), 100, 40, 1.0, 0.3) == 0.0
    fb = P(fallback=True, cr_ref=0.0)
    assert spend_at_marginal_poas(fb, 100, 40, 1.0, 0.3) == pytest.approx(max(0.0, fb.a * 60 - 0.7))
