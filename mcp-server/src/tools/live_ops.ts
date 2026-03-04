import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerLiveOpsTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "create_flash_event",
    "Create a time-limited flash event with a score/currency multiplier. Flash events drive urgent engagement through FOMO — players see a countdown and earn more during the window. Use for weekend boosts, holiday events, or to spike activity during low-traffic periods.",
    {
      game_id: z.string().describe("Game ID to run the flash event in"),
      event_name: z.string().describe("Human-readable event name (shown to players)"),
      event_type: z.string().describe("Event type (e.g. 'xp_boost', 'coin_rush', 'double_rewards', 'happy_hour')"),
      multiplier: z.number().min(1).max(10).describe("Reward multiplier (e.g. 2 for double rewards, 3 for triple)"),
      duration_minutes: z.number().int().positive().describe("How long the flash event lasts in minutes"),
    },
    async ({ game_id, event_name, event_type, multiplier, duration_minutes }) => {
      const data = await api.callRpc("flash_event_create", {
        game_id,
        event_name,
        event_type,
        multiplier,
        duration_minutes,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "grant_mystery_box",
    "Grant a mystery box (loot box) to a player. Mystery boxes contain randomized rewards and drive excitement through variable-ratio reinforcement. Use for login bonuses, event rewards, promotional gifts, or customer support compensation. Box types: 'common', 'rare', 'epic', 'legendary'.",
    {
      user_id: z.string().describe("User UUID to receive the mystery box"),
      game_id: z.string().describe("Game ID context"),
      box_type: z.enum(["common", "rare", "epic", "legendary"]).describe("Mystery box tier — higher tiers have better reward pools"),
      source: z.string().optional().describe("Why this box is being granted (e.g. 'daily_login', 'event_reward', 'cs_compensation')"),
    },
    async ({ user_id, game_id, box_type, source }) => {
      const data = await api.callRpc("mystery_box_grant", {
        user_id,
        game_id,
        box_type,
        source: source ?? "agent_operator",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "set_happy_hour",
    "Activate a happy hour — a special flash event where all rewards are multiplied. Shortcut for creating a flash event with type 'happy_hour'. Use during peak hours to maximize engagement or off-peak to smooth out activity curves.",
    {
      game_id: z.string().describe("Game ID"),
      multiplier: z.number().min(1.5).max(5).describe("Reward multiplier during happy hour (e.g. 2 for double)"),
      duration_minutes: z.number().int().positive().describe("Happy hour duration in minutes"),
    },
    async ({ game_id, multiplier, duration_minutes }) => {
      const data = await api.callRpc("flash_event_create", {
        game_id,
        event_name: "Happy Hour",
        event_type: "happy_hour",
        multiplier,
        duration_minutes,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_daily_spotlight",
    "Generate today's daily spotlight content for a game — a featured challenge, highlighted player, or special daily objective. The spotlight rotates automatically and gives players a reason to log in each day. Call once per day per game.",
    {
      game_id: z.string().describe("Game ID to generate daily spotlight for"),
    },
    async ({ game_id }) => {
      const data = await api.callRpc("daily_spotlight", { game_id });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "schedule_streak_celebration",
    "Trigger a celebration event when a player hits a streak milestone (7-day, 14-day, 30-day, etc.). Sends a special notification, grants bonus rewards, and records the milestone. Use to reinforce daily habit formation and recognize dedicated players.",
    {
      device_id: z.string().describe("Device ID of the player"),
      game_id: z.string().describe("Game ID"),
      streak_count: z.number().int().positive().describe("Current streak count that triggered the celebration"),
    },
    async ({ device_id, game_id, streak_count }) => {
      const data = await api.callRpc("streak_milestone_celebrate", {
        device_id,
        game_id,
        streak_count,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "run_lucky_draw",
    "Execute a lucky draw for a game — pick a random winner from all entries in the lucky_draw storage collection and grant them a reward. Use for weekly drawings, event finales, or promotional giveaways. Returns the winner and what they received.",
    {
      game_id: z.string().describe("Game ID to run the lucky draw for"),
    },
    async ({ game_id }) => {
      const entriesResult = await console.listStorage({
        collection: "lucky_draw",
        key: game_id,
        limit: 100,
      });

      const entries = (entriesResult as any)?.objects ?? [];
      if (entries.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: false, error: "No lucky draw entries found for " + game_id }, null, 2),
          }],
        };
      }

      const winnerIdx = Math.floor(Math.random() * entries.length);
      const winner = entries[winnerIdx];
      const winnerId = winner.user_id ?? winner.userId ?? "";

      let rewardResult: unknown = {};
      if (winnerId) {
        rewardResult = await api.callRpc("force_grant_rewards", {
          user_id: winnerId,
          rewards: { coins: 500, gems: 50 },
          reason: "lucky_draw_winner:" + game_id,
        });
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            game_id,
            total_entries: entries.length,
            winner: {
              user_id: winnerId,
              entry: winner.value ?? {},
            },
            reward_granted: rewardResult,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "get_live_ops_calendar",
    "Get a comprehensive view of all active and scheduled live ops events for a game: flash events, trivia nights, tournaments, happy hours, and special events. Use to see the full event calendar, avoid scheduling conflicts, and plan upcoming engagement activities.",
    {
      game_id: z.string().describe("Game ID to get the live ops calendar for"),
    },
    async ({ game_id }) => {
      const [flashEvents, triviaNights, tournaments] = await Promise.all([
        console.listStorage({ collection: "flash_events", key: game_id, limit: 50 }),
        console.listStorage({ collection: "trivia_nights", key: game_id, limit: 50 }),
        console.listLeaderboards({ limit: 50 }),
      ]);

      const calendar = {
        game_id,
        flash_events: (flashEvents as any)?.objects ?? [],
        trivia_nights: (triviaNights as any)?.objects ?? [],
        tournaments: (tournaments as any)?.leaderboards ?? (tournaments as any)?.tournaments ?? [],
        retrieved_at: new Date().toISOString(),
      };

      return { content: [{ type: "text", text: JSON.stringify(calendar, null, 2) }] };
    }
  );
}
