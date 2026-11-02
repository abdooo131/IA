"""Tenants (one Shopify store + its Meta ad accounts) and thin API clients."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, fields

import requests

from . import config


@dataclass
class Tenant:
    tenant_id: int | None
    name: str
    shop_domain: str
    shopify_token_env: str
    meta_token_env: str
    meta_account_ids: list[str]
    timezone: str
    currency: str
    po_prefix: str
    main_location_id: str | None
    pixel_key: str


_COLS = [f.name for f in fields(Tenant)]


class ShopifyClient:
    def __init__(self, t: Tenant):
        self.url = f"https://{t.shop_domain}/admin/api/{config.SHOPIFY_API_VERSION}/graphql.json"
        self._token_env = t.shopify_token_env

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        r = requests.post(
            self.url,
            json={"query": query, "variables": variables or {}},
            headers={"X-Shopify-Access-Token": os.environ[self._token_env]},
            timeout=config.HTTP_TIMEOUT,
        )
        r.raise_for_status()
        body = r.json()
        if body.get("errors"):
            raise RuntimeError(f"Shopify GraphQL errors: {body['errors']}")
        return body["data"]


class MetaClient:
    base = f"https://graph.facebook.com/{config.META_API_VERSION}"

    def __init__(self, t: Tenant):
        self._token_env = t.meta_token_env

    def get(self, path: str, params: dict | None = None) -> dict:
        p = dict(params or {})
        p["access_token"] = os.environ[self._token_env]
        r = requests.get(f"{self.base}/{path.lstrip('/')}", params=p, timeout=config.HTTP_TIMEOUT)
        r.raise_for_status()
        return r.json()


def shopify_client(t: Tenant) -> ShopifyClient:
    return ShopifyClient(t)


def meta_client(t: Tenant) -> MetaClient:
    return MetaClient(t)


SHOP_INFO_QUERY = """
query ShopInfo {
  shop { ianaTimezone currencyCode }
  locations(first: 50) { nodes { id name isActive isFulfillmentService } }
}
"""


def _main_location(nodes: list[dict]) -> str | None:
    # Locations come back oldest first; the first active, non fulfillment-service one is the main one.
    for n in nodes:
        if n.get("isActive", True) and not n.get("isFulfillmentService", False):
            return n["id"]
    return None


def _norm_act(account_id: str) -> str:
    return account_id if account_id.startswith("act_") else f"act_{account_id}"


def add_tenant(conn, name, shop_domain, shopify_token_env, meta_token_env,
               meta_account_ids, po_prefix) -> Tenant:
    draft = Tenant(None, name, shop_domain, shopify_token_env, meta_token_env,
                   [str(a).removeprefix("act_") for a in meta_account_ids],
                   "", "", po_prefix, None, secrets.token_urlsafe(32))
    data = shopify_client(draft).graphql(SHOP_INFO_QUERY)
    draft.timezone = data["shop"]["ianaTimezone"]
    draft.currency = data["shop"]["currencyCode"]
    draft.main_location_id = _main_location(data["locations"]["nodes"])

    meta = meta_client(draft)
    for acct in draft.meta_account_ids:
        cur = meta.get(_norm_act(acct), {"fields": "currency"}).get("currency")
        if cur != draft.currency:
            raise ValueError(
                f"Ad account {acct} currency {cur} does not match shop currency {draft.currency}")

    cols = [c for c in _COLS if c != "tenant_id"]
    row = conn.execute(
        f"INSERT INTO tenants ({', '.join(cols)}) VALUES ({', '.join('%s' for _ in cols)}) "
        f"RETURNING {', '.join(_COLS)}",
        [getattr(draft, c) for c in cols],
    ).fetchone()
    conn.commit()
    return Tenant(**row)


def get_tenant(conn, tenant_id: int) -> Tenant:
    row = conn.execute(f"SELECT {', '.join(_COLS)} FROM tenants WHERE tenant_id = %s",
                       (tenant_id,)).fetchone()
    if row is None:
        raise KeyError(f"unknown tenant {tenant_id}")
    return Tenant(**row)


def list_tenants(conn) -> list[Tenant]:
    rows = conn.execute(f"SELECT {', '.join(_COLS)} FROM tenants ORDER BY tenant_id").fetchall()
    return [Tenant(**r) for r in rows]
