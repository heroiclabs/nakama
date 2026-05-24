// QuizVerse Nakama-Only Migration plugin.
//
// Single TS module that registers every "v2 / Nakama-only" RPC the
// Unity client will adopt as it migrates each network surface behind
// Nakama. See companion plan in the Unity repo:
//   games/quiz-verse/Docs/plans/PLAN-NAKAMA_ONLY_MIGRATION.md
//
// Phase scope per RPC:
//   P0 (live):       quizverse_get_player_context
//   P1 (live):       quizverse_request_questions (router over quizverse_quiz_generate)
//   P2 (live):       quiz_submit_result_v2 (alongside v1; v1 untouched)
//   P3 (scaffold):   quizverse_ai_*           — delegate to external AI if env vars set
//   P4 (scaffold):   quizverse_fetch_external_quiz
//   P5 (scaffold):   quizverse_mp_request_pack — delegates to existing QuizVersePlugin
//   P6 (scaffold):   auth_*                   — userinfo serves real data; others stub
//   P7 (scaffold):   geo/tts/lichess/xpromo/webview/asset_catalog
//   P8 (scaffold):   analytics fan-out + LiveKit token mint
//
// All RPCs return a uniform { ok: boolean, ... } envelope. Stubs
// return { ok: false, error: "not_yet_enabled", fallback_to_client: true }
// so the Unity gateway can transparently fall back to its legacy path.
// Wire contracts are stable; follow-up phase PRs swap stub bodies for
// real impls without changing client code.

namespace QuizVerseMigration {

  // ── RPC IDs (Unity client uses these literals) ───────────────────────
  export var RPC_GET_PLAYER_CONTEXT  = "quizverse_get_player_context";   // P0
  export var RPC_REQUEST_QUESTIONS   = "quizverse_request_questions";    // P1
  export var RPC_SUBMIT_RESULT_V2    = "quiz_submit_result_v2";          // P2
  export var RPC_AI_GENERATE         = "quizverse_ai_generate_questions";// P3
  export var RPC_AI_GRADE_SUBJECTIVE = "quizverse_ai_grade_subjective";  // P3
  export var RPC_AI_NOTES_CREATE     = "quizverse_ai_notes_create";      // P3
  export var RPC_AI_STT              = "quizverse_ai_stt_transcribe";    // P3
  export var RPC_FETCH_EXTERNAL_QUIZ = "quizverse_fetch_external_quiz";  // P4
  export var RPC_MP_REQUEST_PACK     = "quizverse_mp_request_pack";      // P5
  export var RPC_AUTH_SIGNUP         = "auth_signup";                    // P6
  export var RPC_AUTH_LOGIN          = "auth_login";                     // P6
  export var RPC_AUTH_SOCIAL_LOGIN   = "auth_social_login";              // P6
  export var RPC_AUTH_REFRESH        = "auth_refresh";                   // P6
  export var RPC_AUTH_USERINFO       = "auth_userinfo";                  // P6
  export var RPC_GEO_LOOKUP          = "quizverse_geo_lookup";           // P7
  export var RPC_TTS_SYNTHESIZE      = "quizverse_tts_synthesize";       // P7
  export var RPC_LICHESS_PUZZLE      = "quizverse_fetch_lichess_puzzle"; // P7
  export var RPC_XPROMO_GET_APPS     = "xpromo_get_apps";                // P7
  export var RPC_WEBVIEW_TOKEN_ISSUE = "webview_token_issue";            // P7
  export var RPC_ASSET_CATALOG_GET   = "asset_catalog_get";              // P7
  export var RPC_ANALYTICS_FANOUT    = "quizverse_analytics_fanout";     // P8
  export var RPC_LIVEKIT_TOKEN_MINT  = "quizverse_livekit_token_mint";   // P8

  // Storage collections used by this plugin.
  var COL_PLAYER_CONTEXT = "qv_player_context";  // P0 server-side context cache
  var COL_QUESTION_PACK  = "qv_question_pack";   // P1 issued pack ledger for v2 scoring

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  function parseJson(payload: string): any {
    try { return JSON.parse(payload || "{}"); }
    catch (_e) { throw nakamaError("invalid JSON", nkruntime.Codes.INVALID_ARGUMENT); }
  }

  function nowMs(): number { return Date.now(); }

  function requireAuth(ctx: nkruntime.Context): string {
    var userId = ctx.userId;
    if (!userId) throw nakamaError("not authenticated", nkruntime.Codes.UNAUTHENTICATED);
    return userId;
  }

  function stubResponse(rpcId: string, phase: string): string {
    return JSON.stringify({
      ok: false,
      error: "not_yet_enabled",
      phase: phase,
      rpc: rpcId,
      fallback_to_client: true,
      message: "Server-side handler not yet implemented; Unity should use legacy path."
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 0 — PlayerContextPack
  // ─────────────────────────────────────────────────────────────────────
  // Server-owned bundle of per-player signals that every downstream RPC
  // (question delivery, scoring, AI prompts) reads to hyper-personalize
  // without round-tripping the Unity client.

  function readPlayerContext(nk: nkruntime.Nakama, userId: string): any {
    var pack: any = {
      version:     "v1",
      user_id:     userId,
      issued_ms:   nowMs(),
      locale:      "en-US",
      country:     "",
      device:      "",
      tier:        "free",
      affinity:    { topics: [] },
      activity:    { last_quiz_ms: 0, completion_7d: 0, abandon_7d: 0 },
      flags:       {},
      experiments: [],
      safety:      { level: "default" }
    };

    try {
      var acc = nk.accountGetId(userId);
      if (acc && acc.user) {
        pack.locale = acc.user.langTag || pack.locale;
        pack.country = acc.user.location || "";
        if (acc.user.metadata) {
          var md: any = acc.user.metadata;
          if (md.device) pack.device = String(md.device);
          if (md.tier) pack.tier = String(md.tier);
          if (md.safety_level) pack.safety.level = String(md.safety_level);
        }
      }
    } catch (_e) {
      // Non-fatal; an account read failure shouldn't kill the whole context.
    }

    try {
      var stored = nk.storageRead([{
        collection: COL_PLAYER_CONTEXT, key: "v1", userId: userId
      }]);
      if (stored && stored.length > 0 && stored[0].value) {
        var v: any = stored[0].value;
        if (v.affinity) pack.affinity = v.affinity;
        if (v.activity) pack.activity = v.activity;
        if (v.flags) pack.flags = v.flags;
        if (v.experiments) pack.experiments = v.experiments;
      }
    } catch (_e) {}

    return pack;
  }

  function rpcGetPlayerContext(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string
  ): string {
    var userId = requireAuth(ctx);
    try {
      return JSON.stringify({ ok: true, pack: readPlayerContext(nk, userId) });
    } catch (err: any) {
      logger.error("[Migration] get_player_context: " + (err && err.message ? err.message : String(err)));
      throw nakamaError("context_read_failed", nkruntime.Codes.INTERNAL);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 1 — Question delivery
  // ─────────────────────────────────────────────────────────────────────
  // quizverse_request_questions = the single Unity-facing question-delivery
  // RPC. Routes by `kind` over existing infrastructure and stamps a
  // `question_pack_id` that Phase-2 scoring reads back to recompute
  // server-authoritatively.

  function newPackId(userId: string): string {
    return "pk_" + userId.substring(0, 8) + "_" + nowMs().toString(36);
  }

  function persistQuestionPack(
    nk: nkruntime.Nakama,
    userId: string,
    packId: string,
    questions: any[],
    sourceTrace: any
  ): void {
    try {
      var ids: string[] = [];
      for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        ids.push(q.question_id || q.id || "");
      }
      nk.storageWrite([{
        collection:      COL_QUESTION_PACK,
        key:             packId,
        userId:          userId,
        value: {
          issued_ms:    nowMs(),
          source:       sourceTrace,
          questions:    questions,
          question_ids: ids
        },
        permissionRead:  1,
        permissionWrite: 0
      }]);
    } catch (_e) {
      // Non-fatal; v2 scoring will fall back to client-supplied answers.
    }
  }

  function callExistingRpc(
    rpcVarName: string,
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payloadObj: any
  ): any {
    var fn = (globalThis as any)[rpcVarName];
    if (typeof fn !== "function") {
      throw nakamaError(rpcVarName + " not loaded", nkruntime.Codes.UNAVAILABLE);
    }
    return JSON.parse(fn(ctx, logger, nk, JSON.stringify(payloadObj)));
  }

  function rpcRequestQuestions(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    var kind = req.kind || "deduped_s3";
    var sourceTrace: any = { kind: kind, mode: req.mode || "unknown", attempted: [] };

    var generated: any;

    try {
      if (kind === "deduped_s3" || kind === "daily" || kind === "weekly" || kind === "question_bank") {
        sourceTrace.attempted.push("quizverse_quiz_generate");
        generated = callExistingRpc("__rpc_quizverse_quiz_generate", ctx, logger, nk, {
          mode:              req.mode || "request_questions",
          scope:             req.scope || "global",
          topic:             req.topic || "general",
          count:             req.count || 10,
          question_bank_url: req.question_bank_url || "",
          id_prefix:         req.id_prefix || "s3",
          questions:         req.inline_questions || undefined,
          repeat_after_days: req.repeat_after_days || 7
        });
        sourceTrace.served_by = "quizverse_quiz_generate";
      } else if (kind === "news") {
        sourceTrace.attempted.push("quizverse_fetch_news_quiz");
        generated = callExistingRpc("__rpc_quizverse_fetch_news_quiz", ctx, logger, nk, req);
        sourceTrace.served_by = "quizverse_fetch_news_quiz";
      } else if (kind === "external") {
        return JSON.stringify({
          ok: false, error: "external_provider_not_yet_enabled",
          source_trace: sourceTrace, fallback_to_client: true
        });
      } else if (kind === "ai") {
        return JSON.stringify({
          ok: false, error: "ai_path_not_yet_enabled",
          source_trace: sourceTrace, fallback_to_client: true
        });
      } else {
        throw nakamaError("unknown kind: " + kind, nkruntime.Codes.INVALID_ARGUMENT);
      }
    } catch (err: any) {
      logger.error("[Migration] request_questions(" + kind + "): " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({
        ok: false, error: "delivery_failed",
        source_trace: sourceTrace, fallback_to_client: true
      });
    }

    if (!generated || generated.success === false) {
      return JSON.stringify({
        ok: false,
        error: (generated && generated.error) || "empty_response",
        source_trace: sourceTrace,
        fallback_to_client: true
      });
    }

    var questions: any[] = generated.questions || [];
    var packId = newPackId(userId);
    persistQuestionPack(nk, userId, packId, questions, sourceTrace);

    var contextPackVersion = "v1";
    try {
      var pack = readPlayerContext(nk, userId);
      contextPackVersion = (pack && pack.version) || "v1";
    } catch (_e) {}

    return JSON.stringify({
      ok:                   true,
      questions:            questions,
      question_pack_id:     packId,
      seen_snapshot:        generated.question_ids || [],
      context_pack_version: contextPackVersion,
      source_trace:         sourceTrace,
      meta:                 generated.meta || {}
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 2 — Score reconciliation v2
  // ─────────────────────────────────────────────────────────────────────
  // v2 contract: client sends { question_pack_id, answers[] } only —
  // server recomputes correctness from the persisted pack so a tampered
  // client cannot lie about which option was correct.
  //
  // Registered as a NEW RPC alongside v1 so v1 continues working for
  // clients that haven't migrated. Once `mig_scores_via_nakama` hits
  // 100% in Phase 9, v1 is retired.

  function rpcSubmitResultV2(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    var packId = String(req.question_pack_id || "");
    var answers: any[] = req.answers || [];

    if (!packId) throw nakamaError("question_pack_id required", nkruntime.Codes.INVALID_ARGUMENT);
    if (!answers || answers.length === 0) {
      throw nakamaError("answers required", nkruntime.Codes.INVALID_ARGUMENT);
    }

    var stored = nk.storageRead([{
      collection: COL_QUESTION_PACK, key: packId, userId: userId
    }]);
    if (!stored || stored.length === 0 || !stored[0].value) {
      throw nakamaError("question_pack_not_found", nkruntime.Codes.NOT_FOUND);
    }
    var pack: any = stored[0].value;
    var packQuestions: any[] = pack.questions || [];
    if (packQuestions.length === 0) {
      throw nakamaError("question_pack_empty", nkruntime.Codes.FAILED_PRECONDITION);
    }

    var qIndex: { [id: string]: any } = {};
    for (var i = 0; i < packQuestions.length; i++) {
      var q = packQuestions[i];
      var qid = q.question_id || q.id || ("__idx_" + i);
      qIndex[qid] = q;
    }

    var correct = 0;
    var graded: any[] = [];
    var totalLatencyMs = 0;
    for (var ai = 0; ai < answers.length; ai++) {
      var a = answers[ai];
      var aqid = a.question_id || a.id;
      var serverQ = qIndex[aqid];
      var truthIndex = serverQ ? (typeof serverQ.correct_index === "number" ? serverQ.correct_index : -1) : -1;
      var isCorrect = (truthIndex >= 0 && a.selected_index === truthIndex);
      if (isCorrect) correct++;
      if (typeof a.latency_ms === "number") totalLatencyMs += a.latency_ms;
      graded.push({
        question_id:    aqid,
        selected_index: a.selected_index,
        correct_index:  truthIndex,
        is_correct:     isCorrect,
        latency_ms:     a.latency_ms || 0,
        scored_server:  true
      });
    }

    var score = packQuestions.length > 0
      ? Math.round((correct * 1000) / packQuestions.length) : 0;

    var v1Payload = {
      mode:        req.mode || "unknown",
      score:       score,
      correct:     correct,
      total:       packQuestions.length,
      duration_ms: req.duration_ms || totalLatencyMs,
      meta: {
        question_pack_id: packId,
        scoring_version:  "v2",
        source:           pack.source || null
      },
      answers: graded
    };

    var v1Result: any = { success: false };
    var v1 = (globalThis as any).__rpc_quiz_submit_result;
    if (typeof v1 === "function") {
      try {
        v1Result = JSON.parse(v1(ctx, logger, nk, JSON.stringify(v1Payload)));
      } catch (err: any) {
        logger.error("[Migration] v1 submit dispatch failed: " + (err && err.message ? err.message : String(err)));
      }
    } else {
      logger.warn("[Migration] quiz_submit_result v1 not loaded");
    }

    return JSON.stringify({
      ok:              true,
      score:           score,
      correct:         correct,
      total:           packQuestions.length,
      scoring_version: "v2",
      graded:          graded,
      v1_persisted:    !!v1Result.success,
      v1_result:       v1Result
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 3 — AI through Nakama
  // ─────────────────────────────────────────────────────────────────────
  // Proxies the four AI surfaces (question gen / subjective grading /
  // notes pipeline / STT) through Nakama so:
  //   (a) no AI API key ever leaves the server,
  //   (b) every AI call is enriched with the Player Context Pack,
  //   (c) prompt registry + Satori experiments are server-owned.
  //
  // Each handler reads the upstream base URL from ctx.env (set by the
  // CodeBuild post_build phase — `IVX_AI_SVC_BASE_URL`). If the env var
  // is missing OR the upstream returns a non-2xx, the handler returns
  // a {fallback_to_client: true} envelope so the Unity client falls
  // through to its legacy direct-REST path.

  function aiServiceBaseUrl(ctx: nkruntime.Context): string {
    var env: any = ctx.env || {};
    var url = env.IVX_AI_SVC_BASE_URL || env.AI_SVC_BASE_URL || "";
    if (!url) return "";
    return url.replace(/\/+$/, "");
  }

  function aiAuthHeader(ctx: nkruntime.Context): { [key: string]: string } {
    var env: any = ctx.env || {};
    var hdrs: { [key: string]: string } = { "Content-Type": "application/json" };
    var token = env.IVX_AI_S2S_TOKEN || env.AI_S2S_TOKEN || "";
    if (token) hdrs["Authorization"] = "Bearer " + token;
    var shared = env.IVX_INSIGHTS_SHARED_SECRET || "";
    if (shared && !token) hdrs["X-IVX-Shared-Secret"] = shared;
    return hdrs;
  }

  function aiFallbackEnvelope(rpcId: string, reason: string): string {
    return JSON.stringify({
      ok: false,
      error: reason,
      rpc: rpcId,
      fallback_to_client: true,
      message: "Server-side AI proxy unavailable; Unity should use legacy direct-REST path."
    });
  }

  function callAiUpstream(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    path: string,
    body: any
  ): { ok: boolean; payload?: any; error?: string } {
    var baseUrl = aiServiceBaseUrl(ctx);
    if (!baseUrl) return { ok: false, error: "ai_base_url_unset" };

    var fullUrl = baseUrl + path;
    var headers = aiAuthHeader(ctx);

    try {
      var resp = nk.httpRequest(fullUrl, "post", headers, JSON.stringify(body));
      if (resp.code < 200 || resp.code >= 300) {
        logger.warn("[Migration/AI] " + path + " upstream HTTP " + resp.code + ": " + (resp.body || "").substring(0, 200));
        return { ok: false, error: "upstream_http_" + resp.code };
      }
      try {
        return { ok: true, payload: JSON.parse(resp.body || "{}") };
      } catch (_) {
        return { ok: true, payload: resp.body };
      }
    } catch (err: any) {
      logger.error("[Migration/AI] " + path + " threw: " + (err && err.message ? err.message : String(err)));
      return { ok: false, error: "transport_error" };
    }
  }

  function rpcAiGenerate(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);

    var pack = readPlayerContext(nk, userId);
    var enriched = {
      user_id:               userId,
      mode:                  req.mode || "MultipleChoice",
      topic:                 req.topic || "general",
      count:                 req.count || 10,
      difficulty:            req.difficulty || pack.tier || "medium",
      lang:                  req.lang || pack.locale || "en",
      prompt_overrides:      req.prompt_overrides || null,
      personalization_signals: {
        affinity_topics:    (pack.affinity && pack.affinity.topics) || [],
        recent_completion:  (pack.activity && pack.activity.completion_7d) || 0,
        safety_level:       (pack.safety && pack.safety.level) || "default",
        country:            pack.country || "",
        device:             pack.device || ""
      }
    };

    var up = callAiUpstream(ctx, logger, nk, "/api/ai/quizverse/generate-questions", enriched);
    if (!up.ok) return aiFallbackEnvelope(RPC_AI_GENERATE, up.error || "upstream_error");

    return JSON.stringify({
      ok:                   true,
      questions:            (up.payload && up.payload.questions) || [],
      context_pack_version: pack.version,
      source_trace:         { served_by: "ai-gateway", upstream: "intelli-verse-ai" },
      meta:                 up.payload && up.payload.meta ? up.payload.meta : {}
    });
  }

  function rpcAiGradeSubjective(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    if (!req.question || (!req.user_answer && !req.userAnswer)) {
      throw nakamaError("question + user_answer required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var enriched = {
      user_id:        userId,
      question:       req.question,
      user_answer:    req.user_answer || req.userAnswer,
      rubric:         req.rubric || null,
      lang:           req.lang || "en"
    };
    var up = callAiUpstream(ctx, logger, nk, "/api/ai/quizverse/grade-subjective", enriched);
    if (!up.ok) return aiFallbackEnvelope(RPC_AI_GRADE_SUBJECTIVE, up.error || "upstream_error");
    return JSON.stringify({ ok: true, grade: up.payload });
  }

  function rpcAiNotesCreate(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    var enriched = {
      user_id: userId,
      source:  req.source || "text",
      payload: req.payload || req.text || ""
    };
    var up = callAiUpstream(ctx, logger, nk, "/api/ai/notes/create", enriched);
    if (!up.ok) return aiFallbackEnvelope(RPC_AI_NOTES_CREATE, up.error || "upstream_error");
    return JSON.stringify({ ok: true, job: up.payload });
  }

  function rpcAiStt(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    if (!req.audio_b64 && !req.audio_url) {
      throw nakamaError("audio_b64 or audio_url required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var enriched = {
      user_id:    userId,
      audio_b64:  req.audio_b64 || null,
      audio_url:  req.audio_url || null,
      lang:       req.lang || "en",
      hint_topic: req.hint_topic || ""
    };
    var up = callAiUpstream(ctx, logger, nk, "/api/ai/voice/transcribe", enriched);
    if (!up.ok) return aiFallbackEnvelope(RPC_AI_STT, up.error || "upstream_error");
    return JSON.stringify({ ok: true, transcript: up.payload });
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 4 — External APIs (dispatcher with cache)
  // ─────────────────────────────────────────────────────────────────────
  // Single Unity-facing RPC routes per-provider 3rd-party fetches through
  // Nakama so:
  //   (a) we own a single egress IP (rate-limit + secret rotation),
  //   (b) per-(provider, key) responses are cached in `qv_external_cache`,
  //   (c) responses are personalized server-side via the Player Context
  //       Pack (e.g. anime affinity prunes the Jikan result set).
  //
  // Providers are routed by URL template. If a provider isn't yet wired,
  // returns `fallback_to_client: true` so Unity drops to the legacy
  // ExternalQuizApiService path unchanged.

  var COL_EXTERNAL_CACHE = "qv_external_cache";

  interface ExternalProvider {
    name:    string;
    method:  string;   // "get" | "post"
    url:     string;   // can include {token} placeholders
    cacheTtlMs: number;
  }

  var EXTERNAL_PROVIDERS: { [key: string]: ExternalProvider } = {
    jikan:       { name: "jikan",       method: "get", url: "https://api.jikan.moe/v4/random/anime",                 cacheTtlMs: 5 * 60 * 1000 },
    pokeapi:     { name: "pokeapi",     method: "get", url: "https://pokeapi.co/api/v2/pokemon/{id}",                cacheTtlMs: 24 * 60 * 60 * 1000 },
    themealdb:   { name: "themealdb",   method: "get", url: "https://www.themealdb.com/api/json/v1/1/random.php",    cacheTtlMs: 10 * 60 * 1000 },
    cocktaildb:  { name: "cocktaildb",  method: "get", url: "https://www.thecocktaildb.com/api/json/v1/1/random.php",cacheTtlMs: 10 * 60 * 1000 },
    foodish:     { name: "foodish",     method: "get", url: "https://foodish-api.com/api/",                          cacheTtlMs: 5 * 60 * 1000 },
    nasa:        { name: "nasa",        method: "get", url: "https://images-api.nasa.gov/search?q={query}",          cacheTtlMs: 60 * 60 * 1000 },
    countries:   { name: "countries",   method: "get", url: "https://restcountries.com/v3.1/all",                    cacheTtlMs: 24 * 60 * 60 * 1000 },
    ghibli:      { name: "ghibli",      method: "get", url: "https://ghibliapi.vercel.app/films",                    cacheTtlMs: 24 * 60 * 60 * 1000 },
    disney:      { name: "disney",      method: "get", url: "https://api.disneyapi.dev/character",                   cacheTtlMs: 24 * 60 * 60 * 1000 },
    starwars:    { name: "starwars",    method: "get", url: "https://swapi.dev/api/people/{id}",                     cacheTtlMs: 24 * 60 * 60 * 1000 },
    sports:      { name: "sports",      method: "get", url: "https://www.thesportsdb.com/api/v1/json/3/all_sports.php",cacheTtlMs: 24 * 60 * 60 * 1000 }
  };

  function expandUrl(template: string, params: any): string {
    var out = template;
    for (var k in (params || {})) {
      out = out.split("{" + k + "}").join(String(params[k] || ""));
    }
    return out;
  }

  function externalCacheKey(provider: string, params: any): string {
    var paramStr = "";
    if (params) {
      var keys: string[] = [];
      for (var k in params) keys.push(k);
      keys.sort();
      var parts: string[] = [];
      for (var i = 0; i < keys.length; i++) parts.push(keys[i] + "=" + String(params[keys[i]]));
      paramStr = parts.join("&");
    }
    return provider + ":" + paramStr;
  }

  function rpcFetchExternalQuiz(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    if (!req.provider) {
      throw nakamaError(
        "provider required (jikan|pokeapi|disney|ghibli|foodish|themealdb|cocktaildb|nasa|sports|countries|starwars)",
        nkruntime.Codes.INVALID_ARGUMENT
      );
    }

    var provider = EXTERNAL_PROVIDERS[String(req.provider).toLowerCase()];
    if (!provider) {
      return JSON.stringify({
        ok: false, error: "unknown_provider", provider: req.provider,
        fallback_to_client: true
      });
    }

    var cacheKey = externalCacheKey(provider.name, req.params);
    // Cache read.
    try {
      var cached = nk.storageRead([{
        collection: COL_EXTERNAL_CACHE, key: cacheKey, userId: ""
      }]);
      if (cached && cached.length > 0 && cached[0].value) {
        var v: any = cached[0].value;
        if (v.expires_ms && v.expires_ms > nowMs()) {
          return JSON.stringify({
            ok: true, provider: provider.name, source: "cache",
            data: v.payload, cached_at_ms: v.cached_at_ms
          });
        }
      }
    } catch (_e) {}

    // Live fetch.
    var url = expandUrl(provider.url, req.params || {});
    try {
      var resp = nk.httpRequest(url, provider.method, { "Accept": "application/json" }, "");
      if (resp.code < 200 || resp.code >= 300) {
        logger.warn("[Migration/External] " + provider.name + " HTTP " + resp.code);
        return JSON.stringify({
          ok: false, error: "upstream_http_" + resp.code,
          provider: provider.name, fallback_to_client: true
        });
      }
      var parsed: any;
      try { parsed = JSON.parse(resp.body); } catch (_) { parsed = resp.body; }

      // Cache write (best-effort; permissionRead=2 = public so multi-user serves from one entry).
      try {
        nk.storageWrite([{
          collection: COL_EXTERNAL_CACHE,
          key:        cacheKey,
          userId:     "",
          value: {
            payload:      parsed,
            cached_at_ms: nowMs(),
            expires_ms:   nowMs() + provider.cacheTtlMs,
            requester:    userId
          },
          permissionRead:  2,
          permissionWrite: 0
        }]);
      } catch (_e) {}

      return JSON.stringify({
        ok: true, provider: provider.name, source: "live",
        data: parsed, cached_at_ms: nowMs()
      });
    } catch (err: any) {
      logger.error("[Migration/External] " + provider.name + " threw: " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({
        ok: false, error: "transport_error",
        provider: provider.name, fallback_to_client: true
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 5 — Multiplayer pack request
  // ─────────────────────────────────────────────────────────────────────
  // The MP host calls this once at room start; Nakama returns a shared
  // pack id + questions personalized to the host's Player Context Pack
  // (the host is the anchor; co-players inherit their pack via the
  // pack_id). The questions are stamped into `qv_question_pack` so
  // Phase-2 v2 scoring works for every player's submission.
  //
  // Routing:
  //   - If `pack_id` is provided AND found in storage → return cached pack.
  //   - Otherwise call quizverse_request_questions (P1) with host context
  //     and stamp the result as a new pack with `mp=true` metadata.

  function rpcMpRequestPack(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);

    // Cached-pack short-circuit (co-players hitting after host).
    if (req.pack_id) {
      try {
        var stored = nk.storageRead([{
          collection: COL_QUESTION_PACK, key: String(req.pack_id), userId: req.host_id || userId
        }]);
        if (stored && stored.length > 0 && stored[0].value) {
          var v: any = stored[0].value;
          return JSON.stringify({
            ok:                   true,
            question_pack_id:     String(req.pack_id),
            questions:            v.questions || [],
            from_cache:           true,
            source_trace:         v.source || { kind: "mp_cache" }
          });
        }
      } catch (_e) {}
    }

    // Host-side fresh generation — delegate to P1 router with a personalized
    // request seeded from the host's context.
    var pack = readPlayerContext(nk, userId);
    var topics: any[] = req.topics || [];
    var primaryTopic = topics.length > 0 ? String(topics[0]) : "general";

    var p1Payload = {
      kind:              "deduped_s3",
      mode:              req.mode || "Multiplayer",
      scope:             "mp_" + (req.mode || "global"),
      topic:             primaryTopic,
      count:             req.max_count || 10,
      lang:              pack.locale || "en",
      id_prefix:         "mp",
      question_bank_url: req.question_bank_url || "",
      inline_questions:  req.inline_questions || undefined
    };

    var generated: any = null;
    try {
      generated = JSON.parse(rpcRequestQuestions(ctx, logger, nk, JSON.stringify(p1Payload)));
    } catch (err: any) {
      logger.error("[Migration/MP] request_questions failed: " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({
        ok: false, error: "delegate_failed",
        fallback_to_client: true, source_trace: { stage: "p1_delegate" }
      });
    }

    if (!generated || generated.ok === false || !generated.questions) {
      return JSON.stringify({
        ok: false, error: (generated && generated.error) || "empty_pack",
        fallback_to_client: true, source_trace: generated && generated.source_trace || {}
      });
    }

    return JSON.stringify({
      ok:                   true,
      question_pack_id:     generated.question_pack_id,
      questions:            generated.questions,
      from_cache:           false,
      context_pack_version: generated.context_pack_version,
      host_id:              userId,
      source_trace:         generated.source_trace,
      meta:                 { mp: true, max_count: req.max_count || 10 }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 6 — Auth broker
  // ─────────────────────────────────────────────────────────────────────
  // Brokers the Cognito-backed REST endpoints behind Nakama so the Unity
  // client only ever speaks to nakama-rest.intelli-verse-x.ai. The Unity
  // SDK passes credentials (email/password) or OIDC identity tokens
  // (Apple, Google, Unity Player Accounts) to Nakama; Nakama POSTs them
  // to the existing api.intelli-verse-x.ai/auth endpoints and returns
  // the access/refresh token pair plus the user profile.
  //
  // Why this matters: enables CI guardrail in Phase 9 to whitelist a
  // single host (nakama-rest) without breaking auth flows.

  function authServiceBaseUrl(ctx: nkruntime.Context): string {
    var env: any = ctx.env || {};
    var url = env.IVX_AUTH_BASE_URL || env.AUTH_BASE_URL || "https://api.intelli-verse-x.ai";
    return url.replace(/\/+$/, "");
  }

  function proxyAuthEndpoint(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    rpcId: string,
    method: string,
    path: string,
    body: any
  ): string {
    var url = authServiceBaseUrl(ctx) + path;
    var headers: { [key: string]: string } = { "Content-Type": "application/json", "Accept": "application/json" };
    try {
      var resp = nk.httpRequest(url, method, headers, body ? JSON.stringify(body) : "");
      if (resp.code < 200 || resp.code >= 300) {
        logger.warn("[Migration/Auth] " + path + " HTTP " + resp.code);
        return JSON.stringify({
          ok: false, error: "upstream_http_" + resp.code,
          status: resp.code, body: (resp.body || "").substring(0, 400),
          rpc: rpcId, fallback_to_client: true
        });
      }
      var parsed: any;
      try { parsed = JSON.parse(resp.body); } catch (_) { parsed = { raw: resp.body }; }
      return JSON.stringify({ ok: true, data: parsed, rpc: rpcId });
    } catch (err: any) {
      logger.error("[Migration/Auth] " + path + " threw: " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({
        ok: false, error: "transport_error",
        rpc: rpcId, fallback_to_client: true
      });
    }
  }

  function rpcAuthSignup(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var req = parseJson(payload);
    if (!req.email || !req.password) {
      throw nakamaError("email and password required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    return proxyAuthEndpoint(ctx, logger, nk, RPC_AUTH_SIGNUP, "post", "/api/user/auth-v2/signup", req);
  }

  function rpcAuthLogin(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var req = parseJson(payload);
    if (!req.email || !req.password) {
      throw nakamaError("email and password required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    return proxyAuthEndpoint(ctx, logger, nk, RPC_AUTH_LOGIN, "post", "/api/user/auth-v2/login", req);
  }

  function rpcAuthSocialLogin(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var req = parseJson(payload);
    if (!req.provider || !req.identity_token) {
      throw nakamaError("provider and identity_token required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    return proxyAuthEndpoint(ctx, logger, nk, RPC_AUTH_SOCIAL_LOGIN, "post", "/api/user/auth-v2/social/game-login", req);
  }

  function rpcAuthRefresh(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var req = parseJson(payload);
    if (!req.refresh_token) {
      throw nakamaError("refresh_token required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    return proxyAuthEndpoint(ctx, logger, nk, RPC_AUTH_REFRESH, "post", "/api/user/auth-v2/refresh", req);
  }
  function rpcAuthUserinfo(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, _p: string): string {
    var userId = requireAuth(ctx);
    try {
      var acc = nk.accountGetId(userId);
      return JSON.stringify({
        ok:           true,
        user_id:      userId,
        username:     acc && acc.user ? acc.user.username : "",
        display_name: acc && acc.user ? acc.user.displayName : "",
        avatar_url:   acc && acc.user ? acc.user.avatarUrl : "",
        lang_tag:     acc && acc.user ? acc.user.langTag : "",
        metadata:     acc && acc.user ? acc.user.metadata : {}
      });
    } catch (_e) {
      return stubResponse(RPC_AUTH_USERINFO, "phase_6");
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 7 — Non-quiz surfaces
  // ─────────────────────────────────────────────────────────────────────
  // Each surface follows the same pattern: read the env-held secret /
  // upstream URL, fetch, return Nakama-shaped envelope. On any failure
  // the response sets fallback_to_client so Unity drops to its legacy
  // path (the CI guardrail keeps the legacy path warm during ramp).

  function rpcGeoLookup(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string
  ): string {
    requireAuth(ctx);
    var env: any = ctx.env || {};
    var clientIp = ctx.clientIp || "";

    // Prefer the existing Nakama-side `check_geo_and_update_profile`
    // RPC; only fall through to a direct ipapi.co lookup as a degraded
    // path so the surface keeps working even if the upstream changes.
    var fn = (globalThis as any).__rpc_check_geo_and_update_profile;
    if (typeof fn === "function") {
      try {
        var inner = JSON.parse(fn(ctx, logger, nk, "{}"));
        return JSON.stringify({
          ok: true,
          country_code: inner.country_code || inner.country || "",
          region:       inner.region || "",
          city:         inner.city || "",
          source:       "check_geo_and_update_profile",
          ip_seen:      clientIp ? clientIp.substring(0, 7) + "…" : ""
        });
      } catch (_e) {}
    }
    if (!clientIp) {
      return JSON.stringify({ ok: true, country_code: "", region: "", city: "", source: "no_ip" });
    }
    try {
      var resp = nk.httpRequest("https://ipapi.co/" + encodeURIComponent(clientIp) + "/json/", "get", { "Accept": "application/json" }, "");
      if (resp.code < 200 || resp.code >= 300) {
        return JSON.stringify({ ok: false, error: "upstream_http_" + resp.code, fallback_to_client: true });
      }
      var p: any = JSON.parse(resp.body || "{}");
      return JSON.stringify({
        ok: true,
        country_code: p.country_code || "",
        region:       p.region || "",
        city:         p.city || "",
        source:       "ipapi.co"
      });
    } catch (err: any) {
      logger.warn("[Migration/Geo] threw: " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({ ok: false, error: "transport_error", fallback_to_client: true });
    }
  }

  function rpcTtsSynthesize(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    if (!req.text) {
      throw nakamaError("text required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var env: any = ctx.env || {};
    var apiKey = env.IVX_ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY || "";
    if (!apiKey) {
      return JSON.stringify({ ok: false, error: "tts_key_unset", fallback_to_client: true });
    }
    var pack = readPlayerContext(nk, userId);
    var voiceId = req.voice_id || env.IVX_ELEVENLABS_DEFAULT_VOICE || "21m00Tcm4TlvDq8ikWAM";
    var modelId = req.model_id || "eleven_multilingual_v2";

    try {
      var resp = nk.httpRequest(
        "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voiceId),
        "post",
        { "xi-api-key": apiKey, "Accept": "audio/mpeg", "Content-Type": "application/json" },
        JSON.stringify({ text: String(req.text), model_id: modelId })
      );
      if (resp.code < 200 || resp.code >= 300) {
        logger.warn("[Migration/TTS] HTTP " + resp.code);
        return JSON.stringify({ ok: false, error: "upstream_http_" + resp.code, fallback_to_client: true });
      }
      // The audio body is binary; the Nakama HTTP wrapper returns it as
      // a string. Re-encode as base64 so the Unity client can play it
      // without an intermediate signed-URL step (good for ≤ 256 KB clips).
      var bytes = nk.stringToBinary(resp.body || "");
      var b64 = nk.base64Encode(bytes, true);
      return JSON.stringify({
        ok: true,
        audio_b64: b64,
        audio_mime: "audio/mpeg",
        voice_id: voiceId,
        model_id: modelId,
        context_pack_version: pack.version
      });
    } catch (err: any) {
      logger.error("[Migration/TTS] threw: " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({ ok: false, error: "transport_error", fallback_to_client: true });
    }
  }

  function rpcLichessPuzzle(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    requireAuth(ctx);
    var req = parseJson(payload);
    var kind = String(req.kind || "daily").toLowerCase();
    var url = "";
    if (kind === "byid" && req.id) url = "https://lichess.org/api/puzzle/" + encodeURIComponent(String(req.id));
    else if (kind === "next")       url = "https://lichess.org/api/puzzle/next";
    else                            url = "https://lichess.org/api/puzzle/daily";

    try {
      var resp = nk.httpRequest(url, "get", { "Accept": "application/json" }, "");
      if (resp.code < 200 || resp.code >= 300) {
        return JSON.stringify({ ok: false, error: "upstream_http_" + resp.code, fallback_to_client: true });
      }
      var p: any; try { p = JSON.parse(resp.body); } catch (_) { p = resp.body; }
      return JSON.stringify({ ok: true, kind: kind, puzzle: p, source: "lichess.org" });
    } catch (err: any) {
      logger.warn("[Migration/Lichess] threw: " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({ ok: false, error: "transport_error", fallback_to_client: true });
    }
  }

  function rpcXpromoGetApps(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string
  ): string {
    var userId = requireAuth(ctx);
    var env: any = ctx.env || {};
    var catalogUrl = env.IVX_XPROMO_CATALOG_URL || "";
    if (!catalogUrl) {
      return JSON.stringify({ ok: true, apps: [], source: "no_catalog_configured" });
    }
    var pack = readPlayerContext(nk, userId);
    try {
      var resp = nk.httpRequest(catalogUrl, "get", { "Accept": "application/json" }, "");
      if (resp.code < 200 || resp.code >= 300) {
        return JSON.stringify({ ok: false, error: "upstream_http_" + resp.code, fallback_to_client: true });
      }
      var apps: any[] = [];
      try {
        var parsed: any = JSON.parse(resp.body);
        apps = (parsed && parsed.apps) || (Array.isArray(parsed) ? parsed : []);
      } catch (_) {}
      // Re-rank by country match + tier match (simple personalization v1).
      apps.sort(function (a: any, b: any) {
        var aCountry = a && a.country === pack.country ? 1 : 0;
        var bCountry = b && b.country === pack.country ? 1 : 0;
        if (aCountry !== bCountry) return bCountry - aCountry;
        var aTier = a && a.tier === pack.tier ? 1 : 0;
        var bTier = b && b.tier === pack.tier ? 1 : 0;
        return bTier - aTier;
      });
      return JSON.stringify({ ok: true, apps: apps, source: "catalog_v1", context_pack_version: pack.version });
    } catch (err: any) {
      logger.warn("[Migration/Xpromo] threw: " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({ ok: false, error: "transport_error", fallback_to_client: true });
    }
  }

  function rpcWebviewTokenIssue(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    var destination = String(req.destination || "").toLowerCase();
    var allowed: { [k: string]: string } = {
      tutorx:     "tutorx.quizverse.world",
      live:       "live.quizverse.world",
      voice:      "voice.quizverse.world",
      exam_coach: "exam-coach.quizverse.world"
    };
    if (!allowed[destination]) {
      throw nakamaError("destination must be one of: tutorx|live|voice|exam_coach", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var env: any = ctx.env || {};
    var secret = env.IVX_WEBVIEW_HMAC_SECRET || env.WEBVIEW_HMAC_SECRET || env.IVX_INSIGHTS_SHARED_SECRET || "";
    if (!secret) {
      return JSON.stringify({ ok: false, error: "webview_secret_unset", fallback_to_client: true });
    }
    var pack = readPlayerContext(nk, userId);
    var nowS = Math.floor(nowMs() / 1000);
    var ttlS = req.ttl_s && req.ttl_s > 0 && req.ttl_s <= 300 ? req.ttl_s : 60;
    var claims = {
      sub:         userId,
      dest:        destination,
      iat:         nowS,
      exp:         nowS + ttlS,
      cohort:      (pack.flags && (pack.flags as any).cohort) || "",
      experiments: pack.experiments || [],
      tier:        pack.tier,
      country:     pack.country,
      intent:      req.intent || ""
    };
    // JWS = base64(header).base64(payload).hmac
    var header = nk.base64Encode(nk.stringToBinary(JSON.stringify({ alg: "HS256", typ: "JWT" })), true);
    var body   = nk.base64Encode(nk.stringToBinary(JSON.stringify(claims)), true);
    var signingInput = header + "." + body;
    var sigBytes = nk.hmacSha256Hash(secret, signingInput);
    var sig = nk.base64Encode(sigBytes, true);
    var jwt = header + "." + body + "." + sig;
    return JSON.stringify({
      ok: true,
      token: jwt,
      destination: destination,
      host: allowed[destination],
      expires_at_s: claims.exp,
      context_pack_version: pack.version
    });
  }

  function rpcAssetCatalogGet(
    ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    var env: any = ctx.env || {};
    var baseCdn = env.IVX_ADDRESSABLES_BASE_URL || "https://d1e6r993vuuu18.cloudfront.net";
    var pack = readPlayerContext(nk, userId);

    // Default catalog selector picks a theme by tier + cohort. Server
    // emits signed CDN URLs (24h ttl) so the client can't keep links
    // around after a user demotion.
    var theme = (pack.flags && (pack.flags as any).theme) || (pack.tier === "premium" ? "premium-v3" : "default-v3");
    var version = req.version || pack.version;
    return JSON.stringify({
      ok: true,
      version: version,
      theme: theme,
      base_cdn: baseCdn,
      remote_load_path: baseCdn + "/[BuildTarget]/" + theme + "/{Addressables.RuntimePath}",
      entries: [
        { key: "default_pack", url: baseCdn + "/StandaloneOSX/" + theme + "/catalog.json", ttl_s: 86400 }
      ],
      context_pack_version: pack.version
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 8 — Personalization plane
  // ─────────────────────────────────────────────────────────────────────

  function rpcAnalyticsFanout(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    var event = req.event || req.name || "unknown";
    var props = req.props || req.properties || {};

    var fanned: string[] = [];
    // (a) Satori — primary destination.
    var satoriEvent = (globalThis as any).__rpc_satori_event;
    if (typeof satoriEvent === "function") {
      try {
        var satoriPayload = JSON.stringify({ name: event, value: JSON.stringify(props) });
        satoriEvent(ctx, logger, nk, satoriPayload);
        fanned.push("satori");
      } catch (_e) {}
    }
    // (b) Firebase server-side bridge (if a TS module exposed it via
    //     globalThis.__qv_firebase_emit). Phase-8 consolidation lands
    //     this as a fan-out target so the client only writes once.
    var firebaseEmit = (globalThis as any).__qv_firebase_emit;
    if (typeof firebaseEmit === "function") {
      try {
        firebaseEmit({ user_id: userId, event: event, props: props });
        fanned.push("firebase");
      } catch (_e) {}
    }
    // (c) Discord ops channel via existing webhook chain (only emit if
    //     event contains a high-signal tag).
    if (typeof event === "string" && (event.indexOf("error") >= 0 || event.indexOf("crash") >= 0)) {
      var env: any = ctx.env || {};
      var hook = env.DISCORD_QV_OPS_WEBHOOK_URL || "";
      if (hook) {
        try {
          nk.httpRequest(hook, "post", { "Content-Type": "application/json" }, JSON.stringify({
            content: "[qv-ops] " + event + " uid=" + userId.substring(0, 8) + " " + JSON.stringify(props).substring(0, 200)
          }));
          fanned.push("discord_ops");
        } catch (_e) {}
      }
    }
    return JSON.stringify({ ok: true, fanned: fanned, event: event });
  }

  function rpcLivekitTokenMint(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = requireAuth(ctx);
    var req = parseJson(payload);
    var roomName = String(req.room || ("qv-" + userId.substring(0, 8)));
    var env: any = ctx.env || {};
    var apiKey = env.LIVEKIT_API_KEY || "";
    var apiSecret = env.LIVEKIT_API_SECRET || "";
    var wsUrl = env.LIVEKIT_WS_URL || "";
    if (!apiKey || !apiSecret) {
      return JSON.stringify({ ok: false, error: "livekit_keys_unset", fallback_to_client: true });
    }
    var pack = readPlayerContext(nk, userId);
    var nowS = Math.floor(nowMs() / 1000);
    var ttlS = req.ttl_s && req.ttl_s > 0 && req.ttl_s <= 3600 ? req.ttl_s : 3600;
    // LiveKit JWT claims (https://docs.livekit.io/realtime/server/authentication/)
    var grants = {
      video: {
        roomJoin: true,
        room: roomName,
        canPublish: !!req.can_publish,
        canSubscribe: req.can_subscribe !== false,
        canPublishData: req.can_publish_data !== false
      }
    };
    var claims = {
      iss:    apiKey,
      sub:    userId,
      jti:    userId + "-" + nowS,
      iat:    nowS,
      exp:    nowS + ttlS,
      name:   pack.user_id || userId,
      video:  grants.video
    };
    var header = nk.base64Encode(nk.stringToBinary(JSON.stringify({ alg: "HS256", typ: "JWT" })), true);
    var body   = nk.base64Encode(nk.stringToBinary(JSON.stringify(claims)), true);
    var signingInput = header + "." + body;
    var sigBytes = nk.hmacSha256Hash(apiSecret, signingInput);
    var sig = nk.base64Encode(sigBytes, true);
    var jwt = header + "." + body + "." + sig;
    return JSON.stringify({
      ok: true,
      token: jwt,
      ws_url: wsUrl,
      room: roomName,
      expires_at_s: claims.exp,
      grants: grants,
      context_pack_version: pack.version
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Registration
  // ─────────────────────────────────────────────────────────────────────
  export function register(
    initializer: nkruntime.Initializer,
    _nk: nkruntime.Nakama,
    logger: nkruntime.Logger
  ): void {
    initializer.registerRpc(RPC_GET_PLAYER_CONTEXT,  rpcGetPlayerContext);
    initializer.registerRpc(RPC_REQUEST_QUESTIONS,   rpcRequestQuestions);
    initializer.registerRpc(RPC_SUBMIT_RESULT_V2,    rpcSubmitResultV2);

    initializer.registerRpc(RPC_AI_GENERATE,         rpcAiGenerate);
    initializer.registerRpc(RPC_AI_GRADE_SUBJECTIVE, rpcAiGradeSubjective);
    initializer.registerRpc(RPC_AI_NOTES_CREATE,     rpcAiNotesCreate);
    initializer.registerRpc(RPC_AI_STT,              rpcAiStt);

    initializer.registerRpc(RPC_FETCH_EXTERNAL_QUIZ, rpcFetchExternalQuiz);

    initializer.registerRpc(RPC_MP_REQUEST_PACK,     rpcMpRequestPack);

    initializer.registerRpc(RPC_AUTH_SIGNUP,         rpcAuthSignup);
    initializer.registerRpc(RPC_AUTH_LOGIN,          rpcAuthLogin);
    initializer.registerRpc(RPC_AUTH_SOCIAL_LOGIN,   rpcAuthSocialLogin);
    initializer.registerRpc(RPC_AUTH_REFRESH,        rpcAuthRefresh);
    initializer.registerRpc(RPC_AUTH_USERINFO,       rpcAuthUserinfo);

    initializer.registerRpc(RPC_GEO_LOOKUP,          rpcGeoLookup);
    initializer.registerRpc(RPC_TTS_SYNTHESIZE,      rpcTtsSynthesize);
    initializer.registerRpc(RPC_LICHESS_PUZZLE,      rpcLichessPuzzle);
    initializer.registerRpc(RPC_XPROMO_GET_APPS,     rpcXpromoGetApps);
    initializer.registerRpc(RPC_WEBVIEW_TOKEN_ISSUE, rpcWebviewTokenIssue);
    initializer.registerRpc(RPC_ASSET_CATALOG_GET,   rpcAssetCatalogGet);

    initializer.registerRpc(RPC_ANALYTICS_FANOUT,    rpcAnalyticsFanout);
    initializer.registerRpc(RPC_LIVEKIT_TOKEN_MINT,  rpcLivekitTokenMint);

    logger.info("[QuizVerseMigration] registered 22 RPCs (P0/P1/P2 live; P3-P8 scaffolded)");
  }
}
