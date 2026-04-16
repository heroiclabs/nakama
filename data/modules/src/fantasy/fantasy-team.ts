// ============================================================================
// FANTASY CRICKET — Team Creation & Validation
// ============================================================================
// RPCs:
//   fantasy_team_create  — Create/replace a 15-player squad
//   fantasy_team_get     — Retrieve the current user's squad
//   fantasy_team_update_captain — Change captain / vice-captain
// ============================================================================

namespace FantasyTeam {

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

  function getMatchDeadline(nk: nkruntime.Nakama, fixtureId: string): FantasyTypes.MatchDeadline | null {
    return Storage.readJson<FantasyTypes.MatchDeadline>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.MATCH_DEADLINE + "_" + fixtureId,
      Constants.SYSTEM_USER_ID
    );
  }

  /**
   * After a squad update, remove any un-locked Playing XI records that contain
   * players no longer in the new squad.
   */
  function invalidateStaleXIs(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    newSquadPlayerIds: string[]
  ): string[] {
    var squadSet: { [id: string]: boolean } = {};
    for (var i = 0; i < newSquadPlayerIds.length; i++) {
      squadSet[newSquadPlayerIds[i]] = true;
    }

    var invalidated: string[] = [];
    var cursor = "";
    var keepGoing = true;

    while (keepGoing) {
      var result = Storage.listUserRecords(nk, FantasyTypes.COLLECTION, userId, 100, cursor);

      for (var j = 0; j < result.records.length; j++) {
        var obj = result.records[j];
        if (!obj.key || obj.key.indexOf(FantasyTypes.Keys.MATCH_XI + "_") !== 0) continue;

        var xi = obj.value as unknown as FantasyTypes.MatchXI;
        if (!xi || !xi.selectedPlayerIds || !xi.fixtureId) continue;

        var fixtureId = xi.fixtureId;

        // Skip locked XIs (deadline has passed)
        var deadline = getMatchDeadline(nk, fixtureId);
        if (deadline) {
          var nowSec = Math.floor(Date.now() / 1000);
          if (nowSec >= deadline.deadlineAt) continue;
        }

        // Check if any XI player is no longer in the squad
        var hasStale = false;
        for (var k = 0; k < xi.selectedPlayerIds.length; k++) {
          if (!squadSet[xi.selectedPlayerIds[k]]) {
            hasStale = true;
            break;
          }
        }

        if (hasStale) {
          Storage.deleteRecord(nk, FantasyTypes.COLLECTION, obj.key, userId);
          invalidated.push(fixtureId);
          logger.info(
            "[FantasyTeam] Invalidated stale XI for fixture %s (user %s) — squad was updated",
            fixtureId, userId
          );
        }
      }

      cursor = result.cursor;
      keepGoing = cursor.length > 0;
    }

    return invalidated;
  }

  function validateSquad(
    players: { playerId: string; isCaptain: boolean; isViceCaptain: boolean }[],
    catalog: FantasyTypes.PlayerCatalog
  ): { valid: boolean; errors: string[] } {
    var errors: string[] = [];

    if (players.length !== FantasyTypes.SQUAD_SIZE) {
      errors.push("Squad must contain exactly " + FantasyTypes.SQUAD_SIZE + " players, got " + players.length);
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
    var overseasCount = 0;
    var teamCounts: { [teamId: string]: number } = {};
    var roleCounts: { [role: string]: number } = { "batsman": 0, "bowler": 0, "all-rounder": 0, "wicket-keeper": 0 };

    for (var i = 0; i < players.length; i++) {
      var entry = catalog.players[players[i].playerId];
      if (!entry) {
        errors.push("Unknown player ID: " + players[i].playerId);
        continue;
      }

      totalCredits += entry.creditValue;

      if (entry.isOverseas) overseasCount++;

      if (!teamCounts[entry.teamId]) teamCounts[entry.teamId] = 0;
      teamCounts[entry.teamId]++;

      if (roleCounts[entry.role] !== undefined) {
        roleCounts[entry.role]++;
      }
    }

    if (totalCredits > FantasyTypes.CREDIT_BUDGET) {
      errors.push("Total credits " + totalCredits.toFixed(1) + " exceeds budget of " + FantasyTypes.CREDIT_BUDGET);
    }

    if (overseasCount > FantasyTypes.MAX_OVERSEAS_IN_SQUAD) {
      errors.push("Max " + FantasyTypes.MAX_OVERSEAS_IN_SQUAD + " overseas players in squad, got " + overseasCount);
    }

    var teamIds = Object.keys(teamCounts);
    for (var i = 0; i < teamIds.length; i++) {
      if (teamCounts[teamIds[i]] > FantasyTypes.MAX_PER_REAL_TEAM) {
        errors.push("Max " + FantasyTypes.MAX_PER_REAL_TEAM + " players from one team, team " + teamIds[i] + " has " + teamCounts[teamIds[i]]);
      }
    }

    var roles = Object.keys(FantasyTypes.SQUAD_MIN_ROLES);
    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      if ((roleCounts[r] || 0) < FantasyTypes.SQUAD_MIN_ROLES[r]) {
        errors.push("Need at least " + FantasyTypes.SQUAD_MIN_ROLES[r] + " " + r + "(s), got " + (roleCounts[r] || 0));
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ---- Match XI Validation ----

  function validateMatchXI(
    playerIds: string[],
    captainId: string,
    viceCaptainId: string,
    squad: FantasyTypes.FantasyTeam,
    catalog: FantasyTypes.PlayerCatalog
  ): { valid: boolean; errors: string[] } {
    var errors: string[] = [];

    if (playerIds.length !== FantasyTypes.XI_SIZE) {
      errors.push("Playing XI must contain exactly " + FantasyTypes.XI_SIZE + " players, got " + playerIds.length);
    }

    // Check for duplicates
    var uniqueIds: { [id: string]: boolean } = {};
    for (var i = 0; i < playerIds.length; i++) {
      if (uniqueIds[playerIds[i]]) {
        errors.push("Duplicate player in XI: " + playerIds[i]);
      }
      uniqueIds[playerIds[i]] = true;
    }

    // All XI players must be in the 15-player squad
    var squadLookup: { [id: string]: FantasyTypes.FantasySquadPlayer } = {};
    for (var i = 0; i < squad.players.length; i++) {
      squadLookup[squad.players[i].playerId] = squad.players[i];
    }

    for (var i = 0; i < playerIds.length; i++) {
      if (!squadLookup[playerIds[i]]) {
        errors.push("Player " + playerIds[i] + " is not in your squad");
      }
    }

    // Captain and vice-captain must be in XI
    if (!uniqueIds[captainId]) {
      errors.push("Captain " + captainId + " must be in the playing XI");
    }
    if (!uniqueIds[viceCaptainId]) {
      errors.push("Vice-captain " + viceCaptainId + " must be in the playing XI");
    }
    if (captainId === viceCaptainId) {
      errors.push("Captain and vice-captain must be different players");
    }

    // Role composition and overseas limit for the XI
    var overseasCount = 0;
    var teamCounts: { [teamId: string]: number } = {};
    var roleCounts: { [role: string]: number } = { "batsman": 0, "bowler": 0, "all-rounder": 0, "wicket-keeper": 0 };

    for (var i = 0; i < playerIds.length; i++) {
      var entry = catalog.players[playerIds[i]];
      if (!entry) continue;

      if (entry.isOverseas) overseasCount++;

      if (!teamCounts[entry.teamId]) teamCounts[entry.teamId] = 0;
      teamCounts[entry.teamId]++;

      if (roleCounts[entry.role] !== undefined) {
        roleCounts[entry.role]++;
      }
    }

    if (overseasCount > FantasyTypes.MAX_OVERSEAS_IN_XI) {
      errors.push("Max " + FantasyTypes.MAX_OVERSEAS_IN_XI + " overseas players in XI, got " + overseasCount);
    }

    var teamIds = Object.keys(teamCounts);
    for (var i = 0; i < teamIds.length; i++) {
      if (teamCounts[teamIds[i]] > FantasyTypes.MAX_PER_REAL_TEAM) {
        errors.push("Max " + FantasyTypes.MAX_PER_REAL_TEAM + " players from one team in XI, team " + teamIds[i] + " has " + teamCounts[teamIds[i]]);
      }
    }

    var roles = Object.keys(FantasyTypes.XI_MIN_ROLES);
    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      if ((roleCounts[r] || 0) < FantasyTypes.XI_MIN_ROLES[r]) {
        errors.push("XI needs at least " + FantasyTypes.XI_MIN_ROLES[r] + " " + r + "(s), got " + (roleCounts[r] || 0));
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ---- RPCs ----

  function rpcCreateTeam(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.CreateTeamPayload;
    var userId = RpcHelpers.resolveUserId(ctx, input);

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

    // Invalidate any un-locked Playing XI selections that contain removed players
    var newSquadIds = squadPlayers.map(function (p) { return p.playerId; });
    var invalidatedFixtures = invalidateStaleXIs(nk, logger, userId, newSquadIds);

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

    // Write to team index so auto-join can discover all users with teams
    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      "team_idx_" + input.seasonId + "_" + userId,
      Constants.SYSTEM_USER_ID,
      { userId: userId, seasonId: input.seasonId, teamName: input.teamName, lockedAt: now },
      2, 0
    );

    logger.info("[FantasyTeam] User %s created squad '%s' (credits: %s)", userId, input.teamName, totalCredits.toFixed(1));

    EventBus.emit(nk, logger, ctx, "fantasy_team_created", {
      userId: userId, seasonId: input.seasonId, teamName: input.teamName, totalCredits: totalCredits,
    });

    var response: any = team;
    if (invalidatedFixtures.length > 0) {
      response = {
        team: team,
        invalidatedXIs: invalidatedFixtures,
        warning: "Playing XI cleared for " + invalidatedFixtures.length +
          " fixture(s) due to squad changes. Please re-select your XI.",
      };
    }

    return RpcHelpers.successResponse(response);
  }

  function rpcGetTeam(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as { seasonId: string; userId?: string };
    var userId = RpcHelpers.resolveUserId(ctx, input);

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
    var input = RpcHelpers.parseRpcPayload(payload) as { seasonId: string; captainId: string; viceCaptainId: string; userId?: string };
    var userId = RpcHelpers.resolveUserId(ctx, input);

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

  // ---- Match XI RPCs ----

  function rpcSelectMatchXI(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.SelectMatchXIPayload;
    var userId = RpcHelpers.resolveUserId(ctx, input);

    var check = RpcHelpers.validatePayload(input, ["fixtureId", "seasonId", "playerIds", "captainId", "viceCaptainId"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    if (!input.playerIds || !input.playerIds.length) {
      return RpcHelpers.errorResponse("playerIds array is required");
    }

    // Deadline enforcement
    var deadline = getMatchDeadline(nk, input.fixtureId);
    if (deadline) {
      var nowSec = Math.floor(Date.now() / 1000);
      if (nowSec >= deadline.deadlineAt) {
        return RpcHelpers.errorResponse(
          "Selection deadline has passed for this match. " +
          "Deadline was " + new Date(deadline.deadlineAt * 1000).toISOString()
        );
      }
    }

    // Get squad
    var squad = getTeam(nk, userId, input.seasonId);
    if (!squad) {
      return RpcHelpers.errorResponse("No squad found for season " + input.seasonId + ". Create a team first.");
    }

    // Get catalog for role/overseas validation
    var catalog = getPlayerCatalog(nk, input.seasonId);
    if (!catalog) {
      return RpcHelpers.errorResponse("Player catalog not found for season " + input.seasonId);
    }

    // Validate the XI
    var validation = validateMatchXI(input.playerIds, input.captainId, input.viceCaptainId, squad, catalog);
    if (!validation.valid) {
      return RpcHelpers.errorResponse("XI validation failed: " + validation.errors.join("; "));
    }

    var now = new Date().toISOString();
    var matchXI: FantasyTypes.MatchXI = {
      userId: userId,
      fixtureId: input.fixtureId,
      seasonId: input.seasonId,
      selectedPlayerIds: input.playerIds,
      captainId: input.captainId,
      viceCaptainId: input.viceCaptainId,
      lockedAt: now,
    };

    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.MATCH_XI + "_" + input.fixtureId,
      userId,
      matchXI,
      2, 1
    );

    logger.info(
      "[FantasyTeam] User %s selected XI for fixture %s (captain=%s, vc=%s)",
      userId, input.fixtureId, input.captainId, input.viceCaptainId
    );

    return RpcHelpers.successResponse(matchXI);
  }

  function rpcGetMatchXI(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as { fixtureId: string; userId?: string };
    var userId = RpcHelpers.resolveUserId(ctx, input);

    if (!input.fixtureId) {
      return RpcHelpers.errorResponse("fixtureId is required");
    }

    var xi = Storage.readJson<FantasyTypes.MatchXI>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.MATCH_XI + "_" + input.fixtureId,
      userId
    );

    if (!xi) {
      return RpcHelpers.errorResponse("No playing XI selected for fixture " + input.fixtureId);
    }

    return RpcHelpers.successResponse(xi);
  }

  /**
   * Admin RPC to set the selection deadline for a fixture.
   * Called by Intelliverse-X-AI when a match is scheduled.
   */
  function rpcSetMatchDeadline(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var input = RpcHelpers.parseRpcPayload(payload) as {
      fixtureId: string;
      seasonId: string;
      deadlineAt: number;
      matchStartAt: number;
    };

    var check = RpcHelpers.validatePayload(input, ["fixtureId", "seasonId", "deadlineAt", "matchStartAt"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    var dl: FantasyTypes.MatchDeadline = {
      fixtureId: input.fixtureId,
      seasonId: input.seasonId,
      deadlineAt: input.deadlineAt,
      matchStartAt: input.matchStartAt,
    };

    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.MATCH_DEADLINE + "_" + input.fixtureId,
      Constants.SYSTEM_USER_ID,
      dl,
      2, 0
    );

    logger.info(
      "[FantasyTeam] Deadline set for fixture %s: %s",
      input.fixtureId, new Date(input.deadlineAt * 1000).toISOString()
    );

    return RpcHelpers.successResponse(dl);
  }

  /**
   * Admin RPC to sync the player catalog from the AI microservice.
   * Called by Intelliverse-X-AI after publishing player data to S3.
   * This bridges the S3 → Nakama storage gap so validateSquad() can
   * look up player IDs, credit values, roles, and team membership.
   */
  function rpcCatalogSync(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.PlayerCatalog;

    var check = RpcHelpers.validatePayload(input, ["seasonId", "players"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    if (!input.players || typeof input.players !== "object") {
      return RpcHelpers.errorResponse("players must be a non-empty object keyed by playerId");
    }

    var playerIds = Object.keys(input.players);
    if (playerIds.length < 50) {
      return RpcHelpers.errorResponse(
        "Catalog rejected: only " + playerIds.length + " players (minimum 50 required). " +
        "This prevents accidental overwrites from partial/test data."
      );
    }

    var catalog: FantasyTypes.PlayerCatalog = {
      seasonId: input.seasonId,
      leagueId: input.leagueId || "",
      updatedAt: input.updatedAt || new Date().toISOString(),
      players: input.players,
    };

    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.PLAYER_CATALOG + "_" + input.seasonId,
      Constants.SYSTEM_USER_ID,
      catalog,
      2, 0
    );

    logger.info(
      "[FantasyTeam] Player catalog synced for season %s: %d players",
      input.seasonId, playerIds.length
    );

    return RpcHelpers.successResponse({
      seasonId: input.seasonId,
      playerCount: playerIds.length,
      syncedAt: catalog.updatedAt,
    });
  }

  /**
   * Admin RPC to inspect what's currently in the player catalog.
   * Useful for debugging "Unknown player ID" errors.
   */
  function rpcCatalogGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as { seasonId: string };

    if (!input.seasonId) {
      return RpcHelpers.errorResponse("seasonId is required");
    }

    var catalog = getPlayerCatalog(nk, input.seasonId);
    if (!catalog) {
      return RpcHelpers.errorResponse("No player catalog found for season " + input.seasonId);
    }

    var playerIds = Object.keys(catalog.players);
    return RpcHelpers.successResponse({
      seasonId: catalog.seasonId,
      leagueId: catalog.leagueId,
      updatedAt: catalog.updatedAt,
      playerCount: playerIds.length,
      players: catalog.players,
    });
  }

  // ---- Registration ----

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("fantasy_team_create", rpcCreateTeam);
    initializer.registerRpc("fantasy_team_get", rpcGetTeam);
    initializer.registerRpc("fantasy_team_update_captain", rpcUpdateCaptain);
    initializer.registerRpc("fantasy_match_xi_select", rpcSelectMatchXI);
    initializer.registerRpc("fantasy_match_xi_get", rpcGetMatchXI);
    initializer.registerRpc("fantasy_match_deadline_set", rpcSetMatchDeadline);
    initializer.registerRpc("fantasy_catalog_sync", rpcCatalogSync);
    initializer.registerRpc("fantasy_catalog_get", rpcCatalogGet);
  }
}
