import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerEventPipelineTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "trigger_player_event",
    "Submit a player event into the unified event pipeline. This is the primary ingestion point — it fans out to XP grants, achievements, season pass, daily missions, weekly goals, streaks, mastery, and analytics. Use this whenever a player completes an action (quiz_complete, match_complete, login, purchase, etc.).",
    {
      device_id: z.string().describe("Device ID of the player"),
      game_id: z.string().describe("Game ID (e.g. 'quizverse', 'lasttolive', or a UUID)"),
      event_type: z.string().describe("Event type (e.g. 'quiz_complete', 'match_complete', 'login', 'purchase')"),
      event_data: z.record(z.string(), z.unknown()).optional().describe("Arbitrary event payload — structure depends on event_type (e.g. { score: 500, category: 'science' })"),
      reason: z.string().optional().describe("Human-readable reason for triggering this event (for audit trail)"),
    },
    async ({ device_id, game_id, event_type, event_data, reason }) => {
      const data = await api.callRpc("player_event_submit", {
        device_id,
        game_id,
        event_type,
        event_data: event_data ?? {},
        reason: reason ?? "agent_operator",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "simulate_player_event",
    "Dry-run a player event through the pipeline WITHOUT persisting any changes. Returns what would happen (XP earned, achievements triggered, missions progressed) so you can preview impact before committing. Useful for testing event configurations or explaining reward mechanics to operators.",
    {
      device_id: z.string().describe("Device ID of the player"),
      game_id: z.string().describe("Game ID"),
      event_type: z.string().describe("Event type to simulate"),
      event_data: z.record(z.string(), z.unknown()).optional().describe("Event payload to simulate"),
    },
    async ({ device_id, game_id, event_type, event_data }) => {
      const data = await api.callRpc("player_event_submit", {
        device_id,
        game_id,
        event_type,
        event_data: event_data ?? {},
        dry_run: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "check_pending_rewards",
    "Check all unclaimed rewards across every subsystem for a player: daily streak bonuses, completed daily missions, weekly goals, season pass levels, and monthly milestones. Use this to understand what a player is owed before granting or to diagnose 'missing reward' complaints.",
    {
      device_id: z.string().describe("Device ID of the player"),
      game_id: z.string().describe("Game ID to check rewards for"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("rewards_pending", {
        device_id,
        game_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "force_grant_rewards",
    "Directly grant currency (coins, gems, XP) to a player's wallet. Bypasses the event pipeline — use for manual corrections, customer support compensation, or promotional grants. SENSITIVE: modifies real wallet balances. Always provide a reason for the audit trail.",
    {
      user_id: z.string().describe("User UUID to grant rewards to"),
      rewards: z.object({
        coins: z.number().optional().describe("Coins to grant"),
        gems: z.number().optional().describe("Gems to grant"),
        xp: z.number().optional().describe("XP to grant"),
      }).describe("Reward amounts to grant"),
      reason: z.string().describe("Audit reason for this manual grant (e.g. 'CS compensation ticket #1234')"),
    },
    async ({ user_id, rewards, reason }) => {
      const data = await api.callRpc("force_grant_rewards", {
        user_id,
        rewards: {
          coins: rewards.coins ?? 0,
          gems: rewards.gems ?? 0,
          xp: rewards.xp ?? 0,
        },
        reason,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "reward_audit",
    "Get a complete audit trail of wallet changes and storage transactions for a player in a specific game. Combines wallet ledger history with storage-based transaction records. Use to investigate economy issues, verify reward delivery, or trace suspicious balance changes.",
    {
      user_id: z.string().describe("User UUID to audit"),
      game_id: z.string().describe("Game ID to scope the audit to"),
    },
    async ({ user_id, game_id }) => {
      const [walletLedger, storageTransactions] = await Promise.all([
        console.getWalletLedger(user_id, { limit: 100 }),
        console.listStorage({
          collection: "event_pipeline_log",
          user_id,
          limit: 100,
        }),
      ]);

      const auditData = {
        user_id,
        game_id,
        wallet_ledger: walletLedger,
        storage_transactions: storageTransactions,
      };

      return { content: [{ type: "text", text: JSON.stringify(auditData, null, 2) }] };
    }
  );
}
