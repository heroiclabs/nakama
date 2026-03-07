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
      dateStr = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
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
