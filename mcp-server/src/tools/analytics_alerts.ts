import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaApiClient } from "../client.js";

/**
 * Safe RPC wrapper — returns a structured error object instead of throwing,
 * so MCP clients always get a useful response.
 */
async function safeRpc(api: NakamaApiClient, rpc: string, payload: unknown = {}): Promise<any> {
  try {
    return await api.callRpc(rpc, payload);
  } catch (e: any) {
    return { _error: e?.message ?? String(e), _rpc: rpc };
  }
}

/**
 * MCP tools that visualize the AnalyticsAlerts module living inside the Nakama runtime
 * (data/modules/src/satori/analytics-alerts.ts).
 *
 * Mapping (MCP tool → runtime RPC):
 *   nakama_analytics_status       → nakama_analytics_status
 *   nakama_analytics_recent       → nakama_analytics_recent
 *   nakama_analytics_summary      → nakama_analytics_summary
 *   nakama_analytics_top_slow     → nakama_analytics_top_slow
 *   nakama_analytics_top_errors   → nakama_analytics_top_errors
 *   nakama_analytics_force_post   → nakama_analytics_force_post
 *   nakama_analytics_tick         → nakama_analytics_tick
 *   nakama_analytics_overview     → composite (status + summary + top_slow + top_errors)
 */
export function registerAnalyticsAlertsTools(
  server: McpServer,
  api: NakamaApiClient,
) {
  server.tool(
    "nakama_analytics_status",
    "Inspect the in-runtime AnalyticsAlerts scheduler: webhook config, buffer state, last posted slot, current open slot, totals (recorded/flushed/errors), and per-pod identity. Use this first when debugging Discord summary delivery.",
    {},
    async () => {
      const data = await safeRpc(api, "nakama_analytics_status", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "nakama_analytics_recent",
    "Fetch raw RPC samples captured by the analytics interceptor over the last N minutes. Each sample includes timestamp, RPC id, group (hiro/satori/cricket/...), latency in ms, success flag, and optional error message. Use to spot live spikes between Discord summaries.",
    {
      minutes: z
        .number()
        .min(1)
        .max(24 * 60)
        .optional()
        .describe("Look-back window in minutes (default 60, max 1440)"),
      limit: z
        .number()
        .min(1)
        .max(5000)
        .optional()
        .describe("Max samples to return (default 500, max 5000)"),
    },
    async ({ minutes, limit }) => {
      const data = await safeRpc(api, "nakama_analytics_recent", { minutes, limit });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "nakama_analytics_summary",
    "Compute an aggregated RPC summary over the last N hours: overall counts, success/error rate, p50/p90/p99/avg latency, and breakdowns by group and by RPC id. This is the same shape that gets posted to Discord every 3 hours.",
    {
      hours: z
        .number()
        .min(1)
        .max(72)
        .optional()
        .describe("Window in hours (default 3, max 72)"),
    },
    async ({ hours }) => {
      const data = await safeRpc(api, "nakama_analytics_summary", { hours });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "nakama_analytics_top_slow",
    "Return the top-N slowest RPCs over the last N hours, ranked by p99 latency (with p50/p90/avg + call count). Filter out noise via minCalls. Useful for finding regressions.",
    {
      hours: z.number().min(1).max(72).optional().describe("Window in hours (default 3)"),
      top: z.number().min(1).max(50).optional().describe("How many RPCs to return (default 10)"),
      minCalls: z
        .number()
        .min(1)
        .max(10000)
        .optional()
        .describe("Minimum call count to be eligible (default 5)"),
    },
    async ({ hours, top, minCalls }) => {
      const data = await safeRpc(api, "nakama_analytics_top_slow", { hours, top, minCalls });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "nakama_analytics_top_errors",
    "Return the top-N error-prone RPCs over the last N hours, ranked by error rate (with sample error messages). Useful for incident triage.",
    {
      hours: z.number().min(1).max(72).optional().describe("Window in hours (default 3)"),
      top: z.number().min(1).max(50).optional().describe("How many RPCs to return (default 10)"),
    },
    async ({ hours, top }) => {
      const data = await safeRpc(api, "nakama_analytics_top_errors", { hours, top });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "nakama_analytics_force_post",
    "Force-publish an RPC analytics summary embed to the configured Discord webhook for a specific cron-aligned slot. Defaults to the last fully-closed slot. Use to recover missed posts or to test the webhook end-to-end.",
    {
      slotStartIso: z
        .string()
        .optional()
        .describe(
          "ISO-8601 start of the slot to summarize (e.g. 2026-04-20T18:00:00.000Z). If omitted, uses the last closed slot.",
        ),
      slotStartMs: z
        .number()
        .optional()
        .describe("Alternative: slot start as Unix epoch ms"),
    },
    async ({ slotStartIso, slotStartMs }) => {
      const payload: Record<string, unknown> = {};
      if (slotStartIso) payload.slotStartIso = slotStartIso;
      if (typeof slotStartMs === "number") payload.slotStartMs = slotStartMs;
      const data = await safeRpc(api, "nakama_analytics_force_post", payload);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "nakama_analytics_tick",
    "Manually invoke the analytics scheduler tick (lock acquisition → buffer flush → close-slot post → cleanup). Safe to call from external cron (e.g. k8s CronJob) every 30-60s. Returns whether this pod won the leader lock and what work it performed.",
    {},
    async () => {
      const data = await safeRpc(api, "nakama_analytics_tick", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "nakama_analytics_overview",
    "One-shot composite view of analytics health: scheduler status + N-hour summary + top-slow + top-errors, all bundled. Use when an operator just wants 'show me everything right now'.",
    {
      hours: z.number().min(1).max(72).optional().describe("Window in hours (default 3)"),
      topSlow: z.number().min(1).max(50).optional().describe("Top slow RPCs to include (default 10)"),
      topErrors: z.number().min(1).max(50).optional().describe("Top error RPCs to include (default 10)"),
      minCalls: z.number().min(1).max(10000).optional().describe("Min calls for top-slow (default 5)"),
    },
    async ({ hours, topSlow, topErrors, minCalls }) => {
      const h = hours ?? 3;
      const [status, summary, slow, errors] = await Promise.all([
        safeRpc(api, "nakama_analytics_status", {}),
        safeRpc(api, "nakama_analytics_summary", { hours: h }),
        safeRpc(api, "nakama_analytics_top_slow", { hours: h, top: topSlow ?? 10, minCalls: minCalls ?? 5 }),
        safeRpc(api, "nakama_analytics_top_errors", { hours: h, top: topErrors ?? 10 }),
      ]);

      const overview = {
        windowHours: h,
        generatedAt: new Date().toISOString(),
        scheduler: status,
        summary,
        topSlow: slow,
        topErrors: errors,
      };
      return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
    },
  );
}
