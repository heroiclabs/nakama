#!/usr/bin/env node

/**
 * Nakama / Hiro / Satori MCP Server
 *
 * Provides 25+ tools for Cursor IDE covering:
 *  - Server health & system status
 *  - Device authentication with session caching
 *  - Any Nakama RPC call (hiro_*, satori_*, admin_*, legacy)
 *  - Hiro & Satori config CRUD
 *  - Bulk config export/import
 *  - Player inspection (full profile with all systems)
 *  - Wallet view / grant / reset
 *  - Inventory admin grant
 *  - Admin mailbox send
 *  - Feature flag quick toggle
 *  - Live event scheduling
 *  - Experiment setup
 *  - Satori events timeline
 *  - User search by username
 *  - Storage collection browser
 *  - Cache invalidation
 *  - TypeScript build & Nakama restart
 *  - RPC directory listing
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import http from "http";

const NAKAMA_HTTP = process.env.NAKAMA_HTTP_URL || "http://127.0.0.1:7350";
const NAKAMA_SERVER_KEY = process.env.NAKAMA_SERVER_KEY || "defaultkey";
const NAKAMA_MODULES_DIR =
  process.env.NAKAMA_MODULES_DIR ||
  "/Users/devashishbadlani/dev/nakama/data/modules";
const NAKAMA_PROJECT_DIR =
  process.env.NAKAMA_PROJECT_DIR ||
  "/Users/devashishbadlani/dev/nakama";

const BASIC_AUTH = Buffer.from(`${NAKAMA_SERVER_KEY}:`).toString("base64");

let cachedSession = null;

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function httpJson(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined;
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode, data: text });
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function bearerHeader() {
  return { Authorization: `Bearer ${cachedSession.token}` };
}

function serverKeyHeader() {
  return { Authorization: `Basic ${BASIC_AUTH}` };
}

function requireAuth() {
  if (!cachedSession) {
    return { content: [{ type: "text", text: "Not authenticated. Call nakama_auth first." }] };
  }
  return null;
}

async function rpcCall(rpcId, payload) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  return httpJson(
    "POST",
    `${NAKAMA_HTTP}/v2/rpc/${encodeURIComponent(rpcId)}?unwrap`,
    body,
    { ...bearerHeader(), "Content-Type": "application/json" }
  );
}

function fmtResponse(r) {
  return typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "nakama-hiro-satori",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — CONNECTIVITY
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "nakama_health",
  "Check if the Nakama server is running and healthy",
  {},
  async () => {
    try {
      const r = await httpJson("GET", `${NAKAMA_HTTP}/healthcheck`);
      return {
        content: [{
          type: "text",
          text: `Nakama is ${r.status === 200 ? "healthy" : "unhealthy"}\nEndpoint: ${NAKAMA_HTTP}\nHTTP status: ${r.status}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Cannot reach Nakama at ${NAKAMA_HTTP}: ${e.message}` }] };
    }
  }
);

server.tool(
  "nakama_auth",
  "Authenticate with Nakama using device ID. Caches the session token for all subsequent calls.",
  {
    device_id: z.string().describe("Device ID for authentication"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ device_id, username }) => {
    const qs = `?create=true${username ? `&username=${encodeURIComponent(username)}` : ""}`;
    const r = await httpJson(
      "POST",
      `${NAKAMA_HTTP}/v2/account/authenticate/device${qs}`,
      { id: device_id },
      serverKeyHeader()
    );
    if (r.status === 200 && r.data.token) {
      const claims = JSON.parse(Buffer.from(r.data.token.split(".")[1], "base64").toString());
      cachedSession = {
        token: r.data.token,
        refresh_token: r.data.refresh_token,
        user_id: claims.uid,
      };
      return {
        content: [{
          type: "text",
          text: `Authenticated\nUser ID: ${cachedSession.user_id}\nToken cached for subsequent calls.`,
        }],
      };
    }
    return { content: [{ type: "text", text: `Auth failed (${r.status}): ${JSON.stringify(r.data)}` }] };
  }
);

server.tool(
  "nakama_systems_status",
  "Show all registered Hiro/Satori systems, storage collections, and server version",
  {},
  async () => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_health_check", {});
    return { content: [{ type: "text", text: `Systems status:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — GENERIC RPC CALLER
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "nakama_rpc",
  "Call any Nakama RPC endpoint (hiro_*, satori_*, admin_*, or legacy). Use nakama_rpc_list to see all available endpoints.",
  {
    rpc_id: z.string().describe("RPC ID, e.g. hiro_achievements_list, satori_flags_get_all"),
    payload: z.string().optional().describe("JSON payload string (default '{}')"),
  },
  async ({ rpc_id, payload }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall(rpc_id, payload || "{}");
    return { content: [{ type: "text", text: `RPC ${rpc_id} -> ${r.status}\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — HIRO CONFIG MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const HIRO_SYSTEMS = [
  "economy", "inventory", "achievements", "progression", "energy",
  "stats", "streaks", "event_leaderboards", "store", "challenges",
  "tutorials", "unlockables", "auctions", "incentives",
];

server.tool(
  "hiro_config_get",
  `Read a Hiro system config. Systems: ${HIRO_SYSTEMS.join(", ")}`,
  { system: z.string().describe("Hiro system name") },
  async ({ system }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_config_get", { system });
    return { content: [{ type: "text", text: `Hiro config [${system}]:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "hiro_config_set",
  "Write/update a Hiro system config in Nakama storage",
  {
    system: z.string().describe("Hiro system name"),
    config_json: z.string().describe("Full JSON config"),
  },
  async ({ system, config_json }) => {
    const check = requireAuth();
    if (check) return check;
    let parsed;
    try { parsed = JSON.parse(config_json); } catch (e) {
      return { content: [{ type: "text", text: `Invalid JSON: ${e.message}` }] };
    }
    const r = await rpcCall("admin_config_set", { system, config: parsed });
    return { content: [{ type: "text", text: `Hiro config [${system}] saved.\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — SATORI CONFIG MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const SATORI_SYSTEMS = ["audiences", "flags", "experiments", "live_events", "messages", "metrics"];

server.tool(
  "satori_config_get",
  `Read a Satori system config. Systems: ${SATORI_SYSTEMS.join(", ")}`,
  { system: z.string().describe("Satori system name") },
  async ({ system }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_satori_config_get", { system });
    return { content: [{ type: "text", text: `Satori config [${system}]:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "satori_config_set",
  "Write/update a Satori system config",
  {
    system: z.string().describe("Satori system name"),
    config_json: z.string().describe("Full JSON config"),
  },
  async ({ system, config_json }) => {
    const check = requireAuth();
    if (check) return check;
    let parsed;
    try { parsed = JSON.parse(config_json); } catch (e) {
      return { content: [{ type: "text", text: `Invalid JSON: ${e.message}` }] };
    }
    const r = await rpcCall("admin_satori_config_set", { system, config: parsed });
    return { content: [{ type: "text", text: `Satori config [${system}] saved.\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — PLAYER INSPECTION (highest value tools)
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "player_inspect",
  "Get a full player profile: account info, wallet, inventory, achievements, progression, energy, stats, streaks, tutorials, unlockables, mailbox, Satori identity, and experiment assignments — all in one call.",
  { user_id: z.string().describe("Nakama user ID") },
  async ({ user_id }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_player_inspect", { userId: user_id });
    return { content: [{ type: "text", text: `Player profile [${user_id}]:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "player_search",
  "Search for a player by username",
  { username: z.string().describe("Username to search for") },
  async ({ username }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_user_search", { username });
    return { content: [{ type: "text", text: `User search [${username}]:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — WALLET OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "wallet_view",
  "View a player's wallet (all currencies and balances)",
  { user_id: z.string().describe("Nakama user ID") },
  async ({ user_id }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_wallet_view", { userId: user_id });
    return { content: [{ type: "text", text: `Wallet [${user_id}]:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "wallet_grant",
  "Grant currencies to a player's wallet. Use for testing economy flows.",
  {
    user_id: z.string().describe("Nakama user ID"),
    currencies_json: z.string().describe('JSON object of currency grants, e.g. {"coins": 1000, "gems": 50}'),
  },
  async ({ user_id, currencies_json }) => {
    const check = requireAuth();
    if (check) return check;
    let currencies;
    try { currencies = JSON.parse(currencies_json); } catch (e) {
      return { content: [{ type: "text", text: `Invalid JSON: ${e.message}` }] };
    }
    const r = await rpcCall("admin_wallet_grant", { userId: user_id, currencies });
    return { content: [{ type: "text", text: `Wallet grant result:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "wallet_reset",
  "Reset a player's wallet to default values",
  {
    user_id: z.string().describe("Nakama user ID"),
    defaults_json: z.string().optional().describe('Optional default balances, e.g. {"coins": 0}'),
  },
  async ({ user_id, defaults_json }) => {
    const check = requireAuth();
    if (check) return check;
    const defaults = defaults_json ? JSON.parse(defaults_json) : {};
    const r = await rpcCall("admin_wallet_reset", { userId: user_id, defaults });
    return { content: [{ type: "text", text: `Wallet reset:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — INVENTORY ADMIN
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "inventory_grant",
  "Grant an inventory item to a player (for testing/rewards)",
  {
    user_id: z.string().describe("Nakama user ID"),
    item_id: z.string().describe("Item ID to grant"),
    quantity: z.number().optional().describe("Quantity (default 1)"),
    properties_json: z.string().optional().describe("Optional item properties JSON"),
  },
  async ({ user_id, item_id, quantity, properties_json }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { userId: user_id, itemId: item_id, quantity: quantity || 1 };
    if (properties_json) payload.properties = JSON.parse(properties_json);
    const r = await rpcCall("admin_inventory_grant", payload);
    return { content: [{ type: "text", text: `Inventory grant:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — MAILBOX
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "mailbox_send",
  "Send an admin message to a player's mailbox (with optional rewards)",
  {
    user_id: z.string().describe("Nakama user ID"),
    subject: z.string().describe("Message subject"),
    body: z.string().optional().describe("Message body"),
    rewards_json: z.string().optional().describe("Optional rewards array JSON"),
    expires_in_sec: z.number().optional().describe("Optional expiry in seconds"),
  },
  async ({ user_id, subject, body, rewards_json, expires_in_sec }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { userId: user_id, subject, body };
    if (rewards_json) payload.rewards = JSON.parse(rewards_json);
    if (expires_in_sec) payload.expiresInSec = expires_in_sec;
    const r = await rpcCall("admin_mailbox_send", payload);
    return { content: [{ type: "text", text: `Mailbox send:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — FEATURE FLAGS (high-value for iteration)
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "flag_toggle",
  "Toggle a feature flag on/off, or create a new flag with a value",
  {
    name: z.string().describe("Flag name"),
    enabled: z.boolean().optional().describe("Set enabled state (omit to toggle)"),
    value: z.string().optional().describe("Flag value (required when creating a new flag)"),
    audiences_json: z.string().optional().describe("Optional audience IDs JSON array"),
  },
  async ({ name, enabled, value, audiences_json }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { name };
    if (enabled !== undefined) payload.enabled = enabled;
    if (value !== undefined) payload.value = value;
    if (audiences_json) payload.audiences = JSON.parse(audiences_json);
    const r = await rpcCall("admin_flag_toggle", payload);
    return { content: [{ type: "text", text: `Flag toggle [${name}]:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10 — LIVE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "live_event_schedule",
  "Create or update a live event with timing, rewards, and audience targeting",
  {
    id: z.string().describe("Event ID"),
    name: z.string().describe("Event display name"),
    description: z.string().optional().describe("Event description"),
    start_time_sec: z.number().optional().describe("Unix start time (defaults to now)"),
    end_time_sec: z.number().optional().describe("Unix end time (defaults to now + 24h)"),
    rewards_json: z.string().optional().describe("Rewards array JSON"),
    audiences_json: z.string().optional().describe("Audience IDs JSON array"),
    enabled: z.boolean().optional().describe("Whether event is enabled (default true)"),
  },
  async ({ id, name, description, start_time_sec, end_time_sec, rewards_json, audiences_json, enabled }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { id, name };
    if (description) payload.description = description;
    if (start_time_sec) payload.startTimeSec = start_time_sec;
    if (end_time_sec) payload.endTimeSec = end_time_sec;
    if (rewards_json) payload.rewards = JSON.parse(rewards_json);
    if (audiences_json) payload.audiences = JSON.parse(audiences_json);
    if (enabled !== undefined) payload.enabled = enabled;
    const r = await rpcCall("admin_live_event_schedule", payload);
    return { content: [{ type: "text", text: `Live event [${id}]:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11 — EXPERIMENTS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "experiment_setup",
  "Create or update an A/B experiment with variant definitions",
  {
    id: z.string().describe("Experiment ID"),
    name: z.string().describe("Experiment display name"),
    variants_json: z.string().describe('Variants array JSON, e.g. [{"name":"control","weight":50,"data":{}},{"name":"variant_a","weight":50,"data":{}}]'),
    description: z.string().optional(),
    audiences_json: z.string().optional().describe("Audience IDs JSON array"),
    enabled: z.boolean().optional(),
  },
  async ({ id, name, variants_json, description, audiences_json, enabled }) => {
    const check = requireAuth();
    if (check) return check;
    let variants;
    try { variants = JSON.parse(variants_json); } catch (e) {
      return { content: [{ type: "text", text: `Invalid variants JSON: ${e.message}` }] };
    }
    const payload = { id, name, variants };
    if (description) payload.description = description;
    if (audiences_json) payload.audiences = JSON.parse(audiences_json);
    if (enabled !== undefined) payload.enabled = enabled;
    const r = await rpcCall("admin_experiment_setup", payload);
    return { content: [{ type: "text", text: `Experiment [${id}]:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12 — SATORI EVENTS TIMELINE
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "events_timeline",
  "View recent Satori analytics events for a player (chronological)",
  {
    user_id: z.string().describe("Nakama user ID"),
    limit: z.number().optional().describe("Max events to return (default 50)"),
  },
  async ({ user_id, limit }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_events_timeline", { userId: user_id, limit: limit || 50 });
    return { content: [{ type: "text", text: `Events timeline [${user_id}]:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13 — STORAGE BROWSER
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "storage_list",
  "Browse a Nakama storage collection. Lists keys with value previews.",
  {
    collection: z.string().describe("Storage collection, e.g. hiro_configs, satori_configs, hiro_inventory"),
    user_id: z.string().optional().describe("User ID (omit for system-owned)"),
    limit: z.number().optional().describe("Max records (default 50)"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ collection, user_id, limit, cursor }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { collection };
    if (user_id) payload.userId = user_id;
    if (limit) payload.limit = limit;
    if (cursor) payload.cursor = cursor;
    const r = await rpcCall("admin_storage_list", payload);
    return { content: [{ type: "text", text: `Storage [${collection}]:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "storage_read",
  "Read a specific Nakama storage object by collection + key + user",
  {
    collection: z.string().describe("Storage collection"),
    key: z.string().describe("Storage key"),
    user_id: z.string().optional().describe("User ID (omit for system-owned)"),
  },
  async ({ collection, key, user_id }) => {
    const check = requireAuth();
    if (check) return check;
    const uid = user_id || "00000000-0000-0000-0000-000000000000";
    const r = await rpcCall("admin_user_data_get", { userId: uid, collection, key });
    return { content: [{ type: "text", text: `Storage [${collection}/${key}] (user: ${uid}):\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "storage_write",
  "Write a Nakama storage object",
  {
    collection: z.string().describe("Storage collection"),
    key: z.string().describe("Storage key"),
    value_json: z.string().describe("JSON value to write"),
    user_id: z.string().optional().describe("User ID (omit for system-owned)"),
  },
  async ({ collection, key, value_json, user_id }) => {
    const check = requireAuth();
    if (check) return check;
    let parsed;
    try { parsed = JSON.parse(value_json); } catch (e) {
      return { content: [{ type: "text", text: `Invalid JSON: ${e.message}` }] };
    }
    const uid = user_id || "00000000-0000-0000-0000-000000000000";
    const r = await rpcCall("admin_user_data_set", { userId: uid, collection, key, data: parsed });
    return { content: [{ type: "text", text: `Written [${collection}/${key}].\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14 — BULK EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "config_export",
  "Export all Hiro + Satori configs as a single JSON bundle",
  {},
  async () => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_bulk_export", {});
    return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
  }
);

server.tool(
  "config_import",
  "Import a full Hiro + Satori config bundle",
  { bundle_json: z.string().describe("Full JSON bundle from config_export") },
  async ({ bundle_json }) => {
    const check = requireAuth();
    if (check) return check;
    let parsed;
    try { parsed = JSON.parse(bundle_json); } catch (e) {
      return { content: [{ type: "text", text: `Invalid JSON: ${e.message}` }] };
    }
    const r = await rpcCall("admin_bulk_import", parsed);
    return { content: [{ type: "text", text: `Import result:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15 — CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "cache_invalidate",
  "Force-reload Hiro and Satori configs from storage (invalidate in-memory cache)",
  { system: z.string().optional().describe("Specific system to invalidate (omit for all)") },
  async ({ system }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("admin_cache_invalidate", { system });
    return { content: [{ type: "text", text: `Cache invalidated.\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16 — BUILD & DEPLOY
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "nakama_build",
  "Build the TypeScript modules (runs npm run build in data/modules/)",
  {},
  async () => {
    try {
      const output = execSync("npm run build 2>&1", {
        cwd: NAKAMA_MODULES_DIR,
        timeout: 30000,
        encoding: "utf-8",
      });
      return { content: [{ type: "text", text: `Build succeeded\n${output}` }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Build failed\n${e.stdout || ""}\n${e.stderr || e.message}` }],
      };
    }
  }
);

server.tool(
  "nakama_restart",
  "Restart the Nakama Docker container to pick up new builds",
  {},
  async () => {
    try {
      const output = execSync("docker compose restart nakama 2>&1", {
        cwd: NAKAMA_PROJECT_DIR,
        timeout: 60000,
        encoding: "utf-8",
      });
      return { content: [{ type: "text", text: `Nakama restarted\n${output}` }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Restart failed\n${e.stdout || ""}\n${e.stderr || e.message}` }],
      };
    }
  }
);

server.tool(
  "nakama_build_deploy",
  "Build TypeScript modules AND restart Nakama in one step",
  {},
  async () => {
    let buildOutput;
    try {
      buildOutput = execSync("npm run build 2>&1", {
        cwd: NAKAMA_MODULES_DIR,
        timeout: 30000,
        encoding: "utf-8",
      });
    } catch (e) {
      return {
        content: [{ type: "text", text: `Build failed — not restarting.\n${e.stdout || ""}\n${e.stderr || e.message}` }],
      };
    }

    let restartOutput;
    try {
      restartOutput = execSync("docker compose restart nakama 2>&1", {
        cwd: NAKAMA_PROJECT_DIR,
        timeout: 60000,
        encoding: "utf-8",
      });
    } catch (e) {
      return {
        content: [{ type: "text", text: `Build succeeded but restart failed.\nBuild:\n${buildOutput}\nRestart:\n${e.stdout || ""}\n${e.stderr || e.message}` }],
      };
    }

    return {
      content: [{ type: "text", text: `Build + Deploy succeeded\n\nBuild:\n${buildOutput}\nRestart:\n${restartOutput}` }],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 17 — RPC DIRECTORY
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "nakama_rpc_list",
  "List all registered RPC endpoints with descriptions, grouped by system",
  {},
  async () => {
    const rpcs = {
      "Hiro Economy": [
        "hiro_economy_donation_request  - Create donation request",
        "hiro_economy_donation_give     - Contribute to donation",
        "hiro_economy_donation_claim    - Claim completed donations",
        "hiro_economy_rewarded_video    - Complete rewarded video ad",
      ],
      "Hiro Inventory": [
        "hiro_inventory_list    - List items",
        "hiro_inventory_grant   - Grant item",
        "hiro_inventory_consume - Consume item",
      ],
      "Hiro Achievements": [
        "hiro_achievements_list     - List achievements + progress",
        "hiro_achievements_progress - Add progress",
        "hiro_achievements_claim    - Claim reward",
      ],
      "Hiro Progression": [
        "hiro_progression_get    - Get XP/level/prestige",
        "hiro_progression_add_xp - Add XP",
      ],
      "Hiro Energy": [
        "hiro_energy_get    - Get energy states",
        "hiro_energy_spend  - Spend energy",
        "hiro_energy_refill - Refill to max",
      ],
      "Hiro Stats": [
        "hiro_stats_get    - Get stats",
        "hiro_stats_update - Update stat",
      ],
      "Hiro Streaks": [
        "hiro_streaks_get    - Get streak states",
        "hiro_streaks_update - Increment streak",
        "hiro_streaks_claim  - Claim milestone reward",
      ],
      "Hiro Event Leaderboards": [
        "hiro_event_lb_list   - List active events",
        "hiro_event_lb_submit - Submit score",
        "hiro_event_lb_claim  - Claim tier reward",
      ],
      "Hiro Store": [
        "hiro_store_list     - List store items",
        "hiro_store_purchase - Purchase item",
      ],
      "Hiro Challenges": [
        "hiro_challenges_create - Create challenge",
        "hiro_challenges_join   - Join challenge",
        "hiro_challenges_submit - Submit score",
        "hiro_challenges_claim  - Claim reward",
      ],
      "Hiro Teams": [
        "hiro_teams_get           - Get team data",
        "hiro_teams_stats         - Update team stat",
        "hiro_teams_wallet_get    - Get team wallet",
        "hiro_teams_wallet_update - Update team wallet",
        "hiro_teams_achievements  - Get team achievements",
      ],
      "Hiro Tutorials": [
        "hiro_tutorials_get     - Get tutorial progress",
        "hiro_tutorials_advance - Advance step",
      ],
      "Hiro Unlockables": [
        "hiro_unlockables_get      - Get unlock slots",
        "hiro_unlockables_start    - Start unlock",
        "hiro_unlockables_claim    - Claim completed",
        "hiro_unlockables_buy_slot - Buy extra slot",
      ],
      "Hiro Auctions": [
        "hiro_auctions_list    - List auctions",
        "hiro_auctions_create  - Create listing",
        "hiro_auctions_bid     - Place bid",
        "hiro_auctions_resolve - Resolve auction",
      ],
      "Hiro Incentives": [
        "hiro_incentives_referral_code  - Get/create referral code",
        "hiro_incentives_apply_referral - Apply referral",
        "hiro_incentives_return_bonus   - Check/claim return bonus",
      ],
      "Hiro Mailbox": [
        "hiro_mailbox_list      - List inbox messages",
        "hiro_mailbox_claim     - Claim message reward",
        "hiro_mailbox_claim_all - Claim all rewards",
        "hiro_mailbox_delete    - Delete message",
      ],
      "Satori Event Capture": [
        "satori_event        - Capture event",
        "satori_events_batch - Capture batch",
      ],
      "Satori Identity": [
        "satori_identity_get              - Get identity",
        "satori_identity_update_properties - Update properties",
      ],
      "Satori Audiences": [
        "satori_audiences_get_memberships - Get memberships",
        "satori_audiences_compute         - Compute audience",
      ],
      "Satori Feature Flags": [
        "satori_flags_get     - Get one flag",
        "satori_flags_get_all - Get all flags",
        "satori_flags_set     - Create/update flag",
      ],
      "Satori Experiments": [
        "satori_experiments_get         - Get experiments",
        "satori_experiments_get_variant - Get variant",
      ],
      "Satori Live Events": [
        "satori_live_events_list  - List events",
        "satori_live_events_join  - Join event",
        "satori_live_events_claim - Claim reward",
      ],
      "Satori Messages": [
        "satori_messages_list   - List messages",
        "satori_messages_read   - Mark read + claim",
        "satori_messages_delete - Delete message",
      ],
      "Satori Metrics": [
        "satori_metrics_query  - Query metrics",
        "satori_metrics_define - Define metric",
      ],
      "Admin (Player Tools)": [
        "admin_player_inspect  - Full player profile",
        "admin_user_search     - Search by username",
        "admin_wallet_view     - View wallet",
        "admin_wallet_grant    - Grant currencies",
        "admin_wallet_reset    - Reset wallet",
        "admin_inventory_grant - Grant inventory item",
        "admin_mailbox_send    - Send mailbox message",
      ],
      "Admin (Config)": [
        "admin_config_get         - Read Hiro config",
        "admin_config_set         - Write Hiro config",
        "admin_config_delete      - Delete Hiro config",
        "admin_satori_config_get  - Read Satori config",
        "admin_satori_config_set  - Write Satori config",
        "admin_bulk_export        - Export all configs",
        "admin_bulk_import        - Import config bundle",
        "admin_cache_invalidate   - Invalidate caches",
      ],
      "Admin (Satori Quick-Ops)": [
        "admin_flag_toggle        - Toggle feature flag",
        "admin_live_event_schedule- Schedule live event",
        "admin_experiment_setup   - Setup A/B experiment",
        "admin_events_timeline    - View player events",
        "satori_messages_broadcast- Broadcast messages",
        "satori_metrics_set_alert - Set metric alert",
        "satori_metrics_prometheus- Prometheus export",
      ],
      "Hiro Personalizer": [
        "hiro_personalizer_set_override    - Set per-user override",
        "hiro_personalizer_remove_override - Remove override",
        "hiro_personalizer_get_overrides   - Get all overrides",
        "hiro_personalizer_preview         - Preview personalized config",
      ],
      "Hiro Reward Buckets": [
        "hiro_reward_bucket_get      - Get buckets",
        "hiro_reward_bucket_progress - Add progress",
        "hiro_reward_bucket_unlock   - Unlock tier",
      ],
      "Hiro Base (IAP)": [
        "hiro_iap_validate - Validate IAP receipt",
        "hiro_iap_history  - Get purchase history",
      ],
      "Hiro Leaderboards": [
        "hiro_leaderboards_list    - List leaderboards",
        "hiro_leaderboards_submit  - Submit score",
        "hiro_leaderboards_records - Get records (with geo filter)",
      ],
      "Admin (Storage)": [
        "admin_storage_list       - Browse collection",
        "admin_user_data_get      - Read storage object",
        "admin_user_data_set      - Write storage object",
        "admin_user_data_delete   - Delete storage object",
      ],
      "Admin (System)": [
        "admin_health_check       - Server health + systems",
      ],
    };

    let text = "--- Registered RPC Endpoints ---\n\n";
    for (const [group, list] of Object.entries(rpcs)) {
      text += `[${group}]\n`;
      for (const line of list) {
        text += `  ${line}\n`;
      }
      text += "\n";
    }
    return { content: [{ type: "text", text }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 18 — ACCOUNT SELF-INFO
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "nakama_account",
  "Get the account details of the currently authenticated user",
  {},
  async () => {
    const check = requireAuth();
    if (check) return check;
    const r = await httpJson("GET", `${NAKAMA_HTTP}/v2/account`, null, bearerHeader());
    return { content: [{ type: "text", text: `Account:\n${JSON.stringify(r.data, null, 2)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19 — PERSONALIZER TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "personalizer_preview",
  "Preview how a Hiro config looks for a specific player after personalizer overrides (storage + Satori flags + experiments)",
  {
    user_id: z.string().describe("Nakama user ID"),
    system: z.string().describe("Hiro system name, e.g. economy, store, achievements"),
  },
  async ({ user_id, system }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("hiro_personalizer_preview", { userId: user_id, system });
    return { content: [{ type: "text", text: `Personalized config [${system}] for ${user_id}:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "personalizer_set_override",
  "Set a per-user config override for a Hiro system (e.g. change store prices for one player)",
  {
    user_id: z.string().describe("Nakama user ID"),
    system: z.string().describe("Hiro system name"),
    path: z.string().describe("Dot-separated config path, e.g. 'sections.shop.items.sword.cost.currencies.coins'"),
    value: z.string().describe("JSON value to set at the path"),
  },
  async ({ user_id, system, path, value }) => {
    const check = requireAuth();
    if (check) return check;
    let parsed;
    try { parsed = JSON.parse(value); } catch { parsed = value; }
    const r = await rpcCall("hiro_personalizer_set_override", { userId: user_id, system, path, value: parsed });
    return { content: [{ type: "text", text: `Override set:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20 — REWARD BUCKET TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "reward_bucket_progress",
  "Add progress to a player's reward bucket (piggy bank)",
  {
    user_id: z.string().describe("Nakama user ID"),
    bucket_id: z.string().describe("Reward bucket ID"),
    amount: z.number().describe("Progress amount to add"),
  },
  async ({ user_id, bucket_id, amount }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("hiro_reward_bucket_progress", { bucketId: bucket_id, amount });
    return { content: [{ type: "text", text: `Bucket progress:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 21 — MESSAGE BROADCAST
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "message_broadcast",
  "Broadcast a Satori message to an audience or schedule it for later delivery",
  {
    title: z.string().describe("Message title"),
    body: z.string().optional().describe("Message body"),
    audience_id: z.string().optional().describe("Audience ID for targeted delivery"),
    rewards_json: z.string().optional().describe("Optional rewards JSON"),
    schedule_at: z.number().optional().describe("Unix timestamp for scheduled delivery"),
  },
  async ({ title, body, audience_id, rewards_json, schedule_at }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { title, body };
    if (audience_id) payload.audienceId = audience_id;
    if (rewards_json) payload.reward = JSON.parse(rewards_json);
    if (schedule_at) payload.scheduleAt = schedule_at;
    const r = await rpcCall("satori_messages_broadcast", payload);
    return { content: [{ type: "text", text: `Broadcast:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 22 — METRICS ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "metrics_set_alert",
  "Set up a metric alert threshold (triggers when metric crosses threshold)",
  {
    metric_id: z.string().describe("Metric ID to monitor"),
    name: z.string().describe("Alert name"),
    threshold: z.number().describe("Threshold value"),
    operator: z.string().describe("Comparison operator: gt, lt, gte, lte"),
  },
  async ({ metric_id, name, threshold, operator }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_metrics_set_alert", { metricId: metric_id, name, threshold, operator });
    return { content: [{ type: "text", text: `Alert set:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "metrics_prometheus",
  "Get all metrics in Prometheus text exposition format",
  {},
  async () => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_metrics_prometheus", {});
    const text = r?.data?.text || fmtResponse(r);
    return { content: [{ type: "text", text: `Prometheus metrics:\n${text}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 23 — WEBHOOKS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "webhooks_list",
  "List all configured outbound webhooks",
  {},
  async () => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_webhooks_list", {});
    return { content: [{ type: "text", text: `Webhooks:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "webhooks_upsert",
  "Create or update an outbound webhook (dispatches on game events to external URLs)",
  {
    id: z.string().describe("Webhook ID"),
    url: z.string().describe("Target URL"),
    events: z.string().describe("JSON array of event names to trigger on, e.g. [\"currency_earned\",\"store_purchase\"] or [\"*\"] for all"),
    secret: z.string().optional().describe("HMAC-SHA256 signing secret"),
    enabled: z.boolean().optional().describe("Whether webhook is enabled (default true)"),
  },
  async ({ id, url, events, secret, enabled }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_webhooks_upsert", { id, url, events: JSON.parse(events), secret, enabled });
    return { content: [{ type: "text", text: `Webhook upserted:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "webhooks_delete",
  "Delete an outbound webhook",
  { id: z.string().describe("Webhook ID to delete") },
  async ({ id }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_webhooks_delete", { id });
    return { content: [{ type: "text", text: `Webhook deleted:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "webhooks_test",
  "Send a test ping to a configured webhook",
  { id: z.string().describe("Webhook ID to test") },
  async ({ id }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_webhooks_test", { id });
    return { content: [{ type: "text", text: `Webhook test:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 24 — EVENT TAXONOMY
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "taxonomy_schemas",
  "List all event schemas (event taxonomy definitions with required/optional metadata, types, and categories)",
  { category: z.string().optional().describe("Filter by category") },
  async ({ category }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = category ? { category } : {};
    const r = await rpcCall("satori_taxonomy_schemas", payload);
    return { content: [{ type: "text", text: `Event schemas:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "taxonomy_upsert",
  "Create or update an event schema definition (for taxonomy/validation)",
  {
    name: z.string().describe("Event name"),
    description: z.string().optional().describe("Event description"),
    category: z.string().optional().describe("Category: engagement, monetization, progression, social, system, custom"),
    required_metadata: z.string().optional().describe("JSON array of required metadata keys"),
    metadata_types: z.string().optional().describe("JSON object of key→type mappings, e.g. {\"amount\": \"number\"}"),
    deprecated: z.boolean().optional().describe("Mark event as deprecated"),
  },
  async ({ name, description, category, required_metadata, metadata_types, deprecated }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { name, description, category, deprecated };
    if (required_metadata) payload.requiredMetadata = JSON.parse(required_metadata);
    if (metadata_types) payload.metadataTypes = JSON.parse(metadata_types);
    const r = await rpcCall("satori_taxonomy_upsert", payload);
    return { content: [{ type: "text", text: `Schema upserted:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "taxonomy_delete",
  "Delete an event schema from the taxonomy",
  { name: z.string().describe("Event name to delete") },
  async ({ name }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_taxonomy_delete", { name });
    return { content: [{ type: "text", text: `Schema deleted:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "taxonomy_validate",
  "Validate an event against its schema (test without capturing)",
  {
    name: z.string().describe("Event name"),
    metadata: z.string().optional().describe("JSON metadata object to validate"),
  },
  async ({ name, metadata }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { name };
    if (metadata) payload.metadata = JSON.parse(metadata);
    const r = await rpcCall("satori_taxonomy_validate", payload);
    return { content: [{ type: "text", text: `Validation result:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "taxonomy_strict_mode",
  "Enable/disable strict mode (rejects events without a defined schema)",
  { enforce_strict: z.boolean().describe("true=reject unknown events, false=allow") },
  async ({ enforce_strict }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_taxonomy_strict_mode", { enforceStrict: enforce_strict });
    return { content: [{ type: "text", text: `Strict mode:\n${fmtResponse(r)}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 25 — DATA LAKE EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "datalake_config",
  "View data lake export configuration (targets, retention, enabled state)",
  {},
  async () => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_datalake_config", {});
    return { content: [{ type: "text", text: `Data Lake config:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "datalake_upsert_target",
  "Add or update a data lake export target (BigQuery, Snowflake, Redshift, S3)",
  {
    id: z.string().describe("Target ID"),
    type: z.string().describe("Export type: bigquery, snowflake, redshift, s3"),
    config_json: z.string().describe("JSON config for the target (endpoint, bucket, apiKey, etc.)"),
    event_filters: z.string().optional().describe("JSON array of event name filters (empty = all)"),
    enabled: z.boolean().optional().describe("Whether target is enabled"),
  },
  async ({ id, type, config_json, event_filters, enabled }) => {
    const check = requireAuth();
    if (check) return check;
    const payload = { id, type, config: JSON.parse(config_json), enabled };
    if (event_filters) payload.eventFilters = JSON.parse(event_filters);
    const r = await rpcCall("satori_datalake_upsert_target", payload);
    return { content: [{ type: "text", text: `Target upserted:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "datalake_delete_target",
  "Delete a data lake export target",
  { id: z.string().describe("Target ID to delete") },
  async ({ id }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_datalake_delete_target", { id });
    return { content: [{ type: "text", text: `Target deleted:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "datalake_toggle",
  "Enable or disable data lake export globally",
  { enabled: z.boolean().describe("Enable/disable global export") },
  async ({ enabled }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_datalake_set_enabled", { enabled });
    return { content: [{ type: "text", text: `Data lake toggle:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "datalake_set_retention",
  "Set data retention period in days",
  { days: z.number().describe("Retention period in days") },
  async ({ days }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_datalake_set_retention", { days });
    return { content: [{ type: "text", text: `Retention set:\n${fmtResponse(r)}` }] };
  }
);

server.tool(
  "datalake_manual_export",
  "Trigger a manual export of recent events to all configured targets",
  { limit: z.number().optional().describe("Max events to export (default 500)") },
  async ({ limit }) => {
    const check = requireAuth();
    if (check) return check;
    const r = await rpcCall("satori_datalake_manual_export", { limit: limit || 500 });
    return { content: [{ type: "text", text: `Manual export:\n${fmtResponse(r)}` }] };
  }
);

// ─── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
