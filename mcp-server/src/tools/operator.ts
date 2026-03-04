import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

const OPERATOR_ALLOWLIST: Record<string, {
  description: string;
  category: "read" | "write" | "admin";
  maxAmountPerCall?: number;
  requiresReason: boolean;
}> = {
  // Read operations — no limits
  get_wallet_balance: { description: "Get player wallet", category: "read", requiresReason: false },
  wallet_get_all: { description: "Get all wallets", category: "read", requiresReason: false },
  friends_list: { description: "List friends", category: "read", requiresReason: false },
  get_all_leaderboards: { description: "Get leaderboards", category: "read", requiresReason: false },
  get_leaderboard: { description: "Get leaderboard", category: "read", requiresReason: false },
  daily_rewards_get_status: { description: "Check daily reward", category: "read", requiresReason: false },
  get_daily_missions: { description: "Get missions", category: "read", requiresReason: false },
  achievements_get_all: { description: "Get achievements", category: "read", requiresReason: false },
  get_player_metadata: { description: "Get player metadata", category: "read", requiresReason: false },
  get_player_portfolio: { description: "Get player portfolio", category: "read", requiresReason: false },
  onboarding_get_state: { description: "Get onboarding state", category: "read", requiresReason: false },
  onboarding_get_retention_data: { description: "Get retention data", category: "read", requiresReason: false },
  retention_get_recommendations: { description: "Get retention recs", category: "read", requiresReason: false },
  winback_check_status: { description: "Check winback status", category: "read", requiresReason: false },
  weekly_goals_get_status: { description: "Get weekly goals", category: "read", requiresReason: false },
  season_pass_get_status: { description: "Get season pass", category: "read", requiresReason: false },
  monthly_milestones_get_status: { description: "Get milestones", category: "read", requiresReason: false },
  collections_get_status: { description: "Get collections", category: "read", requiresReason: false },
  progressive_get_state: { description: "Get unlock state", category: "read", requiresReason: false },
  progression_get_state: { description: "Get mastery state", category: "read", requiresReason: false },
  rewarded_ad_get_status: { description: "Get ad status", category: "read", requiresReason: false },
  tournament_list_active: { description: "List tournaments", category: "read", requiresReason: false },
  matchmaking_get_status: { description: "Get match status", category: "read", requiresReason: false },
  rate_limit_status: { description: "Rate limit status", category: "read", requiresReason: false },
  cache_stats: { description: "Cache stats", category: "read", requiresReason: false },
  get_game_registry: { description: "List games", category: "read", requiresReason: false },
  quiz_get_history: { description: "Quiz history", category: "read", requiresReason: false },
  quiz_get_stats: { description: "Quiz stats", category: "read", requiresReason: false },
  compatibility_list_sessions: { description: "Compat sessions", category: "read", requiresReason: false },

  // Write operations — capped amounts, require reason
  wallet_update_game_wallet: { description: "Update game wallet", category: "write", maxAmountPerCall: 10000, requiresReason: true },
  wallet_update_global: { description: "Update global wallet", category: "write", maxAmountPerCall: 5000, requiresReason: true },
  daily_rewards_claim: { description: "Claim daily reward", category: "write", requiresReason: true },
  daily_missions_update_progress: { description: "Update mission", category: "write", requiresReason: true },
  claim_mission_reward: { description: "Claim mission reward", category: "write", requiresReason: true },
  achievements_update_progress: { description: "Update achievement", category: "write", requiresReason: true },
  submit_leaderboard_score: { description: "Submit score", category: "write", requiresReason: true },
  send_group_chat_message: { description: "Group chat message", category: "write", requiresReason: false },
  send_direct_message: { description: "Direct message", category: "write", requiresReason: false },
  send_chat_room_message: { description: "Room message", category: "write", requiresReason: false },
  send_friend_invite: { description: "Send friend invite", category: "write", requiresReason: false },
  analytics_log_event: { description: "Log analytics event", category: "write", requiresReason: false },
  weekly_goals_update_progress: { description: "Update weekly goal", category: "write", requiresReason: true },
  season_pass_add_xp: { description: "Add season XP", category: "write", maxAmountPerCall: 1000, requiresReason: true },
  collections_add_mastery_xp: { description: "Add mastery XP", category: "write", maxAmountPerCall: 500, requiresReason: true },
  progressive_update_progress: { description: "Update unlocks", category: "write", requiresReason: true },
  progression_add_mastery_xp: { description: "Add mastery XP", category: "write", maxAmountPerCall: 500, requiresReason: true },
  retention_grant_streak_shield: { description: "Grant streak shield", category: "write", requiresReason: true },
  retention_schedule_notification: { description: "Schedule notification", category: "write", requiresReason: true },
  winback_schedule_reengagement: { description: "Schedule winback", category: "write", requiresReason: true },
  tournament_create: { description: "Create tournament", category: "write", requiresReason: true },
  tournament_join: { description: "Join tournament", category: "write", requiresReason: true },
  matchmaking_find_match: { description: "Start matchmaking", category: "write", requiresReason: false },
  create_game_group: { description: "Create group", category: "write", requiresReason: true },

  // Admin operations — highest scrutiny
  admin_delete_player_metadata: { description: "Delete player metadata", category: "admin", requiresReason: true },
  cache_clear: { description: "Clear cache", category: "admin", requiresReason: true },
  batch_execute: { description: "Batch execute", category: "admin", requiresReason: true },
  batch_wallet_operations: { description: "Batch wallet ops", category: "admin", maxAmountPerCall: 50000, requiresReason: true },
};

export function registerOperatorTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "operator",
    `Unified privileged operator tool — the "agent as operator" pattern. Executes any whitelisted Nakama action with built-in policy enforcement:
- ALLOWLIST: Only pre-approved RPCs can be called (${Object.keys(OPERATOR_ALLOWLIST).length} actions available)
- AMOUNT CAPS: Write operations that move value have per-call limits
- AUDIT LOGGING: Every write/admin action is automatically logged to analytics
- CATEGORIES: read (no limits), write (capped + audited), admin (highest scrutiny + audited)

Use this instead of call_rpc when you want policy-enforced operations. Safer than raw RPC calls.`,
    {
      action: z.string().describe(`Action name. Allowed: ${Object.keys(OPERATOR_ALLOWLIST).join(", ")}`),
      params: z.record(z.string(), z.unknown()).describe("Action parameters (varies by action)"),
      reason: z.string().optional().describe("Audit reason (REQUIRED for write/admin actions)"),
      idempotency_key: z.string().optional().describe("Idempotency key to prevent duplicate execution"),
    },
    async ({ action, params, reason, idempotency_key }) => {
      const policy = OPERATOR_ALLOWLIST[action];
      if (!policy) {
        return {
          content: [{
            type: "text",
            text: `DENIED: Action "${action}" is not in the operator allowlist.\n\nAllowed actions:\n${Object.entries(OPERATOR_ALLOWLIST).map(([k, v]) => `  ${k} [${v.category}] — ${v.description}`).join("\n")}`,
          }],
          isError: true,
        };
      }

      if (policy.requiresReason && !reason) {
        return {
          content: [{
            type: "text",
            text: `DENIED: Action "${action}" (category: ${policy.category}) requires a reason. Provide the "reason" parameter.`,
          }],
          isError: true,
        };
      }

      if (policy.maxAmountPerCall) {
        const amount = (params as Record<string, unknown>).balance ??
                       (params as Record<string, unknown>).amount ??
                       (params as Record<string, unknown>).xp ??
                       0;
        if (typeof amount === "number" && Math.abs(amount) > policy.maxAmountPerCall) {
          return {
            content: [{
              type: "text",
              text: `DENIED: Amount ${amount} exceeds per-call cap of ${policy.maxAmountPerCall} for "${action}". Split into smaller operations.`,
            }],
            isError: true,
          };
        }
      }

      if (idempotency_key) {
        (params as Record<string, unknown>).idempotency_key = idempotency_key;
      }

      const result = await api.callRpc(action, params);

      if (policy.category !== "read") {
        try {
          await api.callRpc("analytics_log_event", {
            event_name: `audit:operator:${action}`,
            properties: {
              actor: "ai_agent",
              category: policy.category,
              action,
              reason: reason ?? "",
              idempotency_key: idempotency_key ?? "",
              params_summary: JSON.stringify(params).substring(0, 500),
              timestamp: new Date().toISOString(),
            },
          });
        } catch {
          // audit logging failure should not block the operation
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            action,
            category: policy.category,
            audited: policy.category !== "read",
            result,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "operator_list_actions",
    "List all actions available through the operator tool, organized by category (read/write/admin) with their descriptions and limits.",
    {},
    async () => {
      const grouped: Record<string, Array<{
        action: string;
        description: string;
        maxAmount?: number;
        requiresReason: boolean;
      }>> = { read: [], write: [], admin: [] };

      for (const [action, policy] of Object.entries(OPERATOR_ALLOWLIST)) {
        grouped[policy.category].push({
          action,
          description: policy.description,
          maxAmount: policy.maxAmountPerCall,
          requiresReason: policy.requiresReason,
        });
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_actions: Object.keys(OPERATOR_ALLOWLIST).length,
            by_category: {
              read: { count: grouped.read.length, actions: grouped.read },
              write: { count: grouped.write.length, actions: grouped.write },
              admin: { count: grouped.admin.length, actions: grouped.admin },
            },
          }, null, 2),
        }],
      };
    }
  );
}
