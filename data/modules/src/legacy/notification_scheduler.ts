// ===========================================================================
//  In-process notification scheduler
// ---------------------------------------------------------------------------
//  Single Nakama match instance per pod that ticks once per second and fires
//  the LegacyPush.rpcNotifCron* handlers at their own cadence — no K8s
//  CronJob, no external scheduler, no AWS EventBridge required.
//
//  Why a match:
//    * Goja JS runtime resets between RPC calls, so setInterval() / setTimeout()
//      cannot survive across requests.
//    * Match handlers are the ONLY long-running Goja contexts Nakama exposes.
//    * Nakama config has `match.max_empty_sec 0`, so a player-less match runs
//      indefinitely until the process exits.
//
//  Multi-replica safety:
//    * Each Nakama pod creates its own scheduler match on boot (resilience:
//      cron keeps firing through partial outages / rolling deploys).
//    * Because N pods fire the SAME task at the SAME cadence boundary, the
//      per-user notif_send_markers dedup ALONE is not enough — it is written
//      AFTER the push is sent, so simultaneous pods all pass hasMarker() and
//      all send (prod symptom: daily quiz delivered 4–5×, one per live pod).
//    * dispatchSafely() therefore takes a cluster-wide CAS lock per
//      (task, period) via tryAcquireDispatchLock(): every pod computes the
//      same clock-aligned bucket and races to claim one system-owned storage
//      row (Nakama version OCC). Exactly ONE pod wins and dispatches; the
//      others skip. Per-user markers stay as a secondary cross-period guard.
//
//  Cadence (per-task):
//    Each task carries its own quiet-hours window check inside the cron
//    handler, so the scheduler just dispatches frequently enough to not miss
//    any user's local time window. 60 s tick is plenty.
//
//      daily_quiz       -> every 30 minutes (per-user 09:00-13:00 local gating)
//      weekly_quiz      -> every 60 minutes (5 types x 13 langs S3 reads)
//      idle_winback     -> every 30 minutes (per-user 11:00-19:00 local gating)
//      streak_warning   -> every 30 minutes (per-user 18:00-22:00 local gating)
//      motivation       -> every 60 minutes (per-user 12:00-18:00 + 3-day throttle)
//      reminders        -> every  5 minutes (per-user scheduled local time, 15-min grace)
//      review_due       -> every 30 minutes (per-user 17:00-21:00 local, once/day)
// ===========================================================================

namespace LegacyNotifScheduler {

  export var MATCH_NAME = "notif_scheduler_v1";

  export interface SchedulerState {
    // Last UTC minute we already dispatched each task (epoch / 60000).
    // Prevents double-firing when matchLoop runs faster than 1 Hz.
    lastDispatchedMinute: { [taskName: string]: number };
    // Last task we logged starting (best-effort visibility).
    lastLog: number;
  }

  export function nowMinute(): number {
    return Math.floor(Date.now() / 60000);
  }

  // Returns true when at least `periodMin` minutes have elapsed since this
  // task last fired. Elapsed-time semantics (vs "fire on minute boundary
  // m % periodMin === 0") so a delayed matchLoop tick — GC pause, pod
  // restart at :00, momentary load — doesn't cause us to skip the entire
  // 30-minute window. Trade-off: schedule drifts off-clock over time, but
  // every cron handler enforces a per-user once-per-day marker so users
  // never get duplicate pushes regardless of drift.
  //
  // First-call deferral: on a fresh match (new pod boot), `last` would be 0
  // and every task would fire on the very first tick (thundering herd
  // across 5 crons + a bunch of users on each). We instead initialize
  // `last = nowMinute()` so the first dispatch happens after `periodMin`
  // minutes — same cadence, no boot-time spike.
  export function shouldDispatch(state: SchedulerState, task: string, periodMin: number): boolean {
    var m = nowMinute();
    var last = state.lastDispatchedMinute[task];
    if (last === undefined || last === 0) {
      state.lastDispatchedMinute[task] = m;
      return false;
    }
    if (m - last < periodMin) return false;
    state.lastDispatchedMinute[task] = m;
    return true;
  }

  // ── Cluster-wide dispatch lock ─────────────────────────────────────────────
  // Each Nakama pod runs its OWN scheduler match (by design, for resilience),
  // so at every cadence boundary up to N pods fire the SAME task within the
  // same instant. The per-user notif_send_markers dedup is written AFTER the
  // push is sent, so concurrent pods all pass hasMarker() and all send before
  // any marker exists — production symptom: users received the daily quiz 4–5×
  // (one push per live pod). This lock makes each (task, period) idempotent
  // across the whole cluster: every pod computes the same period bucket and
  // races to claim a single system-owned storage row via optimistic
  // concurrency (version CAS). Exactly one pod wins and dispatches; the rest
  // skip. The per-user markers remain as a secondary, cross-period safety net.
  var DISPATCH_LOCK_COLLECTION = "notif_cron_dispatch_lock";
  var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

  export function tryAcquireDispatchLock(nk: nkruntime.Nakama, taskName: string, periodMin: number): boolean {
    // Clock-aligned bucket: identical for every pod inside the same period, so
    // simultaneous dispatchers collide on one storage key and CAS picks a
    // single winner.
    var bucket = Math.floor(nowMinute() / periodMin);
    try {
      var recs: any = nk.storageRead([{ collection: DISPATCH_LOCK_COLLECTION, key: taskName, userId: SYSTEM_USER_ID }]);
      var cur: any = (recs && recs.length > 0) ? recs[0] : null;
      if (cur && cur.value && cur.value.bucket === bucket) {
        // Another pod already claimed (and is running/ran) this period.
        return false;
      }
      // create-if-absent ("*") or compare-and-set against the version we read.
      // Nakama storageWrite throws on a version mismatch, so only ONE of the
      // racing pods succeeds; the losers land in catch and skip.
      nk.storageWrite([{
        collection: DISPATCH_LOCK_COLLECTION, key: taskName, userId: SYSTEM_USER_ID,
        value: { bucket: bucket, at: Date.now() },
        version: (cur && cur.version) ? cur.version : "*",
        permissionRead: 2, permissionWrite: 0
      }]);
      return true;
    } catch (_e) {
      // Version conflict (we lost the race) or transient storage error — either
      // way do not dispatch; a sibling pod has it, or the next tick retries.
      return false;
    }
  }

  // Wrap each cron call in try/catch so one task's exception cannot kill the
  // scheduler match. The handlers return JSON strings on success; we ignore
  // them. Non-fatal logging only. `periodMin` MUST match the shouldDispatch
  // cadence so the cluster lock buckets line up across pods.
  export function dispatchSafely(taskName: string, fn: Function, ctx: any, logger: nkruntime.Logger, nk: nkruntime.Nakama, periodMin: number): void {
    if (!tryAcquireDispatchLock(nk, taskName, periodMin)) return;
    try {
      var ret = fn(ctx, logger, nk, "");
      logger.info("[NotifScheduler] Dispatched %s: %s", taskName, String(ret).slice(0, 200));
    } catch (e: any) {
      logger.error("[NotifScheduler] Task %s failed: %s", taskName, e && e.message ? e.message : String(e));
    }
  }

  // ---- Match handler implementations (callable from the top-level wrappers
  //      that postbuild.js injects below the bundle). These live INSIDE the
  //      namespace so the source organization stays tidy, but they're invoked
  //      from the globally-scoped `notifSchedulerMatch<X>` wrappers in
  //      `data/modules/zz_notif_scheduler_handlers.js`, which is what Goja's
  //      AST walker actually picks up.
  //
  //      See data/modules/postbuild.js section 5b for the wrapper-injection
  //      logic and src/legacy/notification_scheduler.ts header for the
  //      "why a match" rationale.
  export function matchInitImpl(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, _params: { [k: string]: string }) {
    logger.info("[NotifScheduler] match init — tickRate=1, label=" + MATCH_NAME);
    return {
      state: { lastDispatchedMinute: {}, lastLog: 0 } as SchedulerState,
      tickRate: 1,
      label: MATCH_NAME
    };
  }

  export function matchJoinAttemptImpl(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, _presence: nkruntime.Presence, _metadata: { [k: string]: any }) {
    return { state: state, accept: false, rejectMessage: "scheduler match — no joins" };
  }

  export function matchJoinImpl(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, _presences: nkruntime.Presence[]) {
    return { state: state };
  }

  export function matchLeaveImpl(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, _presences: nkruntime.Presence[]) {
    return { state: state };
  }

  export function matchLoopImpl(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, _messages: nkruntime.MatchMessage[]) {
    if (shouldDispatch(state, "daily_quiz",      30)) dispatchSafely("daily_quiz",     LegacyPush.runDailyQuizCron,     ctx, logger, nk, 30);
    if (shouldDispatch(state, "weekly_quiz",     60)) dispatchSafely("weekly_quiz",    LegacyPush.runWeeklyQuizCron,    ctx, logger, nk, 60);
    if (shouldDispatch(state, "idle_winback",    30)) dispatchSafely("idle_winback",   LegacyPush.runIdleWinbackCron,   ctx, logger, nk, 30);
    if (shouldDispatch(state, "streak_warning",  30)) dispatchSafely("streak_warning", LegacyPush.runStreakWarningCron, ctx, logger, nk, 30);
    if (shouldDispatch(state, "motivation",      60)) dispatchSafely("motivation",     LegacyPush.runMotivationCron,    ctx, logger, nk, 60);
    if (shouldDispatch(state, "reminders",        5)) dispatchSafely("reminders",      LegacyPush.runRemindersCron,     ctx, logger, nk, 5);
    if (shouldDispatch(state, "review_due",       30)) dispatchSafely("review_due",     LegacyPush.runReviewCron,        ctx, logger, nk, 30);
    if (shouldDispatch(state, "flush_pending_push", 30) && tryAcquireDispatchLock(nk, "flush_pending_push", 30)) {
      try { LegacyPush.flushPendingRegistrations(ctx, logger, nk); } catch (_) {}
    }
    var m = nowMinute();
    if ((m % 60) === 0 && state.lastLog !== m) {
      state.lastLog = m;
      logger.info("[NotifScheduler] heartbeat — minute=%d", m);
    }
    return { state: state };
  }

  export function matchSignalImpl(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, data: string) {
    return { state: state, data: data };
  }

  export function matchTerminateImpl(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, graceSeconds: number) {
    logger.warn("[NotifScheduler] match terminating — grace=%ds", graceSeconds);
    return { state: state };
  }

  // Spawn one scheduler match for this Nakama process. Called LAZILY from
  // the first nakama_js_health invocation after boot (NOT from InitModule —
  // see main.ts comment for why). Idempotent within ONE Goja VM via the
  // `_spawned` flag AND across VMs via an nk.matchList() pre-check — k8s
  // liveness probes hit nakama_js_health every 30 s and we only want one
  // match per process.
  //
  // Why the matchList() pre-check: Nakama pools Goja VMs across RPC calls.
  // Module-scope `var _spawned` lives in one VM's heap; the next probe
  // call can land on a DIFFERENT pooled VM where `_spawned` is still false.
  // Production observation (build #380): the per-VM flag let every probe
  // create a fresh match, accumulating ~14 matches per pod per 10 minutes
  // (~2000/day per pod, all running at 1 Hz forever). matchList() is the
  // authoritative cross-VM check — matches are a server-process resource,
  // so the list is the same regardless of which VM queries it.
  //
  // Pod-scoped, not cluster-scoped: each Nakama pod creates and owns one
  // scheduler match. matchList() returns matches owned by THIS pod, which
  // is what we want — every pod needs its own scheduler so the cron tasks
  // keep firing after a partial outage.
  export var _spawned = false;
  export function spawnSchedulerMatch(logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
    if (_spawned) return;
    try {
      // Cross-VM dedup: check if a notif_scheduler_v1 match already exists
      // on this pod. matchList filters by label (set by matchInitImpl above
      // to MATCH_NAME). limit=1 + authoritative=true scopes to server-owned
      // matches we created ourselves.
      var existing: nkruntime.Match[] = [];
      try {
        existing = nk.matchList(1, true, MATCH_NAME) || [];
      } catch (_listErr) {
        // If matchList fails for any reason, fall through to matchCreate.
        // Creating a duplicate is preferable to leaving the scheduler dead.
      }
      if (existing.length > 0) {
        _spawned = true;
        logger.info("[NotifScheduler] Scheduler match already exists on this pod: " + existing[0].matchId + " — skipping spawn");
        return;
      }
      var matchId = nk.matchCreate(MATCH_NAME, {});
      _spawned = true;
      // String concatenation (not %s) — Goja's printf-style format silently
      // drops the message on some build configs, which is how production
      // build #380 had visible matchInit logs but zero "spawned" logs.
      logger.info("[NotifScheduler] Scheduler match spawned: " + matchId);
    } catch (e: any) {
      // Mark spawned even on failure to avoid log-spam every 30 s. A real
      // failure here is non-fatal — the cron RPCs remain callable via HTTP
      // for ops to fire manually, and the next pod restart will retry.
      _spawned = true;
      logger.error("[NotifScheduler] Failed to spawn scheduler match: " + (e && e.message ? e.message : String(e)));
    }
  }

  // Legacy entry point. The ACTUAL `initializer.registerMatch(...)` call is
  // injected by `data/modules/postbuild.js` into the generated InitModule
  // wrapper — Goja's AST walker (see nakama-source/server/runtime_javascript_init.go
  // @ 1828) only finds match registrations that are DIRECT statements in
  // InitModule's body AND whose handler properties resolve to top-level
  // (global-scope) function declarations. A registerMatch call nested inside
  // a helper like this one is invisible to that walker, which is why
  // builds #377/#378/#379 all logged
  //   'js match handler "matchInit" function for module "notif_scheduler_v1"
  //    global id could not be extracted: not found'
  // on every pod boot and the scheduler match never spawned.
  //
  // Kept as a no-op so the existing call site in src/main.ts and any
  // external IIFE auto-invokers (postbuild section 3b) remain safe.
  export function register(_initializer: nkruntime.Initializer): void {
    // postbuild handles the real registration. See section 5b in postbuild.js.
  }
}
