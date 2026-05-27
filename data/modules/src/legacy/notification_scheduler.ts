// ===========================================================================
//  In-process notification scheduler
// ---------------------------------------------------------------------------
//  Single Nakama match instance per pod that ticks once per second and fires
//  the LegacyPush.rpcNotifCron* handlers at their own cadence — no K8s
//  CronJob, no external scheduler, no AWS EventBridge required.
//
//  Why a match:
//    • Goja JS runtime resets between RPC calls, so setInterval() / setTimeout()
//      cannot survive across requests.
//    • Match handlers are the ONLY long-running Goja contexts Nakama exposes.
//    • Nakama config has `match.max_empty_sec 0`, so a player-less match runs
//      indefinitely until the process exits.
//
//  Multi-replica safety:
//    • Each Nakama pod creates its own scheduler match on boot.
//    • All five cron handlers already deduplicate per-user via the
//      `notif_send_markers` storage collection — first writer wins, others
//      see hasMarker() and skip. Worst-case cost across N pods is a few
//      extra storage reads per minute.
//
//  Cadence (per-task):
//    Each task carries its own quiet-hours window check inside the cron
//    handler, so the scheduler just dispatches frequently enough to not miss
//    any user's local time window. 60 s tick is plenty.
//
//      daily_quiz       → every 30 minutes (per-user 09:00–13:00 local gating)
//      weekly_quiz      → every 60 minutes (5 types × 13 langs S3 reads)
//      idle_winback     → every 30 minutes (per-user 11:00–19:00 local gating)
//      streak_warning   → every 30 minutes (per-user 18:00–22:00 local gating)
//      motivation       → every 60 minutes (per-user 12:00–18:00 + 3-day throttle)
// ===========================================================================

namespace LegacyNotifScheduler {

  export var MATCH_NAME = "notif_scheduler_v1";

  interface SchedulerState {
    // Last UTC minute we already dispatched each task (epoch / 60000).
    // Prevents double-firing when matchLoop runs faster than 1 Hz.
    lastDispatchedMinute: { [taskName: string]: number };
    // Last task we logged starting (best-effort visibility).
    lastLog: number;
  }

  function nowMinute(): number {
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
  function shouldDispatch(state: SchedulerState, task: string, periodMin: number): boolean {
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

  // Wrap each cron call in try/catch so one task's exception cannot kill the
  // scheduler match. The handlers return JSON strings on success; we ignore
  // them. Non-fatal logging only.
  function dispatchSafely(taskName: string, fn: Function, ctx: any, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
    try {
      var ret = fn(ctx, logger, nk, "");
      logger.info("[NotifScheduler] Dispatched %s: %s", taskName, String(ret).slice(0, 200));
    } catch (e: any) {
      logger.error("[NotifScheduler] Task %s failed: %s", taskName, e && e.message ? e.message : String(e));
    }
  }

  export var matchInit: nkruntime.MatchInitFunction<SchedulerState> = function(ctx, logger, nk, params) {
    logger.info("[NotifScheduler] match init — tickRate=1, label=" + MATCH_NAME);
    return {
      state: { lastDispatchedMinute: {}, lastLog: 0 },
      tickRate: 1,                       // 1 Hz — once per second
      label: MATCH_NAME
    };
  };

  // Headless: never accept any joiners. Scheduler runs without players.
  export var matchJoinAttempt: nkruntime.MatchJoinAttemptFunction<SchedulerState> = function(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    return { state: state, accept: false, rejectMessage: "scheduler match — no joins" };
  };

  export var matchJoin: nkruntime.MatchJoinFunction<SchedulerState> = function(ctx, logger, nk, dispatcher, tick, state, presences) {
    return { state: state };
  };

  export var matchLeave: nkruntime.MatchLeaveFunction<SchedulerState> = function(ctx, logger, nk, dispatcher, tick, state, presences) {
    return { state: state };
  };

  export var matchLoop: nkruntime.MatchLoopFunction<SchedulerState> = function(ctx, logger, nk, dispatcher, tick, state, messages) {
    // Direct calls into the cron functions inside LegacyPush. Note these
    // functions enforce `if (ctx.userId)` to reject user-token callers; the
    // match context has no userId so the admin gate passes.
    if (shouldDispatch(state, "daily_quiz",      30)) dispatchSafely("daily_quiz",     LegacyPush.runDailyQuizCron,     ctx, logger, nk);
    if (shouldDispatch(state, "weekly_quiz",     60)) dispatchSafely("weekly_quiz",    LegacyPush.runWeeklyQuizCron,    ctx, logger, nk);
    if (shouldDispatch(state, "idle_winback",    30)) dispatchSafely("idle_winback",   LegacyPush.runIdleWinbackCron,   ctx, logger, nk);
    if (shouldDispatch(state, "streak_warning",  30)) dispatchSafely("streak_warning", LegacyPush.runStreakWarningCron, ctx, logger, nk);
    if (shouldDispatch(state, "motivation",      60)) dispatchSafely("motivation",     LegacyPush.runMotivationCron,    ctx, logger, nk);

    // Heartbeat once per hour so we can verify the scheduler is alive in logs
    // without spamming. Best-effort; never throws.
    var m = nowMinute();
    if ((m % 60) === 0 && state.lastLog !== m) {
      state.lastLog = m;
      logger.info("[NotifScheduler] heartbeat — minute=%d", m);
    }

    return { state: state };
  };

  export var matchSignal: nkruntime.MatchSignalFunction<SchedulerState> = function(ctx, logger, nk, dispatcher, tick, state, data) {
    return { state: state, data: data };
  };

  export var matchTerminate: nkruntime.MatchTerminateFunction<SchedulerState> = function(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    logger.warn("[NotifScheduler] match terminating — grace=%ds", graceSeconds);
    return { state: state };
  };

  // Spawn one scheduler match for this Nakama process. Called LAZILY from
  // the first nakama_js_health invocation after boot (NOT from InitModule —
  // see main.ts comment for why). Idempotent across repeated calls within
  // the same Goja VM via the `_spawned` flag — k8s liveness probes hit
  // nakama_js_health every 30 s and we only want one match per process.
  //
  // `nk.matchCreate` returns a fresh match id every time it's called, so
  // without this flag a 30-second probe cadence would create 2 matches/min
  // (~2880/day) across the deployment. Each match holds a Goja loop
  // running at 1 Hz, so leaking them would trash CPU.
  export var _spawned = false;
  export function spawnSchedulerMatch(logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
    if (_spawned) return;
    try {
      var matchId = nk.matchCreate(MATCH_NAME, {});
      _spawned = true;
      logger.info("[NotifScheduler] Scheduler match spawned: %s", matchId);
    } catch (e: any) {
      // Mark spawned even on failure to avoid log-spam every 30 s. A real
      // failure here is non-fatal — the cron RPCs remain callable via HTTP
      // for ops to fire manually, and the next pod restart will retry.
      _spawned = true;
      logger.error("[NotifScheduler] Failed to spawn scheduler match: %s", e && e.message ? e.message : String(e));
    }
  }

  // Register the match handler. Call from InitModule.
  //
  // Defensive guard required (build #200 root-cause): postbuild.js scans
  // for "<NS>" + "." + "register = register;" patterns and auto-injects a
  // bare `register();` call right after each one. That trick populates
  // __rpc_* stubs on every pooled Goja VM. It works when the body is
  // only rewritten registerRpc lines, but registerMatch calls survive
  // unrewritten and would deref `undefined` at IIFE auto-invoke time —
  // throwing a TypeError that escapes the IIFE and halts the rest of
  // the bundle's top-level evaluation (~15 KB later, including the
  // JsRuntimeHealth IIFE). The smoke-test 404 from build #200 was that
  // exact path: the runtime loaded but nakama_js_health was never
  // assigned to its __rpc_ stub.
  //
  // The check below makes this function a no-op when called with an
  // undefined initializer (the IIFE auto-invoke case), so file evaluation
  // never aborts. The REAL handler registration still happens when
  // InitModule calls register() with the genuine initializer object.
  // (postbuild.js was also hardened to skip auto-invoke for any single-
  // param register whose body still touches initializer.something() —
  // belt + suspenders for future modules.)
  export function register(initializer: nkruntime.Initializer): void {
    if (!initializer || typeof initializer.registerMatch !== "function") return;
    // Literal "notif_scheduler_v1" REQUIRED here. Passing the namespaced
    // var (LegacyNotifScheduler.MATCH_NAME after TS compilation) is a
    // dynamic property lookup the Goja AST walker can NOT resolve, which
    // surfaces in prod as: '[Legacy] Failed to register legacy RPCs: js
    // match handler "matchInit" function for module "notif_scheduler_v1"
    // global id could not be extracted: not found'. The walker also
    // refuses to bind matchInit when its source is a function-EXPRESSION
    // assigned to a namespace var (`exports.matchInit = function(...)`).
    // Inline the handler functions in the registerMatch call so the
    // walker sees real function declarations in scope. See PRs #94 / #100
    // for the canonical analysis of this anti-pattern, and PR #97 for the
    // build-time linter that enforces it going forward.
    initializer.registerMatch<SchedulerState>("notif_scheduler_v1", {
      matchInit: matchInit,
      matchJoinAttempt: matchJoinAttempt,
      matchJoin: matchJoin,
      matchLeave: matchLeave,
      matchLoop: matchLoop,
      matchSignal: matchSignal,
      matchTerminate: matchTerminate
    });
  }
}
