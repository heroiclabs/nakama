declare function LegacyInitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void;
// Auto-populated by data/modules/postbuild.js — the set of RPC IDs registered
// by THIS TypeScript build (every `initializer.registerRpc("foo", ...)` in
// src/**/*.ts). Replaces the hand-maintained `_tsRpcList` literal that
// previously lived inline below; that list silently rotted whenever a TS
// RPC was added or renamed (the original `quizverse_find_friends`
// stub-shadowing bug, see legacy_runtime.js comment).
declare var __TS_OWNED_RPCS: { [id: string]: boolean } | undefined;

// Group membership cross-device sync after-hooks. Defined as global-scope
// functions in data/modules/groups/groups.js (a discovered module → hoisted to
// the VM global object). They MUST be registered from here rather than from
// groups.js's own InitModule: postbuild.js renames discovered-module InitModule
// functions to __ModuleInit_N and never calls them, and its AST bridge only
// forwards registerRpc / registerMatch — registerAfterJoinGroup /
// registerAfterLeaveGroup calls placed there would be silently dropped.
declare function groupAfterJoinHook(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: void, request: nkruntime.JoinGroupRequest): void;
declare function groupAfterLeaveHook(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: void, request: nkruntime.LeaveGroupRequest): void;

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
    MpKernelModule.mount(initializer, logger);
  } catch (err: any) {
    logger.error("[MpKernel] failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- Game plugins on top of MpKernel ----
  // QuizVerse runs on SyncTurnMatch (turn template registered above).
  // Mounted AFTER the kernel so the SyncTurn generator registry exists,
  // and BEFORE the legacy bridge so QuizVerse rpc IDs are pinned in
  // _tsRpcList and the legacy_runtime.js stub cannot shadow them.
  try {
    // register(initializer) is single-arg on purpose so postbuild's
    // autoInvokeRegister re-runs it on every pooled Goja VM (populating the
    // quizverse_* __rpc_ stubs there — otherwise they're undefined on the
    // VMs that serve traffic → HTTP 500). Generators are registered lazily
    // at match-init time (see zz_mp_kernel_handlers.js) since they need `nk`
    // and the QuizVerseGame/Generator namespaces, which aren't safe to touch
    // at IIFE-eval time. This explicit call covers the initial VM.
    QuizVersePlugin.register(initializer);
  } catch (err: any) {
    logger.error("[QuizVerse] plugin failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- QuizVerse Nakama-Only Migration plugin ----
  // Registers the 22 v2 / Nakama-only RPCs (P0/P1/P2 live, P3-P8
  // scaffolded) that the Unity client adopts as each network surface
  // moves behind Nakama. See games/quiz-verse/Docs/plans/PLAN-NAKAMA_ONLY_MIGRATION.md
  // in the Unity repo for the rollout plan. Mounted after QuizVersePlugin
  // so P1's request_questions router can delegate to quizverse_quiz_generate
  // (registered as a top-level legacy module) and P2's submit_result_v2
  // can delegate to quiz_submit_result.
  try {
    QuizVerseMigration.register(initializer, nk, logger);
  } catch (err: any) {
    logger.error("[QuizVerseMigration] plugin failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- QuizVerse Live Banner (quizverse_live_banner_check) ----
  // Unified RPC that aggregates tournament / creator / satori events into
  // a single "should banner show + content" response consumed by HomeScreen.
  // Mounted after QuizVerseMigration so both quizverse_* namespaces are live.
  try {
    QuizVerseLiveBanner.register(initializer);
    logger.info("[LiveBanner] quizverse_live_banner_check registered");
  } catch (err: any) {
    logger.error("[LiveBanner] failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- QuizVerse product telemetry (quizverse_product_metrics → n8n WF-09) ----
  // Independent of QuizVerse Next.js /admin/metrics — both may call WF-09 in parallel.
  try {
    QuizVerseProductMetrics.register(initializer);
    logger.info("[ProductMetrics] quizverse_product_metrics registered");
  } catch (err: any) {
    logger.error("[ProductMetrics] failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- QuizVerse growth snapshots (quizverse_growth_snapshot → n8n WF-32/33/40/41) ----
  try {
    QuizVerseGrowthSnapshot.register(initializer);
    logger.info("[GrowthSnapshot] quizverse_growth_snapshot registered");
  } catch (err: any) {
    logger.error("[GrowthSnapshot] failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- IAP Entitlements (qv_entitlements collection RPCs) ----
  try {
    QvEntitlements.register(initializer);
    logger.info("[QvEntitlements] quizverse_get_entitlements + quizverse_rc_sync registered");
  } catch (err: any) {
    logger.error("[QvEntitlements] failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- Explainer video consumables (qv_entitlements / consumables) ----
  try {
    QvExplainerVideos.register(initializer);
    logger.info("[QvExplainerVideos] quizverse_videos_status/consume/grant registered");
  } catch (err: any) {
    logger.error("[QvExplainerVideos] failed to mount: " + (err && err.message ? err.message : String(err)));
  }

  // ---- Legacy System Registration (backward-compatible RPCs) ----
  try {
    logger.info("[Legacy] Registering wallet RPCs...");
    LegacyWallet.register(initializer);

    logger.info("[Legacy] Registering leaderboard RPCs...");
    LegacyLeaderboards.register(initializer);

    logger.info("[Legacy] Registering game registry RPCs...");
    LegacyGameRegistry.register(initializer);

    // QVBF_166: LegacyDailyRewards de-registered here.
    // daily_rewards/daily_rewards.js owns both daily_rewards_get_status and
    // daily_rewards_claim. Keeping both registrations caused the two handlers
    // to race for the same RPC name, producing mismatched reward tables.
    // logger.info("[Legacy] Registering daily rewards RPCs...");
    // LegacyDailyRewards.register(initializer);

    logger.info("[Legacy] Registering quiz RPCs...");
    LegacyQuiz.register(initializer);

    logger.info("[Legacy] Registering game entry RPCs...");
    LegacyGameEntry.register(initializer);

    logger.info("[Legacy] Registering analytics RPCs...");
    LegacyAnalytics.register(initializer);

    // Phase 0.5 (qv-insights-loop): product_changelog_append RPC. Lets any
    // service (deploy pipeline, satori experiment flipper, on-call ops)
    // log a step-change event that the AI-svc analyst will join into
    // every brief as a date-anchored citation.
    logger.info("[QvProductChangelog] Registering product_changelog_append RPC...");
    QvProductChangelog.register(initializer);

    // Phase 4 (avatar bakeoff): cross-platform telemetry from web + Unity
    // describing which AutoCurio renderer (2d / 3d / video) the user saw,
    // and what reactions / transitions happened during onboarding.
    logger.info("[QvAvatarComparison] Registering analytics_avatar_comparison RPC...");
    QvAvatarComparison.register(initializer);

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

    // AI content-factory pipeline RPCs (weekly_recap / monthly_recap /
    // motion_graphics / poll). Unity calls these and Nakama signs +
    // forwards to the AI svc's /content-factory/from-nakama/* routes
    // using the existing IVX_INSIGHTS_SHARED_SECRET. Acting user id is
    // stamped from `ctx.userId` so the SDK can never spoof identities.
    //
    // Note: AiPipelines.register() takes ONLY `(initializer)` so that
    // data/modules/postbuild.js auto-invokes it at IIFE scope and the
    // `__rpc_*` globals are visible to the generated InitModule
    // wrapper. See comments in src/ai-content/ai_pipelines.ts.
    try {
      logger.info("[AiPipelines] Registering ai_pipeline_weekly_recap / monthly_recap / motion_graphics / poll RPCs...");
      AiPipelines.register(initializer);
    } catch (err: any) {
      logger.error("[AiPipelines] failed to register: " + (err && err.message ? err.message : String(err)));
    }

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

    // ── "People Near You" friend suggestions (same-country, not-yet-friends).
    //   Lives in src/friends/find_nearby_players.ts and registers
    //   `intelliverse_find_nearby_players`. Reuses the GeoTier cache for the
    //   caller's country and the canonical player_presence/status presence
    //   schema, and is auto-pinned in __TS_OWNED_RPCS by postbuild so the
    //   legacy bridge cannot shadow it. ────────────────────────────────────
    logger.info("[Friends] Registering intelliverse_find_nearby_players RPC...");
    IntelliverseNearbyPlayers.register(initializer);

    // ── Phase-4 C1+H1: canonical friends_list + list_blocked_users with
    //   flat shape + presence/relationship enrichment. Replaces the
    //   6-line passthrough that used to live in LegacyFriends.rpcFriendsList
    //   (which has been stripped from src/legacy/friends.ts in the same
    //   change) and adds the new list_blocked_users RPC. Both pinned in
    //   _tsRpcList below so the legacy bridge cannot shadow them. ────────
    logger.info("[Friends] Registering canonical friends_list + list_blocked_users...");
    IntelliverseFriendsList.register(initializer);

    // ── Player Presence + Cross-Game Messages ─────────────────────────────
    // Owns `ivx_set_player_presence`, `ivx_get_cross_game_messages`, and
    // `ivx_mark_message_read`. The legacy handler in legacy_runtime.js
    // wrote presence to `player_presence/current`, but find_friends.ts and
    // friends_list.ts both read from `player_presence/status` — the wrong
    // key made everyone appear permanently offline. This TS module writes
    // to the correct key and uses the canonical { online, lastSeenMs }
    // schema that the friend-search modules expect. All three RPC IDs are
    // pinned in __TS_OWNED_RPCS by postbuild so the legacy stubs are
    // suppressed before they can shadow them.
    logger.info("[IvxPresence] Registering ivx_set_player_presence / ivx_get_cross_game_messages / ivx_mark_message_read RPCs...");
    IvxPresence.register(initializer);

    logger.info("[Legacy] Registering groups RPCs...");
    LegacyGroups.register(initializer);

    // ── Group membership cross-device sync hooks ──────────────────────────
    // After a successful built-in JoinGroup / LeaveGroup, send the acting user
    // a self-notification (code 500 / 501) so ALL of their open sockets — i.e.
    // their other devices — refresh "My Groups" in real time. Without this,
    // only the device that performed the action knows the membership changed.
    // Handlers live in data/modules/groups/groups.js (global scope).
    try {
      if (typeof groupAfterJoinHook === "function") {
        initializer.registerAfterJoinGroup(groupAfterJoinHook);
        logger.info("[Groups] registerAfterJoinGroup hook installed (cross-device sync, code 500)");
      } else {
        logger.warn("[Groups] groupAfterJoinHook not found — cross-device join sync disabled");
      }
      if (typeof groupAfterLeaveHook === "function") {
        initializer.registerAfterLeaveGroup(groupAfterLeaveHook);
        logger.info("[Groups] registerAfterLeaveGroup hook installed (cross-device sync, code 501)");
      } else {
        logger.warn("[Groups] groupAfterLeaveHook not found — cross-device leave sync disabled");
      }
    } catch (err: any) {
      logger.error("[Groups] Failed to install group membership sync hooks: " + (err && err.message ? err.message : String(err)));
    }

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

  // ---- Quest Engine Registration ----
  try {
    logger.info("[QuestEngine] Registering quest_engine_get / record_event / claim_reward / admin_save_config / admin_get_config RPCs...");
    QuestEngine.register(initializer);
    logger.info("[QuestEngine] 5 RPCs registered successfully");

    // Register EventBus bridge for automatic quest progress from existing events
    logger.info("[QuestEventBusBridge] Registering EventBus subscriptions...");
    QuestEventBusBridge.register(initializer, logger);
    logger.info("[QuestEventBusBridge] Apps can now auto-progress quests via existing analytics events");
  } catch (err: any) {
    logger.error("[QuestEngine] Failed to register: " + (err && err.message ? err.message : String(err)));
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

    logger.info("[Identity] Registering Identity Resolver RPCs (cross-channel sub linking)...");
    try {
      IdentityResolver.register(initializer);
      logger.info("[Identity] identity_resolve, identity_link, identity_unlink, identity_list_mine registered");
    } catch (err: any) {
      logger.error("[Identity] failed to register IdentityResolver: " + (err && err.message ? err.message : String(err)));
    }

    logger.info("[Wow] Registering Wow Moments runtime (server-ranked select + closed-loop react)...");
    try {
      WowMoments.register(initializer);
      logger.info("[Wow] wow_moments_select, wow_moments_react, wow_moments_state_get registered");
    } catch (err: any) {
      logger.error("[Wow] failed to register WowMoments: " + (err && err.message ? err.message : String(err)));
    }

    // ── QuizVerse Agent runtime (Phase A — Conversational AI omnichannel) ──
    // Tool surface for the Intelliverse-X-AI gateway, called via http_key +
    // service_token. See data/modules/src/qv-agent/qv_agent.ts for the full
    // RPC contract and tracking issue intelli-verse-x/Quizverse-web-frontend#81.
    logger.info("[QvAgent] Registering QuizVerse Agent RPCs (memory, rank, performance, trivia, leaderboard)...");
    try {
      QvAgent.register(initializer);
      logger.info("[QvAgent] qv_agent_ping, _memory_write, _memory_read, _get_my_rank, _global_leaderboard_top10, _analyze_quiz_performance, _generate_trivia registered");
    } catch (err: any) {
      logger.error("[QvAgent] failed to register QvAgent: " + (err && err.message ? err.message : String(err)));
    }

    // ── User KB inspection RPCs (Nakama wrapper around the BFF dump route) ──
    // qv_kb_user_dump / qv_kb_user_summary / qv_kb_user_kind. Lets the Unity
    // client render the in-game Knowledge Graph view through the normal
    // Nakama SDK without ever shipping the admin secret in the build. See
    // data/modules/src/kb/qv_kb_user_dump.ts for the full RPC contract.
    // Requires QV_KB_ADMIN_SECRET (mandatory) and
    // QV_KB_NAKAMA_SERVICE_TOKEN (for service-token callers) in runtime.env.
    logger.info("[QvKbUserDump] Registering qv_kb_user_dump / _summary / _kind RPCs...");
    try {
      QvKbUserDump.register(initializer);
      logger.info("[QvKbUserDump] qv_kb_user_dump, qv_kb_user_summary, qv_kb_user_kind registered");
    } catch (err: any) {
      logger.error("[QvKbUserDump] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    // ── QuizVerse Learner Toolbelt (Phase A — Score Predictor / Exam Countdown /
    //   GPA Calculator / School Info Gathering) ────────────────────────────
    // Skeleton PR: every RPC returns { ok: true, status: "not_implemented",
    // phase: "skeleton-A" }. Algorithms land in waves 4-5. Auth + wire format
    // are real so the gateway can register all tool dispatchers in parallel.
    // See data/modules/src/learner-toolbelt/learner_toolbelt.ts and the plan
    // doc at docs/strategy/PLAN-LEARNER_TOOLBELT.md (mirrored from the Unity
    // quiz-verse repo).
    logger.info("[LearnerToolbelt] Registering Learner Toolbelt RPCs (13 RPCs: predict, countdown, GPA, school)...");
    try {
      // Phase B: ensure the lt_schools table + indexes exist so the School &
      // College Finder serves the real ~177k-row index (loaded by the
      // content-factory ETL). Idempotent + non-fatal — search degrades to the
      // in-memory fixture if this fails.
      LearnerToolbelt.bootstrapSchoolsTable(nk, logger);
      LearnerToolbelt.register(initializer);
      logger.info("[LearnerToolbelt] lt_score_predict, lt_exam_countdown_{get,set,clear}, lt_exam_calendar_get, lt_gpa_{compute,save,get}, lt_school_{search,get_detail,set_user_school,get_user_school,freetext_submit} registered");
    } catch (err: any) {
      logger.error("[LearnerToolbelt] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    logger.info("[KbEnrichment] Registering KB enrichment cron RPCs (continuous derived-attribute refresh)...");
    try {
      KbEnrichment.register(initializer);
      logger.info("[KbEnrichment] kb_enrichment_run_for_user, kb_enrichment_tick, kb_enrichment_register_user registered");
    } catch (err: any) {
      logger.error("[KbEnrichment] failed to register KbEnrichment: " + (err && err.message ? err.message : String(err)));
    }

    // Conversation → User KB ingestion (PLAN-CONVERSATIONAL_HUB.md §E.5).
    // 3 RPCs: conv_message_capture (service-only inbound funnel),
    // conv_my_list (user-side, powers /me/reveal), conv_user_purge
    // (DPDP Article 17 / GDPR right-to-erasure).
    logger.info("[ConvCapture] Registering Conversation Hub capture RPCs...");
    try {
      ConvCapture.register(initializer);
      logger.info("[ConvCapture] conv_message_capture, conv_my_list, conv_user_purge registered");
    } catch (err: any) {
      logger.error("[ConvCapture] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    // User Model (PLAN-USER_INTELLIGENCE_LOOP.md PR-5). Read derived
    // attributes + ingest the 25-event behavioural signal taxonomy +
    // per-channel consent toggles.
    logger.info("[UserModel] Registering User Model RPCs (derived + signals + consent)...");
    try {
      UserModel.register(initializer);
      logger.info("[UserModel] user_model_get, user_model_signal_ingest, user_model_consent_set registered");
    } catch (err: any) {
      logger.error("[UserModel] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    // Brain Coins economy (PLAN-CONVERSATIONAL_HUB.md §G). Soft currency
    // ledger; earn rules enforced server-side; Tremendous redemption
    // settled via service-token callback from /api/p2e/tremendous/mint.
    logger.info("[BrainCoins] Registering Brain Coins P2E RPCs...");
    try {
      BrainCoins.register(initializer);
      logger.info("[BrainCoins] brain_coins_get, brain_coins_earn, brain_coins_redeem_request, brain_coins_redemption_settle registered");
    } catch (err: any) {
      logger.error("[BrainCoins] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    // Wallet guest sync (plan §1I gap 3). User-callable RPC that reconciles
    // an anonymous web visitor's Applixir guest BC into their Nakama wallet
    // post-Cognito sign-up. Idempotent via guest_sync_{wallet_id} key.
    logger.info("[WalletGuestSync] Registering wallet_sync_guest_to_account RPC...");
    try {
      WalletGuestSync.register(initializer);
      logger.info("[WalletGuestSync] wallet_sync_guest_to_account registered");
    } catch (err: any) {
      logger.error("[WalletGuestSync] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    // Account merge (plan §1I gap 2). Service-only RPC triggered by the
    // post-signup callback that ports a ghost Nakama user's BC ledger,
    // tournament entries, pre-enrollments, and referrals into the real
    // Cognito-linked user. Closes identity_resolver.ts:397-401 TODO.
    logger.info("[AccountMerge] Registering account_merge_ghost_to_cognito RPC...");
    try {
      AccountMerge.register(initializer);
      logger.info("[AccountMerge] account_merge_ghost_to_cognito registered");
    } catch (err: any) {
      logger.error("[AccountMerge] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    logger.info("[OnboardingAnalytics] Registering web onboarding event ingest + funnel RPCs...");
    try {
      OnboardingAnalytics.register(initializer);
      logger.info("[OnboardingAnalytics] onboarding_events_batch, onboarding_identity_link, onboarding_funnel_screens registered");
    } catch (err: any) {
      logger.error("[OnboardingAnalytics] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    // ── Tournaments + P2E (plan §1-§3) ─────────────────────────────────────
    // Full launch-slate tournament system. Registers 25 RPCs across:
    //   - user-callable (list/get/enter/submit/leaderboard×6/claim/picks/pre-enroll/...)
    //   - service-only (admin_create/settle/eliminate_round/cron_tick/pregen)
    // Plus the format engine (classic | elimination | pick_n), Bracket bridge,
    // realtime push, anti-cheat, and content-factory integration.
    //
    // Plan ref: /.cursor/plans/quizverse_tournaments_+_p2e_5013b974.plan.md
    logger.info("[Tournaments] Registering tournament RPCs (25 total: 18 user + 7 service)...");
    try {
      TournamentRpcs.register(initializer);
      TournamentCrons.register(initializer);
      logger.info("[Tournaments] All tournament RPCs + crons registered");
    } catch (err: any) {
      logger.error("[Tournaments] failed to register: " + (err && err.message ? err.message : String(err)));
    }

    logger.info("[Satori] Registering Audiences RPCs...");
    SatoriAudiences.register(initializer);

    logger.info("[Satori] Registering Audience Estimator RPCs...");
    SatoriAudienceEstimate.register(initializer);

    logger.info("[Satori] Registering Identity Inspector RPCs...");
    SatoriIdentityInspector.register(initializer);

    logger.info("[Satori] Registering Feature Flags RPCs...");
    SatoriFeatureFlags.register(initializer);

    logger.info("[Satori] Registering Experiments RPCs...");
    SatoriExperiments.register(initializer);

    logger.info("[Satori] Registering Experiment Results RPCs (conversions + significance)...");
    SatoriExperimentResults.register(initializer);

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

    logger.info("[Satori] Registering Event Debugger RPCs (live tail + search)...");
    SatoriEventDebugger.register(initializer);

    logger.info("[Satori] Registering Funnels RPCs...");
    SatoriFunnels.register(initializer);

    logger.info("[Satori] Registering Retention RPCs...");
    SatoriRetention.register(initializer);

    logger.info("[Satori] Registering Satori Direct Control RPCs (cloud mirror kill-switch)...");
    SatoriDirectControl.register(initializer);

    logger.info("[Satori] Registering Dashboard summary RPC...");
    SatoriDashboard.register(initializer);

    logger.info("[Satori] Registering Timeline RPC...");
    SatoriTimeline.register(initializer);

    logger.info("[Satori] Registering Reports RPCs...");
    SatoriReports.register(initializer);

    logger.info("[Satori] Registering EventBus bridge (gameplay events -> Satori capture)...");
    SatoriEventBusBridge.register(initializer, logger);

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
    // QVBF_218: register() is single-arg on purpose so postbuild auto-invokes it
    // at IIFE scope (VM-pool safe). Do not pass logger here.
    FortuneWheelAdSpin.register(initializer);
    logger.info("[FortuneWheelAdSpin] Fortune wheel ad spin registered successfully");
  } catch (err: any) {
    logger.error("[FortuneWheelAdSpin] Failed to register: " + (err.message || String(err)));
  }

  try {
    logger.info("[WebAdReward] Registering quizverse_web_ad_reward RPC...");
    WebAdReward.register(initializer, logger);
  } catch (err: any) {
    logger.error("[WebAdReward] Failed to register: " + (err.message || String(err)));
  }

  // ---- TutorX Progress (server-authoritative XP + streak/freeze + quests) ----
  // Replaces the client-only (localStorage) gamification in the TutorX web SPA.
  // register() is single-arg on purpose so postbuild's autoInvokeRegister
  // re-runs it on every pooled Goja VM (populating the __rpc_tutorx_* stubs
  // there — otherwise they're undefined on the VMs serving traffic → HTTP 500).
  try {
    logger.info("[TutorXProgress] Registering tutorx_xp_get / xp_add / streak_touch / quest_claim RPCs...");
    TutorXProgress.register(initializer);
    logger.info("[TutorXProgress] TutorX progress RPCs registered successfully");
  } catch (err: any) {
    logger.error("[TutorXProgress] Failed to register: " + (err && err.message ? err.message : String(err)));
  }

  // ---- TutorX Study Plan (server-authoritative checklist completion state) ----
  // Single-arg register() so postbuild's autoInvokeRegister re-runs it on every
  // pooled Goja VM (same rationale as TutorXProgress above).
  try {
    logger.info("[TutorXStudyPlan] Registering tutorx_studyplan_get / toggle RPCs...");
    TutorXStudyPlan.register(initializer);
    logger.info("[TutorXStudyPlan] TutorX study-plan RPCs registered successfully");
  } catch (err: any) {
    logger.error("[TutorXStudyPlan] Failed to register: " + (err && err.message ? err.message : String(err)));
  }

  // ---- Hermes nightly learning-loop agent (Play 3) ----
  // Server-side persistent agent that composes a per-learner morning brief from
  // durable Nakama state (entitlement + study-plan checklist + optional DeepTutor
  // enrichment), persists it, and pushes a deep-linked notification. The nightly
  // batch driver (quizverse_hermes_nightly_tick) is invoked by a k8s CronJob.
  // Single-arg register() so postbuild's autoInvokeRegister re-runs it on every
  // pooled Goja VM (same rationale as TutorXProgress/StudyPlan above).
  try {
    logger.info("[Hermes] Registering quizverse_hermes_brief_get / _generate / _parent_recap / _nightly_tick RPCs...");
    Hermes.register(initializer);
    logger.info("[Hermes] Hermes nightly-loop RPCs registered successfully");
  } catch (err: any) {
    logger.error("[Hermes] Failed to register: " + (err && err.message ? err.message : String(err)));
  }

  // ---- Blog Quiz embeddable widget (link-building) ----
  // quizverse_blog_embed_create / _get + quizverse_embed_quiz_complete / _claim_pending.
  // Single-arg register() so postbuild's autoInvokeRegister re-runs it on every
  // pooled Goja VM (same rationale as Hermes above).
  try {
    logger.info("[BlogEmbed] Registering quizverse_blog_embed_create / _get / embed_quiz_complete / claim_pending RPCs...");
    BlogEmbed.register(initializer);
    logger.info("[BlogEmbed] Blog-quiz embed RPCs registered successfully");
  } catch (err: any) {
    logger.error("[BlogEmbed] Failed to register: " + (err && err.message ? err.message : String(err)));
  }

  // ---- Research & Validation instrument (SBIR/IES grant evidence) ----
  // Consent (COPPA/FERPA-aware), A/B assignment (adaptive vs control), pre/post
  // diagnostic with normalized learning gain, surveys (student/teacher/customer/
  // SUS/NPS), waitlist capture, and an admin/service-only aggregate export that
  // produces the proposal-appendix numbers. Single-arg register() so postbuild's
  // autoInvokeRegister re-runs it on every pooled Goja VM.
  // See data/modules/src/research/research.ts.
  try {
    logger.info("[Research] Registering quizverse_research_* RPCs (consent, assignment, diagnostic, survey, waitlist, export)...");
    Research.register(initializer);
    logger.info("[Research] quizverse_research_consent/_assignment_get/_diagnostic_submit/_survey_submit/_waitlist_join/_export registered");
  } catch (err: any) {
    logger.error("[Research] Failed to register: " + (err && err.message ? err.message : String(err)));
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
          // Bridged-from-legacy proxy. The actual RPC name reaches Goja's
          // AST walker via the literal-string registerRpc call inside
          // LegacyInitModule itself; this passthrough is just gating
          // duplicates. nakama-allow-dynamic-rpc-id
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
