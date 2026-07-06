// cache_refresh_cron.ts — Scheduled topic-cache refresh for QuizVerse question delivery.
//
// Populates qv_cache_{topic} via QvQuestionCache.refreshCache / refreshAllTopics.
// Unlike quizverse_prewarm_tick (qv_readyqueue), this RPC fills the server-side
// topic cache that get_questions reads on cache miss.
//
// RPC: quizverse_cache_refresh_tick
// Auth: RpcHelpers.requireAdmin (IVX admin / http_key server-to-server)
// Payload: { "mode": "cold_start" | "all" | "topic", "topic": "anime" }
//
// Modes:
//   cold_start — refresh anime, pokemon, movies, dog, flags, countries, video_quiz with 2 s stagger (post-deploy bootstrap)
//   all        — refreshAllTopics, gated to once per 6 h (qv_cache_refresh_state/last_full_run)
//   topic      — single-topic refreshCache (no global gate)

namespace QvCacheRefreshCron {

  var LOG_PREFIX           = "[QvCacheRefresh]";
  var COLD_START_TOPICS    = ["anime", "pokemon", "movies", "dog", "flags", "countries", "video_quiz"];
  var FULL_REFRESH_GATE_MS = 6 * 3600000;
  var COLD_STAGGER_MS      = 2000;
  var GATE_COL             = "qv_cache_refresh_state";
  var GATE_KEY             = "last_full_run";
  var SYSTEM_USER          = "00000000-0000-0000-0000-000000000000";

  function nowMs(): number { return Date.now(); }

  function sleep(ms: number): void {
    var end = nowMs() + ms;
    while (nowMs() < end) { /* spin — safe in admin/cron RPC only */ }
  }

  function formatLog(tag: string, fields: { [k: string]: string | number | boolean }): string {
    var parts: string[] = [LOG_PREFIX + tag];
    for (var fk in fields) {
      if (!fields.hasOwnProperty(fk)) continue;
      var fv = fields[fk];
      if (typeof fv === "boolean") {
        parts.push(fk + "=" + (fv ? "true" : "false"));
      } else if (typeof fv === "number") {
        parts.push(fk + "=" + String(fv));
      } else {
        parts.push(fk + "=" + String(fv).replace(/\s+/g, "_"));
      }
    }
    return parts.join(" ");
  }

  function acquireFullRefreshGate(nk: nkruntime.Nakama): boolean {
    try {
      var rows = nk.storageRead([{ collection: GATE_COL, key: GATE_KEY, userId: SYSTEM_USER }]);
      var lastRun: number = (rows && rows.length > 0 && rows[0].value && rows[0].value.last_run_ms)
        ? rows[0].value.last_run_ms : 0;
      if (nowMs() - lastRun < FULL_REFRESH_GATE_MS) return false;

      nk.storageWrite([{
        collection: GATE_COL, key: GATE_KEY, userId: SYSTEM_USER,
        value: { last_run_ms: nowMs() },
        permissionRead: 0, permissionWrite: 0
      }]);
      return true;
    } catch (_e) { return false; }
  }

  function refreshOneTopic(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    env:    { [k: string]: string },
    topic:  string
  ): { topic: string; ok: boolean; count: number; error?: string; elapsed_ms: number } {
    var t0 = nowMs();
    var r  = QvQuestionCache.refreshCache(nk, logger, env, topic);
    var elapsed = nowMs() - t0;
    logger.info(formatLog("[topic_result]", {
      event:      "cache_refresh_topic",
      topic:      topic,
      ok:         r.ok,
      count:      r.count,
      error:      r.error || "none",
      elapsed_ms: elapsed
    }));
    return {
      topic:      topic,
      ok:         r.ok,
      count:      r.count,
      error:      r.error,
      elapsed_ms: elapsed
    };
  }

  function runModeColdStart(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    env:    { [k: string]: string }
  ): Array<{ topic: string; ok: boolean; count: number; error?: string; elapsed_ms: number }> {
    var results: Array<{ topic: string; ok: boolean; count: number; error?: string; elapsed_ms: number }> = [];
    for (var i = 0; i < COLD_START_TOPICS.length; i++) {
      if (i > 0) sleep(COLD_STAGGER_MS);
      results.push(refreshOneTopic(nk, logger, env, COLD_START_TOPICS[i]));
    }
    return results;
  }

  function runModeTopic(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    env:    { [k: string]: string },
    topic:  string
  ): Array<{ topic: string; ok: boolean; count: number; error?: string; elapsed_ms: number }> {
    return [refreshOneTopic(nk, logger, env, topic)];
  }

  function runModeAll(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    env:    { [k: string]: string }
  ): { gated: boolean; results: Array<{ topic: string; ok: boolean; count: number; error?: string }> } {
    if (!acquireFullRefreshGate(nk)) {
      return { gated: true, results: [] };
    }
    var raw = QvQuestionCache.refreshAllTopics(nk, logger, env);
    var results: Array<{ topic: string; ok: boolean; count: number; error?: string }> = [];
    for (var i = 0; i < raw.length; i++) {
      results.push({
        topic: raw[i].topic,
        ok:    raw[i].ok,
        count: raw[i].count,
        error: raw[i].error
      });
    }
    return { gated: false, results: results };
  }

  function countSucceeded(results: Array<{ ok: boolean }>): number {
    var n = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].ok) n++;
    }
    return n;
  }

  function rpcCacheRefreshTick(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    RpcHelpers.requireAdmin(ctx, nk);

    var req: any = {};
    try { req = JSON.parse(payload || "{}"); } catch (_pe) {
      throw new Error(JSON.stringify({ code: 3, message: "invalid JSON payload" }));
    }

    var mode = (typeof req.mode === "string") ? req.mode.toLowerCase().trim() : "";
    if (mode !== "cold_start" && mode !== "all" && mode !== "topic") {
      throw new Error(JSON.stringify({ code: 3, message: "mode must be cold_start, all, or topic" }));
    }

    var topic = (typeof req.topic === "string") ? req.topic.toLowerCase().trim() : "";
    if (mode === "topic" && !topic) {
      throw new Error(JSON.stringify({ code: 3, message: "topic is required when mode=topic" }));
    }

    var env     = ctx.env || {};
    var started = nowMs();
    var topicCount = mode === "cold_start" ? COLD_START_TOPICS.length : (mode === "topic" ? 1 : 0);

    logger.info(formatLog("[tick_start]", {
      event:       "cache_refresh_tick_start",
      mode:        mode,
      topic_count: topicCount,
      topic:       topic || "none"
    }));

    var results: Array<{ topic: string; ok: boolean; count: number; error?: string; elapsed_ms?: number }> = [];
    var gated = false;

    if (mode === "cold_start") {
      results = runModeColdStart(nk, logger, env);
    } else if (mode === "topic") {
      results = runModeTopic(nk, logger, env, topic);
    } else {
      var allRun = runModeAll(nk, logger, env);
      gated   = allRun.gated;
      results = allRun.results;
      if (gated) {
        var elapsedGated = nowMs() - started;
        logger.info(formatLog("[tick_done]", {
          event:      "cache_refresh_tick_done",
          mode:       mode,
          gated:      true,
          succeeded:  0,
          failed:     0,
          elapsed_ms: elapsedGated
        }));
        return JSON.stringify({
          ok:         true,
          skipped:    true,
          mode:       mode,
          reason:     "within_full_refresh_gate",
          elapsed_ms: elapsedGated
        });
      }
    }

    var elapsedMs = nowMs() - started;
    var succeeded = countSucceeded(results);
    var failed    = results.length - succeeded;

    logger.info(formatLog("[tick_done]", {
      event:      "cache_refresh_tick_done",
      mode:       mode,
      succeeded:  succeeded,
      failed:     failed,
      elapsed_ms: elapsedMs
    }));

    return JSON.stringify({
      ok:         true,
      mode:       mode,
      results:    results,
      elapsed_ms: elapsedMs
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_cache_refresh_tick", rpcCacheRefreshTick);
  }

  /**
   * InitModule boot hook: seed video_quiz catalog from the postbuild embed, then
   * force-warm qv_cache_video_quiz. Safe to call on every deploy/restart.
   */
  export function bootOnInit(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    env:    { [k: string]: string }
  ): void {
    try {
      var seed = QvQuestionCache.ensureVideoQuizCatalogSeeded(nk, logger);
      if (!seed.ok) {
        logger.warn(formatLog("[boot_video_quiz]", {
          event: "video_quiz_catalog_seed_skipped",
          error: seed.error || "unknown"
        }));
        return;
      }
      var warm = QvQuestionCache.refreshCache(nk, logger, env, "video_quiz", true);
      logger.info(formatLog("[boot_video_quiz]", {
        event:          "video_quiz_boot_complete",
        seed_ok:        seed.ok,
        seed_skipped:   !!seed.skipped,
        version:        seed.version || "none",
        question_count: seed.question_count || 0,
        cache_ok:       warm.ok,
        cache_count:    warm.count,
        cache_error:    warm.error || "none"
      }));
    } catch (err: any) {
      logger.error(formatLog("[boot_video_quiz]", {
        event: "video_quiz_boot_failed",
        error: (err && err.message) ? err.message : String(err)
      }));
    }
  }

  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
