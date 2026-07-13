// aahaa_engine.ts
// ─────────────────────────────────────────────────────────────────────────────
// Aahaa engine — per-userID generation, ranking, and operational rules.
//
// generateForUser(userId):
//   FactPack → eval every catalog entry → rank with the "respect ladder"
//   (trust > engagement > monetisation) → enforce server-side rules:
//     · max AAHAA_PER_FEED distinct wows per feed (session cap 3)
//     · max 1 fullscreen per day
//     · max 5 distinct wows per rolling week
//     · per-wow cooldowns, 90-day personal mutes
//     · frustration block: no celebratory wow while tail_wrong_run ≥ 3
//     · CTR kill switch: any wow with ≥20 shows and <5% CTR over 14d pauses
//   → persist the ranked feed at aahaa_feed/<userId>/feed with fully rendered
//     copy + the "why this appeared" signal chip (data lineage on-surface).
//
// generateAll(): pages through quiz-history owners so EVERY userID that has
// ever answered a question gets a feed — this is the "aahaa for each userID"
// batch, runnable from cron.
//
// notePoolExhausted(): called by the seedq engine (Deliverable 1) when a user
// beats a pool. Queues the wow.e.pool_exhausted intercept AND arms App Store
// review-prompt suppression for RATING_SUPPRESS_DAYS.

namespace AahaaEngine {

  export var MODULE_VERSION = "aahaa/1.0.0";

  export var COLL_PROFILE = "aahaa_profile";   // per-user: milestones, mutes, caps, pending events
  export var COLL_FEED = "aahaa_feed";         // per-user: current ranked feed
  export var COLL_STATS = "aahaa_stats";       // system: per-wow shows/clicks (CTR kill switch)
  export var COLL_BATCH = "aahaa_batch";       // system: generate-all cursor
  export var KEY_PROFILE = "profile";
  export var KEY_FEED = "feed";

  export var AAHAA_PER_FEED = 3;        // per-session cap
  export var WEEKLY_CAP = 5;            // distinct wows per rolling 7d
  export var MUTE_DAYS = 90;
  export var RATING_SUPPRESS_DAYS = 7;  // review-prompt suppression after pool exhaustion
  export var CTR_MIN_SHOWS = 20;        // kill switch needs a sample
  export var CTR_FLOOR = 0.05;

  var PRIORITY_BONUS: { [cls: string]: number } = { trust: 200, engagement: 100, monetisation: 0 };

  // ── Profile ────────────────────────────────────────────────────────────────
  export function readProfile(nk: nkruntime.Nakama, userId: string): any {
    var p = SeedQ.readUser(nk, COLL_PROFILE, KEY_PROFILE, userId);
    if (!p) p = {};
    if (!p.milestones) p.milestones = {};
    if (!p.mutes) p.mutes = {};
    if (!p.last_fired) p.last_fired = {};
    if (!p.fired_log) p.fired_log = [];          // [{wow_id, ms}] rolling 7d
    if (!p.pending_events) p.pending_events = []; // [{type, mode, topic, ms}]
    if (!p.onboarding) p.onboarding = {};
    if (!p.rating_suppressed_until_ms) p.rating_suppressed_until_ms = 0;
    return p;
  }

  export function writeProfile(nk: nkruntime.Nakama, userId: string, profile: any): void {
    SeedQ.writeUser(nk, COLL_PROFILE, KEY_PROFILE, userId, profile);
  }

  // ── CTR kill switch bookkeeping ────────────────────────────────────────────
  function readStats(nk: nkruntime.Nakama): any {
    var s = SeedQ.readSystem(nk, COLL_STATS, "stats");
    if (!s) s = { wows: {} };
    if (!s.wows) s.wows = {};
    return s;
  }

  export function recordReaction(nk: nkruntime.Nakama, wowId: string, action: string): void {
    var s = readStats(nk);
    if (!s.wows[wowId]) s.wows[wowId] = { shown: 0, clicked: 0, dismissed: 0, window_start_ms: Date.now() };
    var w = s.wows[wowId];
    // Roll the 14-day CTR window.
    if (Date.now() - (w.window_start_ms || 0) > 14 * 86400000) {
      w.shown = 0; w.clicked = 0; w.dismissed = 0; w.window_start_ms = Date.now();
    }
    if (action === "shown") w.shown = (w.shown | 0) + 1;
    else if (action === "clicked" || action === "converted") w.clicked = (w.clicked | 0) + 1;
    else if (action === "dismissed") w.dismissed = (w.dismissed | 0) + 1;
    SeedQ.writeSystem(nk, COLL_STATS, "stats", s);
  }

  function isKilledByCtr(stats: any, wowId: string): boolean {
    var w = stats.wows[wowId];
    if (!w || (w.shown | 0) < CTR_MIN_SHOWS) return false;
    return ((w.clicked | 0) / w.shown) < CTR_FLOOR;
  }

  // ── Generation ─────────────────────────────────────────────────────────────
  export interface GeneratedWow {
    wow_id: string;
    tier: string;
    surface: string;
    copy: string;
    copy_template: string;
    vars: { [k: string]: any };
    cta_action_id: string;
    loop_event: string;
    mechanic: string;
    priority_class: string;
    fullscreen: boolean;
    signal: string;          // "why this appeared" lineage chip
    data_sources: string[];
    score: number;
    trace_id: string;
  }

  export function generateForUser(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string
  ): { feed: GeneratedWow[]; facts: AahaaFacts.FactPack; suppressed: string[]; rating_prompt_suppressed: boolean } {
    var facts: AahaaFacts.FactPack;
    try {
      facts = AahaaFacts.buildFactPack(ctx, nk, logger, userId);
    } catch (e: any) {
      logger.warn("[Aahaa] buildFactPack failed for " + userId + ": " + (e && e.message ? e.message : String(e)));
      return { feed: [], facts: null as any, suppressed: ["fact_pack_error"], rating_prompt_suppressed: true };
    }
    var factsForEval = JSON.parse(JSON.stringify(facts));
    var profile = readProfile(nk, userId);
    var stats = readStats(nk);
    var now = Date.now();

    // Rolling-week fired log cleanup.
    var freshLog: any[] = [];
    for (var f = 0; f < profile.fired_log.length; f++) {
      if (now - (profile.fired_log[f].ms || 0) < 7 * 86400000) freshLog.push(profile.fired_log[f]);
    }
    profile.fired_log = freshLog;
    var weekCount = freshLog.length;

    var fullscreenToday = false;
    for (var fd = 0; fd < freshLog.length; fd++) {
      if (freshLog[fd].fullscreen && (now - freshLog[fd].ms) < 86400000) fullscreenToday = true;
    }

    var frustrated = facts.recent.tail_wrong_run >= 3;

    var entries = AahaaCatalog.catalog();
    var candidates: { entry: AahaaCatalog.CatalogEntry; cand: AahaaCatalog.WowCandidate; rank: number }[] = [];
    var suppressed: string[] = [];

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var cand: AahaaCatalog.WowCandidate | null = null;
      try { cand = entry.eval(factsForEval, profile); } catch (e: any) {
        logger.warn("[Aahaa] eval failed for " + entry.wow_id + ": " + (e && e.message ? e.message : String(e)));
      }
      if (!cand) continue;

      // Personal mute (90 days).
      var muteUntil = profile.mutes[entry.wow_id] || 0;
      if (muteUntil > now) { suppressed.push(entry.wow_id + ":muted"); continue; }
      // Per-wow cooldown.
      var lastMs = profile.last_fired[entry.wow_id] || 0;
      if (lastMs > 0 && (now - lastMs) < entry.cooldown_days * 86400000) { suppressed.push(entry.wow_id + ":cooldown"); continue; }
      // Frustration block for celebratory wows.
      if (frustrated && entry.celebratory) { suppressed.push(entry.wow_id + ":frustration_block"); continue; }
      // CTR kill switch.
      if (isKilledByCtr(stats, entry.wow_id)) { suppressed.push(entry.wow_id + ":ctr_paused"); continue; }

      var rank = entry.base_score + cand.score + (PRIORITY_BONUS[entry.priority_class] || 0);
      candidates.push({ entry: entry, cand: cand, rank: rank });
    }

    candidates.sort(function (a, b) { return b.rank - a.rank; });

    var feed: GeneratedWow[] = [];
    for (var c = 0; c < candidates.length && feed.length < AAHAA_PER_FEED; c++) {
      var pick = candidates[c];
      if (weekCount + feed.length >= WEEKLY_CAP && pick.entry.priority_class !== "trust") continue;
      if (pick.entry.fullscreen && fullscreenToday) { suppressed.push(pick.entry.wow_id + ":fullscreen_cap"); continue; }
      if (pick.entry.fullscreen) fullscreenToday = true;

      feed.push({
        wow_id: pick.entry.wow_id,
        tier: pick.entry.tier,
        surface: pick.entry.surface,
        copy: AahaaCatalog.renderCopy(pick.entry.copy_template, pick.cand.vars),
        copy_template: pick.entry.copy_template,
        vars: pick.cand.vars,
        cta_action_id: pick.entry.cta_action_id,
        loop_event: pick.entry.loop_event,
        mechanic: pick.entry.mechanic,
        priority_class: pick.entry.priority_class,
        fullscreen: pick.entry.fullscreen,
        signal: pick.cand.signal,
        data_sources: pick.entry.data_sources,
        score: pick.rank,
        trace_id: "aahaa_" + now.toString(36) + "_" + SeedQ.randSuffix()
      });
    }

    // Milestone bookkeeping so one-shot wows never re-fire.
    for (var m = 0; m < feed.length; m++) {
      var w = feed[m];
      if (w.wow_id === "wow.s.thousand_questions") profile.milestones.questions = w.vars.milestone;
      if (w.wow_id === "wow.s.year_in_quizverse") profile.milestones.anniversary = w.vars.days;
      if (w.wow_id === "wow.b.month_summary") profile.milestones.month_summary = new Date().toISOString().slice(0, 7);
      if (w.wow_id === "wow.d.first_friend_added") profile.milestones.first_friend = 1;
      if (w.wow_id === "wow.d.network_growing") profile.milestones.friends = facts.social.friends_count;
    }

    var ratingSuppressed = profile.rating_suppressed_until_ms > now || frustrated ||
      (facts.seedq.exhausted_pools_7d && facts.seedq.exhausted_pools_7d.length > 0);

    var feedDoc = {
      generated_ms: now,
      feed: feed,
      rating_prompt_suppressed: ratingSuppressed,
      fact_pack_version: facts.version,
      module_version: MODULE_VERSION
    };
    SeedQ.writeUser(nk, COLL_FEED, KEY_FEED, userId, feedDoc);
    writeProfile(nk, userId, profile);

    return { feed: feed, facts: facts, suppressed: suppressed, rating_prompt_suppressed: ratingSuppressed };
  }

  // Marks a wow as fired (called on "shown" reactions) — moves the cooldown +
  // weekly-cap bookkeeping to the moment the surface actually rendered it.
  export function markFired(nk: nkruntime.Nakama, userId: string, wowId: string, fullscreen: boolean): void {
    var profile = readProfile(nk, userId);
    var now = Date.now();
    profile.last_fired[wowId] = now;
    profile.fired_log.push({ wow_id: wowId, ms: now, fullscreen: !!fullscreen });
    if (profile.fired_log.length > 50) profile.fired_log = profile.fired_log.slice(profile.fired_log.length - 50);
    writeProfile(nk, userId, profile);
  }

  export function muteWow(nk: nkruntime.Nakama, userId: string, wowId: string): void {
    var profile = readProfile(nk, userId);
    profile.mutes[wowId] = Date.now() + MUTE_DAYS * 86400000;
    writeProfile(nk, userId, profile);
  }

  // ── Deliverable 1 hook: pool exhaustion intercept ─────────────────────────
  // Called from the seedq engine when a user runs a (mode, topic) pool dry.
  // Queues the wow.e.pool_exhausted signal AND suppresses the App Store
  // rating prompt — we never ask for a rating when a pool is exhausted.
  export function notePoolExhausted(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, mode: string, topic: string): void {
    try {
      var profile = readProfile(nk, userId);
      var now = Date.now();
      // Dedupe: one pending event per (mode, topic) per 24h.
      for (var i = 0; i < profile.pending_events.length; i++) {
        var ev = profile.pending_events[i];
        if (ev.type === "pool_exhausted" && ev.mode === mode && ev.topic === topic && (now - ev.ms) < 86400000) return;
      }
      profile.pending_events.push({ type: "pool_exhausted", mode: mode, topic: topic, ms: now });
      if (profile.pending_events.length > 20) profile.pending_events = profile.pending_events.slice(profile.pending_events.length - 20);
      profile.rating_suppressed_until_ms = now + RATING_SUPPRESS_DAYS * 86400000;
      writeProfile(nk, userId, profile);
      logger.info("[Aahaa] pool_exhausted intercept armed for user=" + userId + " " + mode + "/" + topic);
    } catch (e: any) {
      logger.warn("[Aahaa] notePoolExhausted failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  // ── "Aahaa for each userID" batch ──────────────────────────────────────────
  // Pages across ALL owners of the source collections below — i.e. every
  // userID that ever answered a question OR engaged the staged-questions
  // engine — and generates a feed for each. Cursor (collection index + page
  // cursor) is persisted so cron ticks resume where the last one stopped.
  // NOTE: string literals (not SeedQ.COLL_*) — this array initialises at
  // namespace-eval time, before the SeedQ namespace object exists (aahaa/
  // sorts ahead of seed-questions/ in the bundle).
  var BATCH_SOURCE_COLLECTIONS = ["quiz-verse_quiz_history", "sq_staged", "quiz_user_stats_126bf539-dae2-4bcf-964d-316c0fa1f92b", "quiz_results"];

  export function generateAll(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    maxUsers: number,
    resetCursor: boolean
  ): any {
    var startedMs = Date.now();
    var MAX_RUN_MS = 30000;
    var state = SeedQ.readSystem(nk, COLL_BATCH, "state") || { coll_index: 0, cursor: "", runs: 0, users_done_total: 0 };
    if (resetCursor) { state.coll_index = 0; state.cursor = ""; }
    if (!state.coll_index) state.coll_index = 0;

    var processed = 0, errors = 0;
    var userIds: string[] = [];
    var seenThisRun: { [uid: string]: boolean } = {};
    var collIndex: number = state.coll_index;
    var cursor: string = state.cursor || "";

    while (processed < maxUsers && collIndex < BATCH_SOURCE_COLLECTIONS.length) {
      if (Date.now() - startedMs > MAX_RUN_MS) {
        logger.warn("[Aahaa] generateAll time limit reached processed=" + processed);
        break;
      }
      var page: any = null;
      try {
        // null userId lists the collection across ALL owners (empty string is
        // rejected by the Goja binding with "expects empty or valid user id").
        page = nk.storageList(null as any, BATCH_SOURCE_COLLECTIONS[collIndex], Math.min(50, maxUsers - processed), cursor || undefined);
      } catch (e: any) {
        logger.error("[Aahaa] generateAll storageList(" + BATCH_SOURCE_COLLECTIONS[collIndex] + ") failed: " + (e && e.message ? e.message : String(e)));
        collIndex++; cursor = "";
        continue;
      }
      var objs = (page && page.objects) ? page.objects : [];

      for (var i = 0; i < objs.length && processed < maxUsers; i++) {
        var uid = objs[i].userId;
        if (!uid || uid === Constants.SYSTEM_USER_ID || seenThisRun[uid]) continue;
        seenThisRun[uid] = true;
        try {
          var res = generateForUser(ctx, nk, logger, uid);
          userIds.push(uid + ":" + res.feed.length);
          processed++;
        } catch (e2: any) {
          errors++;
          logger.warn("[Aahaa] generateForUser failed for " + uid + ": " + (e2 && e2.message ? e2.message : String(e2)));
        }
      }

      cursor = (page && page.cursor) ? page.cursor : "";
      if (!cursor || objs.length === 0) { collIndex++; cursor = ""; }
    }

    var exhausted = collIndex >= BATCH_SOURCE_COLLECTIONS.length;
    state.coll_index = exhausted ? 0 : collIndex;
    state.cursor = exhausted ? "" : cursor;
    state.runs = (state.runs || 0) + 1;
    state.users_done_total = (state.users_done_total || 0) + processed;
    state.last_run_ms = Date.now();
    SeedQ.writeSystem(nk, COLL_BATCH, "state", state);

    return {
      processed: processed,
      errors: errors,
      users: userIds,
      cursor_exhausted: exhausted,
      runs: state.runs,
      users_done_total: state.users_done_total
    };
  }
}
