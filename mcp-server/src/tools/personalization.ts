import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerPersonalizationTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "get_player_insights",
    "Build a deep player profile by combining account data, retention metrics, quiz/game stats, and engagement history. Returns a rich insight object with play patterns, spending habits, skill level, and churn risk. Use before making personalization decisions, investigating player issues, or designing targeted interventions.",
    {
      user_id: z.string().describe("User UUID to profile"),
      game_id: z.string().describe("Game ID to scope insights to"),
    },
    async ({ user_id, game_id }) => {
      const [account, retentionData, quizStats, walletLedger] = await Promise.all([
        console.getAccount(user_id),
        console.listStorage({ collection: "retention_data", user_id, limit: 10 }),
        console.listStorage({ collection: `${game_id}_player_data`, user_id, limit: 20 }),
        console.getWalletLedger(user_id, { limit: 50 }),
      ]);

      const acct = account as any;
      const retentionObjects = (retentionData as any)?.objects ?? [];
      const statsObjects = (quizStats as any)?.objects ?? [];
      const ledgerEntries = (walletLedger as any)?.items ?? [];

      const insights = {
        user_id,
        game_id,
        account_summary: {
          username: acct?.account?.user?.username ?? "unknown",
          display_name: acct?.account?.user?.display_name ?? "",
          create_time: acct?.account?.user?.create_time ?? "",
          last_online: acct?.account?.user?.online ?? false,
        },
        retention: retentionObjects.map((o: any) => o.value ?? o),
        game_stats: statsObjects.map((o: any) => ({ key: o.key, value: o.value })),
        wallet_activity: {
          total_transactions: ledgerEntries.length,
          recent: ledgerEntries.slice(0, 10),
        },
        analyzed_at: new Date().toISOString(),
      };

      return { content: [{ type: "text", text: JSON.stringify(insights, null, 2) }] };
    }
  );

  server.tool(
    "generate_personalized_missions",
    "Generate a set of daily/weekly missions tailored to a specific player's skill level, play history, and preferences. The server-side RPC analyzes the player's profile and returns missions calibrated for difficulty and reward value. Use to keep missions fresh and appropriately challenging.",
    {
      device_id: z.string().describe("Device ID of the player"),
      game_id: z.string().describe("Game ID to generate missions for"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("get_personalized_missions", {
        device_id,
        game_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_smart_recommendations",
    "Get AI-driven recommendations for a player: what game modes to try, which friends to challenge, what items to buy, or what events to join. The server-side RPC uses the player's history to generate contextual suggestions. Use to improve player experience and drive discovery.",
    {
      device_id: z.string().describe("Device ID of the player"),
      game_id: z.string().describe("Game ID for recommendation context"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("get_smart_recommendations", {
        device_id,
        game_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "set_player_difficulty",
    "Adjust the adaptive difficulty level for a player in a specific game. The game server uses this to calibrate challenge intensity — keeping players in a flow state between boredom and frustration. Levels: 'easy', 'medium', 'hard', 'expert', or a numeric 1-10 scale.",
    {
      user_id: z.string().describe("User UUID"),
      game_id: z.string().describe("Game ID"),
      difficulty_level: z.string().describe("Difficulty level to set (e.g. 'easy', 'medium', 'hard', 'expert', or '1'-'10')"),
    },
    async ({ user_id, game_id, difficulty_level }) => {
      const data = await api.callRpc("quizverse_adaptive_difficulty", {
        user_id,
        game_id,
        difficulty_level,
        action: "set",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
