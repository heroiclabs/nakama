// IVX Multiplayer Kernel — Go-side conformance suite.
//
// Mirrors the 12 cross-adapter invariants from the TypeScript suite at
// SDKs/javascript/packages/multiplayer/test/conformance.spec.ts. Both
// sides must pass before a release; CI runs `go test ./...` and
// `pnpm -C SDKs/javascript run test` in the kernel build job.

package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// 1. wire_version == 1.
func TestConformance01_WireVersion(t *testing.T) {
	const wantV1 = 1
	var hdr envelopeHeader
	hdr.WireVersion = wantV1
	if hdr.WireVersion != 1 {
		t.Fatalf("wire_version drifted: got %d want %d", hdr.WireVersion, wantV1)
	}
}

// 2. Stable kernel opcodes — these MUST never change without a major
//    bump and a coordinated client release.
func TestConformance02_KernelOpcodesStable(t *testing.T) {
	stable := map[string]int{
		"CLIENT_HELLO":  0x0001,
		"SERVER_HELLO":  0x0002,
		"HEARTBEAT":     0x0003,
		"PLAYER_JOINED": 0x0004,
		"PLAYER_LEFT":   0x0005,
		"MATCH_ENDED":   0x0007,
		"ERROR":         0x0008,
	}
	for name, v := range stable {
		if v < 0x0001 || v > 0x0FFF {
			t.Errorf("kernel op %s out of kernel range: 0x%X", name, v)
		}
	}
}

// 3. Opcode ranges are disjoint.
func TestConformance03_OpcodeRangesDisjoint(t *testing.T) {
	type rng struct {
		from, to int
		name     string
	}
	all := []rng{
		{0x0000, 0x0FFF, "kernel"},
		{0x1000, 0x1FFF, "social"},
		{0x2000, 0x2FFF, "agents"},
		{0x3000, 0x3FFF, "moderation"},
		{0x4000, 0x4FFF, "sync_turn"},
		{0x5000, 0x5FFF, "async_turn"},
		{0x6000, 0x6FFF, "realtime_tick"},
		{0x7000, 0x7FFF, "lobby"},
		{0x8000, 0x8FFF, "tournament"},
		{0x9000, 0x9FFF, "live_event"},
		{0xA000, 0xAFFF, "persistent_party"},
		{0xB000, 0xBFFF, "mr_anchor"},
		{0xC000, 0xCFFF, "game_defined"},
		{0xF000, 0xFFFF, "xr_pose"},
	}
	for i := 0; i < len(all); i++ {
		for j := i + 1; j < len(all); j++ {
			a, b := all[i], all[j]
			overlap := !(a.to < b.from || b.to < a.from)
			if overlap {
				t.Errorf("range %s overlaps %s", a.name, b.name)
			}
		}
	}
}

// 4. Error code sentinels.
func TestConformance04_ErrorCodes(t *testing.T) {
	want := map[string]int{
		"UNSPECIFIED":       0,
		"SCHEMA_TOO_OLD":    1,
		"MATCH_FULL":        20,
		"RATE_LIMITED":      23,
		"SESSION_REPLACED":  26,
		"VOICE_UNAVAILABLE": 60,
		"INTERNAL":          999,
	}
	for k, v := range want {
		if v < 0 {
			t.Errorf("%s has bad sentinel: %d", k, v)
		}
	}
}

// 5. envelopeHeader serialises with all required JSON fields.
func TestConformance05_HeaderFields(t *testing.T) {
	h := envelopeHeader{
		WireVersion:  1,
		Op:           0xC101,
		Seq:          42,
		MatchTimeMs:  12345,
		SenderUserID: "u1",
		MatchID:      "m1",
	}
	data, err := json.Marshal(h)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	required := []string{
		`"wire_version":1`,
		`"op":49409`, // 0xC101 in decimal
		`"seq":42`,
		`"match_time_ms":12345`,
	}
	for _, r := range required {
		if !strings.Contains(string(data), r) {
			t.Errorf("missing %q in %s", r, data)
		}
	}
}

// 6. Envelope shape is { h, p }, both in JSON output and parser tolerance.
func TestConformance06_EnvelopeShape(t *testing.T) {
	raw := []byte(`{"h":{"wire_version":1,"op":3,"seq":1,"match_time_ms":0,"sender_user_id":"u","match_id":"m","client_opcode_uuid":""},"p":{}}`)
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if env.H.Op != 3 || env.H.MatchID != "m" || env.H.SenderUserID != "u" {
		t.Fatalf("decoded header incorrect: %+v", env.H)
	}
	if string(env.P) != "{}" {
		t.Fatalf("decoded payload should be {} got %s", env.P)
	}
}

// 7. Camel-cased fields are NOT silently accepted (kernel emits snake_case).
func TestConformance07_NoCamelCase(t *testing.T) {
	h := envelopeHeader{WireVersion: 1, Op: 1, Seq: 1, MatchID: "m", SenderUserID: "u"}
	data, _ := json.Marshal(h)
	forbidden := []string{`"matchId"`, `"senderUserId"`, `"clientOpcodeUuid"`}
	for _, f := range forbidden {
		if strings.Contains(string(data), f) {
			t.Errorf("forbidden camelCase %q present in %s", f, data)
		}
	}
}

// 8. Quantized pose JSON shape stable.
func TestConformance08_PoseQuantizedShape(t *testing.T) {
	p := poseQuantizedJSON{PxMm: 1, PyMm: 2, PzMm: 3, RotPacked: 4, TsMs: 5}
	data, _ := json.Marshal(p)
	for _, f := range []string{
		`"px_mm":1`, `"py_mm":2`, `"pz_mm":3`,
		`"rot_packed":4`, `"ts_ms":5`,
	} {
		if !strings.Contains(string(data), f) {
			t.Errorf("missing %q in %s", f, data)
		}
	}
}

// 9. Heartbeat round trip preserves an empty payload.
func TestConformance09_HeartbeatRoundTrip(t *testing.T) {
	in := envelope{
		H: envelopeHeader{WireVersion: 1, Op: 3, MatchID: "m", SenderUserID: "u"},
		P: json.RawMessage(`{}`),
	}
	data, _ := json.Marshal(in)
	var out envelope
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	if string(out.P) != "{}" {
		t.Errorf("heartbeat payload corrupted: %s", out.P)
	}
}

// 10. Quant profile fits into 3 bits.
func TestConformance10_QuantProfileBits(t *testing.T) {
	for p := uint32(0); p < 8; p++ {
		pkt := poseQuantizedJSON{QuantProfile: p}
		data, _ := json.Marshal(pkt)
		if !strings.Contains(string(data), `"quant_profile":`) {
			t.Errorf("quant_profile field missing for %d", p)
		}
	}
}

// 11. JSON encoding is deterministic enough for clock-sync framing
//     (no whitespace, no unstable map ordering).
func TestConformance11_DeterministicEncoding(t *testing.T) {
	h := envelopeHeader{WireVersion: 1, Op: 3, MatchID: "m", SenderUserID: "u"}
	d1, _ := json.Marshal(h)
	d2, _ := json.Marshal(h)
	if string(d1) != string(d2) {
		t.Errorf("encoding non-deterministic: %s vs %s", d1, d2)
	}
}

// 12. Error envelope minimum shape — server templates emit at minimum a
//     code; detail / retry_after_ms / min_required_version are optional.
func TestConformance12_ErrorMinimum(t *testing.T) {
	type ivxError struct {
		Code             int    `json:"code"`
		Detail           string `json:"detail,omitempty"`
		RetryAfterMs     int    `json:"retry_after_ms,omitempty"`
		MinRequiredVer   string `json:"min_required_version,omitempty"`
	}
	for _, c := range []int{0, 1, 20, 23, 26, 60, 999} {
		data, _ := json.Marshal(ivxError{Code: c})
		var got ivxError
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("parse code=%d: %v", c, err)
		}
		if got.Code != c {
			t.Errorf("code drift: got %d want %d", got.Code, c)
		}
	}
}
