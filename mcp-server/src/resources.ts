import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NakamaConsoleClient, NakamaApiClient } from "./client.js";

const RPC_CATALOG = [
  "--- Identity & Wallet ---",
  "create_or_sync_user", "create_or_get_wallet", "wallet_get_all",
  "wallet_update_global", "wallet_update_game_wallet", "wallet_transfer_between_game_wallets",
  "create_player_wallet", "update_wallet_balance", "get_wallet_balance",
  "get_user_wallet", "link_wallet_to_game", "get_wallet_registry",
  "wallet_get_balances",

  "--- Leaderboards ---",
  "submit_score_and_sync", "get_all_leaderboards", "submit_leaderboard_score",
  "get_leaderboard", "get_time_period_leaderboard",
  "create_all_leaderboards_persistent", "create_time_period_leaderboards",
  "submit_score_to_time_periods", "submit_score_sync", "submit_score_with_aggregate",
  "create_all_leaderboards_with_friends", "submit_score_with_friends_sync",
  "get_friend_leaderboard",

  "--- Daily Systems ---",
  "daily_reward_claim", "daily_reward_status", "daily_rewards_get_status", "daily_rewards_claim",
  "daily_missions_get", "daily_missions_update_progress", "daily_missions_claim",
  "get_daily_missions", "submit_mission_progress", "claim_mission_reward",

  "--- Friends & Social ---",
  "friends_block", "friends_unblock", "friends_remove", "friends_list",
  "friends_challenge_user", "friends_spectate",
  "send_friend_invite", "accept_friend_invite", "decline_friend_invite",

  "--- Chat & Messaging ---",
  "send_group_chat_message", "send_direct_message", "send_chat_room_message",
  "get_group_chat_history", "get_direct_message_history", "get_chat_room_history",
  "mark_direct_messages_read",

  "--- Groups ---",
  "create_game_group", "update_group_xp", "get_group_wallet",
  "update_group_wallet", "get_user_groups",

  "--- Push Notifications ---",
  "push_register_token", "push_send_event", "push_get_endpoints",

  "--- Analytics ---",
  "analytics_log_event",

  "--- Game Registry ---",
  "get_game_registry", "get_game_by_id", "sync_game_registry",

  "--- Quiz ---",
  "quiz_submit_result", "quiz_get_history", "quiz_get_stats", "quiz_check_daily_completion",

  "--- Game Entry ---",
  "game_entry_validate", "game_entry_complete", "game_entry_get_status",

  "--- Player ---",
  "check_geo_and_update_profile", "get_player_portfolio",
  "rpc_update_player_metadata", "rpc_change_username",
  "get_player_metadata", "admin_delete_player_metadata",
  "calculate_score_reward", "update_game_reward_config",
  "get_notifications", "cleanup_guest_user_metadata",

  "--- Achievements ---",
  "achievements_get_all", "achievements_update_progress",
  "achievements_create_definition", "achievements_bulk_create",

  "--- Matchmaking ---",
  "matchmaking_find_match", "matchmaking_cancel", "matchmaking_get_status",
  "matchmaking_create_party", "matchmaking_join_party",

  "--- Tournaments ---",
  "tournament_create", "tournament_join", "tournament_list_active",
  "tournament_submit_score", "tournament_get_leaderboard", "tournament_claim_rewards",

  "--- Batch Operations ---",
  "batch_execute", "batch_wallet_operations", "batch_achievement_progress",

  "--- Infrastructure ---",
  "rate_limit_status", "cache_stats", "cache_clear",

  "--- Onboarding ---",
  "onboarding_get_state", "onboarding_update_state", "onboarding_complete_step",
  "onboarding_set_interests", "onboarding_get_interests",
  "onboarding_claim_welcome_bonus", "onboarding_first_quiz_complete",
  "onboarding_get_tomorrow_preview", "onboarding_track_session",
  "onboarding_get_retention_data", "onboarding_create_link_quiz",

  "--- Retention ---",
  "retention_grant_streak_shield", "retention_get_streak_shield",
  "retention_use_streak_shield", "retention_schedule_notification",
  "retention_get_recommendations", "retention_track_first_session",
  "retention_claim_welcome_bonus",

  "--- Weekly Goals ---",
  "weekly_goals_get_status", "weekly_goals_update_progress",
  "weekly_goals_claim_reward", "weekly_goals_claim_bonus",

  "--- Season Pass ---",
  "season_pass_get_status", "season_pass_add_xp",
  "season_pass_complete_quest", "season_pass_claim_reward",
  "season_pass_purchase_premium",

  "--- Monthly Milestones ---",
  "monthly_milestones_get_status", "monthly_milestones_update_progress",
  "monthly_milestones_claim_reward", "monthly_milestones_claim_legendary",

  "--- Collections ---",
  "collections_get_status", "collections_unlock_item",
  "collections_equip_item", "collections_add_mastery_xp",

  "--- Win-back ---",
  "winback_check_status", "winback_claim_rewards",
  "winback_record_session", "winback_schedule_reengagement",

  "--- Progressive Unlocks ---",
  "progressive_get_state", "progressive_claim_unlock",
  "progressive_check_feature", "progressive_update_progress",

  "--- Progression ---",
  "progression_add_mastery_xp", "progression_get_state", "progression_claim_prestige",

  "--- Rewarded Ads ---",
  "rewarded_ad_request_token", "rewarded_ad_claim",
  "rewarded_ad_validate_score_multiplier", "rewarded_ad_get_status",

  "--- Compatibility Quiz ---",
  "compatibility_create_session", "compatibility_join_session",
  "compatibility_get_session", "compatibility_submit_answers",
  "compatibility_calculate", "compatibility_list_sessions",

  "--- QuizVerse (game-specific, 30+ RPCs) ---",
  "quizverse_update_user_profile", "quizverse_grant_currency", "quizverse_spend_currency",
  "quizverse_grant_item", "quizverse_consume_item", "quizverse_list_inventory",
  "quizverse_save_player_data", "quizverse_load_player_data",
  "quizverse_submit_score", "quizverse_get_leaderboard",
  "quizverse_admin_grant_item", "quizverse_get_server_config",
  "quizverse_guild_create", "quizverse_guild_join", "quizverse_guild_leave",
  "quizverse_log_event", "quizverse_track_session_start", "quizverse_track_session_end",
  "quizverse_submit_multiplayer_match",

  "--- LastToLive (game-specific, 30+ RPCs) ---",
  "lasttolive_update_user_profile", "lasttolive_grant_currency", "lasttolive_spend_currency",
  "lasttolive_grant_item", "lasttolive_consume_item", "lasttolive_list_inventory",
  "lasttolive_save_player_data", "lasttolive_load_player_data",
  "lasttolive_submit_score", "lasttolive_get_leaderboard",
  "lasttolive_admin_grant_item", "lasttolive_get_server_config",
  "lasttolive_guild_create", "lasttolive_guild_join", "lasttolive_guild_leave",
  "lasttolive_log_event", "lasttolive_track_session_start", "lasttolive_track_session_end",
];

const OPERATOR_ACTIONS_SUMMARY = {
  read: [
    "get_wallet_balance", "wallet_get_all", "friends_list", "get_all_leaderboards",
    "get_leaderboard", "daily_rewards_get_status", "get_daily_missions",
    "achievements_get_all", "get_player_metadata", "get_player_portfolio",
    "onboarding_get_state", "onboarding_get_retention_data", "retention_get_recommendations",
    "winback_check_status", "weekly_goals_get_status", "season_pass_get_status",
    "monthly_milestones_get_status", "collections_get_status", "progressive_get_state",
    "progression_get_state", "rewarded_ad_get_status", "tournament_list_active",
    "matchmaking_get_status", "rate_limit_status", "cache_stats",
    "get_game_registry", "quiz_get_history", "quiz_get_stats", "compatibility_list_sessions",
  ],
  write: [
    "wallet_update_game_wallet (cap: 10000)", "wallet_update_global (cap: 5000)",
    "daily_rewards_claim", "daily_missions_update_progress", "claim_mission_reward",
    "achievements_update_progress", "submit_leaderboard_score",
    "send_group_chat_message", "send_direct_message", "send_chat_room_message",
    "send_friend_invite", "analytics_log_event", "weekly_goals_update_progress",
    "season_pass_add_xp (cap: 1000)", "collections_add_mastery_xp (cap: 500)",
    "progressive_update_progress", "progression_add_mastery_xp (cap: 500)",
    "retention_grant_streak_shield", "retention_schedule_notification",
    "winback_schedule_reengagement", "tournament_create", "tournament_join",
    "matchmaking_find_match", "create_game_group",
  ],
  admin: [
    "admin_delete_player_metadata", "cache_clear", "batch_execute",
    "batch_wallet_operations (cap: 50000)",
  ],
};

export function registerResources(
  server: McpServer,
  console: NakamaConsoleClient,
  _api: NakamaApiClient
) {
  server.resource(
    "server-status",
    "nakama://status",
    {
      description: "Live Nakama server status: connected users, match count, health",
      mimeType: "application/json",
    },
    async () => {
      const data = await console.getStatus();
      return {
        contents: [{
          uri: "nakama://status",
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        }],
      };
    }
  );

  server.resource(
    "storage-collections",
    "nakama://collections",
    {
      description: "List of all storage collection names in the Nakama database",
      mimeType: "application/json",
    },
    async () => {
      const data = await console.listStorageCollections();
      return {
        contents: [{
          uri: "nakama://collections",
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        }],
      };
    }
  );

  server.resource(
    "rpc-catalog",
    "nakama://rpc-catalog",
    {
      description: "Complete catalog of all 175+ registered RPCs callable via call_rpc or operator tools, organized by domain",
      mimeType: "application/json",
    },
    async () => ({
      contents: [{
        uri: "nakama://rpc-catalog",
        mimeType: "application/json",
        text: JSON.stringify(RPC_CATALOG, null, 2),
      }],
    })
  );

  server.resource(
    "operator-actions",
    "nakama://operator-actions",
    {
      description: "All actions available through the operator tool, organized by category (read/write/admin) with amount caps",
      mimeType: "application/json",
    },
    async () => ({
      contents: [{
        uri: "nakama://operator-actions",
        mimeType: "application/json",
        text: JSON.stringify(OPERATOR_ACTIONS_SUMMARY, null, 2),
      }],
    })
  );

  server.resource(
    "tool-guide",
    "nakama://tool-guide",
    {
      description: "Guide for AI agents: which tools to use for common tasks like engagement, analytics, live ops, moderation",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [{
        uri: "nakama://tool-guide",
        mimeType: "text/markdown",
        text: TOOL_GUIDE,
      }],
    })
  );
}

const TOOL_GUIDE = `# Nakama MCP Tool Guide for AI Agents

## When to use which tool

### "I want to understand a player"
1. \`get_account\` — full account details
2. \`get_player_profile\` — account + game-specific data
3. \`export_account\` — everything: storage, friends, groups, notifications
4. \`get_retention_data\` — session frequency, streak, churn risk
5. \`get_onboarding_state\` — new user activation status

### "I want to analyze the player base"
1. \`list_accounts\` — paginated user list
2. \`list_storage\` with collection="analytics_events" — event data
3. \`list_storage\` with collection="analytics_dau" — daily active users
4. \`list_leaderboard_records\` — score distributions
5. \`get_server_status\` — live player counts

### "I want to drive engagement"
1. \`send_notification\` — targeted push to specific user
2. \`chat_send_group\` — message in group channel
3. \`chat_send_direct\` — personalized DM
4. \`friends_challenge\` — social competition prompt
5. \`retention_schedule_notification\` via \`operator\` — scheduled re-engagement

### "I want to run live ops / events"
1. \`tournament_create\` — spin up a competitive event
2. \`leaderboard_submit_score\` — seed leaderboards
3. \`grant_currency\` — reward top players
4. \`batch_wallet_operations\` via \`operator\` — mass distribution

### "I want to manage the economy"
1. \`wallet_get\` / \`wallet_get_all\` — check balances
2. \`wallet_update\` — credit/debit (via operator for safety)
3. \`inventory_grant\` / \`inventory_remove\` — item management
4. \`get_wallet_ledger\` — transaction audit trail

### "I want to moderate"
1. \`user_flag\` — flag for review
2. \`ban_account\` / \`unban_account\` — ban management
3. \`delete_leaderboard_record\` — remove cheater scores
4. \`delete_account\` — permanent removal (GDPR/fraud)
5. \`audit_log\` — record actions

### "I want safe, policy-enforced actions"
Use the \`operator\` tool — it wraps 70+ RPCs with:
- Allowlist enforcement
- Amount caps on value-moving operations
- Automatic audit logging
- Required reasons for write/admin actions
`;
