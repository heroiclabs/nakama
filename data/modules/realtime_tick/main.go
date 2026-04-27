// Package main — RealtimeTickMatch as a native Nakama Go runtime module.
//
// Why Go and not the JS runtime:
//   * The Goja-based JS runtime is fine for sync-turn / async / lobby
//     templates that tick at 1–4 Hz, but at 10–30 Hz with N players the
//     per-tick allocation cost from JS-managed objects + JSON marshaling
//     dominates. Go runs natively with stable per-tick latency and zero
//     JIT warm-up.
//   * Reusable WebRTC signaling relay (in-band on the match) lives here
//     so realtime games can opt into P2P handoff for sub-50ms paths
//     while the kernel still owns authoritative state.
//
// Wire contract:
//   * Reserved opcode range 0x6000–0x6FFF (matches schemas/multiplayer/
//     opcodes.proto); WebRTC signaling sub-range 0x6080–0x60FF.
//   * Same envelope shape as JS templates: {h:{wire_version, op, seq,
//     match_time_ms, sender_user_id, match_id, client_opcode_uuid}, p:{...}}.
//   * Server-origin broadcasts share a single seq counter to satisfy
//     conformance test 06 (seq monotonicity).
//
// Match handler responsibilities:
//   1. Drive a deterministic tick at configurable Hz (10/15/20/30).
//   2. Collect OP_TICK_INPUT messages each tick.
//   3. Apply inputs to opaque per-match game state (game plugins extend
//      via a registered TickGenerator; default is an echo generator).
//   4. Broadcast OP_TICK_SNAPSHOT (full) every snapshot_interval_ticks,
//      OP_TICK_DELTA (incremental) on intermediate ticks.
//   5. Send OP_TICK_RECONCILE privately when an input is rejected /
//      reconciled past server-side validation.
//   6. Periodic OP_TICK_HEARTBEAT broadcast for clock alignment.
//   7. Relay WebRTC SDP/ICE between peers via the signaling sub-range.
//   8. Track per-player quality (RTT/jitter/loss) from OP_TICK_QUALITY_REPORT
//      and emit OP_TICK_RATE_PROPOSAL if an individual client is degraded.
//   9. End match on duration cap or quorum loss.
//
// This module registers itself as a match handler under the template id
// "realtime-tick-v1" so the JS kernel's `mp_create_match` RPC can spin
// up matches of this template by name.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	// Match registration name (must match TEMPLATE_IDS.REALTIME_TICK_V1
	// in nakama/data/modules/src/multiplayer-kernel/index.ts).
	templateID = "realtime-tick-v1"

	// Wire constants — mirror schemas/multiplayer/opcodes.proto.
	opTickInput            = 0x6000
	opTickSnapshot         = 0x6001
	opTickDelta            = 0x6002
	opTickReconcile        = 0x6003
	opTickHeartbeat        = 0x6004
	opTickQualityReport    = 0x6005
	opTickRateProposal     = 0x6006
	opTickWebRTCOffer      = 0x6080
	opTickWebRTCAnswer     = 0x6081
	opTickWebRTCICE        = 0x6082
	opTickWebRTCBye        = 0x6083
	opTickWebRTCHandoff    = 0x6084
	opMatchEnded           = 0x0007 // kernel.proto OP_MATCH_ENDED
	opError                = 0x0008

	// kernel.proto EndReason mirror.
	endReasonCompleted        = 1
	endReasonTimeout          = 2
	endReasonQuorumLost       = 3
	endReasonDurationExceeded = 6
	endReasonKernelInternal   = 7

	// envelope.proto ErrorCode mirror.
	errBadPayload  = 3
	errRateLimited = 23
	errStateOverflow = 83

	// Defaults.
	defaultTickHz                = 20
	defaultSnapshotIntervalTicks = 6 // = ~3.3 Hz at 20 Hz tick
	defaultMaxPlayers            = 8
	defaultMinPlayers            = 2
	defaultReconnectGraceMs      = 60_000
	defaultMaxMatchDurationMs    = 30 * 60 * 1000 // 30 min hard cap
	defaultHeartbeatEveryTicks   = 60             // 3s at 20 Hz
	wireVersion                  = 1
	maxInputsPerTickPerPlayer    = 4 // rate-limit; excess gets WARN_RATE_LIMITED
	maxStateSizeBytes            = 64 * 1024
	systemSenderID               = "server"
)

// initParams shapes the JSON in template_init that mp_create_match forwards.
type initParams struct {
	GameID                 string                 `json:"game_id"`
	TickHz                 int                    `json:"tick_hz"`
	SnapshotIntervalTicks  int                    `json:"snapshot_interval_ticks"`
	MinPlayers             int                    `json:"min_players"`
	MaxPlayers             int                    `json:"max_players"`
	MaxMatchDurationMs     int64                  `json:"max_match_duration_ms"`
	ReconnectGraceMs       int64                  `json:"reconnect_grace_ms"`
	GeneratorID            string                 `json:"generator_id"`
	GeneratorParams        map[string]interface{} `json:"generator_params"`
	WebRTCSignalingURL     string                 `json:"webrtc_signaling_url"`
	WebRTCAllowed          bool                   `json:"webrtc_allowed"`
	WebRTCStunServers      []string               `json:"webrtc_stun_servers"`
}

// playerState — per-player bookkeeping inside the match.
type playerState struct {
	UserID         string
	IsAgent        bool
	JoinedAtMatchMs int64
	LastInputTick  int
	LastInputSeq   uint64
	InputsThisTick int
	RTTms          int
	JitterMs       int
	LossPct        float64
	WebRTCActive   bool
}

// matchState — runtime state per match.
type matchState struct {
	init                    initParams
	tickHz                  int
	tickPeriodMs            int64
	snapshotIntervalTicks   int
	heartbeatEveryTicks     int
	startUnixMs             int64
	matchTimeMsAtTick0      int64
	currentTick             int
	matchEndAtUnixMs        int64
	pendingEndReason        string
	players                 map[string]*playerState
	pendingInputs           []pendingInput // collected this tick
	gameState               map[string]interface{} // opaque
	lastSnapshotTick        int
	outboundSeq             uint64
	matchID                 string
	terminated              bool
	gen                     TickGenerator
}

// pendingInput — buffered input awaiting tick processing.
type pendingInput struct {
	UserID         string
	Seq            uint64
	OpCode         int64
	Payload        json.RawMessage
	ReceivedAtMatchMs int64
}

// TickGenerator — game-plugin contract. Default = echo (relay).
type TickGenerator interface {
	GeneratorID() string
	InitState(params map[string]interface{}) map[string]interface{}
	ApplyInputs(state map[string]interface{}, inputs []GeneratorInput, tick int) (newState map[string]interface{}, deltaPayload map[string]interface{}, reconciles []ReconcileMsg)
	BuildSnapshot(state map[string]interface{}, tick int) map[string]interface{}
	BuildResult(state map[string]interface{}, players []string) map[string]interface{}
}

type GeneratorInput struct {
	UserID  string
	Seq     uint64
	Payload map[string]interface{}
	OpCode  int64
}

type ReconcileMsg struct {
	UserID  string
	Reason  string
	Payload map[string]interface{}
}

// Echo generator: just keeps last 32 inputs as state.
type echoGenerator struct{}

func (echoGenerator) GeneratorID() string { return "tick-echo" }
func (echoGenerator) InitState(_ map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"history": []interface{}{},
		"size":    0,
	}
}
func (echoGenerator) ApplyInputs(state map[string]interface{}, inputs []GeneratorInput, tick int) (map[string]interface{}, map[string]interface{}, []ReconcileMsg) {
	hist, _ := state["history"].([]interface{})
	for _, in := range inputs {
		hist = append(hist, map[string]interface{}{
			"u": in.UserID, "s": in.Seq, "p": in.Payload, "t": tick,
		})
	}
	if len(hist) > 32 {
		hist = hist[len(hist)-32:]
	}
	state["history"] = hist
	state["size"] = len(hist)
	delta := map[string]interface{}{
		"applied":     len(inputs),
		"latest":      hist[len(hist)-min(1, len(inputs)):],
		"latest_tick": tick,
	}
	return state, delta, nil
}
func (echoGenerator) BuildSnapshot(state map[string]interface{}, tick int) map[string]interface{} {
	return map[string]interface{}{
		"tick":  tick,
		"state": state,
	}
}
func (echoGenerator) BuildResult(state map[string]interface{}, players []string) map[string]interface{} {
	return map[string]interface{}{
		"players":   players,
		"final_tick": state["size"],
	}
}

// Generator registry. Game plugins call RegisterGenerator() at init.
var generators = map[string]TickGenerator{}

func registerGenerator(g TickGenerator) {
	generators[g.GeneratorID()] = g
}

// envelope — wire format (matches JS templates).
type envelope struct {
	H envelopeHeader  `json:"h"`
	P json.RawMessage `json:"p"`
}

type envelopeHeader struct {
	WireVersion       int    `json:"wire_version"`
	Op                int    `json:"op"`
	Seq               uint64 `json:"seq"`
	MatchTimeMs       int64  `json:"match_time_ms"`
	SenderUserID      string `json:"sender_user_id"`
	MatchID           string `json:"match_id"`
	ClientOpcodeUUID  string `json:"client_opcode_uuid"`
}

// Match implements runtime.Match.
type Match struct{}

func (m *Match) MatchInit(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	init := initParams{
		TickHz:                defaultTickHz,
		SnapshotIntervalTicks: defaultSnapshotIntervalTicks,
		MinPlayers:            defaultMinPlayers,
		MaxPlayers:            defaultMaxPlayers,
		MaxMatchDurationMs:    defaultMaxMatchDurationMs,
		ReconnectGraceMs:      defaultReconnectGraceMs,
		WebRTCAllowed:         false,
	}
	if rawTI, ok := params["template_init"]; ok && rawTI != nil {
		// template_init arrives as map[string]interface{} from Goja JS bridge
		// or json.RawMessage from internal callers. Normalize via json.
		if b, err := json.Marshal(rawTI); err == nil {
			_ = json.Unmarshal(b, &init)
		}
	}
	if init.TickHz < 5 {
		init.TickHz = 5
	}
	if init.TickHz > 60 {
		init.TickHz = 60
	}
	if init.MaxPlayers < init.MinPlayers {
		init.MaxPlayers = init.MinPlayers
	}
	if init.SnapshotIntervalTicks <= 0 {
		init.SnapshotIntervalTicks = defaultSnapshotIntervalTicks
	}
	gen, ok := generators[init.GeneratorID]
	if !ok {
		gen = echoGenerator{}
	}
	now := time.Now().UnixMilli()
	state := &matchState{
		init:                  init,
		tickHz:                init.TickHz,
		tickPeriodMs:          int64(1000 / init.TickHz),
		snapshotIntervalTicks: init.SnapshotIntervalTicks,
		heartbeatEveryTicks:   defaultHeartbeatEveryTicks,
		startUnixMs:           now,
		matchTimeMsAtTick0:    0,
		matchEndAtUnixMs:      now + init.MaxMatchDurationMs,
		players:               map[string]*playerState{},
		gameState:             gen.InitState(init.GeneratorParams),
		outboundSeq:           1,
		gen:                   gen,
		// Force the first snapshot on tick 0 so late-joiners always get an
		// authoritative state ASAP (otherwise the first snapshot would be
		// snapshotIntervalTicks-1 ticks late = up to 300 ms at 20 Hz / 6).
		lastSnapshotTick: -init.SnapshotIntervalTicks,
	}
	gameID := stringFromMap(params, "game_id", init.GameID)
	label := mustJSON(map[string]interface{}{
		"template_id":     templateID,
		"game_id":         gameID,
		"tick_hz":         init.TickHz,
		"max_players":     init.MaxPlayers,
		"min_players":     init.MinPlayers,
		"webrtc_allowed":  init.WebRTCAllowed,
	})
	logger.Info("[realtime_tick] match init template=%s tickHz=%d max=%d webrtc=%v",
		templateID, init.TickHz, init.MaxPlayers, init.WebRTCAllowed)
	return state, init.TickHz, label
}

func (m *Match) MatchJoinAttempt(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presence runtime.Presence, metadata map[string]string) (interface{}, bool, string) {
	s := state.(*matchState)
	if s.terminated {
		return s, false, "match ended"
	}
	if len(s.players) >= s.init.MaxPlayers {
		return s, false, "match full"
	}
	return s, true, ""
}

func (m *Match) MatchJoin(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*matchState)
	for _, p := range presences {
		if _, ok := s.players[p.GetUserId()]; ok {
			continue
		}
		s.players[p.GetUserId()] = &playerState{
			UserID:          p.GetUserId(),
			IsAgent:         len(p.GetUserId()) > 4 && p.GetUserId()[:4] == "agt_",
			JoinedAtMatchMs: int64(tick) * s.tickPeriodMs,
		}
	}
	return s
}

func (m *Match) MatchLeave(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*matchState)
	for _, p := range presences {
		delete(s.players, p.GetUserId())
	}
	if len(s.players) < s.init.MinPlayers && len(s.players) > 0 {
		// quorum_lost: if we drop below min, remaining player gets a
		// reconnect grace window before the kernel ends the match.
		// Simple v1 implementation: end immediately. Future: track
		// pending_grace_until and only force end after grace.
		s.pendingEndReason = "quorum_lost"
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

	// 0. Hard-cap match duration.
	if nowUnixMs > s.matchEndAtUnixMs {
		s.pendingEndReason = "duration_exceeded"
		return endMatch(s, dispatcher, endReasonDurationExceeded, matchTimeMs)
	}

	// 1. Reset per-player input counters.
	for _, p := range s.players {
		p.InputsThisTick = 0
	}

	// 2. Drain inbound messages.
	// NB: rename loop var to avoid shadowing the *Match receiver.
	for _, msg := range messages {
		s.handleInbound(msg, dispatcher, logger, matchTimeMs)
	}

	// 3. Apply collected inputs to game state.
	if len(s.pendingInputs) > 0 && s.gen != nil {
		genInputs := make([]GeneratorInput, 0, len(s.pendingInputs))
		for _, pi := range s.pendingInputs {
			var p map[string]interface{}
			_ = json.Unmarshal(pi.Payload, &p)
			genInputs = append(genInputs, GeneratorInput{
				UserID:  pi.UserID,
				Seq:     pi.Seq,
				Payload: p,
				OpCode:  pi.OpCode,
			})
		}
		newState, deltaPayload, reconciles := s.gen.ApplyInputs(s.gameState, genInputs, int(tick))
		s.gameState = newState
		// Broadcast delta.
		if deltaPayload != nil && len(deltaPayload) > 0 {
			s.broadcast(dispatcher, opTickDelta, mustMarshal(map[string]interface{}{
				"tick":  int(tick),
				"delta": deltaPayload,
			}), matchTimeMs)
		}
		// Send per-player reconciles.
		for _, rc := range reconciles {
			s.sendTo(dispatcher, opTickReconcile, mustMarshal(map[string]interface{}{
				"reason":  rc.Reason,
				"payload": rc.Payload,
			}), []string{rc.UserID}, matchTimeMs)
		}
		s.pendingInputs = s.pendingInputs[:0]
	}

	// 4. Periodic snapshot + heartbeat.
	if int(tick)-s.lastSnapshotTick >= s.snapshotIntervalTicks {
		snap := s.gen.BuildSnapshot(s.gameState, int(tick))
		body, err := json.Marshal(snap)
		if err == nil {
			if len(body) > maxStateSizeBytes {
				logger.Warn("[realtime_tick] snapshot >%d bytes (size=%d) — emitting WARN_MATCH_STATE_LARGE",
					maxStateSizeBytes, len(body))
				// Wire warning is on the kernel control range; we use opError
				// with state_overflow code as a graceful degradation path.
				s.broadcast(dispatcher, opError, mustMarshal(map[string]interface{}{
					"code":   errStateOverflow,
					"detail": fmt.Sprintf("state %d > %d bytes", len(body), maxStateSizeBytes),
				}), matchTimeMs)
			} else {
				s.broadcast(dispatcher, opTickSnapshot, body, matchTimeMs)
			}
		}
		s.lastSnapshotTick = int(tick)
	}
	if int(tick)%s.heartbeatEveryTicks == 0 {
		s.broadcast(dispatcher, opTickHeartbeat, mustMarshal(map[string]interface{}{
			"tick":         int(tick),
			"server_unix_ms": nowUnixMs,
			"match_time_ms":  matchTimeMs,
		}), matchTimeMs)
	}

	// 5. End-condition: pending end reason set by leave / duration / quorum.
	if s.pendingEndReason != "" {
		var reasonEnum int
		switch s.pendingEndReason {
		case "quorum_lost":
			reasonEnum = endReasonQuorumLost
		case "duration_exceeded":
			reasonEnum = endReasonDurationExceeded
		case "completed":
			reasonEnum = endReasonCompleted
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
	logger.Info("[realtime_tick] terminate match=%s tick=%d grace=%d", s.matchID, tick, graceSeconds)
	return s
}

func (m *Match) MatchSignal(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, data string) (interface{}, string) {
	// Out-of-band signal; e.g. admin force-end. v1 supports "force_end".
	s := state.(*matchState)
	if data == "force_end" {
		s.pendingEndReason = "host_disband"
	}
	return s, ""
}

// ---- helpers ----

func (s *matchState) handleInbound(m runtime.MatchData, dispatcher runtime.MatchDispatcher, logger runtime.Logger, matchTimeMs int64) {
	op := int(m.GetOpCode())
	user := m.GetUserId()
	pl, ok := s.players[user]
	if !ok {
		// Not-a-member writes ignored — Nakama already filters at presence
		// level, but we still guard.
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

	switch op {
	case opTickInput:
		if pl.InputsThisTick >= maxInputsPerTickPerPlayer {
			s.sendTo(dispatcher, opError, mustMarshal(map[string]interface{}{
				"code":         errRateLimited,
				"detail":       "too many inputs this tick",
				"limit":        maxInputsPerTickPerPlayer,
			}), []string{user}, matchTimeMs)
			return
		}
		pl.InputsThisTick++
		pl.LastInputSeq = env.H.Seq
		pl.LastInputTick = s.currentTick
		s.pendingInputs = append(s.pendingInputs, pendingInput{
			UserID: user, Seq: env.H.Seq, OpCode: int64(op),
			Payload: env.P, ReceivedAtMatchMs: matchTimeMs,
		})
	case opTickQualityReport:
		var qr struct {
			RTTms    int     `json:"rtt_ms"`
			JitterMs int     `json:"jitter_ms"`
			LossPct  float64 `json:"loss_pct"`
		}
		_ = json.Unmarshal(env.P, &qr)
		pl.RTTms = qr.RTTms
		pl.JitterMs = qr.JitterMs
		pl.LossPct = qr.LossPct
		// If client is degraded, propose a lower tick rate.
		if qr.RTTms > 250 || qr.LossPct > 0.10 {
			s.sendTo(dispatcher, opTickRateProposal, mustMarshal(map[string]interface{}{
				"proposed_tick_hz": max(s.tickHz/2, 5),
				"reason":           "degraded_link",
			}), []string{user}, matchTimeMs)
		}
	case opTickWebRTCOffer, opTickWebRTCAnswer, opTickWebRTCICE, opTickWebRTCBye:
		s.relayWebRTC(env, dispatcher, user, op, matchTimeMs)
	default:
		// Unknown op in our range — ignore silently to avoid amplifying
		// chatty clients; could surface as WARN later.
	}
}

func (s *matchState) relayWebRTC(env envelope, dispatcher runtime.MatchDispatcher, fromUser string, op int, matchTimeMs int64) {
	if !s.init.WebRTCAllowed {
		s.sendTo(dispatcher, opError, mustMarshal(map[string]interface{}{
			"code":   errBadPayload,
			"detail": "webrtc disabled for this match",
		}), []string{fromUser}, matchTimeMs)
		return
	}
	// Payload must include "to": "<user_id>" for unicast routing.
	var p struct {
		To string `json:"to"`
	}
	_ = json.Unmarshal(env.P, &p)
	if p.To == "" || s.players[p.To] == nil {
		s.sendTo(dispatcher, opError, mustMarshal(map[string]interface{}{
			"code":   errBadPayload,
			"detail": "webrtc relay missing/unknown 'to'",
		}), []string{fromUser}, matchTimeMs)
		return
	}
	// Stamp the sender server-side; we don't trust client-provided sender_user_id.
	envCopy := envelopeHeader{
		WireVersion:  wireVersion,
		Op:           op,
		Seq:          atomic.AddUint64(&s.outboundSeq, 1) - 1,
		MatchTimeMs:  matchTimeMs,
		SenderUserID: fromUser,
		MatchID:      s.matchID,
		ClientOpcodeUUID: env.H.ClientOpcodeUUID,
	}
	out, _ := json.Marshal(envelope{H: envCopy, P: env.P})
	pres := s.presenceForUser(p.To)
	if pres != nil {
		_ = dispatcher.BroadcastMessage(int64(op), out, []runtime.Presence{pres}, nil, true)
	}
	if op == opTickWebRTCOffer || op == opTickWebRTCAnswer {
		s.players[fromUser].WebRTCActive = true
		s.players[p.To].WebRTCActive = true
	}
}

func (s *matchState) presenceForUser(userID string) runtime.Presence {
	// We can't enumerate active presences from MatchData; we rely on
	// dispatcher.BroadcastMessage with the user_ids slice via target.
	// Use a synthetic presence; runtime accepts anything implementing
	// Presence with a UserId match for routing.
	return synthPresence{userID: userID}
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

func endMatch(s *matchState, dispatcher runtime.MatchDispatcher, reasonEnum int, matchTimeMs int64) interface{} {
	if s.terminated {
		return nil
	}
	s.terminated = true
	players := make([]string, 0, len(s.players))
	for u := range s.players {
		players = append(players, u)
	}
	resultEnvelope := map[string]interface{}{
		"match_id":          s.matchID,
		"template_id":       templateID,
		"started_unix_ms":   s.startUnixMs,
		"ended_unix_ms":     time.Now().UnixMilli(),
		"duration_ms":       matchTimeMs,
		"outcomes":          buildOutcomes(s),
		"game_payload":      s.gen.BuildResult(s.gameState, players),
	}
	body := mustMarshal(map[string]interface{}{
		"reason":          reasonEnum,
		"result_envelope": resultEnvelope,
	})
	s.broadcast(dispatcher, opMatchEnded, body, matchTimeMs)
	return nil
}

func buildOutcomes(s *matchState) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(s.players))
	for _, p := range s.players {
		out = append(out, map[string]interface{}{
			"user_id":     p.UserID,
			"is_agent":    p.IsAgent,
			"placement":   0,
			"score":       0,
			"completed":   true,
			"left_early":  false,
			"game_payload": map[string]interface{}{},
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
	logger.Info("[realtime_tick] registered match handler %q (Hz=10..30, default=%d)", templateID, defaultTickHz)
	return nil
}

// ---- generic helpers (kept inlined to avoid extra files) ----

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

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Unused but documents that the match module owes a generator-registration
// hook to game plugins. Kept exported so future plugin packages can link
// against this binary.
var ErrNoGenerator = errors.New("realtime_tick: no generator registered")

var _ = registerGenerator // silence unused-fn
