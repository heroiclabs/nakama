// engagement_extras.ts — five compact engagement systems from the doc's
// Appendix E action list, grouped because each is a thin RPC over data that
// already exists elsewhere in the platform:
//
//   G-021 ivx_social_quiz_social_proof   — "Ana and 2 friends played this"
//   G-022 ivx_social_group_streak_status — collaborative group streaks
//   G-003 ivx_social_friend_recommendations — friends-of-friends via SQL
//   G-016 ivx_social_starter_groups      — curated cold-start groups
//   G-015 ivx_social_contact_hash_register / ivx_social_contacts_match
//         — privacy-preserving phone-contact matching (SHA-256 hashes only)

namespace SocialEngagementExtras {

  var SYSTEM_USER  = "00000000-0000-0000-0000-000000000000";
  var STATE_FRIEND = 0;

  // ═══ G-021: quiz social proof ═════════════════════════════════════════════
  // Source: the friends feed events already written by quiz completion
  // (7-day window) — no new write path needed.
  function rpcQuizSocialProof(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var gameId = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";
      var quizIds: string[] = [];
      if (data.quizIds && Object.prototype.toString.call(data.quizIds) === "[object Array]") {
        for (var q = 0; q < data.quizIds.length && quizIds.length < 20; q++) {
          if (typeof data.quizIds[q] === "string" && data.quizIds[q]) quizIds.push(data.quizIds[q]);
        }
      }
      if (quizIds.length === 0) return RpcHelpers.errorResponse("quizIds (non-empty array, max 20) required");

      var friendIds: string[] = [];
      try {
        var page = nk.friendsList(userId, 1000, STATE_FRIEND, null as any);
        if (page && page.friends) {
          for (var i = 0; i < page.friends.length && friendIds.length < 100; i++) {
            var fr: any = page.friends[i];
            if (fr && fr.user && fr.user.id) friendIds.push(fr.user.id);
          }
        }
      } catch (_) {}
      var proof: { [quizId: string]: any } = {};
      for (var z = 0; z < quizIds.length; z++) {
        proof[quizIds[z]] = { friendsCompleted: 0, topFriendScore: 0, friendNames: [] };
      }
      if (friendIds.length === 0) return RpcHelpers.successResponse({ proof: proof });

      // One SQL over feed events: friends' quiz_completed rows for these quizzes.
      var params: any[] = [];
      var fph: string[] = [];
      for (var f = 0; f < friendIds.length; f++) { params.push(friendIds[f]); fph.push("$" + params.length); }
      var qph: string[] = [];
      for (var qq = 0; qq < quizIds.length; qq++) { params.push(quizIds[qq]); qph.push("$" + params.length); }
      params.push(gameId);
      var gp = "$" + params.length;

      var rows: any[] = [];
      try {
        rows = nk.sqlQuery(
          "SELECT value FROM storage " +
          "WHERE collection = 'ivx_friends_feed_events' " +
          "  AND user_id IN (" + fph.join(",") + ") " +
          "  AND (value->>'eventType') = 'quiz_completed' " +
          "  AND (value->'data'->>'quizId') IN (" + qph.join(",") + ") " +
          "  AND (value->>'gameId') = " + gp + " " +
          "LIMIT 500",
          params
        ) as any[];
      } catch (e: any) {
        logger.warn("[SocialProof] SQL failed: " + (e && e.message));
        return RpcHelpers.successResponse({ proof: proof, degraded: true });
      }
      if (!rows) rows = [];

      var seenPerQuiz: { [k: string]: boolean } = {};
      for (var r = 0; r < rows.length; r++) {
        var v: any = rows[r] && rows[r].value;
        if (typeof v === "string") { try { v = JSON.parse(v); } catch (_) { v = null; } }
        if (!v || !v.data || !v.data.quizId || !proof[v.data.quizId]) continue;
        var slot = proof[v.data.quizId];
        var dedupKey = v.data.quizId + "|" + v.authorId;
        if (seenPerQuiz[dedupKey]) {
          // Same friend replayed — only track best score, not count.
        } else {
          seenPerQuiz[dedupKey] = true;
          slot.friendsCompleted++;
          if (slot.friendNames.length < 3 && v.authorName) slot.friendNames.push(v.authorName);
        }
        var sc = (typeof v.data.score === "number") ? v.data.score : 0;
        if (sc > slot.topFriendScore) slot.topFriendScore = sc;
      }
      return RpcHelpers.successResponse({ proof: proof });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to compute social proof");
    }
  }

  // ═══ G-022: group streaks ═════════════════════════════════════════════════
  // The group streak survives if ANY member plays each day (collaborative,
  // unlike individual streaks). Contribution is recorded from the quiz
  // submit flow for every group the player belongs to (capped).
  var GROUP_STREAK_COLLECTION = "ivx_group_streaks";
  var MAX_GROUPS_PER_CREDIT = 10;

  function dayStr(offsetDays: number): string {
    return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  }

  export function creditGroupStreaks(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string): void {
    try {
      var res = nk.userGroupsList(userId, MAX_GROUPS_PER_CREDIT, undefined as any, undefined as any);
      var list: any[] = (res && res.userGroups) ? res.userGroups : [];
      var today = dayStr(0), yesterday = dayStr(-1);
      for (var i = 0; i < list.length; i++) {
        var ug: any = list[i];
        if (!ug || !ug.group || !ug.group.id) continue;
        if (typeof ug.state === "number" && ug.state > 2) continue; // join-request only
        var gid = ug.group.id;
        for (var attempt = 0; attempt < 2; attempt++) {
          var cur: any = null, version = "";
          try {
            var rows = nk.storageRead([{ collection: GROUP_STREAK_COLLECTION, key: gid, userId: SYSTEM_USER }]);
            if (rows && rows.length > 0 && rows[0] && rows[0].value) { cur = rows[0].value; version = rows[0].version || ""; }
          } catch (_) {}
          if (cur && cur.lastContributionDate === today) break; // already alive today
          var streak: any;
          if (cur && cur.lastContributionDate === yesterday) {
            streak = cur; streak.streakDays = (streak.streakDays || 0) + 1;
          } else {
            streak = { groupId: gid, streakDays: 1, bestStreakDays: (cur && cur.bestStreakDays) || 0 };
          }
          streak.lastContributionDate = today;
          streak.lastContributorId = userId;
          streak.bestStreakDays = Math.max(streak.bestStreakDays || 0, streak.streakDays);
          var req: any = { collection: GROUP_STREAK_COLLECTION, key: gid, userId: SYSTEM_USER,
                           value: streak, permissionRead: 2, permissionWrite: 0 };
          if (version) req.version = version;
          try { nk.storageWrite([req]); break; } catch (occ) { if (attempt === 1) break; }
        }
      }
    } catch (e: any) {
      if (logger && logger.warn) logger.warn("[GroupStreaks] credit failed (non-fatal): " + (e && e.message));
    }
  }

  function rpcGroupStreakStatus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      if (!data.groupId || typeof data.groupId !== "string") return RpcHelpers.errorResponse("groupId is required");
      var value: any = { groupId: data.groupId, streakDays: 0, bestStreakDays: 0, lastContributionDate: "", lastContributorId: "" };
      try {
        var rows = nk.storageRead([{ collection: GROUP_STREAK_COLLECTION, key: data.groupId, userId: SYSTEM_USER }]);
        if (rows && rows.length > 0 && rows[0] && rows[0].value) value = rows[0].value;
      } catch (_) {}
      var today = dayStr(0), yesterday = dayStr(-1);
      // A streak whose last contribution predates yesterday is broken —
      // report zero live days but keep best/history fields.
      var alive = (value.lastContributionDate === today || value.lastContributionDate === yesterday);
      return RpcHelpers.successResponse({
        groupId: data.groupId,
        streakDays: alive ? (value.streakDays || 0) : 0,
        bestStreakDays: value.bestStreakDays || 0,
        contributedToday: value.lastContributionDate === today,
        atRisk: value.lastContributionDate === yesterday,   // nobody played yet today
        lastContributorId: value.lastContributorId || ""
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to read group streak");
    }
  }

  // ═══ G-003: friend-of-friend recommendations ══════════════════════════════
  // Graph distance beats geography (§E.1): 2nd-degree connections ranked by
  // mutual-friend count, in ONE SQL over Nakama's user_edge table
  // (source_id, destination_id, state; 0=friend, 3=blocked).
  function rpcFriendRecommendations(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var limit = (typeof data.limit === "number" && data.limit > 0) ? Math.min(Math.floor(data.limit), 25) : 10;

      var rows: any[] = [];
      try {
        rows = nk.sqlQuery(
          // fof = friends of my friends, excluding me, anyone already in my
          // graph (any state — friend/pending/blocked), and anyone who
          // blocked me. Ranked by mutual count.
          "SELECT fof.destination_id AS user_id, count(*) AS mutual_count " +
          "FROM user_edge me " +
          "JOIN user_edge fof ON fof.source_id = me.destination_id AND fof.state = 0 " +
          "WHERE me.source_id = $1 AND me.state = 0 " +
          "  AND fof.destination_id <> $1 " +
          "  AND NOT EXISTS (SELECT 1 FROM user_edge mine WHERE mine.source_id = $1 AND mine.destination_id = fof.destination_id) " +
          "  AND NOT EXISTS (SELECT 1 FROM user_edge blk  WHERE blk.source_id = fof.destination_id AND blk.destination_id = $1 AND blk.state = 3) " +
          "GROUP BY fof.destination_id " +
          "ORDER BY mutual_count DESC " +
          "LIMIT $2",
          [userId, limit]
        ) as any[];
      } catch (e: any) {
        logger.warn("[FoF] SQL failed: " + (e && e.message));
        return RpcHelpers.successResponse({ recommendations: [], degraded: true });
      }
      if (!rows) rows = [];

      var ids: string[] = [];
      var mutual: { [id: string]: number } = {};
      for (var i = 0; i < rows.length; i++) {
        var r: any = rows[i];
        if (!r || !r.user_id) continue;
        var uid = String(r.user_id);
        ids.push(uid);
        mutual[uid] = (typeof r.mutual_count === "number") ? r.mutual_count : parseInt(String(r.mutual_count || 0), 10);
      }
      var recs: any[] = [];
      if (ids.length > 0) {
        try {
          var users = nk.usersGetId(ids);
          if (users) {
            for (var u = 0; u < users.length; u++) {
              var usr: any = users[u];
              if (!usr || !usr.userId) continue;
              recs.push({
                userId: usr.userId,
                username: usr.username || "",
                displayName: usr.displayName || usr.username || "",
                avatarUrl: usr.avatarUrl || "",
                mutualFriends: mutual[usr.userId] || 0,
                reason: "mutual_friends"
              });
            }
          }
        } catch (_) {}
      }
      recs.sort(function (a, b) { return b.mutualFriends - a.mutualFriends; });
      return RpcHelpers.successResponse({ recommendations: recs, count: recs.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to compute recommendations");
    }
  }

  // ═══ G-016: curated starter groups ════════════════════════════════════════
  var STARTER_COLLECTION = "ivx_starter_groups";

  function rpcStarterGroups(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var gameId = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";
      var groupIds: string[] = [];
      try {
        var rows = nk.storageRead([{ collection: STARTER_COLLECTION, key: gameId, userId: SYSTEM_USER }]);
        if (rows && rows.length > 0 && rows[0] && rows[0].value && rows[0].value.groupIds) {
          groupIds = rows[0].value.groupIds;
        }
      } catch (_) {}
      if (groupIds.length === 0) return RpcHelpers.successResponse({ groups: [], curated: false });

      var cards: any[] = [];
      try {
        var groups = nk.groupsGetId(groupIds.slice(0, 20));
        if (groups) {
          for (var g = 0; g < groups.length; g++) {
            var grp: any = groups[g];
            if (!grp || !grp.id) continue;
            var meta: any = {};
            try { meta = (typeof grp.metadata === "string") ? JSON.parse(grp.metadata || "{}") : (grp.metadata || {}); } catch (_) {}
            cards.push({
              id: grp.id, name: grp.name || "", description: grp.description || "",
              avatarUrl: grp.avatarUrl || "", memberCount: grp.edgeCount || 0,
              maxCount: grp.maxCount || 0, groupType: meta.groupType || "", badge: meta.badge || ""
            });
          }
        }
      } catch (_) {}
      return RpcHelpers.successResponse({ groups: cards, curated: true });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to load starter groups");
    }
  }

  function rpcStarterGroupsSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data: any = {};
      try { data = payload ? JSON.parse(payload) : {}; } catch (_) {}
      var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) ||
                           (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
      if (!expected || data.service_token !== expected) return RpcHelpers.errorResponse("service-only", 401);
      var gameId = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";
      var groupIds: string[] = (data.groupIds && Object.prototype.toString.call(data.groupIds) === "[object Array]") ? data.groupIds : [];
      nk.storageWrite([{
        collection: STARTER_COLLECTION, key: gameId, userId: SYSTEM_USER,
        value: { gameId: gameId, groupIds: groupIds.slice(0, 20), updatedAt: new Date().toISOString() },
        permissionRead: 2, permissionWrite: 0
      }]);
      return RpcHelpers.successResponse({ gameId: gameId, count: groupIds.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to save starter groups");
    }
  }

  // ═══ G-015: contact matching (privacy-preserving) ═════════════════════════
  // Clients hash phone numbers (SHA-256 of E.164) LOCALLY — raw numbers
  // never reach the server (the WhatsApp/Snapchat/Duolingo pattern, §E.4).
  //   register: user stores their OWN hash → userId mapping (opt-in).
  //   match:    caller submits contact hashes; server returns matches.
  var CONTACTS_COLLECTION = "ivx_contact_hashes";
  var HASH_RE = /^[0-9a-f]{64}$/i;
  var MAX_MATCH_BATCH = 500;

  function rpcContactHashRegister(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      if (data.remove === true) {
        // Opt-out: remove any prior registration (needs the hash to locate it).
        if (typeof data.phoneHash === "string" && HASH_RE.test(data.phoneHash)) {
          try { nk.storageDelete([{ collection: CONTACTS_COLLECTION, key: data.phoneHash.toLowerCase(), userId: SYSTEM_USER }]); } catch (_) {}
        }
        return RpcHelpers.successResponse({ removed: true });
      }
      if (typeof data.phoneHash !== "string" || !HASH_RE.test(data.phoneHash)) {
        return RpcHelpers.errorResponse("phoneHash must be a 64-char SHA-256 hex string");
      }
      nk.storageWrite([{
        collection: CONTACTS_COLLECTION, key: data.phoneHash.toLowerCase(), userId: SYSTEM_USER,
        value: { userId: userId, registeredAt: new Date().toISOString() },
        permissionRead: 0, permissionWrite: 0
      }]);
      return RpcHelpers.successResponse({ registered: true });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to register contact hash");
    }
  }

  function rpcContactsMatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var hashes: string[] = [];
      if (data.hashedPhones && Object.prototype.toString.call(data.hashedPhones) === "[object Array]") {
        for (var i = 0; i < data.hashedPhones.length && hashes.length < MAX_MATCH_BATCH; i++) {
          var h = data.hashedPhones[i];
          if (typeof h === "string" && HASH_RE.test(h)) hashes.push(h.toLowerCase());
        }
      }
      if (hashes.length === 0) return RpcHelpers.errorResponse("hashedPhones (array of SHA-256 hex, max " + MAX_MATCH_BATCH + ") required");

      var reads: nkruntime.StorageReadRequest[] = [];
      for (var r = 0; r < hashes.length; r++) {
        reads.push({ collection: CONTACTS_COLLECTION, key: hashes[r], userId: SYSTEM_USER });
      }
      var matchedIds: string[] = [];
      var byUser: { [id: string]: boolean } = {};
      try {
        var rows = nk.storageRead(reads);
        if (rows) {
          for (var w = 0; w < rows.length; w++) {
            var v: any = rows[w] && rows[w].value;
            if (v && v.userId && v.userId !== userId && !byUser[v.userId]) {
              byUser[v.userId] = true;
              matchedIds.push(v.userId);
            }
          }
        }
      } catch (_) {}

      var matches: any[] = [];
      if (matchedIds.length > 0) {
        try {
          var users = nk.usersGetId(matchedIds.slice(0, 100));
          if (users) {
            for (var u = 0; u < users.length; u++) {
              var usr: any = users[u];
              if (!usr || !usr.userId) continue;
              matches.push({
                userId: usr.userId, username: usr.username || "",
                displayName: usr.displayName || usr.username || "",
                avatarUrl: usr.avatarUrl || ""
              });
            }
          }
        } catch (_) {}
      }
      return RpcHelpers.successResponse({ matches: matches, count: matches.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to match contacts");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_quiz_social_proof", rpcQuizSocialProof);
    initializer.registerRpc("ivx_social_group_streak_status", rpcGroupStreakStatus);
    initializer.registerRpc("ivx_social_friend_recommendations", rpcFriendRecommendations);
    initializer.registerRpc("ivx_social_starter_groups", rpcStarterGroups);
    initializer.registerRpc("ivx_social_starter_groups_set", rpcStarterGroupsSet);
    initializer.registerRpc("ivx_social_contact_hash_register", rpcContactHashRegister);
    initializer.registerRpc("ivx_social_contacts_match", rpcContactsMatch);
  }
}
