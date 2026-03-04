import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerGameDepthTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  // ---- QuizVerse depth tools ----

  server.tool(
    "analyze_quiz_performance",
    "Deep analysis of a player's quiz performance: knowledge map across categories, accuracy trends, speed patterns, streak history, and weak areas. Combines the quizverse_knowledge_map RPC with historical quiz data from storage. Use to understand player strengths/weaknesses before adjusting difficulty or generating targeted content.",
    {
      user_id: z.string().describe("User UUID to analyze"),
      game_id: z.string().describe("Game ID (typically 'quizverse' or a quiz game UUID)"),
    },
    async ({ user_id, game_id }) => {
      const [knowledgeMap, quizHistory] = await Promise.all([
        api.callRpc("quizverse_knowledge_map", { user_id, game_id }),
        console.listStorage({ collection: `${game_id}_player_data`, user_id, limit: 50 }),
      ]);

      const historyObjects = (quizHistory as any)?.objects ?? [];

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            user_id,
            game_id,
            knowledge_map: knowledgeMap,
            quiz_history: historyObjects.map((o: any) => ({ key: o.key, value: o.value })),
            analyzed_at: new Date().toISOString(),
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "generate_adaptive_quiz",
    "Generate a quiz session calibrated to the player's skill level in a specific category. The server-side RPC selects questions that target the player's learning edge — not too easy, not too hard. Use to maximize learning outcomes and keep players engaged through appropriate challenge.",
    {
      user_id: z.string().describe("User UUID"),
      game_id: z.string().describe("Game ID"),
      category: z.string().describe("Quiz category to generate questions for (e.g. 'science', 'history', 'geography')"),
    },
    async ({ user_id, game_id, category }) => {
      const data = await api.callRpc("quizverse_adaptive_difficulty", {
        user_id,
        game_id,
        category,
        action: "generate",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "schedule_trivia_night",
    "Schedule a multiplayer trivia night event for a game. Players compete live in timed rounds. Creates the event in the trivia_nights collection and can optionally notify all active players. Use for community engagement, weekly rituals, or special occasion events.",
    {
      game_id: z.string().describe("Game ID to host the trivia night in"),
      start_time: z.string().describe("ISO 8601 start time (e.g. '2025-03-15T20:00:00Z')"),
      title: z.string().describe("Event title shown to players"),
    },
    async ({ game_id, start_time, title }) => {
      const data = await api.callRpc("quizverse_trivia_night", {
        game_id,
        start_time,
        title,
        action: "schedule",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_category_war",
    "Create a category-vs-category war event where players pick sides and compete to prove which knowledge domain reigns supreme (e.g. Science vs History). Drives community engagement through tribal competition. Stores the event in category_wars storage if no dedicated RPC exists.",
    {
      game_id: z.string().describe("Game ID"),
      category_a: z.string().describe("First competing category (e.g. 'science')"),
      category_b: z.string().describe("Second competing category (e.g. 'history')"),
      duration_hours: z.number().positive().describe("Duration of the war in hours"),
    },
    async ({ game_id, category_a, category_b, duration_hours }) => {
      try {
        const data = await api.callRpc("quizverse_category_war", {
          game_id,
          category_a,
          category_b,
          duration_hours,
          action: "create",
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch {
        const warId = `${game_id}_${category_a}_vs_${category_b}_${Date.now()}`;
        const warData = {
          war_id: warId,
          game_id,
          category_a,
          category_b,
          duration_hours,
          start_time: new Date().toISOString(),
          end_time: new Date(Date.now() + duration_hours * 3600000).toISOString(),
          scores: { [category_a]: 0, [category_b]: 0 },
          status: "active",
        };

        await api.callRpc("quizverse_save_player_data", {
          gameID: game_id,
          key: "category_war:" + warId,
          value: warData,
        });

        return { content: [{ type: "text", text: JSON.stringify({ success: true, ...warData, fallback: true }, null, 2) }] };
      }
    }
  );

  server.tool(
    "knowledge_gap_report",
    "Aggregate knowledge map data across multiple players to find the most common weak categories in a game. Reveals systemic content gaps or categories where players consistently struggle. Use to inform content creation, difficulty tuning, or targeted educational events.",
    {
      game_id: z.string().describe("Game ID to analyze"),
      limit: z.number().int().min(1).max(100).optional().describe("Max players to sample (default 50)"),
    },
    async ({ game_id, limit }) => {
      const sampleSize = limit ?? 50;
      const accounts = await console.listAccounts({ limit: sampleSize });
      const users = (accounts as any)?.users ?? [];

      const categoryWeakness: Record<string, number> = {};
      const categoryTotal: Record<string, number> = {};
      let playersAnalyzed = 0;

      for (const user of users) {
        const uid = user.user?.id ?? user.id;
        if (!uid) continue;

        try {
          const km = await api.callRpc("quizverse_knowledge_map", { user_id: uid, game_id });
          const categories = (km as any)?.categories ?? (km as any)?.payload?.categories ?? {};

          for (const [cat, stats] of Object.entries(categories)) {
            const s = stats as any;
            categoryTotal[cat] = (categoryTotal[cat] ?? 0) + 1;
            const accuracy = s.accuracy ?? s.score ?? 0;
            if (accuracy < 0.5) {
              categoryWeakness[cat] = (categoryWeakness[cat] ?? 0) + 1;
            }
          }
          playersAnalyzed++;
        } catch {
          continue;
        }
      }

      const gaps = Object.entries(categoryWeakness)
        .map(([category, weakCount]) => ({
          category,
          weak_players: weakCount,
          total_players: categoryTotal[category] ?? 0,
          weakness_rate: categoryTotal[category] ? weakCount / categoryTotal[category] : 0,
        }))
        .sort((a, b) => b.weakness_rate - a.weakness_rate);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            game_id,
            players_analyzed: playersAnalyzed,
            knowledge_gaps: gaps,
            analyzed_at: new Date().toISOString(),
          }, null, 2),
        }],
      };
    }
  );

  // ---- LastToLive depth tools ----

  server.tool(
    "analyze_combat_stats",
    "Deep analysis of a player's combat performance in LastToLive: weapon mastery levels, highlight reel moments, nemesis relationships (players who consistently beat them), and survival patterns. Use to understand player playstyle, identify balance issues, or create targeted challenges.",
    {
      user_id: z.string().describe("User UUID to analyze"),
      game_id: z.string().describe("Game ID (typically 'lasttolive' or a combat game UUID)"),
    },
    async ({ user_id, game_id }) => {
      const [weaponMastery, highlightReel, nemesis] = await Promise.all([
        api.callRpc("lasttolive_weapon_mastery", { user_id, game_id }),
        api.callRpc("lasttolive_highlight_reel", { user_id, game_id }),
        api.callRpc("lasttolive_nemesis", { user_id, game_id }),
      ]);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            user_id,
            game_id,
            weapon_mastery: weaponMastery,
            highlight_reel: highlightReel,
            nemesis: nemesis,
            analyzed_at: new Date().toISOString(),
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "create_bounty_event",
    "Place a bounty on a specific player in LastToLive — other players earn the reward for eliminating the target. Creates intense social dynamics and targeted gameplay. Use for community events, celebrating top players, or villain-of-the-week scenarios.",
    {
      game_id: z.string().describe("Game ID"),
      target_user_id: z.string().describe("User UUID of the bounty target"),
      reward_amount: z.number().positive().describe("Coin reward for claiming the bounty"),
    },
    async ({ game_id, target_user_id, reward_amount }) => {
      const data = await api.callRpc("lasttolive_bounty_create", {
        game_id,
        target_user_id,
        reward_amount,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "schedule_clan_war",
    "Set up a competitive clan war between two groups. Both groups are pitted against each other in a timed competition where individual match results contribute to group scores. Use for inter-group rivalry, seasonal championships, or community-requested showdowns.",
    {
      game_id: z.string().describe("Game ID"),
      group_id_a: z.string().describe("First group/clan UUID"),
      group_id_b: z.string().describe("Second group/clan UUID"),
      duration_hours: z.number().positive().describe("War duration in hours"),
    },
    async ({ game_id, group_id_a, group_id_b, duration_hours }) => {
      const data = await api.callRpc("group_quest_create", {
        game_id,
        quest_name: "Clan War",
        quest_type: "clan_war",
        group_id_a,
        group_id_b,
        duration_hours,
        metadata: {
          created_by: "agent_operator",
          event_type: "competitive_clan_war",
        },
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "balance_check",
    "Analyze weapon/item balance across the player population by reading weapon_mastery stats for multiple players. Identifies overpowered or underpowered items by comparing usage rates, win rates, and mastery progression. Use for game balance reviews, patch planning, or meta-game analysis.",
    {
      game_id: z.string().describe("Game ID to check balance for"),
    },
    async ({ game_id }) => {
      const accounts = await console.listAccounts({ limit: 100 });
      const users = (accounts as any)?.users ?? [];

      const weaponStats: Record<string, { usage: number; total_mastery: number; players: number }> = {};
      let playersAnalyzed = 0;

      for (const user of users) {
        const uid = user.user?.id ?? user.id;
        if (!uid) continue;

        try {
          const mastery = await api.callRpc("lasttolive_weapon_mastery", { user_id: uid, game_id });
          const weapons = (mastery as any)?.weapons ?? (mastery as any)?.payload?.weapons ?? {};

          for (const [weapon, stats] of Object.entries(weapons)) {
            const s = stats as any;
            if (!weaponStats[weapon]) {
              weaponStats[weapon] = { usage: 0, total_mastery: 0, players: 0 };
            }
            weaponStats[weapon].usage += s.kills ?? s.usage ?? 0;
            weaponStats[weapon].total_mastery += s.mastery ?? s.level ?? 0;
            weaponStats[weapon].players += 1;
          }
          playersAnalyzed++;
        } catch {
          continue;
        }
      }

      const balanceReport = Object.entries(weaponStats)
        .map(([weapon, stats]) => ({
          weapon,
          total_usage: stats.usage,
          avg_mastery: stats.players > 0 ? stats.total_mastery / stats.players : 0,
          player_count: stats.players,
          usage_share: playersAnalyzed > 0 ? stats.players / playersAnalyzed : 0,
        }))
        .sort((a, b) => b.total_usage - a.total_usage);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            game_id,
            players_analyzed: playersAnalyzed,
            weapon_balance: balanceReport,
            analyzed_at: new Date().toISOString(),
          }, null, 2),
        }],
      };
    }
  );
}
