// leagues.ts — Duolingo-style weekly Leagues (Q-11, doc §17.5 / §F.2 rank #2).
//
// THE MECHANIC: every player sits in a ≤30-person pool within a 10-tier
// ladder (Bronze → Legend). Standings are weekly XP (ivx_game_player_stats —
// the ML-002 system, so NO separate score submission exists to cheat).
// At the ISO-week rollover, top finishers promote a tier, bottom finishers
// demote. This is deliberately NOT relationship-scoped: it solves
// "engagement with zero friends" — the cold-start segment nothing else
// reaches (doc §17.5).
//
// RPCs
//   ivx_league_get — auto-enrolls the caller into this week's pool for their
//     tier (first call of the week) and returns live standings.
//
// ROLLOVER: weeklyLeagueTick() from ivx_social_maintenance_tick — idempotent
// per ISO week via conditional-create marker. It ranks LAST week's pools
// using last week's stats rows (safe: the lazy weekly reset in player_stats
// preserves old values until the user next plays) and writes each member's
// new tier + promotion/demotion notification (via the fan-out queue).
//
// FLAG-GATED: app registry feature "leagues" (default OFF) — ships dark,
// one Console write turns it on per app (doc §19.9).
//
// STORAGE (collection ivx_leagues, system-owned)
//   pool_{week}_{tier}_{n}   { members: [userId...], week, tier, n }
//   poolidx_{week}_{tier}    { openPool: n }        (assignment cursor)
//   member_{userId}          { tier, week, poolKey } (current placement)
//   roll_marker_{week}       rollover idempotency marker

namespace SocialLeagues {

  var COLLECTION  = "ivx_leagues";
  var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
  var POOL_SIZE   = 30;
  var PROMOTE_N   = 10;   // top 10 promote
  var DEMOTE_N    = 5;    // bottom 5 demote
  var TIERS = ["bronze", "silver", "gold", "sapphire", "ruby", "emerald", "amethyst", "pearl", "obsidian", "legend"];

  function isoWeek(d: Date): string {
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dayNum = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dayNum + 3);
    var firstThursday = t.getTime();
    t.setUTCMonth(0, 1);
    if (t.getUTCDay() !== 4) t.setUTCMonth(0, 1 + ((4 - t.getUTCDay()) + 7) % 7);
    var week = 1 + Math.ceil((firstThursday - t.getTime()) / 604800000);
    return d.getUTCFullYear() + "-W" + (week < 10 ? "0" + week : week);
  }

  function prevIsoWeek(): string {
    return isoWeek(new Date(Date.now() - 7 * 86400000));
  }

  function readSys(nk: nkruntime.Nakama, key: string): { value: any; version: string } | null {
    try {
      var rows = nk.storageRead([{ collection: COLLECTION, key: key, userId: SYSTEM_USER }]);
      if (rows && rows.length > 0 && rows[0] && rows[0].value) {
        return { value: rows[0].value, version: rows[0].version || "" };
      }
    } catch (_) {}
    return null;
  }

  function writeSys(nk: nkruntime.Nakama, key: string, value: any, version?: string): void {
    var req: any = { collection: COLLECTION, key: key, userId: SYSTEM_USER, value: value, permissionRead: 2, permissionWrite: 0 };
    if (version !== undefined) req.version = version;
    nk.storageWrite([req]);
  }

  function tierIndex(tier: string): number {
    for (var i = 0; i < TIERS.length; i++) { if (TIERS[i] === tier) return i; }
    return 0;
  }

  /** Assign a user to this week's open pool in their tier (OCC append, retried). */
  function enroll(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, week: string, tier: string): string {
    for (var attempt = 0; attempt < 3; attempt++) {
      var idxKey = "poolidx_" + week + "_" + tier;
      var idx = readSys(nk, idxKey);
      var n = idx ? (idx.value.openPool || 0) : 0;

      var poolKey = "pool_" + week + "_" + tier + "_" + n;
      var pool = readSys(nk, poolKey);
      var members: string[] = pool ? (pool.value.members || []) : [];

      // Already in? (idempotency under retry)
      for (var m = 0; m < members.length; m++) { if (members[m] === userId) return poolKey; }

      if (members.length >= POOL_SIZE) {
        // Pool full — advance the cursor and retry with the next pool.
        try { writeSys(nk, idxKey, { openPool: n + 1 }, idx ? idx.version : "*"); } catch (_) {}
        continue;
      }

      members.push(userId);
      try {
        writeSys(nk, poolKey, { week: week, tier: tier, n: n, members: members }, pool ? pool.version : "*");
        writeSys(nk, "member_" + userId, { userId: userId, tier: tier, week: week, poolKey: poolKey });
        return poolKey;
      } catch (occ) { /* clash — retry */ }
    }
    logger.warn("[Leagues] enroll contention for " + userId + " tier=" + tier);
    return "";
  }

  function rpcLeagueGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var gameId = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";

      if (typeof SocialAppRegistry !== "undefined" && SocialAppRegistry.featureEnabled &&
          !SocialAppRegistry.featureEnabled(nk, gameId, "leagues")) {
        return RpcHelpers.errorResponse("Leagues are not enabled yet", 404);
      }

      var week = isoWeek(new Date());

      // Current placement (tier survives across weeks; pool is per-week).
      var member = readSys(nk, "member_" + userId);
      var tier = (member && member.value.tier) ? member.value.tier : TIERS[0];
      var poolKey = (member && member.value.week === week) ? member.value.poolKey : "";
      if (!poolKey) {
        poolKey = enroll(nk, logger, userId, week, tier);
        if (!poolKey) return RpcHelpers.errorResponse("League enrollment busy — try again");
      }

      var pool = readSys(nk, poolKey);
      var members: string[] = pool ? (pool.value.members || []) : [userId];

      // Live standings = this week's XP from player stats (one batched read).
      var statsMap: { [id: string]: any } = {};
      if (typeof SocialPlayerStats !== "undefined" && SocialPlayerStats.loadStatsMap) {
        statsMap = SocialPlayerStats.loadStatsMap(nk, gameId, members);
      }
      var names: { [id: string]: { name: string; avatar: string } } = {};
      try {
        var users = nk.usersGetId(members);
        if (users) {
          for (var u = 0; u < users.length; u++) {
            var usr: any = users[u];
            if (usr && usr.userId) names[usr.userId] = { name: usr.displayName || usr.username || "", avatar: usr.avatarUrl || "" };
          }
        }
      } catch (_) {}

      var standings: any[] = [];
      for (var i = 0; i < members.length; i++) {
        var mid = members[i];
        standings.push({
          userId: mid,
          displayName: (names[mid] && names[mid].name) || "",
          avatarUrl: (names[mid] && names[mid].avatar) || "",
          xpThisWeek: (statsMap[mid] && statsMap[mid].xpThisWeek) || 0,
          isMe: mid === userId
        });
      }
      standings.sort(function (a, b) { return b.xpThisWeek - a.xpThisWeek; });
      var myRank = 0;
      for (var r = 0; r < standings.length; r++) {
        standings[r].rank = r + 1;
        if (standings[r].isMe) myRank = r + 1;
      }

      return RpcHelpers.successResponse({
        week: week, tier: tier, tierIndex: tierIndex(tier), tiers: TIERS,
        poolSize: standings.length, myRank: myRank,
        promoteCount: PROMOTE_N, demoteCount: DEMOTE_N,
        standings: standings
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to load league");
    }
  }

  /** Weekly rollover — promotions/demotions for LAST week's pools. */
  export function weeklyLeagueTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any {
    var lastWeek = prevIsoWeek();
    var markerKey = "roll_marker_" + lastWeek;
    if (readSys(nk, markerKey)) return { skipped: true, week: lastWeek };
    try {
      writeSys(nk, markerKey, { week: lastWeek, startedAt: new Date().toISOString() }, "*");
    } catch (race) { return { skipped: true, week: lastWeek, reason: "marker_race" }; }

    var processed = 0, promoted = 0, demoted = 0;
    for (var t = 0; t < TIERS.length; t++) {
      var tier = TIERS[t];
      // Sweep pools 0..N until a gap.
      for (var n = 0; n < 1000; n++) {
        var pool = readSys(nk, "pool_" + lastWeek + "_" + tier + "_" + n);
        if (!pool) break;
        var members: string[] = pool.value.members || [];
        if (members.length === 0) continue;

        // Last week's stats rows still carry last week's numbers until each
        // user plays again (lazy reset) — rank by them.
        var xp: { [id: string]: number } = {};
        try {
          var reads: nkruntime.StorageReadRequest[] = [];
          for (var m = 0; m < members.length; m++) {
            reads.push({ collection: "ivx_game_player_stats", key: "quizverse_" + members[m], userId: members[m] });
          }
          var rows = nk.storageRead(reads);
          if (rows) {
            for (var rr = 0; rr < rows.length; rr++) {
              var row = rows[rr];
              if (row && row.value && row.userId && row.value.weekId === lastWeek) {
                xp[row.userId] = row.value.xpThisWeek || 0;
              }
            }
          }
        } catch (_) {}

        var ranked = members.slice(0);
        ranked.sort(function (a, b) { return (xp[b] || 0) - (xp[a] || 0); });

        for (var k = 0; k < ranked.length; k++) {
          var uid = ranked[k];
          var newTier = tier;
          var moved = "";
          if (k < PROMOTE_N && (xp[uid] || 0) > 0 && t < TIERS.length - 1) {
            newTier = TIERS[t + 1]; moved = "promoted"; promoted++;
          } else if (k >= ranked.length - DEMOTE_N && t > 0 && ranked.length > DEMOTE_N) {
            newTier = TIERS[t - 1]; moved = "demoted"; demoted++;
          }
          try {
            writeSys(nk, "member_" + uid, { userId: uid, tier: newTier, week: "", poolKey: "" });
          } catch (_) {}
          if (moved && typeof FanoutQueue !== "undefined" && FanoutQueue.enqueue) {
            FanoutQueue.enqueue(nk, logger, [{
              targetUserId: uid, eventType: "league_" + moved,
              titleKey: "", bodyKey: "", vars: {},
              data: { screen: "leagues", type: moved, newTier: newTier },
              inAppSubject: "league_" + moved, inAppCode: 32,
              inAppContent: { type: "league_" + moved, fromTier: tier, newTier: newTier, week: lastWeek, rank: k + 1 }
            }]);
          }
          processed++;
        }
      }
    }
    logger.info("[Leagues] rollover " + lastWeek + ": processed=" + processed + " up=" + promoted + " down=" + demoted);
    return { week: lastWeek, processed: processed, promoted: promoted, demoted: demoted };
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_league_get", rpcLeagueGet);
  }
}
