"""Read only Shopify Admin GraphQL client with throttle handling and Bulk Operations."""
from __future__ import annotations

import os
import time
from pathlib import Path

import requests

from src.common import no_hyphen


class ShopifyError(RuntimeError):
    pass


class MissingScopesError(ShopifyError):
    pass


MUTATION_BULK_RUN = """
mutation run($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
"""

QUERY_BULK_STATUS = """
query status($id: ID!) {
  node(id: $id) { ... on BulkOperation { id status errorCode objectCount url partialDataUrl } }
}
"""

QUERY_SCOPES = "{ currentAppInstallation { accessScopes { handle } } }"

# The only mutation this client is allowed to send. It starts a read only export, it changes nothing in the store.
_ALLOWED_MUTATIONS = {MUTATION_BULK_RUN.strip()}


class ShopifyClient:
    def __init__(self, domain: str, token: str, api_version: str, max_retries: int = 6, poll_seconds: int = 5):
        if not domain or not token:
            raise ShopifyError(
                "SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN must be set in .env (see .env.example)."
            )
        self.domain = domain.replace("https://", "").strip("/")
        self.url = f"https://{self.domain}/admin/api/{api_version}/graphql.json"
        self.session = requests.Session()
        self.session.headers.update({"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
        self.max_retries = max_retries
        self.poll_seconds = poll_seconds

    @classmethod
    def from_env(cls, settings) -> "ShopifyClient":
        try:
            from dotenv import load_dotenv

            load_dotenv(settings.root / ".env")
        except ImportError:
            pass
        return cls(
            os.environ.get("SHOPIFY_STORE_DOMAIN", ""),
            os.environ.get("SHOPIFY_ACCESS_TOKEN", ""),
            settings.api_version,
            settings.get("shopify", "max_retries", default=6),
            settings.get("shopify", "bulk_poll_seconds", default=5),
        )

    def query(self, query: str, variables: dict | None = None) -> dict:
        stripped = query.strip()
        if stripped.startswith("mutation") and stripped not in _ALLOWED_MUTATIONS:
            raise ShopifyError("This system is read only against Shopify. Mutation refused.")
        delay = 2.0
        for attempt in range(self.max_retries + 1):
            try:
                resp = self.session.post(self.url, json={"query": query, "variables": variables or {}}, timeout=120)
            except requests.RequestException as exc:
                if attempt == self.max_retries:
                    raise ShopifyError(f"Network error talking to Shopify: {exc}") from exc
                time.sleep(delay)
                delay *= 2
                continue
            if resp.status_code in (429, 500, 502, 503, 504):
                retry_after = float(resp.headers.get("Retry-After", delay))
                time.sleep(retry_after)
                delay *= 2
                continue
            if resp.status_code == 401:
                raise ShopifyError("Shopify rejected the access token (401). Check SHOPIFY_ACCESS_TOKEN.")
            if resp.status_code == 403:
                raise MissingScopesError(f"Shopify returned 403 forbidden: {no_hyphen(resp.text[:300])}")
            resp.raise_for_status()
            payload = resp.json()
            errors = payload.get("errors") or []
            if any((e.get("extensions") or {}).get("code") == "THROTTLED" for e in errors):
                time.sleep(self._throttle_wait(payload, delay))
                delay *= 2
                continue
            if errors:
                raise ShopifyError("GraphQL errors: " + "; ".join(e.get("message", "") for e in errors))
            self._respect_cost(payload)
            return payload["data"]
        raise ShopifyError("Shopify kept throttling after all retries.")

    @staticmethod
    def _throttle_wait(payload: dict, fallback: float) -> float:
        cost = (payload.get("extensions") or {}).get("cost") or {}
        status = cost.get("throttleStatus") or {}
        requested = cost.get("requestedQueryCost") or 0
        available = status.get("currentlyAvailable") or 0
        rate = status.get("restoreRate") or 50
        if requested and rate:
            return max(1.0, (requested - available) / rate + 0.5)
        return fallback

    @staticmethod
    def _respect_cost(payload: dict):
        cost = (payload.get("extensions") or {}).get("cost") or {}
        status = cost.get("throttleStatus") or {}
        available = status.get("currentlyAvailable")
        maximum = status.get("maximumAvailable")
        rate = status.get("restoreRate") or 50
        if available is not None and maximum and available < 0.1 * maximum:
            time.sleep((0.2 * maximum - available) / rate)

    def access_scopes(self) -> set[str]:
        data = self.query(QUERY_SCOPES)
        return {s["handle"] for s in data["currentAppInstallation"]["accessScopes"]}

    def check_scopes(self, required: list[str]) -> list[str]:
        granted = self.access_scopes()
        return [s for s in required if s not in granted]

    def run_bulk(self, bulk_query: str, out_path: Path, log=print) -> Path:
        """Start a bulk export, wait for it, and download the JSONL result to out_path."""
        data = self.query(MUTATION_BULK_RUN, {"query": bulk_query})
        result = data["bulkOperationRunQuery"]
        if result["userErrors"]:
            raise ShopifyError("Bulk operation refused: " + "; ".join(e["message"] for e in result["userErrors"]))
        op_id = result["bulkOperation"]["id"]
        while True:
            time.sleep(self.poll_seconds)
            node = self.query(QUERY_BULK_STATUS, {"id": op_id})["node"]
            status = node["status"]
            if status == "COMPLETED":
                break
            if status in ("FAILED", "CANCELED", "EXPIRED"):
                raise ShopifyError(f"Bulk operation {status}, error code {node.get('errorCode')}")
            log(f"Bulk export running, {node.get('objectCount')} objects so far")
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        url = node.get("url")
        if not url:
            out_path.write_text("")
            return out_path
        with requests.get(url, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(out_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
        return out_path
