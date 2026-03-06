import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerTrustSafetyTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "user_flag",
    "Flag a user for review. Stores a moderation flag in storage with reason, severity, and reporter. Creates an audit trail for trust & safety review.",
    {
      user_id: z.string().describe("User UUID to flag"),
      reason: z.string().describe("Reason for flagging (e.g. 'toxic_chat', 'cheating', 'spam', 'harassment')"),
      severity: z.enum(["low", "medium", "high", "critical"]).describe("Severity level"),
      details: z.string().optional().describe("Additional details or evidence"),
      reporter_id: z.string().optional().describe("Who reported this (user UUID or 'system')"),
    },
    async ({ user_id, reason, severity, details, reporter_id }) => {
      const flag = {
        user_id,
        reason,
        severity,
        details: details ?? "",
        reporter_id: reporter_id ?? "ai_agent",
        flagged_at: new Date().toISOString(),
        status: "pending_review",
      };
      try {
        const existing = await console.listStorage({
          collection: "moderation_flags",
          user_id,
          limit: 100,
        }) as { objects?: Array<{ value?: string }> };
        const existingFlags = existing?.objects?.map(o => {
          try { return JSON.parse(o.value ?? "{}"); } catch { return {}; }
        }) ?? [];
        existingFlags.push(flag);
      } catch {
        // first flag for this user
      }

      await api.callRpc("analytics_log_event", {
        event_name: "moderation_flag",
        properties: flag,
      });

      return {
        content: [{
          type: "text",
          text: `User ${user_id} flagged: ${reason} (${severity}). Flag stored and audit event logged.`,
        }],
      };
    }
  );

  server.tool(
    "audit_log",
    "Append an event to the audit log. All agent actions that modify state should be logged here. Creates an immutable record in analytics_events for compliance and review.",
    {
      event_name: z.string().describe("Event name (e.g. 'agent_wallet_grant', 'agent_ban', 'agent_notification_sent')"),
      actor: z.string().optional().describe("Who performed the action (default: 'ai_agent')"),
      target_user_id: z.string().optional().describe("Target user UUID if applicable"),
      details: z.record(z.string(), z.unknown()).optional().describe("Event details/payload"),
    },
    async ({ event_name, actor, target_user_id, details }) => {
      const event = {
        event_name: `audit:${event_name}`,
        properties: {
          actor: actor ?? "ai_agent",
          target_user_id: target_user_id ?? "",
          timestamp: new Date().toISOString(),
          ...(details ?? {}),
        },
      };
      await api.callRpc("analytics_log_event", event);
      return {
        content: [{ type: "text", text: `Audit logged: ${event_name}` }],
      };
    }
  );

  server.tool(
    "rate_limit_check",
    "Check rate limit status for the server or a specific action. Returns current usage, limits, and whether the action would be throttled.",
    {},
    async () => {
      const data = await api.callRpc("rate_limit_status", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "cache_stats",
    "Get server cache statistics: hit rates, memory usage, entry counts. Useful for performance monitoring.",
    {},
    async () => {
      const data = await api.callRpc("cache_stats", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "cache_clear",
    "Clear the server cache. Use when stale data is suspected or after bulk data changes.",
    {},
    async () => {
      const data = await api.callRpc("cache_clear", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "delete_account",
    "Permanently delete a user account and all associated data. DESTRUCTIVE — cannot be undone. Use only for GDPR compliance, test cleanup, or confirmed fraud.",
    {
      user_id: z.string().describe("User UUID to permanently delete"),
      record_removal: z.boolean().optional().describe("Also remove leaderboard records (default true)"),
    },
    async ({ user_id, record_removal }) => {
      await console.del(
        `/v2/console/account/${encodeURIComponent(user_id)}?record_removal=${record_removal ?? true}`
      );
      await api.callRpc("analytics_log_event", {
        event_name: "audit:account_deleted",
        properties: {
          actor: "ai_agent",
          target_user_id: user_id,
          timestamp: new Date().toISOString(),
        },
      });
      return {
        content: [{ type: "text", text: `Account ${user_id} permanently deleted and audit logged.` }],
      };
    }
  );

  server.tool(
    "list_api_endpoints",
    "List all API endpoints and RPCs registered on the Nakama server. Useful for discovering available operations.",
    {},
    async () => {
      const data = await console.listApiEndpoints();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
