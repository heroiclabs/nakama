namespace SatoriWeeklyChampions {

  // ============================================================
  //  QuizVerse Weekly Champions (Path A — automated live events)
  // ============================================================
  //
  //  Every Sunday an n8n cron calls `weekly_champions_calculate` per region.
  //  Winners are computed from three server-side data sources plus one
  //  externally-supplied award:
  //
  //    Champion / Runner-Ups  → leaderboard `weekly_total_score_<region>`
  //                             (INCREMENTAL, resets Monday 00:00 UTC —
  //                             fed by creator_event_submit via recordPlay)
  //    Streak King            → storage `player_streaks` (per-user record,
  //                             updated on every submit)
  //    Lucky Draw             → storage `daily_activity` (per-user per-week
  //                             record; qualification: played 5+ days)
  //    Top Guesser            → passed in the calculate payload by n8n
  //                             (Content Factory scans Part 1 YouTube
  //                             comments; Nakama has no YouTube access)
  //
  //  Gift-card awards are queued as `prize_fulfillments` rows (same queue the
  //  creator-event claim/backfill flow uses, source="weekly_champions") and
  //  the Top-20 XUT bonus is credited directly. The whole calculation is
  //  idempotent per (weekKey, region).

  var COLLECTION = "weekly_champions";
  var STREAKS_COLLECTION = "player_streaks";
  var ACTIVITY_COLLECTION = "daily_activity";
  var LB_PREFIX = "weekly_total_score_";
  var LB_RESET_MONDAY_UTC = "0 0 * * 1";
  var TOP20_XUT_BONUS = 1000;
  var LUCKY_DRAW_MIN_DAYS = 5;

  interface StreakRecord {
    current: number;
    longest: number;
    lastDayKey: string;   // "2026-07-06" (UTC)
    updatedAt: number;
  }

  interface ActivityRecord {
    weekKey: string;                      // "2026-07-06" (Monday of the week, UTC)
    days: { [dayKey: string]: boolean };
    count: number;
    updatedAt: number;
  }

  interface WeeklyAwardPrize {
    prize: string;        // "Flipkart ₹2,000"
    brand: string;        // "flipkart"
    value: number;
    currency: string;     // "INR" | "USD"
    fulfillment: string;  // "gyftr" | "tremendous" | "manual" | "nakama"
  }

  interface WeeklyAwardWinner {
    award: string;        // "champion" | "runner_up_1" | "runner_up_2" | "top_guesser" | "streak_king" | "lucky_draw" | "top_20"
    userId: string;
    username: string;
    metric: number;       // score / streak length / correct-guess count / days played
    prize: WeeklyAwardPrize;
    fulfillmentKey?: string;
    youtubeHandle?: string;
  }

  interface WeeklyChampionsRecord {
    weekKey: string;
    region: string;
    calculatedAt: number;
    winners: WeeklyAwardWinner[];
    top20XutUserIds: string[];
    status: string;       // "calculated"
  }

  // ---- Time helpers ----

  function dayKeyUtc(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function addDays(dayKey: string, delta: number): string {
    var d = new Date(dayKey + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  /** Monday (UTC) of the week containing `ms` — the weekly leaderboard reset anchor. */
  export function weekKeyUtc(ms: number): string {
    var d = new Date(ms);
    var dow = d.getUTCDay(); // 0=Sun..6=Sat
    var deltaToMonday = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + deltaToMonday);
    return d.toISOString().slice(0, 10);
  }

  function normalizeRegion(region: any): string {
    var r = String(region || "global").toLowerCase();
    if (r !== "india" && r !== "usa" && r !== "global") r = "global";
    return r;
  }

  function leaderboardId(region: string): string {
    return LB_PREFIX + normalizeRegion(region);
  }

  var _lbEnsured: { [id: string]: boolean } = {};

  function ensureWeeklyLeaderboard(nk: nkruntime.Nakama, logger: nkruntime.Logger, region: string): string {
    var id = leaderboardId(region);
    if (_lbEnsured[id]) return id;
    try {
      nk.leaderboardCreate(
        id,
        true,
        nkruntime.SortOrder.DESCENDING,
        nkruntime.Operator.INCREMENTAL,
        LB_RESET_MONDAY_UTC,
        { scope: "weekly_champions", region: normalizeRegion(region) }
      );
      _lbEnsured[id] = true;
    } catch (err: any) {
      var msg = (err && err.message) ? err.message : String(err);
      if (/exist/i.test(msg)) {
        _lbEnsured[id] = true;
      } else {
        logger.warn("[WeeklyChampions] leaderboardCreate failed for %s: %s", id, msg);
      }
    }
    return id;
  }

  // ============================================================
  //  recordPlay — called from creator_event_submit (best-effort)
  // ============================================================

  export function recordPlay(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    username: string,
    region: string,
    score: number
  ): void {
    var nowMs = Date.now();
    var nowSec = Math.floor(nowMs / 1000);
    var today = dayKeyUtc(nowMs);
    var week = weekKeyUtc(nowMs);

    // 1. Weekly total-score leaderboard (regional + global rollup)
    var points = Math.max(0, Math.floor(score));
    var boards = [ensureWeeklyLeaderboard(nk, logger, region)];
    if (normalizeRegion(region) !== "global") boards.push(ensureWeeklyLeaderboard(nk, logger, "global"));
    for (var bi = 0; bi < boards.length; bi++) {
      try {
        nk.leaderboardRecordWrite(boards[bi], userId, username || "", points, 0);
      } catch (lbErr: any) {
        logger.warn("[WeeklyChampions] weekly leaderboard write failed (%s): %s", boards[bi], lbErr.message || String(lbErr));
      }
    }

    // 2. Streak record
    try {
      var streak = Storage.readJson<StreakRecord>(nk, STREAKS_COLLECTION, "streak", userId);
      if (!streak) streak = { current: 0, longest: 0, lastDayKey: "", updatedAt: 0 };
      if (streak.lastDayKey !== today) {
        if (streak.lastDayKey === addDays(today, -1)) {
          streak.current = (streak.current || 0) + 1;
        } else {
          streak.current = 1;
        }
        if (streak.current > (streak.longest || 0)) streak.longest = streak.current;
        streak.lastDayKey = today;
        streak.updatedAt = nowSec;
        Storage.writeJson(nk, STREAKS_COLLECTION, "streak", userId, streak,
          2 as nkruntime.ReadPermissionValues, 0 as nkruntime.WritePermissionValues);
      }
    } catch (stErr: any) {
      logger.warn("[WeeklyChampions] streak update failed for %s: %s", userId, stErr.message || String(stErr));
    }

    // 3. Weekly activity record (Lucky Draw qualification)
    try {
      var activityKey = "week_" + week;
      var activity = Storage.readJson<ActivityRecord>(nk, ACTIVITY_COLLECTION, activityKey, userId);
      if (!activity || activity.weekKey !== week) {
        activity = { weekKey: week, days: {}, count: 0, updatedAt: 0 };
      }
      if (!activity.days[today]) {
        activity.days[today] = true;
        activity.count = Object.keys(activity.days).length;
        activity.updatedAt = nowSec;
        Storage.writeJson(nk, ACTIVITY_COLLECTION, activityKey, userId, activity,
          2 as nkruntime.ReadPermissionValues, 0 as nkruntime.WritePermissionValues);
      }
    } catch (actErr: any) {
      logger.warn("[WeeklyChampions] activity update failed for %s: %s", userId, actErr.message || String(actErr));
    }
  }

  // ============================================================
  //  Default prize presets (from the v5.0 consolidated plan)
  // ============================================================

  function defaultPrizes(region: string): { [award: string]: WeeklyAwardPrize } {
    if (normalizeRegion(region) === "india") {
      return {
        champion:    { prize: "Flipkart ₹2,000",             brand: "flipkart",    value: 2000, currency: "INR", fulfillment: "gyftr" },
        runner_up_1: { prize: "Swiggy ONE 3-month ₹1,500",   brand: "swiggy",      value: 1500, currency: "INR", fulfillment: "gyftr" },
        runner_up_2: { prize: "Myntra ₹1,000",               brand: "myntra",      value: 1000, currency: "INR", fulfillment: "gyftr" },
        top_guesser: { prize: "BookMyShow ₹750",             brand: "bookmyshow",  value: 750,  currency: "INR", fulfillment: "gyftr" },
        streak_king: { prize: "Hotstar Premium 3-month ₹500", brand: "hotstar",    value: 500,  currency: "INR", fulfillment: "gyftr" },
        lucky_draw:  { prize: "PhonePe ₹250 cashback",       brand: "phonepe",     value: 250,  currency: "INR", fulfillment: "gyftr" },
      };
    }
    // USA defaults double as the global preset.
    return {
      champion:    { prize: "Amazon US $30",                brand: "amazon_us",  value: 30, currency: "USD", fulfillment: "tremendous" },
      runner_up_1: { prize: "Uber Eats $20",                brand: "uber_eats",  value: 20, currency: "USD", fulfillment: "tremendous" },
      runner_up_2: { prize: "Spotify Premium 3-month $15",  brand: "spotify",    value: 15, currency: "USD", fulfillment: "tremendous" },
      top_guesser: { prize: "Netflix $15",                  brand: "netflix",    value: 15, currency: "USD", fulfillment: "tremendous" },
      streak_king: { prize: "Chipotle $10",                 brand: "chipotle",   value: 10, currency: "USD", fulfillment: "tremendous" },
      lucky_draw:  { prize: "Starbucks $10",                brand: "starbucks",  value: 10, currency: "USD", fulfillment: "tremendous" },
    };
  }

  // ---- Storage helpers ----

  function recordKey(weekKey: string, region: string): string {
    return "week_" + weekKey + "_" + normalizeRegion(region);
  }

  function getRecord(nk: nkruntime.Nakama, weekKey: string, region: string): WeeklyChampionsRecord | null {
    return Storage.readSystemJson<WeeklyChampionsRecord>(nk, COLLECTION, recordKey(weekKey, region));
  }

  function saveRecord(nk: nkruntime.Nakama, record: WeeklyChampionsRecord): void {
    Storage.writeSystemJson(nk, COLLECTION, recordKey(record.weekKey, record.region), record);
  }

  // ---- Winner discovery ----

  function scanStreakKing(nk: nkruntime.Nakama, logger: nkruntime.Logger, weekKey: string): { userId: string; streak: number } | null {
    // Eligible: streak still alive this week (lastDayKey within the target week).
    var weekDays: { [d: string]: boolean } = {};
    for (var i = 0; i < 7; i++) weekDays[addDays(weekKey, i)] = true;

    var best: { userId: string; streak: number } | null = null;
    var cursor = "";
    var pages = 0;
    do {
      var page: any;
      try {
        page = nk.storageList(null, STREAKS_COLLECTION, 100, cursor);
      } catch (err: any) {
        logger.warn("[WeeklyChampions] player_streaks list failed: %s", err.message || String(err));
        break;
      }
      var objs = (page && page.objects) || [];
      for (var oi = 0; oi < objs.length; oi++) {
        var o = objs[oi];
        var v = o && (o.value as StreakRecord);
        if (!v || !o.userId) continue;
        if (!weekDays[v.lastDayKey || ""]) continue;
        var current = v.current || 0;
        if (!best || current > best.streak) {
          best = { userId: o.userId, streak: current };
        }
      }
      cursor = (page && page.cursor) || "";
      pages++;
    } while (cursor && pages < 20);
    return best;
  }

  function scanLuckyDraw(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    weekKey: string,
    minDays: number,
    excludeUserIds: { [uid: string]: boolean }
  ): { userId: string; days: number; poolSize: number } | null {
    var activityKey = "week_" + weekKey;
    var eligible: { userId: string; days: number }[] = [];
    var cursor = "";
    var pages = 0;
    do {
      var page: any;
      try {
        page = nk.storageList(null, ACTIVITY_COLLECTION, 100, cursor);
      } catch (err: any) {
        logger.warn("[WeeklyChampions] daily_activity list failed: %s", err.message || String(err));
        break;
      }
      var objs = (page && page.objects) || [];
      for (var oi = 0; oi < objs.length; oi++) {
        var o = objs[oi];
        if (!o || o.key !== activityKey || !o.userId) continue;
        var v = o.value as ActivityRecord;
        if (!v || (v.count || 0) < minDays) continue;
        if (excludeUserIds[o.userId]) continue;
        eligible.push({ userId: o.userId, days: v.count || 0 });
      }
      cursor = (page && page.cursor) || "";
      pages++;
    } while (cursor && pages < 20);

    if (eligible.length === 0) return null;
    var pick = eligible[Math.floor(Math.random() * eligible.length)];
    return { userId: pick.userId, days: pick.days, poolSize: eligible.length };
  }

  function resolveUsernames(nk: nkruntime.Nakama, logger: nkruntime.Logger, userIds: string[]): { [uid: string]: string } {
    var out: { [uid: string]: string } = {};
    var unique: string[] = [];
    var seen: { [uid: string]: boolean } = {};
    for (var i = 0; i < userIds.length; i++) {
      var uid = userIds[i];
      if (uid && !seen[uid]) { seen[uid] = true; unique.push(uid); }
    }
    if (unique.length === 0) return out;
    try {
      var accts = nk.accountsGetId(unique);
      for (var ai = 0; ai < accts.length; ai++) {
        var u: any = accts[ai] && accts[ai].user;
        if (u && u.id) out[u.id] = u.username || "";
      }
    } catch (err: any) {
      logger.warn("[WeeklyChampions] username resolve failed: %s", err.message || String(err));
    }
    return out;
  }

  function queueGiftCardFulfillment(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    weekKey: string,
    region: string,
    winner: WeeklyAwardWinner,
    email: string
  ): string {
    var fKey = "weekly_" + weekKey + "_" + normalizeRegion(region) + ":" + winner.award + ":" + winner.userId;
    var existing = Storage.readSystemJson<any>(nk, "prize_fulfillments", fKey);
    if (!existing) {
      Storage.writeSystemJson(nk, "prize_fulfillments", fKey, {
        userId: winner.userId,
        eventId: "weekly_champions_" + weekKey + "_" + normalizeRegion(region),
        rank: 0,
        award: winner.award,
        giftCard: winner.prize,
        status: "pending",
        queuedAt: Math.floor(Date.now() / 1000),
        eventTitle: "Weekly Champions " + weekKey + " (" + normalizeRegion(region) + ")",
        region: normalizeRegion(region),
        source: "weekly_champions",
        email: email || "",
      });
      logger.info("[WeeklyChampions] queued fulfillment %s (%s → %s)", fKey, winner.award, winner.prize.prize);
    }
    return fKey;
  }

  function notifyWinner(nk: nkruntime.Nakama, logger: nkruntime.Logger, winner: WeeklyAwardWinner, weekKey: string): void {
    try {
      nk.notificationsSend([{
        userId: winner.userId,
        code: 1002,
        subject: "🏆 You're a QuizVerse Weekly Champion!",
        content: {
          type: "weekly_champions_award",
          award: winner.award,
          prize: winner.prize.prize,
          weekKey: weekKey,
          body: "You won " + winner.prize.prize + " (" + winner.award.replace(/_/g, " ") + ")! Open QuizVerse to claim.",
        },
        persistent: true,
      }]);
    } catch (err: any) {
      logger.warn("[WeeklyChampions] winner notification failed for %s: %s", winner.userId, err.message || String(err));
    }
  }

  // ============================================================
  //  RPCs
  // ============================================================

  /**
   * weekly_champions_calculate — system/admin only (n8n Sunday cron).
   *
   * Payload:
   *   {
   *     region: "india" | "usa" | "global",
   *     weekKey?: "YYYY-MM-DD",              // Monday anchor; defaults to current week
   *     topGuesser?: { userId?, youtubeHandle?, count? },  // from Content Factory comment scan
   *     minLuckyDrawDays?: number,           // default 5
   *     force?: boolean                       // recalculate even if a record exists
   *   }
   */
  function rpcCalculate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var region = normalizeRegion(data.region);
    var weekKey = data.weekKey ? String(data.weekKey) : weekKeyUtc(Date.now());
    var minDays = typeof data.minLuckyDrawDays === "number" ? Math.max(1, Math.floor(data.minLuckyDrawDays)) : LUCKY_DRAW_MIN_DAYS;

    var existing = getRecord(nk, weekKey, region);
    if (existing && !data.force) {
      return RpcHelpers.successResponse({ alreadyCalculated: true, record: existing });
    }

    var prizes = defaultPrizes(region);
    var winners: WeeklyAwardWinner[] = [];
    var takenUserIds: { [uid: string]: boolean } = {};

    // --- Champion + Runner-Ups from the weekly leaderboard ---
    var lbId = leaderboardId(region);
    var records: any[] = [];
    try {
      var lbResult = nk.leaderboardRecordsList(lbId, [], 20, "");
      records = (lbResult && lbResult.records) || [];
    } catch (lbErr: any) {
      logger.warn("[WeeklyChampions] leaderboard %s read failed (no plays this week?): %s", lbId, lbErr.message || String(lbErr));
    }

    var lbAwards = ["champion", "runner_up_1", "runner_up_2"];
    for (var r = 0; r < records.length && r < lbAwards.length; r++) {
      var rec = records[r];
      if (!rec || !rec.ownerId) continue;
      winners.push({
        award: lbAwards[r],
        userId: rec.ownerId,
        username: rec.username || "",
        metric: rec.score || 0,
        prize: prizes[lbAwards[r]],
      });
      takenUserIds[rec.ownerId] = true;
    }

    // --- Top Guesser (supplied by Content Factory via n8n) ---
    if (data.topGuesser && (data.topGuesser.userId || data.topGuesser.youtubeHandle)) {
      winners.push({
        award: "top_guesser",
        userId: String(data.topGuesser.userId || ""),
        username: "",
        metric: Math.floor(Number(data.topGuesser.count || 0)),
        prize: prizes["top_guesser"],
        youtubeHandle: data.topGuesser.youtubeHandle ? String(data.topGuesser.youtubeHandle) : undefined,
      });
      if (data.topGuesser.userId) takenUserIds[String(data.topGuesser.userId)] = true;
    }

    // --- Streak King ---
    var streakKing = scanStreakKing(nk, logger, weekKey);
    if (streakKing) {
      winners.push({
        award: "streak_king",
        userId: streakKing.userId,
        username: "",
        metric: streakKing.streak,
        prize: prizes["streak_king"],
      });
      takenUserIds[streakKing.userId] = true;
    }

    // --- Lucky Draw (random among 5+ day players, excluding other winners) ---
    var lucky = scanLuckyDraw(nk, logger, weekKey, minDays, takenUserIds);
    if (lucky) {
      winners.push({
        award: "lucky_draw",
        userId: lucky.userId,
        username: "",
        metric: lucky.days,
        prize: prizes["lucky_draw"],
      });
      takenUserIds[lucky.userId] = true;
    }

    // --- Resolve usernames + emails in one batch ---
    var winnerIds: string[] = [];
    for (var wi = 0; wi < winners.length; wi++) {
      if (winners[wi].userId) winnerIds.push(winners[wi].userId);
    }
    var usernames = resolveUsernames(nk, logger, winnerIds);
    var emailByUserId: { [uid: string]: string } = {};
    if (winnerIds.length > 0) {
      try {
        var accts = nk.accountsGetId(winnerIds);
        for (var ei = 0; ei < accts.length; ei++) {
          var acct = accts[ei];
          var auid = acct && acct.user && (acct.user as any).id;
          if (auid) emailByUserId[auid] = acct.email || "";
        }
      } catch (_e: any) {}
    }
    for (var ui = 0; ui < winners.length; ui++) {
      if (!winners[ui].username && winners[ui].userId) {
        winners[ui].username = usernames[winners[ui].userId] || "";
      }
    }

    // --- Queue gift-card fulfillments + notify winners ---
    for (var qi = 0; qi < winners.length; qi++) {
      var w = winners[qi];
      if (!w.userId || !w.prize) continue;
      w.fulfillmentKey = queueGiftCardFulfillment(nk, logger, weekKey, region, w, emailByUserId[w.userId] || "");
      notifyWinner(nk, logger, w, weekKey);
    }

    // --- Top-20 XUT bonus (direct wallet credit, idempotent via record) ---
    var top20Ids: string[] = [];
    var priorTop20: { [uid: string]: boolean } = {};
    if (existing && existing.top20XutUserIds) {
      for (var pi = 0; pi < existing.top20XutUserIds.length; pi++) priorTop20[existing.top20XutUserIds[pi]] = true;
    }
    for (var ti = 0; ti < records.length && ti < 20; ti++) {
      var trec = records[ti];
      if (!trec || !trec.ownerId) continue;
      top20Ids.push(trec.ownerId);
      if (priorTop20[trec.ownerId]) continue; // already credited on a prior run
      try {
        nk.walletUpdate(trec.ownerId, { xut: TOP20_XUT_BONUS },
          { reason: "weekly_champions_top20:" + weekKey + ":" + region }, false);
      } catch (wErr: any) {
        logger.warn("[WeeklyChampions] top-20 XUT grant failed for %s: %s", trec.ownerId, wErr.message || String(wErr));
      }
    }

    var record: WeeklyChampionsRecord = {
      weekKey: weekKey,
      region: region,
      calculatedAt: Math.floor(Date.now() / 1000),
      winners: winners,
      top20XutUserIds: top20Ids,
      status: "calculated",
    };
    saveRecord(nk, record);

    logger.info("[WeeklyChampions] calculated %s/%s — %d winners, %d top-20 XUT grants",
      weekKey, region, winners.length, top20Ids.length);

    return RpcHelpers.successResponse({ record: record });
  }

  /** weekly_champions_results — any authenticated user; returns the winners board + caller's awards. */
  function rpcResults(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var region = normalizeRegion(data.region);
    var weekKey = data.weekKey ? String(data.weekKey) : weekKeyUtc(Date.now());

    var record = getRecord(nk, weekKey, region);
    // Convenience: if this week isn't calculated yet, fall back to last week's board.
    if (!record && !data.weekKey) {
      var lastWeek = addDays(weekKey, -7);
      record = getRecord(nk, lastWeek, region);
      if (record) weekKey = lastWeek;
    }
    if (!record) {
      return RpcHelpers.successResponse({ weekKey: weekKey, region: region, calculated: false, winners: [] });
    }

    var myAwards: WeeklyAwardWinner[] = [];
    for (var i = 0; i < record.winners.length; i++) {
      if (record.winners[i].userId === userId) myAwards.push(record.winners[i]);
    }

    return RpcHelpers.successResponse({
      weekKey: record.weekKey,
      region: record.region,
      calculated: true,
      calculatedAt: record.calculatedAt,
      winners: record.winners,
      myAwards: myAwards,
    });
  }

  /**
   * weekly_champions_claim — winner claims their award.
   * Gift-card awards return the pending fulfillment reference (operator approves →
   * GyfTR/Tremendous code lands in the player's reward record, same as event prizes).
   */
  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var region = normalizeRegion(data.region);
    var weekKey = data.weekKey ? String(data.weekKey) : weekKeyUtc(Date.now());

    var record = getRecord(nk, weekKey, region);
    if (!record && !data.weekKey) {
      var lastWeek = addDays(weekKey, -7);
      record = getRecord(nk, lastWeek, region);
      if (record) weekKey = lastWeek;
    }
    if (!record) return RpcHelpers.errorResponse("Weekly champions not calculated yet for this week");

    var myAwards: WeeklyAwardWinner[] = [];
    for (var i = 0; i < record.winners.length; i++) {
      if (record.winners[i].userId === userId) myAwards.push(record.winners[i]);
    }
    if (myAwards.length === 0) return RpcHelpers.errorResponse("No weekly champions award for this user");

    var claimKey = "claim_" + weekKey + "_" + region;
    var prior = Storage.readJson<any>(nk, COLLECTION, claimKey, userId);
    if (prior) {
      return RpcHelpers.successResponse({ alreadyClaimed: true, claimedAt: prior.claimedAt, awards: myAwards });
    }

    var claimed: any[] = [];
    for (var ai = 0; ai < myAwards.length; ai++) {
      var award = myAwards[ai];
      var isXut = (award.prize.currency || "").toUpperCase() === "XUT" || award.prize.fulfillment === "nakama";
      if (isXut) {
        try {
          nk.walletUpdate(userId, { xut: award.prize.value },
            { reason: "weekly_champions_claim:" + weekKey + ":" + award.award }, false);
          claimed.push({ award: award.award, xutGranted: award.prize.value });
        } catch (wErr: any) {
          logger.warn("[WeeklyChampions] XUT claim grant failed for %s: %s", userId, wErr.message || String(wErr));
        }
      } else {
        claimed.push({
          award: award.award,
          giftCard: award.prize,
          fulfillmentKey: award.fulfillmentKey || "",
          status: "pending_fulfillment",
        });
      }
    }

    var nowSec = Math.floor(Date.now() / 1000);
    Storage.writeJson(nk, COLLECTION, claimKey, userId, { claimedAt: nowSec, awards: claimed },
      2 as nkruntime.ReadPermissionValues, 0 as nkruntime.WritePermissionValues);

    return RpcHelpers.successResponse({
      weekKey: weekKey,
      region: region,
      claimedAt: nowSec,
      awards: claimed,
    });
  }

  /** weekly_champions_my_streak — lightweight read for the streak UI + retention hooks. */
  function rpcMyStreak(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var streak = Storage.readJson<StreakRecord>(nk, STREAKS_COLLECTION, "streak", userId);
    var nowMs = Date.now();
    var today = dayKeyUtc(nowMs);
    var current = 0;
    var longest = 0;
    var playedToday = false;
    if (streak) {
      longest = streak.longest || 0;
      playedToday = streak.lastDayKey === today;
      // A streak is only "alive" if the last play was today or yesterday.
      if (streak.lastDayKey === today || streak.lastDayKey === addDays(today, -1)) {
        current = streak.current || 0;
      }
    }
    var week = weekKeyUtc(nowMs);
    var activity = Storage.readJson<ActivityRecord>(nk, ACTIVITY_COLLECTION, "week_" + week, userId);
    return RpcHelpers.successResponse({
      current: current,
      longest: longest,
      playedToday: playedToday,
      daysThisWeek: activity ? activity.count || 0 : 0,
      luckyDrawQualified: !!(activity && (activity.count || 0) >= LUCKY_DRAW_MIN_DAYS),
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("weekly_champions_calculate", rpcCalculate);
    initializer.registerRpc("weekly_champions_results", rpcResults);
    initializer.registerRpc("weekly_champions_claim", rpcClaim);
    initializer.registerRpc("weekly_champions_my_streak", rpcMyStreak);
  }

  /**
   * Feed weekly totals / streaks / activity from the SCORE_SUBMITTED event
   * that creator_event_submit already emits — deliberately NOT wired inside
   * the Path B submit RPC so the existing gameplay flow stays untouched.
   *
   * Other modules (hiro leaderboards, legacy multi-game) also emit
   * SCORE_SUBMITTED; the satori_creator_events lookup filters those out.
   */
  export function registerEventHandlers(): void {
    EventBus.on(EventBus.Events.SCORE_SUBMITTED, function (nk, logger, ctx, data) {
      try {
        if (!data || !data.userId || !data.eventId) return;
        if (typeof data.score !== "number") return;
        var def = Storage.readSystemJson<any>(nk, "satori_creator_events", String(data.eventId));
        if (!def || !def.id) return; // not a creator live event submission
        recordPlay(nk, logger, String(data.userId), (ctx && ctx.username) || "", def.region || "global", data.score);
      } catch (err: any) {
        logger.warn("[WeeklyChampions] SCORE_SUBMITTED handler failed: %s", (err && err.message) || String(err));
      }
    });
  }
}
