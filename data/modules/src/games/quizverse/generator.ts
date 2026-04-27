// QuizVerse turn generator — implements the SyncTurnMatch IGenerator
// contract. Produces one quiz question per turn, scores submissions,
// and builds the QV_REVEAL payload that goes back to clients.
//
// Three modes share the same base behaviour, differing only in scoring
// curve and pack selection (driven by `template_init.mode`):
//   - quizverse:classic       — ranked-style scoring, public packs.
//   - quizverse:friend_battle — friend-only, fixed length, lenient.
//   - quizverse:link_and_play — short room with code, faster cadence.

namespace QuizVerseGenerator {
  // Score for a fully correct, instant answer. Speed bonus decays
  // linearly to 0 across the input window. Wrong answer = small
  // penalty so guessing does not pay; no_submit is a flat 0.
  var BASE_CORRECT_SCORE = 1000;
  var WRONG_PENALTY      = -100;
  var NO_SUBMIT_SCORE    = 0;

  interface IGenBlob {
    pack_id: string;
    pack: QuizVerseGame.IPack;
    cursor: number;       // Index into pack.questions.
    questions_total: number;
    per_question_ms: number;
    mode: string;
    // Per-question state captured at nextTurn() time; consumed by
    // scoreSubmission()/buildResolvedPayload() in the same turn loop.
    current_correct_index: number;
    current_question_id: string;
  }

  function pickPack(nk: nkruntime.Nakama, init: QuizVerseGame.IInit): QuizVerseGame.IPack {
    return QuizVersePackStore.readPack(nk, init.pack_id);
  }

  // Fisher-Yates over indices so each match draws a deterministic-but-
  // shuffled subset (the kernel does not provide a per-match seed yet,
  // so we use Date.now() — collisions across concurrent matches are
  // acceptable for content variety; cheating-resistance comes from the
  // server-authoritative correct_index, not draw secrecy).
  function shuffleIndices(n: number): number[] {
    var idx: number[] = [];
    for (var i = 0; i < n; i++) idx.push(i);
    for (var j = n - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = idx[j]; idx[j] = idx[k]; idx[k] = tmp;
    }
    return idx;
  }

  function buildShuffledPack(src: QuizVerseGame.IPack, take: number): QuizVerseGame.IPack {
    var n = src.questions.length;
    var sample = Math.min(take, n);
    var order = shuffleIndices(n);
    var picked: QuizVerseGame.IQuestion[] = [];
    for (var i = 0; i < sample; i++) picked.push(src.questions[order[i]]);
    return {
      pack_id: src.pack_id,
      locale: src.locale,
      revision: src.revision,
      questions: picked
    };
  }

  function makeGenerator(generatorId: string): MpKernelSyncTurn.IGenerator {
    return {
      generatorId: generatorId,
      initBlob: function (initParams: any): IGenBlob {
        var init = initParams as QuizVerseGame.IInit;
        var nk = (initParams && initParams.__nk) as nkruntime.Nakama; // injected by registerNk()
        // initBlob runs inside the kernel's matchInit, but the kernel
        // does not pass `nk` directly to generators. We lazy-resolve the
        // pack on the FIRST nextTurn() call using a closure-captured
        // store function. The blob keeps the un-shuffled pack cached
        // after that.
        var blob: IGenBlob = {
          pack_id: (init && init.pack_id) || QuizVerseGame.DefaultInit.pack_id,
          pack: { pack_id: "", questions: [] },
          cursor: 0,
          questions_total: (init && init.questions_total) || QuizVerseGame.DefaultInit.questions_total,
          per_question_ms: (init && init.per_question_ms) || QuizVerseGame.DefaultInit.per_question_ms,
          mode: (init && init.mode) || QuizVerseGame.DefaultInit.mode,
          current_correct_index: -1,
          current_question_id: ""
        };
        if (nk) {
          var srcPack = pickPack(nk, init || QuizVerseGame.DefaultInit);
          blob.pack = buildShuffledPack(srcPack, blob.questions_total);
        }
        return blob;
      },

      nextTurn: function (ctx) {
        var blob = ctx.blob as IGenBlob;
        // Late-init pack if the kernel built blob without `nk` (older
        // call sites). Falls through to the seed pack so smoke tests
        // never end with zero turns.
        if (!blob.pack || !blob.pack.questions || blob.pack.questions.length === 0) {
          blob.pack = buildShuffledPack(QuizVerseGame.SEED_PACK, blob.questions_total);
        }
        if (blob.cursor >= blob.pack.questions.length || blob.cursor >= blob.questions_total) {
          return null;
        }
        var q = blob.pack.questions[blob.cursor];
        blob.cursor++;
        blob.current_correct_index = q.correct_index;
        blob.current_question_id = q.question_id;
        var isFinal = blob.cursor >= blob.pack.questions.length || blob.cursor >= blob.questions_total;
        return {
          turn_payload: {
            // Mirrors QuestionPrompt in quizverse.proto. Note we DO NOT
            // include the correct_index — clients compute correctness
            // server-side via QV_REVEAL.
            question_id: q.question_id,
            text:        q.text,
            options:     q.options,
            image_url:   q.image_url || "",
            audio_url:   q.audio_url || "",
            category:    q.category || "",
            difficulty:  q.difficulty || 1,
            time_ms:     blob.per_question_ms
          },
          result_payload_for_correct: {
            question_id: q.question_id,
            correct_option: q.correct_index,
            explanation: q.explanation || ""
          },
          score_for_correct_full: BASE_CORRECT_SCORE,
          score_for_wrong: WRONG_PENALTY,
          score_for_no_submit: NO_SUBMIT_SCORE,
          input_window_ms: blob.per_question_ms,
          is_final_turn: isFinal
        };
      },

      // Submission shape matches QvAnswer in quizverse.proto.
      // Clients send { question_id, option_index, latency_ms?, used_lifeline? }.
      // We trust the SERVER-recorded response_ms for scoring (kernel
      // captures it on receipt), not the client-reported latency_ms,
      // which is purely diagnostic.
      scoreSubmission: function (submission, correctPayload, responseMs, baseReward) {
        if (!submission || !correctPayload) return WRONG_PENALTY;
        var sel = submission.option_index;
        if (typeof sel !== "number") return WRONG_PENALTY;
        if (sel === correctPayload.correct_option) {
          // Speed bonus: full reward at 0ms, 50% at the input window
          // edge. Keeps the curve gentle so packets-loss-induced
          // jitter doesn't tank scores.
          var window = (submission.__input_window_ms || 15000);
          var ratio = Math.max(0, Math.min(1, 1 - (responseMs / window) * 0.5));
          // Lifeline-assisted answers earn 60% of base — keeps lifelines
          // useful but not OP. Matches the legacy Photon behaviour.
          if (submission.used_lifeline) ratio *= 0.6;
          return Math.round(baseReward * ratio);
        }
        return WRONG_PENALTY;
      },

      buildResolvedPayload: function (correctPayload, verdicts, responseMs) {
        // Build PlayerAnswerSummary[] mirroring quizverse.proto Reveal.
        var players: any[] = [];
        for (var u in verdicts) {
          if (!verdicts.hasOwnProperty(u)) continue;
          var v = verdicts[u]; // 1=correct, 0=wrong, -1=no_submit
          players.push({
            user_id: u,
            chose_option: -1,    // Filled by the kernel diff-stream in P5.
            correct: v === 1,
            latency_ms: responseMs[u] || 0,
            delta_score: 0,      // Score delta carried via SCORE_UPDATE.
            streak: 0,
            used_lifeline: false
          });
        }
        return {
          question_id: correctPayload.question_id,
          correct_option: correctPayload.correct_option,
          explanation: correctPayload.explanation || "",
          players: players
        };
      }
    };
  }

  // The kernel's IGenerator API does not pass `nk` into initBlob, so we
  // wrap the registered generators here to inject it via a thread-local
  // (single-threaded JS runtime, so safe). Called from
  // QuizVersePlugin.register().
  var pendingNk: nkruntime.Nakama | null = null;

  export function registerNk(nk: nkruntime.Nakama): void { pendingNk = nk; }

  function wrapInitBlob(g: MpKernelSyncTurn.IGenerator): MpKernelSyncTurn.IGenerator {
    var orig = g.initBlob;
    g.initBlob = function (initParams: any) {
      if (pendingNk && initParams && typeof initParams === "object") {
        initParams.__nk = pendingNk;
      }
      return orig(initParams);
    };
    return g;
  }

  export function buildAll(): MpKernelSyncTurn.IGenerator[] {
    return [
      wrapInitBlob(makeGenerator(QuizVerseGame.Mode.CLASSIC)),
      wrapInitBlob(makeGenerator(QuizVerseGame.Mode.FRIEND_BATTLE)),
      wrapInitBlob(makeGenerator(QuizVerseGame.Mode.LINK_AND_PLAY))
    ];
  }
}
