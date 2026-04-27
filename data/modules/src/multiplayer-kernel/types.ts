// IVX Multiplayer Kernel — wire-shape types.
//
// These mirror the proto3 contracts in
//   `Intelli-verse-X-SDK/schemas/multiplayer/*.proto`
// but stay framework-agnostic. The Nakama JS runtime (goja) cannot run
// google-protobuf JS bindings, so the wire format on TS templates is JSON
// using these shapes; opcodes match the proto enum values exactly.
//
// Go-backed templates (RealtimeTick, AvatarReplication) use proto binary
// against the same opcodes — encoding differs, contract is one.

namespace MpKernel {
  // ---------- Reserved opcode ranges (mirrors opcodes.proto) ----------
  // The proto file in `Intelli-verse-X-SDK/schemas/multiplayer/opcodes.proto`
  // is the canonical source. These constants MUST stay in sync with it;
  // the codegen pipeline will overwrite this file once wired (P0/P12).
  export var OP_RANGE = {
    KERNEL:           { from: 0x0000, to: 0x0FFF },
    SOCIAL:           { from: 0x1000, to: 0x1FFF }, // ConversationalParty
    AGENTS:           { from: 0x2000, to: 0x2FFF },
    MODERATION:       { from: 0x3000, to: 0x3FFF },
    SYNC_TURN:        { from: 0x4000, to: 0x4FFF },
    ASYNC_TURN:       { from: 0x5000, to: 0x5FFF },
    REALTIME_TICK:    { from: 0x6000, to: 0x6FFF },
    LOBBY_HANDOFF:    { from: 0x7000, to: 0x7FFF },
    TOURNAMENT:       { from: 0x8000, to: 0x8FFF },
    LIVE_EVENT:       { from: 0x9000, to: 0x9FFF },
    PERSISTENT_PARTY: { from: 0xA000, to: 0xAFFF },
    MR_ANCHOR:        { from: 0xB000, to: 0xBFFF },
    GAME_DEFINED:     { from: 0xC000, to: 0xCFFF },
    XR_POSE:          { from: 0xF000, to: 0xFFFF }
  };

  // ---------- Kernel control opcodes (mirrors opcodes.proto Opcode) ----------
  // Values MUST exactly match the proto. The kernel encodes/decodes by
  // numeric opcode; constants below are aliases for readability only.
  export var KernelOp = {
    CLIENT_HELLO:              0x0001,
    SERVER_HELLO:              0x0002, // formerly WELCOME
    HEARTBEAT:                 0x0003,
    PLAYER_JOINED:             0x0004,
    PLAYER_LEFT:               0x0005,
    PLAYER_KICKED:             0x0006,
    MATCH_ENDED:               0x0007,
    ERROR:                     0x0008,
    MATCH_RESUME:              0x0009,
    MATCH_RESUME_ACK:          0x000A,
    LATENCY_WARNING:           0x000B,
    TICK_RATE_CHANGED:         0x000C,
    VOICE_CAPABILITY_CHANGED:  0x000D,
    VOICE_UNAVAILABLE:         0x000E,
    VOICE_MODE_CHANGED:        0x000F,
    LOW_BANDWIDTH_REQUEST:     0x0010,
    NETWORK_CLOCK_PING:        0x0011,
    NETWORK_CLOCK_PONG:        0x0012,
    WARN_RATE_LIMITED:         0x0013,
    WARN_TICK_OVERRUN:         0x0014,
    WARN_MATCH_STATE_LARGE:    0x0015,
    WARN_AVATAR_FALLBACK:      0x0016,
    WARN_DEPRECATED_CLIENT:    0x0017,
    WARN_STATE_REBUILT:        0x0018,
    CLOCK_SYNC:                0x0019, // server-initiated periodic broadcast (distinct from PING/PONG request/response)
    // Legacy aliases preserved so downstream callers keep compiling
    // during the rename. Will be removed in P3 alongside the codegen
    // rollout that emits canonical names.
    LEAVE:                     0x0005, // alias of PLAYER_LEFT
    WELCOME:                   0x0002, // alias of SERVER_HELLO
    STATE_RESYNC:              0x0018, // alias of WARN_STATE_REBUILT
    WARN:                      0x0013  // alias of WARN_RATE_LIMITED (generic warn fallback)
  };

  // ---------- Standard enum mirrors (kernel.proto) ----------
  export var LeaveReason = {
    UNSPECIFIED: 0,
    VOLUNTARY:   1,
    DISCONNECT:  2,
    KICK:        3,
    BAN:         4,
    TIMEOUT:     5,
    FLAPPING:    6,
    MATCH_ENDED: 7
  };

  export var EndReason = {
    UNSPECIFIED:       0,
    COMPLETED:         1,
    TIMEOUT:           2,
    QUORUM_LOST:       3,
    HOST_DISBAND:      4,
    KICKED_ALL:        5,
    DURATION_EXCEEDED: 6,
    KERNEL_INTERNAL:   7,
    // Distinct from completion: lobby disbanded before handoff,
    // async-game cancelled, voluntary teardown by host, etc.
    CANCELLED:         8
  };

  // ---------- Error codes (envelope.proto ErrorCode) ----------
  // CANONICAL VALUES — these match the proto schema exactly. Adapters and
  // dashboards must use these integers. See `docs/multiplayer/error-taxonomy.md`
  // for retry-policy guidance.
  export var ErrorCode = {
    UNSPECIFIED:           0,
    // 1-9 — schema / time
    SCHEMA_TOO_OLD:         1,
    SERVER_TOO_OLD:         2,
    BAD_PAYLOAD:            3,
    SEQ_GAP:                4,
    UNKNOWN_OPCODE:         5,
    DUPLICATE_OPCODE:       6,
    CLOCK_SKEW_EXTREME:     7,
    MATCH_STATE_LARGE:      8,
    // 20-29 — capacity / membership
    MATCH_FULL:            20,
    MATCH_NOT_FOUND:       21,
    NOT_A_MEMBER:          22,
    RATE_LIMITED:          23,
    FLAPPING:              24,
    MATCH_ENDED:           25,
    SESSION_REPLACED:      26,
    // 30-39 — auth / permission
    PERMISSION_DENIED:     30,
    KICKED:                31,
    BANNED:                32,
    NOT_AUTHORIZED:        33,
    // 40-49 — agent
    BAD_PERSONA:           40,
    BUDGET_EXCEEDED:       41,
    AGENT_PROVIDER_DOWN:   42,
    // 50-59 — XR / spatial
    ANCHOR_INCOMPAT:       50,
    ANCHOR_LOST:           51,
    // 60-69 — voice
    VOICE_UNAVAILABLE:     60,
    VOICE_PERMISSION_DENIED: 61,
    // 70-79 — moderation
    MODERATED:             70,
    // 80-89 — lifecycle (match-fatal)
    TIMEOUT:               80,
    QUORUM_LOST:           81,
    DURATION_EXCEEDED:     82,
    STATE_OVERFLOW:        83,
    // 90-99 — capability
    CAPABILITY_UNSUPPORTED:90,
    // 100-119 — infra
    OVERLOAD:             100,
    PERSISTENCE_DEGRADED: 101,
    TICK_OVERRUN_DEGRADED:102,
    PROVIDER_UNAVAILABLE: 103,
    // catch-all
    INTERNAL:             999
  };

  // ---------- Warning codes (envelope.proto WarningCode) ----------
  // Non-fatal; surfaced to adapters as OnWarning(...). Never end matches.
  export var WarningCode = {
    UNSPECIFIED:        0,
    RATE_LIMITED:        1,
    TICK_OVERRUN:        2,
    MATCH_STATE_LARGE:   3,
    AVATAR_FALLBACK:     4,
    DEPRECATED_CLIENT:   5,
    STATE_REBUILT:       6,
    LOW_BANDWIDTH:       7,
    AGENT_DEGRADED:      8,
    CLOCK_REALIGN:       9
  };

  // ---------- Wire envelope ----------
  // Header on every Envelope (envelope.proto Header).
  export interface IHeader {
    wire_version: number;          // WireVersion enum, 1 = V1
    op: number;                    // Opcode (see ranges).
    seq: number;                   // Per-(match, sender) monotonic.
    match_time_ms: number;         // Server-authoritative.
    sender_user_id: string;
    match_id: string;
    client_opcode_uuid: string;
    quantization_profile?: number; // QuantizationProfile enum.
    delta_base_seq?: number;
    feature_flags?: number;
    trace_parent?: string;
  }

  // JSON-wire envelope: { h: header, p: payload object }.
  export interface IEnvelope<P> {
    h: IHeader;
    p: P;
  }

  export interface IError {
    code: number;
    detail?: string;
    retry_after_ms?: number;
    min_required_version?: string;
  }

  // ---------- Match-init params, kernel-side ----------
  export interface IMatchInitArgs {
    template_id: string;
    game_id: string;
    region?: string;
    template_init: any;     // Template-specific (e.g. SyncTurnInitParams).
    creator_user_id?: string;
    flags?: { [k: string]: string };
  }

  // ---------- IMatchTemplate ----------
  // The contract every TS-backed match template implements. The kernel
  // mounts each template under a unique Nakama match name and routes
  // opcodes inside its reserved range.
  export interface IMatchTemplate<TState> {
    // Stable identifier that ends up in MatchResultEnvelope.template_id
    // and the Nakama-registered match name (e.g. "sync-turn-v1").
    templateId: string;
    // Reserved opcode range (inclusive) this template owns.
    opRange: { from: number; to: number };
    // Default per-match init (defaults applied if init args omit values).
    defaultInit: any;

    initState(
      ctx: nkruntime.Context,
      logger: nkruntime.Logger,
      nk: nkruntime.Nakama,
      params: IMatchInitArgs
    ): { state: TState; tickRate: number; label: string };

    onJoinAttempt(
      ctx: nkruntime.Context,
      logger: nkruntime.Logger,
      nk: nkruntime.Nakama,
      dispatcher: nkruntime.MatchDispatcher,
      tick: number,
      state: TState,
      presence: nkruntime.Presence,
      metadata: { [k: string]: string }
    ): { state: TState; accept: boolean; rejectMessage?: string };

    onJoin(
      ctx: nkruntime.Context,
      logger: nkruntime.Logger,
      nk: nkruntime.Nakama,
      dispatcher: nkruntime.MatchDispatcher,
      tick: number,
      state: TState,
      presences: nkruntime.Presence[]
    ): { state: TState };

    onLeave(
      ctx: nkruntime.Context,
      logger: nkruntime.Logger,
      nk: nkruntime.Nakama,
      dispatcher: nkruntime.MatchDispatcher,
      tick: number,
      state: TState,
      presences: nkruntime.Presence[]
    ): { state: TState };

    // Called every tick, even with no messages. Drives server timers.
    onLoop(
      ctx: nkruntime.Context,
      logger: nkruntime.Logger,
      nk: nkruntime.Nakama,
      dispatcher: nkruntime.MatchDispatcher,
      tick: number,
      state: TState,
      messages: nkruntime.MatchMessage[]
    ): { state: TState } | null; // null = end match.

    onTerminate(
      ctx: nkruntime.Context,
      logger: nkruntime.Logger,
      nk: nkruntime.Nakama,
      dispatcher: nkruntime.MatchDispatcher,
      tick: number,
      state: TState,
      graceSeconds: number
    ): { state: TState };

    // Optional: emit the MatchResultEnvelope to persist on natural / forced end.
    buildResult?(state: TState, reason: string): MpKernel.IMatchResultEnvelope | null;
  }

  // ---------- MatchResultEnvelope ----------
  export interface IPlayerOutcome {
    user_id: string;
    is_agent: boolean;
    placement: number;     // 1 = winner; 0 = unranked.
    score: number;
    completed: boolean;
    left_early: boolean;
    game_payload?: any;
  }

  export interface IMatchResultEnvelope {
    match_id: string;
    template_id: string;
    game_id: string;
    started_unix_ms: number;
    ended_unix_ms: number;
    duration_ms: number;
    outcomes: IPlayerOutcome[];
    game_payload?: any;
    region?: string;
  }
}
