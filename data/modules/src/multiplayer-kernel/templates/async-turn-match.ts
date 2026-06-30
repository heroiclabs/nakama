// AsyncTurnMatch — async turn template for games where players take
// turns over hours/days (chess, daily-puzzle PvP, words-with-friends).
// Reserved opcode range 0x5000-0x5FFF (templates/async_turn.proto).
//
// Design:
//   * Authoritative game state persists in Nakama storage under the
//     `mp_async_games` collection, keyed by `game_id` (NOT match_id;
//     match_ids are ephemeral session handles).
//   * A match instance exists only while >= 1 player is online. When
//     the last player leaves, the handler persists final state and
//     terminates. The next player to "open" the game spawns a fresh
//     match instance, hydrating from storage.
//   * Notifications fan-out via Nakama notifications API on TURN_END
//     so the next-actor sees the move offline.
//   * Game-specific logic plugs in via IAsyncTurnGenerator.

namespace MpKernelAsyncTurn {
  // Opcodes (mirror templates/async_turn.proto AsyncTurnOp).
  export var Op = {
    TURN_START:        0x5000,  // server -> next_actor: it's your move
    TURN_SUBMIT:       0x5001,  // client -> server   : move payload
    TURN_END:          0x5002,  // server -> all      : authoritative move applied
    NOTIFY_OPPONENT:   0x5003,  // server -> all      : echoed for UI badge
    FORFEIT:           0x5004,  // client -> server   : I quit this game
    RESIGN:            0x5005   // client -> server   : I resign (loss recorded)
  };

  export var DefaultInit = {
    // The persistent game id. SAME id across sessions; not the match_id.
    game_id:               "",
    // Maximum think-time per move; if exceeded, server auto-forfeits.
    move_timeout_ms:       7 * 24 * 60 * 60 * 1000, // 7 days
    // 0 = no cap (typical for async); non-zero = total game wall-clock cap.
    max_match_duration_ms: 0,
    // Game plugin generator (registered via registerGenerator).
    generator_id:          "",
    // Initial actor user_id. If empty, generator's nextActor() drives.
    starting_actor:        "",
    // game_id ALSO used in MatchResultEnvelope.game_id.
    game_label:            "async-turn"
  };

  export interface IAsyncTurnGenerator {
    generatorId: string;
    initState(initParams: any, persisted: any | null): {
      state: any;       // game-specific state (e.g. board)
      actor: string;    // user_id whose turn it is, or "" to wait
      ended: boolean;
      winner_user_id?: string;
    };
    // Apply a move. Throws / returns null on illegal move.
    applyMove(state: any, userId: string, payload: any): {
      state: any;
      actor: string;     // next actor, or "" if game ended
      ended: boolean;
      winner_user_id?: string;
      // Wire payload for TURN_END broadcast.
      broadcast_payload: any;
    } | null;
    // Build a MatchResultEnvelope game_payload for analytics + leaderboards.
    buildResult(state: any, actors: string[], winnerUserId: string, ended: boolean): any;
  }

  var generators: { [id: string]: IAsyncTurnGenerator } = {};

  export function registerGenerator(g: IAsyncTurnGenerator): void {
    generators[g.generatorId] = g;
  }

  export interface IState {
    init: any;
    game_id: string;
    actors: string[];           // user_ids that ever participated
    online: { [u: string]: boolean };
    current_actor: string;
    last_move_unix_ms: number;
    state: any;                 // generator-managed
    generator: IAsyncTurnGenerator | null;
    ended: boolean;
    winner_user_id: string;
    started_unix_ms: number;
    pending_end_reason: string;
    outbound_seq: number;
  }

  // Storage collection for persistent async-game state.
  var COLLECTION = "mp_async_games";

  function loadPersisted(nk: nkruntime.Nakama, gameId: string): any | null {
    if (!gameId) return null;
    try {
      var rows = nk.storageRead([{ collection: COLLECTION, key: gameId, userId: "00000000-0000-0000-0000-000000000000" }]);
      if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (_e) { /* swallow */ }
    return null;
  }

  function persist(nk: nkruntime.Nakama, gameId: string, blob: any): void {
    if (!gameId) return;
    try {
      nk.storageWrite([{
        collection: COLLECTION,
        key: gameId,
        userId: "00000000-0000-0000-0000-000000000000",
        value: blob,
        permissionRead: 2,    // public-read so opponents can rebuild offline
        permissionWrite: 0    // server-only writes
      }]);
    } catch (e: any) {
      // Persistence failures must never crash the match loop; we'll
      // try again on next move.
      // logger only available in onLoop; swallow here.
    }
  }

  function mergeInit(params: any): any {
    var out: any = {};
    for (var k in DefaultInit) if (DefaultInit.hasOwnProperty(k)) out[k] = (DefaultInit as any)[k];
    if (params) for (var k2 in params) if (params.hasOwnProperty(k2)) out[k2] = params[k2];
    return out;
  }

  export var template: MpKernel.IMatchTemplate<IState> = {
    templateId: "async-turn-v1",
    opRange: { from: 0x5000, to: 0x5FFF },
    defaultInit: DefaultInit,

    initState: function (_ctx, _logger, nk, params) {
      var init = mergeInit(params.template_init);
      if (!init.game_id) {
        // Fall back to match-scoped game; not persistent across sessions
        // but lets a one-shot async match still work.
        init.game_id = "";
      }
      var gen = init.generator_id ? generators[init.generator_id] : null;
      var persisted = init.game_id ? loadPersisted(nk, init.game_id) : null;

      var hydrated = gen ? gen.initState(init, persisted ? persisted.gen_state : null) : null;
      var s: IState = {
        init: init,
        game_id: init.game_id,
        actors: persisted && persisted.actors ? persisted.actors.slice() : [],
        online: {},
        current_actor: hydrated ? (hydrated.actor || init.starting_actor || "") : (init.starting_actor || ""),
        last_move_unix_ms: persisted && persisted.last_move_unix_ms ? persisted.last_move_unix_ms : Date.now(),
        state: hydrated ? hydrated.state : (persisted ? persisted.gen_state : null),
        generator: gen,
        ended: hydrated ? !!hydrated.ended : (persisted ? !!persisted.ended : false),
        winner_user_id: hydrated && hydrated.winner_user_id ? hydrated.winner_user_id :
                        (persisted ? (persisted.winner_user_id || "") : ""),
        started_unix_ms: persisted && persisted.started_unix_ms ? persisted.started_unix_ms : Date.now(),
        pending_end_reason: "",
        outbound_seq: 1
      };

      var label = JSON.stringify({
        template_id: "async-turn-v1",
        game_id: params.game_id || init.game_id,
        async_game_id: init.game_id
      });
      // Slow tick — we're driven by player sends and a heartbeat for
      // move-timeout checks, not by per-frame logic. 1 Hz is plenty.
      return { state: s, tickRate: 1, label: label };
    },

    onJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presence, _metadata) {
      var ks = state as IState;
      if (ks.ended) {
        return { state: ks, accept: false, rejectMessage: "game ended" };
      }
      // Async games have no fixed cap — any prior actor + the next-actor
      // can rejoin. We DON'T limit to ks.actors[] because spectators may
      // also want to view (read-only); the generator decides who can move.
      return { state: ks, accept: true };
    },

    onJoin: function (_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
      var ks = state as IState;
      var matchId = ((_ctx as any).matchId) || "";
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        ks.online[p.userId] = true;
        if (ks.actors.indexOf(p.userId) < 0) ks.actors.push(p.userId);
        // If it's their turn, immediately send TURN_START so client
        // can render move UI without waiting for next loop tick.
        if (!ks.ended && ks.current_actor === p.userId) {
          broadcastTemplate(ks, dispatcher, matchId, Op.TURN_START, {
            actor: p.userId,
            state: ks.state
          });
        }
      }
      return { state: ks };
    },

    onLeave: function (_ctx, _logger, nk, _dispatcher, _tick, state, presences) {
      var ks = state as IState;
      for (var i = 0; i < presences.length; i++) {
        ks.online[presences[i].userId] = false;
      }
      // Persist whenever someone leaves so we can rehydrate.
      if (ks.game_id) persist(nk, ks.game_id, {
        actors: ks.actors,
        gen_state: ks.state,
        last_move_unix_ms: ks.last_move_unix_ms,
        started_unix_ms: ks.started_unix_ms,
        ended: ks.ended,
        winner_user_id: ks.winner_user_id
      });
      return { state: ks };
    },

    onLoop: function (ctx, logger, nk, dispatcher, _tick, state, messages) {
      var ks = state as IState;
      var matchId = (ctx as any).matchId || "";
      var nowUnixMs = Date.now();

      // 0. Apply inbound messages.
      for (var i = 0; i < messages.length; i++) {
        applyInbound(ks, messages[i], dispatcher, matchId, nk, logger);
      }

      // 1. Move-timeout — auto-forfeit slow actors.
      if (!ks.ended && ks.current_actor && ks.init.move_timeout_ms > 0) {
        var elapsed = nowUnixMs - ks.last_move_unix_ms;
        if (elapsed > ks.init.move_timeout_ms) {
          var forfeiter = ks.current_actor;
          ks.ended = true;
          ks.pending_end_reason = "move_timeout";
          // Other actor wins by default if 2-player.
          if (ks.actors.length === 2) {
            ks.winner_user_id = ks.actors[0] === forfeiter ? ks.actors[1] : ks.actors[0];
          }
          broadcastTemplate(ks, dispatcher, matchId, Op.FORFEIT, {
            user_id: forfeiter,
            reason: "move_timeout"
          });
          if (ks.game_id) persist(nk, ks.game_id, {
            actors: ks.actors,
            gen_state: ks.state,
            last_move_unix_ms: ks.last_move_unix_ms,
            started_unix_ms: ks.started_unix_ms,
            ended: true,
            winner_user_id: ks.winner_user_id
          });
        }
      }

      // 2. Total-duration cap (rare for async).
      if (ks.init.max_match_duration_ms > 0 &&
          nowUnixMs > ks.started_unix_ms + ks.init.max_match_duration_ms &&
          !ks.ended) {
        ks.ended = true;
        ks.pending_end_reason = "duration_exceeded";
      }

      // 3. End match if everyone left AND game is done.
      if (ks.ended && countOnline(ks) === 0) {
        return endMatch(ks, dispatcher, matchId,
          ks.pending_end_reason === "duration_exceeded"
            ? MpKernel.EndReason.DURATION_EXCEEDED
            : MpKernel.EndReason.COMPLETED);
      }

      return { state: ks };
    },

    onTerminate: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _grace) {
      return { state: state };
    },

    buildResult: function (state, _reason) {
      var ks = state as IState;
      var outcomes: MpKernel.IPlayerOutcome[] = [];
      for (var i = 0; i < ks.actors.length; i++) {
        var u = ks.actors[i];
        var won = ks.winner_user_id && ks.winner_user_id === u;
        outcomes.push({
          user_id: u,
          is_agent: u.indexOf("agt_") === 0,
          placement: won ? 1 : (ks.winner_user_id ? 2 : 0),
          score: won ? 1 : 0,
          completed: ks.ended,
          left_early: !ks.ended,
          game_payload: {}
        });
      }
      var gp = ks.generator
        ? ks.generator.buildResult(ks.state, ks.actors, ks.winner_user_id, ks.ended)
        : {};
      return {
        match_id: "",
        template_id: template.templateId,
        game_id: "",
        started_unix_ms: ks.started_unix_ms,
        ended_unix_ms: 0,
        duration_ms: 0,
        outcomes: outcomes,
        game_payload: gp
      };
    }
  };

  function applyInbound(
    ks: IState,
    m: nkruntime.MatchMessage,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger
  ): void {
    var raw = (typeof m.data === "string") ? m.data : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
    if (!raw) return;
    var parsed: any;
    try { parsed = JSON.parse(raw); } catch (_e) { return; }
    var p = parsed.p || {};
    var sender = m.sender.userId;

    if (m.opCode === Op.TURN_SUBMIT) {
      if (ks.ended) return;
      if (ks.current_actor !== sender) {
        logger.warn("[AsyncTurn] reject — not %s's turn (current=%s)", sender, ks.current_actor);
        return;
      }
      if (!ks.generator) {
        logger.warn("[AsyncTurn] no generator — cannot apply move");
        return;
      }
      var result;
      try {
        result = ks.generator.applyMove(ks.state, sender, p);
      } catch (e: any) {
        logger.warn("[AsyncTurn] applyMove threw: %s", e && e.message ? e.message : String(e));
        return;
      }
      if (!result) {
        logger.warn("[AsyncTurn] illegal move from %s", sender);
        return;
      }
      ks.state = result.state;
      ks.current_actor = result.actor || "";
      ks.last_move_unix_ms = Date.now();
      ks.ended = !!result.ended;
      ks.winner_user_id = result.winner_user_id || ks.winner_user_id;

      broadcastTemplate(ks, dispatcher, matchId, Op.TURN_END, {
        actor_user_id: sender,
        next_actor: ks.current_actor,
        state: ks.state,
        move: result.broadcast_payload || p,
        ended: ks.ended,
        winner_user_id: ks.winner_user_id
      });

      // Persist after each move so reconnection is reliable.
      if (ks.game_id) persist(nk, ks.game_id, {
        actors: ks.actors,
        gen_state: ks.state,
        last_move_unix_ms: ks.last_move_unix_ms,
        started_unix_ms: ks.started_unix_ms,
        ended: ks.ended,
        winner_user_id: ks.winner_user_id
      });

      // Notify next actor offline if they aren't online here.
      if (!ks.ended && ks.current_actor && !ks.online[ks.current_actor]) {
        try {
          nk.notificationSend(ks.current_actor,
            "Your move",
            { game_id: ks.game_id, last_move_by: sender, async_match_id: matchId },
            1001,           // app-defined notification code
            "",
            true);
        } catch (_e) { /* swallow */ }
      }

      // Echo the wake-up to all clients in case the next actor is here.
      if (!ks.ended && ks.current_actor) {
        broadcastTemplate(ks, dispatcher, matchId, Op.NOTIFY_OPPONENT, {
          actor_user_id: ks.current_actor
        });
        broadcastTemplate(ks, dispatcher, matchId, Op.TURN_START, {
          actor: ks.current_actor,
          state: ks.state
        });
      }
    } else if (m.opCode === Op.RESIGN) {
      if (ks.ended) return;
      ks.ended = true;
      ks.winner_user_id = ks.actors.length === 2
        ? (ks.actors[0] === sender ? ks.actors[1] : ks.actors[0])
        : "";
      ks.pending_end_reason = "resign";
      broadcastTemplate(ks, dispatcher, matchId, Op.RESIGN, {
        user_id: sender,
        winner_user_id: ks.winner_user_id
      });
      if (ks.game_id) persist(nk, ks.game_id, {
        actors: ks.actors, gen_state: ks.state,
        last_move_unix_ms: ks.last_move_unix_ms,
        started_unix_ms: ks.started_unix_ms,
        ended: true, winner_user_id: ks.winner_user_id
      });
    } else if (m.opCode === Op.FORFEIT) {
      if (ks.ended) return;
      ks.ended = true;
      ks.pending_end_reason = "forfeit";
      broadcastTemplate(ks, dispatcher, matchId, Op.FORFEIT, {
        user_id: sender, reason: "voluntary"
      });
    }
  }

  function countOnline(ks: IState): number {
    var n = 0;
    for (var u in ks.online) if (ks.online[u]) n++;
    return n;
  }

  function endMatch(ks: IState, dispatcher: nkruntime.MatchDispatcher, matchId: string, reasonEnum: number): null {
    var resultEnvelope: MpKernel.IMatchResultEnvelope | null = null;
    if (template.buildResult) {
      var built = template.buildResult(ks, ks.pending_end_reason || "completed");
      if (built) {
        built.match_id = matchId;
        built.template_id = template.templateId;
        if (!built.started_unix_ms) built.started_unix_ms = ks.started_unix_ms;
        resultEnvelope = built;
      }
    }
    broadcastTemplate(ks, dispatcher, matchId, MpKernel.KernelOp.MATCH_ENDED, {
      reason: reasonEnum,
      result_envelope: resultEnvelope
    });
    return null;
  }

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
      : (Date.now() - ks.started_unix_ms);
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
