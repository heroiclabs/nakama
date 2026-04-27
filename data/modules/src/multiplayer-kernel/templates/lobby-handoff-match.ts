// LobbyHandoffMatch — pre-game lobby template that gathers players,
// runs ready-up + character/loadout select, then hands them off to
// the actual game match (Sync, Async, RealtimeTick) or a third-party
// transport (P2P WebRTC, Photon Voice room) and self-terminates.
//
// Reserved opcode range 0x7000-0x7FFF (templates/lobby_handoff.proto).
//
// Lifecycle:
//   FORM_UP   : players join, set ready, pick loadouts/characters.
//               Times out -> DISBAND.
//   HANDOFF   : >= min_ready ready, server creates target match, broadcasts
//               LOBBY_HANDOFF_INFO with target_match_id (+ optional WebRTC
//               signaling endpoint), waits grace_ms for clients to migrate.
//   DONE      : terminate.
//   DISBANDED : terminate (broadcasts DISBAND first).

namespace MpKernelLobbyHandoff {
  export var Op = {
    READY:          0x7000,  // client -> server
    FORM_UP_DONE:   0x7001,  // server -> all
    HANDOFF_INFO:   0x7002,  // server -> all
    DISBAND:        0x7003   // server -> all
  };

  export var DefaultInit = {
    // Target template_id to hand off into (e.g. "sync-turn-v1"). REQUIRED.
    target_template_id:    "",
    // Init params for the target match. Forwarded verbatim to mp_create_match.
    target_template_init:  {} as any,
    target_game_id:        "",
    target_region:         "",
    // Min/max players in the lobby itself.
    min_players:           2,
    max_players:           4,
    // Form-up window — disband if not enough ready players within this.
    form_up_timeout_ms:    60000,
    // Grace period after handoff broadcast before lobby self-terminates.
    handoff_grace_ms:      5000,
    // Optional: WebRTC signaling endpoint clients should hit post-handoff.
    webrtc_signaling_url:  "",
    // Whether all joined players must be ready (true) or just min_players (false).
    require_all_ready:     false,
    // Lobby itself max wallclock (cap).
    max_match_duration_ms: 5 * 60 * 1000 // 5 min hard cap
  };

  enum Phase {
    FORM_UP   = 0,
    HANDOFF   = 1,
    DONE      = 2,
    DISBANDED = 3
  }

  export interface IPlayer {
    user_id: string;
    is_agent: boolean;
    ready: boolean;
    ready_at_unix_ms: number;
    loadout: any;
  }

  export interface IState {
    init: any;
    phase: Phase;
    players: { [u: string]: IPlayer };
    started_unix_ms: number;
    form_up_deadline_unix_ms: number;
    handoff_at_unix_ms: number;
    target_match_id: string;
    pending_end_reason: string;
    outbound_seq: number;
  }

  function mergeInit(params: any): any {
    var out: any = {};
    for (var k in DefaultInit) if (DefaultInit.hasOwnProperty(k)) out[k] = (DefaultInit as any)[k];
    if (params) for (var k2 in params) if (params.hasOwnProperty(k2)) out[k2] = params[k2];
    return out;
  }

  export var template: MpKernel.IMatchTemplate<IState> = {
    templateId: "lobby-handoff-v1",
    opRange: { from: 0x7000, to: 0x7FFF },
    defaultInit: DefaultInit,

    initState: function (_ctx, _logger, _nk, params) {
      var init = mergeInit(params.template_init);
      if (!init.target_template_id) {
        // Don't fail hard; the lobby still runs but DISBAND on form-up.
        // Game plugins should validate before calling mp_create_match.
      }
      var s: IState = {
        init: init,
        phase: Phase.FORM_UP,
        players: {},
        started_unix_ms: Date.now(),
        form_up_deadline_unix_ms: Date.now() + init.form_up_timeout_ms,
        handoff_at_unix_ms: 0,
        target_match_id: "",
        pending_end_reason: "",
        outbound_seq: 1
      };
      var label = JSON.stringify({
        template_id: "lobby-handoff-v1",
        game_id: params.game_id,
        target_template_id: init.target_template_id,
        max_players: init.max_players,
        min_players: init.min_players
      });
      // 4 Hz — same cadence as sync-turn for consistent timer accuracy.
      return { state: s, tickRate: 4, label: label };
    },

    onJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _presence, _metadata) {
      var ks = state as IState;
      if (ks.phase !== Phase.FORM_UP) {
        return { state: ks, accept: false, rejectMessage: "lobby closed" };
      }
      if (Object.keys(ks.players).length >= ks.init.max_players) {
        return { state: ks, accept: false, rejectMessage: "lobby full" };
      }
      return { state: ks, accept: true };
    },

    onJoin: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presences) {
      var ks = state as IState;
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (!ks.players[p.userId]) {
          ks.players[p.userId] = {
            user_id: p.userId,
            is_agent: p.userId.indexOf("agt_") === 0,
            ready: false,
            ready_at_unix_ms: 0,
            loadout: null
          };
        }
      }
      return { state: ks };
    },

    onLeave: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presences) {
      var ks = state as IState;
      // Remove fully — pre-game leaves don't need ghost slots.
      for (var i = 0; i < presences.length; i++) {
        delete ks.players[presences[i].userId];
      }
      return { state: ks };
    },

    onLoop: function (ctx, logger, nk, dispatcher, _tick, state, messages) {
      var ks = state as IState;
      var matchId = (ctx as any).matchId || "";
      var nowUnixMs = Date.now();

      // Cap on lobby itself.
      if (nowUnixMs > ks.started_unix_ms + ks.init.max_match_duration_ms &&
          ks.phase !== Phase.DONE && ks.phase !== Phase.DISBANDED) {
        return disband(ks, dispatcher, matchId, "lobby_duration_exceeded");
      }

      // Process inbound messages.
      for (var i = 0; i < messages.length; i++) {
        applyInbound(ks, messages[i], dispatcher, matchId);
      }

      if (ks.phase === Phase.FORM_UP) {
        var allReady = true;
        var readyCount = 0;
        var totalCount = 0;
        for (var u in ks.players) {
          totalCount++;
          if (ks.players[u].ready) readyCount++;
          else allReady = false;
        }

        var readyEnough = readyCount >= ks.init.min_players &&
          (ks.init.require_all_ready ? (allReady && totalCount >= ks.init.min_players) : true);

        if (readyEnough) {
          // Transition: FORM_UP -> HANDOFF
          broadcastTemplate(ks, dispatcher, matchId, Op.FORM_UP_DONE, {
            ready_user_ids: collectReady(ks)
          });
          var targetId: string;
          try {
            targetId = nk.matchCreate(ks.init.target_template_id || "sync-turn-v1", {
              game_id:          ks.init.target_game_id || "",
              region:           ks.init.target_region || "",
              template_init:    ks.init.target_template_init || {},
              creator_user_id:  pickHost(ks)
            });
          } catch (err: any) {
            logger.warn("[LobbyHandoff] target matchCreate failed template=%s err=%s",
              ks.init.target_template_id, (err && err.message) ? err.message : String(err));
            return disband(ks, dispatcher, matchId, "target_create_failed");
          }
          ks.target_match_id = targetId;
          ks.handoff_at_unix_ms = nowUnixMs;
          ks.phase = Phase.HANDOFF;
          broadcastTemplate(ks, dispatcher, matchId, Op.HANDOFF_INFO, {
            target_match_id:    targetId,
            target_template_id: ks.init.target_template_id,
            target_game_id:     ks.init.target_game_id,
            webrtc_signaling_url: ks.init.webrtc_signaling_url || "",
            handoff_unix_ms:    nowUnixMs
          });
        } else if (nowUnixMs > ks.form_up_deadline_unix_ms) {
          return disband(ks, dispatcher, matchId, "form_up_timeout");
        }
      } else if (ks.phase === Phase.HANDOFF) {
        if (nowUnixMs > ks.handoff_at_unix_ms + ks.init.handoff_grace_ms) {
          // Self-terminate; clients have had grace_ms to migrate.
          ks.phase = Phase.DONE;
          ks.pending_end_reason = "handoff_complete";
          return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.COMPLETED);
        }
      }

      return { state: ks };
    },

    onTerminate: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _grace) {
      return { state: state };
    },

    buildResult: function (state, reason) {
      var ks = state as IState;
      var outcomes: MpKernel.IPlayerOutcome[] = [];
      for (var u in ks.players) {
        var pl = ks.players[u];
        outcomes.push({
          user_id: u,
          is_agent: pl.is_agent,
          placement: 0,
          score: 0,
          completed: pl.ready && ks.phase !== Phase.DISBANDED,
          left_early: !pl.ready && ks.phase === Phase.DISBANDED,
          game_payload: { loadout: pl.loadout }
        });
      }
      return {
        match_id: "",
        template_id: template.templateId,
        game_id: "",
        started_unix_ms: ks.started_unix_ms,
        ended_unix_ms: 0,
        duration_ms: 0,
        outcomes: outcomes,
        game_payload: {
          target_match_id:    ks.target_match_id,
          target_template_id: ks.init.target_template_id,
          end_reason:         reason
        }
      };
    }
  };

  function applyInbound(
    ks: IState,
    m: nkruntime.MatchMessage,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string
  ): void {
    if (ks.phase !== Phase.FORM_UP) return;
    var raw = (typeof m.data === "string") ? m.data : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
    if (!raw) return;
    var parsed: any;
    try { parsed = JSON.parse(raw); } catch (_e) { return; }
    var p = parsed.p || {};
    var sender = m.sender.userId;

    if (m.opCode === Op.READY) {
      var pl = ks.players[sender];
      if (!pl) return;
      pl.ready = !!p.ready;
      pl.ready_at_unix_ms = pl.ready ? Date.now() : 0;
      if (p.loadout !== undefined) pl.loadout = p.loadout;
      // No broadcast — server publishes FORM_UP_DONE / HANDOFF_INFO when
      // readiness threshold tips in onLoop.
    }
  }

  function collectReady(ks: IState): string[] {
    var out: string[] = [];
    for (var u in ks.players) if (ks.players[u].ready) out.push(u);
    return out;
  }

  function pickHost(ks: IState): string {
    // Earliest-ready as a stable host pick. Pure function over state.
    var best = "";
    var bestAt = 0;
    for (var u in ks.players) {
      var pl = ks.players[u];
      if (pl.ready && (best === "" || pl.ready_at_unix_ms < bestAt)) {
        best = u; bestAt = pl.ready_at_unix_ms;
      }
    }
    return best;
  }

  function disband(ks: IState, dispatcher: nkruntime.MatchDispatcher, matchId: string, reason: string): null {
    if (ks.phase !== Phase.DISBANDED) {
      ks.phase = Phase.DISBANDED;
      ks.pending_end_reason = reason;
      broadcastTemplate(ks, dispatcher, matchId, Op.DISBAND, {
        reason: reason
      });
    }
    return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.CANCELLED);
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
