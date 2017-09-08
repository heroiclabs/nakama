package netcode

import (
	"testing"
)

func TestReplayProtection_Reset(t *testing.T) {
	r := NewReplayProtection()
	for _, p := range r.ReceivedPacket {
		if p != 0xFFFFFFFFFFFFFFFF {
			t.Fatalf("packet was not reset")
		}
	}
}

func TestReplayProtection(t *testing.T) {
	r := NewReplayProtection()
	for i := 0; i < 2; i += 1 {
		r.Reset()
		if r.MostRecentSequence != 0 {
			t.Fatalf("sequence was not 0")
		}

		// sequence numbers with high bit set should be ignored
		sequence := uint64(1 << 63)
		if r.AlreadyReceived(sequence) {
			t.Fatalf("sequence numbers with high bit set should be ignored")
		}

		if r.MostRecentSequence != 0 {
			t.Fatalf("sequence was not 0 after high-bit check got: 0x%x\n", r.MostRecentSequence)
		}

		// the first time we receive packets, they should not be already received
		maxSequence := uint64(REPLAY_PROTECTION_BUFFER_SIZE * 4)
		for sequence = 0; sequence < maxSequence; sequence += 1 {
			if r.AlreadyReceived(sequence) {
				t.Fatalf("the first time we receive packets, they should not be already received")
			}
		}

		// old packets outside buffer should be considered already received
		if !r.AlreadyReceived(0) {
			t.Fatalf("old packets outside buffer should be considered already received")
		}

		// packets received a second time should be flagged already received
		for sequence = maxSequence - 10; sequence < maxSequence; sequence += 1 {
			if !r.AlreadyReceived(sequence) {
				t.Fatalf("packets received a second time should be flagged already received")
			}
		}

		// jumping ahead to a much higher sequence should be considered not already received
		if r.AlreadyReceived(maxSequence + REPLAY_PROTECTION_BUFFER_SIZE) {
			t.Fatalf("jumping ahead to a much higher sequence should be considered not already received")
		}

		// old packets should be considered already received
		for sequence = 0; sequence < maxSequence; sequence += 1 {
			if !r.AlreadyReceived(sequence) {
				t.Fatalf("old packets should be considered already received")
			}
		}
	}
}
