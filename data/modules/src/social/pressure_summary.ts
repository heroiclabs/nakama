// pressure_summary.ts — REAL social pressure data (G-020 / Q-02).
//
// Unity's SocialPressureManager has shipped rendering MOCK friend activity
// since launch (architecture doc §17.3). This module revives the useful
// halves of the dead social_v2.js handlers (rpcGetRivalry / the
// rpcFriendScoreAlert idea) into ONE hardened RPC that feeds that UI slot
// real numbers:
//
//   ivx_social_pressure_summary → {
//     friendsAheadOfMe: [{ userId, displayName, score, gapScore }...],
//     friendsBehindMe, myScore, myRankInFriendList, totalFriendsRanked,
//     rivalry?: { targetUserId, wins, losses, draws, streak }   (optional)
//   }
//
// HARDENING VS THE DEAD CODE
//   - social_v2's rpcFriendScoreAlert called leaderboardRecordsList once PER
//     FRIEND (N round-trips). The API accepts an ownerIds ARRAY — this does
//     ONE call for up to 100 friends.
//   - Board id follows the live convention (src/legacy/leaderboards.ts):
//     leaderboard_{gameId}_weekly, falling back to leaderboard_{gameId} when
//     the weekly board doesn't exist. Weekly is the right psychology per
//     Duolingo research (§3.2): "XP this week", not lifetime totals.
//   - Rivalry read ported intact from rpcGetRivalry (same rivalries
//     collection + key scheme, so any historical rows still resolve).

namespace SocialPressureSummary {

  var SYSTEM_USER  = "00000000-0000-0000-0000-000000000000";
  var STATE_FRIEND = 0;
  var MAX_FRIENDS  = 100;
  var MAX_AHEAD    = 10;

  function readBoardScores(nk: nkruntime.Nakama, logger: nkruntime.Logger, boardId: string, ownerIds: string[]): { [id: string]: number } | null {
    try {
      var res: any = nk.leaderboardRecordsList(boardId, ownerIds, ownerIds.length, undefined as any, undefined as any);
      var records: any[] = [];
      if (res && res.ownerRecords) records = res.ownerRecords;
      else if (res && res.records) records = res.records;
      var out: { [id: string]: number } = {};
      for (var i = 0; i < records.length; i++) {
        var r: any = records[i];
        if (r && r.ownerId) out[r.ownerId] = (typeof r.score === "number") ? r.score : parseInt(String(r.score || 0), 10);
      }
      return out;
    } catch (e: any) {
      // Board may not exist for this game — caller tries the fallback id.
      return null;
    }
  }

  function rpcPressureSummary(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var gameId = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";

      // 1. Confirmed friends with display names (single scan).
      var friendIds: string[] = [];
      var nameById: { [id: string]: string } = {};
      try {
        var page = nk.friendsList(userId, 1000, STATE_FRIEND, null as any);
        if (page && page.friends) {
          for (var i = 0; i < page.friends.length && friendIds.length < MAX_FRIENDS; i++) {
            var fr: any = page.friends[i];
            if (fr && fr.user && fr.user.id) {
              friendIds.push(fr.user.id);
              nameById[fr.user.id] = fr.user.displayName || fr.user.username || "";
            }
          }
        }
      } catch (fe: any) {
        logger.warn("[PressureSummary] friendsList failed: " + (fe && fe.message));
      }
      if (friendIds.length === 0) {
        return RpcHelpers.successResponse({
          friendsAheadOfMe: [], friendsBehindMe: 0, myScore: 0,
          myRankInFriendList: 0, totalFriendsRanked: 0, boardId: "", emptyReason: "no_friends"
        });
      }

      // 2. One leaderboard read for me + all friends. Weekly board first
      //    (the Duolingo-correct scope), main board as fallback.
      var owners = friendIds.concat([userId]);
      var boardId = "leaderboard_" + gameId + "_weekly";
      var scores = readBoardScores(nk, logger, boardId, owners);
      if (scores === null) {
        boardId = "leaderboard_" + gameId;
        scores = readBoardScores(nk, logger, boardId, owners);
      }
      if (scores === null) scores = {};

      var myScore = scores[userId] || 0;

      // 3. Rank + ahead/behind. Friends with no record score 0 and are
      //    counted as "behind" (they haven't played this week).
      var ahead: any[] = [];
      var behind = 0;
      for (var f = 0; f < friendIds.length; f++) {
        var fid = friendIds[f];
        var fscore = scores[fid] || 0;
        if (fscore > myScore) {
          ahead.push({
            userId: fid,
            displayName: nameById[fid] || "",
            score: fscore,
            gapScore: fscore - myScore
          });
        } else {
          behind++;
        }
      }
      // Closest rivals first — "Maria passed you, 120 XP to get back ahead"
      // is actionable; the friend 50,000 XP ahead is not (loss-aversion §E.6).
      ahead.sort(function (a, b) { return a.gapScore - b.gapScore; });
      if (ahead.length > MAX_AHEAD) ahead = ahead.slice(0, MAX_AHEAD);

      // 4. Optional head-to-head rivalry (ported from dead rpcGetRivalry —
      //    same collection + key scheme so historical rows still resolve).
      var rivalry: any = null;
      if (typeof data.rivalUserId === "string" && data.rivalUserId) {
        try {
          var pairKey = [userId, data.rivalUserId].sort().join(":");
          var rows = nk.storageRead([{
            collection: "rivalries", key: "rivalry:" + gameId + ":" + pairKey, userId: SYSTEM_USER
          }]);
          if (rows && rows.length > 0 && rows[0] && rows[0].value) {
            var rv: any = rows[0].value;
            rivalry = {
              targetUserId: data.rivalUserId,
              wins:   (rv.player_a === userId) ? (rv.a_wins || 0) : (rv.b_wins || 0),
              losses: (rv.player_a === userId) ? (rv.b_wins || 0) : (rv.a_wins || 0),
              draws:  rv.draws || 0,
              streak: rv.streak || 0,
              lastMatch: rv.last_match || null
            };
          }
        } catch (_) { /* optional — omit on failure */ }
      }

      return RpcHelpers.successResponse({
        boardId:            boardId,
        myScore:            myScore,
        friendsAheadOfMe:   ahead,
        friendsBehindMe:    behind,
        myRankInFriendList: ahead.length + 1,
        totalFriendsRanked: friendIds.length,
        rivalry:            rivalry
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to compute pressure summary");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_pressure_summary", rpcPressureSummary);
  }
}
