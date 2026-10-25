#!/usr/bin/env node
// MCP server exposing the Bosta shipping API (https://bosta.co) as tools for Claude.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { demoBosta } from "./demo.js";

const API_KEY = process.env.BOSTA_API_KEY;
const BASE_URL = (process.env.BOSTA_BASE_URL || "https://app.bosta.co").replace(/\/+$/, "");
const API_VERSION = process.env.BOSTA_API_VERSION || "v1";
const DEMO = ["1", "true", "yes"].includes(String(process.env.BOSTA_DEMO).toLowerCase());

if (!API_KEY && !DEMO) {
  console.error("BOSTA_API_KEY is not set. Get it from the Bosta dashboard under Settings > API Integration, or set BOSTA_DEMO=1 to try it with fake data.");
  process.exit(1);
}

async function bosta(method, path, { query, body } = {}) {
  if (DEMO) return demoBosta(method, path, { query, body });
  const url = new URL(`${BASE_URL}/api/${API_VERSION}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: API_KEY,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`Bosta API ${method} ${url.pathname} failed with ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

function result(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function tool(handler) {
  return async (args) => {
    try {
      return result(await handler(args));
    } catch (err) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  };
}

const id = (what) => z.string().describe(`The Bosta ${what} id`);
const payload = z.record(z.string(), z.any());

const server = new McpServer({ name: "bosta", version: "1.0.0" });

// Deliveries

server.tool(
  "bosta_create_delivery",
  "Create a new Bosta delivery (shipment). Typical body fields: type (10 = send/forward, 15 = cash collection, 25 = customer return pickup, 30 = exchange), " +
    "specs { packageType, size, packageDetails { itemsCount, description } }, cod (cash on delivery amount in EGP), " +
    "dropOffAddress { city, zone, district, firstLine, secondLine, buildingNumber, floor, apartment }, " +
    "receiver { firstName, lastName, phone, email }, businessReference, notes, allowToOpenPackage.",
  { delivery: payload.describe("The delivery body as accepted by the Bosta API") },
  tool(({ delivery }) => bosta("POST", "/deliveries", { body: delivery }))
);

server.tool(
  "bosta_list_deliveries",
  "List deliveries of the business, with optional paging and filters.",
  {
    page: z.number().int().positive().optional(),
    perPage: z.number().int().positive().optional(),
    filters: payload.optional().describe("Extra query filters, e.g. { state: 45 } or { trackingNumber: '...' }"),
  },
  tool(({ page, perPage, filters }) => bosta("GET", "/deliveries", { query: { page, perPage, ...filters } }))
);

server.tool(
  "bosta_get_delivery",
  "Get the full details of one delivery by its id or tracking number.",
  { deliveryId: id("delivery").describe("Delivery id or tracking number") },
  tool(({ deliveryId }) => bosta("GET", `/deliveries/${encodeURIComponent(deliveryId)}`))
);

server.tool(
  "bosta_track_delivery",
  "Get the tracking history (state changes) of a delivery.",
  { deliveryId: id("delivery").describe("Delivery id or tracking number") },
  tool(({ deliveryId }) => bosta("GET", `/deliveries/${encodeURIComponent(deliveryId)}/tracking`))
);

server.tool(
  "bosta_update_delivery",
  "Update an existing delivery. Only send the fields that should change.",
  { deliveryId: id("delivery"), changes: payload.describe("Fields to update, same shape as create") },
  tool(({ deliveryId, changes }) => bosta("PUT", `/deliveries/${encodeURIComponent(deliveryId)}`, { body: changes }))
);

server.tool(
  "bosta_terminate_delivery",
  "Terminate (cancel) a delivery. This cannot be undone, so confirm with the user first.",
  { deliveryId: id("delivery") },
  tool(({ deliveryId }) => bosta("DELETE", `/deliveries/${encodeURIComponent(deliveryId)}`))
);

server.tool(
  "bosta_print_awb",
  "Get the airway bill (shipping label) of a delivery. Returns base64 PDF data.",
  { deliveryId: id("delivery") },
  tool(({ deliveryId }) => bosta("GET", `/deliveries/awb/${encodeURIComponent(deliveryId)}`))
);

// Pickups

server.tool(
  "bosta_create_pickup",
  "Schedule a pickup. Body fields: businessLocationId, scheduledDate (YYYY-MM-DD), scheduledTimeSlot ('10:00 to 13:00' or '13:00 to 16:00'), " +
    "contactPerson { name, phone, email }, noOfPackages, notes.",
  { pickup: payload.describe("The pickup body as accepted by the Bosta API") },
  tool(({ pickup }) => bosta("POST", "/pickups", { body: pickup }))
);

server.tool(
  "bosta_list_pickups",
  "List scheduled pickups of the business.",
  { page: z.number().int().positive().optional(), perPage: z.number().int().positive().optional() },
  tool(({ page, perPage }) => bosta("GET", "/pickups", { query: { pageNumber: page, pageLimit: perPage } }))
);

server.tool(
  "bosta_get_pickup",
  "Get the details of one pickup.",
  { pickupId: id("pickup") },
  tool(({ pickupId }) => bosta("GET", `/pickups/${encodeURIComponent(pickupId)}`))
);

server.tool(
  "bosta_update_pickup",
  "Update a scheduled pickup.",
  { pickupId: id("pickup"), changes: payload },
  tool(({ pickupId, changes }) => bosta("PUT", `/pickups/${encodeURIComponent(pickupId)}`, { body: changes }))
);

server.tool(
  "bosta_delete_pickup",
  "Cancel a scheduled pickup. Confirm with the user first.",
  { pickupId: id("pickup") },
  tool(({ pickupId }) => bosta("DELETE", `/pickups/${encodeURIComponent(pickupId)}`))
);

// Locations

server.tool(
  "bosta_list_cities",
  "List the cities Bosta delivers to, with their ids and codes.",
  {},
  tool(() => bosta("GET", "/cities"))
);

server.tool(
  "bosta_list_zones",
  "List delivery zones, optionally only those of one city.",
  { cityId: z.string().optional() },
  tool(({ cityId }) => bosta("GET", cityId ? `/cities/${encodeURIComponent(cityId)}/zones` : "/zones"))
);

// Escape hatch for endpoints not covered above

server.tool(
  "bosta_request",
  "Call any Bosta API endpoint directly. The path is relative to /api/<version>, e.g. '/deliveries/search'. " +
    "Use this for endpoints that have no dedicated tool. Ask the user before calling write methods.",
  {
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string(),
    query: payload.optional(),
    body: payload.optional(),
  },
  tool(({ method, path, query, body }) => bosta(method, path, { query, body }))
);

await server.connect(new StdioServerTransport());
