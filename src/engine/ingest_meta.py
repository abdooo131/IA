"""Meta ingest: daily ad level and catalog (product_id breakdown) spend, impressions, purchases.

Dates are stored exactly as Meta returns them (date_start, in the ad account's timezone).
"""
from __future__ import annotations

import json
from collections import defaultdict
from decimal import Decimal

from .tenants import Tenant, meta_client, shopify_client  # noqa: F401  (names patched by tests)

AD_FIELDS = "campaign_id,campaign_name,adset_id,ad_id,ad_name,spend,impressions,clicks,actions,date_start"
# One action type only, to avoid double counting (omni_purchase already includes the others).
PURCHASE_ACTIONS = ("omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase")


def _act(account_id) -> str:
    return "act_" + str(account_id).removeprefix("act_")


def purchases_from_actions(actions) -> Decimal:
    by_type = {}
    for a in actions or []:
        by_type[a.get("action_type")] = by_type.get(a.get("action_type"), Decimal(0)) + Decimal(str(a.get("value") or 0))
    for k in PURCHASE_ACTIONS:
        if k in by_type:
            return by_type[k]
    return Decimal(0)


def _fetch(t: Tenant, account_id, since, until, extra: dict) -> list[dict]:
    client = meta_client(t)
    path = f"{_act(account_id)}/insights"
    params = {
        "level": "ad", "time_increment": 1, "fields": AD_FIELDS, "limit": 500,
        "time_range": json.dumps({"since": str(since), "until": str(until)}), **extra,
    }
    rows = []
    while True:
        page = client.get(path, params)
        rows.extend(page.get("data") or [])
        after = ((page.get("paging") or {}).get("cursors") or {}).get("after")
        if not (page.get("paging") or {}).get("next") or not after:
            return rows
        params = {**params, "after": after}


def fetch_ad_insights(t: Tenant, account_id, since, until) -> list[dict]:
    return _fetch(t, account_id, since, until, {})


def fetch_catalog_insights(t: Tenant, account_id, since, until) -> list[dict]:
    return _fetch(t, account_id, since, until, {"breakdowns": "product_id"})


def _num(v) -> Decimal:
    return Decimal(str(v)) if v not in (None, "") else Decimal(0)


def _int(v) -> int:
    return int(_num(v))


def ingest_spend(conn, t: Tenant, since, until) -> tuple[int, int]:
    n_ad = n_cat = 0
    for acct in t.meta_account_ids:
        account = str(acct).removeprefix("act_")
        ads: dict = {}
        for r in fetch_ad_insights(t, acct, since, until):
            key = (r["date_start"], r["ad_id"])
            cur = ads.get(key)
            vals = (_num(r.get("spend")), _int(r.get("impressions")), _int(r.get("clicks")),
                    purchases_from_actions(r.get("actions")))
            if cur:  # defensive: never lose a duplicate row, sum it
                cur["vals"] = tuple(a + b for a, b in zip(cur["vals"], vals))
            else:
                ads[key] = {"r": r, "vals": vals}
        for (d, ad_id), x in ads.items():
            r, (spend, imp, clk, pur) = x["r"], x["vals"]
            conn.execute(
                "INSERT INTO ad_spend_daily (tenant_id, date, account_id, campaign_id, campaign_name, adset_id,"
                " ad_id, ad_name, spend, impressions, clicks, purchases)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (tenant_id, date, account_id, ad_id) DO UPDATE SET"
                " campaign_id=EXCLUDED.campaign_id, campaign_name=EXCLUDED.campaign_name,"
                " adset_id=EXCLUDED.adset_id, ad_name=EXCLUDED.ad_name, spend=EXCLUDED.spend,"
                " impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, purchases=EXCLUDED.purchases",
                (t.tenant_id, d, account, r.get("campaign_id"), r.get("campaign_name"), r.get("adset_id"),
                 ad_id, r.get("ad_name"), spend, imp, clk, pur))
            n_ad += 1

        cats: dict = defaultdict(lambda: (Decimal(0), 0, Decimal(0)))
        for r in fetch_catalog_insights(t, acct, since, until):
            key = (r["date_start"], r["ad_id"], str(r.get("product_id") or ""))
            s, i, p = cats[key]
            cats[key] = (s + _num(r.get("spend")), i + _int(r.get("impressions")),
                         p + purchases_from_actions(r.get("actions")))
        for (d, ad_id, pid), (spend, imp, pur) in cats.items():
            conn.execute(
                "INSERT INTO catalog_spend_daily (tenant_id, date, account_id, ad_id, catalog_product_id,"
                " spend, impressions, purchases) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (tenant_id, date, account_id, ad_id, catalog_product_id) DO UPDATE SET"
                " spend=EXCLUDED.spend, impressions=EXCLUDED.impressions, purchases=EXCLUDED.purchases",
                (t.tenant_id, d, account, ad_id, pid, spend, imp, pur))
            n_cat += 1
    conn.commit()
    return n_ad, n_cat
