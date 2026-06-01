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

  var QUEST_ENGINE_COLLECTION = "quest_engine";
  var DEFAULT_QUESTS_CONFIG: QuestsConfig = { quests: {} };

  // Admin users allowed to save quest config (server-key or specific roles).
  // An empty userId in ctx means the call came via server key — always allowed.
  function isAdminCaller(ctx: nkruntime.Context): boolean {
    return !ctx.userId || ctx.userId === Constants.SYSTEM_USER_ID;
  }

  // ─── Storage ──────────────────────────────────────────────────────────────

  function loadConfig(nk: nkruntime.Nakama, gameId: string): QuestsConfig {
    return ConfigLoader.loadConfigForGame<QuestsConfig>(nk, "quests", gameId, DEFAULT_QUESTS_CONFIG);
  }

  function saveConfig(nk: nkruntime.Nakama, gameId: string, config: QuestsConfig): void {
    ConfigLoader.saveConfig(nk, Constants.gameKey(gameId, "quests"), config);
  }

  function loadUserState(nk: nkruntime.Nakama, userId: string, gameId: string): UserQuestState {
    var data = Storage.readJson<UserQuestState>(
      nk, QUEST_ENGINE_COLLECTION, Constants.gameKey(gameId, "state"), userId
    );
    return data || { quests: {} };
  }

  function saveUserState(nk: nkruntime.Nakama, userId: string, gameId: string, state: UserQuestState): void {
    // permissionWrite: 0 = server-only writes (prevents client-side cheating)
    Storage.writeJson(
      nk, QUEST_ENGINE_COLLECTION, Constants.gameKey(gameId, "state"), userId, state,
      1 as nkruntime.ReadPermissionValues,
      0 as nkruntime.WritePermissionValues
    );
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
    if (!config.resetIntervalSec) return false;
    return now >= (progress.completedAt + config.resetIntervalSec);
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

  // ─── RPC: quest_engine_record_event ──────────────────────────────────────
  // Reports a player action. Fans out to all matching quest steps.
  //
  // Two-phase design (data-integrity guarantee):
  //   Phase 1 — scan all quests, advance steps, mark completions in memory.
  //   Phase 2 — persist state FIRST (progress is safe even if reward fails).
  //   Phase 3 — grant auto-rewards; each wrapped in try/catch so a reward
  //             engine error never rolls back the player's hard-earned progress.
  //             If auto-grant fails, claimedAt stays null and the client can
  //             retry via quest_engine_claim_reward.

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
    var now = Math.floor(Date.now() / 1000);

    if (!eventType) return RpcHelpers.errorResponse("eventType is required");

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

      // Skip already-completed quests (non-repeatable, or repeatable not yet reset)
      if (progress.completedAt && !qConfig.repeatable) continue;
      if (progress.completedAt && qConfig.repeatable) continue;

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
        progress.steps[stepCfg.id].count = Math.min(prevCount + 1, stepCfg.requiredCount);
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
    for (var r = 0; r < rewardPending.length; r++) {
      var rq = rewardPending[r];
      try {
        var resolved = RewardEngine.resolveReward(nk, rq.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, gameId, resolved);
        state.quests[rq.questId].claimedAt = now;
        updatedQuests[rq.questId].claimedAt = now;
        logger.info("[QuestEngine] Reward auto-granted: quest=%s user=%s", rq.questId, userId);
      } catch (rewardErr: any) {
        logger.error("[QuestEngine] Reward grant failed (claimedAt stays null, client can retry): quest=%s err=%s",
          rq.questId, (rewardErr && rewardErr.message ? rewardErr.message : String(rewardErr)));
      }
    }

    // Save again only if any claimedAt was set in Phase 3
    if (rewardPending.length > 0 && updatedCount > 0) {
      saveUserState(nk, userId, gameId, state);
    }

    return RpcHelpers.successResponse({ updatedQuests: updatedCount, quests: updatedQuests });
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

  function rpcQuestEngineAdminSaveConfig(
    ctx: nkruntime.Context, logger: nkruntime.Logger,
    nk: nkruntime.Nakama, payload: string
  ): string {
    if (!isAdminCaller(ctx)) {
      return RpcHelpers.errorResponse("Forbidden: server key required");
    }

    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = resolveGameId(data);
    var config = data.config as QuestsConfig;

    if (!config || !config.quests) return RpcHelpers.errorResponse("config.quests is required");

    var questCount = Object.keys(config.quests).length;
    saveConfig(nk, gameId, config);
    logger.info("[QuestEngine] Config saved: gameId=%s quests=%d", gameId, questCount);

    return RpcHelpers.successResponse({ saved: true, questCount: questCount });
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quest_engine_get",               rpcQuestEngineGet);
    initializer.registerRpc("quest_engine_record_event",      rpcQuestEngineRecordEvent);
    initializer.registerRpc("quest_engine_claim_reward",      rpcQuestEngineClaimReward);
    initializer.registerRpc("quest_engine_admin_save_config", rpcQuestEngineAdminSaveConfig);
  }
}
