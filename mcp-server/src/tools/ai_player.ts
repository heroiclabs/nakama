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

export function registerAiPlayerTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  // =========================================================================
  // Tool 1: ai_coach_player
  // =========================================================================
  server.tool(
    "ai_coach_player",
    "Generate personalized AI coaching advice for a player based on their actual game data (streaks, level, achievements, play patterns). The AI coach adapts to the player's performance. Use to test coaching quality or send proactive coaching to at-risk players.",
    {
      player_id: z.string().describe("Player UUID to coach"),
      game_id: z.string().optional().describe("Game context"),
      topic: z
        .enum(["general", "improvement", "streak", "strategy", "motivation"])
        .optional()
        .describe("Coaching focus area"),
    },
    async ({ player_id, game_id, topic }) => {
      const data = await safeRpc(api, "ai_coach_advice", {
        game_id: game_id ?? "default",
        topic: topic ?? "general",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 2: ai_generate_match_recap
  // =========================================================================
  server.tool(
    "ai_generate_match_recap",
    "Generate an AI-powered sports-commentator-style match recap from match data. Turns raw scores into an exciting narrative. Use to test recap quality or generate recaps for highlights feeds.",
    {
      player_id: z.string().describe("Player UUID"),
      game_id: z.string().optional().describe("Game context"),
      match_data: z
        .record(z.string(), z.unknown())
        .describe("Match results (score, time, category, correct_answers, etc.)"),
    },
    async ({ player_id, game_id, match_data }) => {
      const data = await safeRpc(api, "ai_match_recap", {
        game_id: game_id ?? "default",
        match_data,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 3: ai_generate_player_journey
  // =========================================================================
  server.tool(
    "ai_generate_player_journey",
    "Generate an epic narrative of a player's gaming journey — their achievements, streaks, milestones told as a story. A powerful retention and emotional engagement feature. Use to test journey narratives or create shareable player stories.",
    {
      player_id: z.string().describe("Player UUID"),
      game_id: z.string().optional().describe("Game context"),
    },
    async ({ player_id, game_id }) => {
      const data = await safeRpc(api, "ai_player_journey", {
        game_id: game_id ?? "default",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 4: ai_generate_rival_taunt
  // =========================================================================
  server.tool(
    "ai_generate_rival_taunt",
    "Generate a fun, friendly trash-talk message between two players. Safe, non-toxic banter that drives social engagement. Use to test taunt quality or spark rivalry activity between players.",
    {
      player_id: z.string().describe("Sender player UUID"),
      rival_user_id: z.string().describe("Rival player UUID"),
      game_id: z.string().optional().describe("Game context"),
      mood: z
        .enum(["playful", "competitive", "dramatic", "funny"])
        .optional()
        .describe("Taunt mood/style"),
    },
    async ({ player_id, rival_user_id, game_id, mood }) => {
      const data = await safeRpc(api, "ai_rival_taunt", {
        rival_user_id,
        game_id: game_id ?? "default",
        mood: mood ?? "playful",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 5: ai_generate_trivia
  // =========================================================================
  server.tool(
    "ai_generate_trivia",
    "Generate AI-powered trivia questions tailored to a player's level and preferred categories. Returns structured JSON with questions, options, answers, and fun facts. A differentiating feature for quiz games — infinite, personalized content.",
    {
      player_id: z.string().describe("Player UUID (for personalization)"),
      category: z.string().optional().describe("Trivia category (e.g. science, history, pop culture)"),
      difficulty: z
        .enum(["easy", "medium", "hard", "expert"])
        .optional()
        .describe("Question difficulty"),
      count: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Number of questions (1-10)"),
      game_id: z.string().optional().describe("Game context"),
    },
    async ({ player_id, category, difficulty, count, game_id }) => {
      const data = await safeRpc(api, "ai_trivia_generate", {
        category: category ?? "general knowledge",
        difficulty: difficulty ?? "medium",
        count: count ?? 5,
        game_id: game_id ?? "default",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 6: ai_send_daily_briefing
  // =========================================================================
  server.tool(
    "ai_send_daily_briefing",
    "Generate a personalized daily game briefing for a player — today's events, streak status, what to do next. Like a morning news anchor for their game. Use proactively to re-engage players or test briefing content.",
    {
      player_id: z.string().describe("Player UUID"),
      game_id: z.string().optional().describe("Game context"),
    },
    async ({ player_id, game_id }) => {
      const data = await safeRpc(api, "ai_daily_briefing", {
        game_id: game_id ?? "default",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 7: ai_group_hype_message
  // =========================================================================
  server.tool(
    "ai_group_hype_message",
    "Generate and post an AI hype message to a group chat celebrating a player event (achievement, streak milestone, win). Drives group engagement and makes achievements social. Use to celebrate moments or spark group activity.",
    {
      player_id: z.string().describe("Player UUID who triggered the event"),
      group_id: z.string().describe("Group UUID to post in"),
      event_type: z
        .enum(["achievement", "streak_milestone", "win", "comeback", "level_up", "general"])
        .describe("Type of event to celebrate"),
      event_data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Event details (score, achievement name, etc.)"),
      game_id: z.string().optional().describe("Game context"),
    },
    async ({ player_id, group_id, event_type, event_data, game_id }) => {
      const data = await safeRpc(api, "ai_group_hype", {
        group_id,
        event_type,
        event_data: event_data ?? {},
        game_id: game_id ?? "default",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 8: ai_usage_report
  // =========================================================================
  server.tool(
    "ai_usage_report",
    "Generate a report on AI feature usage across the platform — which features are used most, adoption rates, per-provider usage, and LLM cost estimation. Returns structured insight data for optimizing AI feature investment.",
    {
      game_id: z.string().optional().describe("Filter by game ID"),
    },
    async ({ game_id }) => {
      const storageResult = await console.get(
        `/v2/console/storage/ai_interactions?limit=100`
      );

      const records =
        typeof storageResult === "object" &&
        storageResult !== null &&
        "objects" in storageResult
          ? (storageResult as Record<string, unknown>).objects
          : [];

      const interactions = Array.isArray(records) ? records : [];

      const byType: Record<string, number> = {};
      const byProvider: Record<string, number> = {};
      const uniqueUsers = new Set<string>();
      let total = 0;

      for (const item of interactions) {
        const val =
          typeof item === "object" && item !== null && "value" in item
            ? (item as Record<string, unknown>).value
            : null;
        if (!val || typeof val !== "object") continue;

        const interaction = val as Record<string, unknown>;
        total++;

        const iType = String(interaction.type || "unknown");
        byType[iType] = (byType[iType] || 0) + 1;

        const provider = String(interaction.provider || "unknown");
        byProvider[provider] = (byProvider[provider] || 0) + 1;

        const uid =
          typeof item === "object" && item !== null && "user_id" in item
            ? String((item as Record<string, unknown>).user_id)
            : "";
        if (uid) uniqueUsers.add(uid);
      }

      const estimatedCosts: Record<string, string> = {};
      for (const [prov, count] of Object.entries(byProvider)) {
        const costPerCall =
          prov === "claude" ? 0.003 : prov === "openai" ? 0.002 : 0.001;
        estimatedCosts[prov] = "$" + (count * costPerCall).toFixed(2);
      }

      const report = {
        metrics: {
          total_ai_interactions: total,
          unique_users: uniqueUsers.size,
          adoption_rate: uniqueUsers.size > 0 ? "active" : "no_usage",
        },
        by_feature: byType,
        by_provider: byProvider,
        estimated_costs: estimatedCosts,
        most_popular:
          Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] ??
          "none",
        recommendations: [] as string[],
      };

      if (total === 0) {
        report.recommendations.push(
          "No AI interactions yet. Ensure LLM API keys are configured (ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY)."
        );
      }
      if (byType["trivia"] > total * 0.5) {
        report.recommendations.push(
          "Trivia generation dominates AI usage. Consider caching generated questions to reduce API costs."
        );
      }
      if (!byType["coach"] && total > 0) {
        report.recommendations.push(
          "AI Coach is not being used. Consider prompting players to try it after losses or plateau periods."
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    }
  );
}
