// duo_quests.ts — Duo Quests revival (Q-06, doc §17.5 / §F.2 rank #1).
//
// Revives the dead social_v2.js rpcDailyDuoCreate/rpcDailyDuoStatus handlers
// (never registered — 100% unreachable) as a hardened Duolingo-Friends-Quests
// mechanic: two players share a joint goal with a deadline; completing quizzes
// credits each side SERVER-side; both done → both rewarded.
//
// RPCs
//   ivx_duo_quest_create   — manual pairing: invite one mutual friend
//   ivx_duo_quest_status   — my active duo(s) + progress
//   ivx_duo_quest_accept   — partner accepts the invite (activates the duo)
//
// WEEKLY RANDOM PAIRING (the Duolingo cold-start trick — §17.5):
//   weeklyPairingTick() is invoked from ivx_social_maintenance_tick. Once per
//   ISO week (idempotent via a system marker row) it pairs users who were
//   active in the last 7 days (ivx_presence_v2 rows) into auto-accepted duos
//   and notifies both. Random partner ≠ requires existing friendship — this
//   is deliberately a cold-start tool, not just a retention tool.
//
// ANTI-CHEAT: progress is NEVER client-claimed. creditQuizCompletion() is
// called from the server-side quiz submit flow only — the dead code's design
// (and the friend-quest PlayerPrefs exploit in §18.1) accepted client claims;
// this does not.
//
// STORAGE
//   ivx_duo_quests / duo_{id}            system-owned canonical row
//   ivx_duo_quests / idx_{userId}_{id}   thin per-user index (owner=user)
//   ivx_duo_quests / weekly_marker_{isoWeek}  pairing idempotency marker

namespace DuoQuests {

  var COLLECTION   = "ivx_duo_quests";
  var SYSTEM_USER  = "00000000-0000-0000-0000-000000000000";
  var STATE_FRIEND = 0;
  var DUO_DURATION_DAYS = 5;      // §17.5: 5-day joint goal
  var DUO_GOAL_QUIZZES  = 5;      // "complete 5 quizzes together" (per side: any mix)
  var REWARD_COINS      = 100;    // §F.6 free-tier reward, each
  var NOTIF_CODE_DUO    = 31;     // social_nudge range (doc §9.3)
  var MAX_ACTIVE_PER_USER = 3;

  function isoWeek(d: Date): string {
    // ISO-8601 week id, e.g. "2026-W28" — stable pairing idempotency key.
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dayNum = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dayNum + 3);
    var firstThursday = t.getTime();
    t.setUTCMonth(0, 1);
    if (t.getUTCDay() !== 4) t.setUTCMonth(0, 1 + ((4 - t.getUTCDay()) + 7) % 7);
    var week = 1 + Math.ceil((firstThursday - t.getTime()) / 604800000);
    return d.getUTCFullYear() + "-W" + (week < 10 ? "0" + week : week);
  }

  function newDuoId(): string {
    return "duo_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1679616).toString(36);
  }

  function readDuo(nk: nkruntime.Nakama, duoId: string): { value: any; version: string } | null {
    try {
      var rows = nk.storageRead([{ collection: COLLECTION, key: duoId, userId: SYSTEM_USER }]);
      if (rows && rows.length > 0 && rows[0] && rows[0].value) {
        return { value: rows[0].value, version: rows[0].version || "" };
      }
    } catch (_) {}
    return null;
  }

  function writeDuo(nk: nkruntime.Nakama, duo: any, version?: string): void {
    var req: any = {
      collection: COLLECTION, key: duo.duoId, userId: SYSTEM_USER,
      value: duo, permissionRead: 2, permissionWrite: 0
    };
    if (version) req.version = version;
    nk.storageWrite([req]);
  }

  function writeUserIndex(nk: nkruntime.Nakama, userId: string, duoId: string, expiresAt: string): void {
    try {
      nk.storageWrite([{
        collection: COLLECTION, key: "idx_" + userId + "_" + duoId, userId: userId,
        value: { duoId: duoId, expiresAt: expiresAt }, permissionRead: 1, permissionWrite: 0
      }]);
    } catch (_) {}
  }

  function buildDuo(gameId: string, aId: string, aName: string, bId: string, bName: string, status: string, source: string): any {
    var nowMs = Date.now();
    return {
      duoId: newDuoId(), gameId: gameId,
      playerA: aId, playerAName: aName || "",
      playerB: bId, playerBName: bName || "",
      goalQuizzes: DUO_GOAL_QUIZZES,
      progressA: 0, progressB: 0,
      status: status,                 // "invited" | "active" | "completed" | "expired"
      source: source,                 // "manual" | "weekly_pairing"
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + DUO_DURATION_DAYS * 86400000).toISOString(),
      rewardCoins: REWARD_COINS,
      rewarded: false
    };
  }

  function notifyDuo(nk: nkruntime.Nakama, logger: nkruntime.Logger, targetId: string, senderId: string, subject: string, content: any): void {
    try {
      content.type = subject;
      content.code = NOTIF_CODE_DUO;
      nk.notificationsSend([{
        userId: targetId, subject: subject, content: content,
        code: NOTIF_CODE_DUO, senderId: senderId || undefined, persistent: true
      }]);
    } catch (e: any) {
      logger.warn("[DuoQuests] notify failed (non-fatal): " + (e && e.message));
    }

    // Device push via the fan-out queue (AP-008: never inline). Offline
    // players are the entire point of duo nudges — in-app alone is not enough.
    try {
      if (typeof FanoutQueue === "undefined" || !FanoutQueue.enqueue) return;
      var pushData: any = { eventType: "duo_quest", screen: "duo_quest", type: subject, duoId: content.duoId || "" };
      if (subject === "duo_quest_invite" || subject === "duo_quest_paired") {
        FanoutQueue.enqueue(nk, logger, [{
          targetUserId: targetId, eventType: "duo_quest",
          titleKey: "duo_paired_title", bodyKey: "duo_paired_body",
          vars: { name: content.partnerName || content.fromName || "a player" }, data: pushData
        }]);
      } else if (subject === "duo_quest_completed") {
        FanoutQueue.enqueue(nk, logger, [{
          targetUserId: targetId, eventType: "duo_quest",
          titleKey: "duo_done_title", bodyKey: "duo_done_body",
          vars: { coins: String(content.rewardCoins || "") }, data: pushData
        }]);
      }
      // duo_quest_accepted: in-app only — acceptance implies the other side
      // is actively playing; a push would burn the daily budget (AP-001).
    } catch (pe: any) {
      logger.warn("[DuoQuests] push enqueue failed (non-fatal): " + (pe && pe.message));
    }
  }

  function activeDuosFor(nk: nkruntime.Nakama, userId: string): any[] {
    var out: any[] = [];
    try {
      var res = nk.storageList(userId, COLLECTION, 50, undefined as any);
      var objs: any[] = (res && (res as any).objects) ? (res as any).objects : [];
      var now = Date.now();
      for (var i = 0; i < objs.length; i++) {
        var idx: any = objs[i] && objs[i].value;
        if (!idx || !idx.duoId) continue;
        if (idx.expiresAt && Date.parse(idx.expiresAt) < now) continue;
        var found = readDuo(nk, idx.duoId);
        if (found && (found.value.status === "active" || found.value.status === "invited")) {
          out.push(found.value);
        }
      }
    } catch (_) {}
    return out;
  }

  function areFriends(nk: nkruntime.Nakama, a: string, b: string): boolean {
    try {
      var page = nk.friendsList(a, 1000, STATE_FRIEND, null as any);
      if (page && page.friends) {
        for (var i = 0; i < page.friends.length; i++) {
          var fr: any = page.friends[i];
          if (fr && fr.user && fr.user.id === b) return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function displayName(nk: nkruntime.Nakama, userId: string, fallback: string): string {
    try {
      var users = nk.usersGetId([userId]);
      if (users && users.length > 0 && users[0]) {
        return users[0].displayName || users[0].username || fallback;
      }
    } catch (_) {}
    return fallback;
  }

  // ── RPC: ivx_duo_quest_create ─────────────────────────────────────────────
  function rpcCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var partnerId = data.partnerUserId || data.partner_user_id;
      var gameId = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";

      if (!partnerId || typeof partnerId !== "string") return RpcHelpers.errorResponse("partnerUserId is required");
      if (partnerId === userId) return RpcHelpers.errorResponse("You cannot duo with yourself");
      if (!areFriends(nk, userId, partnerId)) return RpcHelpers.errorResponse("You can only invite mutual friends to a Duo Quest");

      // One active/invited duo per pair; cap per user.
      var mine = activeDuosFor(nk, userId);
      if (mine.length >= MAX_ACTIVE_PER_USER) return RpcHelpers.errorResponse("You already have " + MAX_ACTIVE_PER_USER + " active Duo Quests");
      for (var i = 0; i < mine.length; i++) {
        var d = mine[i];
        if ((d.playerA === userId && d.playerB === partnerId) || (d.playerB === userId && d.playerA === partnerId)) {
          return RpcHelpers.successResponse({ duo: d, alreadyExists: true });
        }
      }

      var myName = displayName(nk, userId, ctx.username || "");
      var duo = buildDuo(gameId, userId, myName, partnerId, displayName(nk, partnerId, ""), "invited", "manual");
      writeDuo(nk, duo);
      writeUserIndex(nk, userId, duo.duoId, duo.expiresAt);
      writeUserIndex(nk, partnerId, duo.duoId, duo.expiresAt);
      notifyDuo(nk, logger, partnerId, userId, "duo_quest_invite",
        { duoId: duo.duoId, gameId: gameId, fromUserId: userId, fromName: myName, goalQuizzes: duo.goalQuizzes, expiresAt: duo.expiresAt });

      return RpcHelpers.successResponse({ duo: duo });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to create duo quest");
    }
  }

  // ── RPC: ivx_duo_quest_accept ─────────────────────────────────────────────
  function rpcAccept(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      if (!data.duoId || typeof data.duoId !== "string") return RpcHelpers.errorResponse("duoId is required");

      var found = readDuo(nk, data.duoId);
      if (!found) return RpcHelpers.errorResponse("Duo quest not found");
      var duo = found.value;
      if (duo.playerB !== userId) return RpcHelpers.errorResponse("This invite is not for you");
      if (duo.status === "active") return RpcHelpers.successResponse({ duo: duo, alreadyActive: true });
      if (duo.status !== "invited") return RpcHelpers.errorResponse("This duo quest is " + duo.status);
      if (Date.parse(duo.expiresAt) < Date.now()) return RpcHelpers.errorResponse("This duo quest has expired");

      duo.status = "active";
      duo.acceptedAt = new Date().toISOString();
      writeDuo(nk, duo, found.version);
      notifyDuo(nk, logger, duo.playerA, userId, "duo_quest_accepted",
        { duoId: duo.duoId, byUserId: userId, byName: duo.playerBName });
      return RpcHelpers.successResponse({ duo: duo });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to accept duo quest");
    }
  }

  // ── RPC: ivx_duo_quest_status ─────────────────────────────────────────────
  function rpcStatus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var duos = activeDuosFor(nk, userId);
      var shaped: any[] = [];
      for (var i = 0; i < duos.length; i++) {
        var d = duos[i];
        var mine = (d.playerA === userId);
        shaped.push({
          duoId: d.duoId, gameId: d.gameId, status: d.status, source: d.source,
          partnerUserId: mine ? d.playerB : d.playerA,
          partnerName:   mine ? d.playerBName : d.playerAName,
          goalQuizzes:   d.goalQuizzes,
          myProgress:      mine ? d.progressA : d.progressB,
          partnerProgress: mine ? d.progressB : d.progressA,
          expiresAt: d.expiresAt, rewardCoins: d.rewardCoins,
          bothCompleted: (d.progressA >= d.goalQuizzes && d.progressB >= d.goalQuizzes)
        });
      }
      return RpcHelpers.successResponse({ duos: shaped, count: shaped.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to read duo status");
    }
  }

  // ── SERVER-side progress credit — called from quiz submit flow only ──────
  export function creditQuizCompletion(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, gameId: string): void {
    try {
      var duos = activeDuosFor(nk, userId);
      for (var i = 0; i < duos.length; i++) {
        var d = duos[i];
        if (d.status !== "active" || d.gameId !== gameId) continue;
        // Re-read with version for OCC (ML-008 pattern: retry once on clash).
        for (var attempt = 0; attempt < 2; attempt++) {
          var found = readDuo(nk, d.duoId);
          if (!found || found.value.status !== "active") break;
          var duo = found.value;
          if (duo.playerA === userId) duo.progressA = (duo.progressA || 0) + 1;
          else if (duo.playerB === userId) duo.progressB = (duo.progressB || 0) + 1;
          else break;

          var done = duo.progressA >= duo.goalQuizzes && duo.progressB >= duo.goalQuizzes;
          if (done && !duo.rewarded) {
            duo.status = "completed";
            duo.rewarded = true;
            duo.completedAt = new Date().toISOString();
          }
          try {
            writeDuo(nk, duo, found.version);
          } catch (occErr) {
            if (attempt === 0) continue; // version clash — retry once
            break;
          }
          if (done && duo.rewarded) {
            // Reward BOTH sides exactly once (rewarded flag flipped in the
            // same OCC write that completed the duo).
            try { nk.walletUpdate(duo.playerA, { coins: duo.rewardCoins }, { source: "duo_quest", duoId: duo.duoId }, true); } catch (_) {}
            try { nk.walletUpdate(duo.playerB, { coins: duo.rewardCoins }, { source: "duo_quest", duoId: duo.duoId }, true); } catch (_) {}
            notifyDuo(nk, logger, duo.playerA, duo.playerB, "duo_quest_completed", { duoId: duo.duoId, rewardCoins: duo.rewardCoins });
            notifyDuo(nk, logger, duo.playerB, duo.playerA, "duo_quest_completed", { duoId: duo.duoId, rewardCoins: duo.rewardCoins });
          }
          break;
        }
      }
    } catch (e: any) {
      if (logger && logger.warn) logger.warn("[DuoQuests] credit failed (non-fatal): " + (e && e.message));
    }
  }

  // ── Weekly random pairing — invoked from ivx_social_maintenance_tick ─────
  export function weeklyPairingTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any {
    var week = isoWeek(new Date());
    var markerKey = "weekly_marker_" + week;
    try {
      var marker = nk.storageRead([{ collection: COLLECTION, key: markerKey, userId: SYSTEM_USER }]);
      if (marker && marker.length > 0 && marker[0] && marker[0].value) {
        return { skipped: true, week: week };
      }
    } catch (_) {}

    // Claim the marker FIRST (conditional create) so concurrent ticks can't
    // double-pair; the loser of the race gets a version conflict and skips.
    try {
      nk.storageWrite([{
        collection: COLLECTION, key: markerKey, userId: SYSTEM_USER,
        value: { week: week, startedAt: new Date().toISOString() },
        permissionRead: 0, permissionWrite: 0, version: "*"
      }]);
    } catch (raceErr) {
      return { skipped: true, week: week, reason: "marker_race" };
    }

    // Recently-active users (presence v2 heartbeats in last 7 days), capped.
    var candidates: string[] = [];
    try {
      var rows: any = nk.sqlQuery(
        "SELECT DISTINCT user_id FROM storage " +
        "WHERE collection = 'ivx_presence_v2' AND update_time > now() - INTERVAL '7 days' " +
        "LIMIT 500",
        []
      );
      if (rows) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i] && rows[i].user_id) candidates.push(String(rows[i].user_id));
        }
      }
    } catch (e: any) {
      logger.warn("[DuoQuests] candidate query failed: " + (e && e.message));
    }

    // Fisher-Yates shuffle, then pair adjacent.
    for (var s = candidates.length - 1; s > 0; s--) {
      var j = Math.floor(Math.random() * (s + 1));
      var tmp = candidates[s]; candidates[s] = candidates[j]; candidates[j] = tmp;
    }
    var paired = 0;
    for (var p = 0; p + 1 < candidates.length; p += 2) {
      var a = candidates[p], b = candidates[p + 1];
      try {
        var duo = buildDuo("quizverse", a, displayName(nk, a, ""), b, displayName(nk, b, ""), "active", "weekly_pairing");
        writeDuo(nk, duo);
        writeUserIndex(nk, a, duo.duoId, duo.expiresAt);
        writeUserIndex(nk, b, duo.duoId, duo.expiresAt);
        notifyDuo(nk, logger, a, b, "duo_quest_paired", { duoId: duo.duoId, partnerName: duo.playerBName, goalQuizzes: duo.goalQuizzes, expiresAt: duo.expiresAt });
        notifyDuo(nk, logger, b, a, "duo_quest_paired", { duoId: duo.duoId, partnerName: duo.playerAName, goalQuizzes: duo.goalQuizzes, expiresAt: duo.expiresAt });
        paired++;
      } catch (pairErr: any) {
        logger.warn("[DuoQuests] pairing failed for " + a + "/" + b + ": " + (pairErr && pairErr.message));
      }
    }
    logger.info("[DuoQuests] weekly pairing " + week + ": " + paired + " duos from " + candidates.length + " candidates");
    return { week: week, candidates: candidates.length, paired: paired };
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_duo_quest_create", rpcCreate);
    initializer.registerRpc("ivx_duo_quest_accept", rpcAccept);
    initializer.registerRpc("ivx_duo_quest_status", rpcStatus);
  }
}
