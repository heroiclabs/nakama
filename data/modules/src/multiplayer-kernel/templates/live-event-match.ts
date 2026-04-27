// LiveEventRoom — long-running event room template.
//
// Reserved opcode range 0x9000-0x9FFF.
//
// Use cases: virtual concerts, premieres, raid lobbies, scheduled live
// shows where many players gather, the server runs a phase machine
// (PRE_SHOW -> SHOW -> POST_SHOW), and players mostly receive broadcasts
// (phase changes, drops, leaderboard ticks) with limited inbound (cheers,
// reaction emoji, chat).
//
// Differences from sync-turn / async-turn:
//   * High join/leave churn — bursty: hundreds/thousands of presences
//     joining at show start, leaving at show end. We don't quorum-end.
//   * No "winning" — the result envelope is mostly attendance metrics +
//     per-player participation summary.
//   * Cuts (phase transitions) are externally scheduled (phase_schedule
//     in init OR signal-driven from an admin RPC).
//   * Reactions / chat are rate-limited per-player to avoid the 1k-room
//     -> 1k-fanout amplification problem.
//
// Capacity: capped per-room. If demand exceeds room size, the orchestrator
// (live ops) spawns sharded rooms with the same event_id; clients subscribe
// to whichever room they're routed to.

namespace MpKernelLiveEvent {
  export var Op = {
    PHASE_CHANGED:     0x9000, // server -> all
    REACTION:          0x9001, // client -> server -> all (rate-limited)
    DROP_AWARDED:      0x9002, // server -> targeted (or all)
    EVENT_PROGRESS:    0x9003, // server -> all (e.g. crowd-meter)
    PARTICIPATION_LOG: 0x9004, // server -> targeted; per-player participation receipt
    EVENT_CHAT:        0x9005, // client -> server -> all (rate-limited, optional)
    EVENT_SIGNAL:      0x9006, // admin/host -> server (phase advance, drop trigger)
    QUEUED:            0x9007, // server -> all (waiting room status)
    TIME_TO_START:     0x9008  // server -> all (countdown)
  };

  export interface IPhaseDef {
    name: string;
    duration_ms: number;
    auto_advance: boolean; // false = wait for EVENT_SIGNAL{advance:true}
  }

  export var DefaultInit = {
    event_id:          "",
    shard_index:       0,
    max_attendees:     1024,
    min_attendees_to_start: 1,
    // Pre-show waiting room window before phase 0 starts.
    waiting_room_ms:   60_000,
    phase_schedule:    [
      { name: "PRE_SHOW",  duration_ms: 5 * 60 * 1000,  auto_advance: true  },
      { name: "SHOW",      duration_ms: 30 * 60 * 1000, auto_advance: true  },
      { name: "POST_SHOW", duration_ms: 5 * 60 * 1000,  auto_advance: true  }
    ] as IPhaseDef[],
    // Per-player rate-limits (per-second).
    reactions_per_second: 4,
    chat_per_second:      1,
    // Allow chat at all? Some events are reaction-only.
    chat_enabled:         false,
    // Drops fire at scheduled intervals during the SHOW phase.
    drop_interval_ms:     0,    // 0 = no scheduled drops
    drop_payload:         {} as any,
    drop_target_strategy: "all", // "all" | "random_n"
    drop_target_n:        0,
    // Hard wall-clock cap.
    max_match_duration_ms: 4 * 60 * 60 * 1000,
    // Allow the host (creator_user_id) to drive phases via EVENT_SIGNAL.
    host_can_advance:     true,
    // Crowd-meter sample rate.
    crowd_meter_interval_ms: 5_000,
    // Should events persist a per-attendee participation row in storage?
    persist_attendance:   true
  };

  enum Phase {
    WAITING_ROOM = -1,
    LIVE_PHASE_0 = 0,
    DONE         = 99
  }

  export interface IAttendee {
    user_id: string;
    is_agent: boolean;
    joined_unix_ms: number;
    left_unix_ms: number;
    reactions: number;
    chat_count: number;
    drops_received: number;
    participation_score: number;
    // 1s reaction bucket counters.
    reaction_bucket_unix_s: number;
    reaction_bucket_count: number;
    chat_bucket_unix_s: number;
    chat_bucket_count: number;
  }

  export interface IState {
    init: any;
    phase_index: Phase;
    phase_started_unix_ms: number;
    waiting_room_until_unix_ms: number;
    started_unix_ms: number;
    attendees: { [u: string]: IAttendee };
    creator_user_id: string;
    next_drop_at_unix_ms: number;
    next_crowd_meter_at_unix_ms: number;
    pending_end_reason: string;
    outbound_seq: number;
    peak_attendance: number;
    reaction_total: number;
    chat_total: number;
    drops_total: number;
  }

  function mergeInit(params: any): any {
    var out: any = {};
    for (var k in DefaultInit) if (DefaultInit.hasOwnProperty(k)) out[k] = (DefaultInit as any)[k];
    if (params) for (var k2 in params) if (params.hasOwnProperty(k2)) out[k2] = params[k2];
    return out;
  }

  export var template: MpKernel.IMatchTemplate<IState> = {
    templateId: "live-event-v1",
    opRange: { from: 0x9000, to: 0x9FFF },
    defaultInit: DefaultInit,

    initState: function (_ctx, _logger, _nk, params) {
      var init = mergeInit(params.template_init);
      var nowMs = Date.now();
      var s: IState = {
        init: init,
        phase_index: Phase.WAITING_ROOM,
        phase_started_unix_ms: nowMs,
        waiting_room_until_unix_ms: nowMs + init.waiting_room_ms,
        started_unix_ms: nowMs,
        attendees: {},
        creator_user_id: params.creator_user_id || "",
        next_drop_at_unix_ms: 0,
        next_crowd_meter_at_unix_ms: nowMs + init.crowd_meter_interval_ms,
        pending_end_reason: "",
        outbound_seq: 1,
        peak_attendance: 0,
        reaction_total: 0,
        chat_total: 0,
        drops_total: 0
      };
      var label = JSON.stringify({
        template_id: template.templateId,
        game_id: params.game_id,
        event_id: init.event_id,
        shard_index: init.shard_index,
        max_attendees: init.max_attendees
      });
      // 2 Hz — enough for phase transitions, reaction fan-out, crowd-meter
      // ticks. Won't bottleneck on the JS runtime even at 1k attendees.
      return { state: s, tickRate: 2, label: label };
    },

    onJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _presence, _metadata) {
      var ks = state as IState;
      if (ks.phase_index === Phase.DONE) {
        return { state: ks, accept: false, rejectMessage: "event ended" };
      }
      var n = 0; for (var u in ks.attendees) n++;
      if (n >= ks.init.max_attendees) {
        return { state: ks, accept: false, rejectMessage: "event full" };
      }
      return { state: ks, accept: true };
    },

    onJoin: function (_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
      var ks = state as IState;
      var matchId = ""; // set in onLoop; broadcasts here are replayed there
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (!ks.attendees[p.userId]) {
          ks.attendees[p.userId] = {
            user_id: p.userId,
            is_agent: p.userId.indexOf("agt_") === 0,
            joined_unix_ms: Date.now(),
            left_unix_ms: 0,
            reactions: 0,
            chat_count: 0,
            drops_received: 0,
            participation_score: 0,
            reaction_bucket_unix_s: 0,
            reaction_bucket_count: 0,
            chat_bucket_unix_s: 0,
            chat_bucket_count: 0
          };
        }
      }
      var nLive = 0; for (var u2 in ks.attendees) if (ks.attendees[u2].left_unix_ms === 0) nLive++;
      if (nLive > ks.peak_attendance) ks.peak_attendance = nLive;
      // Best-effort late-joiner sync — send current phase snapshot.
      // matchId is populated lazily; this broadcast is harmless even with
      // an empty match_id since clients filter by op.
      broadcastTemplate(ks, dispatcher, matchId, Op.QUEUED, {
        phase_index: ks.phase_index,
        phase_started_unix_ms: ks.phase_started_unix_ms,
        attendees: nLive,
        max_attendees: ks.init.max_attendees
      });
      return { state: ks };
    },

    onLeave: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presences) {
      var ks = state as IState;
      for (var i = 0; i < presences.length; i++) {
        var u = presences[i].userId;
        if (ks.attendees[u]) {
          ks.attendees[u].left_unix_ms = Date.now();
          // Don't delete — we keep participation rows for the result
          // envelope. Storage GC happens via retention policy on
          // mp_match_results.
        }
      }
      return { state: ks };
    },

    onLoop: function (ctx, _logger, nk, dispatcher, _tick, state, messages) {
      var ks = state as IState;
      var matchId = (ctx as any).matchId || "";
      var nowUnixMs = Date.now();

      // 0. Hard wall-clock cap.
      if (nowUnixMs > ks.started_unix_ms + ks.init.max_match_duration_ms) {
        ks.pending_end_reason = "duration_exceeded";
        ks.phase_index = Phase.DONE;
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.DURATION_EXCEEDED, nk);
      }

      // 1. Drain inbound. Reaction / chat rate-limited, EVENT_SIGNAL host-gated.
      for (var i = 0; i < messages.length; i++) {
        applyInbound(ks, messages[i], dispatcher, matchId, nowUnixMs);
      }

      // 2. Phase machine.
      if (ks.phase_index === Phase.WAITING_ROOM) {
        if (nowUnixMs >= ks.waiting_room_until_unix_ms) {
          var live = 0; for (var u in ks.attendees) if (ks.attendees[u].left_unix_ms === 0) live++;
          if (live < ks.init.min_attendees_to_start) {
            // Don't cancel — re-arm waiting room a bit longer if any
            // attendees, otherwise end.
            if (live === 0) {
              ks.pending_end_reason = "no_attendees";
              ks.phase_index = Phase.DONE;
              return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.QUORUM_LOST, nk);
            } else {
              ks.waiting_room_until_unix_ms = nowUnixMs + 30_000;
            }
          } else {
            advancePhase(ks, dispatcher, matchId, 0, nowUnixMs);
          }
        }
      } else if (ks.phase_index >= 0 && ks.phase_index < ks.init.phase_schedule.length) {
        var phaseDef: IPhaseDef = ks.init.phase_schedule[ks.phase_index];
        if (phaseDef.auto_advance && nowUnixMs >= ks.phase_started_unix_ms + phaseDef.duration_ms) {
          var next = (ks.phase_index as number) + 1;
          if (next >= ks.init.phase_schedule.length) {
            ks.phase_index = Phase.DONE;
            ks.pending_end_reason = "completed";
            return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.COMPLETED, nk);
          } else {
            advancePhase(ks, dispatcher, matchId, next, nowUnixMs);
          }
        }
      }

      // 3. Drops (only during SHOW = phase_index 1 by convention; we honor
      //    drop_interval_ms regardless of phase if > 0).
      if (ks.init.drop_interval_ms > 0 && ks.phase_index >= 0) {
        if (ks.next_drop_at_unix_ms === 0) {
          ks.next_drop_at_unix_ms = nowUnixMs + ks.init.drop_interval_ms;
        } else if (nowUnixMs >= ks.next_drop_at_unix_ms) {
          fireDrop(ks, dispatcher, matchId, nowUnixMs);
          ks.next_drop_at_unix_ms = nowUnixMs + ks.init.drop_interval_ms;
        }
      }

      // 4. Crowd-meter ticks.
      if (nowUnixMs >= ks.next_crowd_meter_at_unix_ms) {
        var alive = 0; for (var u3 in ks.attendees) if (ks.attendees[u3].left_unix_ms === 0) alive++;
        broadcastTemplate(ks, dispatcher, matchId, Op.EVENT_PROGRESS, {
          phase_index: ks.phase_index,
          attendees_live: alive,
          peak_attendance: ks.peak_attendance,
          reaction_total: ks.reaction_total,
          chat_total: ks.chat_total,
          drops_total: ks.drops_total,
          server_unix_ms: nowUnixMs
        });
        ks.next_crowd_meter_at_unix_ms = nowUnixMs + ks.init.crowd_meter_interval_ms;
      }

      // Final post-loop end-state resolution. Three paths can land here:
      //   * Host signaled `end` -> phase=DONE, reason="host_ended"   -> COMPLETED
      //   * Host advanced past end -> phase=DONE, reason="host_advanced_past_end" -> COMPLETED
      //   * Inbound dropped us into pending_end_reason without DONE  -> KERNEL_INTERNAL
      // Without this dual check the match silently continues running with
      // phase=DONE forever (Goja keeps invoking onLoop), bleeding resources.
      if (ks.phase_index === Phase.DONE && ks.pending_end_reason !== "") {
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.COMPLETED, nk);
      }
      if (ks.pending_end_reason !== "" && ks.phase_index !== Phase.DONE) {
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.KERNEL_INTERNAL, nk);
      }
      return { state: ks };
    },

    onTerminate: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _grace) {
      return { state: state };
    },

    buildResult: function (state, reason) {
      var ks = state as IState;
      var outcomes: MpKernel.IPlayerOutcome[] = [];
      for (var u in ks.attendees) {
        var a = ks.attendees[u];
        outcomes.push({
          user_id: u,
          is_agent: a.is_agent,
          placement: 0,
          score: a.participation_score,
          completed: a.left_unix_ms === 0,
          left_early: a.left_unix_ms !== 0 && ks.phase_index !== Phase.DONE,
          game_payload: {
            joined_unix_ms:  a.joined_unix_ms,
            left_unix_ms:    a.left_unix_ms,
            reactions:       a.reactions,
            chat_count:      a.chat_count,
            drops_received:  a.drops_received
          }
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
          event_id:         ks.init.event_id,
          shard_index:      ks.init.shard_index,
          peak_attendance:  ks.peak_attendance,
          reaction_total:   ks.reaction_total,
          chat_total:       ks.chat_total,
          drops_total:      ks.drops_total,
          end_reason:       reason
        }
      };
    }
  };

  // ---- helpers ----

  function applyInbound(
    ks: IState,
    m: nkruntime.MatchMessage,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    nowUnixMs: number
  ): void {
    var raw = (typeof m.data === "string") ? m.data : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
    if (!raw) return;
    var parsed: any;
    try { parsed = JSON.parse(raw); } catch (_e) { return; }
    var p = parsed.p || {};
    var sender = m.sender.userId;
    var att = ks.attendees[sender];
    if (!att) return;

    if (m.opCode === Op.REACTION) {
      var nowS = Math.floor(nowUnixMs / 1000);
      if (att.reaction_bucket_unix_s !== nowS) {
        att.reaction_bucket_unix_s = nowS;
        att.reaction_bucket_count = 0;
      }
      if (att.reaction_bucket_count >= ks.init.reactions_per_second) {
        // Drop silently — at 1k attendees we don't want to amplify a
        // per-violation error into 1k outbound msgs.
        return;
      }
      att.reaction_bucket_count++;
      att.reactions++;
      att.participation_score++;
      ks.reaction_total++;
      // Fan out a sampled subset only — clients render aggregate reaction
      // visualisations (heart bursts), so we don't need every reaction
      // to reach every client. Sample 1-in-N at high attendance.
      var alive = 0; for (var u in ks.attendees) if (ks.attendees[u].left_unix_ms === 0) alive++;
      var sampleEvery = Math.max(1, Math.floor(alive / 50)); // ~50 reactions/sec/room max fanout
      if ((att.reactions % sampleEvery) === 0) {
        broadcastTemplate(ks, dispatcher, matchId, Op.REACTION, {
          user_id: sender,
          emote: p.emote || "heart",
          intensity: p.intensity || 1,
          server_unix_ms: nowUnixMs
        });
      }
    } else if (m.opCode === Op.EVENT_CHAT) {
      if (!ks.init.chat_enabled) return;
      var nowS2 = Math.floor(nowUnixMs / 1000);
      if (att.chat_bucket_unix_s !== nowS2) {
        att.chat_bucket_unix_s = nowS2;
        att.chat_bucket_count = 0;
      }
      if (att.chat_bucket_count >= ks.init.chat_per_second) return;
      att.chat_bucket_count++;
      att.chat_count++;
      ks.chat_total++;
      // Truncate text length — chat payload sanity.
      var text = (typeof p.text === "string") ? p.text.substring(0, 200) : "";
      broadcastTemplate(ks, dispatcher, matchId, Op.EVENT_CHAT, {
        user_id: sender,
        text: text,
        server_unix_ms: nowUnixMs
      });
    } else if (m.opCode === Op.EVENT_SIGNAL) {
      // Host-only signal channel. `host_can_advance=false` disables it
      // even for the creator (used for fully-scheduled events where ops
      // wants to lock out manual phase advances).
      if (!ks.init.host_can_advance) return;
      if (sender !== ks.creator_user_id) return;
      if (p && p.advance) {
        var next = (ks.phase_index === Phase.WAITING_ROOM) ? 0 : (ks.phase_index as number) + 1;
        if (next >= ks.init.phase_schedule.length) {
          ks.phase_index = Phase.DONE;
          ks.pending_end_reason = "host_advanced_past_end";
          return;
        }
        advancePhase(ks, dispatcher, matchId, next, nowUnixMs);
      } else if (p && p.fire_drop) {
        fireDrop(ks, dispatcher, matchId, nowUnixMs);
      } else if (p && p.end) {
        ks.pending_end_reason = "host_ended";
        ks.phase_index = Phase.DONE;
      }
    }
  }

  function advancePhase(ks: IState, dispatcher: nkruntime.MatchDispatcher, matchId: string, next: number, nowUnixMs: number): void {
    ks.phase_index = next as Phase;
    ks.phase_started_unix_ms = nowUnixMs;
    var def = ks.init.phase_schedule[next];
    broadcastTemplate(ks, dispatcher, matchId, Op.PHASE_CHANGED, {
      phase_index: next,
      phase_name: def ? def.name : ("phase_" + next),
      duration_ms: def ? def.duration_ms : 0,
      auto_advance: def ? def.auto_advance : false,
      server_unix_ms: nowUnixMs
    });
  }

  function fireDrop(ks: IState, dispatcher: nkruntime.MatchDispatcher, matchId: string, nowUnixMs: number): void {
    var alive: string[] = [];
    for (var u in ks.attendees) if (ks.attendees[u].left_unix_ms === 0) alive.push(u);
    if (alive.length === 0) return;
    if (ks.init.drop_target_strategy === "random_n" && ks.init.drop_target_n > 0) {
      var n = Math.min(ks.init.drop_target_n, alive.length);
      // Fisher-Yates partial shuffle for first n picks.
      for (var i = 0; i < n; i++) {
        var j = i + Math.floor(Math.random() * (alive.length - i));
        var tmp = alive[i]; alive[i] = alive[j]; alive[j] = tmp;
      }
      var picks = alive.slice(0, n);
      for (var k = 0; k < picks.length; k++) {
        var att = ks.attendees[picks[k]];
        if (att) { att.drops_received++; att.participation_score += 5; }
      }
      ks.drops_total += picks.length;
      broadcastTemplate(ks, dispatcher, matchId, Op.DROP_AWARDED, {
        recipients: picks,
        payload: ks.init.drop_payload,
        server_unix_ms: nowUnixMs
      });
    } else {
      // "all"
      for (var k2 = 0; k2 < alive.length; k2++) {
        var a2 = ks.attendees[alive[k2]];
        if (a2) { a2.drops_received++; a2.participation_score += 1; }
      }
      ks.drops_total += alive.length;
      broadcastTemplate(ks, dispatcher, matchId, Op.DROP_AWARDED, {
        recipients: alive,
        payload: ks.init.drop_payload,
        server_unix_ms: nowUnixMs
      });
    }
  }

  function endMatch(
    ks: IState,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    reasonEnum: number,
    _nk: nkruntime.Nakama
  ): null {
    var resultEnvelope: MpKernel.IMatchResultEnvelope | null = null;
    if (template.buildResult) {
      var built = template.buildResult(ks, ks.pending_end_reason || "completed");
      if (built) {
        built.match_id = matchId;
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
