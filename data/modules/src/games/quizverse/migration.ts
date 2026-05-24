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
  // PHASE 3 — AI through Nakama (scaffold)
  // ─────────────────────────────────────────────────────────────────────

  function rpcAiGenerate(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx); return stubResponse(RPC_AI_GENERATE, "phase_3");
  }
  function rpcAiGradeSubjective(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx); return stubResponse(RPC_AI_GRADE_SUBJECTIVE, "phase_3");
  }
  function rpcAiNotesCreate(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx); return stubResponse(RPC_AI_NOTES_CREATE, "phase_3");
  }
  function rpcAiStt(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx); return stubResponse(RPC_AI_STT, "phase_3");
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 4 — External APIs (scaffold)
  // ─────────────────────────────────────────────────────────────────────

  function rpcFetchExternalQuiz(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    requireAuth(ctx);
    var req = parseJson(payload);
    if (!req.provider) {
      throw nakamaError(
        "provider required (jikan|pokeapi|disney|ghibli|foodish|themealdb|cocktaildb|nasa|sports|countries|starwars)",
        nkruntime.Codes.INVALID_ARGUMENT
      );
    }
    return stubResponse(RPC_FETCH_EXTERNAL_QUIZ, "phase_4");
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 5 — Multiplayer pack request
  // ─────────────────────────────────────────────────────────────────────

  function rpcMpRequestPack(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    requireAuth(ctx);
    var req = parseJson(payload);
    if (req.pack_id) {
      var existing = (globalThis as any).__rpc_quizverse_load_pack;
      if (typeof existing === "function") {
        try { return existing(ctx, logger, nk, payload); }
        catch (_e) {}
      }
    }
    return stubResponse(RPC_MP_REQUEST_PACK, "phase_5");
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 6 — Auth broker (scaffold; userinfo serves real data)
  // ─────────────────────────────────────────────────────────────────────

  function rpcAuthSignup(_ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    return stubResponse(RPC_AUTH_SIGNUP, "phase_6");
  }
  function rpcAuthLogin(_ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    return stubResponse(RPC_AUTH_LOGIN, "phase_6");
  }
  function rpcAuthSocialLogin(_ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    return stubResponse(RPC_AUTH_SOCIAL_LOGIN, "phase_6");
  }
  function rpcAuthRefresh(_ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    return stubResponse(RPC_AUTH_REFRESH, "phase_6");
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
  // PHASE 7 — Non-quiz surfaces (scaffold)
  // ─────────────────────────────────────────────────────────────────────

  function rpcGeoLookup(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx);
    return JSON.stringify({
      ok: true, country_code: "", region: "", city: "",
      source: "stub", not_yet_enabled: true, fallback_to_client: true
    });
  }
  function rpcTtsSynthesize(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx); return stubResponse(RPC_TTS_SYNTHESIZE, "phase_7");
  }
  function rpcLichessPuzzle(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx); return stubResponse(RPC_LICHESS_PUZZLE, "phase_7");
  }
  function rpcXpromoGetApps(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx);
    return JSON.stringify({
      ok: true, apps: [], source: "stub",
      not_yet_enabled: true, fallback_to_client: true
    });
  }
  function rpcWebviewTokenIssue(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx); return stubResponse(RPC_WEBVIEW_TOKEN_ISSUE, "phase_7");
  }
  function rpcAssetCatalogGet(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx);
    return JSON.stringify({
      ok: true, version: 0, entries: [], source: "stub",
      not_yet_enabled: true, fallback_to_client: true
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 8 — Personalization plane
  // ─────────────────────────────────────────────────────────────────────

  function rpcAnalyticsFanout(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    requireAuth(ctx);
    var satoriEvent = (globalThis as any).__rpc_satori_event;
    var fanned: string[] = [];
    if (typeof satoriEvent === "function") {
      try {
        satoriEvent(ctx, logger, nk, payload);
        fanned.push("satori");
      } catch (_e) {}
    }
    return JSON.stringify({ ok: true, fanned: fanned });
  }
  function rpcLivekitTokenMint(ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _p: string): string {
    requireAuth(ctx); return stubResponse(RPC_LIVEKIT_TOKEN_MINT, "phase_8");
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
