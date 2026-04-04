// ============================================================================
// FANTASY CRICKET — Team Creation & Validation
// ============================================================================
// RPCs:
//   fantasy_team_create  — Create/replace a 15-player squad
//   fantasy_team_get     — Retrieve the current user's squad
//   fantasy_team_update_captain — Change captain / vice-captain
// ============================================================================

namespace FantasyTeam {

  var SQUAD_SIZE = 15;
  var CREDIT_BUDGET = 100;
  var MAX_PER_REAL_TEAM = 7;

  var MIN_BATSMEN = 3;
  var MIN_BOWLERS = 3;
  var MIN_ALL_ROUNDERS = 1;
  var MIN_WICKET_KEEPERS = 1;

  // ---- Helpers ----

  function getPlayerCatalog(nk: nkruntime.Nakama, seasonId: string): FantasyTypes.PlayerCatalog | null {
    return Storage.readJson<FantasyTypes.PlayerCatalog>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.PLAYER_CATALOG + "_" + seasonId,
      Constants.SYSTEM_USER_ID
    );
  }

  function saveTeam(nk: nkruntime.Nakama, team: FantasyTypes.FantasyTeam): void {
    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.TEAM + "_" + team.seasonId,
      team.userId,
      team,
      2, // owner-read
      1  // owner-write
    );
  }

  function getTeam(nk: nkruntime.Nakama, userId: string, seasonId: string): FantasyTypes.FantasyTeam | null {
    return Storage.readJson<FantasyTypes.FantasyTeam>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.TEAM + "_" + seasonId,
      userId
    );
  }

  function validateSquad(
    players: { playerId: string; isCaptain: boolean; isViceCaptain: boolean }[],
    catalog: FantasyTypes.PlayerCatalog
  ): { valid: boolean; errors: string[] } {
    var errors: string[] = [];

    if (players.length !== SQUAD_SIZE) {
      errors.push("Squad must contain exactly " + SQUAD_SIZE + " players, got " + players.length);
    }

    var uniqueIds: { [id: string]: boolean } = {};
    for (var i = 0; i < players.length; i++) {
      if (uniqueIds[players[i].playerId]) {
        errors.push("Duplicate player: " + players[i].playerId);
      }
      uniqueIds[players[i].playerId] = true;
    }

    var captainCount = 0;
    var vcCount = 0;
    for (var i = 0; i < players.length; i++) {
      if (players[i].isCaptain) captainCount++;
      if (players[i].isViceCaptain) vcCount++;
    }
    if (captainCount !== 1) errors.push("Exactly 1 captain required, got " + captainCount);
    if (vcCount !== 1) errors.push("Exactly 1 vice-captain required, got " + vcCount);

    for (var i = 0; i < players.length; i++) {
      if (players[i].isCaptain && players[i].isViceCaptain) {
        errors.push("Captain and vice-captain must be different players");
        break;
      }
    }

    var totalCredits = 0;
    var teamCounts: { [teamId: string]: number } = {};
    var roleCounts: { [role: string]: number } = { "batsman": 0, "bowler": 0, "all-rounder": 0, "wicket-keeper": 0 };

    for (var i = 0; i < players.length; i++) {
      var entry = catalog.players[players[i].playerId];
      if (!entry) {
        errors.push("Unknown player ID: " + players[i].playerId);
        continue;
      }

      totalCredits += entry.creditValue;

      if (!teamCounts[entry.teamId]) teamCounts[entry.teamId] = 0;
      teamCounts[entry.teamId]++;

      if (roleCounts[entry.role] !== undefined) {
        roleCounts[entry.role]++;
      }
    }

    if (totalCredits > CREDIT_BUDGET) {
      errors.push("Total credits " + totalCredits.toFixed(1) + " exceeds budget of " + CREDIT_BUDGET);
    }

    var teamIds = Object.keys(teamCounts);
    for (var i = 0; i < teamIds.length; i++) {
      if (teamCounts[teamIds[i]] > MAX_PER_REAL_TEAM) {
        errors.push("Max " + MAX_PER_REAL_TEAM + " players from one team, team " + teamIds[i] + " has " + teamCounts[teamIds[i]]);
      }
    }

    if (roleCounts["batsman"] < MIN_BATSMEN) errors.push("Need at least " + MIN_BATSMEN + " batsmen, got " + roleCounts["batsman"]);
    if (roleCounts["bowler"] < MIN_BOWLERS) errors.push("Need at least " + MIN_BOWLERS + " bowlers, got " + roleCounts["bowler"]);
    if (roleCounts["all-rounder"] < MIN_ALL_ROUNDERS) errors.push("Need at least " + MIN_ALL_ROUNDERS + " all-rounder, got " + roleCounts["all-rounder"]);
    if (roleCounts["wicket-keeper"] < MIN_WICKET_KEEPERS) errors.push("Need at least " + MIN_WICKET_KEEPERS + " wicket-keeper, got " + roleCounts["wicket-keeper"]);

    return { valid: errors.length === 0, errors: errors };
  }

  // ---- RPCs ----

  function rpcCreateTeam(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.CreateTeamPayload;

    var check = RpcHelpers.validatePayload(input, ["seasonId", "leagueId", "teamName", "players"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    if (!input.players || !input.players.length) {
      return RpcHelpers.errorResponse("Players array is required");
    }

    var catalog = getPlayerCatalog(nk, input.seasonId);
    if (!catalog) {
      return RpcHelpers.errorResponse("Player catalog not found for season " + input.seasonId);
    }

    var validation = validateSquad(input.players, catalog);
    if (!validation.valid) {
      return RpcHelpers.errorResponse("Squad validation failed: " + validation.errors.join("; "));
    }

    var squadPlayers: FantasyTypes.FantasySquadPlayer[] = [];
    var totalCredits = 0;
    var captainId = "";
    var vcId = "";

    for (var i = 0; i < input.players.length; i++) {
      var p = input.players[i];
      var catEntry = catalog.players[p.playerId];
      totalCredits += catEntry.creditValue;

      if (p.isCaptain) captainId = p.playerId;
      if (p.isViceCaptain) vcId = p.playerId;

      squadPlayers.push({
        playerId: p.playerId,
        creditValue: catEntry.creditValue,
        teamId: catEntry.teamId,
        role: catEntry.role,
        isCaptain: p.isCaptain,
        isViceCaptain: p.isViceCaptain,
      });
    }

    var now = new Date().toISOString();
    var team: FantasyTypes.FantasyTeam = {
      userId: userId,
      seasonId: input.seasonId,
      leagueId: input.leagueId,
      teamName: input.teamName,
      players: squadPlayers,
      totalCredits: totalCredits,
      captainId: captainId,
      viceCaptainId: vcId,
      createdAt: now,
      updatedAt: now,
    };

    saveTeam(nk, team);

    var existing = Storage.readJson<FantasyTypes.SeasonState>(
      nk, FantasyTypes.COLLECTION,
      FantasyTypes.Keys.SEASON_STATE + "_" + input.seasonId,
      userId
    );
    if (!existing) {
      var state: FantasyTypes.SeasonState = {
        userId: userId,
        seasonId: input.seasonId,
        freeTransfersRemaining: 1,
        maxFreeTransfers: 1,
        totalTransfersMade: 0,
        penaltyPointsAccrued: 0,
        boostersUsed: [],
        transferHistory: [],
        updatedAt: now,
      };
      Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.SEASON_STATE + "_" + input.seasonId, userId, state, 2, 1);
    }

    logger.info("[FantasyTeam] User %s created squad '%s' (credits: %s)", userId, input.teamName, totalCredits.toFixed(1));

    EventBus.emit(nk, logger, ctx, "fantasy_team_created", {
      userId: userId, seasonId: input.seasonId, teamName: input.teamName, totalCredits: totalCredits,
    });

    return RpcHelpers.successResponse(team);
  }

  function rpcGetTeam(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as { seasonId: string };

    if (!input.seasonId) {
      return RpcHelpers.errorResponse("seasonId is required");
    }

    var team = getTeam(nk, userId, input.seasonId);
    if (!team) {
      return RpcHelpers.errorResponse("No team found for this season");
    }

    return RpcHelpers.successResponse(team);
  }

  function rpcUpdateCaptain(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as { seasonId: string; captainId: string; viceCaptainId: string };

    var check = RpcHelpers.validatePayload(input, ["seasonId", "captainId", "viceCaptainId"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    if (input.captainId === input.viceCaptainId) {
      return RpcHelpers.errorResponse("Captain and vice-captain must be different");
    }

    var team = getTeam(nk, userId, input.seasonId);
    if (!team) {
      return RpcHelpers.errorResponse("No team found");
    }

    var captainFound = false;
    var vcFound = false;
    for (var i = 0; i < team.players.length; i++) {
      if (team.players[i].playerId === input.captainId) captainFound = true;
      if (team.players[i].playerId === input.viceCaptainId) vcFound = true;
    }

    if (!captainFound) return RpcHelpers.errorResponse("Captain not in squad: " + input.captainId);
    if (!vcFound) return RpcHelpers.errorResponse("Vice-captain not in squad: " + input.viceCaptainId);

    for (var i = 0; i < team.players.length; i++) {
      team.players[i].isCaptain = team.players[i].playerId === input.captainId;
      team.players[i].isViceCaptain = team.players[i].playerId === input.viceCaptainId;
    }
    team.captainId = input.captainId;
    team.viceCaptainId = input.viceCaptainId;
    team.updatedAt = new Date().toISOString();

    saveTeam(nk, team);

    return RpcHelpers.successResponse(team);
  }

  // ---- Registration ----

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("fantasy_team_create", rpcCreateTeam);
    initializer.registerRpc("fantasy_team_get", rpcGetTeam);
    initializer.registerRpc("fantasy_team_update_captain", rpcUpdateCaptain);
  }
}
