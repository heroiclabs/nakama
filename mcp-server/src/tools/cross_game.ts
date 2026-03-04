import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerCrossGameTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "cross_game_analysis",
    "Get a comprehensive cross-game profile for a player — aggregated stats across all games they play: total XP, coins, achievements, level progression per game, and playtime distribution. Use to understand a player's full ecosystem engagement, identify cross-promotion opportunities, or assess overall lifetime value.",
    {
      user_id: z.string().describe("User UUID to analyze across all games"),
    },
    async ({ user_id }) => {
      const data = await api.callRpc("cross_game_profile", {
        device_id: "",
        user_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "cross_promote",
    "Cross-promote a game to a player who plays a different game in the ecosystem. Sends a personalized notification highlighting the target game and optionally triggers a cross-game bonus (coins/rewards for trying the new game). Use to drive discovery, increase ecosystem stickiness, and maximize LTV across titles.",
    {
      user_id: z.string().describe("User UUID to send the cross-promotion to"),
      source_game_id: z.string().describe("Game the player currently plays"),
      target_game_id: z.string().describe("Game to promote to the player"),
      message: z.string().optional().describe("Custom promotional message (optional — a default will be generated)"),
    },
    async ({ user_id, source_game_id, target_game_id, message }) => {
      const promoMessage = message ?? `You're crushing it in ${source_game_id}! Try ${target_game_id} for a bonus reward.`;

      const [notifResult, bonusResult] = await Promise.all([
        console.sendNotification({
          user_id,
          subject: `Try ${target_game_id}!`,
          content: JSON.stringify({
            type: "cross_promotion",
            source_game_id,
            target_game_id,
            message: promoMessage,
          }),
          code: 400,
          persistent: true,
        }),
        api.callRpc("cross_game_bonus", {
          device_id: "",
          source_game_id,
          target_game_id,
          event_type: "cross_promotion",
        }),
      ]);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            user_id,
            source_game_id,
            target_game_id,
            notification_sent: true,
            bonus_result: bonusResult,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "global_leaderboard_composite",
    "Get a unified global leaderboard that combines scores from all games in the ecosystem. Players are ranked by their total score across QuizVerse, LastToLive, and any other registered games. Use to showcase top ecosystem players, run cross-game competitions, or identify your most engaged multi-game players.",
    {
      limit: z.number().int().min(1).max(100).optional().describe("Max rankings to return (default 10)"),
    },
    async ({ limit }) => {
      const data = await api.callRpc("global_leaderboard_composite", {
        limit: limit ?? 10,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
