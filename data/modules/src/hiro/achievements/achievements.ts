namespace HiroAchievements {

  var DEFAULT_CONFIG: Hiro.AchievementsConfig = { achievements: {} };

  export function getConfig(nk: nkruntime.Nakama): Hiro.AchievementsConfig {
    return ConfigLoader.loadConfig<Hiro.AchievementsConfig>(nk, "achievements", DEFAULT_CONFIG);
  }

  function getUserAchievements(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserAchievements {
    var data = Storage.readJson<Hiro.UserAchievements>(nk, Constants.HIRO_ACHIEVEMENTS_COLLECTION, Constants.gameKey(gameId, "progress"), userId);
    return data || { achievements: {} };
  }

  function saveUserAchievements(nk: nkruntime.Nakama, userId: string, data: Hiro.UserAchievements, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_ACHIEVEMENTS_COLLECTION, Constants.gameKey(gameId, "progress"), userId, data);
  }

  export function addProgress(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, achievementId: string, amount: number, gameId?: string): Hiro.UserAchievementProgress | null {
    var config = getConfig(nk);
    var def = config.achievements[achievementId];
    if (!def) return null;

    if (def.preconditionIds) {
      var ua = getUserAchievements(nk, userId, gameId);
      for (var i = 0; i < def.preconditionIds.length; i++) {
        var pre = ua.achievements[def.preconditionIds[i]];
        if (!pre || !pre.completedAt) return null;
      }
    }

    var userAchievements = getUserAchievements(nk, userId, gameId);
    var progress = userAchievements.achievements[achievementId];
    var now = Math.floor(Date.now() / 1000);

    if (!progress) {
      progress = { id: achievementId, count: 0 };
    }

    if (progress.completedAt && !def.resetSchedule) {
      return progress;
    }

    if (def.resetSchedule && progress.resetAt) {
      // If reset time has passed, reset progress
      if (now >= progress.resetAt) {
        progress.count = 0;
        progress.completedAt = undefined;
        progress.claimedAt = undefined;
      }
    }

    progress.count = Math.min(progress.count + amount, def.maxCount || def.count);

    EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_PROGRESS, {
      userId: userId, achievementId: achievementId, count: progress.count, target: def.count
    });

    if (progress.count >= def.count && !progress.completedAt) {
      progress.completedAt = now;

      EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_COMPLETED, {
        userId: userId, achievementId: achievementId
      });

      if (def.autoClaimReward && def.reward) {
        var resolved = RewardEngine.resolveReward(nk, def.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", resolved);
        progress.claimedAt = now;

        EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_CLAIMED, {
          userId: userId, achievementId: achievementId, reward: resolved
        });
      }

      if (def.resetSchedule) {
        progress.resetAt = computeNextReset(now, def.resetSchedule);
      }
    }

    // Sub-achievements
    if (def.subAchievements) {
      if (!progress.subAchievements) progress.subAchievements = {};
      for (var sid in def.subAchievements) {
        var subDef = def.subAchievements[sid];
        var subProgress = progress.subAchievements[sid];
        if (!subProgress) subProgress = { count: 0 };
        if (!subProgress.completedAt) {
          subProgress.count = Math.min(subProgress.count + amount, subDef.count);
          if (subProgress.count >= subDef.count) {
            subProgress.completedAt = now;
            if (subDef.reward) {
              var subResolved = RewardEngine.resolveReward(nk, subDef.reward);
              RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", subResolved);
            }
          }
        }
        progress.subAchievements[sid] = subProgress;
      }
    }

    userAchievements.achievements[achievementId] = progress;
    saveUserAchievements(nk, userId, userAchievements, gameId);
    return progress;
  }

  function computeNextReset(now: number, schedule: string): number {
    // Simplified: "daily" = 24h, "weekly" = 7d, "monthly" = 30d
    switch (schedule) {
      case "daily": return now + 86400;
      case "weekly": return now + 604800;
      case "monthly": return now + 2592000;
      default: return now + 86400;
    }
  }

  // ---- RPCs ----

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId: string | undefined = data.gameId;
    var config = getConfig(nk);
    var userAchievements = getUserAchievements(nk, userId, gameId);

    var result: any[] = [];
    for (var id in config.achievements) {
      var def = config.achievements[id];
      var progress = userAchievements.achievements[id] || { id: id, count: 0 };
      result.push({
        id: id,
        name: def.name,
        description: def.description,
        category: def.category,
        targetCount: def.count,
        currentCount: progress.count,
        completedAt: progress.completedAt,
        claimedAt: progress.claimedAt,
        autoClaimReward: def.autoClaimReward,
        hasReward: !!def.reward,
        subAchievements: def.subAchievements ? Object.keys(def.subAchievements).map(function (sid) {
          var subDef = def.subAchievements![sid];
          var subProgress = (progress.subAchievements && progress.subAchievements[sid]) || { count: 0 };
          return { id: sid, name: subDef.name, targetCount: subDef.count, currentCount: subProgress.count, completedAt: subProgress.completedAt };
        }) : []
      });
    }

    return RpcHelpers.successResponse({ achievements: result });
  }

  function rpcProgress(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.achievementId) return RpcHelpers.errorResponse("achievementId required");

    var progress = addProgress(nk, logger, ctx, userId, data.achievementId, data.amount || 1, data.gameId);
    if (!progress) return RpcHelpers.errorResponse("Achievement not found or preconditions not met");
    return RpcHelpers.successResponse({ progress: progress });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.achievementId) return RpcHelpers.errorResponse("achievementId required");

    var config = getConfig(nk);
    var def = config.achievements[data.achievementId];
    if (!def) return RpcHelpers.errorResponse("Unknown achievement");

    var ua = getUserAchievements(nk, userId, data.gameId);
    var progress = ua.achievements[data.achievementId];
    if (!progress || !progress.completedAt) return RpcHelpers.errorResponse("Achievement not completed");
    if (progress.claimedAt) return RpcHelpers.errorResponse("Already claimed");

    progress.claimedAt = Math.floor(Date.now() / 1000);
    var resolved: Hiro.ResolvedReward | null = null;
    if (def.reward) {
      resolved = RewardEngine.resolveReward(nk, def.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
    }

    ua.achievements[data.achievementId] = progress;
    saveUserAchievements(nk, userId, ua, data.gameId);

    EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_CLAIMED, {
      userId: userId, achievementId: data.achievementId, reward: resolved
    });

    return RpcHelpers.successResponse({ progress: progress, reward: resolved });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_achievements_list", rpcList);
    initializer.registerRpc("hiro_achievements_progress", rpcProgress);
    initializer.registerRpc("hiro_achievements_claim", rpcClaim);
  }

  export function registerEventHandlers(): void {
    // Auto-track achievements from other system events
    EventBus.on(EventBus.Events.GAME_COMPLETED, function (nk, logger, ctx, data) {
      var config = getConfig(nk);
      for (var id in config.achievements) {
        var def = config.achievements[id];
        if (def.category === "games_played") {
          addProgress(nk, logger, ctx, data.userId, id, 1, data.gameId);
        }
      }
    });

    EventBus.on(EventBus.Events.SCORE_SUBMITTED, function (nk, logger, ctx, data) {
      var config = getConfig(nk);
      for (var id in config.achievements) {
        var def = config.achievements[id];
        if (def.category === "score_threshold" && data.score >= def.count) {
          addProgress(nk, logger, ctx, data.userId, id, def.count, data.gameId);
        }
      }
    });
  }
}
