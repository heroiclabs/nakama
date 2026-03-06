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

  logger.info("========================================");
  logger.info("IntelliVerse-X Runtime initialized!");
  logger.info("========================================");
}
