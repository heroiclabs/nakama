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

export function registerGameMetricsTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  // =========================================================================
  // Tool 1: capture_game_metrics
  // =========================================================================
  server.tool(
    "capture_game_metrics",
    `Submit game metrics for any game. Use this to record match results, session stats, 
or any custom metrics you want to track. Supports any game_id — works for cricket, 
quiz, survival, or any custom game.

Example metric_types: "match_result", "batting_innings", "bowling_spell", 
"session_summary", "purchase", "level_complete", "custom".

The metrics object accepts ANY numeric or string fields. Numeric fields are 
automatically aggregated (sum, avg, min, max, median) for reporting.

Example for cricket:
  metric_type: "batting_innings"
  metrics: { runs: 87, balls_faced: 62, fours: 8, sixes: 4, strike_rate: 140.3 }
  tags: { match_type: "t20", venue: "Mumbai" }`,
    {
      game_id: z
        .string()
        .describe("Game UUID to record metrics for"),
      metric_type: z
        .string()
        .optional()
        .describe(
          'Type of metric: "match_result", "batting_innings", "bowling_spell", "session_summary", "custom", etc. Default: "match_result"'
        ),
      metrics: z
        .record(z.string(), z.unknown())
        .describe(
          "Key-value metrics data. Numeric values are auto-aggregated. Example: { runs: 87, wickets: 3, overs: 20 }"
        ),
      tags: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Optional tags for filtering. Example: { match_type: "t20", difficulty: "hard" }'
        ),
      user_id: z
        .string()
        .optional()
        .describe(
          "User UUID to record metrics for. If omitted, uses the authenticated user."
        ),
    },
    async ({ game_id, metric_type, metrics, tags, user_id }) => {
      const result = await safeRpc(api, "game_metrics_submit", {
        game_id,
        metric_type: metric_type || "match_result",
        metrics,
        tags: tags || {},
        user_id,
      });

      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // =========================================================================
  // Tool 2: query_game_metrics
  // =========================================================================
  server.tool(
    "query_game_metrics",
    `Query game metrics for a specific player in a specific game. Returns individual 
metric records with full details. Use this to investigate a player's performance 
history, analyze patterns, or debug issues.

Supports filtering by metric_type (e.g. only "batting_innings" records).
Paginated with cursor support for large result sets.`,
    {
      game_id: z.string().describe("Game UUID to query metrics for"),
      user_id: z
        .string()
        .describe("Player UUID to query metrics for"),
      metric_type: z
        .string()
        .optional()
        .describe(
          'Filter by metric type. Example: "match_result", "batting_innings"'
        ),
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results to return (1-100, default 50)"),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor from previous query"),
    },
    async ({ game_id, user_id, metric_type, limit, cursor }) => {
      const result = await safeRpc(api, "game_metrics_query", {
        game_id,
        user_id,
        metric_type,
        limit: limit || 50,
        cursor,
      });

      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // =========================================================================
  // Tool 3: game_metrics_report
  // =========================================================================
  server.tool(
    "game_metrics_report",
    `Generate an aggregated metrics report for a game. Returns population-level stats: 
total submissions, unique players, per-field statistics (avg, median, min, max, p95), 
and metric type breakdown.

Use this to answer questions like:
- "What's the average score in cricket?"
- "How many players have submitted match results?"
- "What's the p95 survival time in LastToLive?"
- "Show me the score distribution for QuizVerse"

Specify 'fields' to get detailed stats on specific numeric metrics (e.g. ["runs", "wickets"]).
If no fields specified, returns the running summary stats from the index.`,
    {
      game_id: z.string().describe("Game UUID to generate report for"),
      metric_type: z
        .string()
        .optional()
        .describe(
          'Filter aggregation to a specific metric type. Example: "batting_innings"'
        ),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Specific numeric metric fields to aggregate. Example: ["runs", "wickets", "strike_rate"]. If omitted, returns summary stats for all numeric fields.'
        ),
      sample_size: z
        .number()
        .min(10)
        .max(200)
        .optional()
        .describe(
          "Number of records to sample for detailed field aggregation (10-200, default 50)"
        ),
    },
    async ({ game_id, metric_type, fields, sample_size }) => {
      const raw = (await safeRpc(api, "game_metrics_aggregate", {
        game_id,
        metric_type,
        fields: fields || [],
        sample_size: sample_size || 50,
      })) as Record<string, unknown>;

      // Add benchmarks and insight structure
      const summary = raw.summary as Record<string, unknown> | undefined;
      const fieldStats = raw.field_stats as Record<
        string,
        Record<string, unknown>
      > | undefined;

      const flags: string[] = [];
      const insights: string[] = [];

      if (summary) {
        const totalSub = (summary.total_submissions as number) || 0;
        const uniquePlayers = (summary.unique_players as number) || 0;

        if (totalSub === 0) flags.push("no_data");
        if (uniquePlayers < 10) flags.push("small_sample_size");
        if (uniquePlayers > 0 && totalSub / uniquePlayers < 2)
          flags.push("low_repeat_play");
        if (uniquePlayers > 0 && totalSub / uniquePlayers > 20)
          insights.push(
            "High engagement: players average " +
              Math.round(totalSub / uniquePlayers) +
              " submissions each"
          );
      }

      if (fieldStats) {
        for (const [field, stats] of Object.entries(fieldStats)) {
          const s = stats as Record<string, unknown>;
          if (s.avg !== undefined && s.max !== undefined) {
            const avg = s.avg as number;
            const max = s.max as number;
            const min = s.min as number;
            if (max > avg * 5)
              flags.push(field + "_has_outliers");
            if (avg === min && avg === max)
              insights.push(field + " has no variance — all values identical");
          }
        }
      }

      const report = {
        game_id,
        summary: summary || null,
        field_stats: fieldStats || {},
        sample_size: raw.sample_size || 0,
        filter: raw.filter || null,
        flags,
        insights,
      };

      return {
        content: [
          { type: "text", text: JSON.stringify(report, null, 2) },
        ],
      };
    }
  );
}
