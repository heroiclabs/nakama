// QuizVerse — quizverse_submit_result RPC  (Phase 2)
//
// Server-authority grading layer.  The client sends back the answers it
// collected; this RPC does everything on the server side:
//
//   1. Load pack from qv_question_packs (task 2.1)
//   2. Duplicate-submit guard                (task 2.1)
//   3. Grade each answer against correct_option_ids (task 2.1)
//   4. Write graded_answers[] + submitted:true back into pack doc (task 2.2)
//   5. Delete qv_inflight entry (task 2.3)
//   6. Compute score + time bonus (task 2.4)
//   7. Update wallet (coins + XP) (task 2.4)
//   8. Submit to leaderboard (task 2.4)
//   9. Write per-topic KB performance doc (task 2.5)
//  10. Fire legacy analytics via __rpc_quiz_submit_result (task 2.5)
//  11. OCC-safe merge into qv_seen ledger (task 2.6)
//
// Request:
//   { pack_id, answers: [{ question_id, selected_option_id, time_ms? }], duration_ms? }
//
// Response:
//   { ok, pack_id, topic, correct, total, score, time_bonus, coins_earned, xp_earned,
//     graded_answers[], accuracy_pct }

namespace QvSubmitResult {

  // ── Storage ────────────────────────────────────────────────────────────────
  var COL_PACKS = "qv_question_packs";
  var COL_INFLT = "qv_inflight";
  var COL_SEEN  = "qv_seen";           // key = "global_{topic}" (quizverse_seen.js compat)
  var COL_KB    = "qv_kb";             // key = topic, user-owned — per-topic performance

  // ── Reward constants ───────────────────────────────────────────────────────
  var POINTS_PER_CORRECT = 100;        // base score per correct answer
  var TIME_BONUS_MAX     = 50;         // bonus per correct answer if answered in < 1 s
  var TIME_BONUS_STEP    = 5;          // lose N bonus pts for each additional second
  var COINS_PER_CORRECT  = 10;         // coins per correct answer
  var XP_PER_CORRECT     = 5;          // XP per correct answer
  var PERFECT_BONUS_COINS = 50;        // extra coins on 100% accuracy
  var PERFECT_BONUS_XP    = 25;        // extra XP on 100% accuracy

  // ── Leaderboard ────────────────────────────────────────────────────────────
  var LB_GLOBAL        = "quizverse_global";   // all-time global — NO reset (persistent rankings)
  var LB_RESET_ALLTIME = "";                    // never resets
  var LB_RESET_DAILY   = "0 0 * * *";          // midnight UTC daily (topic/game boards)

  // ── OCC retries ───────────────────────────────────────────────────────────
  var OCC_MAX_RETRIES = 3;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  function parseJson(payload: string): any {
    try { return JSON.parse(payload || "{}"); }
    catch (_e) { throw nakamaError("invalid JSON payload", nkruntime.Codes.INVALID_ARGUMENT); }
  }

  function nowMs(): number { return Date.now(); }

  function nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function slugify(s: string): string {
    return s.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 64);
  }

  // quizverse_seen.js-compatible key: "global_{topic}"
  function seenKey(topic: string): string {
    return slugify("global") + "_" + slugify(topic);
  }

  // ── Task 2.1 — grading ────────────────────────────────────────────────────

  /**
   * Grade one client answer against the server-side question.
   * `selected_option_id` should be an A/B/C/D letter.
   * `correct_option_ids` is an array (supports multi-select questions too).
   */
  function gradeAnswer(question: any, selectedOptionId: string): boolean {
    var correct: string[] = Array.isArray(question.correct_option_ids)
      ? question.correct_option_ids : [];
    for (var i = 0; i < correct.length; i++) {
      if (correct[i] === selectedOptionId) return true;
    }
    return false;
  }

  // ── Task 2.4 — scoring ────────────────────────────────────────────────────

  /**
   * Compute base score + per-question time bonus.
   * Time bonus: TIME_BONUS_MAX − (floor(time_ms / 1000) − 1) × TIME_BONUS_STEP
   * Capped at [0, TIME_BONUS_MAX].  Only applied to correct answers.
   */
  function computeScore(
    gradedAnswers: any[]
  ): { base: number; timeBonus: number; total: number } {
    var base = 0;
    var timeBonus = 0;
    for (var i = 0; i < gradedAnswers.length; i++) {
      var ga = gradedAnswers[i];
      if (!ga.is_correct) continue;
      base += POINTS_PER_CORRECT;
      var secs = ga.time_ms > 0 ? Math.floor(ga.time_ms / 1000) : 0;
      var bonus = TIME_BONUS_MAX - Math.max(0, (secs - 1) * TIME_BONUS_STEP);
      timeBonus += Math.max(0, bonus);
    }
    return { base: base, timeBonus: timeBonus, total: base + timeBonus };
  }

  // ── Task 2.6 — OCC-safe seen merge ───────────────────────────────────────
  //
  // Implements the same merge algorithm as quizverse_seen.js (qvsSeenMerge)
  // using the same storage collection/key so both codepaths interoperate.
  // Retries up to OCC_MAX_RETRIES on version conflict before giving up.

  function mergeSeenOcc(
    nk:          nkruntime.Nakama,
    logger:      nkruntime.Logger,
    userId:      string,
    topic:       string,
    questionIds: string[]
  ): void {
    if (!questionIds || questionIds.length === 0) return;
    var key = seenKey(topic);

    for (var attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
      try {
        var rows = nk.storageRead([{ collection: COL_SEEN, key: key, userId: userId }]);
        var rec: any  = (rows && rows.length > 0 && rows[0].value) ? rows[0].value : null;
        var ver: string = (rows && rows.length > 0 && rows[0].version) ? rows[0].version : "";
        var data: any = rec ? rec : { ids: {}, version: 2 };
        if (!data.ids) data.ids = {};

        var iso = nowIso();
        for (var i = 0; i < questionIds.length; i++) {
          var qid = questionIds[i];
          if (qid && typeof qid === "string") data.ids[qid] = iso;
        }

        // Cap ledger size at 10 000 — trim oldest entries
        var keys = Object.keys(data.ids);
        if (keys.length > 10000) {
          keys.sort(function(a, b) {
            var ta = Date.parse(data.ids[a]) || 0;
            var tb = Date.parse(data.ids[b]) || 0;
            return ta - tb;
          });
          for (var ri = 0; ri < keys.length - 10000; ri++) delete data.ids[keys[ri]];
        }

        data.version = 2;
        var writeObj: nkruntime.StorageWriteRequest = {
          collection: COL_SEEN, key: key, userId: userId,
          value: data,
          permissionRead: 1, permissionWrite: 0
        };
        if (ver) (writeObj as any).version = ver; // OCC guard (omit on first write)
        nk.storageWrite([writeObj]);
        return; // success
      } catch (e: any) {
        if (attempt === OCC_MAX_RETRIES - 1) {
          logger.warn("[QvSubmit] seen merge OCC exhausted for topic=" + topic + ": " + (e && e.message));
          return; // non-fatal — player can still see repeated questions, not a crash
        }
        // Version conflict → re-read and retry
      }
    }
  }

  // ── Task 2.5 — KB (knowledge base) update ────────────────────────────────
  //
  // Per-user, per-topic performance document stored in qv_kb/{topic}.
  // Tracks cumulative correct/total, accuracy, streak, and last score.
  // OCC-safe with OCC_MAX_RETRIES retries.

  function updateKbOcc(
    nk:      nkruntime.Nakama,
    logger:  nkruntime.Logger,
    userId:  string,
    topic:   string,
    correct: number,
    total:   number,
    score:   number
  ): void {
    for (var attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
      try {
        var rows = nk.storageRead([{ collection: COL_KB, key: topic, userId: userId }]);
        var rec: any  = (rows && rows.length > 0 && rows[0].value) ? rows[0].value : null;
        var ver: string = (rows && rows.length > 0 && rows[0].version) ? rows[0].version : "";

        var data: any = rec ? rec : {
          topic: topic, total_attempts: 0, total_correct: 0,
          accuracy_pct: 0, streak_correct: 0, last_score: 0, last_played_ms: 0
        };

        data.total_attempts += total;
        data.total_correct  += correct;
        data.accuracy_pct    = data.total_attempts > 0
          ? Math.round((data.total_correct * 1000) / data.total_attempts) / 10
          : 0;
        data.streak_correct  = (correct === total) ? (data.streak_correct + 1) : 0;
        data.last_score      = score;
        data.last_played_ms  = nowMs();

        var writeObj: nkruntime.StorageWriteRequest = {
          collection: COL_KB, key: topic, userId: userId,
          value: data,
          permissionRead: 1, permissionWrite: 0
        };
        if (ver) (writeObj as any).version = ver;
        nk.storageWrite([writeObj]);
        return;
      } catch (e: any) {
        if (attempt === OCC_MAX_RETRIES - 1) {
          logger.warn("[QvSubmit] KB OCC exhausted topic=" + topic + ": " + (e && e.message));
          return;
        }
      }
    }
  }

  // ── Task 2.4 — wallet update ──────────────────────────────────────────────

  function updateWallet(
    nk:         nkruntime.Nakama,
    logger:     nkruntime.Logger,
    userId:     string,
    topic:      string,
    coins:      number,
    xp:         number
  ): void {
    if (coins <= 0 && xp <= 0) return;
    try {
      var changeset: { [k: string]: number } = {};
      if (coins > 0) changeset["coins"] = coins;
      if (xp    > 0) changeset["xp"]    = xp;
      nk.walletUpdate(userId, changeset, { reason: "quiz_complete:" + topic }, true);
    } catch (e: any) {
      logger.warn("[QvSubmit] walletUpdate failed: " + (e && e.message));
    }
  }

  // ── Task 2.4 — leaderboard ────────────────────────────────────────────────

  function submitLeaderboard(
    nk:       nkruntime.Nakama,
    logger:   nkruntime.Logger,
    userId:   string,
    username: string,
    gameId:   string,
    topic:    string,
    score:    number
  ): void {
    if (score <= 0) return;
    var boards: string[] = [LB_GLOBAL];
    // Also submit to a per-topic board so topic rankings are possible
    if (topic) boards.push("quizverse_topic_" + slugify(topic));
    if (gameId) boards.push("leaderboard_" + gameId);

    for (var bi = 0; bi < boards.length; bi++) {
      try {
        nk.leaderboardRecordWrite(boards[bi], userId, username, score, 0, null, null);
      } catch (e: any) {
        // Leaderboard may not exist yet — create it then retry
        try {
          // Global board never resets; per-topic and per-game boards reset daily
          var resetSched = (boards[bi] === LB_GLOBAL) ? LB_RESET_ALLTIME : LB_RESET_DAILY;
          nk.leaderboardCreate(boards[bi], true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST, resetSched);
          nk.leaderboardRecordWrite(boards[bi], userId, username, score, 0, null, null);
        } catch (e2: any) {
          logger.warn("[QvSubmit] leaderboard " + boards[bi] + " failed: " + (e2 && e2.message));
        }
      }
    }
  }

  // ── Per-question quality stats (qv_question_elo) ─────────────────────────
  //
  // Fires after grading — updates accuracy + avg_time rolling stats and
  // auto-retires/flags questions that cross quality thresholds.
  // Non-blocking: each write is wrapped in its own try/catch; up to 20
  // questions per call to bound latency.

  var COL_QELO            = "qv_question_elo";
  var QELO_RETIRE_ACC     = 0.98;   // accuracy > this → too easy → retire
  var QELO_FLAG_ACC       = 0.10;   // accuracy < this AND fast → suspected bad question
  var QELO_FLAG_TIME_MS   = 1500;   // avg time < this → suspected random guessing
  var QELO_MIN_ATTEMPTS   = 100;    // threshold before retirement decisions kick in

  function updateQuestionElo(
    nk:            nkruntime.Nakama,
    logger:        nkruntime.Logger,
    gradedAnswers: any[]
  ): void {
    var limit = Math.min(gradedAnswers.length, 20); // cap per-call writes
    for (var gi = 0; gi < limit; gi++) {
      var ga = gradedAnswers[gi];
      if (!ga || !ga.question_id) continue;
      try {
        var rows = nk.storageRead([{ collection: COL_QELO, key: ga.question_id, userId: "00000000-0000-0000-0000-000000000000" }]);
        var doc: any = (rows && rows.length > 0 && rows[0].value) ? rows[0].value : {};
        var ver: string = (rows && rows.length > 0 && rows[0].version) ? rows[0].version : "";

        var attempts        = (doc.attempts        || 0) + 1;
        var correctAttempts = (doc.correct_attempts || 0) + (ga.is_correct ? 1 : 0);
        var accuracy        = correctAttempts / attempts;

        // Exponential moving average for time (alpha = 0.1)
        var prevAvg    = doc.avg_time_ms || 0;
        var thisTimeMs = (typeof ga.time_ms === "number" && ga.time_ms >= 0) ? ga.time_ms : 0;
        var avgTimeMs  = prevAvg > 0
          ? Math.round(prevAvg * 0.9 + thisTimeMs * 0.1)
          : thisTimeMs;

        // Auto-retirement logic
        var status = doc.quality_status || "active";
        if (status === "active" && attempts >= QELO_MIN_ATTEMPTS) {
          if (accuracy > QELO_RETIRE_ACC) {
            status = "retire";
            logger.info("[QvSubmit/qelo] retiring q=" + ga.question_id +
              " accuracy=" + accuracy.toFixed(3) + " attempts=" + attempts);
          } else if (accuracy < QELO_FLAG_ACC && avgTimeMs < QELO_FLAG_TIME_MS) {
            status = "flagged";
            logger.warn("[QvSubmit/qelo] flagging q=" + ga.question_id +
              " accuracy=" + accuracy.toFixed(3) + " avg_time_ms=" + avgTimeMs);
          }
        }

        var writeObj: nkruntime.StorageWriteRequest = {
          collection:      COL_QELO, key: ga.question_id, userId: "00000000-0000-0000-0000-000000000000",
          value: {
            attempts:         attempts,
            correct_attempts: correctAttempts,
            accuracy:         Math.round(accuracy * 1000) / 1000,
            avg_time_ms:      avgTimeMs,
            quality_status:   status,
            last_updated_ms:  nowMs()
          },
          permissionRead: 1, permissionWrite: 0
        };
        if (ver) (writeObj as any).version = ver; // OCC guard
        nk.storageWrite([writeObj]);
      } catch (e: any) {
        logger.warn("[QvSubmit/qelo] write failed q=" + ga.question_id + ": " + (e && e.message));
      }
    }
  }

  // ── Variable rewards engine ───────────────────────────────────────────────
  //
  // Adds dopamine-boosting variable reward events on top of base rewards.
  // All probabilities + thresholds are configurable via REWARD_CONFIG env var
  // (JSON string) so they can be tuned without a deployment.
  //
  // Events:
  //   "lucky_draw"  — 5% per-session chance: doubles coins + XP
  //   "streak_bonus"— N consecutive correct → +50% coins bonus
  //   "comeback"    — ≤25% first-half accuracy then ≥75% second-half → +30 XP

  function computeVariableRewards(
    ctx:           nkruntime.Context,
    correct:       number,
    _total:        number,
    gradedAnswers: any[],
    coinsBase:     number,
    xpBase:        number,
    correctStreak: number
  ): { bonusCoins: number; bonusXp: number; events: any[] } {
    var cfg: any = {};
    try { cfg = JSON.parse((ctx.env && ctx.env["REWARD_CONFIG"]) || "{}"); } catch (_ce) {}

    var bonusCoins = 0;
    var bonusXp    = 0;
    var events: any[] = [];

    // 1. Lucky draw
    var luckyPct = (typeof cfg.lucky_pct === "number") ? cfg.lucky_pct : 0.05;
    if (correct > 0 && Math.random() < luckyPct) {
      bonusCoins += coinsBase;
      bonusXp    += xpBase;
      events.push({
        type:         "lucky_draw",
        label:        "Lucky Quiz! 2× Rewards",
        bonus_coins:  coinsBase,
        bonus_xp:     xpBase
      });
    }

    // 2. Streak bonus (+50% coins when correctStreak ≥ threshold)
    var streakThreshold = (typeof cfg.streak_threshold === "number") ? cfg.streak_threshold : 5;
    if (correctStreak >= streakThreshold && correct > 0) {
      var streakBonus = Math.round(coinsBase * 0.5);
      bonusCoins += streakBonus;
      events.push({
        type:        "streak_bonus",
        label:       correctStreak + "-answer streak bonus!",
        bonus_coins: streakBonus,
        bonus_xp:    0
      });
    }

    // 3. Comeback bonus
    var half = Math.floor(gradedAnswers.length / 2);
    if (half >= 2) {
      var firstOk = 0; var secondOk = 0;
      for (var fi = 0; fi < half; fi++) {
        if (gradedAnswers[fi] && gradedAnswers[fi].is_correct) firstOk++;
      }
      for (var si = half; si < gradedAnswers.length; si++) {
        if (gradedAnswers[si] && gradedAnswers[si].is_correct) secondOk++;
      }
      var firstAcc  = firstOk / half;
      var secondAcc = secondOk / (gradedAnswers.length - half);
      var comebackXp = (typeof cfg.comeback_xp === "number") ? cfg.comeback_xp : 30;
      if (firstAcc <= 0.25 && secondAcc >= 0.75) {
        bonusXp += comebackXp;
        events.push({
          type:        "comeback",
          label:       "Comeback! Strong finish!",
          bonus_coins: 0,
          bonus_xp:    comebackXp
        });
      }
    }

    return { bonusCoins: bonusCoins, bonusXp: bonusXp, events: events };
  }

  // ── Active user registry ─────────────────────────────────────────────────
  // Writes a lightweight last-played record so prewarm_cron knows which users
  // to pre-warm. System-owned (userId:"") so it can be listed by the cron.

  var COL_ACTIVE = "qv_active_users";

  function updateActiveUser(nk: nkruntime.Nakama, userId: string): void {
    try {
      nk.storageWrite([{
        collection:      COL_ACTIVE, key: userId, userId: "00000000-0000-0000-0000-000000000000",
        value:           { last_played_ms: nowMs() },
        permissionRead:  0,
        permissionWrite: 0
      }]);
    } catch (_e) { /* non-critical */ }
  }

  // ── Main RPC ───────────────────────────────────────────────────────────────

  /**
   * quizverse_submit_result
   *
   * Input:
   * {
   *   pack_id:     string,               // from quizverse_get_questions response
   *   answers: [
   *     { question_id: string, selected_option_id: string, time_ms?: number }
   *   ],
   *   duration_ms?: number               // total quiz duration
   * }
   *
   * Output:
   * {
   *   ok:             true,
   *   pack_id:        string,
   *   topic:          string,
   *   correct:        number,
   *   total:          number,
   *   accuracy_pct:   number,            // 0–100
   *   score:          number,            // base + time bonus
   *   time_bonus:     number,
   *   coins_earned:   number,
   *   xp_earned:      number,
   *   graded_answers: GradedAnswer[]
   * }
   */
  function rpcSubmitResult(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {

    var req       = parseJson(payload);
    // Use QvContextResolver for unified auth + game_id allowlist + country_code (yel1/yel2)
    var rctx      = QvContextResolver.resolve(nk, ctx, req);
    var userId    = rctx.userId;
    var username  = rctx.username;
    var packId    = (typeof req.pack_id === "string" && req.pack_id) ? req.pack_id : "";
    var answers   = Array.isArray(req.answers) ? req.answers : [];
    var durationMs = typeof req.duration_ms === "number" ? req.duration_ms : 0;

    if (!packId)          throw nakamaError("pack_id is required",  nkruntime.Codes.INVALID_ARGUMENT);
    if (answers.length === 0) throw nakamaError("answers are required", nkruntime.Codes.INVALID_ARGUMENT);

    // ── Task 2.1 — load pack ──────────────────────────────────────────────
    var rows = nk.storageRead([{ collection: COL_PACKS, key: packId, userId: userId }]);
    if (!rows || rows.length === 0 || !rows[0].value) {
      throw nakamaError("pack not found: " + packId, nkruntime.Codes.NOT_FOUND);
    }
    var pack: any    = rows[0].value;
    var packVersion  = rows[0].version || "";

    var topic      = pack.topic      || "unknown";
    var gameId     = pack.game_id    || "";
    var packLang   = pack.lang_actual || pack.lang || "en";

    // ── Pack expiry guard (red1) ───────────────────────────────────────────
    if (pack.expires_at_ms && typeof pack.expires_at_ms === "number" && pack.expires_at_ms < nowMs()) {
      logger.warn("[QvSubmit] pack expired: pack_id=" + packId + " expired_at=" + pack.expires_at_ms);
      return JSON.stringify({
        ok:      false,
        error:   "pack_expired",
        pack_id: packId,
        message: "This question pack has expired. Please start a new quiz."
      });
    }

    // ── Task 2.1 — duplicate submit guard ─────────────────────────────────
    if (pack.submitted === true) {
      return JSON.stringify({
        ok:    false,
        error: "already_submitted",
        pack_id: packId,
        message: "This pack has already been submitted."
      });
    }

    // ── Task 2.1 — grade answers ──────────────────────────────────────────
    var questions: any[] = Array.isArray(pack.questions) ? pack.questions : [];
    if (questions.length === 0) {
      throw nakamaError("pack contains no questions", nkruntime.Codes.FAILED_PRECONDITION);
    }

    // Build a fast question-ID lookup
    var qIndex: { [id: string]: any } = {};
    for (var qi = 0; qi < questions.length; qi++) {
      qIndex[questions[qi].id] = questions[qi];
    }

    var correct = 0;
    var gradedAnswers: any[] = [];

    for (var ai = 0; ai < answers.length; ai++) {
      var a     = answers[ai];
      var qid   = (typeof a.question_id === "string") ? a.question_id : "";
      var selId = (typeof a.selected_option_id === "string") ? a.selected_option_id : "";
      var timeMs = (typeof a.time_ms === "number" && a.time_ms >= 0) ? a.time_ms : 0;

      var serverQ        = qIndex[qid] || null;
      var isCorrect      = serverQ ? gradeAnswer(serverQ, selId) : false;
      var correctOptIds  = serverQ ? (serverQ.correct_option_ids || []) : [];

      if (isCorrect) correct++;

      gradedAnswers.push({
        question_id:        qid,
        selected_option_id: selId,
        correct_option_ids: correctOptIds,
        is_correct:         isCorrect,
        time_ms:            timeMs
      });
    }

    var total       = questions.length;
    var accuracyPct = total > 0 ? Math.round((correct * 1000) / total) / 10 : 0;
    var isPerfect   = correct === total && total > 0;

    // ── Task 2.4 — compute score ──────────────────────────────────────────
    var scored     = computeScore(gradedAnswers);
    var totalScore = scored.total;

    // Rewards
    var coinsEarned = correct * COINS_PER_CORRECT + (isPerfect ? PERFECT_BONUS_COINS : 0);
    var xpEarned    = correct * XP_PER_CORRECT    + (isPerfect ? PERFECT_BONUS_XP    : 0);

    logger.info("[QvSubmit] pack=" + packId + " topic=" + topic +
      " correct=" + correct + "/" + total +
      " score=" + totalScore + " bonus=" + scored.timeBonus +
      " coins=" + coinsEarned + " xp=" + xpEarned);

    // ── Task 2.2 — write graded result back into pack doc ─────────────────
    try {
      pack.submitted       = true;
      pack.submitted_at_ms = nowMs();
      pack.correct         = correct;
      pack.total           = total;
      pack.accuracy_pct    = accuracyPct;
      pack.score           = totalScore;
      pack.time_bonus      = scored.timeBonus;
      pack.coins_earned    = coinsEarned;
      pack.xp_earned       = xpEarned;
      pack.graded_answers  = gradedAnswers;
      pack.duration_ms     = durationMs;

      var packWrite: nkruntime.StorageWriteRequest = {
        collection: COL_PACKS, key: packId, userId: userId,
        value: pack,
        permissionRead: 1, permissionWrite: 0
      };
      if (packVersion) (packWrite as any).version = packVersion; // OCC on pack doc
      nk.storageWrite([packWrite]);
    } catch (e: any) {
      logger.warn("[QvSubmit] pack write-back failed (non-fatal): " + (e && e.message));
    }

    // ── Task 2.3 — delete inflight entry ──────────────────────────────────
    try {
      nk.storageDelete([{ collection: COL_INFLT, key: packId, userId: userId }]);
    } catch (e: any) {
      logger.warn("[QvSubmit] inflight delete failed: " + (e && e.message));
    }

    // ── Task 2.4 — wallet + leaderboard (non-critical) ────────────────────
    updateWallet(nk, logger, userId, topic, coinsEarned, xpEarned);
    submitLeaderboard(nk, logger, userId, username, gameId, topic, totalScore);

    // ── Task 2.5 — KB performance write (non-critical) ────────────────────
    updateKbOcc(nk, logger, userId, topic, correct, total, totalScore);

    // ── Task 2.5 — analytics: fire legacy quiz_submit_result ──────────────
    try {
      var v1 = (globalThis as any).__rpc_quiz_submit_result;
      if (typeof v1 === "function") {
        var v1Payload = JSON.stringify({
          gameId:           gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b",
          gameMode:         "QuickPlay",
          score:            totalScore,
          correctAnswers:   correct,
          totalQuestions:   total,
          timeTakenSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : 0,
          won:              correct > total / 2,
          categoryName:     topic,
          metadata: {
            pack_id:        packId,
            scoring_version: "v3",
            lang:            packLang
          }
        });
        v1(ctx, logger, nk, v1Payload);
      }
    } catch (e: any) {
      logger.warn("[QvSubmit] legacy analytics dispatch failed: " + (e && e.message));
    }

    // ── Task 2.6 — OCC-safe seen merge ────────────────────────────────────
    var questionIds: string[] = [];
    for (var qi2 = 0; qi2 < questions.length; qi2++) questionIds.push(questions[qi2].id);
    mergeSeenOcc(nk, logger, userId, topic, questionIds);

    // ── SRQ — schedule wrong answers for spaced review (red2 / org4) ──────
    try {
      var wrongIds: string[] = [];
      var correctIds: string[] = [];
      for (var gi = 0; gi < gradedAnswers.length; gi++) {
        var ga = gradedAnswers[gi];
        if (ga.is_correct) correctIds.push(ga.question_id);
        else               wrongIds.push(ga.question_id);
      }
      QvSRQ.schedule(nk, userId, slugify(topic), wrongIds, correctIds);
    } catch (e: any) {
      logger.warn("[QvSubmit] SRQ schedule failed (non-fatal): " + (e && e.message));
    }

    // ── Question quality stats (qv_question_elo) ──────────────────────────
    try {
      updateQuestionElo(nk, logger, gradedAnswers);
    } catch (e: any) {
      logger.warn("[QvSubmit] qelo update failed (non-fatal): " + (e && e.message));
    }

    // ── Active user registry (for prewarm cron) ───────────────────────────
    updateActiveUser(nk, userId);

    // ── Player DNA update (red2) ───────────────────────────────────────────
    var masteryDelta = 0;
    try {
      var dna = PlayerDNA.load(nk, userId);
      var topicSlug = slugify(topic);
      var masteryBefore = dna.masteries[topicSlug] !== undefined ? dna.masteries[topicSlug] : 0;
      var accuracy01    = total > 0 ? correct / total : 0;
      PlayerDNA.updateAffinity(dna, topicSlug, true);
      PlayerDNA.updateMastery(dna, topicSlug, accuracy01);

      // Derive avg difficulty Elo from question difficulty strings
      var diffSum = 0; var diffN = 0;
      for (var di = 0; di < questions.length; di++) {
        var dif = questions[di].difficulty;
        diffSum += (dif === "hard" ? 1600 : dif === "easy" ? 800 : 1200);
        diffN++;
      }
      PlayerDNA.updateElo(dna, topicSlug, accuracy01, diffN > 0 ? Math.round(diffSum / diffN) : 1200);
      PlayerDNA.updateBehavioral(dna, total, new Date().getUTCHours());
      PlayerDNA.save(nk, userId, dna);

      var masteryAfter = dna.masteries[topicSlug] !== undefined ? dna.masteries[topicSlug] : masteryBefore;
      masteryDelta = Math.round((masteryAfter - masteryBefore) * 1000) / 1000;
      logger.info("[QvSubmit] DNA updated topic=" + topicSlug + " mastery_delta=" + masteryDelta +
        " elo=" + (dna.elos[topicSlug] || 1200));
    } catch (e: any) {
      logger.warn("[QvSubmit] DNA update failed (non-fatal): " + (e && e.message));
    }

    // ── Variable rewards engine ───────────────────────────────────────────
    // Compute bonus events BEFORE the response so correct streak is available.
    // correctStreak from scored block (or re-derive from gradedAnswers).
    var currentStreak = 0;
    for (var csi = gradedAnswers.length - 1; csi >= 0; csi--) {
      if (gradedAnswers[csi] && gradedAnswers[csi].is_correct) currentStreak++;
      else break;
    }
    var variableRewards = computeVariableRewards(ctx, correct, total, gradedAnswers,
      coinsEarned, xpEarned, currentStreak);
    var totalCoins = coinsEarned + variableRewards.bonusCoins;
    var totalXp    = xpEarned    + variableRewards.bonusXp;

    // Apply bonus to wallet if any events fired
    if (variableRewards.bonusCoins > 0 || variableRewards.bonusXp > 0) {
      try {
        var bonusChangeset: { [w: string]: number } = {};
        if (variableRewards.bonusCoins > 0) bonusChangeset["coins"] = variableRewards.bonusCoins;
        if (variableRewards.bonusXp    > 0) bonusChangeset["xp"]    = variableRewards.bonusXp;
        nk.walletUpdate(userId, bonusChangeset, { source: "variable_reward" }, false);
        logger.info("[QvSubmit] variable rewards userId=" + userId +
          " events=" + variableRewards.events.length +
          " bonus_coins=" + variableRewards.bonusCoins +
          " bonus_xp=" + variableRewards.bonusXp);
      } catch (ve: any) {
        logger.warn("[QvSubmit] variable reward wallet write failed: " + (ve && ve.message));
        totalCoins = coinsEarned;
        totalXp    = xpEarned;
      }
    }

    // ── Personalization block (red3) ───────────────────────────────────────
    var personalization: any = {
      next_suggested_topic: slugify(topic),
      review_due_count:     total - correct,
      mastery_delta:        masteryDelta,
      streak_at_risk:       false
    };
    try {
      var dnaP = PlayerDNA.load(nk, userId);
      // Suggest next topic: top affinity topic that is NOT the current one
      var topSuggs = PlayerDNA.topTopics(dnaP, 4);
      for (var pti = 0; pti < topSuggs.length; pti++) {
        if (topSuggs[pti] !== slugify(topic)) {
          personalization.next_suggested_topic = topSuggs[pti];
          break;
        }
      }
      // streak_at_risk: gap > 1.5× avg play interval
      var beh = dnaP.behavioral;
      if (beh && beh.last_played_at > 0 && beh.sessions_per_week > 0) {
        var avgIntervalSec = (7 * 86400) / beh.sessions_per_week;
        var sinceLastSec   = Math.floor(Date.now() / 1000) - beh.last_played_at;
        personalization.streak_at_risk = sinceLastSec > avgIntervalSec * 1.5;
      }
      // SRQ review count across all topics
      personalization.srq_due_count = QvSRQ.countDue(nk, userId);
    } catch (_pe: any) {}

    // ── Response ──────────────────────────────────────────────────────────
    return JSON.stringify({
      ok:              true,
      pack_id:         packId,
      topic:           topic,
      correct:         correct,
      total:           total,
      accuracy_pct:    accuracyPct,
      score:           totalScore,
      time_bonus:      scored.timeBonus,
      coins_earned:    totalCoins,
      xp_earned:       totalXp,
      is_perfect:      isPerfect,
      graded_answers:  gradedAnswers,
      reward_events:   variableRewards.events,
      personalization: personalization
    });
  }

  // ── Registration ───────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_submit_result", rpcSubmitResult);
  }

  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
