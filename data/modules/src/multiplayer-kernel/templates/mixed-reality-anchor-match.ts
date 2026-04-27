// MixedRealityAnchorMatch — XR shared-spatial-anchor + co-located object
// authority template. Reserved opcode range 0xB000-0xBFFF.
//
// Concept:
//   A "room" of XR participants whose devices have negotiated a shared
//   spatial frame (Meta Spatial Anchors, ARKit collab + SharePlay,
//   visionOS shared anchors, OpenXR XR_MSFT_spatial_anchor, Azure
//   Spatial Anchors, or QR / image-marker fallbacks). All transforms
//   exchanged in this match are *anchor-relative* — millimetres in the
//   x/y/z axes of the anchor's local frame, with a packed quaternion.
//
// State invariants enforced here:
//
//   1. There is at most one active host anchor offer at any time. Late
//      joiners receive the offer in their join welcome blob.
//   2. Object authority is exclusive: only the current `holder_user_id`
//      can publish ObjectTransform messages for that object. The server
//      issues an authority_token on grant; transforms with stale tokens
//      are dropped.
//   3. Concurrent grabs within `grab_priority_window_ms` are tie-broken
//      by `priority` (higher wins; ties → first-arrival).
//   4. AnchorLost from the host triggers a re-offer / fallback (QR or
//      image-marker if the host opted in).
//   5. Per-user anchor resolve must complete within
//      `anchor_resolve_timeout_ms` or the user is downgraded to
//      "unanchored" (still observes, can't publish transforms).
//   6. Position updates are routed through the kernel interest service
//      so each client only receives transforms within its AOI cell
//      neighbourhood (default 8 m cells, radius=1 → 24 m visible).

namespace MpKernelMrAnchor {
  export var Op = {
    ANCHOR_OFFER:         0xB000, // server -> all (or new joiner)
    ANCHOR_RESOLVED:      0xB001, // client -> server -> host (ack)
    ANCHOR_LOST:          0xB002, // any -> server (-> all)
    RELOCALIZED:          0xB003, // client -> server (-> all)
    OBJECT_GRAB:          0xB004, // client -> server (-> all on grant)
    OBJECT_GRAB_REJECTED: 0xB005, // server -> requester
    OBJECT_RELEASE:       0xB006, // client -> server (-> all)
    OBJECT_TRANSFORM:     0xB007, // owner -> server -> AOI peers
    OBJECT_AUTHORITY:     0xB008, // server -> all (token rotation)
    PARTICIPANT_STATE:    0xB009, // server -> all (anchor status snapshot)
    HOST_REOFFER:         0xB00A, // server -> all (after AnchorLost)
    DOWNGRADED:           0xB00B  // server -> client (anchor resolve timeout)
  };

  export var AnchorProvider = {
    UNSPECIFIED:        0,
    META_SHARED:        1,
    VISIONOS_SHARED:    2,
    ARKIT_COLLAB:       3,
    AZURE_SPATIAL:      4,
    QR_FALLBACK:        5,
    IMAGE_MARKER:       6,
    PCVR_FAKE:          7
  };

  export interface IAnchorOffer {
    anchor_id:               string;
    provider:                number;
    provider_anchor_token:   string;
    fallback_qr_b64:         string; // bytes are b64'd on the wire
    fallback_marker_b64:     string;
    room_label:              string;
    ts_ms:                   number;
    region:                  string;
  }

  export interface IObject {
    object_id:        string;
    holder_user_id:   string; // "" if not held
    authority_token:  number; // monotonically increasing; 0 = unowned
    last_pose_mm:     { px: number; py: number; pz: number; rot_packed: number };
    last_pub_ms:      number;
    grab_priority:    number;
    grab_arrived_ms:  number;
    frozen:           boolean;
  }

  export interface IParticipant {
    user_id:               string;
    anchor_resolved:       boolean;
    anchor_provider:       number; // which provider they actually used
    anchor_resolve_ts_ms:  number;
    anchor_attempts:       number;
    anchor_failure_detail: string;
    last_position_pub_ms:  number;
    downgraded:            boolean; // true → can observe, can't publish
    is_host:               boolean;
  }

  export interface IInit {
    max_users:                  number;
    anchor_resolve_timeout_ms:  number;
    require_anchor_to_join:     boolean;
    allow_qr_fallback:          boolean;
    allow_marker_fallback:      boolean;
    allow_pcvr_fake_anchor:     boolean;
    grab_priority_window_ms:    number;
    cell_meters:                number;
    aoi_radius:                 number;
    transform_rate_per_user:    number; // hz cap per object owner
    pcvr_fake_anchor_id:        string;
  }

  export var DefaultInit: IInit = {
    max_users:                  16,
    anchor_resolve_timeout_ms:  15_000,
    require_anchor_to_join:     false,
    allow_qr_fallback:          true,
    allow_marker_fallback:      true,
    allow_pcvr_fake_anchor:     true,
    grab_priority_window_ms:    250,
    cell_meters:                8.0,
    aoi_radius:                 1,
    transform_rate_per_user:    60,
    pcvr_fake_anchor_id:        "pcvr-floor-fake-v1"
  };

  export interface IState {
    init:                IInit;
    started_unix_ms:     number;
    host_user_id:        string;
    current_offer:       IAnchorOffer | null;
    participants:        { [u: string]: IParticipant };
    objects:             { [oid: string]: IObject };
    auth_token_seq:      number;
    last_grab_window_ms: number;
    pending_grabs:       { [oid: string]: Array<{ user_id: string; priority: number; arrived_ms: number }> };
    transform_buckets:   { [u: string]: { unix_s: number; count: number } };
    creator_user_id:     string;
    outbound_seq:        number;
  }

  function mergeInit(input: any): IInit {
    var out: any = {};
    for (var k in DefaultInit) if (DefaultInit.hasOwnProperty(k)) out[k] = (DefaultInit as any)[k];
    if (input) for (var k2 in input) if (input.hasOwnProperty(k2)) out[k2] = input[k2];
    return out as IInit;
  }

  function fanOut(state: IState, dispatcher: nkruntime.MatchDispatcher, op: number, payload: any, presences?: nkruntime.Presence[]): void {
    state.outbound_seq++;
    var env = {
      seq:    state.outbound_seq,
      ts_ms:  Date.now(),
      op:     op,
      payload: payload
    };
    var bytes = JSON.stringify(env);
    if (presences && presences.length) {
      dispatcher.broadcastMessage(op, bytes, presences, null, true);
    } else {
      dispatcher.broadcastMessage(op, bytes, null, null, true);
    }
  }

  function sendErr(state: IState, dispatcher: nkruntime.MatchDispatcher, target: nkruntime.Presence, code: number, detail: string): void {
    state.outbound_seq++;
    var env = {
      seq: state.outbound_seq, ts_ms: Date.now(), op: MpKernel.KernelOp.ERROR,
      payload: { code: code, detail: detail }
    };
    dispatcher.broadcastMessage(MpKernel.KernelOp.ERROR, JSON.stringify(env), [target], null, true);
  }

  function presenceListById(state: IState, dispatcher: nkruntime.MatchDispatcher, ctx: nkruntime.Context, userIds: string[]): nkruntime.Presence[] {
    // The Goja runtime exposes the live presence list through ctx.match
    // (set by the match handler before each callback). When unavailable,
    // we fall back to broadcasting to all and let the client filter.
    var allP = (ctx as any).matchPresences as nkruntime.Presence[] | undefined;
    if (!allP) return [];
    var lookup: { [u: string]: boolean } = {};
    for (var i = 0; i < userIds.length; i++) lookup[userIds[i]] = true;
    var out: nkruntime.Presence[] = [];
    for (var j = 0; j < allP.length; j++) {
      if (lookup[allP[j].userId]) out.push(allP[j]);
    }
    return out;
  }

  export var template: MpKernel.IMatchTemplate<IState> = {
    templateId: "mixed-reality-anchor-v1",
    opRange: { from: 0xB000, to: 0xBFFF },
    defaultInit: DefaultInit,

    initState: function (ctx, _logger, _nk, params) {
      var init = mergeInit(params.template_init);
      var nowMs = Date.now();
      var matchId = (ctx as any).matchId || "";
      var s: IState = {
        init: init,
        started_unix_ms: nowMs,
        host_user_id: "",
        current_offer: null,
        participants: {},
        objects: {},
        auth_token_seq: 1,
        last_grab_window_ms: 0,
        pending_grabs: {},
        transform_buckets: {},
        creator_user_id: params.creator_user_id || "",
        outbound_seq: 1
      };
      // Configure interest service for this match.
      MpKernelInterest.configure(matchId, {
        cellMeters: init.cell_meters,
        neighbourRadius: init.aoi_radius
      });
      var label = JSON.stringify({
        template_id: template.templateId,
        game_id: params.game_id,
        region: params.region || "",
        max_users: init.max_users,
        creator: params.creator_user_id || ""
      });
      // 30 Hz tick — drives anchor resolve timeouts + AOI sweeps.
      return { state: s, tickRate: 30, label: label };
    },

    onJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presence, _metadata) {
      var ks = state as IState;
      var memberCount = 0;
      for (var k in ks.participants) memberCount++;
      if (!ks.participants[presence.userId] && memberCount >= ks.init.max_users) {
        return { state: ks, accept: false, rejectMessage: "match full" };
      }
      // Optional require_anchor_to_join: not enforceable until the
      // client signals provider capability, so we accept here and
      // downgrade later if they fail to resolve in time.
      return { state: ks, accept: true };
    },

    onJoin: function (_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
      var ks = state as IState;
      var nowMs = Date.now();
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        var u = p.userId;
        if (!ks.participants[u]) {
          ks.participants[u] = {
            user_id:               u,
            anchor_resolved:       false,
            anchor_provider:       AnchorProvider.UNSPECIFIED,
            anchor_resolve_ts_ms:  0,
            anchor_attempts:       0,
            anchor_failure_detail: "",
            last_position_pub_ms:  nowMs,
            downgraded:            false,
            is_host:               false
          };
        }
        // First joiner becomes host (only if no host yet).
        if (!ks.host_user_id) {
          ks.host_user_id = u;
          ks.participants[u].is_host = true;
        }
        // Replay current offer so the joiner can attempt to resolve.
        if (ks.current_offer) {
          fanOut(ks, dispatcher, Op.ANCHOR_OFFER, ks.current_offer, [p]);
        }
        // Send participant snapshot.
        fanOut(ks, dispatcher, Op.PARTICIPANT_STATE, { participants: ks.participants }, [p]);
      }
      return { state: ks };
    },

    onLeave: function (_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
      var ks = state as IState;
      var matchId = (presences && presences.length > 0) ? "(unknown)" : "(unknown)";
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        var u = p.userId;
        // Drop their interest entry.
        try { MpKernelInterest.remove(matchId, u); } catch (_e) {}
        // Release any objects they were holding.
        for (var oid in ks.objects) {
          var o = ks.objects[oid];
          if (o.holder_user_id === u) {
            o.holder_user_id = "";
            o.authority_token = ks.auth_token_seq++;
            fanOut(ks, dispatcher, Op.OBJECT_RELEASE, { object_id: oid, user_id: u });
            fanOut(ks, dispatcher, Op.OBJECT_AUTHORITY, {
              object_id: oid, holder_user_id: "", authority_token: o.authority_token
            });
          }
        }
        // Host migration.
        if (ks.host_user_id === u) {
          ks.host_user_id = "";
          for (var k in ks.participants) {
            if (k !== u) { ks.host_user_id = k; ks.participants[k].is_host = true; break; }
          }
          fanOut(ks, dispatcher, Op.PARTICIPANT_STATE, { participants: ks.participants });
        }
        delete ks.participants[u];
        delete ks.transform_buckets[u];
      }
      return { state: ks };
    },

    onLoop: function (ctx, logger, nk, dispatcher, _tick, state, messages) {
      var ks = state as IState;
      var matchId = (ctx as any).matchId || "";
      var nowMs = Date.now();

      // Process inbound messages.
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var sender = msg.sender;
        var op = msg.opCode;
        var data: any = {};
        try { data = JSON.parse((msg as any).data || "{}"); } catch (_e) {}

        switch (op) {
          case Op.ANCHOR_OFFER:
            if (sender.userId !== ks.host_user_id) {
              sendErr(ks, dispatcher, sender, MpKernel.ErrorCode.PERMISSION_DENIED, "only host can offer");
              break;
            }
            ks.current_offer = {
              anchor_id:             data.anchor_id || ("a_" + nowMs.toString(36)),
              provider:              data.provider || AnchorProvider.UNSPECIFIED,
              provider_anchor_token: data.provider_anchor_token || "",
              fallback_qr_b64:       data.fallback_qr_b64 || "",
              fallback_marker_b64:   data.fallback_marker_b64 || "",
              room_label:            data.room_label || "",
              ts_ms:                 nowMs,
              region:                data.region || ""
            };
            fanOut(ks, dispatcher, Op.ANCHOR_OFFER, ks.current_offer);
            break;

          case Op.ANCHOR_RESOLVED:
            var pp = ks.participants[sender.userId];
            if (!pp) break;
            pp.anchor_attempts++;
            if (data.ok) {
              pp.anchor_resolved = true;
              pp.anchor_resolve_ts_ms = nowMs;
              pp.anchor_provider = data.provider || ks.current_offer ? ks.current_offer.provider : 0;
              pp.anchor_failure_detail = "";
            } else {
              pp.anchor_resolved = false;
              pp.anchor_failure_detail = data.failure_detail || "unknown";
            }
            fanOut(ks, dispatcher, Op.PARTICIPANT_STATE, { participants: ks.participants });
            break;

          case Op.ANCHOR_LOST:
            var lostBy = ks.participants[sender.userId];
            if (lostBy) lostBy.anchor_resolved = false;
            fanOut(ks, dispatcher, Op.ANCHOR_LOST, {
              user_id: sender.userId, anchor_id: data.anchor_id || "",
              reason: data.reason || ""
            });
            // If host lost their own anchor, force a re-offer cycle.
            if (sender.userId === ks.host_user_id) {
              ks.current_offer = null;
              fanOut(ks, dispatcher, Op.HOST_REOFFER, { host_user_id: ks.host_user_id });
            }
            break;

          case Op.RELOCALIZED:
            fanOut(ks, dispatcher, Op.RELOCALIZED, {
              user_id: sender.userId,
              anchor_id: data.anchor_id || "",
              confidence_pct: data.confidence_pct || 0
            });
            break;

          case Op.OBJECT_GRAB:
            handleGrab(ks, dispatcher, sender, data, nowMs, ctx);
            break;

          case Op.OBJECT_RELEASE:
            handleRelease(ks, dispatcher, sender, data);
            break;

          case Op.OBJECT_TRANSFORM:
            handleTransform(ks, logger, dispatcher, sender, data, nowMs, matchId, ctx);
            break;

          default:
            // Unknown opcode in our range — surface a typed error.
            sendErr(ks, dispatcher, sender, MpKernel.ErrorCode.UNKNOWN_OPCODE, "op=" + op);
        }
      }

      // Resolve grab tie-break windows.
      for (var oid in ks.pending_grabs) {
        var queue = ks.pending_grabs[oid];
        if (queue.length === 0) { delete ks.pending_grabs[oid]; continue; }
        var oldest = queue[0].arrived_ms;
        if (nowMs - oldest >= ks.init.grab_priority_window_ms) {
          // Pick highest priority; tie -> first arrival.
          queue.sort(function (a, b) {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.arrived_ms - b.arrived_ms;
          });
          var winner = queue[0];
          ks.pending_grabs[oid] = [];
          var obj = ks.objects[oid] || {
            object_id: oid, holder_user_id: "", authority_token: 0,
            last_pose_mm: { px: 0, py: 0, pz: 0, rot_packed: 0 },
            last_pub_ms: 0, grab_priority: 0, grab_arrived_ms: 0, frozen: false
          };
          if (obj.frozen) {
            // Reject everyone in the queue.
            for (var qi = 0; qi < queue.length; qi++) {
              var rp = presenceListById(ks, dispatcher, ctx, [queue[qi].user_id]);
              if (rp.length) sendErr(ks, dispatcher, rp[0], MpKernel.ErrorCode.PERMISSION_DENIED, "object_frozen");
            }
            continue;
          }
          obj.holder_user_id = winner.user_id;
          obj.authority_token = ks.auth_token_seq++;
          obj.grab_priority = winner.priority;
          obj.grab_arrived_ms = winner.arrived_ms;
          ks.objects[oid] = obj;
          fanOut(ks, dispatcher, Op.OBJECT_AUTHORITY, {
            object_id: oid,
            holder_user_id: winner.user_id,
            authority_token: obj.authority_token
          });
          // Reject the losers.
          for (var li = 1; li < queue.length; li++) {
            var rp2 = presenceListById(ks, dispatcher, ctx, [queue[li].user_id]);
            if (rp2.length) {
              fanOut(ks, dispatcher, Op.OBJECT_GRAB_REJECTED, {
                object_id: oid, user_id: queue[li].user_id,
                reason: "lost_priority", current_holder: winner.user_id
              }, rp2);
            }
          }
        }
      }

      // Anchor resolve timeouts → downgrade.
      for (var u in ks.participants) {
        var part = ks.participants[u];
        if (!part.anchor_resolved && !part.downgraded &&
            (nowMs - ks.started_unix_ms) > ks.init.anchor_resolve_timeout_ms) {
          part.downgraded = true;
          var rp3 = presenceListById(ks, dispatcher, ctx, [u]);
          if (rp3.length) {
            fanOut(ks, dispatcher, Op.DOWNGRADED, {
              user_id: u, reason: "anchor_resolve_timeout"
            }, rp3);
          }
          fanOut(ks, dispatcher, Op.PARTICIPANT_STATE, { participants: ks.participants });
        }
      }

      // GC stale interest entries.
      try { MpKernelInterest.reap(matchId, nowMs); } catch (_e) {}

      // Match terminates if everyone left.
      var pcount = 0; for (var pk in ks.participants) pcount++;
      if (pcount === 0 && _tick > 60) {
        return null;
      }
      return { state: ks };
    },

    onTerminate: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _grace) {
      var ks = state as IState;
      try { MpKernelInterest.cleanupMatch((ks as any).match_id || ""); } catch (_e) {}
      return { state: ks };
    },

    buildResult: function (state, reason) {
      var ks = state as IState;
      var nowMs = Date.now();
      var outcomes: MpKernel.IPlayerOutcome[] = [];
      for (var u in ks.participants) {
        var p = ks.participants[u];
        outcomes.push({
          user_id: u, is_agent: false, placement: 0, score: 0,
          completed: p.anchor_resolved, left_early: false,
          game_payload: {
            anchor_resolved: p.anchor_resolved,
            anchor_provider: p.anchor_provider,
            anchor_attempts: p.anchor_attempts,
            downgraded:      p.downgraded,
            failure_detail:  p.anchor_failure_detail
          }
        });
      }
      return {
        match_id:        (ks as any).match_id || "",
        template_id:     template.templateId,
        game_id:         "",
        started_unix_ms: ks.started_unix_ms,
        ended_unix_ms:   nowMs,
        duration_ms:     Math.max(0, nowMs - ks.started_unix_ms),
        outcomes:        outcomes,
        game_payload:    {
          end_reason:   reason || "",
          host_user_id: ks.host_user_id,
          objects:      ks.objects
        }
      };
    }
  };

  function handleGrab(state: IState, dispatcher: nkruntime.MatchDispatcher, sender: nkruntime.Presence, data: any, nowMs: number, _ctx: nkruntime.Context): void {
    var oid = data.object_id;
    if (!oid) {
      sendErr(state, dispatcher, sender, MpKernel.ErrorCode.BAD_PAYLOAD, "object_id required");
      return;
    }
    var part = state.participants[sender.userId];
    if (!part || part.downgraded) {
      sendErr(state, dispatcher, sender, MpKernel.ErrorCode.PERMISSION_DENIED, "downgraded_observer");
      return;
    }
    var obj = state.objects[oid];
    if (obj && obj.holder_user_id && obj.holder_user_id !== sender.userId && !obj.frozen) {
      // Already held — surface explicit grab reject.
      fanOut(state, dispatcher, Op.OBJECT_GRAB_REJECTED, {
        object_id: oid, user_id: sender.userId,
        reason: "held_by_other", current_holder: obj.holder_user_id
      }, [sender]);
      return;
    }
    if (obj && obj.frozen) {
      fanOut(state, dispatcher, Op.OBJECT_GRAB_REJECTED, {
        object_id: oid, user_id: sender.userId,
        reason: "frozen", current_holder: obj.holder_user_id || ""
      }, [sender]);
      return;
    }
    // Add to pending queue; resolved on tick after grab_priority_window_ms.
    if (!state.pending_grabs[oid]) state.pending_grabs[oid] = [];
    state.pending_grabs[oid].push({
      user_id: sender.userId,
      priority: typeof data.priority === "number" ? data.priority : 0,
      arrived_ms: nowMs
    });
  }

  function handleRelease(state: IState, dispatcher: nkruntime.MatchDispatcher, sender: nkruntime.Presence, data: any): void {
    var oid = data.object_id;
    if (!oid) {
      sendErr(state, dispatcher, sender, MpKernel.ErrorCode.BAD_PAYLOAD, "object_id required");
      return;
    }
    var obj = state.objects[oid];
    if (!obj) return;
    if (obj.holder_user_id !== sender.userId) {
      sendErr(state, dispatcher, sender, MpKernel.ErrorCode.PERMISSION_DENIED, "not_holder");
      return;
    }
    obj.holder_user_id = "";
    obj.authority_token = state.auth_token_seq++;
    fanOut(state, dispatcher, Op.OBJECT_RELEASE, { object_id: oid, user_id: sender.userId });
    fanOut(state, dispatcher, Op.OBJECT_AUTHORITY, {
      object_id: oid, holder_user_id: "", authority_token: obj.authority_token
    });
  }

  function handleTransform(
    state: IState, logger: nkruntime.Logger, dispatcher: nkruntime.MatchDispatcher,
    sender: nkruntime.Presence, data: any, nowMs: number, matchId: string, ctx: nkruntime.Context
  ): void {
    var oid = data.object_id;
    var obj = state.objects[oid];
    if (!obj) {
      sendErr(state, dispatcher, sender, MpKernel.ErrorCode.MATCH_NOT_FOUND, "unknown_object");
      return;
    }
    if (obj.holder_user_id !== sender.userId) {
      sendErr(state, dispatcher, sender, MpKernel.ErrorCode.PERMISSION_DENIED, "not_holder");
      return;
    }
    if ((data.authority_token | 0) !== (obj.authority_token | 0)) {
      sendErr(state, dispatcher, sender, MpKernel.ErrorCode.NOT_AUTHORIZED, "stale_authority_token");
      return;
    }
    // Per-user rate limit.
    var nowS = Math.floor(nowMs / 1000);
    var b = state.transform_buckets[sender.userId];
    if (!b || b.unix_s !== nowS) {
      state.transform_buckets[sender.userId] = { unix_s: nowS, count: 0 };
      b = state.transform_buckets[sender.userId];
    }
    b.count++;
    if (b.count > state.init.transform_rate_per_user) {
      sendErr(state, dispatcher, sender, MpKernel.ErrorCode.RATE_LIMITED, "object_transform_rate");
      return;
    }
    obj.last_pose_mm = {
      px: (data.px_mm | 0), py: (data.py_mm | 0), pz: (data.pz_mm | 0),
      rot_packed: (data.rot_packed | 0)
    };
    obj.last_pub_ms = nowMs;
    // Update interest hash by holder position (mm → m).
    try {
      var ids = MpKernelInterest.update(matchId, sender.userId, obj.last_pose_mm.px / 1000, obj.last_pose_mm.py / 1000, obj.last_pose_mm.pz / 1000, nowMs);
      var presences = presenceListById(state, dispatcher, ctx, ids);
      if (presences.length) {
        fanOut(state, dispatcher, Op.OBJECT_TRANSFORM, {
          object_id: oid,
          holder_user_id: sender.userId,
          authority_token: obj.authority_token,
          px_mm: obj.last_pose_mm.px,
          py_mm: obj.last_pose_mm.py,
          pz_mm: obj.last_pose_mm.pz,
          rot_packed: obj.last_pose_mm.rot_packed
        }, presences);
        return;
      }
    } catch (e: any) {
      logger.debug("[MR] interest update failed: " + ((e && e.message) ? e.message : String(e)));
    }
    // Fallback: full broadcast.
    fanOut(state, dispatcher, Op.OBJECT_TRANSFORM, {
      object_id: oid,
      holder_user_id: sender.userId,
      authority_token: obj.authority_token,
      px_mm: obj.last_pose_mm.px,
      py_mm: obj.last_pose_mm.py,
      pz_mm: obj.last_pose_mm.pz,
      rot_packed: obj.last_pose_mm.rot_packed
    });
  }
}
