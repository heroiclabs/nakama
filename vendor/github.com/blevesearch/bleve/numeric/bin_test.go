package numeric

import "testing"

func TestInterleaveDeinterleave(t *testing.T) {
	tests := []struct {
		v1 uint64
		v2 uint64
	}{
		{0, 0},
		{1, 1},
		{27, 39},
		{1<<32 - 1, 1<<32 - 1}, // largest that should still work
	}

	for _, test := range tests {
		i := Interleave(test.v1, test.v2)
		gotv1 := Deinterleave(i)
		gotv2 := Deinterleave(i >> 1)
		if gotv1 != test.v1 {
			t.Errorf("expected v1: %d, got %d, interleaved was %x", test.v1, gotv1, i)
		}
		if gotv2 != test.v2 {
			t.Errorf("expected v2: %d, got %d, interleaved was %x", test.v2, gotv2, i)
		}
	}
}
