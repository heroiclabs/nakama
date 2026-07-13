// sq_rpcs.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seed Questions ("Staged Questions") — RPC surface.
//
// Public host: https://seedquestions.intelli-verse-x.ai/v2/rpc/<rpc_id>
// (deploy/seedquestions/ ingress → intelliverse-nakama:7350). Same RPCs are
// reachable on the primary nakama-rest host — the subdomain is a dedicated,
// rate-limitable surface for the client + live-ops tooling.
//
// USER RPCs (session auth):
//   quizverse_seedq_get_staged    → 2–3 ready sets for (mode, topic); auto top-up
//   quizverse_seedq_consume_set   → mark set played; merge ids into qv_seen; restage
//   quizverse_seedq_review        → up/down/flag(reason) a question (quality loop)
//   quizverse_seedq_focus_tracks  → Focus/Study Mode ambient tracks (source #11)
//   quizverse_seedq_sources       → 13-connector registry + status (also public info)
//
// ADMIN / SERVICE RPCs (http_key server-to-server OR service_token ==
// ctx.env["SEEDQ_SERVICE_TOKEN"]):
//   quizverse_seedq_ingest        → run one connector into a (mode, topic) pool
//   quizverse_seedq_ingest_tick   → cron rotation across the combo matrix
//   quizverse_seedq_pool_stats    → pool/review/staging observability
//   quizverse_seedq_asset_job     → remove.bg / ASO-mockup / art-cleanup job descriptors
//   quizverse_seedq_provenance    → TinEye/whitelist provenance check for an image URL
//
// Cron wiring (same pattern as kb_enrichment_tick / tournament_cron_tick):
//   curl -sS -X POST "http://nakama:7350/v2/rpc/quizverse_seedq_ingest_tick?http_key=<key>&unwrap" \
//        -H 'Content-Type: application/json' \
//        -d '{"service_token":"<SEEDQ_SERVICE_TOKEN>","batch":3,"count":20}'

namespace SeedQuestions {

  function errPayload(code: number, message: string): string {
    return JSON.stringify({ ok: false, code: code, error: message });
  }

  function parse(payload: string): any {
    if (!payload || payload === "") return {};
    try { return JSON.parse(payload); } catch (e) {
      throw new Error(JSON.stringify({ code: 3, message: "payload must be valid JSON" }));
    }
  }

  function isAdminOrService(ctx: nkruntime.Context, data: any): boolean {
    return SeedQ.isHttpKeyAdmin(ctx, data);
  }

  // ── quizverse_seedq_get_staged ──────────────────────────────────────────────
  // Request:  { mode, topic, set_size?, want_sets? }
  // Response: { ok, sets: StagedSet[], adaptive, pool: {...}, module_version }
  function rpcGetStaged(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = parse(payload);
    if (!ctx.userId) return errPayload(16, "session required");
    var mode = "" + (data.mode || "");
    var topic = "" + (data.topic || "general");
    if (!mode) return errPayload(3, "mode required");

    var setSize = SeedQ.clampInt(data.set_size, 4, SeedQ.MAX_SET_SIZE, SeedQ.DEFAULT_SET_SIZE);
    var wantSets = SeedQ.clampInt(data.want_sets, 1, SeedQ.TARGET_READY_SETS, SeedQ.TARGET_READY_SETS);

    var result = SeedQEngine.ensureStaged(ctx, nk, logger, ctx.userId, mode, topic, wantSets, setSize);

    // Repetition-fatigue metadata (D1 §6.2): the client renders honest copy
    // ("8 new + 2 Smart Review repeats") and — when pool_exhausted — fires the
    // wow.e.pool_exhausted intercept INSTEAD of the App Store rating prompt.
    var repeatPolicy = {
      fresh_count: result.fresh_count,
      review_count: result.review_count,
      pool_exhausted: result.pool_exhausted,
      content_generation_queued: result.content_generation_queued,
      next_refresh_eta_seconds: result.next_refresh_eta_sec
    };
    var suppressRating = result.pool_exhausted || result.recycled ||
      (result.fresh_count < result.review_count);

    return JSON.stringify({
      ok: true,
      mode: mode,
      topic: topic,
      sets: result.ready,
      sets_built_now: result.built,
      recycled: result.recycled,
      adaptive: result.adaptive,
      pool: { size: result.pool_size, available_unseen: result.pool_available },
      repeat_policy: repeatPolicy,
      suppress_rating_prompt: suppressRating,
      module_version: SeedQ.MODULE_VERSION
    });
  }

  // ── quizverse_seedq_consume_set ─────────────────────────────────────────────
  // Request:  { mode, topic, set_id, restage? }
  // Response: { ok, merged_seen, restaged: {...} }
  function rpcConsumeSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = parse(payload);
    if (!ctx.userId) return errPayload(16, "session required");
    var mode = "" + (data.mode || "");
    var topic = "" + (data.topic || "general");
    var setId = "" + (data.set_id || "");
    if (!mode || !setId) return errPayload(3, "mode and set_id required");

    var res = SeedQEngine.consumeSet(ctx, nk, logger, ctx.userId, mode, topic, setId);
    if (!res.found) return errPayload(5, "set not found: " + setId);

    var restaged: any = null;
    var poolExhausted = false;
    if (data.restage !== false) {
      var r = SeedQEngine.ensureStaged(ctx, nk, logger, ctx.userId, mode, topic, SeedQ.TARGET_READY_SETS, SeedQ.DEFAULT_SET_SIZE);
      poolExhausted = r.pool_exhausted;
      restaged = {
        ready_sets: r.ready.length, built_now: r.built, pool_available: r.pool_available,
        pool_exhausted: r.pool_exhausted, content_generation_queued: r.content_generation_queued
      };
    }
    return JSON.stringify({ ok: true, merged_seen: res.merged, restaged: restaged, suppress_rating_prompt: poolExhausted });
  }

  // ── quizverse_seedq_review ──────────────────────────────────────────────────
  // Request:  { mode, topic, question_id, vote: "up"|"down"|"flag", reason? }
  // Response: { ok, quarantined, duplicate_vote, counts }
  function rpcReview(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = parse(payload);
    if (!ctx.userId) return errPayload(16, "session required");
    var mode = "" + (data.mode || "");
    var topic = "" + (data.topic || "general");
    var qid = "" + (data.question_id || "");
    var vote = "" + (data.vote || "");
    if (!mode || !qid) return errPayload(3, "mode and question_id required");
    if (vote !== "up" && vote !== "down" && vote !== "flag") return errPayload(3, "vote must be up|down|flag");

    var res = SeedQQuality.applyReview(nk, logger, ctx.userId, mode, topic, qid, vote, "" + (data.reason || "other"));
    return JSON.stringify({
      ok: true,
      quarantined: res.quarantined,
      duplicate_vote: res.duplicate,
      counts: { up: res.entry.up, down: res.entry.down, flags: res.entry.flags }
    });
  }

  // ── quizverse_seedq_focus_tracks ────────────────────────────────────────────
  function rpcFocusTracks(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var doc = SeedQSources.getFocusTracks(nk, logger);
    return JSON.stringify({ ok: true, tracks: doc.tracks || [], pattern_references: doc.pattern_references || [], fetched_ms: doc.fetched_ms || 0 });
  }

  // ── quizverse_seedq_sources ─────────────────────────────────────────────────
  function rpcSources(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var regs = SeedQSources.registry();
    // Annotate env-key presence so live-ops can see what's unlocked.
    for (var i = 0; i < regs.length; i++) {
      var present: string[] = [];
      for (var k = 0; k < regs[i].env_keys.length; k++) {
        var key = regs[i].env_keys[k];
        if (ctx.env && ctx.env[key]) present.push(key);
      }
      (regs[i] as any).env_keys_present = present;
    }
    return JSON.stringify({ ok: true, sources: regs, module_version: SeedQ.MODULE_VERSION });
  }

  // ── quizverse_seedq_ingest (admin/service) ──────────────────────────────────
  // Request: { service_token?, source, mode, topic, count?, params?, questions? }
  // `questions` allows direct authored/CMS ingest through the same QA gate.
  function rpcIngest(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = parse(payload);
    if (!isAdminOrService(ctx, data)) return errPayload(7, "admin or service_token required");
    var mode = "" + (data.mode || "");
    var topic = "" + (data.topic || "general");
    if (!mode) return errPayload(3, "mode required");

    var candidates: SeedQ.SeedQuestion[] = [];
    var source = "" + (data.source || "");
    if (data.questions && data.questions.length > 0) {
      for (var i = 0; i < data.questions.length; i++) {
        var raw = data.questions[i];
        if (!raw || !raw.question || !raw.options) continue;
        var q: SeedQ.SeedQuestion = {
          id: "", question: "" + raw.question, options: raw.options,
          correct_index: SeedQ.clampInt(raw.correct_index, 0, 7, 0),
          explanation: "" + (raw.explanation || ""), category: "" + (raw.category || topic),
          topic: topic, mode: mode, difficulty: SeedQ.clampInt(raw.difficulty, 1, 5, 3),
          question_type: "" + (raw.question_type || "Text"),
          media_url: "" + (raw.media_url || ""), media_provenance: null,
          source: source || "manual", citation: "" + (raw.citation || ""), lang: "" + (raw.lang || "en"),
          created_ms: SeedQ.nowMs(), quality: { score: 0, status: "pending", checks: [] }
        };
        q.id = SeedQ.questionId(nk, q.source, q.question, q.options);
        candidates.push(q);
      }
    } else {
      if (!source) return errPayload(3, "source required (or inline questions[])");
      if (SeedQSources.QUESTION_SOURCES.indexOf(source) < 0) {
        return errPayload(3, "unknown question source '" + source + "'. Available: " + SeedQSources.QUESTION_SOURCES.join(", "));
      }
      var count = SeedQ.clampInt(data.count, 1, 100, 20);
      candidates = SeedQSources.fetchQuestions(ctx, nk, logger, source, mode, topic, count, data.params || {});
    }

    var res = SeedQEngine.ingestIntoPool(ctx, nk, logger, mode, topic, candidates);
    logger.info("[SeedQ] ingest source=" + source + " mode=" + mode + " topic=" + topic +
      " fetched=" + candidates.length + " accepted=" + res.accepted + " rejected=" + res.rejected);
    return JSON.stringify({ ok: true, source: source, mode: mode, topic: topic, fetched: candidates.length, result: res });
  }

  // ── quizverse_seedq_ingest_tick (cron) ──────────────────────────────────────
  // Request: { service_token?, batch?, count? }
  function rpcIngestTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = parse(payload);
    if (!isAdminOrService(ctx, data)) return errPayload(7, "admin or service_token required");
    var batch = SeedQ.clampInt(data.batch, 1, 8, 3);
    var count = SeedQ.clampInt(data.count, 5, 60, 20);
    var res = SeedQEngine.ingestTick(ctx, nk, logger, batch, count);
    return JSON.stringify({ ok: true, tick: res });
  }

  // ── quizverse_seedq_pool_stats (admin/service) ──────────────────────────────
  function rpcPoolStats(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = parse(payload);
    if (!isAdminOrService(ctx, data)) return errPayload(7, "admin or service_token required");

    var idx = SeedQ.readSystem(nk, SeedQ.COLL_POOL_INDEX, "index") || { keys: {} };
    var keys = Object.keys(idx.keys || {});
    var pools: any[] = [];
    for (var i = 0; i < keys.length; i++) {
      var meta = idx.keys[keys[i]];
      var pool = SeedQ.readSystem(nk, SeedQ.COLL_POOL, keys[i]) || { questions: [] };
      var review = SeedQ.readSystem(nk, SeedQ.COLL_REVIEW, keys[i]);
      var quarantined = 0;
      if (review && review.entries) {
        var rk = Object.keys(review.entries);
        for (var r = 0; r < rk.length; r++) if (review.entries[rk[r]].status === "quarantined") quarantined++;
      }
      var bySource: { [s: string]: number } = {};
      var byDifficulty: { [d: string]: number } = {};
      for (var qi = 0; qi < pool.questions.length; qi++) {
        var q = pool.questions[qi];
        bySource[q.source] = (bySource[q.source] || 0) + 1;
        byDifficulty["d" + (q.difficulty || 3)] = (byDifficulty["d" + (q.difficulty || 3)] || 0) + 1;
      }
      pools.push({
        key: keys[i], mode: meta.mode, topic: meta.topic,
        size: pool.questions.length, quarantined: quarantined,
        by_source: bySource, by_difficulty: byDifficulty,
        updated_ms: pool.updated_ms || 0
      });
    }

    var state = SeedQ.readSystem(nk, SeedQ.COLL_INGEST_STATE, "state") || {};
    return JSON.stringify({ ok: true, pools: pools, ingest_state: { cursor: state.cursor || 0, runs: state.runs || 0, last_run_ms: state.last_run_ms || 0 }, module_version: SeedQ.MODULE_VERSION });
  }

  // ── quizverse_seedq_asset_job (admin/service) ───────────────────────────────
  // Request: { service_token?, kind: "removebg"|"aso_mockups"|"art_cleanup", params? }
  function rpcAssetJob(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = parse(payload);
    if (!isAdminOrService(ctx, data)) return errPayload(7, "admin or service_token required");
    var res = SeedQSources.buildAssetJob(ctx, "" + (data.kind || ""), data.params || {});
    return JSON.stringify(res);
  }

  // ── quizverse_seedq_provenance (admin/service) ──────────────────────────────
  // Request: { service_token?, image_url }
  function rpcProvenance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = parse(payload);
    if (!isAdminOrService(ctx, data)) return errPayload(7, "admin or service_token required");
    var url = "" + (data.image_url || "");
    if (!url) return errPayload(3, "image_url required");
    var prov = SeedQQuality.checkProvenance(ctx, nk, logger, url);
    return JSON.stringify({ ok: true, provenance: prov, safe: prov.license !== "unknown" });
  }

  // ── Registration ────────────────────────────────────────────────────────────
  // Single-arg register() with string-literal rpc ids: postbuild.js rewrites
  // each call to a __rpc_ stub assignment and auto-invokes register() on every
  // pooled Goja VM (see nakama-rpc skill / postbuild.js autoInvokeRegister).
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_seedq_get_staged", rpcGetStaged);
    initializer.registerRpc("quizverse_seedq_consume_set", rpcConsumeSet);
    initializer.registerRpc("quizverse_seedq_review", rpcReview);
    initializer.registerRpc("quizverse_seedq_focus_tracks", rpcFocusTracks);
    initializer.registerRpc("quizverse_seedq_sources", rpcSources);
    initializer.registerRpc("quizverse_seedq_ingest", rpcIngest);
    initializer.registerRpc("quizverse_seedq_ingest_tick", rpcIngestTick);
    initializer.registerRpc("quizverse_seedq_pool_stats", rpcPoolStats);
    initializer.registerRpc("quizverse_seedq_asset_job", rpcAssetJob);
    initializer.registerRpc("quizverse_seedq_provenance", rpcProvenance);
  }
}
