namespace LegacyQuiz {

  interface QuizResult {
    score: number;
    totalQuestions: number;
    correctAnswers: number;
    category?: string;
    timestamp: number;
  }

  interface QuizStats {
    totalGames: number;
    totalCorrect: number;
    totalQuestions: number;
    averageScore: number;
    lastPlayedAt: number;
  }

  function getStats(nk: nkruntime.Nakama, userId: string): QuizStats | null {
    return Storage.readJson<QuizStats>(nk, Constants.QUIZ_RESULTS_COLLECTION, "stats_" + userId, userId);
  }

  function saveStats(nk: nkruntime.Nakama, userId: string, stats: QuizStats): void {
    Storage.writeJson(nk, Constants.QUIZ_RESULTS_COLLECTION, "stats_" + userId, userId, stats);
  }

  // Rolling per-question knowledge ledger — same document contract as
  // quiz_results.js appendKnowledgeMapHistory ({entries:[{category, correct,
  // time_ms}]} at <slug>_quiz_history/history), consumed by quizverse_depth,
  // the seedq adaptive profile, and the Aahaa fact pack.
  var KM_MAX_ENTRIES = 2000;
  function appendKnowledgeHistory(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    data: any,
    category: string,
    totalQuestions: number,
    correctAnswers: number
  ): void {
    var collection = "quiz-verse_quiz_history";
    var existing: any = Storage.readJson(nk, collection, "history", userId);
    var entries: any[] = (existing && existing.entries && existing.entries.length !== undefined) ? existing.entries : [];

    var newEntries: any[] = [];
    var qh: any[] = (data.questionHistory && data.questionHistory.length !== undefined) ? data.questionHistory : [];
    for (var i = 0; i < qh.length; i++) {
      var q = qh[i];
      if (!q || typeof q !== "object") continue;
      newEntries.push({
        category: q.category || q.categoryName || q.categoryId || category || "general",
        correct: (q.correct !== undefined) ? !!q.correct : !!q.was_correct,
        time_ms: parseInt(q.time_ms || q.timeMs || 0, 10) || 0
      });
    }
    if (newEntries.length === 0 && data.questionDetails && data.questionDetails.length) {
      for (var d = 0; d < data.questionDetails.length; d++) {
        var qd = data.questionDetails[d];
        if (!qd || typeof qd !== "object") continue;
        newEntries.push({
          category: qd.category || qd.concept || category || "general",
          correct: !!qd.isCorrect,
          time_ms: Math.round((parseFloat(qd.timeTakenSeconds) || 0) * 1000)
        });
      }
    }
    if (newEntries.length === 0) {
      // Synthesized aggregate entry — one row per quiz for older clients.
      var acc = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
      newEntries.push({ category: category || "general", correct: acc >= 60, time_ms: 0 });
    }

    var combined = entries.concat(newEntries);
    if (combined.length > KM_MAX_ENTRIES) combined = combined.slice(combined.length - KM_MAX_ENTRIES);
    Storage.writeJson(nk, collection, "history", userId, { entries: combined });
    logger.info("[LegacyQuiz] knowledge history +" + newEntries.length + " entries (total=" + combined.length + ")");
  }

  // Submit-time qv_seen backstop. This handler SHADOWS quiz_results.js's
  // rpcQuizSubmitResult (postbuild assigns __rpc_quiz_submit_result
  // unconditionally here), which silently dropped its seen-ledger merge —
  // clients that only mark seen at submit were repeating questions. Mirrors
  // the exact quiz_results.js contract (seenQuestionIds/seenScope/seenTopic,
  // top-level or under metadata) and additionally harvests answers[].question_id
  // (the quiz_submit_result_v2 forward). Non-critical: never blocks the submit.
  function mergeSeenQuestions(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, data: any, category: string): void {
    var bridge: any = (globalThis as any).__qvsSeen;
    if (!bridge) return;

    var seenIds: any = null;
    var seenScopeRaw: any = null;
    var seenTopicRaw: any = null;
    if (data.seenQuestionIds && data.seenQuestionIds.length > 0) {
      seenIds = data.seenQuestionIds;
      seenScopeRaw = data.seenScope;
      seenTopicRaw = data.seenTopic;
    } else if (data.metadata && data.metadata.seenQuestionIds && data.metadata.seenQuestionIds.length > 0) {
      seenIds = data.metadata.seenQuestionIds;
      seenScopeRaw = data.metadata.seenScope;
      seenTopicRaw = data.metadata.seenTopic;
    } else if (data.answers && data.answers.length > 0) {
      seenIds = [];
      for (var a = 0; a < data.answers.length; a++) {
        var qid = data.answers[a] && (data.answers[a].question_id || data.answers[a].id);
        if (qid) seenIds.push(String(qid));
      }
    }
    if (!seenIds || seenIds.length === 0) return;

    var scope = seenScopeRaw || "global";
    var topic = seenTopicRaw || data.categoryName || category || "general";
    bridge.merge(nk, userId, scope, topic, seenIds);
    logger.info("[LegacyQuiz] merged " + seenIds.length + " seen IDs into qv_seen/" +
      bridge.buildKey(scope, topic));
  }

  function rpcSubmitResult(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);

    var score = Math.max(0, Number(data.score) || 0);
    var totalQuestions = Math.max(1, Number(data.totalQuestions) || 1);
    var correctAnswers = Math.min(totalQuestions, Math.max(0, Number(data.correctAnswers) || 0));
    var category = data.category || "general";
    var ts = Math.floor(Date.now() / 1000);

    var result: QuizResult = {
      score: score,
      totalQuestions: totalQuestions,
      correctAnswers: correctAnswers,
      category: category,
      timestamp: ts
    };

    var resultKey = "result_" + userId + "_" + ts;
    Storage.writeJson(nk, Constants.QUIZ_RESULTS_COLLECTION, resultKey, userId, result);

    var stats = getStats(nk, userId) || {
      totalGames: 0,
      totalCorrect: 0,
      totalQuestions: 0,
      averageScore: 0,
      lastPlayedAt: 0
    };

    var oldGames = stats.totalGames;
    stats.totalGames += 1;
    stats.totalCorrect += correctAnswers;
    stats.totalQuestions += totalQuestions;
    stats.averageScore = oldGames > 0
      ? Math.round((stats.averageScore * oldGames + score) / stats.totalGames * 100) / 100
      : score;
    stats.lastPlayedAt = ts;

    saveStats(nk, userId, stats);

    // Repetition-Fatigue "after hook" (Deliverable 1): append per-question
    // entries to the knowledge-map ledger (quiz-verse_quiz_history). This
    // ledger feeds the seedq adaptive profile AND the Aahaa fact pack
    // (lock_it_in / weakness / frustration signals) — without it, backend
    // personalisation is blind for clients that submit through this v1 RPC.
    // Implemented inline (not via the globalThis.__kmAppendHistory bridge —
    // that bridge lives in a postbuild-renamed InitModule that never runs).
    // Non-critical: never blocks the main submit.
    try {
      appendKnowledgeHistory(nk, logger, userId, data, category, totalQuestions, correctAnswers);
    } catch (kmErr: any) {
      logger.warn("[LegacyQuiz] knowledge-history append failed (non-critical): " +
        (kmErr && kmErr.message ? kmErr.message : String(kmErr)));
    }

    // No-Repeat backstop: merge played question IDs into the qv_seen ledger
    // so quizverse_quiz_generate / quizverse_request_questions can never
    // serve them to this userID again inside the repeat window.
    try {
      mergeSeenQuestions(nk, logger, userId, data, category);
    } catch (seenErr: any) {
      logger.warn("[LegacyQuiz] seen-ledger merge failed (non-critical): " +
        (seenErr && seenErr.message ? seenErr.message : String(seenErr)));
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.QUIZ_COMPLETED, {
      userId: userId,
      score: score,
      totalQuestions: totalQuestions,
      correctAnswers: correctAnswers,
      category: category,
      timestamp: ts,
    });

    return RpcHelpers.successResponse({ result: result, stats: stats });
  }

  function rpcGetHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = Math.min(50, Math.max(1, Number(data.limit) || 20));
    var cursor = data.cursor || "";

    var listResult = Storage.listUserRecords(nk, Constants.QUIZ_RESULTS_COLLECTION, userId, limit, cursor);
    var records = listResult.records || [];
    var results: QuizResult[] = [];

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec.key && rec.key.indexOf("result_") === 0 && rec.value) {
        results.push(rec.value as QuizResult);
      }
    }

    results.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });

    return RpcHelpers.successResponse({ results: results, cursor: listResult.cursor });
  }

  function rpcGetStats(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var stats = getStats(nk, userId);

    if (!stats) {
      stats = {
        totalGames: 0,
        totalCorrect: 0,
        totalQuestions: 0,
        averageScore: 0,
        lastPlayedAt: 0
      };
    }

    return RpcHelpers.successResponse({
      totalGames: stats.totalGames,
      totalCorrect: stats.totalCorrect,
      totalQuestions: stats.totalQuestions,
      averageScore: stats.averageScore,
      lastPlayedAt: stats.lastPlayedAt
    });
  }

  function rpcCheckDailyCompletion(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var dateStr = data.date;

    if (!dateStr || typeof dateStr !== "string") {
      var d = new Date();
      var pad2 = function (n: number) { return n < 10 ? "0" + n : String(n); };
      dateStr = d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
    }

    var listResult = Storage.listUserRecords(nk, Constants.QUIZ_RESULTS_COLLECTION, userId, 100, "");
    var records = listResult.records || [];
    var dayStart = new Date(dateStr).getTime() / 1000;
    var dayEnd = dayStart + 86400;
    var completedToday = false;

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec.key && rec.key.indexOf("result_") === 0 && rec.value) {
        var val = rec.value as QuizResult;
        if (val.timestamp >= dayStart && val.timestamp < dayEnd) {
          completedToday = true;
          break;
        }
      }
    }

    return RpcHelpers.successResponse({ date: dateStr, completed: completedToday });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quiz_submit_result", rpcSubmitResult);
    initializer.registerRpc("quiz_get_history", rpcGetHistory);
    initializer.registerRpc("quiz_get_stats", rpcGetStats);
    initializer.registerRpc("quiz_check_daily_completion", rpcCheckDailyCompletion);
  }
}
