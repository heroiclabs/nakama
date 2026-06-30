// QuizVerse — quizverse_get_review RPC  (Phase 2.5)
//
// "Review & Learn" layer.  After a player submits answers via
// quizverse_submit_result, they can tap "Review & Learn" in Unity's
// LearningGamesPopup to replay each wrong (or all) question in a
// mini-game format selected from the list of eligible game modes.
//
// This RPC is READ-ONLY — it never writes storage.  All data it
// returns lives inside the qv_question_packs document that
// quizverse_submit_result already wrote and decorated with
// graded_answers[] + submitted:true.
//
// Security:
//   - Ownership is enforced by the Nakama storage read itself:
//     the pack is stored under userId=ctx.userId, so a different
//     user's userId will result in a NOT_FOUND (Nakama returns
//     nothing for cross-user reads without PUBLIC_READ permission).
//   - Submitted guard prevents review of in-progress packs.
//
// Request:
//   { pack_id: string, wrong_only?: boolean }
//   wrong_only defaults to true — only return wrongly answered cards.
//
// Response:
//   {
//     ok, pack_id, topic, lang,
//     total, correct, wrong_count, wrong_only,
//     review_cards: ReviewCard[]
//   }
//
// ReviewCard shape:
//   {
//     question_id, question_text, question_type, difficulty,
//     image_url,                    // "" when no media
//     player_answer_texts: string[],// text the player chose
//     correct_answer_texts: string[],// text of correct option(s)
//     all_options: OptionReview[],   // full option list with flags
//     explanation,
//     eligible_game_modes: string[]  // see eligibleModes() below
//   }
//
// OptionReview shape:
//   { id, text, is_correct: bool, was_selected: bool }
//
// eligible_game_modes values:
//   "mcq"            — standard multiple-choice replay (always eligible)
//   "fill_in_blank"  — blank a word in the question; player types the answer
//   "letter_scramble"— scramble letters of the correct answer to rearrange
//   (letter_scramble + fill_in_blank are excluded for multiple_select
//    questions because both assume a single text answer — task 2.5.3)

namespace QvGetReview {

  // ── Storage ──────────────────────────────────────────────────────────────────
  var COL_PACKS = "qv_question_packs";

  // ── Game mode constants (must match LearningGamesPopup mode strings) ─────────
  var MODE_MCQ            = "mcq";
  var MODE_FILL_IN_BLANK  = "fill_in_blank";
  var MODE_LETTER_SCRAMBLE = "letter_scramble";

  // ── Low-level helpers ─────────────────────────────────────────────────────────

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  function parseJson(payload: string): any {
    try { return JSON.parse(payload || "{}"); }
    catch (_e) { throw nakamaError("invalid JSON payload", nkruntime.Codes.INVALID_ARGUMENT); }
  }

  // ── Task 2.5.3 — eligible game modes ─────────────────────────────────────────
  //
  // Rules:
  //   multiple_select → "mcq" only
  //     (fill_in_blank / letter_scramble assume one answer text; multiple
  //      correct options break the UI assumptions of those modes)
  //   true_false      → "mcq" + "fill_in_blank"
  //     (letter_scramble on "True"/"False" has zero learning value)
  //   single_select   → all three modes

  function eligibleModes(questionType: string): string[] {
    if (questionType === "multiple_select") {
      return [MODE_MCQ];
    }
    if (questionType === "true_false") {
      return [MODE_MCQ, MODE_FILL_IN_BLANK];
    }
    // single_select (default) — all modes
    return [MODE_MCQ, MODE_FILL_IN_BLANK, MODE_LETTER_SCRAMBLE];
  }

  // ── Task 2.5.2 — build one review card ───────────────────────────────────────
  //
  // Resolves human-readable answer texts from the option list stored in the
  // pack document.  `graded` is one entry from graded_answers[].
  //
  // Pack question shape  (as stored by get_questions.ts / submit_result.ts):
  //   {
  //     id, question_text, question_type, difficulty,
  //     options:            [{ id: "A"|"B"|"C"|"D", text: string }],
  //     correct_option_ids: string[],
  //     has_media, media:   { type, url, thumbnail_url, … } | null,
  //     explanation
  //   }
  //
  // graded entry shape (from submit_result.ts):
  //   { question_id, selected_option_id, correct_option_ids, is_correct, time_ms }

  function buildReviewCard(question: any, graded: any): any {
    var qType: string = question.question_type || "single_select";

    // Build option text lookup and enriched option list in one pass
    var optTextById: { [id: string]: string } = {};
    var allOptions: any[] = [];
    var opts: any[] = Array.isArray(question.options) ? question.options : [];

    // The correct / selected ID sets (from graded — server-authoritative)
    var correctIds: string[] = Array.isArray(graded.correct_option_ids)
      ? graded.correct_option_ids : [];
    var selectedId: string = (typeof graded.selected_option_id === "string")
      ? graded.selected_option_id : "";

    var correctIdSet: { [id: string]: boolean } = {};
    for (var ci = 0; ci < correctIds.length; ci++) correctIdSet[correctIds[ci]] = true;

    for (var oi = 0; oi < opts.length; oi++) {
      var opt = opts[oi];
      var optId: string   = opt.id   || "";
      var optText: string = opt.text || "";
      optTextById[optId] = optText;
      allOptions.push({
        id:           optId,
        text:         optText,
        is_correct:   !!correctIdSet[optId],
        was_selected: (optId === selectedId)
      });
    }

    // correct_answer_texts — texts of all correct options (server-authoritative list)
    var correctAnswerTexts: string[] = [];
    for (var cj = 0; cj < correctIds.length; cj++) {
      var t = optTextById[correctIds[cj]];
      if (t) correctAnswerTexts.push(t);
    }

    // player_answer_texts — text of the option the player actually chose
    var playerAnswerTexts: string[] = [];
    if (selectedId && optTextById[selectedId]) {
      playerAnswerTexts.push(optTextById[selectedId]);
    }

    // image_url — best available URL from media block
    var imageUrl = "";
    if (question.has_media && question.media) {
      imageUrl = question.media.url || question.media.thumbnail_url || "";
    }

    return {
      question_id:          question.id || "",
      question_text:        question.question_text || "",
      question_type:        qType,
      difficulty:           question.difficulty || "medium",
      image_url:            imageUrl,
      player_answer_texts:  playerAnswerTexts,
      correct_answer_texts: correctAnswerTexts,
      all_options:          allOptions,
      explanation:          question.explanation || "",
      eligible_game_modes:  eligibleModes(qType)
    };
  }

  // ── Main RPC handler ──────────────────────────────────────────────────────────

  /**
   * quizverse_get_review
   *
   * Input:
   *   {
   *     pack_id:    string,   // from quizverse_get_questions response
   *     wrong_only?: boolean  // default true — only return wrong-answer cards
   *   }
   *
   * Output (success):
   *   {
   *     ok:           true,
   *     pack_id:      string,
   *     topic:        string,
   *     lang:         string,
   *     total:        number,           // total questions in pack
   *     correct:      number,           // how many the player got right
   *     wrong_count:  number,           // review_cards.length
   *     wrong_only:   boolean,
   *     review_cards: ReviewCard[]
   *   }
   *
   * Output (guard hit — pack not found / not submitted):
   *   throws with appropriate Nakama error code
   */
  function rpcGetReview(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {

    // ── Auth + context (yel1/yel2) ────────────────────────────────────────────
    var req       = parseJson(payload);
    var rctx      = QvContextResolver.resolve(nk, ctx, req);
    var userId    = rctx.userId;

    // ── Parse request ─────────────────────────────────────────────────────────
    var packId    = (typeof req.pack_id === "string" && req.pack_id) ? req.pack_id : "";
    // wrong_only defaults to true; pass wrong_only:false to review all questions
    var wrongOnly = (req.wrong_only !== false);

    if (!packId) throw nakamaError("pack_id is required", nkruntime.Codes.INVALID_ARGUMENT);

    // ── Task 2.5.1 — load pack (ownership enforced by Nakama storage ACL) ────
    var rows = nk.storageRead([{ collection: COL_PACKS, key: packId, userId: userId }]);
    if (!rows || rows.length === 0 || !rows[0].value) {
      throw nakamaError("pack not found: " + packId, nkruntime.Codes.NOT_FOUND);
    }
    var pack: any = rows[0].value;

    var topic   = pack.topic      || "unknown";
    var lang    = pack.lang_actual || pack.lang || "en";

    // ── Task 2.5.1 — submitted guard ─────────────────────────────────────────
    if (pack.submitted !== true) {
      throw nakamaError(
        "pack has not been submitted yet — call quizverse_submit_result first",
        nkruntime.Codes.FAILED_PRECONDITION
      );
    }

    // ── Build graded-answer index: question_id → graded entry ────────────────
    var gradedAnswers: any[] = Array.isArray(pack.graded_answers) ? pack.graded_answers : [];
    var gradedIndex: { [id: string]: any } = {};
    for (var gi = 0; gi < gradedAnswers.length; gi++) {
      var ga = gradedAnswers[gi];
      if (ga && ga.question_id) gradedIndex[ga.question_id] = ga;
    }

    // ── Task 2.5.2 — build review cards ──────────────────────────────────────
    var questions: any[] = Array.isArray(pack.questions) ? pack.questions : [];
    var reviewCards: any[] = [];

    for (var qi = 0; qi < questions.length; qi++) {
      var q       = questions[qi];
      var graded  = gradedIndex[q.id] || null;

      // If we have no graded record for this question, skip it
      if (!graded) continue;

      // wrong_only: skip correctly answered questions
      if (wrongOnly && graded.is_correct === true) continue;

      reviewCards.push(buildReviewCard(q, graded));
    }

    logger.info("[QvReview] pack=" + packId + " topic=" + topic +
      " wrong_only=" + wrongOnly + " cards=" + reviewCards.length +
      "/" + questions.length);

    return JSON.stringify({
      ok:          true,
      pack_id:     packId,
      topic:       topic,
      lang:        lang,
      total:       questions.length,
      correct:     typeof pack.correct === "number" ? pack.correct : 0,
      wrong_count: reviewCards.length,
      wrong_only:  wrongOnly,
      review_cards: reviewCards
    });
  }

  // ── Registration ─────────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_get_review", rpcGetReview);
  }

  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
