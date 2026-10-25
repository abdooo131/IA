# Bosta MCP server

Connects Claude to the [Bosta](https://bosta.co) shipping API, so you can ask Claude things like
"create a delivery to Nasr City with 250 EGP COD", "where is shipment 1234567?" or
"schedule a pickup tomorrow morning".

## Try it first with fake data (no Bosta account needed)

Set `BOSTA_DEMO=1` instead of an API key. Claude then talks to a pretend Bosta that runs on your
computer, with 3 cities, a few zones, 3 sample deliveries and 1 pickup. Nothing is sent to Bosta, no
real shipment is created, and the fake data resets every time Claude restarts.

```json
"env": { "BOSTA_DEMO": "1" }
```

## 1. Get your Bosta API key

Log in to the Bosta business dashboard, open **Settings > API Integration** and create an API key.

## 2. Install

Requires Node.js 18 or newer.

```bash
cd bosta-mcp
npm install
npm test   # optional: runs against a local mock, no real API calls
```

## 3. Add it to Claude

### Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "bosta": {
      "command": "node",
      "args": ["/full/path/to/IA/bosta-mcp/index.js"],
      "env": { "BOSTA_API_KEY": "your_api_key_here" }
    }
  }
}
```

Restart Claude Desktop. The Bosta tools appear under the tools icon.

### Claude Code

```bash
claude mcp add bosta -e BOSTA_API_KEY=your_api_key_here -- node /full/path/to/IA/bosta-mcp/index.js
```

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOSTA_DEMO` | off | Set to `1` to use fake offline data instead of the real API |
| `BOSTA_API_KEY` | (required unless demo) | Your API key, sent as the `Authorization` header |
| `BOSTA_BASE_URL` | `https://app.bosta.co` | Use `https://stg-app.bosta.co` to test on staging |
| `BOSTA_API_VERSION` | `v1` | API version in the path (`/api/v1/...`). Set to `v2` if your account uses the newer API |

## Tools

| Tool | Endpoint |
| --- | --- |
| `bosta_create_delivery` | `POST /deliveries` |
| `bosta_list_deliveries` | `GET /deliveries` |
| `bosta_get_delivery` | `GET /deliveries/{id}` |
| `bosta_track_delivery` | `GET /deliveries/{id}/tracking` |
| `bosta_update_delivery` | `PUT /deliveries/{id}` |
| `bosta_terminate_delivery` | `DELETE /deliveries/{id}` |
| `bosta_print_awb` | `GET /deliveries/awb/{id}` |
| `bosta_create_pickup` | `POST /pickups` |
| `bosta_list_pickups` | `GET /pickups` |
| `bosta_get_pickup` | `GET /pickups/{id}` |
| `bosta_update_pickup` | `PUT /pickups/{id}` |
| `bosta_delete_pickup` | `DELETE /pickups/{id}` |
| `bosta_list_cities` | `GET /cities` |
| `bosta_list_zones` | `GET /zones` or `GET /cities/{id}/zones` |
| `bosta_request` | Any endpoint, for anything not listed above |

The endpoints follow Bosta's official SDKs. Bosta may change paths between API versions;
if a call returns 404, try `BOSTA_API_VERSION=v2` or use `bosta_request` with the path from
Bosta's current docs.

Keep your API key private: don't commit it or paste it into chats.
