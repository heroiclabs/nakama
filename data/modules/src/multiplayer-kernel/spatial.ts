// SpatialFrame service — kernel-side bookkeeping of a match's active
// SpatialFrame and per-presence resolve status. XR templates
// (AvatarReplicationMatch, MixedRealityAnchorMatch, ConvParty spatial voice)
// embed an MpKernelSpatial.IFrameState in their match state and route
// frame opcodes through these helpers so the bookkeeping is uniform.
//
// Wire contract: see `schemas/multiplayer/services/spatial.proto`.
//
// Lifecycle:
//
//   1. Match init picks an initial frame using NegotiateFrame() against
//      the joiner's SpatialCapability.
//   2. Host (or kernel under load) may issue SpatialFrameOffer; presences
//      ack with SpatialFrameAck.
//   3. When the kernel sees acks from `min_acks_to_switch` presences (or
//      offer timeout fires with `accept_partial=true`), it broadcasts
//      SpatialFrameSwitched and clamps subsequent pose messages to the
//      new frame_id.

namespace MpKernelSpatial {

  export var Kind = {
    UNSPECIFIED:    0,
    KERNEL_WORLD:   1,
    CLOUD_ANCHOR:   2,
    QR_MARKER:      3,
    IMAGE_MARKER:   4,
    LOCAL_FLOOR:    5,
    PCVR_PSEUDO:    6
  };

  // Default fallback chain when negotiation reduces capabilities.
  // Higher = preferred. Listed in order; we pick the first the room+all
  // joiners support.
  export var FALLBACK_CHAIN: number[] = [
    Kind.CLOUD_ANCHOR,
    Kind.QR_MARKER,
    Kind.IMAGE_MARKER,
    Kind.PCVR_PSEUDO,
    Kind.LOCAL_FLOOR,
    Kind.KERNEL_WORLD
  ];

  export interface IFrame {
    frame_id: string;
    kind: number;          // Kind.*
    provider: string;
    vendor_token: string;
    payload?: string;      // base64 (optional, for QR/image bytes)
    issued_ms: number;
    region: string;
    floor_height_m: number;
    forward_yaw_deg: number;
    relocalize_grace_ms: number;
  }

  export interface ICapability {
    supported_frames: number[];
    can_publish_anchor: boolean;
    can_resolve_cloud_anchor: boolean;
    can_print_qr: boolean;
    can_print_image_marker: boolean;
    handedness: string;    // "right" | "left"
    up_axis: string;       // "Y" | "Z"
    forward_axis: string;  // "-Z" | "+Z"
  }

  // Aggregate capability for a match (intersection of all presences').
  export interface IRoomCapability {
    common_frames: { [k: number]: number };  // kind -> count
    member_count: number;
  }

  export interface IFrameState {
    current: IFrame;
    pending?: IFrame;            // set during a SpatialFrameOffer
    pending_offered_by_user_id?: string;
    pending_started_ms?: number;
    pending_grace_ms?: number;
    acks: { [user_id: string]: { ok: boolean; detail: string } };
    capabilities: { [user_id: string]: ICapability };
  }

  // ---------- Constructors ----------

  export function buildKernelWorld(matchId: string, region: string): IFrame {
    return {
      frame_id: "kw_" + matchId,
      kind: Kind.KERNEL_WORLD,
      provider: "",
      vendor_token: "",
      issued_ms: Date.now(),
      region: region,
      floor_height_m: 0,
      forward_yaw_deg: 0,
      relocalize_grace_ms: 0
    };
  }

  export function buildPcvrPseudo(matchId: string, region: string, floor_m: number, yaw_deg: number): IFrame {
    return {
      frame_id: "pcvr_" + matchId,
      kind: Kind.PCVR_PSEUDO,
      provider: "ivx_pcvr",
      vendor_token: "",
      issued_ms: Date.now(),
      region: region,
      floor_height_m: floor_m,
      forward_yaw_deg: yaw_deg,
      relocalize_grace_ms: 0
    };
  }

  // ---------- Capability negotiation ----------

  export function negotiateInitialKind(
    requested: number,
    capabilities: ICapability[]
  ): number {
    if (capabilities.length === 0) return Kind.KERNEL_WORLD;

    // Build a histogram of frames everyone supports.
    var support: { [k: number]: number } = {};
    for (var i = 0; i < capabilities.length; i++) {
      var caps = capabilities[i];
      if (!caps.supported_frames) continue;
      for (var j = 0; j < caps.supported_frames.length; j++) {
        var kind = caps.supported_frames[j];
        support[kind] = (support[kind] || 0) + 1;
      }
    }

    var memberCount = capabilities.length;

    // 1) If the requested kind is supported by everyone, use it.
    if (requested && support[requested] === memberCount) {
      return requested;
    }

    // 2) Else walk fallback chain and return the first kind everyone supports.
    for (var k = 0; k < FALLBACK_CHAIN.length; k++) {
      var f = FALLBACK_CHAIN[k];
      if (support[f] === memberCount) return f;
    }

    // 3) Last resort — kernel world (every adapter MUST support this).
    return Kind.KERNEL_WORLD;
  }

  // ---------- Offer / ack bookkeeping ----------

  export function startOffer(state: IFrameState, offeredBy: string, frame: IFrame, graceMs: number): void {
    state.pending = frame;
    state.pending_offered_by_user_id = offeredBy;
    state.pending_started_ms = Date.now();
    state.pending_grace_ms = graceMs;
    state.acks = {};
  }

  export function recordAck(state: IFrameState, userId: string, ok: boolean, detail: string): void {
    state.acks[userId] = { ok: ok, detail: detail };
  }

  export function offerStatus(
    state: IFrameState,
    nowMs: number,
    minAcks: number
  ): { ready: boolean; expired: boolean; ok_count: number; fail_count: number } {
    if (!state.pending || !state.pending_started_ms || !state.pending_grace_ms) {
      return { ready: false, expired: false, ok_count: 0, fail_count: 0 };
    }
    var ok = 0, bad = 0;
    for (var u in state.acks) {
      if (state.acks[u].ok) ok++; else bad++;
    }
    var expired = (nowMs - state.pending_started_ms) >= state.pending_grace_ms;
    return { ready: ok >= minAcks, expired: expired, ok_count: ok, fail_count: bad };
  }

  export function commitPending(state: IFrameState): IFrame | null {
    if (!state.pending) return null;
    var prev = state.current;
    state.current = state.pending;
    state.pending = undefined;
    state.pending_offered_by_user_id = undefined;
    state.pending_started_ms = undefined;
    state.pending_grace_ms = undefined;
    state.acks = {};
    return prev;
  }

  export function abortPending(state: IFrameState): void {
    state.pending = undefined;
    state.pending_offered_by_user_id = undefined;
    state.pending_started_ms = undefined;
    state.pending_grace_ms = undefined;
    state.acks = {};
  }

  // ---------- Pose message guard ----------

  // Verify a frame_id on an inbound pose / anchor message. During the
  // grace window after a frame switch, both old and new frame_ids are
  // accepted. Otherwise stale frames are rejected.
  export function isFrameAcceptable(state: IFrameState, frameId: string, nowMs: number): boolean {
    if (!frameId) return false;
    if (state.current.frame_id === frameId) return true;
    if (state.pending && state.pending.frame_id === frameId) return true;
    return false;
  }
}
