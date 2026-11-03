import json
from decimal import Decimal

import pytest

from engine import ingest_meta


@pytest.fixture
def meta(fake_clients, monkeypatch):
    fake_clients.patch(monkeypatch, "engine.ingest_meta")
    return fake_clients.meta


def ad(day, ad_id, **kw):
    r = {"campaign_id": "c1", "campaign_name": "C", "adset_id": "s1", "ad_id": ad_id,
         "ad_name": f"P_{ad_id}", "date_start": day, "date_stop": day}
    r.update(kw)
    return r


def rows(conn, table, order="date, ad_id"):
    return conn.execute(f"SELECT * FROM {table} ORDER BY {order}").fetchall()


def empty(meta, acct):
    meta.respond(f"act_{acct}/insights", {"data": []})


def test_purchases_from_actions():
    f = ingest_meta.purchases_from_actions
    both = [{"action_type": "purchase", "value": "3"}, {"action_type": "omni_purchase", "value": "4"},
            {"action_type": "offsite_conversion.fb_pixel_purchase", "value": "3"}]
    assert f(both) == 4
    assert f([{"action_type": "purchase", "value": "3"},
              {"action_type": "offsite_conversion.fb_pixel_purchase", "value": "9"}]) == 3
    assert f([{"action_type": "offsite_conversion.fb_pixel_purchase", "value": "2"},
              {"action_type": "link_click", "value": "50"}]) == 2
    assert f([{"action_type": "link_click", "value": "50"}]) == 0
    assert f(None) == 0


def test_impressions_stored(conn, tenant_a, meta):
    meta.respond("act_496801511811310/insights", {"data": [
        ad("2026-10-01", "a1", spend="10.50", impressions="1234", clicks="20",
           actions=[{"action_type": "omni_purchase", "value": "2"}])]})
    assert ingest_meta.ingest_spend(conn, tenant_a, "2026-10-01", "2026-10-01") == (1, 1)
    r = rows(conn, "ad_spend_daily")[0]
    assert (r["impressions"], r["clicks"], r["spend"], r["purchases"]) == (1234, 20, Decimal("10.50"), 2)
    assert r["account_id"] == "496801511811310" and str(r["date"]) == "2026-10-01"
    c = rows(conn, "catalog_spend_daily")  # catalog call hits the same fixture, no product_id
    assert c[0]["impressions"] == 1234 and c[0]["catalog_product_id"] == ""


def test_catalog_rows_and_params(conn, tenant_a, meta):
    seen = []

    def resp(params):
        seen.append(params)
        if "breakdowns" in params:
            return {"data": [ad("2026-10-01", "a1", product_id="P1", spend="4", impressions="100",
                                actions=[{"action_type": "purchase", "value": "1"}]),
                             ad("2026-10-01", "a1", product_id="P2", spend="6", impressions="200")]}
        return {"data": [ad("2026-10-01", "a1", spend="10", impressions="300")]}

    meta.respond("act_496801511811310/insights", resp)
    assert ingest_meta.ingest_spend(conn, tenant_a, "2026-10-01", "2026-10-02") == (1, 2)
    c = rows(conn, "catalog_spend_daily", "catalog_product_id")
    assert [(x["catalog_product_id"], x["spend"], x["impressions"], x["purchases"]) for x in c] == [
        ("P1", 4, 100, 1), ("P2", 6, 200, 0)]
    p = seen[0]
    assert p["level"] == "ad" and p["time_increment"] == 1 and p["limit"] == 500
    assert json.loads(p["time_range"]) == {"since": "2026-10-01", "until": "2026-10-02"}
    assert "actions" in p["fields"] and seen[1]["breakdowns"] == "product_id"


def test_all_tenant_accounts_ingested(conn, tenant_a, meta):
    from dataclasses import replace
    t = replace(tenant_a, meta_account_ids=["496801511811310", "act_1222339613363462"])
    meta.respond("act_496801511811310/insights", {"data": [ad("2026-10-01", "a1", spend="1")]})
    meta.respond("act_1222339613363462/insights", {"data": [ad("2026-10-01", "b1", spend="2")]})
    assert ingest_meta.ingest_spend(conn, t, "2026-10-01", "2026-10-01") == (2, 2)
    assert {(r["account_id"], r["ad_id"]) for r in rows(conn, "ad_spend_daily")} == {
        ("496801511811310", "a1"), ("1222339613363462", "b1")}
    # idempotent re run
    assert ingest_meta.ingest_spend(conn, t, "2026-10-01", "2026-10-01") == (2, 2)
    assert len(rows(conn, "ad_spend_daily")) == 2 and len(rows(conn, "catalog_spend_daily")) == 2


def test_rerun_updates_values(conn, tenant_a, meta):
    meta.respond("act_496801511811310/insights", {"data": [ad("2026-10-01", "a1", spend="1")]})
    ingest_meta.ingest_spend(conn, tenant_a, "2026-10-01", "2026-10-01")
    meta.respond("act_496801511811310/insights", {"data": [ad("2026-10-01", "a1", spend="5")]})
    ingest_meta.ingest_spend(conn, tenant_a, "2026-10-01", "2026-10-01")
    assert [r["spend"] for r in rows(conn, "ad_spend_daily")] == [5]


def test_pagination(tenant_a, meta):
    def resp(params):
        if params.get("after") == "CUR1":
            return {"data": [ad("2026-10-02", "a2", spend="2")], "paging": {"cursors": {"after": "CUR2"}}}
        return {"data": [ad("2026-10-01", "a1", spend="1")],
                "paging": {"cursors": {"after": "CUR1"}, "next": "https://graph/next"}}

    meta.respond("act_496801511811310/insights", resp)
    out = ingest_meta.fetch_ad_insights(tenant_a, "496801511811310", "2026-10-01", "2026-10-02")
    assert [r["ad_id"] for r in out] == ["a1", "a2"]
    assert [c[1].get("after") for c in meta.calls] == [None, "CUR1"]
    assert all(c[0] == "act_496801511811310/insights" for c in meta.calls)


def test_missing_spend_zero(conn, tenant_a, meta):
    meta.respond("act_496801511811310/insights", {"data": [ad("2026-10-01", "a1")]})
    ingest_meta.ingest_spend(conn, tenant_a, "2026-10-01", "2026-10-01")
    r = rows(conn, "ad_spend_daily")[0]
    assert (r["spend"], r["impressions"], r["clicks"], r["purchases"]) == (0, 0, 0, 0)


def test_history_requested_month_by_month(tenant_a, meta):
    """I8: a long range is requested one calendar month at a time."""
    meta.respond("act_496801511811310/insights", lambda params: {"data": [
        ad(json.loads(params["time_range"])["since"], "a1", spend="1")]})
    out = ingest_meta.fetch_ad_insights(tenant_a, "496801511811310", "2026-01-15", "2026-03-10")
    ranges = [json.loads(c[1]["time_range"]) for c in meta.calls]
    assert ranges == [{"since": "2026-01-15", "until": "2026-01-31"}, {"since": "2026-02-01", "until": "2026-02-28"},
                      {"since": "2026-03-01", "until": "2026-03-10"}]
    assert [r["date_start"] for r in out] == ["2026-01-15", "2026-02-01", "2026-03-01"]
