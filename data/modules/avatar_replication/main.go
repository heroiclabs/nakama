// Package main — AvatarReplicationMatch as a native Nakama Go runtime module.
//
// Why Go (not Goja JS):
//   * Tick rate is 60–90 Hz with N avatars × 5 channels (head/hand/body/face/
//     finger) × per-bone joint streams. The per-tick allocation cost in Goja
//     dominates beyond ~30 Hz; running natively keeps the budget at 11–16 ms
//     even for parties of 16.
//   * Pose quantization (smallest-three quaternion + fixed-point mm position)
//     is integer-heavy work; Go encodes/decodes ~10× faster than Goja.
//
// Wire contract:
//   * Reserved opcode range 0xF000–0xFFFF (matches schemas/multiplayer/
//     opcodes.proto: OP_XR_HEAD_POSE…OP_XR_AVATAR_LOD).
//   * Same envelope shape as JS templates: {h:{wire_version, op, seq,
//     match_time_ms, sender_user_id, match_id, client_opcode_uuid}, p:{...}}.
//   * For pose channels we use a compact JSON payload that mirrors the
//     `PoseQuantized` proto. Future v2 can swap to binary protobuf without
//     changing the kernel; clients negotiate via the wire_version field.
//
// Match handler responsibilities:
//   1. Negotiate per-channel rates (head/hand/body/face/finger) at join time.
//      Clients SHOULD NOT exceed; server enforces a per-second budget.
//   2. Drive a single dispatcher tick at server tick_hz (default 30 Hz) which
//      relays the most-recent buffered pose for each (user, channel) — this
//      is the "delta + last-write-wins" optimization that keeps latency low
//      regardless of how often the client pushes.
//   3. Quantize on ingress only if client sent uncompressed; otherwise pass
//      through (clients are expected to quantize once, on-device).
//   4. Distributed object authority: each user is the authoritative author of
//      their own avatar's poses. Server REJECTS pose updates whose
//      `pose.user_id` differs from the sender — never trust the wire id.
//   5. Interest management (AOI): if `enable_aoi`, server keeps a coarse
//      bucket grid (default 8 m cells) keyed by head position. A user only
//      receives pose updates from peers within `aoi_radius_mm`. The full
//      service ships in P10 (multiplayer-kernel/spatial-hash); this module
//      uses a simple in-match grid sized to a single room.
//   6. LOD auto-demote: if a user-pair distance exceeds the AOI radius but
//      they're still in the same coarse area (e.g. ring around a stage),
//      send AvatarLOD demote messages instead of dropping entirely.
//   7. Voice position broadcast: if the match has a LiveKit room attached
//      (passed in template_init.voice_room_id), the server forwards the
//      most-recent head pose to the voice provider's spatial publish API
//      via OP_XR_VOICE_POSITION. The voice client uses this for HRTF.
//   8. Per-channel rate-limit: if a client exceeds its declared budget,
//      the server emits WARN_RATE_LIMITED and silently drops excess.
//   9. Snapshot on join / on resume: latest pose for every user is sent as
//      a bundled snapshot so late-joiners see populated avatars immediately.
//  10. End match on duration cap, quorum loss, or kernel signal.
//
// This module registers itself as a match handler under the template id
// "avatar-replication-v1" so the JS kernel's `mp_create_match` RPC can spin
// up matches of this template by name.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sync/atomic"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	// Match registration name (must match TEMPLATE_IDS.AVATAR_REPLICATION_V1
	// in nakama/data/modules/src/multiplayer-kernel/index.ts).
	templateID = "avatar-replication-v1"

	// Wire constants — mirror schemas/multiplayer/opcodes.proto.
	opXRHeadPose       = 0xF000
	opXRHandPose       = 0xF001
	opXRBodyPose       = 0xF002
	opXRFaceBlendshape = 0xF003
	opXRVoicePosition  = 0xF004
	opXRFingerPose     = 0xF005
	opXRAvatarLOD      = 0xF006

	// Kernel control opcodes (mirror kernel.proto / opcodes.proto).
	opMatchEnded             = 0x0007
	opError                  = 0x0008
	opWarnRateLimited        = 0x0013
	opWarnAvatarFallback     = 0x0016

	// kernel.proto EndReason mirror.
	endReasonCompleted        = 1
	endReasonTimeout          = 2
	endReasonQuorumLost       = 3
	endReasonDurationExceeded = 6
	endReasonKernelInternal   = 7

	// envelope.proto ErrorCode mirror (post-renumber).
	errBadPayload    = 3
	errRateLimited   = 23
	errStateOverflow = 83
	errNotAuthorized = 33

	// Defaults.
	defaultTickHz             = 30 // server-side relay tick (NOT client publish)
	defaultHeadHz             = 60
	defaultHandHz             = 60
	defaultBodyHz             = 30
	defaultFaceHz             = 45
	defaultFingerHz           = 30
	defaultMaxAvatars         = 16
	defaultMinPlayers         = 1
	defaultAOIRadiusMm        = 6_000 // 6 m
	defaultAOICellSizeMm      = 8_000 // 8 m grid bucket
	defaultMaxMatchDurationMs = 60 * 60 * 1000 // 1 hr hard cap
	defaultReconnectGraceMs   = 60_000

	// Per-channel guardrails. Client may publish faster but server only
	// relays the most-recent buffered pose; excess gets WARN_RATE_LIMITED.
	maxHeadPubHz   = 90
	maxHandPubHz   = 90
	maxBodyPubHz   = 30
	maxFacePubHz   = 60
	maxFingerPubHz = 60

	// Wire / hygiene.
	wireVersion         = 1
	maxStateSizeBytes   = 64 * 1024
	systemSenderID      = "server"
	maxJointsPerBody    = 32 // skeleton-v1 reduced set
	maxBlendshapesBytes = 64 // 52 ARKit weights + headroom
)

// initParams shapes the JSON in template_init that mp_create_match forwards.
type initParams struct {
	GameID                string  `json:"game_id"`
	TickHz                int     `json:"tick_hz"`
	HeadHz                int     `json:"head_hz"`
	HandHz                int     `json:"hand_hz"`
	BodyHz                int     `json:"body_hz"`
	FaceHz                int     `json:"face_hz"`
	FingerHz              int     `json:"finger_hz"`
	MaxAvatars            int     `json:"max_avatars"`
	MinPlayers            int     `json:"min_players"`
	MaxMatchDurationMs    int64   `json:"max_match_duration_ms"`
	ReconnectGraceMs      int64   `json:"reconnect_grace_ms"`
	EnableAOI             bool    `json:"enable_aoi"`
	AOIRadiusMm           int32   `json:"aoi_radius_mm"`
	AOICellSizeMm         int32   `json:"aoi_cell_size_mm"`
	EnableLODAutoDemote   bool    `json:"enable_lod_auto_demote"`
	DefaultQuantProfile   uint32  `json:"default_quant_profile"`
	VoiceRoomID           string  `json:"voice_room_id"`
	VoicePositionRelay    bool    `json:"voice_position_relay"`
	SpatialFrameID        string  `json:"spatial_frame_id"`
}

// PoseQuantized — wire JSON, mirrors PoseQuantized proto.
type poseQuantizedJSON struct {
	PxMm           int32  `json:"px_mm"`
	PyMm           int32  `json:"py_mm"`
	PzMm           int32  `json:"pz_mm"`
	RotPacked      uint32 `json:"rot_packed"`
	QuantProfile   uint32 `json:"quant_profile"`
	TsMs           int64  `json:"ts_ms"`
	ConfidencePct  uint32 `json:"confidence_pct"`
}

type avatarChannel int

const (
	chHead avatarChannel = iota
	chHandLeft
	chHandRight
	chBody
	chFace
	chFingerLeft
	chFingerRight
)

func (c avatarChannel) name() string {
	switch c {
	case chHead:
		return "head"
	case chHandLeft:
		return "hand_l"
	case chHandRight:
		return "hand_r"
	case chBody:
		return "body"
	case chFace:
		return "face"
	case chFingerLeft:
		return "finger_l"
	case chFingerRight:
		return "finger_r"
	}
	return "?"
}

// channelBudget — per-channel per-second publish budget.
type channelBudget struct {
	hzMax       int
	windowStart int64 // unix ms
	count       int
}

// avatarState — per-user per-match avatar bookkeeping.
type avatarState struct {
	UserID         string
	IsAgent        bool
	JoinedAtMs     int64
	HeadPose       *poseQuantizedJSON
	HandLeft       *poseQuantizedJSON
	HandRight      *poseQuantizedJSON
	Body           []poseQuantizedJSON
	Face           []byte // raw bytes (≤64)
	FingerLeft     []byte // 15 uint8s
	FingerRight    []byte
	LOD            uint32
	LODReason      string
	GripL          uint32
	GripR          uint32
	TriggerL       uint32
	TriggerR       uint32
	HeadBudget     channelBudget
	HandLBudget    channelBudget
	HandRBudget    channelBudget
	BodyBudget     channelBudget
	FaceBudget     channelBudget
	FingerLBudget  channelBudget
	FingerRBudget  channelBudget
	LastSeenMs     int64
	WarnedThisWin  bool
	// Latest pose used for AOI bucket lookup: derive from HeadPose.
}

// matchState — runtime state per match.
type matchState struct {
	init                  initParams
	tickHz                int
	tickPeriodMs          int64
	startUnixMs           int64
	matchEndAtUnixMs      int64
	pendingEndReason      string
	avatars               map[string]*avatarState
	outboundSeq           uint64
	matchID               string
	terminated            bool
	currentTick           int

	// Pose buffers. Last-write-wins per (user, channel) per server tick.
	dirtyHead     map[string]bool
	dirtyHandL    map[string]bool
	dirtyHandR    map[string]bool
	dirtyBody     map[string]bool
	dirtyFace     map[string]bool
	dirtyFingerL  map[string]bool
	dirtyFingerR  map[string]bool

	// AOI grid: cellID = "x,y,z" -> set of user_ids.
	aoiGrid map[string]map[string]bool
}

// envelope — wire format (matches JS templates).
type envelope struct {
	H envelopeHeader  `json:"h"`
	P json.RawMessage `json:"p"`
}

type envelopeHeader struct {
	WireVersion      int    `json:"wire_version"`
	Op               int    `json:"op"`
	Seq              uint64 `json:"seq"`
	MatchTimeMs      int64  `json:"match_time_ms"`
	SenderUserID     string `json:"sender_user_id"`
	MatchID          string `json:"match_id"`
	ClientOpcodeUUID string `json:"client_opcode_uuid"`
}

// Match implements runtime.Match.
type Match struct{}

func (m *Match) MatchInit(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	init := initParams{
		TickHz:               defaultTickHz,
		HeadHz:               defaultHeadHz,
		HandHz:               defaultHandHz,
		BodyHz:               defaultBodyHz,
		FaceHz:               defaultFaceHz,
		FingerHz:             defaultFingerHz,
		MaxAvatars:           defaultMaxAvatars,
		MinPlayers:           defaultMinPlayers,
		MaxMatchDurationMs:   defaultMaxMatchDurationMs,
		ReconnectGraceMs:     defaultReconnectGraceMs,
		EnableAOI:            true,
		AOIRadiusMm:          defaultAOIRadiusMm,
		AOICellSizeMm:        defaultAOICellSizeMm,
		EnableLODAutoDemote:  true,
		DefaultQuantProfile:  1,
		VoicePositionRelay:   true,
	}
	if rawTI, ok := params["template_init"]; ok && rawTI != nil {
		if b, err := json.Marshal(rawTI); err == nil {
			_ = json.Unmarshal(b, &init)
		}
	}
	clamp := func(v, lo, hi int) int {
		if v < lo {
			return lo
		}
		if v > hi {
			return hi
		}
		return v
	}
	init.TickHz = clamp(init.TickHz, 10, 90)
	init.HeadHz = clamp(init.HeadHz, 10, maxHeadPubHz)
	init.HandHz = clamp(init.HandHz, 10, maxHandPubHz)
	init.BodyHz = clamp(init.BodyHz, 5, maxBodyPubHz)
	init.FaceHz = clamp(init.FaceHz, 5, maxFacePubHz)
	init.FingerHz = clamp(init.FingerHz, 5, maxFingerPubHz)
	if init.AOICellSizeMm <= 0 {
		init.AOICellSizeMm = defaultAOICellSizeMm
	}
	if init.AOIRadiusMm <= 0 {
		init.AOIRadiusMm = defaultAOIRadiusMm
	}

	now := time.Now().UnixMilli()
	state := &matchState{
		init:             init,
		tickHz:           init.TickHz,
		tickPeriodMs:     int64(1000 / init.TickHz),
		startUnixMs:      now,
		matchEndAtUnixMs: now + init.MaxMatchDurationMs,
		avatars:          map[string]*avatarState{},
		outboundSeq:      1,
		dirtyHead:        map[string]bool{},
		dirtyHandL:       map[string]bool{},
		dirtyHandR:       map[string]bool{},
		dirtyBody:        map[string]bool{},
		dirtyFace:        map[string]bool{},
		dirtyFingerL:     map[string]bool{},
		dirtyFingerR:     map[string]bool{},
		aoiGrid:          map[string]map[string]bool{},
	}

	gameID := stringFromMap(params, "game_id", init.GameID)
	label := mustJSON(map[string]interface{}{
		"template_id":    templateID,
		"game_id":        gameID,
		"tick_hz":        init.TickHz,
		"max_avatars":    init.MaxAvatars,
		"head_hz":        init.HeadHz,
		"voice_relay":    init.VoicePositionRelay,
		"aoi":            init.EnableAOI,
		"spatial_frame":  init.SpatialFrameID,
	})
	logger.Info("[avatar_replication] match init template=%s tickHz=%d max=%d aoi=%v voiceRelay=%v",
		templateID, init.TickHz, init.MaxAvatars, init.EnableAOI, init.VoicePositionRelay)
	return state, init.TickHz, label
}

func (m *Match) MatchJoinAttempt(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presence runtime.Presence, metadata map[string]string) (interface{}, bool, string) {
	s := state.(*matchState)
	if s.terminated {
		return s, false, "match ended"
	}
	if len(s.avatars) >= s.init.MaxAvatars {
		return s, false, "match full"
	}
	return s, true, ""
}

func (m *Match) MatchJoin(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*matchState)
	now := time.Now().UnixMilli()
	matchTimeMs := now - s.startUnixMs
	for _, p := range presences {
		if _, ok := s.avatars[p.GetUserId()]; ok {
			continue
		}
		s.avatars[p.GetUserId()] = &avatarState{
			UserID:        p.GetUserId(),
			IsAgent:       len(p.GetUserId()) > 4 && p.GetUserId()[:4] == "agt_",
			JoinedAtMs:    matchTimeMs,
			LOD:           0,
			HeadBudget:    channelBudget{hzMax: s.init.HeadHz},
			HandLBudget:   channelBudget{hzMax: s.init.HandHz},
			HandRBudget:   channelBudget{hzMax: s.init.HandHz},
			BodyBudget:    channelBudget{hzMax: s.init.BodyHz},
			FaceBudget:    channelBudget{hzMax: s.init.FaceHz},
			FingerLBudget: channelBudget{hzMax: s.init.FingerHz},
			FingerRBudget: channelBudget{hzMax: s.init.FingerHz},
			LastSeenMs:    matchTimeMs,
		}
		// Send a pose snapshot of every existing avatar to the joiner so
		// they see populated bodies immediately (no "ghost" first second).
		s.sendSnapshotTo(dispatcher, p.GetUserId(), matchTimeMs)
	}
	return s
}

func (m *Match) MatchLeave(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*matchState)
	for _, p := range presences {
		s.removeFromAOI(p.GetUserId())
		delete(s.avatars, p.GetUserId())
	}
	if len(s.avatars) < s.init.MinPlayers && len(s.avatars) > 0 {
		// Soft quorum loss — for avatar-only rooms we don't end immediately;
		// the client may reconnect within ReconnectGraceMs. v1 leaves it to
		// the kernel to call MatchSignal("force_end") after grace expires.
	}
	return s
}

func (m *Match) MatchLoop(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	s := state.(*matchState)
	if s.matchID == "" {
		s.matchID = matchIDFromCtx(ctx)
	}
	s.currentTick = int(tick)
	nowUnixMs := time.Now().UnixMilli()
	matchTimeMs := nowUnixMs - s.startUnixMs

	if nowUnixMs > s.matchEndAtUnixMs {
		s.pendingEndReason = "duration_exceeded"
		return endMatch(s, dispatcher, endReasonDurationExceeded, matchTimeMs)
	}

	for _, msg := range messages {
		s.handleInbound(msg, dispatcher, logger, matchTimeMs, nowUnixMs)
	}

	s.flushDirty(dispatcher, matchTimeMs)

	if s.init.EnableLODAutoDemote {
		s.evaluateLOD(dispatcher, matchTimeMs)
	}

	if s.pendingEndReason != "" {
		var reasonEnum int
		switch s.pendingEndReason {
		case "quorum_lost":
			reasonEnum = endReasonQuorumLost
		case "duration_exceeded":
			reasonEnum = endReasonDurationExceeded
		case "completed":
			reasonEnum = endReasonCompleted
		case "host_disband":
			reasonEnum = endReasonKernelInternal
		default:
			reasonEnum = endReasonKernelInternal
		}
		return endMatch(s, dispatcher, reasonEnum, matchTimeMs)
	}
	return s
}

func (m *Match) MatchTerminate(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, graceSeconds int) interface{} {
	s := state.(*matchState)
	s.terminated = true
	logger.Info("[avatar_replication] terminate match=%s tick=%d grace=%d", s.matchID, tick, graceSeconds)
	return s
}

func (m *Match) MatchSignal(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, data string) (interface{}, string) {
	s := state.(*matchState)
	switch data {
	case "force_end":
		s.pendingEndReason = "host_disband"
	case "quorum_lost":
		s.pendingEndReason = "quorum_lost"
	}
	return s, ""
}

// ---- inbound handling ----

func (s *matchState) handleInbound(m runtime.MatchData, dispatcher runtime.MatchDispatcher, logger runtime.Logger, matchTimeMs int64, nowUnixMs int64) {
	op := int(m.GetOpCode())
	user := m.GetUserId()
	av, ok := s.avatars[user]
	if !ok {
		return
	}

	var env envelope
	if err := json.Unmarshal(m.GetData(), &env); err != nil {
		s.sendTo(dispatcher, opError, mustMarshal(map[string]interface{}{
			"code":   errBadPayload,
			"detail": "invalid envelope",
		}), []string{user}, matchTimeMs)
		return
	}

	av.LastSeenMs = matchTimeMs

	switch op {
	case opXRHeadPose:
		s.ingestHead(av, env.P, dispatcher, matchTimeMs, nowUnixMs)
	case opXRHandPose:
		s.ingestHand(av, env.P, dispatcher, matchTimeMs, nowUnixMs)
	case opXRBodyPose:
		s.ingestBody(av, env.P, dispatcher, matchTimeMs, nowUnixMs)
	case opXRFaceBlendshape:
		s.ingestFace(av, env.P, dispatcher, matchTimeMs, nowUnixMs)
	case opXRFingerPose:
		s.ingestFinger(av, env.P, dispatcher, matchTimeMs, nowUnixMs)
	default:
		// Unknown op in our range — ignore silently.
	}
}

// budgetCheck — single-window budget. Returns true if accept; false = drop.
// Window is 1s; on a new window we reset.
func budgetCheck(b *channelBudget, nowUnixMs int64) bool {
	if nowUnixMs-b.windowStart >= 1000 {
		b.windowStart = nowUnixMs
		b.count = 0
	}
	if b.count >= b.hzMax {
		return false
	}
	b.count++
	return true
}

// validateUserOwnership — server-authoritative authority check.
// Wire payload may carry user_id; if it's set and != sender, REJECT.
func validateUserOwnership(payloadUserID, senderUserID string) bool {
	if payloadUserID == "" {
		return true // omitted = server stamps from sender
	}
	return payloadUserID == senderUserID
}

func (s *matchState) ingestHead(av *avatarState, payload json.RawMessage, dispatcher runtime.MatchDispatcher, matchTimeMs int64, nowUnixMs int64) {
	var msg struct {
		UserID string             `json:"user_id"`
		Pose   poseQuantizedJSON  `json:"pose"`
	}
	if err := json.Unmarshal(payload, &msg); err != nil {
		s.sendError(dispatcher, []string{av.UserID}, errBadPayload, "head: bad payload", matchTimeMs)
		return
	}
	if !validateUserOwnership(msg.UserID, av.UserID) {
		s.sendError(dispatcher, []string{av.UserID}, errNotAuthorized, "head: user_id != sender", matchTimeMs)
		return
	}
	if !budgetCheck(&av.HeadBudget, nowUnixMs) {
		s.sendWarn(dispatcher, av.UserID, opWarnRateLimited, "head", av.HeadBudget.hzMax, matchTimeMs)
		return
	}
	if msg.Pose.QuantProfile == 0 {
		msg.Pose.QuantProfile = s.init.DefaultQuantProfile
	}
	prevHead := av.HeadPose
	av.HeadPose = &msg.Pose
	s.dirtyHead[av.UserID] = true
	s.updateAOIBucket(av, prevHead)
}

func (s *matchState) ingestHand(av *avatarState, payload json.RawMessage, dispatcher runtime.MatchDispatcher, matchTimeMs int64, nowUnixMs int64) {
	var msg struct {
		UserID     string            `json:"user_id"`
		IsLeft     bool              `json:"is_left"`
		Pose       poseQuantizedJSON `json:"pose"`
		GripPct    uint32            `json:"grip_pct"`
		TriggerPct uint32            `json:"trigger_pct"`
	}
	if err := json.Unmarshal(payload, &msg); err != nil {
		s.sendError(dispatcher, []string{av.UserID}, errBadPayload, "hand: bad payload", matchTimeMs)
		return
	}
	if !validateUserOwnership(msg.UserID, av.UserID) {
		s.sendError(dispatcher, []string{av.UserID}, errNotAuthorized, "hand: user_id != sender", matchTimeMs)
		return
	}
	if msg.GripPct > 100 {
		msg.GripPct = 100
	}
	if msg.TriggerPct > 100 {
		msg.TriggerPct = 100
	}
	if msg.IsLeft {
		if !budgetCheck(&av.HandLBudget, nowUnixMs) {
			s.sendWarn(dispatcher, av.UserID, opWarnRateLimited, "hand_l", av.HandLBudget.hzMax, matchTimeMs)
			return
		}
		av.HandLeft = &msg.Pose
		av.GripL = msg.GripPct
		av.TriggerL = msg.TriggerPct
		s.dirtyHandL[av.UserID] = true
	} else {
		if !budgetCheck(&av.HandRBudget, nowUnixMs) {
			s.sendWarn(dispatcher, av.UserID, opWarnRateLimited, "hand_r", av.HandRBudget.hzMax, matchTimeMs)
			return
		}
		av.HandRight = &msg.Pose
		av.GripR = msg.GripPct
		av.TriggerR = msg.TriggerPct
		s.dirtyHandR[av.UserID] = true
	}
}

func (s *matchState) ingestBody(av *avatarState, payload json.RawMessage, dispatcher runtime.MatchDispatcher, matchTimeMs int64, nowUnixMs int64) {
	var msg struct {
		UserID string              `json:"user_id"`
		Joints []poseQuantizedJSON `json:"joints"`
	}
	if err := json.Unmarshal(payload, &msg); err != nil {
		s.sendError(dispatcher, []string{av.UserID}, errBadPayload, "body: bad payload", matchTimeMs)
		return
	}
	if !validateUserOwnership(msg.UserID, av.UserID) {
		s.sendError(dispatcher, []string{av.UserID}, errNotAuthorized, "body: user_id != sender", matchTimeMs)
		return
	}
	if len(msg.Joints) > maxJointsPerBody {
		s.sendError(dispatcher, []string{av.UserID}, errStateOverflow, "body: too many joints", matchTimeMs)
		return
	}
	if !budgetCheck(&av.BodyBudget, nowUnixMs) {
		s.sendWarn(dispatcher, av.UserID, opWarnRateLimited, "body", av.BodyBudget.hzMax, matchTimeMs)
		return
	}
	av.Body = msg.Joints
	s.dirtyBody[av.UserID] = true
}

func (s *matchState) ingestFace(av *avatarState, payload json.RawMessage, dispatcher runtime.MatchDispatcher, matchTimeMs int64, nowUnixMs int64) {
	var msg struct {
		UserID       string `json:"user_id"`
		Blendshapes  []byte `json:"blendshapes"`
		QuantProfile uint32 `json:"quant_profile"`
	}
	if err := json.Unmarshal(payload, &msg); err != nil {
		s.sendError(dispatcher, []string{av.UserID}, errBadPayload, "face: bad payload", matchTimeMs)
		return
	}
	if !validateUserOwnership(msg.UserID, av.UserID) {
		s.sendError(dispatcher, []string{av.UserID}, errNotAuthorized, "face: user_id != sender", matchTimeMs)
		return
	}
	if len(msg.Blendshapes) > maxBlendshapesBytes {
		s.sendError(dispatcher, []string{av.UserID}, errStateOverflow, "face: too many bytes", matchTimeMs)
		return
	}
	if !budgetCheck(&av.FaceBudget, nowUnixMs) {
		s.sendWarn(dispatcher, av.UserID, opWarnRateLimited, "face", av.FaceBudget.hzMax, matchTimeMs)
		return
	}
	av.Face = msg.Blendshapes
	s.dirtyFace[av.UserID] = true
}

func (s *matchState) ingestFinger(av *avatarState, payload json.RawMessage, dispatcher runtime.MatchDispatcher, matchTimeMs int64, nowUnixMs int64) {
	var msg struct {
		UserID      string `json:"user_id"`
		IsLeft      bool   `json:"is_left"`
		FingerCurls []byte `json:"finger_curls"`
	}
	if err := json.Unmarshal(payload, &msg); err != nil {
		s.sendError(dispatcher, []string{av.UserID}, errBadPayload, "finger: bad payload", matchTimeMs)
		return
	}
	if !validateUserOwnership(msg.UserID, av.UserID) {
		s.sendError(dispatcher, []string{av.UserID}, errNotAuthorized, "finger: user_id != sender", matchTimeMs)
		return
	}
	if len(msg.FingerCurls) > maxBlendshapesBytes {
		s.sendError(dispatcher, []string{av.UserID}, errStateOverflow, "finger: too many bytes", matchTimeMs)
		return
	}
	if msg.IsLeft {
		if !budgetCheck(&av.FingerLBudget, nowUnixMs) {
			s.sendWarn(dispatcher, av.UserID, opWarnRateLimited, "finger_l", av.FingerLBudget.hzMax, matchTimeMs)
			return
		}
		av.FingerLeft = msg.FingerCurls
		s.dirtyFingerL[av.UserID] = true
	} else {
		if !budgetCheck(&av.FingerRBudget, nowUnixMs) {
			s.sendWarn(dispatcher, av.UserID, opWarnRateLimited, "finger_r", av.FingerRBudget.hzMax, matchTimeMs)
			return
		}
		av.FingerRight = msg.FingerCurls
		s.dirtyFingerR[av.UserID] = true
	}
}

// ---- AOI / spatial hashing ----

func (s *matchState) cellKey(px, py, pz int32) string {
	cs := s.init.AOICellSizeMm
	if cs <= 0 {
		cs = defaultAOICellSizeMm
	}
	return fmt.Sprintf("%d,%d,%d", px/cs, py/cs, pz/cs)
}

func (s *matchState) updateAOIBucket(av *avatarState, prev *poseQuantizedJSON) {
	if !s.init.EnableAOI || av.HeadPose == nil {
		return
	}
	newKey := s.cellKey(av.HeadPose.PxMm, av.HeadPose.PyMm, av.HeadPose.PzMm)
	if prev != nil {
		oldKey := s.cellKey(prev.PxMm, prev.PyMm, prev.PzMm)
		if oldKey == newKey {
			return
		}
		if oldSet, ok := s.aoiGrid[oldKey]; ok {
			delete(oldSet, av.UserID)
			if len(oldSet) == 0 {
				delete(s.aoiGrid, oldKey)
			}
		}
	}
	if _, ok := s.aoiGrid[newKey]; !ok {
		s.aoiGrid[newKey] = map[string]bool{}
	}
	s.aoiGrid[newKey][av.UserID] = true
}

func (s *matchState) removeFromAOI(userID string) {
	for key, set := range s.aoiGrid {
		if set[userID] {
			delete(set, userID)
			if len(set) == 0 {
				delete(s.aoiGrid, key)
			}
			return
		}
	}
}

// recipientsFor — list of user_ids who should receive `from`'s avatar data
// based on AOI radius. If AOI disabled, returns nil (= broadcast to all).
func (s *matchState) recipientsFor(from string) []string {
	if !s.init.EnableAOI {
		return nil
	}
	src, ok := s.avatars[from]
	if !ok || src.HeadPose == nil {
		return nil
	}
	radiusSq := float64(s.init.AOIRadiusMm) * float64(s.init.AOIRadiusMm)
	out := make([]string, 0, 8)
	for uid, av := range s.avatars {
		if uid == from {
			continue
		}
		if av.HeadPose == nil {
			out = append(out, uid)
			continue
		}
		dx := float64(av.HeadPose.PxMm - src.HeadPose.PxMm)
		dy := float64(av.HeadPose.PyMm - src.HeadPose.PyMm)
		dz := float64(av.HeadPose.PzMm - src.HeadPose.PzMm)
		if dx*dx+dy*dy+dz*dz <= radiusSq {
			out = append(out, uid)
		}
	}
	return out
}

// ---- LOD auto-demote ----

func (s *matchState) evaluateLOD(dispatcher runtime.MatchDispatcher, matchTimeMs int64) {
	if !s.init.EnableLODAutoDemote {
		return
	}
	// Simple v1 policy: per-pair distance band → LOD.
	//   < AOI                → LOD 0 (full)
	//   AOI to 2 × AOI       → LOD 1 (mid)
	//   2 × AOI to 3 × AOI   → LOD 2 (low)
	//   > 3 × AOI            → LOD 3 (billboard)
	r1 := float64(s.init.AOIRadiusMm)
	r2 := r1 * 2
	r3 := r1 * 3
	for uid, av := range s.avatars {
		if av.HeadPose == nil {
			continue
		}
		// Find nearest peer to determine LOD.
		nearest := math.MaxFloat64
		for uid2, av2 := range s.avatars {
			if uid == uid2 || av2.HeadPose == nil {
				continue
			}
			dx := float64(av2.HeadPose.PxMm - av.HeadPose.PxMm)
			dy := float64(av2.HeadPose.PyMm - av.HeadPose.PyMm)
			dz := float64(av2.HeadPose.PzMm - av.HeadPose.PzMm)
			d := math.Sqrt(dx*dx + dy*dy + dz*dz)
			if d < nearest {
				nearest = d
			}
		}
		var newLOD uint32
		var reason string
		switch {
		case nearest <= r1:
			newLOD, reason = 0, "near"
		case nearest <= r2:
			newLOD, reason = 1, "distance"
		case nearest <= r3:
			newLOD, reason = 2, "distance"
		default:
			newLOD, reason = 3, "distance"
		}
		if newLOD != av.LOD {
			av.LOD = newLOD
			av.LODReason = reason
			s.broadcast(dispatcher, opXRAvatarLOD, mustMarshal(map[string]interface{}{
				"user_id": uid,
				"lod":     newLOD,
				"reason":  reason,
			}), matchTimeMs)
		}
	}
}

// ---- snapshot / flush ----

func (s *matchState) sendSnapshotTo(dispatcher runtime.MatchDispatcher, recipient string, matchTimeMs int64) {
	for uid, av := range s.avatars {
		if uid == recipient {
			continue
		}
		if av.HeadPose != nil {
			s.sendTo(dispatcher, opXRHeadPose, mustMarshal(map[string]interface{}{
				"user_id": uid,
				"pose":    av.HeadPose,
			}), []string{recipient}, matchTimeMs)
		}
		if av.HandLeft != nil {
			s.sendTo(dispatcher, opXRHandPose, mustMarshal(map[string]interface{}{
				"user_id":     uid,
				"is_left":     true,
				"pose":        av.HandLeft,
				"grip_pct":    av.GripL,
				"trigger_pct": av.TriggerL,
			}), []string{recipient}, matchTimeMs)
		}
		if av.HandRight != nil {
			s.sendTo(dispatcher, opXRHandPose, mustMarshal(map[string]interface{}{
				"user_id":     uid,
				"is_left":     false,
				"pose":        av.HandRight,
				"grip_pct":    av.GripR,
				"trigger_pct": av.TriggerR,
			}), []string{recipient}, matchTimeMs)
		}
		if len(av.Body) > 0 {
			s.sendTo(dispatcher, opXRBodyPose, mustMarshal(map[string]interface{}{
				"user_id": uid,
				"joints":  av.Body,
			}), []string{recipient}, matchTimeMs)
		}
		if len(av.Face) > 0 {
			s.sendTo(dispatcher, opXRFaceBlendshape, mustMarshal(map[string]interface{}{
				"user_id":       uid,
				"blendshapes":   av.Face,
				"quant_profile": s.init.DefaultQuantProfile,
			}), []string{recipient}, matchTimeMs)
		}
		if av.LOD > 0 {
			s.sendTo(dispatcher, opXRAvatarLOD, mustMarshal(map[string]interface{}{
				"user_id": uid,
				"lod":     av.LOD,
				"reason":  av.LODReason,
			}), []string{recipient}, matchTimeMs)
		}
	}
}

// flushDirty — once per server tick, relay the most-recent buffered pose
// for each (user, channel) that was written since last flush. Recipients
// are AOI-filtered so distant avatars don't pay the bandwidth cost.
func (s *matchState) flushDirty(dispatcher runtime.MatchDispatcher, matchTimeMs int64) {
	flush := func(dirty map[string]bool, op int, mk func(uid string, av *avatarState) map[string]interface{}) {
		for uid := range dirty {
			av, ok := s.avatars[uid]
			if !ok {
				continue
			}
			payload := mustMarshal(mk(uid, av))
			if recips := s.recipientsFor(uid); recips != nil {
				if len(recips) > 0 {
					s.sendTo(dispatcher, op, payload, recips, matchTimeMs)
				}
			} else {
				// AOI disabled — broadcast except sender.
				peers := make([]string, 0, len(s.avatars)-1)
				for u := range s.avatars {
					if u != uid {
						peers = append(peers, u)
					}
				}
				if len(peers) > 0 {
					s.sendTo(dispatcher, op, payload, peers, matchTimeMs)
				}
			}
		}
		for uid := range dirty {
			delete(dirty, uid)
		}
	}

	flush(s.dirtyHead, opXRHeadPose, func(uid string, av *avatarState) map[string]interface{} {
		return map[string]interface{}{"user_id": uid, "pose": av.HeadPose}
	})
	flush(s.dirtyHandL, opXRHandPose, func(uid string, av *avatarState) map[string]interface{} {
		return map[string]interface{}{
			"user_id": uid, "is_left": true, "pose": av.HandLeft,
			"grip_pct": av.GripL, "trigger_pct": av.TriggerL,
		}
	})
	flush(s.dirtyHandR, opXRHandPose, func(uid string, av *avatarState) map[string]interface{} {
		return map[string]interface{}{
			"user_id": uid, "is_left": false, "pose": av.HandRight,
			"grip_pct": av.GripR, "trigger_pct": av.TriggerR,
		}
	})
	flush(s.dirtyBody, opXRBodyPose, func(uid string, av *avatarState) map[string]interface{} {
		return map[string]interface{}{"user_id": uid, "joints": av.Body}
	})
	flush(s.dirtyFace, opXRFaceBlendshape, func(uid string, av *avatarState) map[string]interface{} {
		return map[string]interface{}{
			"user_id":       uid,
			"blendshapes":   av.Face,
			"quant_profile": s.init.DefaultQuantProfile,
		}
	})
	flush(s.dirtyFingerL, opXRFingerPose, func(uid string, av *avatarState) map[string]interface{} {
		return map[string]interface{}{"user_id": uid, "is_left": true, "finger_curls": av.FingerLeft}
	})
	flush(s.dirtyFingerR, opXRFingerPose, func(uid string, av *avatarState) map[string]interface{} {
		return map[string]interface{}{"user_id": uid, "is_left": false, "finger_curls": av.FingerRight}
	})

	// Voice position relay — emit one broadcast per moved avatar so the voice
	// provider attached to this match can apply HRTF spatialization.
	if s.init.VoicePositionRelay {
		for uid, av := range s.avatars {
			if av.HeadPose == nil {
				continue
			}
			payload := mustMarshal(map[string]interface{}{
				"user_id":             uid,
				"head":                av.HeadPose,
				"talking_volume_pct":  0,
				"frame_id":            s.init.SpatialFrameID,
				"voice_room_id":       s.init.VoiceRoomID,
			})
			// Voice-position messages are AOI-filtered same as head pose.
			recips := s.recipientsFor(uid)
			if recips == nil {
				peers := make([]string, 0, len(s.avatars)-1)
				for u := range s.avatars {
					if u != uid {
						peers = append(peers, u)
					}
				}
				recips = peers
			}
			if len(recips) > 0 {
				s.sendTo(dispatcher, opXRVoicePosition, payload, recips, matchTimeMs)
			}
		}
	}
}

// ---- error / warn senders ----

func (s *matchState) sendError(dispatcher runtime.MatchDispatcher, userIDs []string, code int, detail string, matchTimeMs int64) {
	s.sendTo(dispatcher, opError, mustMarshal(map[string]interface{}{
		"code":   code,
		"detail": detail,
	}), userIDs, matchTimeMs)
}

func (s *matchState) sendWarn(dispatcher runtime.MatchDispatcher, userID string, op int, channel string, hzMax int, matchTimeMs int64) {
	s.sendTo(dispatcher, op, mustMarshal(map[string]interface{}{
		"channel": channel,
		"hz_max":  hzMax,
	}), []string{userID}, matchTimeMs)
}

// ---- broadcast / send ----

func (s *matchState) broadcast(dispatcher runtime.MatchDispatcher, op int, payload []byte, matchTimeMs int64) {
	envCopy := envelopeHeader{
		WireVersion:      wireVersion,
		Op:               op,
		Seq:              atomic.AddUint64(&s.outboundSeq, 1) - 1,
		MatchTimeMs:      matchTimeMs,
		SenderUserID:     systemSenderID,
		MatchID:          s.matchID,
		ClientOpcodeUUID: "",
	}
	out, _ := json.Marshal(envelope{H: envCopy, P: payload})
	_ = dispatcher.BroadcastMessage(int64(op), out, nil, nil, true)
}

func (s *matchState) sendTo(dispatcher runtime.MatchDispatcher, op int, payload []byte, userIDs []string, matchTimeMs int64) {
	envCopy := envelopeHeader{
		WireVersion:      wireVersion,
		Op:               op,
		Seq:              atomic.AddUint64(&s.outboundSeq, 1) - 1,
		MatchTimeMs:      matchTimeMs,
		SenderUserID:     systemSenderID,
		MatchID:          s.matchID,
		ClientOpcodeUUID: "",
	}
	out, _ := json.Marshal(envelope{H: envCopy, P: payload})
	pres := make([]runtime.Presence, 0, len(userIDs))
	for _, u := range userIDs {
		pres = append(pres, synthPresence{userID: u})
	}
	_ = dispatcher.BroadcastMessage(int64(op), out, pres, nil, true)
}

type synthPresence struct{ userID string }

func (p synthPresence) GetUserId() string                 { return p.userID }
func (p synthPresence) GetSessionId() string              { return "" }
func (p synthPresence) GetNodeId() string                 { return "" }
func (p synthPresence) GetUsername() string               { return "" }
func (p synthPresence) GetStatus() string                 { return "" }
func (p synthPresence) GetHidden() bool                   { return false }
func (p synthPresence) GetPersistence() bool              { return false }
func (p synthPresence) GetReason() runtime.PresenceReason { return runtime.PresenceReason(0) }

// ---- end match ----

func endMatch(s *matchState, dispatcher runtime.MatchDispatcher, reasonEnum int, matchTimeMs int64) interface{} {
	if s.terminated {
		return nil
	}
	s.terminated = true
	users := make([]string, 0, len(s.avatars))
	for uid := range s.avatars {
		users = append(users, uid)
	}
	resultEnvelope := map[string]interface{}{
		"match_id":        s.matchID,
		"template_id":     templateID,
		"started_unix_ms": s.startUnixMs,
		"ended_unix_ms":   time.Now().UnixMilli(),
		"duration_ms":     matchTimeMs,
		"avatar_count":    len(users),
		"outcomes":        buildOutcomes(s),
	}
	body := mustMarshal(map[string]interface{}{
		"reason":          reasonEnum,
		"result_envelope": resultEnvelope,
	})
	s.broadcast(dispatcher, opMatchEnded, body, matchTimeMs)
	return nil
}

func buildOutcomes(s *matchState) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(s.avatars))
	for _, av := range s.avatars {
		out = append(out, map[string]interface{}{
			"user_id":       av.UserID,
			"is_agent":      av.IsAgent,
			"placement":     0,
			"score":         0,
			"completed":     true,
			"left_early":    false,
			"final_lod":     av.LOD,
			"game_payload":  map[string]interface{}{},
		})
	}
	return out
}

// ---- module init ----

func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	if err := initializer.RegisterMatch(templateID, func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
		return &Match{}, nil
	}); err != nil {
		return fmt.Errorf("register match %q: %w", templateID, err)
	}
	logger.Info("[avatar_replication] registered match handler %q (server tick %d Hz, head %d Hz cap, body %d Hz cap)",
		templateID, defaultTickHz, maxHeadPubHz, maxBodyPubHz)
	return nil
}

// ---- helpers ----

func mustJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func mustMarshal(v interface{}) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func stringFromMap(m map[string]interface{}, k string, fallback string) string {
	if v, ok := m[k]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return fallback
}

func matchIDFromCtx(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v := ctx.Value(runtime.RUNTIME_CTX_MATCH_ID)
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
