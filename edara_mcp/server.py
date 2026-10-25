"""Local MCP server that gives Claude read only access to the Edara ERP REST API.

Configuration comes from environment variables:
  EDARA_API_TOKEN    Bearer token of an Edara API user (required)
  EDARA_BASE_URL     defaults to https://api.edara.io
  EDARA_API_VERSION  defaults to v2.0

Only GET requests are ever sent, so the server cannot modify data in Edara.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

BASE_URL = os.environ.get("EDARA_BASE_URL", "https://api.edara.io").rstrip("/")
API_VERSION = os.environ.get("EDARA_API_VERSION", "v2.0").strip("/")
TIMEOUT_SECONDS = 30
MAX_RESPONSE_CHARS = 60_000

# Resource paths such as "Taxes" or "SalesOrders/123". Rejects "..", schemes and query strings.
RESOURCE_PATTERN = re.compile(r"^[A-Za-z0-9_\-]+(/[A-Za-z0-9_\-.]+)*$")

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=True)

mcp = MCPServer(
    name="edara",
    instructions=(
        "Read only access to the Edara ERP REST API. "
        "Use edara_test_connection first if unsure the token works. "
        "Use edara_get with a resource path from the Edara API documentation "
        "(https://docs-dev.edara.io), for example 'Taxes'. "
        "This server cannot create, update or delete anything in Edara."
    ),
)


class EdaraError(ToolError):
    """Errors whose message is shown to Claude so it can explain the problem."""


def _token() -> str:
    token = os.environ.get("EDARA_API_TOKEN", "").strip()
    if not token:
        raise EdaraError(
            "EDARA_API_TOKEN is not set. Create an API user in Edara "
            "(Integrations > Rest API), generate a token, and add it to the MCP server config."
        )
    return token


def _build_url(resource: str, params: dict | None) -> str:
    resource = resource.strip().strip("/")
    if not RESOURCE_PATTERN.match(resource) or ".." in resource:
        raise EdaraError(f"Invalid resource path: {resource!r}. Use a path like 'Taxes' or 'Products/42'.")
    url = f"{BASE_URL}/{API_VERSION}/{resource}"
    if params:
        clean = {str(k): str(v) for k, v in params.items() if v is not None}
        url += "?" + urllib.parse.urlencode(clean)
    return url


def _get(resource: str, params: dict | None = None) -> str:
    url = _build_url(resource, params)
    request = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {_token()}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:2000]
        if e.code in (401, 403):
            raise EdaraError(
                f"Edara rejected the token (HTTP {e.code}). The token may be expired or the "
                f"API user may lack permission for '{resource}'. Response: {detail}"
            ) from e
        raise EdaraError(f"Edara returned HTTP {e.code} for {url}. Response: {detail}") from e
    except urllib.error.URLError as e:
        raise EdaraError(f"Could not reach Edara at {url}: {e.reason}") from e

    try:
        body = json.dumps(json.loads(body), ensure_ascii=False, indent=2)
    except json.JSONDecodeError:
        pass
    if len(body) > MAX_RESPONSE_CHARS:
        body = (
            body[:MAX_RESPONSE_CHARS]
            + f"\n\n[Truncated: response was {len(body)} characters. Use paging or filter params to narrow it.]"
        )
    return body


@mcp.tool(annotations=READ_ONLY)
async def edara_test_connection() -> str:
    """Check that the Edara token works by fetching the list of taxes."""
    body = await anyio.to_thread.run_sync(_get, "Taxes")
    return f"Connected to {BASE_URL}/{API_VERSION}. Sample response from Taxes:\n{body[:3000]}"


@mcp.tool(annotations=READ_ONLY)
async def edara_get(resource: str, params: dict[str, str | int] | None = None) -> str:
    """Fetch data from any Edara API resource with a GET request.

    Args:
        resource: Path after the API version, e.g. "Taxes" or "Products/42".
            See https://docs-dev.edara.io for the available resources.
        params: Optional query string parameters (paging, filters) as documented by Edara.
    """
    return await anyio.to_thread.run_sync(_get, resource, params)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
