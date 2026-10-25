// Smoke test: starts the server against a local mock of the Bosta API and calls a few tools.
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";

const seen = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    if (req.url.includes("missing")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "Delivery not found" }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
});
await new Promise((r) => mock.listen(0, r));

const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["index.js"],
    env: { ...process.env, BOSTA_API_KEY: "test-key", BOSTA_BASE_URL: `http://127.0.0.1:${mock.address().port}` },
  })
);

const { tools } = await client.listTools();
assert.equal(tools.length, 15);

await client.callTool({ name: "bosta_create_delivery", arguments: { delivery: { type: 10, cod: 250 } } });
assert.deepEqual(seen.at(-1), { method: "POST", url: "/api/v1/deliveries", auth: "test-key", body: '{"type":10,"cod":250}' });

await client.callTool({ name: "bosta_list_deliveries", arguments: { page: 2, filters: { state: 45 } } });
assert.equal(seen.at(-1).url, "/api/v1/deliveries?page=2&state=45");

await client.callTool({ name: "bosta_track_delivery", arguments: { deliveryId: "ABC123" } });
assert.equal(seen.at(-1).url, "/api/v1/deliveries/ABC123/tracking");

await client.callTool({ name: "bosta_list_zones", arguments: { cityId: "c1" } });
assert.equal(seen.at(-1).url, "/api/v1/cities/c1/zones");

const failed = await client.callTool({ name: "bosta_get_delivery", arguments: { deliveryId: "missing" } });
assert.equal(failed.isError, true);
assert.match(failed.content[0].text, /404.*Delivery not found/);

await client.close();
mock.close();
console.log(`ok: ${tools.length} tools, ${seen.length} requests checked`);
