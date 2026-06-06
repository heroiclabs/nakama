// Generic Nakama MatchHandler that wraps an IMatchTemplate.
//
// One TS template = one MatchHandler. Templates focus on game logic and
// outbound fan-out; the kernel handles:
//   - presence accounting (incl. reconnect grace + flapping)
//   - server clock authority + ClockSync emission
//   - opcode idempotency dedup (per-sender ring)
//   - sequence-gap detection (Pillar 8)
//   - kernel control opcodes (HELLO, HEARTBEAT, MATCH_RESUME, LEAVE)
//   - error fan-out via the canonical envelope
//   - end-of-match MatchResultEnvelope persistence

namespace MpKernelMatch {
  // Sequence-gap threshold: gaps larger than this trigger SEQ_GAP +
  // state-resync. Templates that need a tighter / looser bound should
  // override SEQ_GAP_THRESHOLD on this namespace at registration time.
  export var SEQ_GAP_THRESHOLD = 32;

  // State stored in Nakama match memory. Generic over template state TS.
  export interface IKernelState<TS> {
    template_id: string;
    game_id: string;
    region: string;
    presence: MpKernelPresence.IPresenceTable;
    clock: MpKernelClock.IMatchClock;
    feature_flags: number;
    // Aggregate counters used by the SLO board / per-template Grafana.
    counters: {
      messages_in: number;
      messages_in_dropped_dupe: number;
      messages_in_dropped_unknown_op: number;
      messages_in_dropped_seq_gap: number;
      flap_kicks: number;
      reconnects_inside_grace: number;
    };
    template_state: TS;
    template: MpKernel.IMatchTemplate<TS>;
    // Last broadcast state-resync seq, used on SEQ_GAP responses.
    last_resync_seq: number;
  }

  // Wire helper — broadcast a kernel envelope to all/some clients. Stamps
  // wire_version, seq, match_time_ms, match_id, sender_user_id="server".
  export function broadcastKernel<P>(
    state: IKernelState<any>,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    op: number,
    payload: P,
    targets: nkruntime.Presence[] | null,
    senderUserId?: string
  ): void {
    var env: MpKernel.IEnvelope<P> = {
      h: {
        wire_version: 1,
        op: op,
        seq: MpKernelClock.nextSeq(state.clock),
        match_time_ms: MpKernelClock.matchTimeMs(state.clock),
        sender_user_id: senderUserId || "server",
        match_id: matchId,
        client_opcode_uuid: "",
        feature_flags: state.feature_flags
      },
      p: payload
    };
    var bytes = JSON.stringify(env);
    if (targets) {
      dispatcher.broadcastMessage(op, bytes, targets);
    } else {
      dispatcher.broadcastMessage(op, bytes);
    }
  }

  // ------- template resolution (VM-pool safe) -------
  //
  // Match handlers run on POOLED Goja VMs that never execute InitModule, so
  // anything populated only inside InitModule/register() (a template-object
  // registry, generator maps, etc.) is absent when a match actually runs.
  // We therefore resolve the template object directly from its owning
  // namespace by id. `getTemplate` is only ever CALLED at match time — long
  // after every namespace IIFE has evaluated — so the forward references
  // below resolve cleanly on every VM regardless of namespace eval order.
  export function getTemplate(templateId: string): MpKernel.IMatchTemplate<any> | null {
    switch (templateId) {
      case "sync-turn-v1":            return MpKernelSyncTurn.template;
      case "async-turn-v1":           return MpKernelAsyncTurn.template;
      case "lobby-handoff-v1":        return MpKernelLobbyHandoff.template;
      case "tournament-v1":           return MpKernelTournament.template;
      case "live-event-v1":           return MpKernelLiveEvent.template;
      case "persistent-party-v1":     return MpKernelPersistentParty.template;
      case "conversational-party-v1": return MpKernelConvParty.template;
      case "mixed-reality-anchor-v1": return MpKernelMrAnchor.template;
      default:                        return null;
    }
  }

  // ------- match handler lifecycle impls -------
  //
  // These are the real handler bodies. The seven Nakama lifecycle hooks are
  // registered via top-level global wrapper functions (data/modules/
  // zz_mp_kernel_handlers.js) that postbuild.js injects into the InitModule
  // wrapper with a direct `initializer.registerMatch(...)` call — the only
  // shape Nakama's Goja AST walker can extract handler keys from. The
  // wrappers delegate here. matchInit takes the templateId explicitly (the
  // match-name = templateId, hard-coded per-template in its init wrapper);
  // the remaining hooks read the resolved template back off kernel state.

  export function matchInitImpl(
    templateId: string,
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    params: { [key: string]: any }
  ): { state: nkruntime.MatchState; tickRate: number; label: string } {
    var template = getTemplate(templateId);
    if (!template) {
      throw new Error("[MpKernel] unknown template_id at matchInit: " + templateId);
    }

    var args: MpKernel.IMatchInitArgs = {
      template_id: template.templateId,
      game_id: (params && params.game_id) ? String(params.game_id) : "",
      region: (params && params.region) ? String(params.region) : "",
      template_init: (params && params.template_init) ? params.template_init : template.defaultInit,
      creator_user_id: (params && params.creator_user_id) ? String(params.creator_user_id) : "",
      flags: {}
    };
    var inner = template.initState(ctx, logger, nk, args);

    // Determine reconnect grace from template_init or default.
    var graceMs = MpKernelPresence.DEFAULT_GRACE_MS;
    var ti: any = args.template_init;
    if (ti && typeof ti.reconnect_grace_ms === "number" && ti.reconnect_grace_ms > 0) {
      graceMs = ti.reconnect_grace_ms;
    } else if (ti && typeof ti.reconnect_grace_seconds === "number" && ti.reconnect_grace_seconds > 0) {
      graceMs = ti.reconnect_grace_seconds * 1000;
    }

    var kernelState: IKernelState<any> = {
      template_id: template.templateId,
      game_id: args.game_id,
      region: args.region,
      presence: MpKernelPresence.init(graceMs),
      clock: MpKernelClock.init(),
      feature_flags: 0,
      counters: {
        messages_in: 0,
        messages_in_dropped_dupe: 0,
        messages_in_dropped_unknown_op: 0,
        messages_in_dropped_seq_gap: 0,
        flap_kicks: 0,
        reconnects_inside_grace: 0
      },
      template_state: inner.state,
      template: template,
      last_resync_seq: 0
    };

    // Inject a kernel-shared seq provider into the template state so
    // server-origin broadcasts (kernel + template) advance ONE counter.
    // Without this, both would emit `sender_user_id="server"` with
    // independent seqs and clients ordering by (sender, seq) would
    // see two interleaved monotonic streams. Conformance test 06.
    if (typeof inner.state === "object" && inner.state !== null) {
      (inner.state as any).__seqProvider = function () {
        return MpKernelClock.nextSeq(kernelState.clock);
      };
      (inner.state as any).__matchTimeMs = function () {
        return MpKernelClock.matchTimeMs(kernelState.clock);
      };
    }

    return {
      state: kernelState,
      tickRate: inner.tickRate,
      label: inner.label
    };
  }

  export function matchJoinAttemptImpl(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    dispatcher: nkruntime.MatchDispatcher,
    tick: number,
    state: nkruntime.MatchState,
    presence: nkruntime.Presence,
    metadata: { [key: string]: any }
  ): { state: nkruntime.MatchState; accept: boolean; rejectMessage?: string } | null {
    // Hand off to template for game-specific gating.
    var ks = state as IKernelState<any>;
    var inner = ks.template.onJoinAttempt(
      ctx, logger, nk, dispatcher, tick, ks.template_state, presence, metadata
    );
    ks.template_state = inner.state;
    return { state: ks, accept: inner.accept, rejectMessage: inner.rejectMessage };
  }

  export function matchJoinImpl(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    dispatcher: nkruntime.MatchDispatcher,
    tick: number,
    state: nkruntime.MatchState,
    presences: nkruntime.Presence[]
  ): { state: nkruntime.MatchState } | null {
        var ks = state as IKernelState<any>;
        var now = Date.now();
        var matchId = (ctx as any).matchId || "";
        for (var i = 0; i < presences.length; i++) {
          var p = presences[i];
          var rj = MpKernelPresence.recordJoin(ks.presence, p, now);
          if (rj.flapped) {
            ks.counters.flap_kicks++;
            // Soft-ban: emit PlayerKicked + ERROR(FLAPPING), then evict.
            broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.PLAYER_KICKED, {
              user_id: p.userId,
              reason: MpKernel.LeaveReason.FLAPPING,
              ban_seconds: ks.presence.flap_ban_seconds
            } as any, null);
            MpKernelError.send(
              dispatcher, p, matchId, "server",
              MpKernelClock.seqProvider(ks.clock),
              MpKernelClock.matchTimeMs(ks.clock),
              MpKernelError.flapping(ks.presence.flap_ban_seconds)
            );
            // Remove the seat fully — don't carry flapper state forward.
            delete ks.presence.seats[p.userId];
            try { dispatcher.matchKick([p]); } catch (_) {}
            continue;
          }
          if (rj.resumed) {
            ks.counters.reconnects_inside_grace++;
          }

          // Send Welcome to the (re)joining player.
          var welcome = {
            match_id: matchId,
            assigned_user_id: p.userId,
            server_match_time_ms: MpKernelClock.matchTimeMs(ks.clock),
            server_unix_ms: Date.now(),
            feature_flags: ks.feature_flags,
            reconnect_grace_ms_remaining: MpKernelPresence.reconnectGraceRemainingMs(rj.seat, ks.presence, now)
          };
          broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.WELCOME, welcome, [p]);

          // Broadcast PlayerJoined to everyone else (excluding self).
          var others: nkruntime.Presence[] = [];
          for (var k in ks.presence.seats) {
            if (!ks.presence.seats.hasOwnProperty(k)) continue;
            if (k === p.userId) continue;
            var s = ks.presence.seats[k];
            if (s.disconnected_at_unix_ms === 0) {
              // We don't track Presence objects directly; fan-out goes
              // to "all-except-self" via dispatcher.broadcastMessage with
              // null + presenceRecipients excludes. Nakama's API doesn't
              // give us the Presence list back; we use targets=null and
              // an opt-out filter on the wire by sender_user_id check.
            }
          }
          broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.PLAYER_JOINED, {
            user_id: p.userId,
            is_agent: rj.seat.is_agent,
            display_name: rj.seat.display_name || "",
            presence_metadata: rj.seat.presence_metadata
          } as any, null);
        }

        // Defer to template for any game-side wiring.
        var inner = ks.template.onJoin(ctx, logger, nk, dispatcher, tick, ks.template_state, presences);
        ks.template_state = inner.state;
        return { state: ks };
  }

  export function matchLeaveImpl(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    dispatcher: nkruntime.MatchDispatcher,
    tick: number,
    state: nkruntime.MatchState,
    presences: nkruntime.Presence[]
  ): { state: nkruntime.MatchState } | null {
        var ks = state as IKernelState<any>;
        var now = Date.now();
        var matchId = (ctx as any).matchId || "";
        for (var i = 0; i < presences.length; i++) {
          MpKernelPresence.recordLeave(ks.presence, presences[i], now);
        }
        var inner = ks.template.onLeave(ctx, logger, nk, dispatcher, tick, ks.template_state, presences);
        ks.template_state = inner.state;
        return { state: ks };
  }

  export function matchLoopImpl(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    dispatcher: nkruntime.MatchDispatcher,
    tick: number,
    state: nkruntime.MatchState,
    messages: nkruntime.MatchMessage[]
  ): { state: nkruntime.MatchState } | null {
        var ks = state as IKernelState<any>;
        var matchId = (ctx as any).matchId || "";
        var now = Date.now();

        // 1. GC reconnect-grace expirations.
        var evicted = MpKernelPresence.evictExpired(ks.presence, now);
        for (var i = 0; i < evicted.length; i++) {
          var ev = evicted[i];
          broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.PLAYER_LEFT, {
            user_id: ev.user_id,
            reason: MpKernel.LeaveReason.TIMEOUT
          } as any, null);
        }

        // 2. Process incoming messages — kernel intercepts control opcodes
        //    + dedupes, then forwards game opcodes to the template.
        var forwarded: nkruntime.MatchMessage[] = [];
        for (var j = 0; j < messages.length; j++) {
          var m = messages[j];
          ks.counters.messages_in++;
          if (handleKernelOpInbound(ks, dispatcher, matchId, m, logger)) continue;

          // Idempotency dedup happens for game opcodes.
          var senderSeat = ks.presence.seats[m.sender.userId];
          if (senderSeat) {
            // Parse envelope to extract idem uuid + seq, but on parse failure
            // forward as-is (template may use legacy raw format during cutover).
            var hdr = parseHeader(m);
            if (hdr) {
              if (hdr.client_opcode_uuid && !MpKernelIdempotency.admit(senderSeat.idem_ring, hdr.client_opcode_uuid, now)) {
                ks.counters.messages_in_dropped_dupe++;
                continue;
              }
              if (hdr.seq > 0 && hdr.seq < senderSeat.last_seq_in_from_client) {
                // Out-of-order — drop, but don't error (Pillar 8: tolerate).
                continue;
              }
              if (hdr.seq > senderSeat.last_seq_in_from_client + SEQ_GAP_THRESHOLD && senderSeat.last_seq_in_from_client !== 0) {
                ks.counters.messages_in_dropped_seq_gap++;
                MpKernelError.send(
                  dispatcher, m.sender, matchId, "server",
                  MpKernelClock.seqProvider(ks.clock),
                  MpKernelClock.matchTimeMs(ks.clock),
                  MpKernelError.build(MpKernel.ErrorCode.SEQ_GAP, "gap>" + SEQ_GAP_THRESHOLD)
                );
                // Force a state-resync — template.buildResult() (or a
                // dedicated snapshot hook) drives the snapshot payload.
                continue;
              }
              if (hdr.seq > senderSeat.last_seq_in_from_client) {
                senderSeat.last_seq_in_from_client = hdr.seq;
              }
              senderSeat.last_seen_unix_ms = now;
            }
          }
          forwarded.push(m);
        }

        // 3. Periodic ClockSync (every CLOCK_SYNC_INTERVAL_MS).
        if (MpKernelClock.shouldEmitClockSync(ks.clock)) {
          broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.CLOCK_SYNC,
            MpKernelClock.buildClockSync(ks.clock, 0), null);
        }

        // 4. Hand off to template for game logic + outbound.
        var inner = ks.template.onLoop(ctx, logger, nk, dispatcher, tick, ks.template_state, forwarded);
        if (inner === null) {
          // Template requested match end. Persist + return null to Nakama.
          finalizeMatch(ks, dispatcher, matchId, "template_requested", logger, nk);
          return null;
        }
        ks.template_state = inner.state;

        // 5. Liveness sanity check — quorum lost (active < min) ends match.
        var initParams: any = (ks.template as any).defaultInit;
        var min = (initParams && typeof initParams.min_players === "number") ? initParams.min_players : 0;
        if (min > 0 && MpKernelPresence.activeCount(ks.presence) < min) {
          // QuizVerse and similar games tolerate a brief drop-below-min during
          // grace. Only force-end when no seat is even pending reconnect.
          if (MpKernelPresence.totalCount(ks.presence) < min) {
            // Persist + broadcast in correct order: build the result first
            // so the wire MatchEnded can carry it (Pillar 8 — clients see
            // outcome immediately, don't have to round-trip an RPC).
            var endRes: MpKernel.IMatchResultEnvelope | null = null;
            if (typeof ks.template.buildResult === "function") {
              endRes = ks.template.buildResult(ks.template_state, "quorum_lost");
            }
            broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.MATCH_ENDED, {
              reason: MpKernel.EndReason.QUORUM_LOST,
              result_envelope: endRes
            } as any, null);
            finalizeMatch(ks, dispatcher, matchId, "quorum_lost", logger, nk);
            return null;
          }
        }

        return { state: ks };
  }

  export function matchTerminateImpl(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    dispatcher: nkruntime.MatchDispatcher,
    tick: number,
    state: nkruntime.MatchState,
    graceSeconds: number
  ): { state: nkruntime.MatchState } | null {
        var ks = state as IKernelState<any>;
        var matchId = (ctx as any).matchId || "";
        var inner = ks.template.onTerminate(ctx, logger, nk, dispatcher, tick, ks.template_state, graceSeconds);
        ks.template_state = inner.state;
        finalizeMatch(ks, dispatcher, matchId, "operator_terminate", logger, nk);
        return { state: ks };
  }

  export function matchSignalImpl(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    dispatcher: nkruntime.MatchDispatcher,
    tick: number,
    state: nkruntime.MatchState,
    data: string
  ): { state: nkruntime.MatchState; data: string } | null {
        // Reserved for admin signals (force-end, mod-action). Default no-op.
        return { state: state, data: data };
  }

  // ------- helpers -------

  function parseHeader(m: nkruntime.MatchMessage): MpKernel.IHeader | null {
    try {
      var raw = (typeof m.data === "string") ? m.data : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && obj.h && typeof obj.h.op === "number") return obj.h as MpKernel.IHeader;
      return null;
    } catch (e) {
      return null;
    }
  }

  function handleKernelOpInbound<TS>(
    ks: IKernelState<TS>,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    m: nkruntime.MatchMessage,
    _logger: nkruntime.Logger
  ): boolean {
    var op = m.opCode;
    if (op === MpKernel.KernelOp.HEARTBEAT) {
      // Heartbeats just bump last-seen + answer with a server heartbeat
      // tick so clients can compute RTT. They never echo to other clients.
      var seat = ks.presence.seats[m.sender.userId];
      if (seat) seat.last_seen_unix_ms = Date.now();
      return true;
    }
    if (op === MpKernel.KernelOp.NETWORK_CLOCK_PING) {
      // Cristian-style clock sync: echo the client's ts + add server ts.
      // Targets only the originating presence to keep fan-out cheap.
      var pingPayload: any = null;
      try {
        var raw = (typeof m.data === "string") ? m.data
                : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
        if (raw) pingPayload = JSON.parse(raw);
      } catch (_e) {}
      var clientTs = (pingPayload && pingPayload.p && typeof pingPayload.p.client_ts_ms === "number")
        ? pingPayload.p.client_ts_ms : 0;
      broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.NETWORK_CLOCK_PONG, {
        client_ts_ms: clientTs,
        server_ts_ms: Date.now()
      } as any, [m.sender]);
      return true;
    }
    if (op === MpKernel.KernelOp.CLIENT_HELLO) {
      // Hello on an already-established match means schema renegotiation.
      // For P1 we just bump last-seen + reply with a fresh ServerHello
      // mirroring the original join welcome shape (so clients can recover
      // capability flags after a transient disconnect that didn't trip the
      // grace window).
      var seat3 = ks.presence.seats[m.sender.userId];
      if (seat3) seat3.last_seen_unix_ms = Date.now();
      broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.SERVER_HELLO, {
        match_id: matchId,
        assigned_user_id: m.sender.userId,
        server_match_time_ms: MpKernelClock.matchTimeMs(ks.clock),
        server_unix_ms: Date.now(),
        feature_flags: ks.feature_flags,
        reconnect_grace_ms_remaining:
          seat3 ? MpKernelPresence.reconnectGraceRemainingMs(seat3, ks.presence, Date.now()) : 0
      } as any, [m.sender]);
      return true;
    }
    if (op === MpKernel.KernelOp.MATCH_RESUME) {
      // For P1, ack with the current server seq so the client can skip
      // the snapshot replay if it's caught up. Real replay-from-seq lands
      // in P5 (under the resume buffer feature flag).
      broadcastKernel(ks, dispatcher, matchId, MpKernel.KernelOp.MATCH_RESUME_ACK, {
        replay_supported: false,
        from_seq: 0,
        to_seq: ks.clock.nextSeq,
        dropped: 0
      } as any, [m.sender]);
      return true;
    }
    return false;
  }

  function finalizeMatch<TS>(
    ks: IKernelState<TS>,
    _dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    reason: string,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama
  ): void {
    if (typeof ks.template.buildResult !== "function") return;
    var res = ks.template.buildResult(ks.template_state, reason);
    if (!res) return;
    res.match_id = matchId;
    res.template_id = ks.template_id;
    res.game_id = ks.game_id;
    res.region = ks.region;
    if (!res.started_unix_ms) res.started_unix_ms = ks.clock.matchStartUnixMs;
    res.ended_unix_ms = Date.now();
    res.duration_ms = res.ended_unix_ms - res.started_unix_ms;
    var w = MpKernelMatchResult.persist(nk, logger, res);
    if (!w.ok) {
      logger.warn("[MpKernelMatch] persist failed match=%s reason=%s err=%s",
        matchId, reason, w.error || "?");
    }
  }

  // ------- template registration -------

  // Reserve a template's opcode range in the code registry. Pure (no
  // `initializer`, `nk` or `logger`) so it is safe to run on EVERY Goja VM
  // via the auto-invoked, single-arg MpKernelModule.register(initializer)
  // (see postbuild.js autoInvokeRegister). Idempotent across module reload.
  //
  // NOTE: this intentionally does NOT call `initializer.registerMatch(...)`.
  // Nakama's Goja AST walker (server/runtime_javascript_init.go
  // @ getMatchHookFnIdentifier) only extracts handler keys from
  // `registerMatch` calls that are DIRECT statements inside InitModule's
  // body, with handler properties that are Identifiers referencing
  // GLOBAL-scope functions. A nested call here (inside a namespace helper,
  // passing a factory-built object literal) is invisible to the walker and
  // throws "global id could not be extracted: not found" — which is exactly
  // why every match template silently failed to mount. The actual
  // registerMatch wiring now lives in postbuild.js section 5b, which emits
  // direct calls in the generated InitModule wrapper pointing at the
  // top-level wrappers declared in data/modules/zz_mp_kernel_handlers.js.
  export function registerTemplate<TS>(
    template: MpKernel.IMatchTemplate<TS>
  ): void {
    MpKernelCodeRegistry.bootstrapKernelRanges();
    MpKernelCodeRegistry.reserve({
      name: "template:" + template.templateId,
      from: template.opRange.from,
      to: template.opRange.to,
      template_id: template.templateId
    });
  }
}
