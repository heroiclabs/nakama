// ConversationalPartyMatch — voice-first social template.
//
// Reserved opcode range 0x1000-0x1FFF.
//
// What this is:
//   A live "voice room" template where N participants — humans and/or
//   AI agents — share an authoritative speaker queue, hand-raise + grant
//   workflow, transcript stream, reactions, and a topic. The actual audio
//   is carried by a pluggable IIVXVoice provider (LiveKit by default);
//   this template owns the *control plane* (who speaks when, what's the
//   topic, who's an agent, what's been said) and the kernel guarantees
//   ordering / idempotency / authority.
//
// Why a kernel template (not a custom RPC stack):
//   * Reuses kernel envelope, presence, idempotency, seq-gap, error fan-out.
//   * AI agents are first-class presences (user_id starts with "agt_") so
//     turn-taking, transcripts, and moderation work without special-case
//     code paths.
//   * Free reconnect / state snapshot replay; clients can leave and return
//     within reconnect_grace_ms and rebuild the room from RoomSnapshot.
//
// State invariants enforced here:
//   1. At most one active speaker. The grant carries a floor expiry.
//   2. Speaker queue capped at speaker_queue_cap (default 50). Overflow
//      returns RATE_LIMITED via OP_ERROR.
//   3. Reactions are throttled per user (default 5/sec, 1s window).
//   4. Text chat is throttled per user (default 5/sec, 1s window).
//   5. Topic changes only by moderator (or anyone if anyone_can_topic).
//   6. Transcript is append-only; finalised chunks evict interim chunks
//      with the same speaker_user_id + start_ts_ms.
//   7. Hand-raise queue is FIFO. Lower-hand removes from queue.
//   8. Agent invariants: agents may speak only when granted; agents emit
//      transcripts via IIVXAgent kernel service (see agent.proto). This
//      template only relays the chunks here.

namespace MpKernelConvParty {
  export var Op = {
    SPEAKER_REQUEST:    0x1000,
    SPEAKER_GRANT:      0x1001,
    SPEAKER_REVOKE:     0x1002,
    MUTE_SELF:          0x1003,
    REACTION:           0x1004,
    TEXT_CHAT:          0x1005,
    TOPIC_SET:          0x1006,
    PIN_MESSAGE:        0x1007,
    TRANSCRIPT_CHUNK:   0x1008,
    VOICE_MODE:         0x1009,
    HAND_LOWER:         0x100A,
    ROOM_SNAPSHOT:      0x100B
  };

  // Mirror schemas/multiplayer/templates/conversational_party.proto.
  export interface IRecentTranscript {
    speaker_user_id: string;
    is_agent:        boolean;
    text:            string;
    start_ts_ms:     number;
    end_ts_ms:       number;
    final:           boolean;
    locale:          string;
  }

  export interface IRoomSettings {
    max_members:           number;
    speaker_floor_seconds: number;
    speaker_queue_cap:     number;
    reaction_rate_per_sec: number;
    chat_rate_per_sec:     number;
    allow_text_chat:       boolean;
    allow_agents:          boolean;
    max_agents:            number;
    moderation_enabled:    boolean;
    transcript_enabled:    boolean;
    default_voice_mode:    string;  // "broadcast" | "spatial" | "ptt"
    anyone_can_topic:      boolean;
    transcript_history:    number;  // capped count for snapshots
    voice_room_id:         string;  // logical room id for IIVXVoice provider
    voice_provider:        string;  // "livekit" | "agora" | "twilio" | "dolby" | "none"
  }

  export var DefaultInit: IRoomSettings = {
    max_members:           24,
    speaker_floor_seconds: 60,
    speaker_queue_cap:     50,
    reaction_rate_per_sec: 5,
    chat_rate_per_sec:     5,
    allow_text_chat:       true,
    allow_agents:          true,
    max_agents:            4,
    moderation_enabled:    true,
    transcript_enabled:    true,
    default_voice_mode:    "spatial",
    anyone_can_topic:      false,
    transcript_history:    50,
    voice_room_id:         "",
    voice_provider:        "livekit"
  };

  export interface IMember {
    user_id:           string;
    is_agent:          boolean;
    role:              "host" | "moderator" | "speaker" | "listener";
    joined_unix_ms:    number;
    last_seen_unix_ms: number;
    online:            boolean;
    muted_self:        boolean;
    muted_by_kernel:   boolean;
    hand_raised:       boolean;
    voice_mode:        string;  // per-member override; falls back to default
  }

  export interface IRateBucket {
    bucket_unix_s: number;
    count:         number;
  }

  export interface ISpeakerGrant {
    user_id:        string;
    granted_unix_ms: number;
    expires_unix_ms: number;
  }

  export interface IState {
    init:                  IRoomSettings;
    members:               { [u: string]: IMember };
    presences:             { [u: string]: { online: boolean; reaction_bucket: IRateBucket; chat_bucket: IRateBucket } };
    speaker_queue:         string[];  // FIFO of user_ids waiting for the floor
    current_grant:         ISpeakerGrant | null;
    topic:                 string;
    pinned_messages:       string[];
    transcript_history:    IRecentTranscript[];
    started_unix_ms:       number;
    last_idle_check_ms:    number;
    last_nonzero_presence_unix_ms: number;
    creator_user_id:       string;
    pending_end_reason:    string;
    outbound_seq:          number;
    matchId:               string;
  }

  function mergeInit(params: any): IRoomSettings {
    var out: any = {};
    for (var k in DefaultInit) if (DefaultInit.hasOwnProperty(k)) out[k] = (DefaultInit as any)[k];
    if (params) for (var k2 in params) if (params.hasOwnProperty(k2)) out[k2] = params[k2];
    // Hard guards.
    if (out.max_members < 2) out.max_members = 2;
    if (out.max_members > 64) out.max_members = 64;
    if (out.speaker_floor_seconds < 5) out.speaker_floor_seconds = 5;
    if (out.speaker_floor_seconds > 600) out.speaker_floor_seconds = 600;
    if (out.speaker_queue_cap < 1) out.speaker_queue_cap = 1;
    if (out.speaker_queue_cap > 1000) out.speaker_queue_cap = 1000;
    if (out.reaction_rate_per_sec < 1) out.reaction_rate_per_sec = 1;
    if (out.reaction_rate_per_sec > 60) out.reaction_rate_per_sec = 60;
    if (out.chat_rate_per_sec < 1) out.chat_rate_per_sec = 1;
    if (out.chat_rate_per_sec > 60) out.chat_rate_per_sec = 60;
    if (out.transcript_history < 0) out.transcript_history = 0;
    if (out.transcript_history > 500) out.transcript_history = 500;
    return out as IRoomSettings;
  }

  function isAgent(userId: string): boolean {
    return typeof userId === "string" && userId.length >= 4 && userId.substring(0, 4) === "agt_";
  }

  function memberCount(s: IState): number {
    var c = 0; for (var u in s.members) c++; return c;
  }
  function agentCount(s: IState): number {
    var c = 0; for (var u in s.members) if (s.members[u].is_agent) c++; return c;
  }

  export var template: MpKernel.IMatchTemplate<IState> = {
    templateId: "conversational-party-v1",
    opRange: { from: 0x1000, to: 0x1FFF },
    defaultInit: DefaultInit,

    initState: function (ctx, _logger, _nk, params) {
      var init = mergeInit(params.template_init);
      var matchId = (ctx as any).matchId || "";
      var nowMs = Date.now();
      var s: IState = {
        init: init,
        members: {},
        presences: {},
        speaker_queue: [],
        current_grant: null,
        topic: "",
        pinned_messages: [],
        transcript_history: [],
        started_unix_ms: nowMs,
        last_idle_check_ms: nowMs,
        last_nonzero_presence_unix_ms: nowMs,
        creator_user_id: params.creator_user_id || "",
        pending_end_reason: "",
        outbound_seq: 1,
        matchId: matchId
      };
      // Creator becomes the host; kept synchronous so first speaker grant
      // doesn't race with the first join.
      if (s.creator_user_id) {
        s.members[s.creator_user_id] = {
          user_id:           s.creator_user_id,
          is_agent:          isAgent(s.creator_user_id),
          role:              "host",
          joined_unix_ms:    nowMs,
          last_seen_unix_ms: nowMs,
          online:            false,
          muted_self:        false,
          muted_by_kernel:   false,
          hand_raised:       false,
          voice_mode:        init.default_voice_mode
        };
      }
      var label = JSON.stringify({
        template_id: template.templateId,
        game_id: params.game_id,
        max_members: init.max_members,
        agents: init.allow_agents,
        voice_provider: init.voice_provider,
        voice_room_id: init.voice_room_id || matchId
      });
      // 4 Hz tick — voice rooms are mostly event-driven; the loop just
      // expires speaker floors and drains messages.
      return { state: s, tickRate: 4, label: label };
    },

    onJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presence, _metadata) {
      var s = state as IState;
      var u = presence.userId;
      var isA = isAgent(u);
      // Capacity by member slots, not live presences.
      if (!s.members[u]) {
        if (memberCount(s) >= s.init.max_members) {
          return { state: s, accept: false, rejectMessage: "room full" };
        }
        if (isA) {
          if (!s.init.allow_agents) {
            return { state: s, accept: false, rejectMessage: "agents disabled" };
          }
          if (agentCount(s) >= s.init.max_agents) {
            return { state: s, accept: false, rejectMessage: "agent cap reached" };
          }
        }
      }
      return { state: s, accept: true };
    },

    onJoin: function (_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
      var s = state as IState;
      var nowMs = Date.now();
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        var u = p.userId;
        if (!s.members[u]) {
          s.members[u] = {
            user_id:           u,
            is_agent:          isAgent(u),
            role:              s.creator_user_id === u ? "host" : "listener",
            joined_unix_ms:    nowMs,
            last_seen_unix_ms: nowMs,
            online:            true,
            muted_self:        false,
            muted_by_kernel:   false,
            hand_raised:       false,
            voice_mode:        s.init.default_voice_mode
          };
        } else {
          s.members[u].online = true;
          s.members[u].last_seen_unix_ms = nowMs;
        }
        if (!s.presences[u]) {
          s.presences[u] = {
            online: true,
            reaction_bucket: { bucket_unix_s: 0, count: 0 },
            chat_bucket:     { bucket_unix_s: 0, count: 0 }
          };
        } else {
          s.presences[u].online = true;
        }
        s.last_nonzero_presence_unix_ms = nowMs;
        // Send the joiner a complete RoomSnapshot so they don't see a
        // half-rendered room while late events trickle in.
        sendSnapshot(s, dispatcher, p);
      }
      return { state: s };
    },

    onLeave: function (_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
      var s = state as IState;
      var nowMs = Date.now();
      for (var i = 0; i < presences.length; i++) {
        var u = presences[i].userId;
        if (s.presences[u]) s.presences[u].online = false;
        var m = s.members[u];
        if (m) {
          m.online = false;
          m.last_seen_unix_ms = nowMs;
        }
        // If the leaver held the floor, revoke + advance the queue.
        if (s.current_grant && s.current_grant.user_id === u) {
          s.current_grant = null;
          broadcastTemplate(s, dispatcher, Op.SPEAKER_REVOKE, {
            user_id: u, reason: "voluntary"
          });
          advanceSpeakerQueue(s, dispatcher, nowMs);
        }
        // Lower their hand if raised.
        if (m && m.hand_raised) {
          m.hand_raised = false;
          removeFromQueue(s, u);
          broadcastTemplate(s, dispatcher, Op.HAND_LOWER, { user_id: u });
        }
      }
      return { state: s };
    },

    onLoop: function (_ctx, logger, _nk, dispatcher, _tick, state, messages) {
      var s = state as IState;
      var nowMs = Date.now();

      // 1. Drain inbound. Pre-validation happens at the kernel layer; here
      //    we trust m.opCode is in our range and m.sender is authentic.
      for (var i = 0; i < messages.length; i++) {
        applyInbound(s, messages[i], dispatcher, nowMs, logger);
      }

      // 2. Speaker floor expiry.
      if (s.current_grant && s.current_grant.expires_unix_ms <= nowMs) {
        var expired = s.current_grant.user_id;
        s.current_grant = null;
        broadcastTemplate(s, dispatcher, Op.SPEAKER_REVOKE, {
          user_id: expired, reason: "time_up"
        });
        advanceSpeakerQueue(s, dispatcher, nowMs);
      }

      // 3. Idle termination — only if no live presences for 10 minutes
      //    AND no agents (an unattended agent room becomes ghosty).
      var live = 0; for (var u in s.presences) if (s.presences[u].online) live++;
      if (live > 0) s.last_nonzero_presence_unix_ms = nowMs;
      else if (nowMs - s.last_nonzero_presence_unix_ms > 10 * 60 * 1000) {
        s.pending_end_reason = "idle_terminate";
        return endMatch(s, dispatcher, MpKernel.EndReason.COMPLETED);
      }

      if (s.pending_end_reason !== "") {
        return endMatch(s, dispatcher, MpKernel.EndReason.COMPLETED);
      }
      return { state: s };
    },

    onTerminate: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _grace) {
      return { state: state };
    },

    buildResult: function (state, reason) {
      var s = state as IState;
      var outcomes: MpKernel.IPlayerOutcome[] = [];
      for (var u in s.members) {
        var m = s.members[u];
        outcomes.push({
          user_id:    u,
          is_agent:   m.is_agent,
          placement:  0,
          score:      0,
          completed:  true,
          left_early: false,
          game_payload: { role: m.role, last_seen_unix_ms: m.last_seen_unix_ms }
        });
      }
      return {
        match_id: s.matchId,
        template_id: template.templateId,
        game_id: "",
        started_unix_ms: s.started_unix_ms,
        ended_unix_ms: 0,
        duration_ms: 0,
        outcomes: outcomes,
        game_payload: {
          end_reason: reason,
          topic: s.topic,
          transcript_count: s.transcript_history.length,
          host: s.creator_user_id
        }
      };
    }
  };

  // ---- inbound handling ----

  function applyInbound(
    s: IState,
    m: nkruntime.MatchMessage,
    dispatcher: nkruntime.MatchDispatcher,
    nowMs: number,
    logger: nkruntime.Logger
  ): void {
    var raw = (typeof m.data === "string") ? m.data : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
    if (!raw) return;
    var parsed: any;
    try { parsed = JSON.parse(raw); } catch (_e) {
      sendError(s, dispatcher, m.sender.userId, MpKernel.ErrorCode.BAD_PAYLOAD, "invalid envelope");
      return;
    }
    var p = parsed.p || {};
    var sender = m.sender.userId;
    var sm = s.members[sender];
    if (!sm) {
      // Not-a-member: silently drop. Should never happen since presence
      // implies membership, but guard against split-brain races.
      return;
    }
    sm.last_seen_unix_ms = nowMs;

    switch (m.opCode) {
      case Op.SPEAKER_REQUEST: handleSpeakerRequest(s, dispatcher, sender, p, nowMs); break;
      case Op.SPEAKER_REVOKE:  handleSpeakerRevoke(s, dispatcher, sender, p, nowMs); break;
      case Op.MUTE_SELF:       handleMuteSelf(s, dispatcher, sender, p); break;
      case Op.REACTION:        handleReaction(s, dispatcher, sender, p, nowMs); break;
      case Op.TEXT_CHAT:       handleTextChat(s, dispatcher, sender, p, nowMs); break;
      case Op.TOPIC_SET:       handleTopicSet(s, dispatcher, sender, p); break;
      case Op.PIN_MESSAGE:     handlePinMessage(s, dispatcher, sender, p); break;
      case Op.TRANSCRIPT_CHUNK:handleTranscriptChunk(s, dispatcher, sender, p, nowMs, logger); break;
      case Op.VOICE_MODE:      handleVoiceMode(s, dispatcher, sender, p); break;
      case Op.HAND_LOWER:      handleHandLower(s, dispatcher, sender, p); break;
      default:
        // Unknown opcode in our range — ignore silently.
    }
  }

  // ---- handlers ----

  function handleSpeakerRequest(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any, nowMs: number
  ): void {
    var sm = s.members[sender];
    // If queue full, RATE_LIMITED.
    if (s.speaker_queue.length >= s.init.speaker_queue_cap) {
      sendError(s, dispatcher, sender, MpKernel.ErrorCode.RATE_LIMITED, "speaker queue full");
      return;
    }
    if (s.current_grant && s.current_grant.user_id === sender) {
      // Already speaking; ignore.
      return;
    }
    // Already in queue? ignore (idempotent).
    for (var i = 0; i < s.speaker_queue.length; i++) {
      if (s.speaker_queue[i] === sender) return;
    }
    s.speaker_queue.push(sender);
    sm.hand_raised = true;
    // If no current grant, immediately promote.
    if (!s.current_grant) {
      advanceSpeakerQueue(s, dispatcher, nowMs);
    } else {
      // Tell sender their position.
      sendUnicast(s, dispatcher, sender, Op.SPEAKER_GRANT, {
        user_id: sender,
        floor_seconds: 0,
        queue_position: s.speaker_queue.length,
        topic_hint: typeof p.topic_hint === "string" ? p.topic_hint : ""
      });
    }
  }

  function handleSpeakerRevoke(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any, nowMs: number
  ): void {
    // Two cases: voluntary (sender == current speaker) or moderator forces.
    var sm = s.members[sender];
    var target = (typeof p.user_id === "string" && p.user_id) ? p.user_id : sender;
    if (target !== sender) {
      // Moderator-initiated revoke.
      if (sm.role !== "host" && sm.role !== "moderator") {
        sendError(s, dispatcher, sender, MpKernel.ErrorCode.PERMISSION_DENIED, "not a moderator");
        return;
      }
    }
    if (s.current_grant && s.current_grant.user_id === target) {
      var reason = (target === sender) ? "voluntary" : "moderated";
      s.current_grant = null;
      broadcastTemplate(s, dispatcher, Op.SPEAKER_REVOKE, {
        user_id: target, reason: reason
      });
      advanceSpeakerQueue(s, dispatcher, nowMs);
    } else {
      // Removing from queue if waiting.
      removeFromQueue(s, target);
      var sm2 = s.members[target];
      if (sm2) sm2.hand_raised = false;
      broadcastTemplate(s, dispatcher, Op.HAND_LOWER, { user_id: target });
    }
  }

  function handleMuteSelf(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any
  ): void {
    var sm = s.members[sender];
    sm.muted_self = !!p.muted;
    broadcastTemplate(s, dispatcher, Op.MUTE_SELF, {
      user_id: sender, muted: sm.muted_self
    });
  }

  function handleReaction(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any, nowMs: number
  ): void {
    var pres = s.presences[sender];
    var nowS = Math.floor(nowMs / 1000);
    if (pres.reaction_bucket.bucket_unix_s !== nowS) {
      pres.reaction_bucket.bucket_unix_s = nowS;
      pres.reaction_bucket.count = 0;
    }
    if (pres.reaction_bucket.count >= s.init.reaction_rate_per_sec) {
      sendError(s, dispatcher, sender, MpKernel.ErrorCode.RATE_LIMITED, "reaction rate-limited");
      return;
    }
    pres.reaction_bucket.count++;
    var reactionId = (typeof p.reaction_id === "number") ? (p.reaction_id | 0) : 0;
    var emoji = (typeof p.emoji === "string") ? p.emoji.substring(0, 16) : "";
    broadcastTemplate(s, dispatcher, Op.REACTION, {
      user_id: sender, reaction_id: reactionId, emoji: emoji, ts_ms: nowMs
    });
  }

  function handleTextChat(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any, nowMs: number
  ): void {
    if (!s.init.allow_text_chat) return;
    var pres = s.presences[sender];
    var nowS = Math.floor(nowMs / 1000);
    if (pres.chat_bucket.bucket_unix_s !== nowS) {
      pres.chat_bucket.bucket_unix_s = nowS;
      pres.chat_bucket.count = 0;
    }
    if (pres.chat_bucket.count >= s.init.chat_rate_per_sec) {
      sendError(s, dispatcher, sender, MpKernel.ErrorCode.RATE_LIMITED, "chat rate-limited");
      return;
    }
    pres.chat_bucket.count++;
    var text = (typeof p.text === "string") ? p.text.substring(0, 1000) : "";
    var clientUuid = (typeof p.client_uuid === "string") ? p.client_uuid.substring(0, 64) : "";
    broadcastTemplate(s, dispatcher, Op.TEXT_CHAT, {
      user_id: sender, text: text, client_uuid: clientUuid, ts_ms: nowMs
    });
  }

  function handleTopicSet(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any
  ): void {
    var sm = s.members[sender];
    if (!s.init.anyone_can_topic && sm.role !== "host" && sm.role !== "moderator") {
      sendError(s, dispatcher, sender, MpKernel.ErrorCode.PERMISSION_DENIED, "topic set: not a moderator");
      return;
    }
    var topic = (typeof p.topic === "string") ? p.topic.substring(0, 200) : "";
    s.topic = topic;
    broadcastTemplate(s, dispatcher, Op.TOPIC_SET, {
      topic: topic, set_by: sender
    });
  }

  function handlePinMessage(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any
  ): void {
    var sm = s.members[sender];
    if (sm.role !== "host" && sm.role !== "moderator") {
      sendError(s, dispatcher, sender, MpKernel.ErrorCode.PERMISSION_DENIED, "pin: not a moderator");
      return;
    }
    var msgId = (typeof p.message_id === "string") ? p.message_id.substring(0, 64) : "";
    if (!msgId) return;
    var pin = !!p.pinned;
    var idx = s.pinned_messages.indexOf(msgId);
    if (pin && idx === -1) {
      s.pinned_messages.push(msgId);
      if (s.pinned_messages.length > 3) s.pinned_messages.shift();
    } else if (!pin && idx !== -1) {
      s.pinned_messages.splice(idx, 1);
    }
    broadcastTemplate(s, dispatcher, Op.PIN_MESSAGE, {
      message_id: msgId, user_id: sender, pinned: pin
    });
  }

  function handleTranscriptChunk(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any, nowMs: number, logger: nkruntime.Logger
  ): void {
    if (!s.init.transcript_enabled) return;
    var sm = s.members[sender];
    // Authority: a transcript chunk's `speaker_user_id` MUST equal sender,
    // unless the sender is the host emitting an out-of-band agent transcript
    // (used by the IIVXAgent kernel service to publish on behalf of agents).
    var speaker = (typeof p.speaker_user_id === "string") ? p.speaker_user_id : sender;
    if (speaker !== sender && sm.role !== "host" && sm.role !== "moderator") {
      sendError(s, dispatcher, sender, MpKernel.ErrorCode.NOT_AUTHORIZED, "transcript: speaker_user_id != sender");
      return;
    }
    var chunk: IRecentTranscript = {
      speaker_user_id: speaker,
      is_agent:        !!p.is_agent || isAgent(speaker),
      text:            (typeof p.text === "string") ? p.text.substring(0, 4000) : "",
      start_ts_ms:     (typeof p.start_ts_ms === "number") ? p.start_ts_ms : nowMs,
      end_ts_ms:       (typeof p.end_ts_ms === "number") ? p.end_ts_ms : nowMs,
      final:           !!p.final,
      locale:          (typeof p.locale === "string") ? p.locale.substring(0, 16) : ""
    };
    // Final chunk evicts any matching interim chunk.
    if (chunk.final) {
      for (var i = s.transcript_history.length - 1; i >= 0; i--) {
        var ex = s.transcript_history[i];
        if (!ex.final && ex.speaker_user_id === chunk.speaker_user_id &&
            ex.start_ts_ms === chunk.start_ts_ms) {
          s.transcript_history.splice(i, 1);
        }
      }
    }
    s.transcript_history.push(chunk);
    if (s.transcript_history.length > s.init.transcript_history) {
      // Drop oldest.
      var over = s.transcript_history.length - s.init.transcript_history;
      s.transcript_history.splice(0, over);
    }
    broadcastTemplate(s, dispatcher, Op.TRANSCRIPT_CHUNK, chunk);
    if (s.init.moderation_enabled) {
      // Note: we publish to the moderation pipeline via a kernel hook —
      // see multiplayer-kernel/services/moderation.ts. v1 fires-and-forgets.
      try {
        if (typeof (MpKernel as any).enqueueModeration === "function") {
          (MpKernel as any).enqueueModeration({
            scope: "conversational_party",
            match_id: s.matchId,
            speaker_user_id: speaker,
            text: chunk.text,
            ts_ms: nowMs
          });
        }
      } catch (e: any) {
        logger.debug("[ConvParty] moderation hook missing: " +
          ((e && e.message) ? e.message : String(e)));
      }
    }
  }

  function handleVoiceMode(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any
  ): void {
    var sm = s.members[sender];
    var mode = (typeof p.voice_mode === "string") ? p.voice_mode : s.init.default_voice_mode;
    if (mode !== "broadcast" && mode !== "spatial" && mode !== "ptt" && mode !== "off") {
      sendError(s, dispatcher, sender, MpKernel.ErrorCode.BAD_PAYLOAD, "voice_mode: bad value");
      return;
    }
    sm.voice_mode = mode;
    broadcastTemplate(s, dispatcher, Op.VOICE_MODE, {
      user_id: sender, voice_mode: mode
    });
  }

  function handleHandLower(
    s: IState, dispatcher: nkruntime.MatchDispatcher,
    sender: string, p: any
  ): void {
    var target = (typeof p.user_id === "string" && p.user_id) ? p.user_id : sender;
    var sm = s.members[sender];
    if (target !== sender) {
      // Only a moderator can lower someone else's hand.
      if (sm.role !== "host" && sm.role !== "moderator") {
        sendError(s, dispatcher, sender, MpKernel.ErrorCode.PERMISSION_DENIED, "hand_lower: not a moderator");
        return;
      }
    }
    var t = s.members[target];
    if (!t) return;
    t.hand_raised = false;
    removeFromQueue(s, target);
    broadcastTemplate(s, dispatcher, Op.HAND_LOWER, { user_id: target });
  }

  // ---- speaker queue mechanics ----

  function advanceSpeakerQueue(s: IState, dispatcher: nkruntime.MatchDispatcher, nowMs: number): void {
    while (s.speaker_queue.length > 0 && !s.current_grant) {
      var next = s.speaker_queue.shift();
      if (!next) break;
      var nm = s.members[next];
      // Skip offline / kicked / muted-by-kernel members.
      if (!nm || !nm.online || nm.muted_by_kernel) continue;
      var grant: ISpeakerGrant = {
        user_id: next,
        granted_unix_ms: nowMs,
        expires_unix_ms: nowMs + s.init.speaker_floor_seconds * 1000
      };
      s.current_grant = grant;
      nm.hand_raised = false;
      broadcastTemplate(s, dispatcher, Op.SPEAKER_GRANT, {
        user_id: next,
        floor_seconds: s.init.speaker_floor_seconds,
        queue_position: 0
      });
      return;
    }
  }

  function removeFromQueue(s: IState, userId: string): void {
    for (var i = 0; i < s.speaker_queue.length; i++) {
      if (s.speaker_queue[i] === userId) {
        s.speaker_queue.splice(i, 1);
        return;
      }
    }
  }

  // ---- snapshot / fan-out helpers ----

  function sendSnapshot(s: IState, dispatcher: nkruntime.MatchDispatcher, target: nkruntime.Presence): void {
    var members: any[] = [];
    for (var u in s.members) {
      var m = s.members[u];
      members.push({
        user_id: u,
        is_agent: m.is_agent,
        role: m.role,
        online: m.online,
        muted_self: m.muted_self,
        hand_raised: m.hand_raised,
        voice_mode: m.voice_mode
      });
    }
    var snap = {
      members:                 members,
      speaker_queue:           s.speaker_queue.slice(),
      current_speaker_user_id: s.current_grant ? s.current_grant.user_id : "",
      topic:                   s.topic,
      recent_transcript:       s.transcript_history.slice(-Math.min(20, s.transcript_history.length)),
      moderators:              moderatorIds(s),
      pinned_messages:         s.pinned_messages.slice(),
      voice_room_id:           s.init.voice_room_id || s.matchId,
      voice_provider:          s.init.voice_provider,
      schema_version:          1
    };
    sendUnicast(s, dispatcher, target.userId, Op.ROOM_SNAPSHOT, snap);
  }

  function moderatorIds(s: IState): string[] {
    var out: string[] = [];
    for (var u in s.members) {
      var m = s.members[u];
      if (m.role === "host" || m.role === "moderator") out.push(u);
    }
    return out;
  }

  function broadcastTemplate(s: IState, dispatcher: nkruntime.MatchDispatcher, op: number, payload: any): void {
    var env = {
      h: {
        wire_version: 1, op: op,
        seq: s.outbound_seq++,
        match_time_ms: Date.now() - s.started_unix_ms,
        sender_user_id: "server",
        match_id: s.matchId,
        client_opcode_uuid: ""
      },
      p: payload
    };
    dispatcher.broadcastMessage(op, JSON.stringify(env));
  }

  function sendUnicast(s: IState, dispatcher: nkruntime.MatchDispatcher, userId: string, op: number, payload: any): void {
    var env = {
      h: {
        wire_version: 1, op: op,
        seq: s.outbound_seq++,
        match_time_ms: Date.now() - s.started_unix_ms,
        sender_user_id: "server",
        match_id: s.matchId,
        client_opcode_uuid: ""
      },
      p: payload
    };
    dispatcher.broadcastMessage(op, JSON.stringify(env), [{
      userId: userId, sessionId: "", username: "", node: ""
    } as any]);
  }

  function sendError(s: IState, dispatcher: nkruntime.MatchDispatcher, userId: string, code: number, detail: string): void {
    sendUnicast(s, dispatcher, userId, MpKernel.KernelOp.ERROR, {
      code: code, detail: detail
    });
  }

  function endMatch(s: IState, dispatcher: nkruntime.MatchDispatcher, reasonEnum: number): null {
    var resultEnvelope: MpKernel.IMatchResultEnvelope | null = null;
    if (template.buildResult) {
      var built = template.buildResult(s, s.pending_end_reason || "completed");
      if (built) {
        built.match_id = s.matchId;
        if (!built.started_unix_ms) built.started_unix_ms = s.started_unix_ms;
        resultEnvelope = built;
      }
    }
    broadcastTemplate(s, dispatcher, MpKernel.KernelOp.MATCH_ENDED, {
      reason: reasonEnum,
      result_envelope: resultEnvelope
    });
    return null;
  }
}
