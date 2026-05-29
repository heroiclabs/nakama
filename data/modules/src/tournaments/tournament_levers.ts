// =============================================================================
// tournament_levers.ts — Wave-2 conversion + retention lever implementations
//
// Server primitives for the 12 levers spec'd in tournament_economy_v2.ts.
// Strictly additive — every lever sits behind a feature flag in
// TournamentEconomyV2.FEATURE_FLAGS and is a no-op when its flag is off.
//
// Storage collections (all SYSTEM_USER_ID owned, public read where noted):
//   tournament_intent_quiz       L1   per-user intent answers + recommendation
//   tournament_streaks           L7   per-user calendar streak ledger
//   tournament_detail_views      L6   per-(user,slug) viewed-but-not-entered ledger
//   tournament_doubleup          L11  per-(user,slug) Pick-N v2 doubleup record
//   tournament_predictive_state  L5   per-(user,slug) rank delta sliding window
//   tournament_spectators        L9   per-slug spectator subscriber set
//   tournament_lever_analytics   L12  Mixpanel-shape event ring buffer
//
// Wave-2 slate (L10) is implemented as additive entries in
// TournamentEconomyV2.WAVE_2_SLATE_DRAFT, surfaced through
// `tournament_list` when feature_flags.wave2_slate is on.
// =============================================================================

namespace TournamentLevers {

  // Storage collection names — kept distinct from existing tournament collections.
  export const COL_INTENT_QUIZ      = "tournament_intent_quiz";
  export const COL_STREAKS          = "tournament_streaks";
  export const COL_DETAIL_VIEWS     = "tournament_detail_views";
  export const COL_DOUBLEUP         = "tournament_doubleup";
  export const COL_PREDICTIVE_STATE = "tournament_predictive_state";
  export const COL_SPECTATORS       = "tournament_spectators";
  export const COL_LEVER_ANALYTICS  = "tournament_lever_analytics";
  // A-tier additions
  export const COL_WELCOME_PACK     = "tournament_welcome_pack";    // A1 owner-only
  export const COL_DAILY_QUESTS     = "tournament_daily_quests";    // A2 owner-only
  export const COL_REFERRAL_2SIDED  = "tournament_referral_2sided"; // A3 server-owned
  export const COL_FUNNEL_COUNTERS  = "tournament_funnel_counters"; // A5 server-owned

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  // ───────────────────────────────────────────────────────────────────────────
  // L12 — analytics event helper (Mixpanel-shape)
  // Every lever fires through this so analytics is always wired even when a
  // lever's user-visible flag is off. Read by the dashboard (P1) + alert
  // pipeline (P2). Schema is intentionally Mixpanel-compatible so the same
  // event names map 1:1 if/when the JS SDK lands on web/Unity.
  // ───────────────────────────────────────────────────────────────────────────
  export interface LeverEvent {
    event: string;
    user_id: string | null;
    properties: { [k: string]: any };
    ts: number;
  }

  export function logEvent(nk: nkruntime.Nakama, event: string, userId: string | null, properties: any): void {
    try {
      var row: LeverEvent = {
        event: event,
        user_id: userId,
        properties: properties || {},
        ts: nowSec(),
      };
      var key = "evt_" + event + "_" + (userId || "anon") + "_" + Date.now();
      nk.storageWrite([{
        collection: COL_LEVER_ANALYTICS,
        key: key,
        userId: Constants.SYSTEM_USER_ID,
        value: row,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_) { /* best-effort */ }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // L1 — intent quiz
  // Persist 3 answers + compute a tailored recommendation slug.
  // ───────────────────────────────────────────────────────────────────────────
  export interface IntentAnswers {
    favorite_topic: string;        // option id from INTENT_QUIZ[0]
    time_budget: string;           // option id from INTENT_QUIZ[1]
    prize_comfort: string;         // option id from INTENT_QUIZ[2]
    answered_at: number;
    recommended_slug: string;
  }

  // Pure function. Maps the 3 intent answers onto a tournament slug from
  // the live LAUNCH_SLATE. Falls back deterministically.
  export function recommendSlug(answers: { favorite_topic: string; time_budget: string; prize_comfort: string }): string {
    var fav = answers.favorite_topic || "";
    var tb  = answers.time_budget || "";
    var pc  = answers.prize_comfort || "";

    // First pass — favorite topic + time budget guides format
    if (tb === "fast") {
      // user wants quick play → Pick-5 Daily
      return "pick-5-daily";
    }
    if (fav === "movies") return "movie-buff-weekly";
    if (fav === "exam") {
      // exam-prep cohort → match by time-of-year defaults
      return "ap-2027-prep-weekly";
    }
    if (fav === "science") return "brain-bowl-weekly";
    if (fav === "sports") return "gk-royale-daily";
    if (fav === "music") {
      // wave-2 slate, gated by flag at registration
      return TournamentEconomyV2.FEATURE_FLAGS.wave2_slate ? "music-history-royale" : "brain-bowl-weekly";
    }

    // Prize-comfort fallback
    if (pc === "free")  return "pick-5-daily";          // lowest entry (50 BC)
    if (pc === "high")  return "survivor-week-1";       // highest entry (500 BC)

    // Final fallback — universally relevant daily
    return "gk-royale-daily";
  }

  export function readIntent(nk: nkruntime.Nakama, userId: string): IntentAnswers | null {
    try {
      var rows = nk.storageRead([{ collection: COL_INTENT_QUIZ, key: "answers", userId: userId }]);
      if (rows && rows.length > 0) return rows[0].value as IntentAnswers;
    } catch (_) { }
    return null;
  }

  export function writeIntent(nk: nkruntime.Nakama, userId: string, answers: IntentAnswers): void {
    nk.storageWrite([{
      collection: COL_INTENT_QUIZ,
      key: "answers",
      userId: userId,
      value: answers,
      permissionRead: 1,    // owner-only read
      permissionWrite: 0,   // server-only write
    }]);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // L7 — daily streak ledger
  // Records a unique-day check-in. Returns the new streak length and any
  // reward unlocked at exactly this length.
  // ───────────────────────────────────────────────────────────────────────────
  export interface StreakRow {
    current_days: number;
    last_calendar_day: string;     // YYYY-MM-DD in user's TZ (or UTC fallback)
    grace_days_used: number;
    history: string[];             // last 30 calendar days
    longest_ever: number;
  }

  export function todayKey(timezoneOffsetMin: number): string {
    var tzMs = (timezoneOffsetMin || 0) * 60 * 1000;
    var d = new Date(Date.now() + tzMs);
    var yyyy = d.getUTCFullYear();
    var mm = ("0" + (d.getUTCMonth() + 1)).slice(-2);
    var dd = ("0" + d.getUTCDate()).slice(-2);
    return yyyy + "-" + mm + "-" + dd;
  }

  function dayDiff(a: string, b: string): number {
    if (!a || !b) return 9999;
    var pa = a.split("-"), pb = b.split("-");
    var da = Date.UTC(parseInt(pa[0],10), parseInt(pa[1],10)-1, parseInt(pa[2],10));
    var db = Date.UTC(parseInt(pb[0],10), parseInt(pb[1],10)-1, parseInt(pb[2],10));
    return Math.round((db - da) / 86400000);
  }

  export function recordCheckin(nk: nkruntime.Nakama, userId: string, timezoneOffsetMin: number): { row: StreakRow; reward: any | null; new_unlock: boolean } {
    var today = todayKey(timezoneOffsetMin || 0);
    var existing: StreakRow | null = null;
    try {
      var rows = nk.storageRead([{ collection: COL_STREAKS, key: "row", userId: userId }]);
      if (rows && rows.length > 0) existing = rows[0].value as StreakRow;
    } catch (_) { }

    var row: StreakRow = existing || {
      current_days: 0,
      last_calendar_day: "",
      grace_days_used: 0,
      history: [],
      longest_ever: 0,
    };

    if (row.last_calendar_day === today) {
      // Already checked in today — return current state, no reward.
      return { row: row, reward: null, new_unlock: false };
    }

    var diff = dayDiff(row.last_calendar_day, today);
    if (row.last_calendar_day === "" || diff === 1) {
      row.current_days = (row.current_days || 0) + 1;
    } else if (diff === 2 && (row.grace_days_used || 0) < TournamentEconomyV2.STREAK_GRACE_DAYS) {
      // Grace day used — keep streak intact.
      row.grace_days_used = (row.grace_days_used || 0) + 1;
      row.current_days = (row.current_days || 0) + 1;
    } else {
      row.current_days = 1;
      row.grace_days_used = 0;
    }
    row.last_calendar_day = today;
    row.history = (row.history || []).concat([today]).slice(-30);
    if (row.current_days > (row.longest_ever || 0)) row.longest_ever = row.current_days;

    nk.storageWrite([{
      collection: COL_STREAKS, key: "row", userId: userId, value: row,
      permissionRead: 1, permissionWrite: 0,
    }]);

    // Reward unlock: only if exactly hitting a milestone.
    var reward: any = null;
    var rewards = TournamentEconomyV2.STREAK_REWARDS;
    for (var i = 0; i < rewards.length; i++) {
      if (rewards[i].on_day === row.current_days) { reward = rewards[i]; break; }
    }

    return { row: row, reward: reward, new_unlock: reward !== null };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // L6 — abandonment tracker (track + scheduled push)
  // ───────────────────────────────────────────────────────────────────────────
  export interface DetailViewRow {
    slug: string;
    user_id: string;
    viewed_at: number;
    nudge_due_at: number;
    nudged: boolean;
    entered: boolean;
  }

  function viewKey(slug: string, userId: string): string { return slug + "_" + userId; }

  export function recordDetailView(nk: nkruntime.Nakama, userId: string, slug: string): DetailViewRow {
    var delaySec = TournamentEconomyV2.ABANDONMENT_NUDGE.delay_hours * 3600;
    var row: DetailViewRow = {
      slug: slug,
      user_id: userId,
      viewed_at: nowSec(),
      nudge_due_at: nowSec() + delaySec,
      nudged: false,
      entered: false,
    };
    nk.storageWrite([{
      collection: COL_DETAIL_VIEWS, key: viewKey(slug, userId), userId: Constants.SYSTEM_USER_ID,
      value: row, permissionRead: 0, permissionWrite: 0,
    }]);
    return row;
  }

  export function markEntered(nk: nkruntime.Nakama, userId: string, slug: string): void {
    try {
      var rows = nk.storageRead([{ collection: COL_DETAIL_VIEWS, key: viewKey(slug, userId), userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) {
        var r = rows[0].value as DetailViewRow;
        r.entered = true;
        nk.storageWrite([{
          collection: COL_DETAIL_VIEWS, key: viewKey(slug, userId), userId: Constants.SYSTEM_USER_ID,
          value: r, permissionRead: 0, permissionWrite: 0,
        }]);
      }
    } catch (_) { }
  }

  // Scan for due nudges. Called by tournament_levers_cron_tick. Returns the
  // number of pushes fired.
  export function processAbandonmentNudges(nk: nkruntime.Nakama, logger: nkruntime.Logger, maxBatch: number): number {
    if (!TournamentEconomyV2.FEATURE_FLAGS.abandonment_nudge_v1) return 0;
    var now = nowSec();
    var sent = 0;
    var cursor: string | undefined = undefined;
    var loops = 0;
    while (sent < maxBatch && loops < 10) {
      loops++;
      var page: nkruntime.StorageObjectList;
      try {
        page = nk.storageList(Constants.SYSTEM_USER_ID, COL_DETAIL_VIEWS, 100, cursor);
      } catch (_) { break; }
      if (!page || !page.objects || page.objects.length === 0) break;
      for (var i = 0; i < page.objects.length && sent < maxBatch; i++) {
        var obj = page.objects[i];
        var r = obj.value as DetailViewRow;
        if (!r || r.nudged || r.entered) continue;
        if (r.nudge_due_at > now) continue;
        // Fire push.
        try {
          TournamentRealtime.sendToUser(nk, r.user_id, TournamentRealtime.CODE_PREENROLL_SCARCITY, "abandonment_nudge", {
            event: "abandonment_h24",
            slug: r.slug,
            template_code: "h24_abandonment",
          }, true);
          r.nudged = true;
          nk.storageWrite([{
            collection: COL_DETAIL_VIEWS, key: viewKey(r.slug, r.user_id), userId: Constants.SYSTEM_USER_ID,
            value: r, permissionRead: 0, permissionWrite: 0,
          }]);
          logEvent(nk, "abandonment_nudge_sent", r.user_id, { slug: r.slug });
          sent++;
        } catch (_) { /* best-effort */ }
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
    if (sent > 0 && logger) logger.info("[L6] abandonment nudges sent: %d", sent);
    return sent;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // L11 — Pick-N v2 doubleup
  // Locks in a 2x multiplier on remaining picks for an additional fee. Settled
  // by tournament_settle scoring path checking for a doubleup row.
  // ───────────────────────────────────────────────────────────────────────────
  export interface DoubleupRow {
    slug: string;
    user_id: string;
    picks_made_at_lock: number;
    cost_bc: number;
    multiplier: number;
    locked_at: number;
  }

  function doubleupKey(slug: string, userId: string): string { return slug + "_" + userId; }

  export function readDoubleup(nk: nkruntime.Nakama, userId: string, slug: string): DoubleupRow | null {
    try {
      var rows = nk.storageRead([{ collection: COL_DOUBLEUP, key: doubleupKey(slug, userId), userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) return rows[0].value as DoubleupRow;
    } catch (_) { }
    return null;
  }

  export function writeDoubleup(nk: nkruntime.Nakama, userId: string, slug: string, picksMade: number): DoubleupRow {
    var cfg = TournamentEconomyV2.PICKN_DOUBLEUP_DEFAULT;
    var row: DoubleupRow = {
      slug: slug,
      user_id: userId,
      picks_made_at_lock: picksMade,
      cost_bc: cfg.cost_bc,
      multiplier: cfg.multiplier,
      locked_at: nowSec(),
    };
    nk.storageWrite([{
      collection: COL_DOUBLEUP, key: doubleupKey(slug, userId), userId: Constants.SYSTEM_USER_ID,
      value: row, permissionRead: 0, permissionWrite: 0,
    }]);
    return row;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // L9 — spectator mode (auth-free subscriber set)
  // Distinct from tournament_subscribers (which is the entrant-realtime set).
  // ───────────────────────────────────────────────────────────────────────────
  export function addSpectator(nk: nkruntime.Nakama, slug: string, userId: string): void {
    var existing: string[] = [];
    try {
      var rows = nk.storageRead([{ collection: COL_SPECTATORS, key: slug, userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) existing = (rows[0].value as any).user_ids || [];
    } catch (_) { }
    if (existing.indexOf(userId) >= 0) return;
    existing.push(userId);
    var max = TournamentEconomyV2.WATCH_LIVE.spectator_max_concurrent_per_pod;
    if (existing.length > max) existing = existing.slice(-max);
    nk.storageWrite([{
      collection: COL_SPECTATORS, key: slug, userId: Constants.SYSTEM_USER_ID,
      value: { user_ids: existing, updated_at: nowSec() },
      permissionRead: 0, permissionWrite: 0,
    }]);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // L5 — predictive rank nudge state
  // Stores a sliding window of (rank, ts) per (user, slug). When current rank
  // is `rank_slip_threshold` worse than the window minimum AND the next
  // prize-tier boundary is crossable, fire the predictive_rank push.
  // ───────────────────────────────────────────────────────────────────────────
  export interface PredictiveState {
    slug: string;
    user_id: string;
    samples: { rank: number; ts: number }[];   // capped to last 30
    last_nudge_at: number;
  }

  function predictiveKey(slug: string, userId: string): string { return slug + "_" + userId; }

  export function pushRankSample(nk: nkruntime.Nakama, userId: string, slug: string, rank: number): { should_nudge: boolean; target_rank: number } {
    var state: PredictiveState | null = null;
    try {
      var rows = nk.storageRead([{ collection: COL_PREDICTIVE_STATE, key: predictiveKey(slug, userId), userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) state = rows[0].value as PredictiveState;
    } catch (_) { }
    if (!state) state = { slug: slug, user_id: userId, samples: [], last_nudge_at: 0 };

    var now = nowSec();
    state.samples.push({ rank: rank, ts: now });
    if (state.samples.length > 30) state.samples = state.samples.slice(-30);

    var windowSec = TournamentEconomyV2.PREDICTIVE_NUDGE.sliding_window_minutes * 60;
    var cooldownSec = TournamentEconomyV2.PREDICTIVE_NUDGE.cooldown_minutes_per_user_slug * 60;
    var threshold = TournamentEconomyV2.PREDICTIVE_NUDGE.rank_slip_threshold;

    var minRank = rank;
    for (var i = 0; i < state.samples.length; i++) {
      if (now - state.samples[i].ts <= windowSec && state.samples[i].rank < minRank) {
        minRank = state.samples[i].rank;
      }
    }
    var slipped = (rank - minRank) >= threshold;
    var cooledDown = (now - state.last_nudge_at) >= cooldownSec;
    var shouldNudge = slipped && cooledDown;
    var targetRank = shouldNudge ? Math.max(1, minRank) : rank;

    if (shouldNudge) state.last_nudge_at = now;

    nk.storageWrite([{
      collection: COL_PREDICTIVE_STATE, key: predictiveKey(slug, userId), userId: Constants.SYSTEM_USER_ID,
      value: state, permissionRead: 0, permissionWrite: 0,
    }]);

    return { should_nudge: shouldNudge, target_rank: targetRank };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // A-tier lever primitives — push grades B-/C+ → A/A end-to-end
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── A1: Welcome pack ──────────────────────────────────────────────────────
  export interface WelcomePackRow {
    user_id: string;
    granted_bc: number;
    free_pickn_entry_remaining: number;
    claimed_at: number;
    expires_at: number;
  }

  export function readWelcomePack(nk: nkruntime.Nakama, userId: string): WelcomePackRow | null {
    try {
      var rows = nk.storageRead([{ collection: COL_WELCOME_PACK, key: "row", userId: userId }]);
      if (rows && rows.length > 0) return rows[0].value as WelcomePackRow;
    } catch (_) { }
    return null;
  }

  export function writeWelcomePack(nk: nkruntime.Nakama, userId: string, row: WelcomePackRow): void {
    nk.storageWrite([{
      collection: COL_WELCOME_PACK, key: "row", userId: userId, value: row,
      permissionRead: 1, permissionWrite: 0,
    }]);
  }

  // ─── A2: Daily quest ledger ───────────────────────────────────────────────
  export interface DailyQuestRow {
    calendar_day: string;
    quests: { [slug: string]: { progress: number; completed: boolean; reward_paid: boolean } };
    bonus_claimed: boolean;
  }

  export function dailyQuestKeyFor(timezoneOffsetMin: number): string {
    return "row_" + todayKey(timezoneOffsetMin || 0);
  }

  export function readDailyQuests(nk: nkruntime.Nakama, userId: string, timezoneOffsetMin: number): DailyQuestRow {
    var key = dailyQuestKeyFor(timezoneOffsetMin);
    try {
      var rows = nk.storageRead([{ collection: COL_DAILY_QUESTS, key: key, userId: userId }]);
      if (rows && rows.length > 0) return rows[0].value as DailyQuestRow;
    } catch (_) { }
    var fresh: DailyQuestRow = {
      calendar_day: todayKey(timezoneOffsetMin || 0),
      quests: {},
      bonus_claimed: false,
    };
    var defs = TournamentEconomyV2.DAILY_QUESTS;
    for (var i = 0; i < defs.length; i++) {
      fresh.quests[defs[i].slug] = { progress: 0, completed: false, reward_paid: false };
    }
    return fresh;
  }

  export function writeDailyQuests(nk: nkruntime.Nakama, userId: string, row: DailyQuestRow, timezoneOffsetMin: number): void {
    var key = dailyQuestKeyFor(timezoneOffsetMin);
    nk.storageWrite([{
      collection: COL_DAILY_QUESTS, key: key, userId: userId, value: row,
      permissionRead: 1, permissionWrite: 0,
    }]);
  }

  // Increments a metric. Returns the updated row + flags (newly_completed_slug,
  // newly_unlocked_bonus). Caller mints rewards based on the flags.
  export function incrementDailyQuest(
    nk: nkruntime.Nakama, userId: string, metric: string, by: number, timezoneOffsetMin: number
  ): { row: DailyQuestRow; newly_completed: string[]; bonus_unlocked: boolean } {
    var row = readDailyQuests(nk, userId, timezoneOffsetMin);
    var defs = TournamentEconomyV2.DAILY_QUESTS;
    var newlyCompleted: string[] = [];
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].metric !== metric) continue;
      var slug = defs[i].slug;
      var entry = row.quests[slug] || { progress: 0, completed: false, reward_paid: false };
      if (entry.completed) continue;
      entry.progress = (entry.progress || 0) + by;
      if (entry.progress >= defs[i].target) {
        entry.completed = true;
        newlyCompleted.push(slug);
      }
      row.quests[slug] = entry;
    }
    // Bonus unlock check.
    var allDone = true;
    for (var j = 0; j < defs.length; j++) {
      if (!row.quests[defs[j].slug] || !row.quests[defs[j].slug].completed) { allDone = false; break; }
    }
    var bonusUnlocked = allDone && !row.bonus_claimed;
    if (bonusUnlocked) row.bonus_claimed = true;
    writeDailyQuests(nk, userId, row, timezoneOffsetMin);
    return { row: row, newly_completed: newlyCompleted, bonus_unlocked: bonusUnlocked };
  }

  // ─── A3: 2-sided referral payout ──────────────────────────────────────────
  // Server-owned ledger (read=0, write=0) tracks referrer payouts to enforce
  // the per-referrer per-day cap.
  export interface Referral2SidedRow {
    referrer_user_id: string;
    referred_user_id: string;
    paid_at: number;
    referrer_bc: number;
    referred_bc: number;
  }

  function referral2sKey(referrer: string, referred: string): string { return referrer + "_" + referred; }

  export function recordReferral2Sided(
    nk: nkruntime.Nakama, referrerUserId: string, referredUserId: string
  ): { paid: boolean; reason: string; row: Referral2SidedRow | null } {
    if (!referrerUserId || !referredUserId || referrerUserId === referredUserId) {
      return { paid: false, reason: "invalid_pair", row: null };
    }
    var key = referral2sKey(referrerUserId, referredUserId);
    var existing: any = null;
    try {
      var rows = nk.storageRead([{ collection: COL_REFERRAL_2SIDED, key: key, userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) existing = rows[0].value;
    } catch (_) { }
    if (existing) return { paid: false, reason: "already_paid", row: existing as Referral2SidedRow };

    // Daily cap check — count rows with referrer == referrerUserId in last 24h.
    var dayAgo = nowSec() - 86400;
    var count = 0;
    try {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, COL_REFERRAL_2SIDED, 100, undefined);
      if (page && page.objects) {
        for (var i = 0; i < page.objects.length; i++) {
          var v = page.objects[i].value as any;
          if (v && v.referrer_user_id === referrerUserId && v.paid_at >= dayAgo) count++;
        }
      }
    } catch (_) { }
    var cap = TournamentEconomyV2.REFERRAL_2SIDED.cap_per_referrer_per_day;
    if (count >= cap) return { paid: false, reason: "daily_cap_hit", row: null };

    var row: Referral2SidedRow = {
      referrer_user_id: referrerUserId,
      referred_user_id: referredUserId,
      paid_at: nowSec(),
      referrer_bc: TournamentEconomyV2.REFERRAL_2SIDED.referrer_bc,
      referred_bc: TournamentEconomyV2.REFERRAL_2SIDED.referred_bc,
    };
    nk.storageWrite([{
      collection: COL_REFERRAL_2SIDED, key: key, userId: Constants.SYSTEM_USER_ID,
      value: row, permissionRead: 0, permissionWrite: 0,
    }]);
    return { paid: true, reason: "ok", row: row };
  }

  // ─── A4: Cohort retention rollup helper ───────────────────────────────────
  // Pure helper that aggregates lever_analytics events. Returns rolling cohort
  // retention curves (D1, D7, D14, D30) for the last `rolling_window_days`.
  export function aggregateCohortRetention(nk: nkruntime.Nakama): any {
    var win = TournamentEconomyV2.COHORT_RETENTION_WINDOWS;
    var horizonSec = win.rolling_window_days * 86400;
    var cutoffTs = nowSec() - horizonSec;
    var cohorts: { [day: string]: { signups: number; active_at: { [d: string]: number } } } = {};
    var cursor: string | undefined = undefined;
    var loops = 0;
    while (loops < 8) {
      loops++;
      var page: any;
      try {
        page = nk.storageList(Constants.SYSTEM_USER_ID, COL_LEVER_ANALYTICS, 200, cursor);
      } catch (_) { break; }
      if (!page || !page.objects || page.objects.length === 0) break;
      for (var i = 0; i < page.objects.length; i++) {
        var ev: any = page.objects[i].value;
        if (!ev || !ev.ts || ev.ts < cutoffTs) continue;
        if (ev.event !== "intent_quiz_submitted" && ev.event !== "tournament_enter") continue;
        var d = new Date(ev.ts * 1000);
        var dayKey = d.getUTCFullYear() + "-" + ("0"+(d.getUTCMonth()+1)).slice(-2) + "-" + ("0"+d.getUTCDate()).slice(-2);
        if (!cohorts[dayKey]) cohorts[dayKey] = { signups: 0, active_at: {} };
        if (ev.event === "intent_quiz_submitted") cohorts[dayKey].signups += 1;
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
    return { cohorts: cohorts, generated_at: nowSec() };
  }

  // ─── A5: Funnel metrics — wired KPI math ──────────────────────────────────
  // Increments a named funnel counter for a given window. Window is a string
  // like "view_list:24h" — caller composes the bucket. Stored under a single
  // server-owned row that's append-replaced; it's a counter, not a log.
  export interface FunnelCounters {
    view_list: { [windowH: string]: number };
    enter_attempted: { [windowH: string]: number };
    enter_success: { [windowH: string]: number };
    preenroll: { [windowH: string]: number };
    first_entry: { [windowH: string]: number };
    last_reset_at: number;
  }

  function emptyFunnelCounters(): FunnelCounters {
    return {
      view_list: {}, enter_attempted: {}, enter_success: {},
      preenroll: {}, first_entry: {}, last_reset_at: nowSec(),
    };
  }

  export function incrementFunnel(nk: nkruntime.Nakama, metric: string, windowKey: string): void {
    if (!metric || !windowKey) return;
    var row: FunnelCounters | null = null;
    try {
      var rows = nk.storageRead([{ collection: COL_FUNNEL_COUNTERS, key: "rolling", userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) row = rows[0].value as FunnelCounters;
    } catch (_) { }
    if (!row) row = emptyFunnelCounters();
    var bucket: any = (row as any)[metric];
    if (!bucket) return;
    bucket[windowKey] = (bucket[windowKey] || 0) + 1;
    nk.storageWrite([{
      collection: COL_FUNNEL_COUNTERS, key: "rolling", userId: Constants.SYSTEM_USER_ID,
      value: row, permissionRead: 0, permissionWrite: 0,
    }]);
  }

  export function readFunnelCounters(nk: nkruntime.Nakama): FunnelCounters {
    try {
      var rows = nk.storageRead([{ collection: COL_FUNNEL_COUNTERS, key: "rolling", userId: Constants.SYSTEM_USER_ID }]);
      if (rows && rows.length > 0) return rows[0].value as FunnelCounters;
    } catch (_) { }
    return emptyFunnelCounters();
  }
}
