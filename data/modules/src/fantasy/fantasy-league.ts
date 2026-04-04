// ============================================================================
// FANTASY CRICKET — Private Leagues
// ============================================================================
// RPCs:
//   fantasy_league_create      — Create a private league (Nakama Group)
//   fantasy_league_join         — Join via invite code
//   fantasy_league_leave        — Leave a league
//   fantasy_league_leaderboard  — Get league-specific leaderboard
//   fantasy_league_my_leagues   — List user's leagues
//   fantasy_league_info         — Get league details
// ============================================================================

namespace FantasyLeague {

  var DEFAULT_MAX_MEMBERS = 20;
  var INVITE_CODE_LENGTH = 8;

  // ---- Helpers ----

  function generateInviteCode(): string {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var code = "";
    for (var i = 0; i < INVITE_CODE_LENGTH; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  function saveLeagueMeta(nk: nkruntime.Nakama, meta: FantasyTypes.LeagueMeta): void {
    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.LEAGUE_META + "_" + meta.groupId,
      Constants.SYSTEM_USER_ID,
      meta, 2, 0
    );

    // Also index by invite code for lookups
    Storage.writeJson(
      nk,
      FantasyTypes.COLLECTION,
      "league_invite_" + meta.inviteCode,
      Constants.SYSTEM_USER_ID,
      { groupId: meta.groupId, inviteCode: meta.inviteCode },
      2, 0
    );
  }

  function getLeagueMetaByGroup(nk: nkruntime.Nakama, groupId: string): FantasyTypes.LeagueMeta | null {
    return Storage.readJson<FantasyTypes.LeagueMeta>(
      nk,
      FantasyTypes.COLLECTION,
      FantasyTypes.Keys.LEAGUE_META + "_" + groupId,
      Constants.SYSTEM_USER_ID
    );
  }

  function lookupGroupByInviteCode(nk: nkruntime.Nakama, code: string): string | null {
    var data = Storage.readJson<{ groupId: string }>(
      nk,
      FantasyTypes.COLLECTION,
      "league_invite_" + code.toUpperCase(),
      Constants.SYSTEM_USER_ID
    );
    return data ? data.groupId : null;
  }

  function ensureLeagueLeaderboard(nk: nkruntime.Nakama, leaderboardId: string): void {
    try {
      nk.leaderboardCreate(
        leaderboardId,
        true,  // authoritative
        "incr", // operator: increment (we add match points)
        "desc", // sort order
        "",     // reset schedule (no auto-reset)
        {}      // metadata
      );
    } catch (e: any) {
      // Leaderboard may already exist — that's fine
    }
  }

  // ---- RPCs ----

  function rpcCreateLeague(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.CreateLeaguePayload;

    var check = RpcHelpers.validatePayload(input, ["leagueName", "seasonId"]);
    if (!check.valid) {
      return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
    }

    var maxMembers = input.maxMembers || DEFAULT_MAX_MEMBERS;
    if (maxMembers < 2 || maxMembers > 100) {
      return RpcHelpers.errorResponse("maxMembers must be between 2 and 100");
    }

    var inviteCode = generateInviteCode();

    // Create Nakama Group
    var group: nkruntime.Group;
    try {
      group = nk.groupCreate(
        userId,
        input.leagueName,
        userId,     // creator as initial member
        "",         // lang tag
        "Fantasy league for " + input.seasonId,
        "",         // avatar
        false,      // open = false (invite-only)
        { seasonId: input.seasonId, inviteCode: inviteCode },
        maxMembers
      );
    } catch (e: any) {
      return RpcHelpers.errorResponse("Failed to create group: " + (e.message || String(e)));
    }

    var leaderboardId = FantasyTypes.LEADERBOARD_LEAGUE_PREFIX + group.id;
    ensureLeagueLeaderboard(nk, leaderboardId);

    var meta: FantasyTypes.LeagueMeta = {
      groupId: group.id!,
      leagueName: input.leagueName,
      creatorId: userId,
      seasonId: input.seasonId,
      leaderboardId: leaderboardId,
      maxMembers: maxMembers,
      inviteCode: inviteCode,
      createdAt: new Date().toISOString(),
    };

    saveLeagueMeta(nk, meta);

    logger.info("[FantasyLeague] User %s created league '%s' (group: %s, code: %s)", userId, input.leagueName, group.id, inviteCode);

    EventBus.emit(nk, logger, ctx, "fantasy_league_created", {
      userId: userId,
      groupId: group.id,
      seasonId: input.seasonId,
      leagueName: input.leagueName,
    });

    return RpcHelpers.successResponse({
      groupId: group.id,
      leagueName: input.leagueName,
      inviteCode: inviteCode,
      leaderboardId: leaderboardId,
      maxMembers: maxMembers,
    });
  }

  function rpcJoinLeague(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.JoinLeaguePayload;

    if (!input.inviteCode) {
      return RpcHelpers.errorResponse("inviteCode is required");
    }

    var groupId = lookupGroupByInviteCode(nk, input.inviteCode);
    if (!groupId) {
      return RpcHelpers.errorResponse("Invalid invite code: " + input.inviteCode);
    }

    var meta = getLeagueMetaByGroup(nk, groupId);
    if (!meta) {
      return RpcHelpers.errorResponse("League metadata not found");
    }

    // Check current member count
    var members: nkruntime.GroupUserList;
    try {
      members = nk.groupUsersList(groupId, 100, undefined, "");
    } catch (e: any) {
      return RpcHelpers.errorResponse("Failed to check league members: " + (e.message || String(e)));
    }

    if (members.groupUsers && members.groupUsers.length >= meta.maxMembers) {
      return RpcHelpers.errorResponse("League is full (" + meta.maxMembers + " members max)");
    }

    // Check if already a member
    if (members.groupUsers) {
      for (var i = 0; i < members.groupUsers.length; i++) {
        if (members.groupUsers[i].user && members.groupUsers[i].user!.userId === userId) {
          return RpcHelpers.errorResponse("Already a member of this league");
        }
      }
    }

    // Join the group
    try {
      nk.groupUsersAdd(groupId, [userId]);
    } catch (e: any) {
      return RpcHelpers.errorResponse("Failed to join league: " + (e.message || String(e)));
    }

    logger.info("[FantasyLeague] User %s joined league %s (code: %s)", userId, groupId, input.inviteCode);

    return RpcHelpers.successResponse({
      groupId: groupId,
      leagueName: meta.leagueName,
      seasonId: meta.seasonId,
      leaderboardId: meta.leaderboardId,
    });
  }

  function rpcLeaveLeague(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var input = RpcHelpers.parseRpcPayload(payload) as { groupId: string };

    if (!input.groupId) {
      return RpcHelpers.errorResponse("groupId is required");
    }

    var meta = getLeagueMetaByGroup(nk, input.groupId);
    if (!meta) {
      return RpcHelpers.errorResponse("League not found");
    }

    if (meta.creatorId === userId) {
      return RpcHelpers.errorResponse("League creator cannot leave — transfer ownership or delete the league");
    }

    try {
      nk.groupUsersKick(input.groupId, [userId]);
    } catch (e: any) {
      return RpcHelpers.errorResponse("Failed to leave league: " + (e.message || String(e)));
    }

    logger.info("[FantasyLeague] User %s left league %s", userId, input.groupId);

    return RpcHelpers.successResponse({ left: true, groupId: input.groupId });
  }

  function rpcLeagueLeaderboard(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as FantasyTypes.LeagueLeaderboardPayload;

    if (!input.groupId) {
      return RpcHelpers.errorResponse("groupId is required");
    }

    var meta = getLeagueMetaByGroup(nk, input.groupId);
    if (!meta) {
      return RpcHelpers.errorResponse("League not found");
    }

    // Get member user IDs
    var memberIds: string[] = [];
    try {
      var members = nk.groupUsersList(input.groupId, 100, undefined, "");
      if (members.groupUsers) {
        for (var i = 0; i < members.groupUsers.length; i++) {
          if (members.groupUsers[i].user && members.groupUsers[i].user!.userId) {
            memberIds.push(members.groupUsers[i].user!.userId!);
          }
        }
      }
    } catch (e: any) {
      return RpcHelpers.errorResponse("Failed to list members: " + (e.message || String(e)));
    }

    if (memberIds.length === 0) {
      return RpcHelpers.successResponse({
        groupId: input.groupId,
        leagueName: meta.leagueName,
        records: [],
      });
    }

    // Read league leaderboard records for these members
    var limit = input.limit || 50;
    var records: { userId: string; score: number; rank: number }[] = [];

    try {
      var lbRecords = nk.leaderboardRecordsList(
        meta.leaderboardId,
        memberIds,
        limit,
        "",
        0
      );

      if (lbRecords && lbRecords.records) {
        for (var i = 0; i < lbRecords.records.length; i++) {
          var rec = lbRecords.records[i];
          records.push({
            userId: rec.ownerId!,
            score: Number(rec.score) || 0,
            rank: rec.rank ? Number(rec.rank) : i + 1,
          });
        }
      }
    } catch (e: any) {
      logger.warn("[FantasyLeague] LB read failed for league %s: %s", input.groupId, e.message || String(e));
    }

    return RpcHelpers.successResponse({
      groupId: input.groupId,
      leagueName: meta.leagueName,
      seasonId: meta.seasonId,
      memberCount: memberIds.length,
      records: records,
    });
  }

  function rpcMyLeagues(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);

    var leagues: {
      groupId: string;
      leagueName: string;
      seasonId: string;
      inviteCode: string;
      memberCount: number;
      isCreator: boolean;
    }[] = [];

    try {
      var userGroups = nk.userGroupsList(userId, 100, undefined, "");
      if (userGroups.userGroups) {
        for (var i = 0; i < userGroups.userGroups.length; i++) {
          var ug = userGroups.userGroups[i];
          if (!ug.group || !ug.group.id) continue;

          var meta = getLeagueMetaByGroup(nk, ug.group.id);
          if (!meta) continue;

          leagues.push({
            groupId: meta.groupId,
            leagueName: meta.leagueName,
            seasonId: meta.seasonId,
            inviteCode: meta.inviteCode,
            memberCount: ug.group.edgeCount || 0,
            isCreator: meta.creatorId === userId,
          });
        }
      }
    } catch (e: any) {
      return RpcHelpers.errorResponse("Failed to list groups: " + (e.message || String(e)));
    }

    return RpcHelpers.successResponse({ leagues: leagues });
  }

  function rpcLeagueInfo(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var input = RpcHelpers.parseRpcPayload(payload) as { groupId: string };

    if (!input.groupId) {
      return RpcHelpers.errorResponse("groupId is required");
    }

    var meta = getLeagueMetaByGroup(nk, input.groupId);
    if (!meta) {
      return RpcHelpers.errorResponse("League not found");
    }

    var memberCount = 0;
    try {
      var members = nk.groupUsersList(input.groupId, 1, undefined, "");
      if (members.groupUsers) {
        memberCount = members.groupUsers.length;
      }
    } catch (e: any) {
      // ignore
    }

    return RpcHelpers.successResponse({
      groupId: meta.groupId,
      leagueName: meta.leagueName,
      creatorId: meta.creatorId,
      seasonId: meta.seasonId,
      leaderboardId: meta.leaderboardId,
      maxMembers: meta.maxMembers,
      inviteCode: meta.inviteCode,
      memberCount: memberCount,
      createdAt: meta.createdAt,
    });
  }

  // ---- Registration ----

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("fantasy_league_create", rpcCreateLeague);
    initializer.registerRpc("fantasy_league_join", rpcJoinLeague);
    initializer.registerRpc("fantasy_league_leave", rpcLeaveLeague);
    initializer.registerRpc("fantasy_league_leaderboard", rpcLeagueLeaderboard);
    initializer.registerRpc("fantasy_league_my_leagues", rpcMyLeagues);
    initializer.registerRpc("fantasy_league_info", rpcLeagueInfo);
  }
}
