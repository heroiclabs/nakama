// ============================================================================
// FANTASY CRICKET — Scoring Engine
// ============================================================================
// RPCs:
//   fantasy_scoring_process    — Process BallEvent[] batch → update player stats
//   fantasy_scoring_finalize   — End-of-innings/match: apply SR/ER bonuses,
//                                 compute per-user totals, write leaderboards
//   fantasy_scoring_get_points — Get a user's points for a specific match
//   fantasy_scoring_live       — Get live (partial) player stats for a fixture
// ============================================================================

namespace FantasyScoring {

  // ---- Helpers ----

  function getScoringConfig(nk: nkruntime.Nakama, seasonId: string): FantasyTypes.ScoringConfig {
    var cfg = Storage.readJson<FantasyTypes.ScoringConfig>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.SCORING_CONFIG + "_" + seasonId,
      Constants.SYSTEM_USER_ID
    );
    return cfg || FantasyTypes.defaultScoringConfig(seasonId);
  }

  function getPlayerStats(nk: nkruntime.Nakama, fixtureId: string): { [playerId: string]: FantasyTypes.PlayerMatchStats } {
    var data = Storage.readJson<{ stats: { [playerId: string]: FantasyTypes.PlayerMatchStats } }>(
      nk,
      FantasyTypes.COLLECTION,
      "live_stats_" + fixtureId,
      Constants.SYSTEM_USER_ID
    );
    return data ? data.stats : {};
  }

  function savePlayerStats(nk: nkruntime.Nakama, fixtureId: string, stats: { [playerId: string]: FantasyTypes.PlayerMatchStats }): void {
    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      "live_stats_" + fixtureId,
      Constants.SYSTEM_USER_ID,
      { fixtureId: fixtureId, stats: stats, updatedAt: new Date().toISOString() },
      2, 0
    );
  }

  function initPlayerStats(playerId: string): FantasyTypes.PlayerMatchStats {
    return {
      playerId: playerId,
      runsScored: 0,
      ballsFaced: 0,
      fours: 0,
      sixes: 0,
      wicketsTaken: 0,
      oversBowled: 0,
      ballsBowled: 0,
      runsConceded: 0,
      maidens: 0,
      catches: 0,
      stumpings: 0,
      runOuts: 0,
      runOutAssists: 0,
      isDismissed: false,
      dismissalType: null,
      isDuck: false,
      fantasyPoints: 0,
    };
  }

  function ensurePlayer(stats: { [id: string]: FantasyTypes.PlayerMatchStats }, playerId: string): FantasyTypes.PlayerMatchStats {
    if (!stats[playerId]) {
      stats[playerId] = initPlayerStats(playerId);
    }
    return stats[playerId];
  }

  function processSingleBall(
    event: FantasyTypes.BallEvent,
    stats: { [id: string]: FantasyTypes.PlayerMatchStats },
    cfg: FantasyTypes.ScoringConfig
  ): void {
    var batsman = ensurePlayer(stats, event.batsmanId);
    var bowler = ensurePlayer(stats, event.bowlerId);

    var batsmanRuns = event.batsmanRuns !== undefined ? event.batsmanRuns : event.runs;

    // Batting
    batsman.ballsFaced++;
    batsman.runsScored += batsmanRuns;
    batsman.fantasyPoints += batsmanRuns * cfg.batting.perRun;

    if (event.isBoundary) {
      batsman.fours++;
      batsman.fantasyPoints += cfg.batting.boundaryBonus;
    }
    if (event.isSix) {
      batsman.sixes++;
      batsman.fantasyPoints += cfg.batting.sixBonus;
    }

    // Milestone bonuses (incremental — only award when crossing the threshold)
    if (batsman.runsScored >= 100 && (batsman.runsScored - batsmanRuns) < 100) {
      batsman.fantasyPoints += cfg.batting.centuryBonus;
    } else if (batsman.runsScored >= 50 && (batsman.runsScored - batsmanRuns) < 50) {
      batsman.fantasyPoints += cfg.batting.halfCenturyBonus;
    }

    // Bowling — count legal deliveries
    if (!event.extras || event.extras.type !== "wide") {
      bowler.ballsBowled++;
      bowler.runsConceded += event.runs;

      if (bowler.ballsBowled > 0 && bowler.ballsBowled % 6 === 0) {
        bowler.oversBowled++;
      }
    }

    // Wicket
    if (event.isWicket && event.wicket) {
      var dismissal = event.wicket;

      if (dismissal.dismissalType !== "run out" && dismissal.dismissalType !== "retired hurt" && dismissal.dismissalType !== "retired") {
        bowler.wicketsTaken++;
        bowler.fantasyPoints += cfg.bowling.perWicket;

        if (dismissal.dismissalType === "bowled") {
          bowler.fantasyPoints += cfg.bowling.bonusBowled;
        }
        if (dismissal.dismissalType === "lbw") {
          bowler.fantasyPoints += cfg.bowling.bonusLbw;
        }

        if (bowler.wicketsTaken === 3) bowler.fantasyPoints += cfg.bowling.threeWicketBonus;
        if (bowler.wicketsTaken === 4) bowler.fantasyPoints += cfg.bowling.fourWicketBonus;
        if (bowler.wicketsTaken === 5) bowler.fantasyPoints += cfg.bowling.fiveWicketBonus;
      }

      // Fielding
      if (dismissal.dismissalType === "caught" && dismissal.fielderId) {
        var fielder = ensurePlayer(stats, dismissal.fielderId);
        fielder.catches++;
        fielder.fantasyPoints += cfg.fielding.perCatch;
      }
      if (dismissal.dismissalType === "stumped" && dismissal.fielderId) {
        var stumper = ensurePlayer(stats, dismissal.fielderId);
        stumper.stumpings++;
        stumper.fantasyPoints += cfg.fielding.perStumping;
      }
      if (dismissal.dismissalType === "run out") {
        if (dismissal.fielderId) {
          var runOutFielder = ensurePlayer(stats, dismissal.fielderId);
          runOutFielder.runOuts++;
          runOutFielder.fantasyPoints += cfg.fielding.perRunOut;
        }
        if (dismissal.assistFielderId) {
          var assister = ensurePlayer(stats, dismissal.assistFielderId);
          assister.runOutAssists++;
          assister.fantasyPoints += cfg.fielding.perRunOutAssist;
        }
      }

      // Mark batsman as dismissed
      var dismissed = ensurePlayer(stats, dismissal.dismissedPlayerId);
      dismissed.isDismissed = true;
      dismissed.dismissalType = dismissal.dismissalType;
    }
  }

  function applyEndOfMatchBonuses(
    stats: { [id: string]: FantasyTypes.PlayerMatchStats },
    cfg: FantasyTypes.ScoringConfig
  ): void {
    var playerIds = Object.keys(stats);
    for (var i = 0; i < playerIds.length; i++) {
      var p = stats[playerIds[i]];

      // Duck penalty (dismissed for 0 runs having faced at least 1 ball)
      if (p.isDismissed && p.runsScored === 0 && p.ballsFaced > 0) {
        p.isDuck = true;
        p.fantasyPoints += cfg.batting.duckPenalty;
      }

      // Strike-rate bonuses (only if faced enough balls)
      if (p.ballsFaced >= cfg.bonuses.minimumBallsForSR) {
        var sr = (p.runsScored / p.ballsFaced) * 100;
        if (sr > 170) p.fantasyPoints += cfg.bonuses.strikeRateAbove170;
        else if (sr > 150) p.fantasyPoints += cfg.bonuses.strikeRateAbove150;
        else if (sr > 130) p.fantasyPoints += cfg.bonuses.strikeRateAbove130;
        else if (sr < 50) p.fantasyPoints += cfg.bonuses.strikeRateBelow50;
        else if (sr < 60) p.fantasyPoints += cfg.bonuses.strikeRateBelow60;
      }

      // Economy-rate bonuses (only if bowled enough overs)
      if (p.oversBowled >= cfg.bonuses.minimumOversForER) {
        var er = p.runsConceded / p.oversBowled;
        if (er < 5) p.fantasyPoints += cfg.bonuses.economyBelow5;
        else if (er < 6) p.fantasyPoints += cfg.bonuses.economyBelow6;
        else if (er < 7) p.fantasyPoints += cfg.bonuses.economyBelow7;
        else if (er > 12) p.fantasyPoints += cfg.bonuses.economyAbove12;
        else if (er > 11) p.fantasyPoints += cfg.bonuses.economyAbove11;
        else if (er > 10) p.fantasyPoints += cfg.bonuses.economyAbove10;
      }

      // Maiden tracking: check if any completed over had 0 runs
      // (Maidens are detected during ball processing; if bowled a full over with 0 runs)
      if (p.maidens > 0) {
        p.fantasyPoints += p.maidens * cfg.bowling.maidenOverBonus;
      }
    }
  }

  function computeUserMatchPoints(
    nk: nkruntime.Nakama,
    userId: string,
    seasonId: string,
    fixtureId: string,
    matchday: number,
    stats: { [id: string]: FantasyTypes.PlayerMatchStats },
    cfg: FantasyTypes.ScoringConfig
  ): FantasyTypes.MatchPoints | null {
    var team = Storage.readJson<FantasyTypes.FantasyTeam>(
      nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.TEAM + "_" + seasonId, userId
    );
    if (!team) return null;

    var playerPoints: { [playerId: string]: number } = {};
    var totalPoints = 0;
    var captainPts = 0;
    var vcPts = 0;

    for (var i = 0; i < team.players.length; i++) {
      var sp = team.players[i];
      var rawPts = 0;
      if (stats[sp.playerId]) {
        rawPts = stats[sp.playerId].fantasyPoints;
      }

      var multiplier = 1;
      if (sp.isCaptain) multiplier = cfg.captainMultiplier;
      else if (sp.isViceCaptain) multiplier = cfg.viceCaptainMultiplier;

      var finalPts = Math.round(rawPts * multiplier * 10) / 10;
      playerPoints[sp.playerId] = finalPts;
      totalPoints += finalPts;

      if (sp.isCaptain) captainPts = finalPts;
      if (sp.isViceCaptain) vcPts = finalPts;
    }

    // Subtract any penalty points from extra transfers
    var seasonState = Storage.readJson<FantasyTypes.SeasonState>(
      nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.SEASON_STATE + "_" + seasonId, userId
    );
    if (seasonState && seasonState.penaltyPointsAccrued > 0) {
      totalPoints -= seasonState.penaltyPointsAccrued;
    }

    var result: FantasyTypes.MatchPoints = {
      userId: userId,
      fixtureId: fixtureId,
      matchday: matchday,
      playerPoints: playerPoints,
      captainPoints: captainPts,
      viceCaptainPoints: vcPts,
      totalPoints: Math.round(totalPoints * 10) / 10,
      calculatedAt: new Date().toISOString(),
    };

    Storage.writeJson(
      nk, FantasyTypes.COLLECTION,
      FantasyTypes.Keys.MATCH_POINTS + "_" + fixtureId,
      userId, result, 2, 0
    );

    return result;
  }

  // ---- Maiden Detection Helper ----
  // Tracks per-over runs to detect maiden overs during ball processing.
  // We store this in a transient storage key that gets cleaned up at finalization.

  interface OverTracker {
    [bowlerId: string]: {
      currentOverBalls: number;
      currentOverRuns: number;
    };
  }

  function getOverTracker(nk: nkruntime.Nakama, fixtureId: string): OverTracker {
    var data = Storage.readJson<{ tracker: OverTracker }>(
      nk, FantasyTypes.COLLECTION, "over_tracker_" + fixtureId, Constants.SYSTEM_USER_ID
    );
    return data ? data.tracker : {};
  }

  function saveOverTracker(nk: nkruntime.Nakama, fixtureId: string, tracker: OverTracker): void {
    Storage.writeJson(
      nk, FantasyTypes.COLLECTION, "over_tracker_" + fixtureId, Constants.SYSTEM_USER_ID,
      { tracker: tracker }, 2, 0
    );
  }

  function trackMaidenProgress(
    event: FantasyTypes.BallEvent,
    stats: { [id: string]: FantasyTypes.PlayerMatchStats },
    tracker: OverTracker
  ): void {
    if (event.extras && event.extras.type === "wide") return;

    if (!tracker[event.bowlerId]) {
      tracker[event.bowlerId] = { currentOverBalls: 0, currentOverRuns: 0 };
    }
    var t = tracker[event.bowlerId];
    t.currentOverBalls++;
    t.currentOverRuns += event.runs;

    if (t.currentOverBalls >= 6) {
      if (t.currentOverRuns === 0) {
        var bowler = ensurePlayer(stats, event.bowlerId);
        bowler.maidens++;
      }
      t.currentOverBalls = 0;
      t.currentOverRuns = 0;
    }
  }

  // ---- RPCs ----

  function rpcProcessBallEvents(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.ProcessBallEventsPayload;

    var check = RpcHelpers.validatePayload(input, ["fixtureId", "matchday", "events"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    if (!input.events || input.events.length === 0) {
      return RpcHelpers.errorResponse("No events to process");
    }

    var seasonId = input.fixtureId.split("_")[0] || "ipl2026";
    var cfg = getScoringConfig(nk, seasonId);
    var stats = getPlayerStats(nk, input.fixtureId);
    var tracker = getOverTracker(nk, input.fixtureId);

    for (var i = 0; i < input.events.length; i++) {
      processSingleBall(input.events[i], stats, cfg);
      trackMaidenProgress(input.events[i], stats, tracker);
    }

    savePlayerStats(nk, input.fixtureId, stats);
    saveOverTracker(nk, input.fixtureId, tracker);

    logger.info("[FantasyScoring] Processed %d ball events for fixture %s", input.events.length, input.fixtureId);

    return RpcHelpers.successResponse({
      fixtureId: input.fixtureId,
      eventsProcessed: input.events.length,
      playersTracked: Object.keys(stats).length,
    });
  }

  function rpcFinalize(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as {
      fixtureId: string;
      matchday: number;
      seasonId: string;
    };

    var check = RpcHelpers.validatePayload(input, ["fixtureId", "matchday", "seasonId"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    var cfg = getScoringConfig(nk, input.seasonId);
    var stats = getPlayerStats(nk, input.fixtureId);

    if (Object.keys(stats).length === 0) {
      return RpcHelpers.errorResponse("No player stats found for fixture " + input.fixtureId);
    }

    applyEndOfMatchBonuses(stats, cfg);
    savePlayerStats(nk, input.fixtureId, stats);

    // Enumerate users with fantasy teams for this season
    var cursor: string | undefined = undefined;
    var usersProcessed = 0;
    var allMatchPoints: FantasyTypes.MatchPoints[] = [];

    do {
      var list = nk.storageList(
        Constants.SYSTEM_USER_ID,
        FantasyTypes.COLLECTION,
        100,
        cursor
      );

      if (list && list.objects) {
        for (var i = 0; i < list.objects.length; i++) {
          var obj = list.objects[i];
          if (obj.key.indexOf(FantasyTypes.Keys.TEAM + "_" + input.seasonId) === 0 && obj.userId) {
            var mp = computeUserMatchPoints(
              nk, obj.userId, input.seasonId, input.fixtureId, input.matchday, stats, cfg
            );
            if (mp) {
              allMatchPoints.push(mp);
              usersProcessed++;

              // Write to season leaderboard
              try {
                nk.leaderboardRecordWrite(
                  FantasyTypes.LEADERBOARD_SEASON + "_" + input.seasonId,
                  obj.userId,
                  "", // username filled by Nakama
                  Math.round(mp.totalPoints),
                  0, // subscore
                  { matchday: input.matchday, fixtureId: input.fixtureId }
                );
              } catch (e: any) {
                logger.warn("[FantasyScoring] Leaderboard write failed for user %s: %s", obj.userId, e.message || String(e));
              }

              // Write to per-match leaderboard
              try {
                nk.leaderboardRecordWrite(
                  FantasyTypes.LEADERBOARD_MATCH_PREFIX + input.fixtureId,
                  obj.userId,
                  "",
                  Math.round(mp.totalPoints),
                  0,
                  {}
                );
              } catch (e: any) {
                logger.warn("[FantasyScoring] Match LB write failed for user %s: %s", obj.userId, e.message || String(e));
              }
            }
          }
        }
        cursor = list.cursor;
      } else {
        break;
      }
    } while (cursor);

    logger.info("[FantasyScoring] Finalized fixture %s — %d users scored", input.fixtureId, usersProcessed);

    EventBus.emit(nk, logger, ctx, "fantasy_match_finalized", {
      fixtureId: input.fixtureId,
      seasonId: input.seasonId,
      matchday: input.matchday,
      usersProcessed: usersProcessed,
    });

    return RpcHelpers.successResponse({
      fixtureId: input.fixtureId,
      usersProcessed: usersProcessed,
      playerStatsCount: Object.keys(stats).length,
    });
  }

  function rpcGetPoints(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as { fixtureId: string };

    if (!input.fixtureId) {
      return RpcHelpers.errorResponse("fixtureId is required");
    }

    var mp = Storage.readJson<FantasyTypes.MatchPoints>(
      nk, FantasyTypes.COLLECTION,
      FantasyTypes.Keys.MATCH_POINTS + "_" + input.fixtureId,
      userId
    );

    if (!mp) {
      return RpcHelpers.errorResponse("No points found for fixture " + input.fixtureId);
    }

    return RpcHelpers.successResponse(mp);
  }

  function rpcLiveStats(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as { fixtureId: string };

    if (!input.fixtureId) {
      return RpcHelpers.errorResponse("fixtureId is required");
    }

    var stats = getPlayerStats(nk, input.fixtureId);
    if (Object.keys(stats).length === 0) {
      return RpcHelpers.successResponse({ fixtureId: input.fixtureId, players: {}, message: "No stats yet" });
    }

    return RpcHelpers.successResponse({
      fixtureId: input.fixtureId,
      players: stats,
    });
  }

  // ---- Registration ----

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("fantasy_scoring_process", rpcProcessBallEvents);
    initializer.registerRpc("fantasy_scoring_finalize", rpcFinalize);
    initializer.registerRpc("fantasy_scoring_get_points", rpcGetPoints);
    initializer.registerRpc("fantasy_scoring_live", rpcLiveStats);
  }
}
