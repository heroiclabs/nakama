declare function LegacyInitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void;
// Auto-populated by data/modules/postbuild.js — the set of RPC IDs registered
// by THIS TypeScript build (every `initializer.registerRpc("foo", ...)` in
// src/**/*.ts). Replaces the hand-maintained `_tsRpcList` literal that
// previously lived inline below; that list silently rotted whenever a TS
// RPC was added or renamed (the original `quizverse_find_friends`
// stub-shadowing bug, see legacy_runtime.js comment).
declare var __TS_OWNED_RPCS: { [id: string]: boolean } | undefined;

function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
  logger.info("========================================");
  logger.info("IntelliVerse-X Nakama Runtime v2.0");
  logger.info("Hiro + Satori Custom Build");
  logger.info("========================================");

  // ---- JS-runtime health probe (registered FIRST so it's available even
  //      if any later subsystem fails). Used by the k8s liveness/readiness
  //      probe and the CI deploy gate to detect "JS bundle failed to
  //      compile" — the cbeacf6 outage mode where Nakama serves HTTP 200
  //      on /healthcheck but every game RPC is dead.
  try {
    JsRuntimeHealth.register(initializer);
    logger.info("[Health] nakama_js_health registered");
  } catch (err: any) {
    logger.error("[Health] failed to register nakama_js_health: " + (err && err.message ? err.message : String(err)));
  }

  // ---- Analytics Alerts: init + instrument initializer BEFORE any module registers RPCs ----
  // Every subsequent initializer.registerRpc() call is auto-wrapped with timing/error capture.
  // The analytics RPCs themselves are registered on the ORIGINAL initializer to avoid
  // sampling-the-sampler recursion via the opportunistic scheduler tick.
  var originalInitializer = initializer;
  try {
    AnalyticsAlerts.init(ctx, logger);
    AnalyticsAlerts.register(originalInitializer);
    initializer = AnalyticsAlerts.instrumentInitializer(originalInitializer, logger);
    logger.info("[AnalyticsAlerts] hooks installed; all subsequent RPCs will be sampled");
  } catch (err: any) {
    logger.error("[AnalyticsAlerts] failed to install: " + (err && err.message ? err.message : String(err)));
  }

  // ---- IVX Multiplayer Kernel ----
  // Registers all in-tree match templates (sync-turn-v1 today; more added
  // in P5+) and the cross-template RPCs (mp_create_match,
  // mp_read_match_result, mp_list_templates). Mounted BEFORE the Legacy
  // and Hiro registrations so QuizVerse + future game plugins can call
  // MpKernelSyncTurn.registerGenerator(...) during their own register().
  try {
    MpKernelModule.register(initializer, logger);
  } catch (err: any) {
    logger.error("[MpKernel] failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- Game plugins on top of MpKernel ----
  // QuizVerse runs on SyncTurnMatch (turn template registered above).
  // Mounted AFTER the kernel so the SyncTurn generator registry exists,
  // and BEFORE the legacy bridge so QuizVerse rpc IDs are pinned in
  // _tsRpcList and the legacy_runtime.js stub cannot shadow them.
  try {
    QuizVersePlugin.register(initializer, nk, logger);
  } catch (err: any) {
    logger.error("[QuizVerse] plugin failed to mount: " + (err && err.message ? err.message : String(err)));
  }

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

    // Phase 0.5 (qv-insights-loop): product_changelog_append RPC. Lets any
    // service (deploy pipeline, satori experiment flipper, on-call ops)
    // log a step-change event that the AI-svc analyst will join into
    // every brief as a date-anchored citation.
    logger.info("[QvProductChangelog] Registering product_changelog_append RPC...");
    QvProductChangelog.register(initializer);

    // Phase 2A (qv-insights-loop): hourly InsightsAggregator + DLQ.
    // The aggregator hooks into the AnalyticsAlerts scheduler tick so
    // it runs opportunistically on every successful 3h slot post.
    // We additionally expose `insights_aggregator_tick` (manual debug
    // entry) and `pending_bundles_drain` (admin DLQ replay) here so an
    // operator can hand-trigger them out-of-band when investigating.
    logger.info("[InsightsAggregator] Registering insights_aggregator_tick + pending_bundles_drain RPCs...");
    InsightsAggregator.register(initializer);
    PendingBundles.register(initializer);

    // Phase 3 (qv-insights-loop): client crash log RPC. The IVXCrashUploader
    // (Unity SDK) batches & uploads exceptions/asserts/errors; we persist
    // each as a `game_crash_log` row and the InsightsAggregator picks up
    // the materialised `game_crash_pattern_summary[gameId]` blob to
    // attach the top patterns into the per-game (_global) bundle.
    logger.info("[QvCrashHandler] Registering crash_log_append RPC...");
    QvCrashHandler.register(initializer);

    // Phase 4 Cross-Sell Engine (qv-insights-loop): xsell_pick + xsell_record
    // RPCs. SDK -> Nakama -> AI svc proxy. Nakama signs every forward with
    // IVX_INSIGHTS_SHARED_SECRET and stamps the calling user's sha256-derived
    // user_id_hash so the AI svc delivery cap is enforceable per user.
    logger.info("[QvCrossSell] Registering xsell_pick + xsell_record RPCs...");
    QvCrossSell.register(initializer);

    // Phase 4B (qv-insights-loop): personalization_get + personalization_get_for_mode
    // RPCs. SDK -> Nakama -> AI svc proxy. Returns the per-user
    // smartNudge / todayFeed / pushSchedule / per-mode systemPromptAddenda
    // so the SDK can render them and so per-mode AI surfaces (AI Host /
    // Voice / Fortune / Tutor / Chat) can inject mode-specific addenda.
    logger.info("[QvPersonalization] Registering personalization_get + personalization_get_for_mode RPCs...");
    QvPersonalization.register(initializer);

    // Phase 7 (qv-insights-loop): privacy + consent forwarder RPCs. Admin-only;
    // bound to Nakama account-deletion webhook + the SDK consent-set RPC.
    // Cascade-deletes a user's footprint from the AI svc (GDPR Art.17 / CCPA)
    // and keeps the AI svc consent-gate cache in sync (COPPA / GDPR / CCPA).
    logger.info("[QvPrivacy] Registering privacy_erase_user / privacy_erase_discord / consent_upsert / consent_invalidate RPCs...");
    QvPrivacy.register(initializer);

    logger.info("[Legacy] Registering friends RPCs...");
    LegacyFriends.register(initializer);

    // ── First-class IntelliVerse friend search (replaces the historical
    //   quizverse_find_friends / lasttolive_find_friends RPCs which lived
    //   in `data/modules/multigame_rpcs.js` + `legacy_runtime.js` and were
    //   silently shadowed by a stub. The new TS implementation is in
    //   src/friends/find_friends.ts and wins precedence because main.ts
    //   runs before the legacy bridge and `intelliverse_find_friends` is
    //   pinned in `_tsRpcList` below.) ────────────────────────────────────
    logger.info("[Friends] Bootstrapping fuzzy-search DB extension + indexes (idempotent)...");
    // Ensures pg_trgm + GIN trigram indexes exist on users.username and
    // users.display_name. Safe to run on every boot — every statement uses
    // IF NOT EXISTS. If the runtime DB user lacks SUPERUSER (needed for
    // CREATE EXTENSION), the call logs a one-time WARN and the RPC handler
    // automatically degrades to ILIKE-only search (still tiered, no fuzzy).
    IntelliverseFriends.bootstrapDatabase(nk, logger);

    logger.info("[Friends] Registering intelliverse_find_friends RPC...");
    IntelliverseFriends.register(initializer);

    // ── Phase-4 C1+H1: canonical friends_list + list_blocked_users with
    //   flat shape + presence/relationship enrichment. Replaces the
    //   6-line passthrough that used to live in LegacyFriends.rpcFriendsList
    //   (which has been stripped from src/legacy/friends.ts in the same
    //   change) and adds the new list_blocked_users RPC. Both pinned in
    //   _tsRpcList below so the legacy bridge cannot shadow them. ────────
    logger.info("[Friends] Registering canonical friends_list + list_blocked_users...");
    IntelliverseFriendsList.register(initializer);

    logger.info("[Legacy] Registering groups RPCs...");
    LegacyGroups.register(initializer);

    logger.info("[Legacy] Registering push RPCs...");
    LegacyPush.register(initializer);

    logger.info("[Legacy] Registering notification scheduler match...");
    LegacyNotifScheduler.register(initializer);
    // NB: `nk.matchCreate()` cannot be called from inside InitModule —
    // Nakama's match-registry isn't fully wired up until InitModule
    // returns, so the call throws a Go-level error that the JS try/catch
    // can't recover (which rolls back EVERY registerRpc call in the
    // bundle, including nakama_js_health → smoke-test 404, build #199).
    // Spawn is now deferred to the first nakama_js_health tick after
    // boot (k8s liveness probe runs every 30 s, so the match is up
    // within 30 s of the pod becoming Ready). See src/shared/health.ts.

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

    logger.info("[Hiro] Registering Creator Event Rewards RPCs...");
    HiroCreatorEventRewards.register(initializer);

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

    logger.info("[Satori] Registering Creator Events RPCs...");
    SatoriCreatorEvents.register(initializer);

    logger.info("[Satori] Registering Video Feed RPCs...");
    SatoriVideoFeed.register(initializer);

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

  // ---- GeoTier IP-to-Country Resolution (PLAN-ADS-OPTIMIZATION-v2) ----
  try {
    logger.info("[GeoTier] Registering country_tier_get RPC...");
    GeoTier.register(initializer);
    logger.info("[GeoTier] GeoTier RPC registered successfully");
  } catch (err: any) {
    logger.error("[GeoTier] Failed to register GeoTier: " + (err.message || String(err)));
  }

  // ---- Ad Revenue Recording (PLAN-ADS-OPTIMIZATION-v2 §11) ----
  try {
    logger.info("[AdRevenueEvent] Registering ad_revenue_record RPC...");
    AdRevenueEvent.register(initializer, logger);
    logger.info("[AdRevenueEvent] Ad revenue recording registered successfully");
  } catch (err: any) {
    logger.error("[AdRevenueEvent] Failed to register: " + (err.message || String(err)));
  }

  // ---- Fortune Wheel Ad Spin (PLAN-ADS-OPTIMIZATION-v2 §4 #19) ----
  try {
    logger.info("[FortuneWheelAdSpin] Registering fortune_wheel_ad_spin RPC...");
    FortuneWheelAdSpin.register(initializer, logger);
    logger.info("[FortuneWheelAdSpin] Fortune wheel ad spin registered successfully");
  } catch (err: any) {
    logger.error("[FortuneWheelAdSpin] Failed to register: " + (err.message || String(err)));
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

  // ---- Cricket Game Modules ----
  try {
    logger.info("[Cricket] Registering Auction RPCs...");
    CricketAuction.register(initializer);

    logger.info("[Cricket] Registering Director RPCs...");
    CricketDirector.register(initializer);

    logger.info("[Cricket] All Cricket RPCs registered successfully");
  } catch (err: any) {
    logger.error("[Cricket] Failed to register Cricket RPCs: " + (err.message || String(err)));
  }

  // ---- Admin Console RPCs ----
  try {
    logger.info("[Admin] Registering Admin Console RPCs...");
    AdminConsole.register(initializer);
    logger.info("[Admin] Admin Console registered successfully");
  } catch (err: any) {
    logger.error("[Admin] Failed to register Admin Console: " + (err.message || String(err)));
  }

  // ---- QuizVerse Library v2.4.0 ----
  // Top Learners Library exam-countdown subscriptions + the n8n format-agent
  // pack-complete gate. Both modules ship the storage/RPC surface that the
  // intelli-verse-kube-infra n8n workflows (#20–25) consume; without them
  // the format-agents have no place to record completion and the pack
  // bundler never fires. See data/modules/src/library/*.ts headers for the
  // RPC contracts and the companion QUIZVERSE_LIBRARY_10X_PLAN.md spec.
  try {
    logger.info("[LibraryCountdown] Registering exam-countdown subscription RPCs...");
    LibraryCountdownPlugin.register(initializer, nk, logger);
    logger.info("[N8nPackState] Registering n8n_pack_state_* RPCs (pack bundler gate)...");
    N8nPackStatePlugin.register(initializer);
    logger.info("[Library] v2.4.0 RPCs registered successfully");
  } catch (err: any) {
    logger.error("[Library] Failed to register library v2.4.0 RPCs: " + (err.message || String(err)));
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
  // Bridge the RPCs from master's index.js that aren't in our TypeScript build.
  // LegacyInitModule is defined in data/modules/index.js (renamed from InitModule).
  // All handler functions live in the same VM global scope.
  //
  // The set of TS-owned RPC IDs (so the bridge knows which legacy IDs to
  // skip) is now AUTO-POPULATED by data/modules/postbuild.js as the global
  // `__TS_OWNED_RPCS`. It is built by scanning every
  // `initializer.registerRpc("...", ...)` call in src/**/*.ts at build time
  // and so cannot drift when a TS RPC is added/renamed/removed. If the
  // global is missing (e.g. the file is loaded outside the postbuild
  // pipeline), we fall back to an empty allow-set — i.e. legacy wins for
  // every duplicate ID, which is the historical behaviour and safe for
  // dev iteration.
  try {
    if (typeof LegacyInitModule === "function") {
      var _alreadyRegistered: { [id: string]: boolean } = {};
      var _tsOwned: { [id: string]: boolean } =
        (typeof __TS_OWNED_RPCS !== "undefined" && __TS_OWNED_RPCS) ? __TS_OWNED_RPCS : {};
      for (var _id in _tsOwned) {
        if (Object.prototype.hasOwnProperty.call(_tsOwned, _id)) {
          _alreadyRegistered[_id] = true;
        }
      }
      var _tsOwnedCount = 0;
      for (var _k in _alreadyRegistered) {
        if (Object.prototype.hasOwnProperty.call(_alreadyRegistered, _k)) _tsOwnedCount++;
      }
      logger.info("[Bridge] TS-owned RPCs (auto-discovered by postbuild): " + _tsOwnedCount);

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
