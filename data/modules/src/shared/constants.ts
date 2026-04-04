namespace Constants {
  export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
  export const DEFAULT_GAME_ID = "default";

  export function gameKey(gameId: string | undefined, key: string): string {
    var gid = gameId || DEFAULT_GAME_ID;
    if (gid === DEFAULT_GAME_ID) return key;
    return gid + ":" + key;
  }

  // Hiro storage collections
  export const HIRO_CONFIGS_COLLECTION = "hiro_configs";
  export const HIRO_ACHIEVEMENTS_COLLECTION = "hiro_achievements";
  export const HIRO_INVENTORY_COLLECTION = "hiro_inventory";
  export const HIRO_PROGRESSION_COLLECTION = "hiro_progression";
  export const HIRO_ENERGY_COLLECTION = "hiro_energy";
  export const HIRO_STATS_COLLECTION = "hiro_stats";
  export const HIRO_STREAKS_COLLECTION = "hiro_streaks";
  export const HIRO_TUTORIALS_COLLECTION = "hiro_tutorials";
  export const HIRO_UNLOCKABLES_COLLECTION = "hiro_unlockables";
  export const HIRO_MAILBOX_COLLECTION = "hiro_mailbox";
  export const HIRO_CHALLENGES_COLLECTION = "hiro_challenges";
  export const HIRO_AUCTIONS_COLLECTION = "hiro_auctions";

  // Satori storage collections
  export const SATORI_CONFIGS_COLLECTION = "satori_configs";
  export const SATORI_EVENTS_COLLECTION = "satori_events";
  export const SATORI_IDENTITY_COLLECTION = "satori_identity_props";
  export const SATORI_ASSIGNMENTS_COLLECTION = "satori_assignments";
  export const SATORI_MESSAGES_COLLECTION = "satori_messages";
  export const SATORI_METRICS_COLLECTION = "satori_metrics";

  // Fantasy Cricket storage collections
  export const FANTASY_COLLECTION = "fantasy_cricket";
  export const FANTASY_SEASON_LEADERBOARD = "fantasy_season";
  export const FANTASY_MATCH_LB_PREFIX = "fantasy_match_";
  export const FANTASY_LEAGUE_LB_PREFIX = "fantasy_league_";

  // Legacy storage collections (preserved for backward compatibility)
  export const WALLETS_COLLECTION = "wallets";
  export const LEADERBOARDS_REGISTRY_COLLECTION = "leaderboards_registry";
  export const DAILY_REWARDS_COLLECTION = "daily_rewards";
  export const MISSIONS_COLLECTION = "missions";
  export const QUIZ_RESULTS_COLLECTION = "quiz_results";
  export const GAME_REGISTRY_COLLECTION = "game_registry";
  export const ANALYTICS_COLLECTION = "analytics_error_events";
  export const PLAYER_METADATA_COLLECTION = "player_metadata";
  export const PUSH_TOKENS_COLLECTION = "push_tokens";
}
