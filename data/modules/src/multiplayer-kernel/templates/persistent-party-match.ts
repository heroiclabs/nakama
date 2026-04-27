// PersistentPartyRoom — long-lived party / friend-group room.
//
// Reserved opcode range 0xA000-0xAFFF.
//
// Concept: a "party" is a stable friend group that persists across
// gameplay sessions. Members come and go (online/offline), but the
// party itself (membership, roles, settings, last-seen state) lives
// in storage between sessions. The match instance is the live presence
// + chat substrate; storage is the durable identity.
//
// Lifecycle:
//   * Party is created via mp_create_match with party_id (or auto-id).
//   * On match init, server reads existing party state from storage
//     (collection: mp_party); if none, creates with creator as owner.
//   * Members join/leave the live presence freely; state writes back
//     to storage on each membership change + at TTL intervals.
//   * Roles: owner, officer, member. Owner can promote/demote, kick,
//     transfer ownership.
//   * Match terminates after `idle_terminate_ms` of zero presences,
//     but the party identity in storage persists.
//
// Why a kernel template (not a custom service):
//   * Reuses kernel envelope + opcodes + scoring infra.
//   * Free integration with the SDK adapter — clients just call
//     mp_create_match("persistent-party-v1", { party_id }) and get
//     a session that survives reconnect (state replays from storage).
//   * Uniform telemetry / SLO / shutdown story.

namespace MpKernelPersistentParty {
  export var Op = {
    PARTY_STATE:       0xA000, // server -> all
    INVITE:            0xA001, // owner/officer -> server -> targeted
    INVITE_ACCEPT:     0xA002, // client -> server
    INVITE_DECLINE:    0xA003, // client -> server
    KICK:              0xA004, // owner/officer -> server
    PROMOTE:           0xA005, // owner -> server
    DEMOTE:            0xA006, // owner -> server
    TRANSFER_OWNER:    0xA007, // owner -> server
    LEAVE_PARTY:       0xA008, // client -> server (leave permanently)
    SETTING_UPDATED:   0xA009, // owner/officer -> server -> all (e.g. party name)
    PARTY_CHAT:        0xA00A, // client -> server -> all (rate-limited)
    MEMBER_PRESENCE:   0xA00B, // server -> all
    READY_FOR_MATCH:   0xA00C, // client -> server (queue for game)
    MATCH_QUEUE_INFO:  0xA00D  // server -> all (party is queueing for a match)
  };

  export type Role = "owner" | "officer" | "member";

  export interface IMember {
    user_id: string;
    role: Role;
    joined_unix_ms: number;
    last_seen_unix_ms: number;
    online: boolean;
    ready_for_match: boolean;
  }

  export interface IPartyDoc {
    party_id: string;
    name: string;
    created_unix_ms: number;
    owner_user_id: string;
    members: { [u: string]: IMember };
    settings: {
      visibility:    "private" | "friends" | "public";
      auto_kick_idle_ms: number;
      max_members:   number;
      // Game-defined; e.g. preferred game mode, region, etc.
      game_payload:  any;
    };
    invites: { [u: string]: { invited_by: string; at_unix_ms: number; expires_unix_ms: number } };
    pinned_chat: string[]; // up to 3 pinned messages
  }

  export var DefaultInit = {
    party_id:                "",
    name:                    "Party",
    visibility:              "private", // "private" | "friends" | "public"
    max_members:             8,
    auto_kick_idle_ms:       0,         // 0 = never auto-kick
    chat_per_second:         2,
    chat_enabled:            true,
    invite_ttl_ms:           24 * 60 * 60 * 1000,
    // After zero live presences for this long, the match terminates.
    // The party identity persists in storage; reopening creates a new match.
    idle_terminate_ms:       5 * 60 * 1000,
    // How often to flush state to storage even without membership changes.
    storage_flush_interval_ms: 30_000,
    // Hard wall-clock cap (defensive); 7 days.
    max_match_duration_ms:   7 * 24 * 60 * 60 * 1000,
    // game_payload for settings.
    game_payload:            {} as any
  };

  export interface IState {
    init: any;
    party: IPartyDoc;
    presences: { [u: string]: { online: boolean; chat_bucket_unix_s: number; chat_bucket_count: number } };
    started_unix_ms: number;
    last_storage_flush_unix_ms: number;
    last_nonzero_presence_unix_ms: number;
    creator_user_id: string;
    pending_end_reason: string;
    outbound_seq: number;
  }

  export var STORAGE_COLLECTION = "mp_party";

  function mergeInit(params: any): any {
    var out: any = {};
    for (var k in DefaultInit) if (DefaultInit.hasOwnProperty(k)) out[k] = (DefaultInit as any)[k];
    if (params) for (var k2 in params) if (params.hasOwnProperty(k2)) out[k2] = params[k2];
    return out;
  }

  function readDoc(nk: nkruntime.Nakama, partyId: string): IPartyDoc | null {
    if (!partyId) return null;
    try {
      var rows = nk.storageRead([{ collection: STORAGE_COLLECTION, key: partyId, userId: "" }]);
      if (!rows || rows.length === 0) return null;
      return rows[0].value as IPartyDoc;
    } catch (_e) {
      return null;
    }
  }

  function writeDoc(nk: nkruntime.Nakama, logger: nkruntime.Logger, doc: IPartyDoc): void {
    try {
      nk.storageWrite([{
        collection:      STORAGE_COLLECTION,
        key:             doc.party_id,
        value:           doc as any,
        permissionRead:  2, // public-read; member metadata is non-sensitive
        permissionWrite: 0,
        userId:          ""
      }]);
    } catch (e: any) {
      logger.warn("[PersistentParty] storageWrite party=%s err=%s",
        doc.party_id, (e && e.message) ? e.message : String(e));
    }
  }

  function ensureDoc(state: IState, ctx: nkruntime.Context, init: any): IPartyDoc {
    var partyId = init.party_id || (ctx as any).matchId || ("party_" + Date.now());
    var existing: IPartyDoc | null = null;
    // Resolution: nk.storageRead happens via initState; we get nk in
    // initState only — so we hand the doc through state. ensureDoc is
    // called only with the doc already populated.
    if (state.party && state.party.party_id) return state.party;
    return {
      party_id: partyId,
      name: init.name || "Party",
      created_unix_ms: Date.now(),
      owner_user_id: state.creator_user_id || "",
      members: {},
      settings: {
        visibility:        init.visibility || "private",
        auto_kick_idle_ms: init.auto_kick_idle_ms || 0,
        max_members:       init.max_members || 8,
        game_payload:      init.game_payload || {}
      },
      invites: {},
      pinned_chat: []
    };
  }

  export var template: MpKernel.IMatchTemplate<IState> = {
    templateId: "persistent-party-v1",
    opRange: { from: 0xA000, to: 0xAFFF },
    defaultInit: DefaultInit,

    initState: function (ctx, _logger, nk, params) {
      var init = mergeInit(params.template_init);
      var matchId = (ctx as any).matchId || "";
      var partyId = init.party_id || matchId || ("party_" + Date.now());
      var nowMs = Date.now();
      var doc = readDoc(nk, partyId);
      var s: IState = {
        init: init,
        party: doc || {
          party_id: partyId,
          name: init.name || "Party",
          created_unix_ms: nowMs,
          owner_user_id: params.creator_user_id || "",
          members: {},
          settings: {
            visibility:        init.visibility || "private",
            auto_kick_idle_ms: init.auto_kick_idle_ms || 0,
            max_members:       init.max_members || 8,
            game_payload:      init.game_payload || {}
          },
          invites: {},
          pinned_chat: []
        },
        presences: {},
        started_unix_ms: nowMs,
        last_storage_flush_unix_ms: nowMs,
        last_nonzero_presence_unix_ms: nowMs,
        creator_user_id: params.creator_user_id || "",
        pending_end_reason: "",
        outbound_seq: 1
      };
      // First-time creator becomes owner.
      if (params.creator_user_id && !s.party.members[params.creator_user_id]) {
        s.party.members[params.creator_user_id] = {
          user_id:           params.creator_user_id,
          role:              "owner",
          joined_unix_ms:    nowMs,
          last_seen_unix_ms: nowMs,
          online:            false,
          ready_for_match:   false
        };
        if (!s.party.owner_user_id) s.party.owner_user_id = params.creator_user_id;
      }
      var label = JSON.stringify({
        template_id: template.templateId,
        game_id: params.game_id,
        party_id: s.party.party_id,
        owner: s.party.owner_user_id,
        max_members: s.party.settings.max_members
      });
      // 1 Hz — party rooms are mostly chat + presence, low-frequency state.
      return { state: s, tickRate: 1, label: label };
    },

    onJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presence, _metadata) {
      var ks = state as IState;
      var u = presence.userId;
      var member = ks.party.members[u];
      var visibility = ks.party.settings.visibility;
      // Private: must already be a member.
      if (visibility === "private" && !member) {
        // Allow if there's a pending invite.
        var inv = ks.party.invites[u];
        if (!inv || inv.expires_unix_ms < Date.now()) {
          return { state: ks, accept: false, rejectMessage: "private party — invite required" };
        }
      }
      // Capacity: counted by *member* slots, not live presences.
      var memberCount = 0;
      for (var k in ks.party.members) memberCount++;
      if (!member && memberCount >= ks.party.settings.max_members) {
        return { state: ks, accept: false, rejectMessage: "party full" };
      }
      return { state: ks, accept: true };
    },

    onJoin: function (_ctx, logger, nk, dispatcher, _tick, state, presences) {
      var ks = state as IState;
      var nowMs = Date.now();
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        var u = p.userId;
        // Promote pending invites to membership.
        if (!ks.party.members[u]) {
          var inv = ks.party.invites[u];
          if (inv && inv.expires_unix_ms >= nowMs) {
            ks.party.members[u] = {
              user_id: u, role: "member",
              joined_unix_ms: nowMs,
              last_seen_unix_ms: nowMs,
              online: true,
              ready_for_match: false
            };
            delete ks.party.invites[u];
          } else if (ks.party.settings.visibility === "public") {
            ks.party.members[u] = {
              user_id: u, role: "member",
              joined_unix_ms: nowMs,
              last_seen_unix_ms: nowMs,
              online: true,
              ready_for_match: false
            };
          }
        }
        var m = ks.party.members[u];
        if (m) {
          m.online = true;
          m.last_seen_unix_ms = nowMs;
        }
        if (!ks.presences[u]) {
          ks.presences[u] = { online: true, chat_bucket_unix_s: 0, chat_bucket_count: 0 };
        } else {
          ks.presences[u].online = true;
        }
        ks.last_nonzero_presence_unix_ms = nowMs;
        broadcastTemplate(ks, dispatcher, "", Op.MEMBER_PRESENCE, {
          user_id: u, online: true
        });
      }
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, "", Op.PARTY_STATE, partyStateBroadcastShape(ks));
      return { state: ks };
    },

    onLeave: function (_ctx, logger, nk, dispatcher, _tick, state, presences) {
      var ks = state as IState;
      var nowMs = Date.now();
      for (var i = 0; i < presences.length; i++) {
        var u = presences[i].userId;
        if (ks.presences[u]) ks.presences[u].online = false;
        var m = ks.party.members[u];
        if (m) {
          m.online = false;
          m.last_seen_unix_ms = nowMs;
        }
        broadcastTemplate(ks, dispatcher, "", Op.MEMBER_PRESENCE, {
          user_id: u, online: false
        });
      }
      writeDoc(nk, logger, ks.party);
      return { state: ks };
    },

    onLoop: function (ctx, logger, nk, dispatcher, _tick, state, messages) {
      var ks = state as IState;
      var matchId = (ctx as any).matchId || "";
      var nowMs = Date.now();

      // 0. Hard cap.
      if (nowMs > ks.started_unix_ms + ks.init.max_match_duration_ms) {
        ks.pending_end_reason = "duration_exceeded";
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.DURATION_EXCEEDED, nk, logger);
      }

      // 1. Drain inbound.
      for (var i = 0; i < messages.length; i++) {
        applyInbound(ks, messages[i], dispatcher, matchId, nk, logger, nowMs);
      }

      // 2. Idle termination — but only the match instance; the party doc
      //    itself persists in storage.
      var liveCount = 0;
      for (var u in ks.presences) if (ks.presences[u].online) liveCount++;
      if (liveCount > 0) ks.last_nonzero_presence_unix_ms = nowMs;
      else if (ks.init.idle_terminate_ms > 0 &&
               nowMs - ks.last_nonzero_presence_unix_ms > ks.init.idle_terminate_ms) {
        // Terminate match instance gracefully; party doc already persisted.
        writeDoc(nk, logger, ks.party);
        ks.pending_end_reason = "idle_terminate";
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.COMPLETED, nk, logger);
      }

      // 3. Periodic storage flush.
      if (nowMs - ks.last_storage_flush_unix_ms >= ks.init.storage_flush_interval_ms) {
        writeDoc(nk, logger, ks.party);
        ks.last_storage_flush_unix_ms = nowMs;
      }

      // 4. Auto-kick idle members (NOT presences — actual idle members).
      if (ks.party.settings.auto_kick_idle_ms > 0) {
        var toKick: string[] = [];
        for (var u2 in ks.party.members) {
          var mm = ks.party.members[u2];
          if (mm.role === "owner") continue; // never auto-kick owner
          if (!mm.online && (nowMs - mm.last_seen_unix_ms) > ks.party.settings.auto_kick_idle_ms) {
            toKick.push(u2);
          }
        }
        for (var k = 0; k < toKick.length; k++) {
          delete ks.party.members[toKick[k]];
          broadcastTemplate(ks, dispatcher, matchId, Op.KICK, {
            user_id: toKick[k], reason: "idle_auto_kick"
          });
        }
        if (toKick.length > 0) writeDoc(nk, logger, ks.party);
      }

      if (ks.pending_end_reason !== "") {
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.COMPLETED, nk, logger);
      }
      return { state: ks };
    },

    onTerminate: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _grace) {
      // Final storage flush is best-effort here; we already flushed in
      // onLoop's idle path. If terminate is forced from outside, the
      // pre-terminate writeDoc covers persistence.
      return { state: state };
    },

    buildResult: function (state, reason) {
      var ks = state as IState;
      var outcomes: MpKernel.IPlayerOutcome[] = [];
      for (var u in ks.party.members) {
        var m = ks.party.members[u];
        outcomes.push({
          user_id: u,
          is_agent: u.indexOf("agt_") === 0,
          placement: 0,
          score: 0,
          completed: true,
          left_early: false,
          game_payload: { role: m.role, last_seen_unix_ms: m.last_seen_unix_ms }
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
          party_id:    ks.party.party_id,
          end_reason:  reason,
          owner:       ks.party.owner_user_id,
          member_count: outcomes.length
        }
      };
    }
  };

  // ---- inbound + helpers ----

  function applyInbound(
    ks: IState,
    m: nkruntime.MatchMessage,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    nowMs: number
  ): void {
    var raw = (typeof m.data === "string") ? m.data : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
    if (!raw) return;
    var parsed: any;
    try { parsed = JSON.parse(raw); } catch (_e) { return; }
    var p = parsed.p || {};
    var sender = m.sender.userId;
    var senderMember = ks.party.members[sender];
    var senderRole: Role = senderMember ? senderMember.role : "member";

    // Per-sender chat rate-limit applied first since chat is the noisiest op.
    if (m.opCode === Op.PARTY_CHAT) {
      if (!ks.init.chat_enabled) return;
      if (!senderMember) return; // non-members can't chat
      var pres = ks.presences[sender];
      if (!pres) return;
      var nowS = Math.floor(nowMs / 1000);
      if (pres.chat_bucket_unix_s !== nowS) {
        pres.chat_bucket_unix_s = nowS;
        pres.chat_bucket_count = 0;
      }
      if (pres.chat_bucket_count >= ks.init.chat_per_second) return;
      pres.chat_bucket_count++;
      var text = (typeof p.text === "string") ? p.text.substring(0, 500) : "";
      broadcastTemplate(ks, dispatcher, matchId, Op.PARTY_CHAT, {
        user_id: sender,
        text:    text,
        server_unix_ms: nowMs
      });
      return;
    }

    if (m.opCode === Op.INVITE) {
      if (senderRole !== "owner" && senderRole !== "officer") return;
      var target = p.user_id;
      if (!target) return;
      ks.party.invites[target] = {
        invited_by: sender,
        at_unix_ms: nowMs,
        expires_unix_ms: nowMs + ks.init.invite_ttl_ms
      };
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, matchId, Op.INVITE, {
        user_id: target, invited_by: sender, expires_unix_ms: ks.party.invites[target].expires_unix_ms
      });
    } else if (m.opCode === Op.INVITE_ACCEPT) {
      var inv = ks.party.invites[sender];
      if (!inv || inv.expires_unix_ms < nowMs) return;
      ks.party.members[sender] = {
        user_id: sender, role: "member",
        joined_unix_ms: nowMs, last_seen_unix_ms: nowMs,
        online: true, ready_for_match: false
      };
      delete ks.party.invites[sender];
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, matchId, Op.PARTY_STATE, partyStateBroadcastShape(ks));
    } else if (m.opCode === Op.INVITE_DECLINE) {
      delete ks.party.invites[sender];
      writeDoc(nk, logger, ks.party);
    } else if (m.opCode === Op.KICK) {
      if (senderRole !== "owner" && senderRole !== "officer") return;
      var kickTarget = p.user_id;
      if (!kickTarget) return;
      var t = ks.party.members[kickTarget];
      if (!t) return;
      // Officers can't kick owner / other officers.
      if (senderRole === "officer" && (t.role === "owner" || t.role === "officer")) return;
      delete ks.party.members[kickTarget];
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, matchId, Op.KICK, {
        user_id: kickTarget, by: sender, reason: p.reason || ""
      });
    } else if (m.opCode === Op.PROMOTE) {
      if (senderRole !== "owner") return;
      var pTarget = p.user_id;
      var pt = ks.party.members[pTarget];
      if (!pt) return;
      pt.role = "officer";
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, matchId, Op.PROMOTE, { user_id: pTarget });
    } else if (m.opCode === Op.DEMOTE) {
      if (senderRole !== "owner") return;
      var dTarget = p.user_id;
      var dt = ks.party.members[dTarget];
      if (!dt) return;
      dt.role = "member";
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, matchId, Op.DEMOTE, { user_id: dTarget });
    } else if (m.opCode === Op.TRANSFER_OWNER) {
      if (senderRole !== "owner") return;
      var newOwner = p.user_id;
      var no = ks.party.members[newOwner];
      if (!no || newOwner === sender) return;
      var oldOwner = ks.party.members[sender];
      if (oldOwner) oldOwner.role = "officer";
      no.role = "owner";
      ks.party.owner_user_id = newOwner;
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, matchId, Op.TRANSFER_OWNER, {
        from: sender, to: newOwner
      });
    } else if (m.opCode === Op.LEAVE_PARTY) {
      if (!senderMember) return;
      // Owner leaving without transfer: auto-promote longest-tenured officer
      // (or member) so the party isn't orphaned.
      if (senderMember.role === "owner") {
        var promote = "";
        var promoteAt = Number.MAX_SAFE_INTEGER;
        for (var u in ks.party.members) {
          var mm = ks.party.members[u];
          if (u === sender) continue;
          // Officers preferred over members.
          var rank = (mm.role === "officer") ? 0 : 1;
          var key = rank * 1e15 + mm.joined_unix_ms;
          if (key < promoteAt) { promote = u; promoteAt = key; }
        }
        if (promote) {
          ks.party.members[promote].role = "owner";
          ks.party.owner_user_id = promote;
          broadcastTemplate(ks, dispatcher, matchId, Op.TRANSFER_OWNER, {
            from: sender, to: promote, reason: "owner_left"
          });
        } else {
          // Last member leaving — clear owner; party doc lingers in storage
          // until GC. A future "rejoin" creates a new party.
          ks.party.owner_user_id = "";
        }
      }
      delete ks.party.members[sender];
      delete ks.presences[sender];
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, matchId, Op.LEAVE_PARTY, { user_id: sender });
    } else if (m.opCode === Op.SETTING_UPDATED) {
      if (senderRole !== "owner" && senderRole !== "officer") return;
      if (typeof p.name === "string") ks.party.name = p.name.substring(0, 80);
      if (p.visibility === "private" || p.visibility === "friends" || p.visibility === "public") {
        ks.party.settings.visibility = p.visibility;
      }
      if (typeof p.max_members === "number" && p.max_members > 0 && p.max_members <= 32) {
        // Don't shrink below current member count.
        var mc = 0; for (var um in ks.party.members) mc++;
        ks.party.settings.max_members = Math.max(mc, p.max_members);
      }
      if (p.game_payload) {
        ks.party.settings.game_payload = p.game_payload;
      }
      writeDoc(nk, logger, ks.party);
      broadcastTemplate(ks, dispatcher, matchId, Op.SETTING_UPDATED, partyStateBroadcastShape(ks));
    } else if (m.opCode === Op.READY_FOR_MATCH) {
      if (!senderMember) return;
      senderMember.ready_for_match = !!p.ready;
      // No storage flush for transient "ready" — captured in next periodic flush.
      var allReady = true;
      var liveCount = 0;
      for (var u3 in ks.party.members) {
        var mmm = ks.party.members[u3];
        if (mmm.online) liveCount++;
        if (mmm.online && !mmm.ready_for_match) allReady = false;
      }
      broadcastTemplate(ks, dispatcher, matchId, Op.MATCH_QUEUE_INFO, {
        all_ready:  allReady && liveCount > 1,
        live_count: liveCount,
        ready_user_ids: collectReady(ks)
      });
    }
  }

  function collectReady(ks: IState): string[] {
    var out: string[] = [];
    for (var u in ks.party.members) {
      var m = ks.party.members[u];
      if (m.online && m.ready_for_match) out.push(u);
    }
    return out;
  }

  function partyStateBroadcastShape(ks: IState): any {
    return {
      party_id:    ks.party.party_id,
      name:        ks.party.name,
      owner:       ks.party.owner_user_id,
      members:     ks.party.members,
      settings:    ks.party.settings,
      // Don't leak invites broadly — only the invitee's client should see
      // their own invite. Future: per-target unicast for INVITE op only.
      invites:     {},
      pinned_chat: ks.party.pinned_chat
    };
  }

  function endMatch(
    ks: IState,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    reasonEnum: number,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger
  ): null {
    // Always flush before ending — ensures we capture the latest party state.
    writeDoc(nk, logger, ks.party);
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

  // Silence unused-helper warning (ensureDoc is exposed for future
  // readDoc-via-external-RPC paths but is unused inside this file).
  var _keepEnsureDoc = ensureDoc;
  void _keepEnsureDoc;
}
