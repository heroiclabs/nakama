namespace QuestEngine {

  // ─── Types ────────────────────────────────────────────────────────────────

  interface QuestStepConfig {
    id: string;
    description: string;
    eventType: string;
    requiredCount: number;
    requiredValue?: number;
    filterField?: string;
    filterValue?: string;
  }

  interface QuestConfig {
    id: string;
    name: string;
    description?: string;
    category?: string;
    steps: QuestStepConfig[];
    reward?: Hiro.Reward;
    expiresAt?: number;
    prerequisiteIds?: string[];
    repeatable?: boolean;
    resetIntervalSec?: number;
    additionalProperties?: { [key: string]: string };
  }

  interface QuestsConfig {
    quests: { [questId: string]: QuestConfig };
  }

  interface StepProgress {
    count: number;
    completedAt: number | null;
  }

  interface QuestProgress {
    questId: string;
    steps: { [stepId: string]: StepProgress };
    startedAt: number | null;
    completedAt: number | null;
    claimedAt: number | null;
    resetCount: number;
    lastResetAt: number | null;
  }

  interface UserQuestState {
    quests: { [questId: string]: QuestProgress };
  }

  // ─── Constants ────────────────────────────────────────────────────────────

  // Collection used for per-player state (owner-readable, server-write only)
  var QUEST_ENGINE_COLLECTION = "qv_quests";
  // Collection used for admin-managed quest config (public-read, system-write)
  var QUEST_CONFIG_COLLECTION = "qv_quest_config";
  var DEFAULT_QUESTS_CONFIG: QuestsConfig = { quests: {} };

  // ─── Calendar helpers ────────────────────────────────────────────────────
  // Returns the next midnight UTC boundary from a given unix timestamp (seconds).
  function nextMidnightUtc(nowSec: number): number {
    var ms = nowSec * 1000;
    var d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 1);
    return Math.floor(d.getTime() / 1000);
  }

  // Returns the unix timestamp for the start of the next Monday UTC.
  function nextMondayMidnightUtc(nowSec: number): number {
    var ms = nowSec * 1000;
    var d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    var day = d.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
    var daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysUntilMonday);
    return Math.floor(d.getTime() / 1000);
  }

  // Returns the unix timestamp for the 1st day of the next UTC month.
  function nextMonthStartUtc(nowSec: number): number {
    var ms = nowSec * 1000;
    var d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
    return Math.floor(d.getTime() / 1000);
  }

  // Admin users allowed to save quest config (server-key or specific roles).
  // An empty userId in ctx means the call came via server key — always allowed.
  function isAdminCaller(ctx: nkruntime.Context): boolean {
    return !ctx.userId || ctx.userId === Constants.SYSTEM_USER_ID;
  }

  // ─── Storage ──────────────────────────────────────────────────────────────

  // ─── Storage helpers ──────────────────────────────────────────────────────

  // Config key: "{gameId}" — matches KT Section 13.
  function configKey(gameId: string): string {
    return gameId;
  }

  // Player state key: "{gameId}_{userId}" — matches KT Section 13.
  function stateKey(gameId: string, userId: string): string {
    return gameId + "_" + userId;
  }

  function loadConfig(nk: nkruntime.Nakama, gameId: string): QuestsConfig {
    var rows: nkruntime.StorageObject[] = [];
    try {
      rows = nk.storageRead([{
        collection: QUEST_CONFIG_COLLECTION,
        key: configKey(gameId),
        userId: Constants.SYSTEM_USER_ID
      }]);
    } catch (_) {}
    if (rows && rows.length > 0 && rows[0].value) {
      return rows[0].value as QuestsConfig;
    }
    return DEFAULT_QUESTS_CONFIG;
  }

  function saveConfig(nk: nkruntime.Nakama, gameId: string, config: QuestsConfig): void {
    nk.storageWrite([{
      collection: QUEST_CONFIG_COLLECTION,
      key: configKey(gameId),
      userId: Constants.SYSTEM_USER_ID,
      value: config,
      permissionRead:  2 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);
  }

  function loadUserState(nk: nkruntime.Nakama, userId: string, gameId: string): UserQuestState {
    var rows: nkruntime.StorageObject[] = [];
    try {
      rows = nk.storageRead([{
        collection: QUEST_ENGINE_COLLECTION,
        key: stateKey(gameId, userId),
        userId: userId
      }]);
    } catch (_) {}
    if (rows && rows.length > 0 && rows[0].value) {
      return rows[0].value as UserQuestState;
    }
    return { quests: {} };
  }

  function saveUserState(nk: nkruntime.Nakama, userId: string, gameId: string, state: UserQuestState): void {
    // permissionWrite: 0 — server-only writes prevent client-side cheating.
    // permissionRead: 1 — owner can read their own state.
    nk.storageWrite([{
      collection: QUEST_ENGINE_COLLECTION,
      key: stateKey(gameId, userId),
      userId: userId,
      value: state,
      permissionRead:  1 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function getOrCreateQuestProgress(state: UserQuestState, questId: string): QuestProgress {
    if (!state.quests[questId]) {
      state.quests[questId] = {
        questId: questId,
        steps: {},
        startedAt: null,
        completedAt: null,
        claimedAt: null,
        resetCount: 0,
        lastResetAt: null
      };
    }
    return state.quests[questId];
  }

  function getStepCount(progress: QuestProgress, stepId: string): number {
    return (progress.steps[stepId] && progress.steps[stepId].count) || 0;
  }

  function getStepCompletedAt(progress: QuestProgress, stepId: string): number | null {
    return (progress.steps[stepId] && progress.steps[stepId].completedAt) || null;
  }

  function isQuestUnlocked(config: QuestConfig, state: UserQuestState): boolean {
    if (!config.prerequisiteIds || config.prerequisiteIds.length === 0) return true;
    for (var i = 0; i < config.prerequisiteIds.length; i++) {
      var pre = state.quests[config.prerequisiteIds[i]];
      if (!pre || !pre.completedAt) return false;
    }
    return true;
  }

  function isQuestExpired(config: QuestConfig, now: number): boolean {
    return !!(config.expiresAt && now > config.expiresAt);
  }

  function shouldResetQuest(config: QuestConfig, progress: QuestProgress, now: number): boolean {
    if (!config.repeatable || !progress.completedAt) return false;
    // resetIntervalSec takes priority (custom interval).
    if (config.resetIntervalSec) {
      return now >= (progress.completedAt + config.resetIntervalSec);
    }
    // Calendar-based reset derived from category.
    // A quest completed in a previous window should reset once the new window starts.
    var cat = config.category || "";
    if (cat === "daily") {
      return now >= nextMidnightUtc(progress.completedAt);
    }
    if (cat === "weekly") {
      return now >= nextMondayMidnightUtc(progress.completedAt);
    }
    if (cat === "monthly") {
      return now >= nextMonthStartUtc(progress.completedAt);
    }
    return false;
  }

  function resetQuestProgress(progress: QuestProgress, now: number): void {
    progress.steps = {};
    progress.startedAt = null;
    progress.completedAt = null;
    progress.claimedAt = null;
    progress.resetCount = (progress.resetCount || 0) + 1;
    progress.lastResetAt = now;
  }

  function areAllStepsDone(config: QuestConfig, progress: QuestProgress): boolean {
    for (var i = 0; i < config.steps.length; i++) {
      var sp = progress.steps[config.steps[i].id];
      if (!sp || sp.count < config.steps[i].requiredCount) return false;
    }
    return true;
  }

  function eventMatchesStep(
    step: QuestStepConfig, eventType: string, value: number,
    metadata: { [k: string]: string }
  ): boolean {
    if (step.eventType !== eventType) return false;
    if (step.requiredValue !== undefined && step.requiredValue !== null && value < step.requiredValue) return false;
    if (step.filterField && step.filterValue) {
      if (!metadata || metadata[step.filterField] !== step.filterValue) return false;
    }
    return true;
  }

  function resolveGameId(data: any): string {
    return RpcHelpers.gameId(data) || Constants.DEFAULT_GAME_ID;
  }

  // ─── RPC: quest_engine_get ─────────────────────────────────────────────────
  // Returns all non-expired quests with per-step progress for the calling user.
  // Read-only: only writes state when a repeatable reset actually occurred.

  function rpcQuestEngineGet(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = resolveGameId(data);
    var now = Math.floor(Date.now() / 1000);

    var config = loadConfig(nk, gameId);
    var state = loadUserState(nk, userId, gameId);
    var stateModified = false;

    var result: any[] = [];
    var questIds = Object.keys(config.quests);

    for (var i = 0; i < questIds.length; i++) {
      var questId = questIds[i];
      var qConfig = config.quests[questId];

      if (isQuestExpired(qConfig, now)) continue;

      var progress = getOrCreateQuestProgress(state, questId);

      if (shouldResetQuest(qConfig, progress, now)) {
        resetQuestProgress(progress, now);
        stateModified = true;
      }

      var unlocked = isQuestUnlocked(qConfig, state);

      var stepsOut: any[] = [];
      for (var s = 0; s < qConfig.steps.length; s++) {
        var stepCfg = qConfig.steps[s];
        stepsOut.push({
          id: stepCfg.id,
          description: stepCfg.description,
          requiredCount: stepCfg.requiredCount,
          count: getStepCount(progress, stepCfg.id),
          completedAt: getStepCompletedAt(progress, stepCfg.id)
        });
      }

      result.push({
        id: qConfig.id,
        name: qConfig.name,
        description: qConfig.description || null,
        category: qConfig.category || null,
        unlocked: unlocked,
        steps: stepsOut,
        startedAt: progress.startedAt,
        completedAt: progress.completedAt,
        claimedAt: progress.claimedAt,
        expiresAt: qConfig.expiresAt || null,
        resetCount: progress.resetCount,
        additionalProperties: qConfig.additionalProperties || null
      });
    }

    // Only write to storage if a repeatable reset changed the state
    if (stateModified) {
      saveUserState(nk, userId, gameId, state);
    }

    return RpcHelpers.successResponse({ quests: result });
  }

  // ─── Core event processing (shared by RPC and EventBus bridge) ───────────
  // This is the main quest progression logic, extracted so it can be called
  // from both the RPC endpoint and the EventBus bridge.
  //
  // Two-phase design (data-integrity guarantee):
  //   Phase 1 — scan all quests, advance steps, mark completions in memory.
  //   Phase 2 — persist state FIRST (progress is safe even if reward fails).
  //   Phase 3 — grant auto-rewards; each wrapped in try/catch so a reward
  //             engine error never rolls back the player's hard-earned progress.
  //             If auto-grant fails, claimedAt stays null and the client can
  //             retry via quest_engine_claim_reward.

  interface ProcessEventResult {
    updatedCount: number;
    updatedQuests: { [questId: string]: any };
  }

  function processEventInternal(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    ctx: nkruntime.Context,
    userId: string,
    gameId: string,
    eventType: string,
    value: number,
    metadata: { [k: string]: string }
  ): ProcessEventResult {
    var now = Math.floor(Date.now() / 1000);

    var config = loadConfig(nk, gameId);
    var state = loadUserState(nk, userId, gameId);

    var updatedCount = 0;
    var updatedQuests: { [questId: string]: any } = {};
    // Track quests that completed this call and need auto-reward granting
    var rewardPending: Array<{ questId: string; reward: Hiro.Reward }> = [];

    // ── Phase 1: scan + advance ──────────────────────────────────────────────
    var questIds = Object.keys(config.quests);
    for (var i = 0; i < questIds.length; i++) {
      var questId = questIds[i];
      var qConfig = config.quests[questId];

      if (isQuestExpired(qConfig, now)) continue;
      if (!isQuestUnlocked(qConfig, state)) continue;

      var progress = getOrCreateQuestProgress(state, questId);

      // Auto-reset expired repeatable quests before processing new event
      if (shouldResetQuest(qConfig, progress, now)) {
        resetQuestProgress(progress, now);
      }

      // Skip quests that are still completed (non-repeatable, or repeatable window not expired yet)
      if (progress.completedAt) continue;

      var questUpdated = false;

      for (var s = 0; s < qConfig.steps.length; s++) {
        var stepCfg = qConfig.steps[s];

        if (progress.steps[stepCfg.id] && progress.steps[stepCfg.id].completedAt) continue;
        if (!eventMatchesStep(stepCfg, eventType, value, metadata)) continue;

        if (!progress.steps[stepCfg.id]) {
          progress.steps[stepCfg.id] = { count: 0, completedAt: null };
        }
        if (!progress.startedAt) progress.startedAt = now;

        var prevCount = progress.steps[stepCfg.id].count;
        // For count-based steps (requiredValue not set) increment by 1 each event.
        // For accumulation steps (e.g. "earn 500 XP") increment by the event value.
        // Either way, never add more than the remaining delta so the count stays
        // accurate even when the same event fires multiple times in a session.
        var increment = (stepCfg.requiredValue !== undefined && stepCfg.requiredValue !== null && value > 0) ? value : 1;
        progress.steps[stepCfg.id].count = Math.min(prevCount + increment, stepCfg.requiredCount);
        questUpdated = true;

        // Fire event only on the incomplete→complete transition
        if (prevCount < stepCfg.requiredCount &&
            progress.steps[stepCfg.id].count >= stepCfg.requiredCount) {
          progress.steps[stepCfg.id].completedAt = now;
          try {
            EventBus.emit(nk, logger, ctx, EventBus.Events.QUEST_STEP_COMPLETED, {
              userId: userId, questId: questId, stepId: stepCfg.id
            });
          } catch (busErr: any) {
            logger.warn("[QuestEngine] EventBus step emit failed: " + (busErr && busErr.message ? busErr.message : String(busErr)));
          }
          logger.info("[QuestEngine] Step completed: quest=%s step=%s user=%s", questId, stepCfg.id, userId);
        }
      }

      if (questUpdated) {
        updatedCount++;

        if (areAllStepsDone(qConfig, progress) && !progress.completedAt) {
          progress.completedAt = now;
          try {
            EventBus.emit(nk, logger, ctx, EventBus.Events.QUEST_COMPLETED, {
              userId: userId, questId: questId
            });
          } catch (busErr: any) {
            logger.warn("[QuestEngine] EventBus quest emit failed: " + (busErr && busErr.message ? busErr.message : String(busErr)));
          }
          logger.info("[QuestEngine] Quest completed: quest=%s user=%s", questId, userId);

          // Queue reward for Phase 3 — do NOT grant yet (state not saved)
          if (qConfig.reward) {
            rewardPending.push({ questId: questId, reward: qConfig.reward });
          }
        }

        updatedQuests[questId] = {
          questId: questId,
          steps: progress.steps,
          startedAt: progress.startedAt,
          completedAt: progress.completedAt,
          claimedAt: progress.claimedAt,
          resetCount: progress.resetCount
        };
      }
    }

    // ── Phase 2: persist progress (safe even if Phase 3 fails) ───────────────
    if (updatedCount > 0) {
      saveUserState(nk, userId, gameId, state);
    }

    // ── Phase 3: grant auto-rewards (isolated, non-fatal) ────────────────────
    var anyClaimedAt = false;
    for (var r = 0; r < rewardPending.length; r++) {
      var rq = rewardPending[r];
      try {
        var resolved = RewardEngine.resolveReward(nk, rq.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, gameId, resolved);
        state.quests[rq.questId].claimedAt = now;
        updatedQuests[rq.questId].claimedAt = now;
        anyClaimedAt = true;
        logger.info("[QuestEngine] Reward auto-granted: quest=%s user=%s", rq.questId, userId);
      } catch (rewardErr: any) {
        logger.error("[QuestEngine] Reward grant failed (claimedAt stays null, client can retry): quest=%s err=%s",
          rq.questId, (rewardErr && rewardErr.message ? rewardErr.message : String(rewardErr)));
      }
    }

    // Only write again if at least one claimedAt was actually set in Phase 3
    if (anyClaimedAt) {
      saveUserState(nk, userId, gameId, state);
    }

    return { updatedCount: updatedCount, updatedQuests: updatedQuests };
  }

  // ─── RPC: quest_engine_record_event ──────────────────────────────────────
  // Reports a player action via RPC. Calls the internal processor.
  
  function rpcQuestEngineRecordEvent(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = resolveGameId(data);
    var eventType = data.eventType as string;
    var value = (data.value !== undefined && data.value !== null) ? Number(data.value) : 0;
    var metadata = (data.metadata as { [k: string]: string }) || {};

    if (!eventType) return RpcHelpers.errorResponse("eventType is required");

    var result = processEventInternal(nk, logger, ctx, userId, gameId, eventType, value, metadata);
    return RpcHelpers.successResponse({ updatedQuests: result.updatedCount, quests: result.updatedQuests });
  }

  // ─── Public API: processEvent ────────────────────────────────────────────
  // Called by QuestEventBusBridge to process events from EventBus.
  // Apps don't need to call any RPC — events flow automatically.
  
  export function processEvent(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    ctx: nkruntime.Context,
    userId: string,
    gameId: string,
    eventType: string,
    value: number,
    metadata: { [k: string]: string }
  ): ProcessEventResult {
    return processEventInternal(nk, logger, ctx, userId, gameId, eventType, value, metadata);
  }

  // ─── RPC: quest_engine_claim_reward ──────────────────────────────────────
  // Manually claims reward for a completed quest (deferred-claim UI pattern).

  function rpcQuestEngineClaimReward(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = resolveGameId(data);
    var questId = data.questId as string;

    if (!questId) return RpcHelpers.errorResponse("questId is required");

    var config = loadConfig(nk, gameId);
    var qConfig = config.quests[questId];
    if (!qConfig) return RpcHelpers.errorResponse("Unknown quest: " + questId);

    var state = loadUserState(nk, userId, gameId);
    var progress = state.quests[questId];

    if (!progress || !progress.completedAt) return RpcHelpers.errorResponse("Quest not completed");
    if (progress.claimedAt) return RpcHelpers.errorResponse("Quest reward already claimed");
    if (!qConfig.reward) return RpcHelpers.successResponse({ reward: null });

    var now = Math.floor(Date.now() / 1000);
    var resolved = RewardEngine.resolveReward(nk, qConfig.reward);
    RewardEngine.grantReward(nk, logger, ctx, userId, gameId, resolved);
    progress.claimedAt = now;

    saveUserState(nk, userId, gameId, state);
    logger.info("[QuestEngine] Reward claimed manually: quest=%s user=%s", questId, userId);

    return RpcHelpers.successResponse({ reward: resolved });
  }

  // ─── RPC: quest_engine_admin_save_config ─────────────────────────────────
  // Saves quest config to storage. Server-key only — rejects authenticated users.
  //
  // Accepts two equivalent payload shapes (as documented in KT Section 11):
  //   (a) Keyed-map form:  { "gameId": "...", "config": { "quests": { "q1": {...} } } }
  //   (b) Array form:      { "gameId": "...", "quests": [ { "id": "q1", ... } ] }
  // Both are normalised to QuestsConfig internally before saving.

  function rpcQuestEngineAdminSaveConfig(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    if (!isAdminCaller(ctx)) {
      return RpcHelpers.errorResponse("Forbidden: server key required");
    }

    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = resolveGameId(data);

    var config: QuestsConfig;

    // Shape (a): { config: { quests: { ... } } }
    if (data.config && data.config.quests && !Array.isArray(data.config.quests)) {
      config = data.config as QuestsConfig;
    }
    // Shape (b): { quests: [ { id, name, ... } ] }  — KT Section 11 canonical form
    else if (Array.isArray(data.quests)) {
      var map: { [questId: string]: QuestConfig } = {};
      var arr = data.quests as QuestConfig[];
      for (var qi = 0; qi < arr.length; qi++) {
        var q = arr[qi];
        if (!q.id) return RpcHelpers.errorResponse("Each quest in quests[] must have an id field");
        map[q.id] = q;
      }
      config = { quests: map };
    }
    else {
      return RpcHelpers.errorResponse("Payload must contain config.quests (object) or quests (array)");
    }

    var questCount = Object.keys(config.quests).length;
    saveConfig(nk, gameId, config);
    logger.info("[QuestEngine] Config saved: gameId=%s quests=%d", gameId, questCount);

    return RpcHelpers.successResponse({ saved: true, questCount: questCount });
  }

  // ─── RPC: quest_engine_admin_get_config ──────────────────────────────────
  // Returns the stored quest config for a game. Server-key only.

  function rpcQuestEngineAdminGetConfig(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    if (!isAdminCaller(ctx)) {
      return RpcHelpers.errorResponse("Forbidden: server key required");
    }

    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = resolveGameId(data);

    var config = loadConfig(nk, gameId);
    var questCount = Object.keys(config.quests).length;
    logger.info("[QuestEngine] Config retrieved: gameId=%s quests=%d", gameId, questCount);

    return RpcHelpers.successResponse({ config: config, questCount: questCount });
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    // withCleanAuthError wraps a handler once at registration time.
    // When register() is auto-invoked at IIFE scope by the postbuild script,
    // RpcHelpers may not be initialised yet (it lives in a later IIFE). Use a
    // lazy wrapper so the actual wrapping is deferred to first-call time.
    type StrictRpc = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string;
    function auth(fn: nkruntime.RpcFunction): nkruntime.RpcFunction {
      var wrapped: StrictRpc | null = null;
      return function(ctx, logger, nk, payload): string {
        if (!wrapped) {
          const strictFn = fn as StrictRpc;
          wrapped = (typeof RpcHelpers !== "undefined" && RpcHelpers.withCleanAuthError)
            ? RpcHelpers.withCleanAuthError(strictFn)
            : strictFn;
        }
        return wrapped(ctx, logger, nk, payload);
      };
    }
    initializer.registerRpc("quest_engine_get",               auth(rpcQuestEngineGet));
    initializer.registerRpc("quest_engine_record_event",      auth(rpcQuestEngineRecordEvent));
    initializer.registerRpc("quest_engine_claim_reward",      auth(rpcQuestEngineClaimReward));
    initializer.registerRpc("quest_engine_admin_save_config", rpcQuestEngineAdminSaveConfig);
    initializer.registerRpc("quest_engine_admin_get_config",  rpcQuestEngineAdminGetConfig);
  }
}
