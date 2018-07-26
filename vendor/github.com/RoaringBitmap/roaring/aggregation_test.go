package roaring

// to run just these tests: go test -run TestParAggregations

import (
	"fmt"
	"testing"
)

func testAggregations(t *testing.T,
	and func(bitmaps ...*Bitmap) *Bitmap,
	or func(bitmaps ...*Bitmap) *Bitmap,
	xor func(bitmaps ...*Bitmap) *Bitmap) {

	t.Run("simple case", func(t *testing.T) {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb1.Add(1)
		rb2.Add(2)

		if and != nil && and(rb1, rb2).GetCardinality() != 0 {
			t.Error()
		}
		if and != nil && or(rb1, rb2).GetCardinality() != 2 {
			t.Error()
		}
		if xor != nil && xor(rb1, rb2).GetCardinality() != 2 {
			t.Error()
		}
	})

	t.Run("aggregate nothing", func(t *testing.T) {
		if and != nil && and().GetCardinality() != 0 {
			t.Error()
		}

		if or != nil && or().GetCardinality() != 0 {
			t.Error()
		}

		if xor != nil && xor().GetCardinality() != 0 {
			t.Error()
		}
	})

	t.Run("single bitmap", func(t *testing.T) {
		rb := BitmapOf(1, 2, 3)

		if and != nil && and(rb).GetCardinality() != 3 {
			t.Error()
		}

		if or != nil && or(rb).GetCardinality() != 3 {
			t.Error()
		}

		if xor != nil && xor(rb).GetCardinality() != 3 {
			t.Error()
		}
	})

	t.Run("empty and single elem bitmaps", func(t *testing.T) {
		rb1 := NewBitmap()
		rb2 := BitmapOf(1)

		if and != nil && and(rb1, rb2).GetCardinality() != 0 {
			t.Error()
		}

		if or != nil && or(rb1, rb2).GetCardinality() != 1 {
			t.Error()
		}

		if xor != nil && xor(rb1, rb2).GetCardinality() != 1 {
			t.Error()
		}
	})

	t.Run("two single elem disjoint sets", func(t *testing.T) {
		rb1 := BitmapOf(1)
		rb2 := BitmapOf(2)

		if and != nil && and(rb1, rb2).Stats().Containers != 0 {
			t.Error()
		}

		if or != nil && or(rb1, rb2).GetCardinality() != 2 {
			t.Error()
		}
	})

	t.Run("3 bitmaps with CoW set (not in order of definition)", func(t *testing.T) {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()
		rb1.SetCopyOnWrite(true)
		rb2.SetCopyOnWrite(true)
		rb3.SetCopyOnWrite(true)
		rb1.Add(1)
		rb1.Add(100000)
		rb2.Add(200000)
		rb3.Add(1)
		rb3.Add(300000)

		if and != nil && and(rb2, rb1, rb3).GetCardinality() != 0 {
			t.Error()
		}

		if or != nil && or(rb2, rb1, rb3).GetCardinality() != 4 {
			t.Error()
		}

		if xor != nil && xor(rb2, rb1, rb3).GetCardinality() != 3 {
			t.Error()
		}
	})

	t.Run("3 bitmaps (not in order of definition)", func(t *testing.T) {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()
		rb1.Add(1)
		rb1.Add(100000)
		rb2.Add(200000)
		rb3.Add(1)
		rb3.Add(300000)

		if and != nil && and(rb2, rb1, rb3).GetCardinality() != 0 {
			t.Error()
		}

		if or != nil && or(rb2, rb1, rb3).GetCardinality() != 4 {
			t.Error()
		}

		if xor != nil && xor(rb2, rb1, rb3).GetCardinality() != 3 {
			t.Error()
		}
	})

	t.Run("3 bitmaps", func(t *testing.T) {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()
		rb1.Add(1)
		rb1.Add(100000)
		rb2.Add(200000)
		rb3.Add(1)
		rb3.Add(300000)

		if and != nil && and(rb1, rb2, rb3).GetCardinality() != 0 {
			t.Error()
		}

		if or != nil && or(rb1, rb2, rb3).GetCardinality() != 4 {
			t.Error()
		}

		if xor != nil && xor(rb1, rb2, rb3).GetCardinality() != 3 {
			t.Error()
		}
	})

	t.Run("3 bitmaps with CoW set", func(t *testing.T) {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()
		rb1.SetCopyOnWrite(true)
		rb2.SetCopyOnWrite(true)
		rb3.SetCopyOnWrite(true)
		rb1.Add(1)
		rb1.Add(100000)
		rb2.Add(200000)
		rb3.Add(1)
		rb3.Add(300000)

		if and != nil && and(rb1, rb2, rb3).GetCardinality() != 0 {
			t.Error()
		}

		if or != nil && or(rb1, rb2, rb3).GetCardinality() != 4 {
			t.Error()
		}

		if xor != nil && xor(rb1, rb2, rb3).GetCardinality() != 3 {
			t.Error()
		}
	})

	t.Run("advanced case", func(t *testing.T) {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()
		for i := uint32(0); i < 1000000; i += 3 {
			rb1.Add(i)
		}
		for i := uint32(0); i < 1000000; i += 7 {
			rb2.Add(i)
		}
		for i := uint32(0); i < 1000000; i += 1001 {
			rb3.Add(i)
		}
		for i := uint32(1000000); i < 2000000; i += 1001 {
			rb1.Add(i)
		}
		for i := uint32(1000000); i < 2000000; i += 3 {
			rb2.Add(i)
		}
		for i := uint32(1000000); i < 2000000; i += 7 {
			rb3.Add(i)
		}

		rb1.Or(rb2)
		rb1.Or(rb3)
		bigand := And(And(rb1, rb2), rb3)
		bigxor := Xor(Xor(rb1, rb2), rb3)

		if or != nil && !or(rb1, rb2, rb3).Equals(rb1) {
			t.Errorf("Expected bitmap of cardinality %d, got %d", rb1.GetCardinality(), or(rb1, rb2, rb3).GetCardinality())
		}

		if and != nil && !and(rb1, rb2, rb3).Equals(bigand) {
			t.Error()
		}

		if xor != nil && !xor(rb1, rb2, rb3).Equals(bigxor) {
			t.Error()
		}
	})

	t.Run("advanced case with runs", func(t *testing.T) {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()
		for i := uint32(500); i < 75000; i++ {
			rb1.Add(i)
		}
		for i := uint32(0); i < 1000000; i += 7 {
			rb2.Add(i)
		}
		for i := uint32(0); i < 1000000; i += 1001 {
			rb3.Add(i)
		}
		for i := uint32(1000000); i < 2000000; i += 1001 {
			rb1.Add(i)
		}
		for i := uint32(1000000); i < 2000000; i += 3 {
			rb2.Add(i)
		}
		for i := uint32(1000000); i < 2000000; i += 7 {
			rb3.Add(i)
		}
		rb1.RunOptimize()

		rb1.Or(rb2)
		rb1.Or(rb3)
		bigand := And(And(rb1, rb2), rb3)
		bigxor := Xor(Xor(rb1, rb2), rb3)

		if or != nil && !or(rb1, rb2, rb3).Equals(rb1) {
			t.Errorf("Expected bitmap of cardinality %d, got %d", rb1.GetCardinality(), or(rb1, rb2, rb3).GetCardinality())
		}

		if and != nil && !and(rb1, rb2, rb3).Equals(bigand) {
			t.Error()
		}

		if xor != nil && !xor(rb1, rb2, rb3).Equals(bigxor) {
			t.Error()
		}
	})

	t.Run("issue 178", func(t *testing.T) {
		ba1 := []uint32{3585028, 65901253, 143441994, 211160474, 286511937, 356744840, 434332509, 502812785, 576097614, 646557334, 714794241, 775083485, 833704249, 889329147, 941367043}
		ba2 := []uint32{17883, 54494426, 113908938, 174519827, 235465665, 296685741, 357644666, 420192495, 476104304, 523046142, 577855081, 634889665, 692460635, 751350463, 809989192, 863494316, 919127240}

		r1 := BitmapOf(ba1...)
		r2 := BitmapOf(ba2...)

		result := or(r1, r2)
		if result.GetCardinality() != 32 {
			t.Errorf("Expected bitmap of cardinality %d, got %d", 32, result.GetCardinality())
		}
	})
}

func TestParAggregations(t *testing.T) {
	for _, p := range [...]int{1, 2, 4} {
		andFunc := func(bitmaps ...*Bitmap) *Bitmap {
			return ParAnd(p, bitmaps...)
		}
		orFunc := func(bitmaps ...*Bitmap) *Bitmap {
			return ParOr(p, bitmaps...)
		}

		t.Run(fmt.Sprintf("par%d", p), func(t *testing.T) {
			testAggregations(t, andFunc, orFunc, nil)
		})
	}
}

func TestParHeapAggregations(t *testing.T) {
	orFunc := func(bitmaps ...*Bitmap) *Bitmap {
		return ParHeapOr(0, bitmaps...)
	}

	testAggregations(t, nil, orFunc, nil)
}

func TestFastAggregations(t *testing.T) {
	testAggregations(t, FastAnd, FastOr, nil)
}

func TestHeapAggregations(t *testing.T) {
	testAggregations(t, nil, HeapOr, HeapXor)
}
