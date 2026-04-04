// ============================================================================
// FANTASY CRICKET — Transfers
// ============================================================================
// RPCs:
//   fantasy_transfer        — Execute a set of transfers (in/out pairs)
//   fantasy_transfer_window  — Get current transfer window status
//   fantasy_transfer_history — Get user's transfer history for a season
// ============================================================================

namespace FantasyTransfer {

  var PENALTY_PER_EXTRA_TRANSFER = -4;

  // ---- Helpers ----

  function getTransferWindow(nk: nkruntime.Nakama, seasonId: string, matchday: number): FantasyTypes.TransferWindow | null {
    return Storage.readJson<FantasyTypes.TransferWindow>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.TRANSFER_WINDOW + "_" + seasonId + "_" + matchday,
      Constants.SYSTEM_USER_ID
    );
  }

  function getSeasonState(nk: nkruntime.Nakama, userId: string, seasonId: string): FantasyTypes.SeasonState | null {
    return Storage.readJson<FantasyTypes.SeasonState>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.SEASON_STATE + "_" + seasonId,
      userId
    );
  }

  function saveSeasonState(nk: nkruntime.Nakama, state: FantasyTypes.SeasonState): void {
    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.SEASON_STATE + "_" + state.seasonId,
      state.userId,
      state, 2, 1
    );
  }

  function getCatalog(nk: nkruntime.Nakama, seasonId: string): FantasyTypes.PlayerCatalog | null {
    return Storage.readJson<FantasyTypes.PlayerCatalog>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.PLAYER_CATALOG + "_" + seasonId,
      Constants.SYSTEM_USER_ID
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

  function saveTeam(nk: nkruntime.Nakama, team: FantasyTypes.FantasyTeam): void {
    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.TEAM + "_" + team.seasonId,
      team.userId,
      team, 2, 1
    );
  }

  // ---- RPCs ----

  function rpcTransfer(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.TransferPayload;

    var check = RpcHelpers.validatePayload(input, ["seasonId", "matchday", "transfersIn", "transfersOut"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    if (input.transfersIn.length !== input.transfersOut.length) {
      return RpcHelpers.errorResponse("transfersIn and transfersOut must be equal length");
    }

    if (input.transfersIn.length === 0) {
      return RpcHelpers.errorResponse("At least one transfer pair required");
    }

    var window = getTransferWindow(nk, input.seasonId, input.matchday);
    if (!window || !window.isOpen) {
      return RpcHelpers.errorResponse("Transfer window is closed for matchday " + input.matchday);
    }

    var now = new Date();
    if (window.closesAt && new Date(window.closesAt) < now) {
      return RpcHelpers.errorResponse("Transfer window has expired");
    }
    if (window.opensAt && new Date(window.opensAt) > now) {
      return RpcHelpers.errorResponse("Transfer window has not opened yet");
    }

    var catalog = getCatalog(nk, input.seasonId);
    if (!catalog) return RpcHelpers.errorResponse("Player catalog not found");

    var team = getTeam(nk, userId, input.seasonId);
    if (!team) return RpcHelpers.errorResponse("No squad found — create a team first");

    var seasonState = getSeasonState(nk, userId, input.seasonId);
    if (!seasonState) return RpcHelpers.errorResponse("Season state not found");

    var currentPlayerIds: { [id: string]: boolean } = {};
    for (var i = 0; i < team.players.length; i++) {
      currentPlayerIds[team.players[i].playerId] = true;
    }

    for (var i = 0; i < input.transfersOut.length; i++) {
      if (!currentPlayerIds[input.transfersOut[i]]) {
        return RpcHelpers.errorResponse("Player " + input.transfersOut[i] + " not in your squad");
      }
    }

    for (var i = 0; i < input.transfersIn.length; i++) {
      if (currentPlayerIds[input.transfersIn[i]]) {
        return RpcHelpers.errorResponse("Player " + input.transfersIn[i] + " already in your squad");
      }
      if (!catalog.players[input.transfersIn[i]]) {
        return RpcHelpers.errorResponse("Unknown player: " + input.transfersIn[i]);
      }
    }

    var numTransfers = input.transfersIn.length;
    var freeAvailable = seasonState.freeTransfersRemaining;
    var extraTransfers = Math.max(0, numTransfers - freeAvailable);
    var isBoosted = false;

    if (input.boosterId) {
      try {
        var inventoryItems = nk.storageRead([{
          collection: "hiro_inventory",
          key: input.boosterId,
          userId: userId,
        }]);
        if (inventoryItems && inventoryItems.length > 0) {
          isBoosted = true;
          extraTransfers = 0;
          nk.storageDelete([{
            collection: "hiro_inventory",
            key: input.boosterId,
            userId: userId,
          }]);
          seasonState.boostersUsed.push(input.boosterId);
          logger.info("[FantasyTransfer] Booster %s consumed for user %s", input.boosterId, userId);
        } else {
          return RpcHelpers.errorResponse("Booster not found in inventory: " + input.boosterId);
        }
      } catch (err: any) {
        return RpcHelpers.errorResponse("Failed to consume booster: " + (err.message || String(err)));
      }
    }

    var penaltyPoints = extraTransfers * PENALTY_PER_EXTRA_TRANSFER;

    var newPlayers: FantasyTypes.FantasySquadPlayer[] = [];
    for (var i = 0; i < team.players.length; i++) {
      var isBeingRemoved = false;
      for (var j = 0; j < input.transfersOut.length; j++) {
        if (team.players[i].playerId === input.transfersOut[j]) {
          isBeingRemoved = true;
          break;
        }
      }
      if (!isBeingRemoved) {
        newPlayers.push(team.players[i]);
      }
    }

    for (var i = 0; i < input.transfersIn.length; i++) {
      var catEntry = catalog.players[input.transfersIn[i]];
      newPlayers.push({
        playerId: input.transfersIn[i],
        creditValue: catEntry.creditValue,
        teamId: catEntry.teamId,
        role: catEntry.role,
        isCaptain: false,
        isViceCaptain: false,
      });
    }

    var totalCredits = 0;
    var teamCounts: { [teamId: string]: number } = {};
    var roleCounts: { [role: string]: number } = { "batsman": 0, "bowler": 0, "all-rounder": 0, "wicket-keeper": 0 };

    for (var i = 0; i < newPlayers.length; i++) {
      totalCredits += newPlayers[i].creditValue;
      if (!teamCounts[newPlayers[i].teamId]) teamCounts[newPlayers[i].teamId] = 0;
      teamCounts[newPlayers[i].teamId]++;
      if (roleCounts[newPlayers[i].role] !== undefined) {
        roleCounts[newPlayers[i].role]++;
      }
    }

    if (totalCredits > 100) {
      return RpcHelpers.errorResponse("Post-transfer credits " + totalCredits.toFixed(1) + " exceeds budget of 100");
    }

    var teamIds = Object.keys(teamCounts);
    for (var i = 0; i < teamIds.length; i++) {
      if (teamCounts[teamIds[i]] > 7) {
        return RpcHelpers.errorResponse("Post-transfer: max 7 per team, team " + teamIds[i] + " has " + teamCounts[teamIds[i]]);
      }
    }

    if (roleCounts["batsman"] < 3) return RpcHelpers.errorResponse("Post-transfer: need at least 3 batsmen");
    if (roleCounts["bowler"] < 3) return RpcHelpers.errorResponse("Post-transfer: need at least 3 bowlers");
    if (roleCounts["all-rounder"] < 1) return RpcHelpers.errorResponse("Post-transfer: need at least 1 all-rounder");
    if (roleCounts["wicket-keeper"] < 1) return RpcHelpers.errorResponse("Post-transfer: need at least 1 wicket-keeper");

    var captainStillPresent = false;
    var vcStillPresent = false;
    for (var i = 0; i < newPlayers.length; i++) {
      if (newPlayers[i].playerId === team.captainId) captainStillPresent = true;
      if (newPlayers[i].playerId === team.viceCaptainId) vcStillPresent = true;
    }
    if (!captainStillPresent) {
      return RpcHelpers.errorResponse("Captain was transferred out — set a new captain first or keep them in the squad");
    }
    if (!vcStillPresent) {
      return RpcHelpers.errorResponse("Vice-captain was transferred out — set a new VC first or keep them in the squad");
    }

    team.players = newPlayers;
    team.totalCredits = totalCredits;
    team.updatedAt = new Date().toISOString();
    saveTeam(nk, team);

    var nowIso = new Date().toISOString();
    for (var i = 0; i < input.transfersIn.length; i++) {
      var inEntry = catalog.players[input.transfersIn[i]];
      var outEntry = catalog.players[input.transfersOut[i]];
      seasonState.transferHistory.push({
        matchday: input.matchday,
        transferredIn: input.transfersIn[i],
        transferredOut: input.transfersOut[i],
        creditDelta: inEntry.creditValue - outEntry.creditValue,
        boosterUsed: isBoosted ? input.boosterId! : null,
        timestamp: nowIso,
      });
    }

    seasonState.totalTransfersMade += numTransfers;
    seasonState.freeTransfersRemaining = Math.max(0, freeAvailable - numTransfers);
    seasonState.penaltyPointsAccrued += Math.abs(penaltyPoints);
    seasonState.updatedAt = nowIso;
    saveSeasonState(nk, seasonState);

    logger.info("[FantasyTransfer] User %s: %d transfers (free: %d, extra: %d, penalty: %d)", userId, numTransfers, Math.min(numTransfers, freeAvailable), extraTransfers, penaltyPoints);

    EventBus.emit(nk, logger, ctx, "fantasy_transfer_executed", {
      userId: userId,
      seasonId: input.seasonId,
      matchday: input.matchday,
      transferCount: numTransfers,
      penaltyPoints: penaltyPoints,
      boosterUsed: isBoosted,
    });

    return RpcHelpers.successResponse({
      team: team,
      transfersMade: numTransfers,
      freeTransfersUsed: Math.min(numTransfers, freeAvailable),
      extraTransfers: extraTransfers,
      penaltyPoints: penaltyPoints,
      boosterConsumed: isBoosted ? input.boosterId : null,
      freeTransfersRemaining: seasonState.freeTransfersRemaining,
    });
  }

  function rpcTransferWindow(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as { seasonId: string; matchday: number };

    var check = RpcHelpers.validatePayload(input, ["seasonId", "matchday"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    var window = getTransferWindow(nk, input.seasonId, input.matchday);
    if (!window) {
      return RpcHelpers.errorResponse("No transfer window found for matchday " + input.matchday);
    }

    return RpcHelpers.successResponse(window);
  }

  function rpcTransferHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as { seasonId: string };

    if (!input.seasonId) {
      return RpcHelpers.errorResponse("seasonId is required");
    }

    var state = getSeasonState(nk, userId, input.seasonId);
    if (!state) {
      return RpcHelpers.errorResponse("Season state not found");
    }

    return RpcHelpers.successResponse({
      totalTransfers: state.totalTransfersMade,
      freeTransfersRemaining: state.freeTransfersRemaining,
      penaltyPointsAccrued: state.penaltyPointsAccrued,
      boostersUsed: state.boostersUsed,
      history: state.transferHistory,
    });
  }

  // ---- Registration ----

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("fantasy_transfer", rpcTransfer);
    initializer.registerRpc("fantasy_transfer_window", rpcTransferWindow);
    initializer.registerRpc("fantasy_transfer_history", rpcTransferHistory);
  }
}
