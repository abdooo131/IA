"""Tenants (one Shopify store + its Meta ad accounts) and thin API clients."""
from __future__ import annotations

import logging
import os
import re
import secrets
import time
from dataclasses import dataclass, fields

import requests

from . import config

log = logging.getLogger(__name__)


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


class MissingTokenError(RuntimeError):
    """The env var a tenant names for an API token is not set."""


def _token(env_name: str) -> str:
    value = os.environ.get(env_name)
    if not value:
        raise MissingTokenError(f"environment variable {env_name} is not set (it must hold the API token)")
    return value


# ---------------------------------------------------------------- redaction (C3: tokens never reach DB or logs)

_TOKEN_PATTERNS = (
    re.compile(r"(access_token=)[^&\s'\"]+", re.I),
    re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+", re.I),
    re.compile(r"()\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]+"),        # Shopify Admin API tokens
    re.compile(r"()\bEAA[A-Za-z0-9]{20,}"),                    # Meta access tokens
)


def redact(text, t: "Tenant | None" = None) -> str:
    """text with access tokens removed: access_token=..., Bearer ..., token shaped strings, and the actual values
    of the tenant's token env vars (and every other set env var whose name ends in _TOKEN)."""
    s = str(text)
    names = {n for n in os.environ if n.upper().endswith("TOKEN")}
    if t is not None:
        names |= {t.shopify_token_env, t.meta_token_env}
    for n in names:
        v = os.environ.get(n) if n else None
        if v and len(v) >= 6:
            s = s.replace(v, "[REDACTED]")
    for pat in _TOKEN_PATTERNS:
        s = pat.sub(lambda m: m.group(1) + "[REDACTED]", s)
    return s


# ---------------------------------------------------------------- clients

MAX_RETRIES = 6
BACKOFF_SECONDS = 1.0
MAX_WAIT_SECONDS = 60.0
_sleep = time.sleep                     # tests replace it


def _backoff(attempt: int) -> float:
    return min(BACKOFF_SECONDS * 2 ** attempt, MAX_WAIT_SECONDS)


class ShopifyClient:
    """Admin GraphQL client. Retries THROTTLED errors (waiting for the cost bucket to refill, from
    extensions.cost.throttleStatus when present) and HTTP 429 / 5xx with exponential backoff."""

    def __init__(self, t: Tenant):
        self.url = f"https://{t.shop_domain}/admin/api/{config.SHOPIFY_API_VERSION}/graphql.json"
        self._token_env = t.shopify_token_env

    @staticmethod
    def _throttle_wait(body: dict, attempt: int) -> float:
        cost = (body.get("extensions") or {}).get("cost") or {}
        status = cost.get("throttleStatus") or {}
        need, have, rate = cost.get("requestedQueryCost"), status.get("currentlyAvailable"), \
            status.get("restoreRate")
        if need is not None and have is not None and rate:
            return min(max((float(need) - float(have)) / float(rate), 0.0) + 0.5, MAX_WAIT_SECONDS)
        return _backoff(attempt)

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        token = _token(self._token_env)
        for attempt in range(MAX_RETRIES + 1):
            r = requests.post(self.url, json={"query": query, "variables": variables or {}},
                              headers={"X-Shopify-Access-Token": token}, timeout=config.HTTP_TIMEOUT)
            status = getattr(r, "status_code", 200)
            if status == 429 or status >= 500:
                if attempt < MAX_RETRIES:
                    retry_after = (getattr(r, "headers", None) or {}).get("Retry-After")
                    _sleep(float(retry_after) if retry_after else _backoff(attempt))
                    continue
            r.raise_for_status()
            body = r.json()
            errors = body.get("errors")
            if errors:
                throttled = isinstance(errors, list) and any(
                    ((e.get("extensions") or {}).get("code") == "THROTTLED") for e in errors if isinstance(e, dict))
                if throttled and attempt < MAX_RETRIES:
                    _sleep(self._throttle_wait(body, attempt))
                    continue
                raise RuntimeError(f"Shopify GraphQL errors: {errors}")
            return body["data"]
        raise RuntimeError("Shopify GraphQL: retries exhausted")


META_RETRY_CODES = {1, 2, 4, 17, 341, 80004}


class MetaError(RuntimeError):
    pass


class MetaClient:
    """Graph API client. The token goes in an Authorization header, never in the URL. Retries Meta transient and
    rate limit error codes (1, 2, 4, 17, 341, 80004) and HTTP 5xx with exponential backoff."""

    base = f"https://graph.facebook.com/{config.META_API_VERSION}"

    def __init__(self, t: Tenant):
        self._token_env = t.meta_token_env

    def get(self, path: str, params: dict | None = None) -> dict:
        token = _token(self._token_env)
        url = f"{self.base}/{path.lstrip('/')}"
        for attempt in range(MAX_RETRIES + 1):
            r = requests.get(url, params=dict(params or {}), headers={"Authorization": f"Bearer {token}"},
                             timeout=config.HTTP_TIMEOUT)
            status = getattr(r, "status_code", 200)
            try:
                body = r.json()
            except ValueError:
                body = {}
            err = body.get("error") if isinstance(body, dict) else None
            code = err.get("code") if isinstance(err, dict) else None
            if (status >= 500 or code in META_RETRY_CODES) and attempt < MAX_RETRIES:
                _sleep(_backoff(attempt))
                continue
            if err:
                raise MetaError(redact(f"Meta API error on {path}: code {code}: {err.get('message')}"))
            if status >= 400:
                raise MetaError(redact(f"Meta API HTTP {status} on {path}"))
            return body
        raise MetaError(f"Meta API {path}: retries exhausted")


def shopify_client(t: Tenant) -> ShopifyClient:
    return ShopifyClient(t)


def meta_client(t: Tenant) -> MetaClient:
    return MetaClient(t)


SHOP_INFO_QUERY = """
query ShopInfo {
  shop { ianaTimezone currencyCode }
  location { id name }
}
"""


def _norm_act(account_id: str) -> str:
    return account_id if account_id.startswith("act_") else f"act_{account_id}"


def add_tenant(conn, name, shop_domain, shopify_token_env, meta_token_env,
               meta_account_ids, po_prefix, warnings: list[str] | None = None) -> Tenant:
    """Register a store. Timezone, currency and the main (primary) location come from Shopify; each ad account
    must use the shop currency. An ad account whose timezone differs from the shop's is accepted with a warning
    (Meta reports days in the account's timezone), appended to `warnings` and logged."""
    draft = Tenant(None, name, shop_domain, shopify_token_env, meta_token_env,
                   [str(a).removeprefix("act_") for a in meta_account_ids],
                   "", "", po_prefix, None, secrets.token_urlsafe(32))
    data = shopify_client(draft).graphql(SHOP_INFO_QUERY)
    draft.timezone = data["shop"]["ianaTimezone"]
    draft.currency = data["shop"]["currencyCode"]
    draft.main_location_id = (data.get("location") or {}).get("id")      # the shop's primary location

    meta = meta_client(draft)
    for acct in draft.meta_account_ids:
        info = meta.get(_norm_act(acct), {"fields": "currency,timezone_name"})
        cur = info.get("currency")
        if cur != draft.currency:
            raise ValueError(
                f"Ad account {acct} currency {cur} does not match shop currency {draft.currency}")
        tz = info.get("timezone_name")
        if tz and tz != draft.timezone:
            msg = (f"ad account {acct} timezone {tz} differs from shop timezone {draft.timezone}; Meta days are"
                   f" account days, so daily spend and orders are offset")
            log.warning("%s: %s", name, msg)
            if warnings is not None:
                warnings.append(msg)

    cols = [c for c in _COLS if c != "tenant_id"]
    row = conn.execute(
        f"INSERT INTO tenants ({', '.join(cols)}) VALUES ({', '.join('%s' for _ in cols)}) "
        f"RETURNING {', '.join(_COLS)}",
        [getattr(draft, c) for c in cols],
    ).fetchone()
    conn.commit()
    return Tenant(**row)


LOCATION_GID = "gid://shopify/Location/"


def set_main_location(conn, t: Tenant, location_id: str) -> Tenant:
    """Set the tenant's main location (PO transfer destination) to a Shopify Location GID (or its number)."""
    loc = str(location_id).strip()
    if loc.isdigit():
        loc = LOCATION_GID + loc
    if not (loc.startswith(LOCATION_GID) and loc[len(LOCATION_GID):].isdigit()):
        raise ValueError(f"not a Shopify location id: {location_id!r} (expected {LOCATION_GID}<number>)")
    conn.execute("UPDATE tenants SET main_location_id = %s WHERE tenant_id = %s", (loc, t.tenant_id))
    conn.commit()
    return get_tenant(conn, t.tenant_id)


def get_tenant(conn, tenant_id: int) -> Tenant:
    row = conn.execute(f"SELECT {', '.join(_COLS)} FROM tenants WHERE tenant_id = %s",
                       (tenant_id,)).fetchone()
    if row is None:
        raise KeyError(f"unknown tenant {tenant_id}")
    return Tenant(**row)


def list_tenants(conn) -> list[Tenant]:
    rows = conn.execute(f"SELECT {', '.join(_COLS)} FROM tenants ORDER BY tenant_id").fetchall()
    return [Tenant(**r) for r in rows]
