declare function LegacyInitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void;

function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
  logger.info("========================================");
  logger.info("IntelliVerse-X Nakama Runtime v2.0");
  logger.info("Hiro + Satori Custom Build");
  logger.info("========================================");

  // ---- Legacy System Registration (backward-compatible RPCs) ----
  try {
    logger.info("[Legacy] Registering wallet RPCs...");
    LegacyWallet.register(initializer);

    logger.info("[Legacy] Registering leaderboard RPCs...");
    LegacyLeaderboards.register(initializer);

    logger.info("[Legacy] Registering game registry RPCs...");
    LegacyGameRegistry.register(initializer);

    logger.info("[Legacy] Registering daily rewards RPCs...");
    LegacyDailyRewards.register(initializer);

    logger.info("[Legacy] Registering quiz RPCs...");
    LegacyQuiz.register(initializer);

    logger.info("[Legacy] Registering game entry RPCs...");
    LegacyGameEntry.register(initializer);

    logger.info("[Legacy] Registering missions RPCs...");
    LegacyMissions.register(initializer);

    logger.info("[Legacy] Registering analytics RPCs...");
    LegacyAnalytics.register(initializer);

    logger.info("[Legacy] Registering friends RPCs...");
    LegacyFriends.register(initializer);

    logger.info("[Legacy] Registering groups RPCs...");
    LegacyGroups.register(initializer);

    logger.info("[Legacy] Registering push RPCs...");
    LegacyPush.register(initializer);

    logger.info("[Legacy] Registering player RPCs...");
    LegacyPlayer.register(initializer);

    logger.info("[Legacy] Registering chat RPCs...");
    LegacyChat.register(initializer);

    logger.info("[Legacy] Registering quests-economy bridge RPCs...");
    LegacyQuestsEconomyBridge.register(initializer);

    logger.info("[Legacy] Registering multi-game RPCs...");
    LegacyMultiGame.register(initializer);

    logger.info("[Shared] Registering storage RPCs...");
    Storage.register(initializer);

    logger.info("[Legacy] Registering analytics retention RPCs...");
    LegacyAnalyticsRetention.register(initializer);

    logger.info("[Legacy] Registering gift cards RPCs...");
    LegacyGiftCards.register(initializer);

    logger.info("[Legacy] Registering coupons RPCs...");
    LegacyCoupons.register(initializer);

    logger.info("[Legacy] All legacy RPCs registered successfully");
  } catch (err: any) {
    logger.error("[Legacy] Failed to register legacy RPCs: " + (err.message || String(err)));
  }

  // ---- Hiro Systems Registration ----
  try {
    logger.info("[Hiro] Registering Economy RPCs...");
    HiroEconomy.register(initializer);

    logger.info("[Hiro] Registering Inventory RPCs...");
    HiroInventory.register(initializer);

    logger.info("[Hiro] Registering Achievements RPCs...");
    HiroAchievements.register(initializer);

    logger.info("[Hiro] Registering Progression RPCs...");
    HiroProgression.register(initializer);

    logger.info("[Hiro] Registering Energy RPCs...");
    HiroEnergy.register(initializer);

    logger.info("[Hiro] Registering Stats RPCs...");
    HiroStats.register(initializer);

    logger.info("[Hiro] Registering Event Leaderboards RPCs...");
    HiroEventLeaderboards.register(initializer);

    logger.info("[Hiro] Registering Streaks RPCs...");
    HiroStreaks.register(initializer);

    logger.info("[Hiro] Registering Store RPCs...");
    HiroStore.register(initializer);

    logger.info("[Hiro] Registering Challenges RPCs...");
    HiroChallenges.register(initializer);

    logger.info("[Hiro] Registering Teams RPCs...");
    HiroTeams.register(initializer);

    logger.info("[Hiro] Registering Tutorials RPCs...");
    HiroTutorials.register(initializer);

    logger.info("[Hiro] Registering Unlockables RPCs...");
    HiroUnlockables.register(initializer);

    logger.info("[Hiro] Registering Auctions RPCs...");
    HiroAuctions.register(initializer);

    logger.info("[Hiro] Registering Incentives RPCs...");
    HiroIncentives.register(initializer);

    logger.info("[Hiro] Registering Mailbox RPCs...");
    HiroMailbox.register(initializer);

    logger.info("[Hiro] Registering Reward Bucket RPCs...");
    HiroRewardBucket.register(initializer);

    logger.info("[Hiro] Registering Personalizers RPCs...");
    HiroPersonalizers.register(initializer);

    logger.info("[Hiro] Registering Base Module RPCs...");
    HiroBase.register(initializer);

    logger.info("[Hiro] Registering Leaderboards RPCs...");
    HiroLeaderboards.register(initializer);

    logger.info("[Hiro] All Hiro systems registered successfully");
  } catch (err: any) {
    logger.error("[Hiro] Failed to register Hiro systems: " + (err.message || String(err)));
  }

  // ---- Satori Systems Registration ----
  try {
    logger.info("[Satori] Registering Event Capture RPCs...");
    SatoriEventCapture.register(initializer);

    logger.info("[Satori] Registering Identities RPCs...");
    SatoriIdentities.register(initializer);

    logger.info("[Satori] Registering Audiences RPCs...");
    SatoriAudiences.register(initializer);

    logger.info("[Satori] Registering Feature Flags RPCs...");
    SatoriFeatureFlags.register(initializer);

    logger.info("[Satori] Registering Experiments RPCs...");
    SatoriExperiments.register(initializer);

    logger.info("[Satori] Registering Live Events RPCs...");
    SatoriLiveEvents.register(initializer);

    logger.info("[Satori] Registering Messages RPCs...");
    SatoriMessages.register(initializer);

    logger.info("[Satori] Registering Metrics RPCs...");
    SatoriMetrics.register(initializer);

    logger.info("[Satori] Registering Webhooks RPCs...");
    SatoriWebhooks.register(initializer);

    logger.info("[Satori] Registering Taxonomy RPCs...");
    SatoriTaxonomy.register(initializer);

    logger.info("[Satori] Registering Data Lake RPCs...");
    SatoriDataLake.register(initializer);

    logger.info("[Satori] All Satori systems registered successfully");
  } catch (err: any) {
    logger.error("[Satori] Failed to register Satori systems: " + (err.message || String(err)));
  }

  // ---- Fantasy Cricket RPCs ----
  try {
    logger.info("[Fantasy] Registering Team RPCs...");
    FantasyTeam.register(initializer);

    logger.info("[Fantasy] Registering Transfer RPCs...");
    FantasyTransfer.register(initializer);

    logger.info("[Fantasy] Registering Scoring Engine RPCs...");
    FantasyScoring.register(initializer);

    logger.info("[Fantasy] Registering League RPCs...");
    FantasyLeague.register(initializer);

    logger.info("[Fantasy] All Fantasy Cricket RPCs registered successfully");
  } catch (err: any) {
    logger.error("[Fantasy] Failed to register Fantasy Cricket RPCs: " + (err.message || String(err)));
  }

  // ---- Admin Console RPCs ----
  try {
    logger.info("[Admin] Registering Admin Console RPCs...");
    AdminConsole.register(initializer);
    logger.info("[Admin] Admin Console registered successfully");
  } catch (err: any) {
    logger.error("[Admin] Failed to register Admin Console: " + (err.message || String(err)));
  }

  // ---- Event Bus Handlers ----
  try {
    HiroAchievements.registerEventHandlers();
    SatoriMetrics.registerEventHandlers();
    HiroRewardBucket.registerEventHandlers();
    SatoriWebhooks.registerEventHandlers();
    logger.info("[EventBus] Event handlers registered");
  } catch (err: any) {
    logger.error("[EventBus] Failed to register event handlers: " + (err.message || String(err)));
  }

  // ---- Legacy Master Bridge ----
  // Bridge the 99 RPCs from master's index.js that aren't in our TypeScript build.
  // LegacyInitModule is defined in data/modules/index.js (renamed from InitModule).
  // All handler functions live in the same VM global scope.
  try {
    if (typeof LegacyInitModule === "function") {
      var _tsRpcList = "admin_bulk_export,admin_bulk_import,admin_cache_invalidate,admin_config_delete,admin_config_get,admin_config_set,admin_delete_player_metadata,admin_events_timeline,admin_experiment_setup,admin_flag_toggle,admin_health_check,admin_inventory_grant,admin_live_event_schedule,admin_mailbox_send,admin_player_inspect,admin_satori_config_get,admin_satori_config_set,admin_storage_list,admin_user_data_delete,admin_user_data_get,admin_user_data_set,admin_user_search,admin_wallet_grant,admin_wallet_reset,admin_wallet_view,analytics_arpu,analytics_cohort_retention,analytics_log_event,analytics_track_retention_event,analytics_track_revenue,calculate_score_reward,check_geo_and_update_profile,claim_mission_reward,conversion_ratio_get,conversion_ratio_set,create_all_leaderboards_persistent,create_game_group,create_or_get_wallet,create_or_sync_user,create_player_wallet,create_time_period_leaderboards,daily_rewards_claim,daily_rewards_get_status,friends_block,friends_challenge_user,friends_list,friends_remove,friends_spectate,friends_unblock,game_coupon_list,game_coupon_redeem,game_coupon_sync_catalog,game_entry_complete,game_entry_get_status,game_entry_validate,game_gift_card_get_purchases,game_gift_card_list,game_gift_card_purchase,game_gift_card_sync_catalog,game_to_global_convert,game_to_global_preview,get_all_leaderboards,get_chat_room_history,get_daily_missions,get_direct_message_history,get_game_by_id,get_game_registry,get_group_chat_history,get_group_wallet,get_leaderboard,get_player_metadata,get_player_portfolio,get_time_period_leaderboard,get_user_groups,get_user_wallet,get_wallet_balance,get_wallet_registry,global_to_game_convert,global_wallet_balance,global_wallet_earn,global_wallet_history,global_wallet_spend,hiro_achievements_claim,hiro_achievements_list,hiro_achievements_progress,hiro_auctions_bid,hiro_auctions_create,hiro_auctions_list,hiro_auctions_resolve,hiro_challenges_claim,hiro_challenges_create,hiro_challenges_join,hiro_challenges_submit,hiro_economy_donation_claim,hiro_economy_donation_give,hiro_economy_donation_request,hiro_economy_rewarded_video,hiro_energy_add_modifier,hiro_energy_get,hiro_energy_refill,hiro_energy_spend,hiro_event_lb_claim,hiro_event_lb_list,hiro_event_lb_submit,hiro_iap_history,hiro_iap_validate,hiro_incentives_apply_referral,hiro_incentives_referral_code,hiro_incentives_return_bonus,hiro_inventory_consume,hiro_inventory_grant,hiro_inventory_list,hiro_leaderboards_list,hiro_leaderboards_records,hiro_leaderboards_submit,hiro_mailbox_claim,hiro_mailbox_claim_all,hiro_mailbox_delete,hiro_mailbox_list,hiro_personalizer_get_overrides,hiro_personalizer_preview,hiro_personalizer_remove_override,hiro_personalizer_set_override,hiro_progression_add_xp,hiro_progression_get,hiro_reward_bucket_get,hiro_reward_bucket_progress,hiro_reward_bucket_unlock,hiro_stats_get,hiro_stats_update,hiro_store_list,hiro_store_purchase,hiro_streaks_claim,hiro_streaks_get,hiro_streaks_update,hiro_teams_achievements,hiro_teams_get,hiro_teams_stats,hiro_teams_wallet_get,hiro_teams_wallet_update,hiro_tutorials_advance,hiro_tutorials_get,hiro_unlockables_buy_slot,hiro_unlockables_claim,hiro_unlockables_get,hiro_unlockables_start,intellidraws_enter,intellidraws_list,intellidraws_past,intellidraws_winners,lasttolive_get_weapon_stats,link_wallet_to_game,mark_direct_messages_read,push_get_endpoints,push_register_token,push_send_event,quiz_check_daily_completion,quiz_get_history,quiz_get_stats,quiz_submit_result,quizverse_get_quiz_categories,rpc_change_username,rpc_update_player_metadata,satori_audiences_compute,satori_audiences_get_memberships,satori_datalake_config,satori_datalake_delete_target,satori_datalake_manual_export,satori_datalake_set_enabled,satori_datalake_set_retention,satori_datalake_upsert_target,satori_event,satori_events_batch,satori_experiments_get,satori_experiments_get_variant,satori_flags_get,satori_flags_get_all,satori_flags_set,satori_identity_get,satori_identity_update_properties,satori_live_events_claim,satori_live_events_join,satori_live_events_list,satori_messages_broadcast,satori_messages_delete,satori_messages_list,satori_messages_read,satori_metrics_define,satori_metrics_prometheus,satori_metrics_query,satori_metrics_set_alert,satori_taxonomy_delete,satori_taxonomy_schemas,satori_taxonomy_strict_mode,satori_taxonomy_upsert,satori_taxonomy_validate,satori_webhooks_delete,satori_webhooks_list,satori_webhooks_test,satori_webhooks_upsert,send_chat_room_message,storage_read,storage_write,send_direct_message,send_group_chat_message,submit_leaderboard_score,submit_mission_progress,submit_score_and_sync,submit_score_to_time_periods,sync_game_registry,update_game_reward_config,update_group_wallet,update_group_xp,update_wallet_balance,wallet_conversion_rate,wallet_convert_preview,wallet_convert_to_global,wallet_get_all,wallet_get_balances,wallet_transfer_between_game_wallets,wallet_update_game_wallet,wallet_update_global".split(",");

      var _alreadyRegistered: { [id: string]: boolean } = {};
      for (var _ri = 0; _ri < _tsRpcList.length; _ri++) {
        _alreadyRegistered[_tsRpcList[_ri]] = true;
      }

      var _bridgedCount = 0;
      var _skippedCount = 0;
      var _proxyInit: any = Object.create(initializer);
      _proxyInit.registerRpc = function(id: string, fn: nkruntime.RpcFunction) {
        if (_alreadyRegistered[id]) {
          _skippedCount++;
        } else {
          initializer.registerRpc(id, fn);
          _alreadyRegistered[id] = true;
          _bridgedCount++;
        }
      };

      LegacyInitModule(ctx, logger, nk, _proxyInit);
      logger.info("[Bridge] Bridged " + _bridgedCount + " legacy master RPCs (skipped " + _skippedCount + " duplicates)");
    } else {
      logger.warn("[Bridge] LegacyInitModule not found - legacy RPCs not available");
    }
  } catch (err: any) {
    logger.error("[Bridge] Failed to bridge legacy RPCs: " + (err.message || String(err)));
  }

  logger.info("========================================");
  logger.info("IntelliVerse-X Runtime initialized!");
  logger.info("========================================");
}
