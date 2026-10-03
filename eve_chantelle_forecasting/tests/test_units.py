import datetime as dt
import json

import numpy as np
import pandas as pd
import pytest

from src import db
from src.clean import outliers, stockouts
from src.clean.demand import build_sales_daily, prepare_lines
from src.clean.dims import build_dims, parse_options
from src.common import RunContext, no_hyphen, output_path
from src.config import load_settings, parse_date
from src.evaluate.metrics import nb_quantile
from src.ingest import sync
from src.replenish import po
from src.replenish import safety_stock as ss


@pytest.fixture(scope="module")
def settings():
    return load_settings()


# Text and naming rules ----------------------------------------------------------------------------


def test_no_hyphen():
    assert no_hyphen("Lace Bra - Black – 34B") == "Lace Bra Black 34B"
    assert no_hyphen(5) == 5


def test_output_path_naming(tmp_path):
    p = output_path(tmp_path, "purchase_order", dt.date(2026, 10, 3))
    assert p.relative_to(tmp_path).as_posix() == "2026/10/week_1/purchase_order_2026_10_03.xlsx"
    p = output_path(tmp_path, "purchase_order", dt.date(2026, 10, 16), suffix="color BLACK")
    assert p.name == "purchase_order_2026_10_16_color_black.xlsx" and p.parent.name == "week_3"
    with pytest.raises(ValueError):
        output_path(tmp_path, "made_up_category", dt.date(2026, 10, 3))


def test_parse_date_formats():
    for v in ("2026_03_21", "2026 03 21", "2026/03/21", "2026-03-21"):
        assert parse_date(v) == dt.date(2026, 3, 21)


def test_parse_options_band_cup():
    assert parse_options(json.dumps([{"name": "Color", "value": "Black"}, {"name": "Size", "value": "34b"}])) == ("BLACK", "34B")
    assert parse_options(json.dumps([{"name": "Band", "value": "34"}, {"name": "Cup", "value": "C"}])) == (None, "34C")


# Shopify bulk JSONL parsing -----------------------------------------------------------------------


def test_parse_orders_bulk_rows():
    rows = [
        {"id": "gid://shopify/Order/1", "name": "#1", "processedAt": "2026-01-01T10:00:00Z", "createdAt": "2026-01-01T10:00:00Z",
         "test": False, "tags": ["vip"], "totalPriceSet": {"shopMoney": {"amount": "500.00"}},
         "refunds": [{"id": "gid://shopify/Refund/9", "createdAt": "2026-01-05T10:00:00Z",
                      "refundLineItems": {"edges": [{"node": {"quantity": 1, "restockType": "RETURN",
                                                               "subtotalSet": {"shopMoney": {"amount": "250.00"}},
                                                               "lineItem": {"id": "gid://shopify/LineItem/2"}}}]}}]},
        {"id": "gid://shopify/LineItem/2", "__parentId": "gid://shopify/Order/1", "sku": "A", "quantity": 2,
         "currentQuantity": 1, "variant": {"id": "gid://shopify/ProductVariant/3"},
         "originalUnitPriceSet": {"shopMoney": {"amount": "250.00"}},
         "discountedUnitPriceAfterAllDiscountsSet": {"shopMoney": {"amount": "250.00"}}},
    ]
    o, li, rf = sync.parse_orders(rows)
    assert o.iloc[0]["order_id"] == "1" and o.iloc[0]["tags"] == "vip"
    assert li.iloc[0]["order_id"] == "1" and li.iloc[0]["variant_id"] == "3"
    assert rf.iloc[0]["line_item_id"] == "2" and rf.iloc[0]["quantity"] == 1


# Cleaning ------------------------------------------------------------------------------------------


def _mini_store(con):
    ts = pd.Timestamp("2026-01-10 10:00:00")
    db.upsert(con, "raw_products", pd.DataFrame([{"product_id": "p1", "title": "Bra", "product_type": "Bra",
                                                  "vendor": "BOBO", "tags": "", "status": "ACTIVE", "collections": "Lace",
                                                  "created_at": ts, "published_at": ts, "updated_at": ts}]), ["product_id"])
    db.upsert(con, "raw_variants", pd.DataFrame([{"variant_id": "v1", "product_id": "p1", "sku": "S1", "title": "",
                                                  "options_json": "[]", "price": 100.0, "inventory_item_id": "i1",
                                                  "unit_cost": 40.0, "created_at": ts, "updated_at": ts, "last_seen_at": ts}]),
              ["variant_id"])

    def order(oid, cancelled=False, test=False, tags="", total=100.0):
        return {"order_id": oid, "name": f"#{oid}", "created_at": ts, "processed_at": ts, "updated_at": ts,
                "cancelled_at": ts if cancelled else None, "cancel_reason": "CUSTOMER" if cancelled else None,
                "is_test": test, "tags": tags, "total_price": total}

    db.upsert(con, "raw_orders", pd.DataFrame([order("o1"), order("o2", cancelled=True), order("o3", test=True),
                                               order("o4", tags="Internal", total=0.0), order("o5")]), ["order_id"])

    def line(lid, oid, q, cur=None):
        return {"line_item_id": lid, "order_id": oid, "variant_id": "v1", "sku": "S1", "quantity": q,
                "current_quantity": q if cur is None else cur, "unfulfilled_quantity": 0,
                "original_unit_price": 100.0, "discounted_unit_price": 80.0}

    db.append(con, "raw_line_items", pd.DataFrame([line("l1", "o1", 2), line("l2", "o2", 5), line("l3", "o3", 7),
                                                   line("l4", "o4", 9), line("l5", "o5", 3, cur=2)]))
    db.append(con, "raw_refunds", pd.DataFrame([{"refund_line_id": "r1", "refund_id": "r", "order_id": "o5",
                                                 "line_item_id": "l5", "quantity": 1, "subtotal": 80.0, "created_at": ts}]))


def test_cancelled_test_internal_excluded_returns_counted(tmp_path, settings):
    con = db.connect(tmp_path / "w.duckdb")
    _mini_store(con)
    _, dv = build_dims(con, settings)
    lines, stats = prepare_lines(con, settings, dv)
    sales = build_sales_daily(lines, dt.date(2026, 1, 31))
    assert stats["orders_cancelled"] == 1 and stats["orders_excluded_test_or_internal"] == 2
    row = sales.iloc[0]
    assert row["units_gross"] == 5          # 2 from o1, 3 from o5, cancelled 5 and test 7 and internal 9 are out
    assert row["units_cancelled"] == 5
    assert row["units_returned"] == 1 and row["units_net"] == 4
    assert row["discount_depth"] == pytest.approx(0.2)


def test_outlier_cap_spike_only():
    rng = np.random.default_rng(0)
    obs = rng.poisson(2, size=(1, 200)).astype(float)
    obs[0, 100] = 60
    valid = np.ones_like(obs, dtype=bool)
    promo = np.zeros_like(valid)
    capped, mask, thr = outliers.cap_outliers(obs, valid, promo, 5, 5)
    assert mask[0, 100] and mask.sum() == 1 and capped[0, 100] < 60
    promo[0, 100] = True
    _, mask, _ = outliers.cap_outliers(obs, valid, promo, 5, 5)
    assert mask.sum() == 0                  # promo explains the spike


def test_stockout_detection_and_adjustment():
    T = 120
    obs = np.full((2, T), 3.0)               # two sizes of one product, both selling 3 a day
    obs[0, 80:100] = 0                       # size 0 sells nothing for 20 days while size 1 keeps selling
    valid = np.ones_like(obs, dtype=bool)
    avail = np.full_like(obs, np.nan)
    cfg = {"min_zero_run_days": 7, "zero_run_probability": 0.01, "velocity_window_days": 56, "min_in_stock_days": 28}
    so, src = stockouts.detect(obs, valid, avail, np.array([5.0, 5.0]), np.array([0, 0]), cfg)
    assert so[0, 80:100].all() and not so[1].any() and (src[0, 80:100] == 3).all()
    shares = stockouts.size_shares(obs, valid, so, np.array([0, 0]), 180)
    adj, _ = stockouts.adjust(obs, valid, so, np.array([0, 0]), shares, cfg)
    assert adj[0, 80:100] == pytest.approx(np.full(20, 3.0), rel=0.05)


def test_snapshot_stockout_and_impute_limit():
    T = 200
    obs = np.full((1, T), 2.0)
    obs[0, 50:] = 0
    valid = np.ones_like(obs, dtype=bool)
    avail = np.full_like(obs, np.nan)
    avail[0, 50:] = 0                        # snapshots say out of stock from day 50
    cfg = {"velocity_window_days": 56, "min_in_stock_days": 28, "max_impute_days": 90}
    so, src = stockouts.detect(obs, valid, avail, np.array([0.0]), np.array([0]), cfg)
    assert so[0, 50:].all() and (src[0, 50:] == 1).all()
    adj, _ = stockouts.adjust(obs, valid, so, np.array([0]), np.array([1.0]), cfg)
    assert adj[0, 50:140] == pytest.approx(np.full(90, 2.0))
    assert (adj[0, 140:] == 0).all()         # no imputation after 90 days in the same run


# Replenishment math --------------------------------------------------------------------------------


@pytest.mark.parametrize("qty,pack,moq,expected", [(0, 6, 6, 0), (1, 6, 6, 6), (6, 6, 6, 6), (6.2, 6, 6, 12),
                                                   (3, 6, 12, 12), (13, 6, 12, 18), (5, 1, 0, 5), (4, 6, 8, 12)])
def test_round_to_pack(qty, pack, moq, expected):
    assert ss.round_to_pack(qty, pack, moq) == expected


def test_safety_stock_grows_with_service_level():
    rop90, ss90 = ss.reorder_point(np.array([20.0]), np.array([2.0]), np.array([0.1]), np.array([0.90]))
    rop95, ss95 = ss.reorder_point(np.array([20.0]), np.array([2.0]), np.array([0.1]), np.array([0.95]))
    assert rop95[0] >= rop90[0] > 20 and ss95[0] >= ss90[0] > 0
    # the reorder point is the service level quantile of lead time demand
    assert nb_quantile(20.0, 2.0 * 20 + (0.1 * 20) ** 2, 0.95) == rop95[0]


def test_order_quantity():
    assert ss.order_quantity(position=12, rop=11, target=20, pack=6, moq=6) == (0, 0.0)
    q, raw = ss.order_quantity(position=6, rop=11, target=14.2, pack=6, moq=6)
    assert raw == pytest.approx(8.2) and q == 12
    q, _ = ss.order_quantity(position=-2, rop=22, target=29.2, pack=6, moq=6)
    assert q == 36                           # negative position (oversold) is part of the need


def test_abc_xyz_service_levels(settings):
    abc = ss.abc(np.array([800, 100, 60, 40, 0]))
    assert list(abc) == ["A", "B", "B", "C", "C"]
    xyz = ss.xyz(np.array([0.2, 0.5, 0.9, np.nan]))
    assert list(xyz) == ["X", "Y", "Z", "Z"]
    sl = ss.service_level(["A", "C"], ["X", "Z"], settings["replenishment"]["service_levels"])
    assert list(sl) == [0.95, 0.80]


def test_po_filters():
    f = po.parse_filters(["filter", "color", "BLACK", "supplier", "BOBO,Elassal"])
    assert f == {"color": ["BLACK"], "supplier": ["BOBO", "Elassal"]}
    df = pd.DataFrame({"color": ["BLACK", "RED", "BLACK"], "supplier": ["BOBO", "BOBO", "Other"]})
    assert len(po.apply_filters(df, f)) == 1
    with pytest.raises(ValueError):
        po.parse_filters(["colour", "BLACK"])


def test_run_context_plan_and_proposal(tmp_path, settings):
    ctx = RunContext("forecast", settings, tmp_path / "w.duckdb", tmp_path / "out", tmp_path / "logs")
    ctx.plan("forecast all SKUs - test")
    ctx.propose("service level", 0.9, 0.95, "p90 misses - often")
    log = (tmp_path / "logs" / f"{ctx.run_id}.log").read_text()
    assert "PLAN" in log and "-" not in log.split("\n", 1)[0][20:]
    assert ctx.proposals[0]["reason"] == "p90 misses often"
