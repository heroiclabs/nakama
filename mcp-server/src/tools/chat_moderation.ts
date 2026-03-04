import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

async function safeRpc(
  api: NakamaApiClient,
  rpcId: string,
  payload: unknown
): Promise<unknown> {
  try {
    const result = await api.callRpc(rpcId, payload);
    if (typeof result === "object" && result !== null && "payload" in result) {
      const p = (result as Record<string, unknown>).payload;
      if (typeof p === "string") return JSON.parse(p);
      return p;
    }
    return result;
  } catch (err) {
    return { error: String(err) };
  }
}

export function registerChatModerationTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  // =========================================================================
  // Tool 1: scan_chat_channel
  // =========================================================================
  server.tool(
    "scan_chat_channel",
    "Scan a chat channel's recent messages for profanity, spam, and toxic content. Returns flagged messages with severity scores. Use proactively to monitor community health before problems escalate.",
    {
      channel_type: z
        .enum(["group", "direct", "room"])
        .describe("Channel type to scan"),
      channel_id: z.string().describe("Group ID, user pair, or room ID"),
      limit: z.number().int().optional().describe("Max messages to scan (default 50)"),
    },
    async ({ channel_type, channel_id, limit }) => {
      const rpcMap: Record<string, string> = {
        group: "get_group_chat_history",
        direct: "get_direct_message_history",
        room: "get_chat_room_history",
      };

      const history = await safeRpc(api, rpcMap[channel_type], {
        channel_id,
        limit: limit ?? 50,
        cursor: "",
      });

      const messages =
        typeof history === "object" && history !== null && "messages" in history
          ? ((history as Record<string, unknown>).messages as unknown[])
          : [];

      const flagged: unknown[] = [];
      let totalScanned = 0;
      let cleanCount = 0;
      let mildCount = 0;
      let severeCount = 0;

      for (const msg of Array.isArray(messages) ? messages : []) {
        const m = msg as Record<string, unknown>;
        const text = String(m.message || m.content || "");
        if (!text) continue;

        totalScanned++;

        const filterResult = await safeRpc(api, "chat_filter_message", {
          message: text,
        });

        const result = filterResult as Record<string, unknown>;
        const profanity = result.profanity as Record<string, unknown> | undefined;

        if (profanity && profanity.flagged) {
          const severity = String(profanity.severity || "mild");
          if (severity === "severe") severeCount++;
          else mildCount++;

          flagged.push({
            message_id: m.message_id || "unknown",
            user_id: m.user_id || "unknown",
            username: m.username || "unknown",
            text_preview: text.slice(0, 100) + (text.length > 100 ? "..." : ""),
            severity,
            matched_words: profanity.matched_words || [],
            spam_flags:
              result.spam &&
              typeof result.spam === "object" &&
              (result.spam as Record<string, unknown>).flagged
                ? (result.spam as Record<string, unknown>).flags
                : [],
            created_at: m.created_at || null,
          });
        } else {
          cleanCount++;
        }
      }

      const report = {
        channel_type,
        channel_id,
        scan_summary: {
          total_scanned: totalScanned,
          clean: cleanCount,
          mild_violations: mildCount,
          severe_violations: severeCount,
          toxicity_rate:
            totalScanned > 0
              ? Math.round(((mildCount + severeCount) / totalScanned) * 100) +
                "%"
              : "N/A",
        },
        flagged_messages: flagged,
        health_status:
          severeCount > 0
            ? "critical"
            : mildCount > totalScanned * 0.1
            ? "warning"
            : "healthy",
        recommendations: [] as string[],
      };

      if (severeCount > 0) {
        report.recommendations.push(
          `${severeCount} severe violation(s) found. Recommend immediate review and potential banning.`
        );
      }
      if (mildCount > totalScanned * 0.2) {
        report.recommendations.push(
          "High rate of mild violations. Consider enabling auto-filter on this channel."
        );
      }
      if (totalScanned === 0) {
        report.recommendations.push(
          "No messages found in this channel. It may be inactive."
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 2: moderate_reported_messages
  // =========================================================================
  server.tool(
    "moderate_reported_messages",
    "Review and manage reported chat messages. List pending reports, auto-flagged severe content, and take moderation actions (warn, mute, ban). Essential for community safety management.",
    {
      action: z
        .enum(["list_pending", "list_severe", "resolve", "stats"])
        .describe("Action to perform"),
      report_id: z
        .string()
        .optional()
        .describe("Report ID (required for resolve action)"),
      resolution: z
        .enum(["dismiss", "warn", "mute", "ban"])
        .optional()
        .describe("Resolution type (required for resolve action)"),
      notes: z
        .string()
        .optional()
        .describe("Operator notes on the resolution"),
    },
    async ({ action, report_id, resolution, notes }) => {
      if (action === "stats") {
        const data = await safeRpc(api, "chat_moderation_stats", {});
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      if (action === "resolve") {
        if (!report_id || !resolution) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error:
                    "report_id and resolution are required for resolve action",
                }),
              },
            ],
          };
        }

        const data = await safeRpc(api, "chat_moderation_review", {
          action: "resolve",
          report_id,
          resolution,
          notes: notes ?? "",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // list_pending or list_severe
      const statusFilter =
        action === "list_severe" ? "auto_flagged_severe" : "pending";
      const data = await safeRpc(api, "chat_moderation_review", {
        action: "list",
        status: statusFilter,
        limit: 50,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 3: check_message_safety
  // =========================================================================
  server.tool(
    "check_message_safety",
    "Check a specific text message for profanity, spam, and safety violations. Returns the filtered version and severity. Use before sending operator messages or to test filter rules.",
    {
      message: z.string().describe("The message text to check"),
    },
    async ({ message }) => {
      const data = await safeRpc(api, "chat_filter_message", { message });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 4: moderation_health_report
  // =========================================================================
  server.tool(
    "moderation_health_report",
    "Generate a comprehensive moderation health report with metrics, trends, and actionable insights. Returns structured data for LLM analysis of community safety posture.",
    {},
    async () => {
      const statsResult = await safeRpc(api, "chat_moderation_stats", {});
      const stats =
        typeof statsResult === "object" && statsResult !== null
          ? (statsResult as Record<string, unknown>)
          : {};

      const inner =
        typeof stats.stats === "object" && stats.stats !== null
          ? (stats.stats as Record<string, unknown>)
          : stats;

      const totalReports = Number(inner.total_reports || 0);
      const pending = Number(inner.pending || 0);
      const autoFlagged = Number(inner.auto_flagged_severe || 0);
      const resolved = Number(inner.resolved || 0);
      const profanityDetections = Number(inner.profanity_detections || 0);
      const spamDetections = Number(inner.spam_detections || 0);

      const report = {
        metrics: {
          total_reports: totalReports,
          pending_review: pending,
          auto_flagged_severe: autoFlagged,
          resolved,
          resolution_rate:
            totalReports > 0
              ? Math.round((resolved / totalReports) * 100) + "%"
              : "N/A",
          profanity_detections: profanityDetections,
          spam_detections: spamDetections,
        },
        benchmarks: {
          resolution_rate_good: "90%+",
          max_pending_acceptable: 20,
          auto_flag_rate_high: "10%+",
        },
        by_reason: inner.by_reason || {},
        by_channel_type: inner.by_channel_type || {},
        top_reported_users: inner.top_reported_users || [],
        status:
          autoFlagged > 0
            ? "action_required"
            : pending > 20
            ? "backlog"
            : "healthy",
        flags: [] as string[],
        recommendations: [] as string[],
      };

      if (autoFlagged > 0) {
        report.flags.push("severe_content_unreviewed");
        report.recommendations.push(
          `${autoFlagged} auto-flagged severe reports need immediate review. Use moderate_reported_messages with action=list_severe.`
        );
      }
      if (pending > 20) {
        report.flags.push("review_backlog");
        report.recommendations.push(
          "Report review backlog is growing. Prioritize resolution to maintain community trust."
        );
      }
      if (totalReports === 0) {
        report.flags.push("no_reports");
        report.recommendations.push(
          "No reports filed yet. This could mean healthy chat or that players don't know how to report. Consider adding report prompts."
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }
  );
}
