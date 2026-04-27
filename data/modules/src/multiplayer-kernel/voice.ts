// IIVXVoice — kernel-side helpers used by every template that opens a voice
// surface (ConvParty, AvatarReplication, MR Anchor). Audio bytes never enter
// the kernel; we mint short-lived bearer tokens against the configured
// provider, then broadcast speaker state, voice levels, and moderation
// decisions over the kernel wire.
//
// Wire contract: schemas/multiplayer/services/voice.proto.
//
// Provider plumbing lives outside this file (`/data/modules/src/multiplayer-kernel/voice-providers/`)
// so games can compile the kernel without LiveKit/Agora deps if voiceless.
namespace MpKernelVoice {

  export var Provider = {
    UNSPECIFIED: 0,
    LIVEKIT:     1,
    AGORA:       2,
    TWILIO:      3,
    DOLBY:       4,
    NONE:        5
  };

  export var Mode = {
    OFF:        0,
    BROADCAST:  1,
    SPATIAL:    2,
    PTT:        3
  };

  export var Codec = {
    UNSPECIFIED: 0,
    OPUS:        1,
    AAC:         2
  };

  // Default lifetimes, conservative — provider tokens are bearer credentials.
  export var DEFAULT_TOKEN_TTL_MS = 60_000;
  export var DEFAULT_FLOOR_SECONDS = 60;
  export var DEFAULT_MAX_PUBLISHERS = 16;
  export var DEFAULT_VAD_BROADCAST_HZ = 4; // 4 Hz crowd meter

  export interface ISessionToken {
    provider: number;
    token: string;
    room_id: string;
    identity: string;
    url: string;
    expires_at_ms: number;
    can_publish: boolean;
    can_subscribe: boolean;
    spatial: boolean;
    region: string;
    provider_opts?: { [k: string]: string };
  }

  export interface ICapability {
    can_publish: boolean;
    can_subscribe: boolean;
    can_spatial: boolean;
    codecs: number[];
    max_publishers: number;
    can_change_provider: boolean;
    can_passthrough_external: boolean;
    ptt_supported: boolean;
    broadcast_supported: boolean;
    spatial_supported: boolean;
  }

  // ---------- Capability negotiation ----------

  export function intersectCapabilities(caps: ICapability[]): ICapability {
    if (!caps || caps.length === 0) {
      return {
        can_publish: false, can_subscribe: false, can_spatial: false,
        codecs: [], max_publishers: 0, can_change_provider: false,
        can_passthrough_external: false,
        ptt_supported: false, broadcast_supported: false, spatial_supported: false
      };
    }
    var pub = true, sub = true, spat = true, ptt = true, bcast = true, sptl = true;
    var passthrough = true, change = true;
    var maxPub = 1024;
    var codecCount: { [c: number]: number } = {};
    for (var i = 0; i < caps.length; i++) {
      var c = caps[i];
      pub = pub && c.can_publish;
      sub = sub && c.can_subscribe;
      spat = spat && c.can_spatial;
      ptt = ptt && c.ptt_supported;
      bcast = bcast && c.broadcast_supported;
      sptl = sptl && c.spatial_supported;
      passthrough = passthrough && c.can_passthrough_external;
      change = change && c.can_change_provider;
      if (c.max_publishers && c.max_publishers < maxPub) maxPub = c.max_publishers;
      if (c.codecs) {
        for (var j = 0; j < c.codecs.length; j++) {
          codecCount[c.codecs[j]] = (codecCount[c.codecs[j]] || 0) + 1;
        }
      }
    }
    var commonCodecs: number[] = [];
    for (var k in codecCount) {
      if (codecCount[k] === caps.length) commonCodecs.push(parseInt(k, 10));
    }
    if (commonCodecs.length === 0) commonCodecs = [Codec.OPUS]; // safe default
    return {
      can_publish: pub, can_subscribe: sub, can_spatial: spat,
      codecs: commonCodecs,
      max_publishers: maxPub === 1024 ? DEFAULT_MAX_PUBLISHERS : maxPub,
      can_change_provider: change, can_passthrough_external: passthrough,
      ptt_supported: ptt, broadcast_supported: bcast, spatial_supported: sptl
    };
  }

  export function pickInitialMode(req: number, cap: ICapability): number {
    if (req === Mode.SPATIAL && cap.spatial_supported) return Mode.SPATIAL;
    if (req === Mode.PTT && cap.ptt_supported) return Mode.PTT;
    if (req === Mode.BROADCAST && cap.broadcast_supported) return Mode.BROADCAST;
    // Fallback chain: spatial -> broadcast -> ptt -> off
    if (cap.spatial_supported) return Mode.SPATIAL;
    if (cap.broadcast_supported) return Mode.BROADCAST;
    if (cap.ptt_supported) return Mode.PTT;
    return Mode.OFF;
  }

  // ---------- Speaker queue (server-side floor management) ----------

  export interface IFloorState {
    current_speaker_user_id: string;
    started_ms: number;
    floor_seconds: number;
    queue: { user_id: string; topic_hint: string; queued_ms: number }[];
    queue_cap: number;
  }

  export function newFloorState(queueCap: number): IFloorState {
    return {
      current_speaker_user_id: "",
      started_ms: 0,
      floor_seconds: 0,
      queue: [],
      queue_cap: queueCap || 50
    };
  }

  // returns true if request was queued (or granted immediately).
  export function requestSpeaker(state: IFloorState, userId: string, topicHint: string, floorSeconds: number, nowMs: number): { granted: boolean; queued: boolean; position: number } {
    // Already on the floor?
    if (state.current_speaker_user_id === userId) {
      return { granted: true, queued: false, position: 0 };
    }
    // Already queued?
    for (var i = 0; i < state.queue.length; i++) {
      if (state.queue[i].user_id === userId) {
        return { granted: false, queued: true, position: i + 1 };
      }
    }
    // Queue full?
    if (state.queue.length >= state.queue_cap) {
      return { granted: false, queued: false, position: -1 };
    }
    // No current speaker and queue empty -> grant.
    if (!state.current_speaker_user_id && state.queue.length === 0) {
      state.current_speaker_user_id = userId;
      state.started_ms = nowMs;
      state.floor_seconds = floorSeconds;
      return { granted: true, queued: false, position: 0 };
    }
    state.queue.push({ user_id: userId, topic_hint: topicHint || "", queued_ms: nowMs });
    return { granted: false, queued: true, position: state.queue.length };
  }

  export function releaseSpeaker(state: IFloorState, userId: string, nowMs: number): { newSpeaker: string } {
    if (state.current_speaker_user_id !== userId) {
      // Drop from queue if present.
      for (var i = 0; i < state.queue.length; i++) {
        if (state.queue[i].user_id === userId) {
          state.queue.splice(i, 1);
          break;
        }
      }
      return { newSpeaker: state.current_speaker_user_id };
    }
    // Pop next from queue.
    if (state.queue.length === 0) {
      state.current_speaker_user_id = "";
      state.started_ms = 0;
      state.floor_seconds = 0;
      return { newSpeaker: "" };
    }
    var next = state.queue.shift()!;
    state.current_speaker_user_id = next.user_id;
    state.started_ms = nowMs;
    state.floor_seconds = state.floor_seconds; // keep configured length
    return { newSpeaker: next.user_id };
  }

  // Drives floor expiry on each tick.
  export function checkFloorExpiry(state: IFloorState, nowMs: number): { expired: boolean; user: string } {
    if (!state.current_speaker_user_id) return { expired: false, user: "" };
    if (!state.floor_seconds) return { expired: false, user: "" };
    var elapsedMs = nowMs - state.started_ms;
    if (elapsedMs >= state.floor_seconds * 1000) {
      var user = state.current_speaker_user_id;
      releaseSpeaker(state, user, nowMs);
      return { expired: true, user: user };
    }
    return { expired: false, user: "" };
  }

  // ---------- Token helper (provider-agnostic shape) ----------
  // Concrete token signing happens in voice-providers/<provider>.ts.
  // Templates call `mintToken` with a provider-installed callback.
  export interface ITokenMinter {
    name: string; // "livekit", "agora", ...
    mint(args: {
      roomId: string;
      identity: string;
      canPublish: boolean;
      canSubscribe: boolean;
      spatial: boolean;
      ttlMs: number;
      region: string;
    }): { token: string; url: string; opts?: { [k: string]: string } };
  }

  export function mintToken(
    minter: ITokenMinter | null,
    matchId: string,
    userId: string,
    canPublish: boolean,
    canSubscribe: boolean,
    spatial: boolean,
    region: string,
    nowMs: number
  ): ISessionToken {
    if (!minter) {
      // No provider configured — return a "none" token so adapters can run
      // gracefully in voiceless mode.
      return {
        provider: Provider.NONE,
        token: "",
        room_id: matchId,
        identity: userId,
        url: "",
        expires_at_ms: nowMs + DEFAULT_TOKEN_TTL_MS,
        can_publish: false, can_subscribe: false, spatial: false,
        region: region
      };
    }
    var ttl = DEFAULT_TOKEN_TTL_MS;
    var minted = minter.mint({
      roomId: matchId, identity: userId,
      canPublish: canPublish, canSubscribe: canSubscribe, spatial: spatial,
      ttlMs: ttl, region: region
    });
    var providerCode = Provider.UNSPECIFIED;
    switch (minter.name) {
      case "livekit": providerCode = Provider.LIVEKIT; break;
      case "agora":   providerCode = Provider.AGORA; break;
      case "twilio":  providerCode = Provider.TWILIO; break;
      case "dolby":   providerCode = Provider.DOLBY; break;
      default:        providerCode = Provider.UNSPECIFIED; break;
    }
    return {
      provider: providerCode,
      token: minted.token,
      room_id: matchId, identity: userId, url: minted.url,
      expires_at_ms: nowMs + ttl,
      can_publish: canPublish, can_subscribe: canSubscribe, spatial: spatial,
      region: region,
      provider_opts: minted.opts
    };
  }
}
