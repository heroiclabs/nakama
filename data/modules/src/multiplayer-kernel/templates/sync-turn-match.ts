// SyncTurnMatch — synchronous turn template.
// Server-authoritative timer + opcode fan-out + scoring loop.
// Reserved opcode range 0x4000-0x4FFF (templates/sync_turn.proto).
//
// Lifecycle:
//   PreGame:  waiting for >= min_players to ready up.
//   Turn:     server emits TURN_START, opens input, gathers TURN_INPUT_SUBMIT,
//             closes input on timer expiry OR all-submitted, emits
//             TURN_RESOLVED, ScoreUpdate, then loops or ends match.
//   PostGame: emits MATCH_ENDED + persists MatchResultEnvelope.

namespace MpKernelSyncTurn {
  // Opcodes (mirror templates/sync_turn.proto SyncTurnOp).
  export var Op = {
    TURN_START:           0x4001,
    TURN_INPUT_OPENED:    0x4002,
    TURN_INPUT_CLOSED:    0x4003,
    TURN_RESOLVED:        0x4004,
    SCORE_UPDATE:         0x4005,
    PLAYER_ELIMINATED:    0x4006,
    ROUND_STARTED:        0x4007,
    ROUND_ENDED:          0x4008,
    TURN_INPUT_SUBMIT:    0x4010,
    PLAYER_READY:         0x4011,
    PLAYER_FORFEIT:       0x4012
  };

  // Template-init defaults (game plugins override).
  export var DefaultInit = {
    min_players: 2,
    max_players: 5,
    default_input_window_ms: 15000,
    max_match_duration_ms: 30 * 60 * 1000, // 30 min hard cap.
    reconnect_grace_ms: 60000,
    game_id: "",
    agent_seat_count: 0,
    // The game plugin populates this with its turn-generator hook id.
    // The kernel calls it via an inline closure registered at template
    // bootstrap (see registerGenerator below).
    generator_id: ""
  };

  // Game plugin contract: a function that produces the next turn payload
  // (e.g. quiz question) given the current match state. Stateful — gets
  // a per-match opaque blob it can mutate.
  export interface IGenerator {
    generatorId: string;
    initBlob(initParams: any): any;
    // Return null = no more turns -> end match.
    nextTurn(state: ITurnGenContext): {
      turn_payload: any;
      result_payload_for_correct: any; // E.g. correct_option_id.
      score_for_correct_full: number;  // Base reward; speed bonuses applied separately.
      score_for_wrong: number;
      score_for_no_submit: number;
      input_window_ms?: number;
      is_final_turn?: boolean;
    } | null;
    // Score a submission. Returns delta to apply to user's score.
    scoreSubmission(submission: any, correctPayload: any, responseMs: number, baseReward: number): number;
    // Build the per-turn QuestionResolved-equivalent payload broadcast to
    // all clients. `verdicts` keyed by user_id: 1=correct, 0=wrong, -1=no_submit.
    buildResolvedPayload(correctPayload: any, verdicts: { [u: string]: number }, responseMs: { [u: string]: number }): any;
  }

  export interface ITurnGenContext {
    blob: any;
    turn_index: number;
    round_index: number;
    template_init: any;
  }

  var generators: { [id: string]: IGenerator } = {};

  export function registerGenerator(g: IGenerator): void {
    generators[g.generatorId] = g;
  }

  // -------- match state --------

  enum Phase {
    PRE_GAME       = 0,
    TURN_INPUT_OPEN= 1,
    TURN_RESOLVING = 2,
    POST_GAME      = 3
  }

  export interface IPlayerStats {
    user_id: string;
    is_agent: boolean;
    score: number;
    correct_count: number;
    wrong_count: number;
    no_submit_count: number;
    forfeited: boolean;
  }

  export interface IState {
    init: any;            // SyncTurnInitParams.
    phase: Phase;
    turn_index: number;
    round_index: number;
    input_opens_at_ms: number;
    input_closes_at_ms: number;
    current_turn_payload: any;
    current_correct_payload: any;
    current_base_reward: number;
    current_wrong_penalty: number;
    current_no_submit_penalty: number;
    submissions: { [user_id: string]: { payload: any; response_ms: number; recv_match_ms: number } };
    ready: { [user_id: string]: boolean };
    forfeited: { [user_id: string]: boolean };
    stats: { [user_id: string]: IPlayerStats };
    match_started_unix_ms: number;
    match_force_end_at_unix_ms: number;
    pending_end_reason: string;
    generator: IGenerator | null;
    generator_blob: any;
    is_final_turn: boolean;
    // Per-match outbound seq counter. Was a module-scoped global in P1
    // pre-release which silently corrupted seq monotonicity across
    // concurrent matches; now isolated per-match.
    outbound_seq: number;
  }

  // -------- template implementation --------

  export var template: MpKernel.IMatchTemplate<IState> = {
    templateId: "sync-turn-v1",
    opRange: { from: 0x4000, to: 0x4FFF },
    defaultInit: DefaultInit,

    initState: function (_ctx, _logger, _nk, params) {
      var init = mergeInit(params.template_init);
      var gen = init.generator_id ? generators[init.generator_id] : null;
      var blob = gen ? gen.initBlob(init) : null;

      var s: IState = {
        init: init,
        phase: Phase.PRE_GAME,
        turn_index: 0,
        round_index: 0,
        input_opens_at_ms: 0,
        input_closes_at_ms: 0,
        current_turn_payload: null,
        current_correct_payload: null,
        current_base_reward: 0,
        current_wrong_penalty: 0,
        current_no_submit_penalty: 0,
        submissions: {},
        ready: {},
        forfeited: {},
        stats: {},
        match_started_unix_ms: Date.now(),
        match_force_end_at_unix_ms: Date.now() + init.max_match_duration_ms,
        pending_end_reason: "",
        generator: gen,
        generator_blob: blob,
        is_final_turn: false,
        outbound_seq: 1
      };

      var label = JSON.stringify({
        template_id: "sync-turn-v1",
        game_id: params.game_id,
        max_players: init.max_players,
        min_players: init.min_players
      });

      // 4 Hz tick is plenty for sync-turn; finer cadences add cost without value.
      return { state: s, tickRate: 4, label: label };
    },

    onJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _presence, _metadata) {
      var ks = state as IState;
      var seatCount = countTotalSeats(ks);
      if (seatCount >= ks.init.max_players) {
        return { state: ks, accept: false, rejectMessage: "match full" };
      }
      if (ks.phase === Phase.POST_GAME) {
        return { state: ks, accept: false, rejectMessage: "match ended" };
      }
      return { state: ks, accept: true };
    },

    onJoin: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presences) {
      var ks = state as IState;
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (!ks.stats[p.userId]) {
          ks.stats[p.userId] = {
            user_id: p.userId,
            is_agent: p.userId.indexOf("agt_") === 0,
            score: 0,
            correct_count: 0,
            wrong_count: 0,
            no_submit_count: 0,
            forfeited: false
          };
        }
      }
      return { state: ks };
    },

    onLeave: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presences) {
      var ks = state as IState;
      // Mark forfeit only if the match has started; pre-game leaves are fine.
      if (ks.phase !== Phase.PRE_GAME) {
        for (var i = 0; i < presences.length; i++) {
          ks.forfeited[presences[i].userId] = true;
          if (ks.stats[presences[i].userId]) {
            ks.stats[presences[i].userId].forfeited = true;
          }
        }
      }
      return { state: ks };
    },

    onLoop: function (ctx, logger, _nk, dispatcher, _tick, state, messages) {
      var ks = state as IState;
      var matchId = (ctx as any).matchId || "";
      var nowUnixMs = Date.now();
      var matchTimeMs = nowUnixMs - ks.match_started_unix_ms;

      // 0. Hard-cap match duration (Pillar 8 — duration_exceeded).
      if (nowUnixMs > ks.match_force_end_at_unix_ms && ks.phase !== Phase.POST_GAME) {
        ks.pending_end_reason = "duration_exceeded";
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.DURATION_EXCEEDED);
      }

      // 1. Process inbound game opcodes.
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        applyInbound(ks, m, matchTimeMs, logger);
      }

      // 2. Drive the turn FSM.
      switch (ks.phase) {
        case Phase.PRE_GAME:
          // Auto-start when min_players are present (no explicit ready needed
          // for v1; PLAYER_READY gates upgrade in P4 if required).
          if (countActiveSeats(ks) >= ks.init.min_players) {
            startNextTurn(ks, dispatcher, matchId, logger);
          }
          break;
        case Phase.TURN_INPUT_OPEN:
          if (matchTimeMs >= ks.input_closes_at_ms || allActiveSubmitted(ks)) {
            closeInputAndResolve(ks, dispatcher, matchId, logger);
          }
          break;
        case Phase.TURN_RESOLVING:
          // After 1 tick (~250ms) of letting clients receive TURN_RESOLVED,
          // start the next turn.
          if (matchTimeMs - ks.input_closes_at_ms >= 250) {
            startNextTurn(ks, dispatcher, matchId, logger);
          }
          break;
        case Phase.POST_GAME:
          return null; // Match end persisted in finalizeMatch on prior tick.
      }

      return { state: ks };
    },

    onTerminate: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _graceSeconds) {
      return { state: state };
    },

    buildResult: function (state, reason) {
      var ks = state as IState;
      var outcomes: MpKernel.IPlayerOutcome[] = [];
      var rankList: IPlayerStats[] = [];
      for (var u in ks.stats) {
        if (ks.stats.hasOwnProperty(u)) rankList.push(ks.stats[u]);
      }
      rankList.sort(function (a, b) { return b.score - a.score; });
      for (var i = 0; i < rankList.length; i++) {
        var st = rankList[i];
        outcomes.push({
          user_id: st.user_id,
          is_agent: st.is_agent,
          placement: i + 1,
          score: st.score,
          completed: !st.forfeited,
          left_early: st.forfeited,
          game_payload: {
            correct_count: st.correct_count,
            wrong_count: st.wrong_count,
            no_submit_count: st.no_submit_count
          }
        });
      }
      return {
        match_id: "", // filled by kernel finalizer
        template_id: "sync-turn-v1",
        game_id: "",
        started_unix_ms: ks.match_started_unix_ms,
        ended_unix_ms: 0,
        duration_ms: 0,
        outcomes: outcomes,
        game_payload: {
          end_reason: reason || ks.pending_end_reason || "completed",
          total_turns: ks.turn_index
        }
      };
    }
  };

  // -------- internals --------

  function mergeInit(init: any): any {
    var out: any = {};
    for (var k in DefaultInit) {
      if (DefaultInit.hasOwnProperty(k)) out[k] = (DefaultInit as any)[k];
    }
    if (init) {
      for (var k2 in init) {
        if (init.hasOwnProperty(k2)) out[k2] = init[k2];
      }
    }
    return out;
  }

  function countTotalSeats(ks: IState): number {
    var n = 0;
    for (var k in ks.stats) {
      if (ks.stats.hasOwnProperty(k)) n++;
    }
    return n;
  }
  function countActiveSeats(ks: IState): number {
    var n = 0;
    for (var k in ks.stats) {
      if (ks.stats.hasOwnProperty(k) && !ks.forfeited[k]) n++;
    }
    return n;
  }
  function allActiveSubmitted(ks: IState): boolean {
    for (var k in ks.stats) {
      if (!ks.stats.hasOwnProperty(k)) continue;
      if (ks.forfeited[k]) continue;
      if (!ks.submissions[k]) return false;
    }
    return countActiveSeats(ks) > 0;
  }

  function applyInbound(ks: IState, m: nkruntime.MatchMessage, matchTimeMs: number, _logger: nkruntime.Logger): void {
    var raw = (typeof m.data === "string") ? m.data : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
    if (!raw) return;
    var parsed: any;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    var op = m.opCode;
    var sender = m.sender.userId;
    if (op === Op.TURN_INPUT_SUBMIT) {
      if (ks.phase !== Phase.TURN_INPUT_OPEN) return;
      if (ks.forfeited[sender]) return;
      if (ks.submissions[sender]) return; // No double-submit per turn.
      var p = parsed.p || {};
      var serverResponseMs = matchTimeMs - ks.input_opens_at_ms;
      // Clamp client-claimed response ms to [0, server response ms] (Pillar 8).
      var claimedMs = (typeof p.client_response_ms === "number") ? p.client_response_ms : serverResponseMs;
      if (claimedMs < 0) claimedMs = 0;
      if (claimedMs > serverResponseMs) claimedMs = serverResponseMs;
      ks.submissions[sender] = {
        payload: p,
        response_ms: claimedMs,
        recv_match_ms: matchTimeMs
      };
    } else if (op === Op.PLAYER_READY) {
      ks.ready[sender] = true;
    } else if (op === Op.PLAYER_FORFEIT) {
      ks.forfeited[sender] = true;
      if (ks.stats[sender]) ks.stats[sender].forfeited = true;
    }
  }

  function startNextTurn(
    ks: IState,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    logger: nkruntime.Logger
  ): void {
    if (!ks.generator) {
      logger.warn("[SyncTurn] no generator registered; cannot start next turn (game_id=%s)", ks.init.game_id || "?");
      // No generator = end immediately. Game plugins that don't supply
      // a generator typically handle turn payload themselves on the wire.
      ks.pending_end_reason = "no_generator";
      endMatch(ks, dispatcher, matchId, MpKernel.EndReason.KERNEL_INTERNAL);
      return;
    }

    if (ks.is_final_turn) {
      ks.pending_end_reason = "completed";
      endMatch(ks, dispatcher, matchId, MpKernel.EndReason.COMPLETED);
      return;
    }

    ks.turn_index++;
    ks.submissions = {};

    var gen = ks.generator.nextTurn({
      blob: ks.generator_blob,
      turn_index: ks.turn_index,
      round_index: ks.round_index,
      template_init: ks.init
    });
    if (gen === null) {
      ks.pending_end_reason = "completed";
      endMatch(ks, dispatcher, matchId, MpKernel.EndReason.COMPLETED);
      return;
    }

    ks.current_turn_payload = gen.turn_payload;
    ks.current_correct_payload = gen.result_payload_for_correct;
    ks.current_base_reward = gen.score_for_correct_full;
    ks.current_wrong_penalty = gen.score_for_wrong;
    ks.current_no_submit_penalty = gen.score_for_no_submit;
    ks.is_final_turn = !!gen.is_final_turn;

    var window = (gen.input_window_ms && gen.input_window_ms > 0)
      ? gen.input_window_ms
      : ks.init.default_input_window_ms;

    var matchTimeMs = Date.now() - ks.match_started_unix_ms;
    ks.input_opens_at_ms = matchTimeMs;
    ks.input_closes_at_ms = matchTimeMs + window;
    ks.phase = Phase.TURN_INPUT_OPEN;

    // Broadcast TURN_START.
    var turnStart = {
      turn_index:                ks.turn_index,
      round_index:               ks.round_index,
      input_window_ms:           window,
      input_opens_at_match_ms:   ks.input_opens_at_ms,
      input_closes_at_match_ms:  ks.input_closes_at_ms,
      turn_payload:              gen.turn_payload,
      is_final_turn:             ks.is_final_turn
    };
    broadcastTemplate(ks, dispatcher, matchId, Op.TURN_START, turnStart);
    broadcastTemplate(ks, dispatcher, matchId, Op.TURN_INPUT_OPENED, { turn_index: ks.turn_index });
  }

  function closeInputAndResolve(
    ks: IState,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    _logger: nkruntime.Logger
  ): void {
    var matchTimeMs = Date.now() - ks.match_started_unix_ms;
    var allSubmitted = allActiveSubmitted(ks);
    ks.input_closes_at_ms = matchTimeMs;
    broadcastTemplate(ks, dispatcher, matchId, Op.TURN_INPUT_CLOSED, {
      turn_index: ks.turn_index,
      all_submitted: allSubmitted
    });

    var verdicts: { [u: string]: number } = {};
    var responseMs: { [u: string]: number } = {};
    var scoreDelta: { [u: string]: number } = {};

    for (var u in ks.stats) {
      if (!ks.stats.hasOwnProperty(u)) continue;
      var st = ks.stats[u];
      if (ks.forfeited[u]) {
        verdicts[u] = -1;
        responseMs[u] = 0;
        st.no_submit_count++;
        var penalty = ks.current_no_submit_penalty;
        st.score += penalty;
        if (penalty !== 0) scoreDelta[u] = penalty;
        continue;
      }
      var sub = ks.submissions[u];
      if (!sub) {
        verdicts[u] = -1;
        responseMs[u] = 0;
        st.no_submit_count++;
        var p2 = ks.current_no_submit_penalty;
        st.score += p2;
        if (p2 !== 0) scoreDelta[u] = p2;
        continue;
      }
      var delta = ks.generator
        ? ks.generator.scoreSubmission(sub.payload, ks.current_correct_payload, sub.response_ms, ks.current_base_reward)
        : 0;
      st.score += delta;
      responseMs[u] = sub.response_ms;
      // Generators decide correctness via delta sign by convention; positive
      // = correct, zero/negative = wrong. Generators may override by
      // emitting their own verdicts inside buildResolvedPayload.
      if (delta > 0) {
        verdicts[u] = 1;
        st.correct_count++;
      } else {
        verdicts[u] = 0;
        st.wrong_count++;
        st.score += ks.current_wrong_penalty;
        delta += ks.current_wrong_penalty;
      }
      if (delta !== 0) scoreDelta[u] = delta;
    }

    var resolvedPayload = ks.generator
      ? ks.generator.buildResolvedPayload(ks.current_correct_payload, verdicts, responseMs)
      : { result_payload: ks.current_correct_payload };

    broadcastTemplate(ks, dispatcher, matchId, Op.TURN_RESOLVED, {
      turn_index: ks.turn_index,
      result_payload: resolvedPayload,
      score_delta: scoreDelta
    });

    var totals: { [u: string]: number } = {};
    for (var u2 in ks.stats) {
      if (ks.stats.hasOwnProperty(u2)) totals[u2] = ks.stats[u2].score;
    }
    broadcastTemplate(ks, dispatcher, matchId, Op.SCORE_UPDATE, {
      turn_index: ks.turn_index,
      totals: totals
    });

    ks.phase = Phase.TURN_RESOLVING;
  }

  function endMatch(
    ks: IState,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    matchEndedReasonEnum: number
  ): null {
    if (ks.phase === Phase.POST_GAME) return null;
    ks.phase = Phase.POST_GAME;
    // Build the result-envelope inline so the wire MATCH_ENDED carries
    // the outcome. The match-handler's finalizeMatch persists a fresh
    // copy on the next tick (with kernel-side fields filled in); the
    // template never persists directly.
    var resultEnvelope: any = null;
    if (typeof template.buildResult === "function") {
      var built = template.buildResult(ks, ks.pending_end_reason || "completed");
      if (built) {
        // Stamp the (template-known) match metadata; kernel fills the rest.
        built.match_id = matchId;
        built.template_id = template.templateId;
        if (!built.started_unix_ms) built.started_unix_ms = ks.match_started_unix_ms;
        resultEnvelope = built;
      }
    }
    broadcastTemplate(ks, dispatcher, matchId, MpKernel.KernelOp.MATCH_ENDED, {
      reason: matchEndedReasonEnum,
      result_envelope: resultEnvelope
    });
    return null;
  }

  // Outbound helper. Prefers the kernel-shared seq provider injected at
  // matchInit so server-origin broadcasts (kernel + template) advance a
  // single (match, "server") seq stream. Falls back to a per-match
  // counter for unit-test paths that build state without going through
  // the kernel (e.g. direct invocation of `template.onLoop`).
  // Conformance: Pillar 8 test 06 (seq monotonicity).
  function broadcastTemplate(
    ks: IState,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    op: number,
    payload: any
  ): void {
    var seqProvider = (ks as any).__seqProvider;
    var matchTimeProvider = (ks as any).__matchTimeMs;
    var seq = (typeof seqProvider === "function") ? seqProvider() : ks.outbound_seq++;
    var matchTimeMs = (typeof matchTimeProvider === "function")
      ? matchTimeProvider()
      : (Date.now() - ks.match_started_unix_ms);
    var env = {
      h: {
        wire_version: 1,
        op: op,
        seq: seq,
        match_time_ms: matchTimeMs,
        sender_user_id: "server",
        match_id: matchId,
        client_opcode_uuid: ""
      },
      p: payload
    };
    dispatcher.broadcastMessage(op, JSON.stringify(env));
  }
}
