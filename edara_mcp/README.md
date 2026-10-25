# Edara MCP server

A local MCP server that lets Claude read data from Edara ERP through the Edara REST API.

It is **read only**. It only sends GET requests, so Claude can look things up in Edara but cannot create, change or delete anything.

## Tools

| Tool | What it does |
|---|---|
| `edara_test_connection` | Checks the token works by fetching the list of taxes |
| `edara_get` | Fetches any Edara API resource, e.g. `Taxes` or `Products/42`, with optional query parameters for paging and filters |

Resource names come from the Edara API documentation: https://docs-dev.edara.io

## 1. Create an Edara API token

1. In Edara go to **Integrations > Rest API**.
2. Create a dedicated API user for Claude (not your own login), so you can revoke it at any time.
3. Give it **view permissions only**, and only for the modules you want Claude to see (sales, stock, customers and so on).
4. Generate an access token and copy it.

## 2. Install

Requires Python 3.10 or newer.

```bash
cd edara_mcp
python -m venv .venv
# Windows:      .venv\Scripts\pip install -r requirements.txt
# macOS/Linux:  .venv/bin/pip install -r requirements.txt
```

## 3. Connect it to Claude

### Claude Desktop

Open **Settings > Developer > Edit Config** and add this to `claude_desktop_config.json` (use the full paths on your computer):

```json
{
  "mcpServers": {
    "edara": {
      "command": "C:\\path\\to\\IA\\edara_mcp\\.venv\\Scripts\\python.exe",
      "args": ["C:\\path\\to\\IA\\edara_mcp\\server.py"],
      "env": {
        "EDARA_API_TOKEN": "paste-your-token-here"
      }
    }
  }
}
```

On macOS/Linux the command is `/path/to/IA/edara_mcp/.venv/bin/python`. Restart Claude Desktop afterwards.

### Claude Code

```bash
claude mcp add edara --env EDARA_API_TOKEN=paste-your-token-here -- /path/to/IA/edara_mcp/.venv/bin/python /path/to/IA/edara_mcp/server.py
```

## 4. Try it

Ask Claude: *"Test the Edara connection"*, then something like *"Show me the last 10 sales orders from Edara"*.

## Optional settings

| Variable | Default |
|---|---|
| `EDARA_BASE_URL` | `https://api.edara.io` |
| `EDARA_API_VERSION` | `v2.0` |

## Security notes

1. Never commit your token. It belongs only in the Claude config shown above.
2. If the token leaks, delete the API user in Edara and create a new one.
3. Large responses are cut off at about 60,000 characters; ask Claude to use paging or filters.

## When it breaks

1. **"Edara rejected the token (HTTP 401/403)"**: the token expired, or the API user lacks permission for that module. Generate a new token or adjust permissions in Edara.
2. **"Could not reach Edara"**: no internet connection, or Edara is down.
3. **HTTP 404**: the resource name is wrong; check it against https://docs-dev.edara.io
