package roaring

import (
	"bytes"
	"log"
	"math"
	"math/rand"
	"strconv"
	"testing"
	"unsafe"

	. "github.com/smartystreets/goconvey/convey"
	"github.com/stretchr/testify/assert"
	"github.com/willf/bitset"
)

func TestRoaringIntervalCheck(t *testing.T) {
	r := BitmapOf(1, 2, 3, 1000)
	rangeb := New()
	rangeb.AddRange(10, 1000+1)

	if !r.Intersects(rangeb) {
		t.FailNow()
	}
	rangeb2 := New()
	rangeb2.AddRange(10, 1000)
	if r.Intersects(rangeb2) {
		t.FailNow()
	}

}

func TestRoaringRangeEnd(t *testing.T) {
	r := New()
	r.Add(MaxUint32)
	if 1 != r.GetCardinality() {
		t.FailNow()
	}
	r.RemoveRange(0, MaxUint32)
	if 1 != r.GetCardinality() {
		t.FailNow()
	}
	r.RemoveRange(0, math.MaxUint64)
	if 0 != r.GetCardinality() {
		t.FailNow()
	}
	r.Add(MaxUint32)
	if 1 != r.GetCardinality() {
		t.FailNow()
	}
	r.RemoveRange(0, 0x100000001)
	if 0 != r.GetCardinality() {
		t.FailNow()
	}
	r.Add(MaxUint32)
	if 1 != r.GetCardinality() {
		t.FailNow()
	}
	r.RemoveRange(0, 0x100000000)
	if 0 != r.GetCardinality() {
		t.FailNow()
	}
}

func TestFirstLast(t *testing.T) {
	bm := New()
	bm.AddInt(2)
	bm.AddInt(4)
	bm.AddInt(8)
	if 2 != bm.Minimum() {
		t.Errorf("bad minimum")
		t.FailNow()
	}
	if 8 != bm.Maximum() {
		t.Errorf("bad maximum")
		t.FailNow()
	}

	i := 1 << 5
	for ; i < (1 << 17); i++ {
		bm.AddInt(i)
		if 2 != bm.Minimum() {
			t.Errorf("bad minimum")
			t.FailNow()
		}
		if uint32(i) != bm.Maximum() {
			t.Errorf("bad maximum")
			t.FailNow()
		}
	}

	bm.RunOptimize()

	if 2 != bm.Minimum() {
		t.Errorf("bad minimum")
		t.FailNow()
	}
	if uint32(i-1) != bm.Maximum() {
		t.Errorf("bad maximum")
		t.FailNow()
	}
}

func TestRoaringBitmapBitmapOf(t *testing.T) {
	array := []uint32{5580, 33722, 44031, 57276, 83097}
	bmp := BitmapOf(array...)
	if len(array) != int(bmp.GetCardinality()) {
		t.Errorf("length diff %d!=%d", len(array), bmp.GetCardinality())
		t.FailNow()
	}
	by, _ := bmp.ToBytes()
	if uint64(len(by)) != bmp.GetSerializedSizeInBytes() {
		t.Errorf("bad ToBytes")
		t.FailNow()
	}
}

func TestRoaringBitmapAdd(t *testing.T) {
	array := []uint32{5580, 33722, 44031, 57276, 83097}
	bmp := New()
	for _, v := range array {
		bmp.Add(v)
	}
	if len(array) != int(bmp.GetCardinality()) {
		t.Errorf("length diff %d!=%d", len(array), bmp.GetCardinality())
		t.FailNow()
	}
}

func TestRoaringBitmapAddMany(t *testing.T) {
	array := []uint32{5580, 33722, 44031, 57276, 83097}
	bmp := NewBitmap()
	bmp.AddMany(array)
	if len(array) != int(bmp.GetCardinality()) {
		t.Errorf("length diff %d!=%d", len(array), bmp.GetCardinality())
		t.FailNow()
	}
}

func TestRoaringBitmapAddOffset(t *testing.T) {
	array := []uint32{5580, 33722, 44031, 57276, 83097}
	bmp := NewBitmap()
	bmp.AddMany(array)
	offtest := uint32(25000)
	cop := AddOffset(bmp, offtest)
	// t.Logf("%T %v", cop, cop)
	if len(array) != int(cop.GetCardinality()) {
		t.Errorf("length diff %d!=%d", len(array), bmp.GetCardinality())
		// t.FailNow()
	}
	expected := make([]uint32, len(array))
	for i, x := range array {
		expected[i] = x + offtest
	}
	wout := cop.ToArray()
	t.Logf("%v, %v", wout, expected)
	if len(wout) != len(expected) {
		t.Errorf("length diff %d!=%d", len(wout), len(expected))
	}
	for i, x := range wout {
		if x != expected[i] {
			t.Errorf("found discrepancy %d!=%d", x, expected[i])
		}
	}
}

func TestRoaringInPlaceAndNotBitmapContainer(t *testing.T) {
	bm := NewBitmap()
	for i := 0; i < 8192; i++ {
		bm.Add(uint32(i))
	}
	toRemove := NewBitmap()
	for i := 128; i < 8192; i++ {
		toRemove.Add(uint32(i))
	}
	bm.AndNot(toRemove)

	var b bytes.Buffer
	_, err := bm.WriteTo(&b)
	if err != nil {
		t.Fatal(err)
	}

	bm2 := NewBitmap()
	bm2.ReadFrom(bytes.NewBuffer(b.Bytes()))
	if !bm2.Equals(bm) {
		t.Errorf("expected %s to equal %s", bm2, bm)
	}
}

// https://github.com/RoaringBitmap/roaring/issues/64
func TestFlip64(t *testing.T) {
	bm := New()
	bm.AddInt(0)
	bm.Flip(1, 2)
	i := bm.Iterator()
	if i.Next() != 0 || i.Next() != 1 || i.HasNext() {
		t.Error("expected {0,1}")
	}
}

// https://github.com/RoaringBitmap/roaring/issues/64
func TestFlip64Off(t *testing.T) {
	bm := New()
	bm.AddInt(10)
	bm.Flip(11, 12)
	i := bm.Iterator()
	if i.Next() != 10 || i.Next() != 11 || i.HasNext() {
		t.Error("expected {10,11}")
	}
}

func TestStringer(t *testing.T) {
	v := NewBitmap()
	for i := uint32(0); i < 10; i++ {
		v.Add(i)
	}
	if v.String() != "{0,1,2,3,4,5,6,7,8,9}" {
		t.Error("bad string output")
	}
	v.RunOptimize()
	if v.String() != "{0,1,2,3,4,5,6,7,8,9}" {
		t.Error("bad string output")
	}
}

func TestFastCard(t *testing.T) {
	Convey("fast card", t, func() {
		bm := NewBitmap()
		bm.Add(1)
		bm.AddRange(21, 260000)
		bm2 := NewBitmap()
		bm2.Add(25)
		So(bm2.AndCardinality(bm), ShouldEqual, 1)
		So(bm2.OrCardinality(bm), ShouldEqual, bm.GetCardinality())
		So(bm.AndCardinality(bm2), ShouldEqual, 1)
		So(bm.OrCardinality(bm2), ShouldEqual, bm.GetCardinality())
		So(bm2.AndCardinality(bm), ShouldEqual, 1)
		So(bm2.OrCardinality(bm), ShouldEqual, bm.GetCardinality())
		bm.RunOptimize()
		So(bm2.AndCardinality(bm), ShouldEqual, 1)
		So(bm2.OrCardinality(bm), ShouldEqual, bm.GetCardinality())
		So(bm.AndCardinality(bm2), ShouldEqual, 1)
		So(bm.OrCardinality(bm2), ShouldEqual, bm.GetCardinality())
		So(bm2.AndCardinality(bm), ShouldEqual, 1)
		So(bm2.OrCardinality(bm), ShouldEqual, bm.GetCardinality())
	})
}

func TestIntersects1(t *testing.T) {
	Convey("intersects", t, func() {
		bm := NewBitmap()
		bm.Add(1)
		bm.AddRange(21, 26)
		bm2 := NewBitmap()
		bm2.Add(25)
		So(bm2.Intersects(bm), ShouldEqual, true)
		bm.Remove(25)
		So(bm2.Intersects(bm), ShouldEqual, false)
		bm.AddRange(1, 100000)
		So(bm2.Intersects(bm), ShouldEqual, true)
	})
}

func TestRangePanic(t *testing.T) {
	Convey("TestRangePanic", t, func() {
		bm := NewBitmap()
		bm.Add(1)
		bm.AddRange(21, 26)
		bm.AddRange(9, 14)
		bm.AddRange(11, 16)
	})
}

func TestRangeRemoval(t *testing.T) {
	Convey("TestRangeRemovalPanic", t, func() {
		bm := NewBitmap()
		bm.Add(1)
		bm.AddRange(21, 26)
		bm.AddRange(9, 14)
		bm.RemoveRange(11, 16)
		bm.RemoveRange(1, 26)
		c := bm.GetCardinality()
		So(c, ShouldEqual, 0)
		bm.AddRange(1, 10000)
		c = bm.GetCardinality()
		So(c, ShouldEqual, 10000-1)
		bm.RemoveRange(1, 10000)
		c = bm.GetCardinality()
		So(c, ShouldEqual, 0)
	})
}

func TestRangeRemovalFromContent(t *testing.T) {
	Convey("TestRangeRemovalPanic", t, func() {
		bm := NewBitmap()
		for i := 100; i < 10000; i++ {
			bm.AddInt(i * 3)
		}
		bm.AddRange(21, 26)
		bm.AddRange(9, 14)
		bm.RemoveRange(11, 16)
		bm.RemoveRange(0, 30000)
		c := bm.GetCardinality()
		So(c, ShouldEqual, 00)
	})
}

func TestFlipOnEmpty(t *testing.T) {

	Convey("TestFlipOnEmpty in-place", t, func() {
		bm := NewBitmap()
		bm.Flip(0, 10)
		c := bm.GetCardinality()
		So(c, ShouldEqual, 10)
	})
	Convey("TestFlipOnEmpty, generating new result", t, func() {
		bm := NewBitmap()
		bm = Flip(bm, 0, 10)
		c := bm.GetCardinality()
		So(c, ShouldEqual, 10)
	})
}

func TestBitmapRank(t *testing.T) {
	for N := uint32(1); N <= 1048576; N *= 2 {
		Convey("rank tests"+strconv.Itoa(int(N)), t, func() {
			for gap := uint32(1); gap <= 65536; gap *= 2 {
				rb1 := NewBitmap()
				for x := uint32(0); x <= N; x += gap {
					rb1.Add(x)
				}
				for y := uint32(0); y <= N; y++ {
					if rb1.Rank(y) != uint64((y+1+gap-1)/gap) {
						So(rb1.Rank(y), ShouldEqual, (y+1+gap-1)/gap)
					}
				}
			}
		})
	}
}

func TestBitmapSelect(t *testing.T) {
	for N := uint32(1); N <= 1048576; N *= 2 {
		Convey("rank tests"+strconv.Itoa(int(N)), t, func() {
			for gap := uint32(1); gap <= 65536; gap *= 2 {
				rb1 := NewBitmap()
				for x := uint32(0); x <= N; x += gap {
					rb1.Add(x)
				}
				for y := uint32(0); y <= N/gap; y++ {
					expectedInt := y * gap
					i, err := rb1.Select(y)
					if err != nil {
						t.Fatal(err)
					}

					if i != expectedInt {
						So(i, ShouldEqual, expectedInt)
					}
				}
			}
		})
	}
}

// some extra tests
func TestBitmapExtra(t *testing.T) {
	for N := uint32(1); N <= 65536; N *= 2 {
		Convey("extra tests"+strconv.Itoa(int(N)), t, func() {
			for gap := uint32(1); gap <= 65536; gap *= 2 {
				bs1 := bitset.New(0)
				rb1 := NewBitmap()
				for x := uint32(0); x <= N; x += gap {
					bs1.Set(uint(x))
					rb1.Add(x)
				}
				So(bs1.Count(), ShouldEqual, rb1.GetCardinality())
				So(equalsBitSet(bs1, rb1), ShouldEqual, true)
				for offset := uint32(1); offset <= gap; offset *= 2 {
					bs2 := bitset.New(0)
					rb2 := NewBitmap()
					for x := uint32(0); x <= N; x += gap {
						bs2.Set(uint(x + offset))
						rb2.Add(x + offset)
					}
					So(bs2.Count(), ShouldEqual, rb2.GetCardinality())
					So(equalsBitSet(bs2, rb2), ShouldEqual, true)

					clonebs1 := bs1.Clone()
					clonebs1.InPlaceIntersection(bs2)
					if !equalsBitSet(clonebs1, And(rb1, rb2)) {
						t := rb1.Clone()
						t.And(rb2)
						So(equalsBitSet(clonebs1, t), ShouldEqual, true)
					}

					// testing OR
					clonebs1 = bs1.Clone()
					clonebs1.InPlaceUnion(bs2)

					So(equalsBitSet(clonebs1, Or(rb1, rb2)), ShouldEqual, true)
					// testing XOR
					clonebs1 = bs1.Clone()
					clonebs1.InPlaceSymmetricDifference(bs2)
					So(equalsBitSet(clonebs1, Xor(rb1, rb2)), ShouldEqual, true)

					//testing NOTAND
					clonebs1 = bs1.Clone()
					clonebs1.InPlaceDifference(bs2)
					So(equalsBitSet(clonebs1, AndNot(rb1, rb2)), ShouldEqual, true)
				}
			}
		})
	}
}

func FlipRange(start, end int, bs *bitset.BitSet) {
	for i := start; i < end; i++ {
		bs.Flip(uint(i))
	}
}

func TestBitmap(t *testing.T) {

	Convey("Test Contains", t, func() {
		rbm1 := NewBitmap()
		for k := 0; k < 1000; k++ {
			rbm1.AddInt(17 * k)
		}
		for k := 0; k < 17*1000; k++ {
			So(rbm1.ContainsInt(k), ShouldEqual, (k/17*17 == k))
		}
	})

	Convey("Test Clone", t, func() {
		rb1 := NewBitmap()
		rb1.Add(10)

		rb2 := rb1.Clone()
		rb2.Remove(10)

		So(rb1.Contains(10), ShouldBeTrue)
	})
	Convey("Test run array not equal", t, func() {
		rb := NewBitmap()
		rb2 := NewBitmap()
		rb.AddRange(0, 1<<16)
		for i := 0; i < 10; i++ {
			rb2.AddInt(i)
		}
		So(rb.GetCardinality(), ShouldEqual, 1<<16)
		So(rb2.GetCardinality(), ShouldEqual, 10)
		So(rb.Equals(rb2), ShouldEqual, false)
		rb.RunOptimize()
		rb2.RunOptimize()
		So(rb.GetCardinality(), ShouldEqual, 1<<16)
		So(rb2.GetCardinality(), ShouldEqual, 10)
		So(rb.Equals(rb2), ShouldEqual, false)
	})

	Convey("Test ANDNOT4", t, func() {
		rb := NewBitmap()
		rb2 := NewBitmap()

		for i := 0; i < 200000; i += 4 {
			rb2.AddInt(i)
		}
		for i := 200000; i < 400000; i += 14 {
			rb2.AddInt(i)
		}

		off := AndNot(rb2, rb)
		andNotresult := AndNot(rb, rb2)

		So(rb.Equals(andNotresult), ShouldEqual, true)
		So(rb2.Equals(off), ShouldEqual, true)
		rb2.AndNot(rb)
		So(rb2.Equals(off), ShouldEqual, true)

	})

	Convey("Test AND", t, func() {
		rr := NewBitmap()
		for k := 0; k < 4000; k++ {
			rr.AddInt(k)
		}
		rr.Add(100000)
		rr.Add(110000)
		rr2 := NewBitmap()
		rr2.Add(13)
		rrand := And(rr, rr2)
		array := rrand.ToArray()

		So(len(array), ShouldEqual, 1)
		So(array[0], ShouldEqual, 13)
		rr.And(rr2)
		array = rr.ToArray()

		So(len(array), ShouldEqual, 1)
		So(array[0], ShouldEqual, 13)
	})

	Convey("Test AND 2", t, func() {
		rr := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr.AddInt(k)
		}
		for k := 3 * 65536; k < 3*65536+9000; k++ {
			rr.AddInt(k)
		}
		for k := 4 * 65535; k < 4*65535+7000; k++ {
			rr.AddInt(k)
		}
		for k := 6 * 65535; k < 6*65535+10000; k++ {
			rr.AddInt(k)
		}
		for k := 8 * 65535; k < 8*65535+1000; k++ {
			rr.AddInt(k)
		}
		for k := 9 * 65535; k < 9*65535+30000; k++ {
			rr.AddInt(k)
		}

		rr2 := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr2.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr2.AddInt(k)
		}
		for k := 3*65536 + 2000; k < 3*65536+6000; k++ {
			rr2.AddInt(k)
		}
		for k := 6 * 65535; k < 6*65535+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 7 * 65535; k < 7*65535+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 10 * 65535; k < 10*65535+5000; k++ {
			rr2.AddInt(k)
		}
		correct := And(rr, rr2)
		rr.And(rr2)
		So(correct.Equals(rr), ShouldEqual, true)
	})

	Convey("Test AND 2", t, func() {
		rr := NewBitmap()
		for k := 0; k < 4000; k++ {
			rr.AddInt(k)
		}
		rr.AddInt(100000)
		rr.AddInt(110000)
		rr2 := NewBitmap()
		rr2.AddInt(13)

		rrand := And(rr, rr2)
		array := rrand.ToArray()
		So(len(array), ShouldEqual, 1)
		So(array[0], ShouldEqual, 13)
	})
	Convey("Test AND 3a", t, func() {
		rr := NewBitmap()
		rr2 := NewBitmap()
		for k := 6 * 65536; k < 6*65536+10000; k++ {
			rr.AddInt(k)
		}
		for k := 6 * 65536; k < 6*65536+1000; k++ {
			rr2.AddInt(k)
		}
		result := And(rr, rr2)
		So(result.GetCardinality(), ShouldEqual, 1000)
	})
	Convey("Test AND 3", t, func() {
		var arrayand [11256]uint32
		//393,216
		pos := 0
		rr := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr.AddInt(k)
		}
		for k := 3 * 65536; k < 3*65536+1000; k++ {
			rr.AddInt(k)
		}
		for k := 3*65536 + 1000; k < 3*65536+7000; k++ {
			rr.AddInt(k)
		}
		for k := 3*65536 + 7000; k < 3*65536+9000; k++ {
			rr.AddInt(k)
		}
		for k := 4 * 65536; k < 4*65536+7000; k++ {
			rr.AddInt(k)
		}
		for k := 8 * 65536; k < 8*65536+1000; k++ {
			rr.AddInt(k)
		}
		for k := 9 * 65536; k < 9*65536+30000; k++ {
			rr.AddInt(k)
		}

		rr2 := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr2.AddInt(k)
			arrayand[pos] = uint32(k)
			pos++
		}
		for k := 65536; k < 65536+4000; k++ {
			rr2.AddInt(k)
			arrayand[pos] = uint32(k)
			pos++
		}
		for k := 3*65536 + 1000; k < 3*65536+7000; k++ {
			rr2.AddInt(k)
			arrayand[pos] = uint32(k)
			pos++
		}
		for k := 6 * 65536; k < 6*65536+10000; k++ {
			rr.AddInt(k)
		}
		for k := 6 * 65536; k < 6*65536+1000; k++ {
			rr2.AddInt(k)
			arrayand[pos] = uint32(k)
			pos++
		}

		for k := 7 * 65536; k < 7*65536+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 10 * 65536; k < 10*65536+5000; k++ {
			rr2.AddInt(k)
		}
		rrand := And(rr, rr2)

		arrayres := rrand.ToArray()
		ok := true
		for i := range arrayres {
			if i < len(arrayand) {
				if arrayres[i] != arrayand[i] {
					log.Println(i, arrayres[i], arrayand[i])
					ok = false
				}
			} else {
				log.Println('x', arrayres[i])
				ok = false
			}
		}

		So(len(arrayand), ShouldEqual, len(arrayres))
		So(ok, ShouldEqual, true)

	})

	Convey("Test AND 4", t, func() {
		rb := NewBitmap()
		rb2 := NewBitmap()

		for i := 0; i < 200000; i += 4 {
			rb2.AddInt(i)
		}
		for i := 200000; i < 400000; i += 14 {
			rb2.AddInt(i)
		}
		//TODO: Bitmap.And(bm,bm2)
		andresult := And(rb, rb2)
		off := And(rb2, rb)
		So(andresult.Equals(off), ShouldEqual, true)
		So(andresult.GetCardinality(), ShouldEqual, 0)

		for i := 500000; i < 600000; i += 14 {
			rb.AddInt(i)
		}
		for i := 200000; i < 400000; i += 3 {
			rb2.AddInt(i)
		}
		andresult2 := And(rb, rb2)
		So(andresult.GetCardinality(), ShouldEqual, 0)
		So(andresult2.GetCardinality(), ShouldEqual, 0)

		for i := 0; i < 200000; i += 4 {
			rb.AddInt(i)
		}
		for i := 200000; i < 400000; i += 14 {
			rb.AddInt(i)
		}
		So(andresult.GetCardinality(), ShouldEqual, 0)
		rc := And(rb, rb2)
		rb.And(rb2)
		So(rc.GetCardinality(), ShouldEqual, rb.GetCardinality())

	})

	Convey("ArrayContainerCardinalityTest", t, func() {
		ac := newArrayContainer()
		for k := uint16(0); k < 100; k++ {
			ac.iadd(k)
			So(ac.getCardinality(), ShouldEqual, k+1)
		}
		for k := uint16(0); k < 100; k++ {
			ac.iadd(k)
			So(ac.getCardinality(), ShouldEqual, 100)
		}
	})

	Convey("or test", t, func() {
		rr := NewBitmap()
		for k := 0; k < 4000; k++ {
			rr.AddInt(k)
		}
		rr2 := NewBitmap()
		for k := 4000; k < 8000; k++ {
			rr2.AddInt(k)
		}
		result := Or(rr, rr2)
		So(result.GetCardinality(), ShouldEqual, rr.GetCardinality()+rr2.GetCardinality())
	})
	Convey("basic test", t, func() {
		rr := NewBitmap()
		var a [4002]uint32
		pos := 0
		for k := 0; k < 4000; k++ {
			rr.AddInt(k)
			a[pos] = uint32(k)
			pos++
		}
		rr.AddInt(100000)
		a[pos] = 100000
		pos++
		rr.AddInt(110000)
		a[pos] = 110000
		pos++
		array := rr.ToArray()
		ok := true
		for i := range a {
			if array[i] != a[i] {
				log.Println("rr : ", array[i], " a : ", a[i])
				ok = false
			}
		}
		So(len(array), ShouldEqual, len(a))
		So(ok, ShouldEqual, true)
	})

	Convey("BitmapContainerCardinalityTest", t, func() {
		ac := newBitmapContainer()
		for k := uint16(0); k < 100; k++ {
			ac.iadd(k)
			So(ac.getCardinality(), ShouldEqual, k+1)
		}
		for k := uint16(0); k < 100; k++ {
			ac.iadd(k)
			So(ac.getCardinality(), ShouldEqual, 100)
		}
	})

	Convey("BitmapContainerTest", t, func() {
		rr := newBitmapContainer()
		rr.iadd(uint16(110))
		rr.iadd(uint16(114))
		rr.iadd(uint16(115))
		var array [3]uint16
		pos := 0
		for itr := rr.getShortIterator(); itr.hasNext(); {
			array[pos] = itr.next()
			pos++
		}

		So(array[0], ShouldEqual, uint16(110))
		So(array[1], ShouldEqual, uint16(114))
		So(array[2], ShouldEqual, uint16(115))
	})
	Convey("cardinality test", t, func() {
		N := 1024
		for gap := 7; gap < 100000; gap *= 10 {
			for offset := 2; offset <= 1024; offset *= 2 {
				rb := NewBitmap()
				for k := 0; k < N; k++ {
					rb.AddInt(k * gap)
					So(rb.GetCardinality(), ShouldEqual, k+1)
				}
				So(rb.GetCardinality(), ShouldEqual, N)
				// check the add of existing values
				for k := 0; k < N; k++ {
					rb.AddInt(k * gap)
					So(rb.GetCardinality(), ShouldEqual, N)
				}

				rb2 := NewBitmap()

				for k := 0; k < N; k++ {
					rb2.AddInt(k * gap * offset)
					So(rb2.GetCardinality(), ShouldEqual, k+1)
				}

				So(rb2.GetCardinality(), ShouldEqual, N)

				for k := 0; k < N; k++ {
					rb2.AddInt(k * gap * offset)
					So(rb2.GetCardinality(), ShouldEqual, N)
				}
				So(And(rb, rb2).GetCardinality(), ShouldEqual, N/offset)
				So(Xor(rb, rb2).GetCardinality(), ShouldEqual, 2*N-2*N/offset)
				So(Or(rb, rb2).GetCardinality(), ShouldEqual, 2*N-N/offset)
			}
		}
	})

	Convey("clear test", t, func() {
		rb := NewBitmap()
		for i := 0; i < 200000; i += 7 {
			// dense
			rb.AddInt(i)
		}
		for i := 200000; i < 400000; i += 177 {
			// sparse
			rb.AddInt(i)
		}

		rb2 := NewBitmap()
		rb3 := NewBitmap()
		for i := 0; i < 200000; i += 4 {
			rb2.AddInt(i)
		}
		for i := 200000; i < 400000; i += 14 {
			rb2.AddInt(i)
		}

		rb.Clear()
		So(rb.GetCardinality(), ShouldEqual, 0)
		So(rb2.GetCardinality(), ShouldNotEqual, 0)

		rb.AddInt(4)
		rb3.AddInt(4)
		andresult := And(rb, rb2)
		orresult := Or(rb, rb2)

		So(andresult.GetCardinality(), ShouldEqual, 1)
		So(orresult.GetCardinality(), ShouldEqual, rb2.GetCardinality())

		for i := 0; i < 200000; i += 4 {
			rb.AddInt(i)
			rb3.AddInt(i)
		}
		for i := 200000; i < 400000; i += 114 {
			rb.AddInt(i)
			rb3.AddInt(i)
		}

		arrayrr := rb.ToArray()
		arrayrr3 := rb3.ToArray()
		ok := true
		for i := range arrayrr {
			if arrayrr[i] != arrayrr3[i] {
				ok = false
			}
		}
		So(len(arrayrr), ShouldEqual, len(arrayrr3))
		So(ok, ShouldEqual, true)
	})

	Convey("constainer factory ", t, func() {

		bc1 := newBitmapContainer()
		bc2 := newBitmapContainer()
		bc3 := newBitmapContainer()
		ac1 := newArrayContainer()
		ac2 := newArrayContainer()
		ac3 := newArrayContainer()

		for i := 0; i < 5000; i++ {
			bc1.iadd(uint16(i * 70))
		}
		for i := 0; i < 5000; i++ {
			bc2.iadd(uint16(i * 70))
		}
		for i := 0; i < 5000; i++ {
			bc3.iadd(uint16(i * 70))
		}
		for i := 0; i < 4000; i++ {
			ac1.iadd(uint16(i * 50))
		}
		for i := 0; i < 4000; i++ {
			ac2.iadd(uint16(i * 50))
		}
		for i := 0; i < 4000; i++ {
			ac3.iadd(uint16(i * 50))
		}

		rbc := ac1.clone().(*arrayContainer).toBitmapContainer()
		So(validate(rbc, ac1), ShouldEqual, true)
		rbc = ac2.clone().(*arrayContainer).toBitmapContainer()
		So(validate(rbc, ac2), ShouldEqual, true)
		rbc = ac3.clone().(*arrayContainer).toBitmapContainer()
		So(validate(rbc, ac3), ShouldEqual, true)
	})
	Convey("flipTest1 ", t, func() {
		rb := NewBitmap()
		rb.Flip(100000, 200000) // in-place on empty bitmap
		rbcard := rb.GetCardinality()
		So(100000, ShouldEqual, rbcard)

		bs := bitset.New(20000 - 10000)
		for i := uint(100000); i < 200000; i++ {
			bs.Set(i)
		}
		So(equalsBitSet(bs, rb), ShouldEqual, true)
	})

	Convey("flipTest1A", t, func() {
		rb := NewBitmap()
		rb1 := Flip(rb, 100000, 200000)
		rbcard := rb1.GetCardinality()
		So(100000, ShouldEqual, rbcard)
		So(0, ShouldEqual, rb.GetCardinality())

		bs := bitset.New(0)
		So(equalsBitSet(bs, rb), ShouldEqual, true)

		for i := uint(100000); i < 200000; i++ {
			bs.Set(i)
		}
		So(equalsBitSet(bs, rb1), ShouldEqual, true)
	})
	Convey("flipTest2", t, func() {
		rb := NewBitmap()
		rb.Flip(100000, 100000)
		rbcard := rb.GetCardinality()
		So(0, ShouldEqual, rbcard)

		bs := bitset.New(0)
		So(equalsBitSet(bs, rb), ShouldEqual, true)
	})

	Convey("flipTest2A", t, func() {
		rb := NewBitmap()
		rb1 := Flip(rb, 100000, 100000)

		rb.AddInt(1)
		rbcard := rb1.GetCardinality()

		So(0, ShouldEqual, rbcard)
		So(1, ShouldEqual, rb.GetCardinality())

		bs := bitset.New(0)
		So(equalsBitSet(bs, rb1), ShouldEqual, true)
		bs.Set(1)
		So(equalsBitSet(bs, rb), ShouldEqual, true)
	})

	Convey("flipTest3A", t, func() {
		rb := NewBitmap()
		rb.Flip(100000, 200000) // got 100k-199999
		rb.Flip(100000, 199991) // give back 100k-199990
		rbcard := rb.GetCardinality()
		So(9, ShouldEqual, rbcard)

		bs := bitset.New(0)
		for i := uint(199991); i < 200000; i++ {
			bs.Set(i)
		}

		So(equalsBitSet(bs, rb), ShouldEqual, true)
	})

	Convey("flipTest4A", t, func() {
		// fits evenly on both ends
		rb := NewBitmap()
		rb.Flip(100000, 200000) // got 100k-199999
		rb.Flip(65536, 4*65536)
		rbcard := rb.GetCardinality()

		// 65536 to 99999 are 1s
		// 200000 to 262143 are 1s: total card

		So(96608, ShouldEqual, rbcard)

		bs := bitset.New(0)
		for i := uint(65536); i < 100000; i++ {
			bs.Set(i)
		}
		for i := uint(200000); i < 262144; i++ {
			bs.Set(i)
		}

		So(equalsBitSet(bs, rb), ShouldEqual, true)
	})

	Convey("flipTest5", t, func() {
		// fits evenly on small end, multiple
		// containers
		rb := NewBitmap()
		rb.Flip(100000, 132000)
		rb.Flip(65536, 120000)
		rbcard := rb.GetCardinality()

		// 65536 to 99999 are 1s
		// 120000 to 131999

		So(46464, ShouldEqual, rbcard)

		bs := bitset.New(0)
		for i := uint(65536); i < 100000; i++ {
			bs.Set(i)
		}
		for i := uint(120000); i < 132000; i++ {
			bs.Set(i)
		}
		So(equalsBitSet(bs, rb), ShouldEqual, true)
	})

	Convey("flipTest6", t, func() {
		rb := NewBitmap()
		rb1 := Flip(rb, 100000, 132000)
		rb2 := Flip(rb1, 65536, 120000)
		//rbcard := rb2.GetCardinality()

		bs := bitset.New(0)
		for i := uint(65536); i < 100000; i++ {
			bs.Set(i)
		}
		for i := uint(120000); i < 132000; i++ {
			bs.Set(i)
		}
		So(equalsBitSet(bs, rb2), ShouldEqual, true)
	})

	Convey("flipTest6A", t, func() {
		rb := NewBitmap()
		rb1 := Flip(rb, 100000, 132000)
		rb2 := Flip(rb1, 99000, 2*65536)
		rbcard := rb2.GetCardinality()

		So(1928, ShouldEqual, rbcard)

		bs := bitset.New(0)
		for i := uint(99000); i < 100000; i++ {
			bs.Set(i)
		}
		for i := uint(2 * 65536); i < 132000; i++ {
			bs.Set(i)
		}
		So(equalsBitSet(bs, rb2), ShouldEqual, true)
	})

	Convey("flipTest7", t, func() {
		// within 1 word, first container
		rb := NewBitmap()
		rb.Flip(650, 132000)
		rb.Flip(648, 651)
		rbcard := rb.GetCardinality()

		// 648, 649, 651-131999

		So(132000-651+2, ShouldEqual, rbcard)
		bs := bitset.New(0)
		bs.Set(648)
		bs.Set(649)
		for i := uint(651); i < 132000; i++ {
			bs.Set(i)
		}
		So(equalsBitSet(bs, rb), ShouldEqual, true)
	})
	Convey("flipTestBig", t, func() {
		numCases := 1000
		rb := NewBitmap()
		bs := bitset.New(0)
		//Random r = new Random(3333);
		checkTime := 2.0

		for i := 0; i < numCases; i++ {
			start := rand.Intn(65536 * 20)
			end := rand.Intn(65536 * 20)
			if rand.Float64() < float64(0.1) {
				end = start + rand.Intn(100)
			}
			rb.Flip(uint64(start), uint64(end))
			if start < end {
				FlipRange(start, end, bs) // throws exception
			}
			// otherwise
			// insert some more ANDs to keep things sparser
			if rand.Float64() < 0.2 {
				mask := NewBitmap()
				mask1 := bitset.New(0)
				startM := rand.Intn(65536 * 20)
				endM := startM + 100000
				mask.Flip(uint64(startM), uint64(endM))
				FlipRange(startM, endM, mask1)
				mask.Flip(0, 65536*20+100000)
				FlipRange(0, 65536*20+100000, mask1)
				rb.And(mask)
				bs.InPlaceIntersection(mask1)
			}
			// see if we can detect incorrectly shared containers
			if rand.Float64() < 0.1 {
				irrelevant := Flip(rb, 10, 100000)
				irrelevant.Flip(5, 200000)
				irrelevant.Flip(190000, 260000)
			}
			if float64(i) > checkTime {
				So(equalsBitSet(bs, rb), ShouldEqual, true)
				checkTime *= 1.5
			}
		}
	})

	Convey("ortest", t, func() {
		rr := NewBitmap()
		for k := 0; k < 4000; k++ {
			rr.AddInt(k)
		}
		rr.AddInt(100000)
		rr.AddInt(110000)
		rr2 := NewBitmap()
		for k := 0; k < 4000; k++ {
			rr2.AddInt(k)
		}

		rror := Or(rr, rr2)

		array := rror.ToArray()

		rr.Or(rr2)
		arrayirr := rr.ToArray()
		So(IntsEquals(array, arrayirr), ShouldEqual, true)
	})

	Convey("ORtest", t, func() {
		rr := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr.AddInt(k)
		}
		for k := 3 * 65536; k < 3*65536+9000; k++ {
			rr.AddInt(k)
		}
		for k := 4 * 65535; k < 4*65535+7000; k++ {
			rr.AddInt(k)
		}
		for k := 6 * 65535; k < 6*65535+10000; k++ {
			rr.AddInt(k)
		}
		for k := 8 * 65535; k < 8*65535+1000; k++ {
			rr.AddInt(k)
		}
		for k := 9 * 65535; k < 9*65535+30000; k++ {
			rr.AddInt(k)
		}

		rr2 := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr2.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr2.AddInt(k)
		}
		for k := 3*65536 + 2000; k < 3*65536+6000; k++ {
			rr2.AddInt(k)
		}
		for k := 6 * 65535; k < 6*65535+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 7 * 65535; k < 7*65535+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 10 * 65535; k < 10*65535+5000; k++ {
			rr2.AddInt(k)
		}
		correct := Or(rr, rr2)
		rr.Or(rr2)
		So(correct.Equals(rr), ShouldEqual, true)
	})

	Convey("ortest2", t, func() {
		arrayrr := make([]uint32, 4000+4000+2)
		pos := 0
		rr := NewBitmap()
		for k := 0; k < 4000; k++ {
			rr.AddInt(k)
			arrayrr[pos] = uint32(k)
			pos++
		}
		rr.AddInt(100000)
		rr.AddInt(110000)
		rr2 := NewBitmap()
		for k := 4000; k < 8000; k++ {
			rr2.AddInt(k)
			arrayrr[pos] = uint32(k)
			pos++
		}

		arrayrr[pos] = 100000
		pos++
		arrayrr[pos] = 110000
		pos++

		rror := Or(rr, rr2)

		arrayor := rror.ToArray()

		So(IntsEquals(arrayor, arrayrr), ShouldEqual, true)
	})

	Convey("ortest3", t, func() {
		V1 := make(map[int]bool)
		V2 := make(map[int]bool)

		rr := NewBitmap()
		rr2 := NewBitmap()
		for k := 0; k < 4000; k++ {
			rr2.AddInt(k)
			V1[k] = true
		}
		for k := 3500; k < 4500; k++ {
			rr.AddInt(k)
			V1[k] = true
		}
		for k := 4000; k < 65000; k++ {
			rr2.AddInt(k)
			V1[k] = true
		}

		// In the second node of each roaring bitmap, we have two bitmap
		// containers.
		// So, we will check the union between two BitmapContainers
		for k := 65536; k < 65536+10000; k++ {
			rr.AddInt(k)
			V1[k] = true
		}

		for k := 65536; k < 65536+14000; k++ {
			rr2.AddInt(k)
			V1[k] = true
		}

		// In the 3rd node of each Roaring Bitmap, we have an
		// ArrayContainer, so, we will try the union between two
		// ArrayContainers.
		for k := 4 * 65535; k < 4*65535+1000; k++ {
			rr.AddInt(k)
			V1[k] = true
		}

		for k := 4 * 65535; k < 4*65535+800; k++ {
			rr2.AddInt(k)
			V1[k] = true
		}

		// For the rest, we will check if the union will take them in
		// the result
		for k := 6 * 65535; k < 6*65535+1000; k++ {
			rr.AddInt(k)
			V1[k] = true
		}

		for k := 7 * 65535; k < 7*65535+2000; k++ {
			rr2.AddInt(k)
			V1[k] = true
		}

		rror := Or(rr, rr2)
		valide := true

		for _, k := range rror.ToArray() {
			_, found := V1[int(k)]
			if !found {
				valide = false
			}
			V2[int(k)] = true
		}

		for k := range V1 {
			_, found := V2[k]
			if !found {
				valide = false
			}
		}

		So(valide, ShouldEqual, true)
	})

	Convey("ortest4", t, func() {
		rb := NewBitmap()
		rb2 := NewBitmap()

		for i := 0; i < 200000; i += 4 {
			rb2.AddInt(i)
		}
		for i := 200000; i < 400000; i += 14 {
			rb2.AddInt(i)
		}
		rb2card := rb2.GetCardinality()

		// check or against an empty bitmap
		orresult := Or(rb, rb2)
		off := Or(rb2, rb)
		So(orresult.Equals(off), ShouldEqual, true)

		So(rb2card, ShouldEqual, orresult.GetCardinality())

		for i := 500000; i < 600000; i += 14 {
			rb.AddInt(i)
		}
		for i := 200000; i < 400000; i += 3 {
			rb2.AddInt(i)
		}
		// check or against an empty bitmap
		orresult2 := Or(rb, rb2)
		So(rb2card, ShouldEqual, orresult.GetCardinality())
		So(rb2.GetCardinality()+rb.GetCardinality(), ShouldEqual,
			orresult2.GetCardinality())
		rb.Or(rb2)
		So(rb.Equals(orresult2), ShouldEqual, true)

	})

	Convey("randomTest", t, func() {
		rTest(15)
		rTest(1024)
		rTest(4096)
		rTest(65536)
		rTest(65536 * 16)
	})

	Convey("SimpleCardinality", t, func() {
		N := 512
		gap := 70

		rb := NewBitmap()
		for k := 0; k < N; k++ {
			rb.AddInt(k * gap)
			So(rb.GetCardinality(), ShouldEqual, k+1)
		}
		So(rb.GetCardinality(), ShouldEqual, N)
		for k := 0; k < N; k++ {
			rb.AddInt(k * gap)
			So(rb.GetCardinality(), ShouldEqual, N)
		}

	})

	Convey("XORtest", t, func() {
		rr := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr.AddInt(k)
		}
		for k := 3 * 65536; k < 3*65536+9000; k++ {
			rr.AddInt(k)
		}
		for k := 4 * 65535; k < 4*65535+7000; k++ {
			rr.AddInt(k)
		}
		for k := 6 * 65535; k < 6*65535+10000; k++ {
			rr.AddInt(k)
		}
		for k := 8 * 65535; k < 8*65535+1000; k++ {
			rr.AddInt(k)
		}
		for k := 9 * 65535; k < 9*65535+30000; k++ {
			rr.AddInt(k)
		}

		rr2 := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr2.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr2.AddInt(k)
		}
		for k := 3*65536 + 2000; k < 3*65536+6000; k++ {
			rr2.AddInt(k)
		}
		for k := 6 * 65535; k < 6*65535+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 7 * 65535; k < 7*65535+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 10 * 65535; k < 10*65535+5000; k++ {
			rr2.AddInt(k)
		}
		correct := Xor(rr, rr2)
		rr.Xor(rr2)
		So(correct.Equals(rr), ShouldEqual, true)
	})

	Convey("xortest1", t, func() {
		V1 := make(map[int]bool)
		V2 := make(map[int]bool)

		rr := NewBitmap()
		rr2 := NewBitmap()
		// For the first 65536: rr2 has a bitmap container, and rr has
		// an array container.
		// We will check the union between a BitmapCintainer and an
		// arrayContainer
		for k := 0; k < 4000; k++ {
			rr2.AddInt(k)
			if k < 3500 {
				V1[k] = true
			}
		}
		for k := 3500; k < 4500; k++ {
			rr.AddInt(k)
		}
		for k := 4000; k < 65000; k++ {
			rr2.AddInt(k)
			if k >= 4500 {
				V1[k] = true
			}
		}

		for k := 65536; k < 65536+30000; k++ {
			rr.AddInt(k)
		}

		for k := 65536; k < 65536+50000; k++ {
			rr2.AddInt(k)
			if k >= 65536+30000 {
				V1[k] = true
			}
		}

		// In the 3rd node of each Roaring Bitmap, we have an
		// ArrayContainer. So, we will try the union between two
		// ArrayContainers.
		for k := 4 * 65535; k < 4*65535+1000; k++ {
			rr.AddInt(k)
			if k >= (4*65535 + 800) {
				V1[k] = true
			}
		}

		for k := 4 * 65535; k < 4*65535+800; k++ {
			rr2.AddInt(k)
		}

		for k := 6 * 65535; k < 6*65535+1000; k++ {
			rr.AddInt(k)
			V1[k] = true
		}

		for k := 7 * 65535; k < 7*65535+2000; k++ {
			rr2.AddInt(k)
			V1[k] = true
		}

		rrxor := Xor(rr, rr2)
		valide := true

		for _, i := range rrxor.ToArray() {
			_, found := V1[int(i)]
			if !found {
				valide = false
			}
			V2[int(i)] = true
		}
		for k := range V1 {
			_, found := V2[k]
			if !found {
				valide = false
			}
		}

		So(valide, ShouldEqual, true)
	})
}
func TestXORtest4(t *testing.T) {
	Convey("XORtest 4", t, func() {
		rb := NewBitmap()
		rb2 := NewBitmap()
		counter := 0

		for i := 0; i < 200000; i += 4 {
			rb2.AddInt(i)
			counter++
		}
		So(rb2.GetCardinality(), ShouldEqual, counter)
		for i := 200000; i < 400000; i += 14 {
			rb2.AddInt(i)
			counter++
		}
		So(rb2.GetCardinality(), ShouldEqual, counter)
		rb2card := rb2.GetCardinality()
		So(rb2card, ShouldEqual, counter)

		// check or against an empty bitmap
		xorresult := Xor(rb, rb2)
		So(xorresult.GetCardinality(), ShouldEqual, counter)
		off := Or(rb2, rb)
		So(off.GetCardinality(), ShouldEqual, counter)
		So(xorresult.Equals(off), ShouldEqual, true)

		So(rb2card, ShouldEqual, xorresult.GetCardinality())
		for i := 500000; i < 600000; i += 14 {
			rb.AddInt(i)
		}
		for i := 200000; i < 400000; i += 3 {
			rb2.AddInt(i)
		}
		// check or against an empty bitmap
		xorresult2 := Xor(rb, rb2)
		So(rb2card, ShouldEqual, xorresult.GetCardinality())

		So(rb2.GetCardinality()+rb.GetCardinality(), ShouldEqual, xorresult2.GetCardinality())

		rb.Xor(rb2)
		So(xorresult2.Equals(rb), ShouldEqual, true)

	})
	//need to add the massives
}

func TestNextMany(t *testing.T) {
	Convey("NextMany test", t, func() {
		count := 70000
		for _, gap := range []uint32{1, 8, 32, 128} {
			expected := make([]uint32, count)
			{
				v := uint32(0)
				for i := range expected {
					expected[i] = v
					v += gap
				}
			}
			bm := BitmapOf(expected...)
			for _, bufSize := range []int{1, 64, 4096, count} {
				buf := make([]uint32, bufSize)
				it := bm.ManyIterator()
				cur := 0
				for n := it.NextMany(buf); n != 0; n = it.NextMany(buf) {
					// much faster tests... (10s -> 5ms)
					if cur+n > count {
						So(cur+n, ShouldBeLessThanOrEqualTo, count)
					}
					for i, v := range buf[:n] {
						// much faster tests...
						if v != expected[cur+i] {
							So(v, ShouldEqual, expected[cur+i])
						}
					}
					cur += n
				}
				So(cur, ShouldEqual, count)
			}
		}
	})
}

func TestBigRandom(t *testing.T) {
	Convey("randomTest", t, func() {
		rTest(15)
		rTest(100)
		rTest(512)
		rTest(1023)
		rTest(1025)
		rTest(4095)
		rTest(4096)
		rTest(4097)
		rTest(65536)
		rTest(65536 * 16)
	})
}

func rTest(N int) {
	log.Println("rtest N=", N)
	for gap := 1; gap <= 65536; gap *= 2 {
		bs1 := bitset.New(0)
		rb1 := NewBitmap()
		for x := 0; x <= N; x += gap {
			bs1.Set(uint(x))
			rb1.AddInt(x)
		}
		So(bs1.Count(), ShouldEqual, rb1.GetCardinality())
		So(equalsBitSet(bs1, rb1), ShouldEqual, true)
		for offset := 1; offset <= gap; offset *= 2 {
			bs2 := bitset.New(0)
			rb2 := NewBitmap()
			for x := 0; x <= N; x += gap {
				bs2.Set(uint(x + offset))
				rb2.AddInt(x + offset)
			}
			So(bs2.Count(), ShouldEqual, rb2.GetCardinality())
			So(equalsBitSet(bs2, rb2), ShouldEqual, true)

			clonebs1 := bs1.Clone()
			clonebs1.InPlaceIntersection(bs2)
			if !equalsBitSet(clonebs1, And(rb1, rb2)) {
				t := rb1.Clone()
				t.And(rb2)
				So(equalsBitSet(clonebs1, t), ShouldEqual, true)
			}

			// testing OR
			clonebs1 = bs1.Clone()
			clonebs1.InPlaceUnion(bs2)

			So(equalsBitSet(clonebs1, Or(rb1, rb2)), ShouldEqual, true)
			// testing XOR
			clonebs1 = bs1.Clone()
			clonebs1.InPlaceSymmetricDifference(bs2)
			So(equalsBitSet(clonebs1, Xor(rb1, rb2)), ShouldEqual, true)

			//testing NOTAND
			clonebs1 = bs1.Clone()
			clonebs1.InPlaceDifference(bs2)
			So(equalsBitSet(clonebs1, AndNot(rb1, rb2)), ShouldEqual, true)
		}
	}
}

func equalsBitSet(a *bitset.BitSet, b *Bitmap) bool {
	for i, e := a.NextSet(0); e; i, e = a.NextSet(i + 1) {
		if !b.ContainsInt(int(i)) {
			return false
		}
	}
	i := b.Iterator()
	for i.HasNext() {
		if !a.Test(uint(i.Next())) {
			return false
		}
	}
	return true
}

func equalsArray(a []int, b *Bitmap) bool {
	if uint64(len(a)) != b.GetCardinality() {
		return false
	}
	for _, x := range a {
		if !b.ContainsInt(x) {
			return false
		}
	}
	return true
}

func IntsEquals(a, b []uint32) bool {
	if len(a) != len(b) {
		return false
	}
	for i, v := range a {
		if v != b[i] {
			return false
		}
	}
	return true
}

func validate(bc *bitmapContainer, ac *arrayContainer) bool {
	// Checking the cardinalities of each container

	if bc.getCardinality() != ac.getCardinality() {
		log.Println("cardinality differs")
		return false
	}
	// Checking that the two containers contain the same values
	counter := 0

	for i := bc.NextSetBit(0); i >= 0; i = bc.NextSetBit(i + 1) {
		counter++
		if !ac.contains(uint16(i)) {
			log.Println("content differs")
			log.Println(bc)
			log.Println(ac)
			return false
		}

	}

	// checking the cardinality of the BitmapContainer
	return counter == bc.getCardinality()
}

func TestRoaringArray(t *testing.T) {

	a := newRoaringArray()
	Convey("Test Init", t, func() {
		So(a.size(), ShouldEqual, 0)
	})

	Convey("Test Insert", t, func() {
		a.appendContainer(0, newArrayContainer(), false)

		So(a.size(), ShouldEqual, 1)
	})

	Convey("Test Remove", t, func() {
		a.remove(0)
		So(a.size(), ShouldEqual, 0)
	})

	Convey("Test popcount Full", t, func() {
		res := popcount(uint64(0xffffffffffffffff))
		So(res, ShouldEqual, 64)
	})

	Convey("Test popcount Empty", t, func() {
		res := popcount(0)
		So(res, ShouldEqual, 0)
	})

	Convey("Test popcount 16", t, func() {
		res := popcount(0xff00ff)
		So(res, ShouldEqual, 16)
	})

	Convey("Test ArrayContainer Add", t, func() {
		ar := newArrayContainer()
		ar.iadd(1)
		So(ar.getCardinality(), ShouldEqual, 1)
	})

	Convey("Test ArrayContainer Add wacky", t, func() {
		ar := newArrayContainer()
		ar.iadd(0)
		ar.iadd(5000)
		So(ar.getCardinality(), ShouldEqual, 2)
	})

	Convey("Test ArrayContainer Add Reverse", t, func() {
		ar := newArrayContainer()
		ar.iadd(5000)
		ar.iadd(2048)
		ar.iadd(0)
		So(ar.getCardinality(), ShouldEqual, 3)
	})

	Convey("Test BitmapContainer Add ", t, func() {
		bm := newBitmapContainer()
		bm.iadd(0)
		So(bm.getCardinality(), ShouldEqual, 1)
	})

}

func TestFlipBigA(t *testing.T) {
	Convey("flipTestBigA ", t, func() {
		numCases := 1000
		bs := bitset.New(0)
		checkTime := 2.0
		rb1 := NewBitmap()
		rb2 := NewBitmap()

		for i := 0; i < numCases; i++ {
			start := rand.Intn(65536 * 20)
			end := rand.Intn(65536 * 20)
			if rand.Float64() < 0.1 {
				end = start + rand.Intn(100)
			}

			if (i & 1) == 0 {
				rb2 = FlipInt(rb1, start, end)
				// tweak the other, catch bad sharing
				rb1.FlipInt(rand.Intn(65536*20), rand.Intn(65536*20))
			} else {
				rb1 = FlipInt(rb2, start, end)
				rb2.FlipInt(rand.Intn(65536*20), rand.Intn(65536*20))
			}

			if start < end {
				FlipRange(start, end, bs) // throws exception
			}
			// otherwise
			// insert some more ANDs to keep things sparser
			if (rand.Float64() < 0.2) && (i&1) == 0 {
				mask := NewBitmap()
				mask1 := bitset.New(0)
				startM := rand.Intn(65536 * 20)
				endM := startM + 100000
				mask.FlipInt(startM, endM)
				FlipRange(startM, endM, mask1)
				mask.FlipInt(0, 65536*20+100000)
				FlipRange(0, 65536*20+100000, mask1)
				rb2.And(mask)
				bs.InPlaceIntersection(mask1)
			}

			if float64(i) > checkTime {
				var rb *Bitmap

				if (i & 1) == 0 {
					rb = rb2
				} else {
					rb = rb1
				}
				So(equalsBitSet(bs, rb), ShouldEqual, true)
				checkTime *= 1.5
			}
		}
	})
}

func TestNextManyOfAddRangeAcrossContainers(t *testing.T) {
	Convey("NextManyOfAddRangeAcrossContainers ", t, func() {
		rb := NewBitmap()
		rb.AddRange(65530, 65540)
		expectedCard := 10
		expected := []uint32{65530, 65531, 65532, 65533, 65534, 65535, 65536, 65537, 65538, 65539, 0}

		// test where all values can be returned in a single buffer
		it := rb.ManyIterator()
		buf := make([]uint32, 11)
		n := it.NextMany(buf)
		So(n, ShouldEqual, expectedCard)
		for i, e := range expected {
			So(buf[i], ShouldEqual, e)
		}

		// test where buf is size 1, so many iterations
		it = rb.ManyIterator()
		n = 0
		buf = make([]uint32, 1)
		for i := 0; i < expectedCard; i++ {
			n = it.NextMany(buf)
			So(n, ShouldEqual, 1)
			So(buf[0], ShouldEqual, expected[i])
		}
		n = it.NextMany(buf)
		So(n, ShouldEqual, 0)
	})
}

func TestDoubleAdd(t *testing.T) {
	Convey("doubleadd ", t, func() {
		rb := NewBitmap()
		rb.AddRange(65533, 65536)
		rb.AddRange(65530, 65536)
		rb2 := NewBitmap()
		rb2.AddRange(65530, 65536)
		So(rb.Equals(rb2), ShouldEqual, true)
		rb2.RemoveRange(65530, 65536)
		So(rb2.GetCardinality(), ShouldEqual, 0)
	})
}

func TestDoubleAdd2(t *testing.T) {
	Convey("doubleadd2 ", t, func() {
		rb := NewBitmap()
		rb.AddRange(65533, 65536*20)
		rb.AddRange(65530, 65536*20)
		rb2 := NewBitmap()
		rb2.AddRange(65530, 65536*20)
		So(rb.Equals(rb2), ShouldEqual, true)
		rb2.RemoveRange(65530, 65536*20)
		So(rb2.GetCardinality(), ShouldEqual, 0)
	})
}

func TestDoubleAdd3(t *testing.T) {
	Convey("doubleadd3 ", t, func() {
		rb := NewBitmap()
		rb.AddRange(65533, 65536*20+10)
		rb.AddRange(65530, 65536*20+10)
		rb2 := NewBitmap()
		rb2.AddRange(65530, 65536*20+10)
		So(rb.Equals(rb2), ShouldEqual, true)
		rb2.RemoveRange(65530, 65536*20+1)
		So(rb2.GetCardinality(), ShouldEqual, 9)
	})
}

func TestDoubleAdd4(t *testing.T) {
	Convey("doubleadd4 ", t, func() {
		rb := NewBitmap()
		rb.AddRange(65533, 65536*20)
		rb.RemoveRange(65533+5, 65536*20)
		So(rb.GetCardinality(), ShouldEqual, 5)
	})
}

func TestDoubleAdd5(t *testing.T) {
	Convey("doubleadd5 ", t, func() {
		rb := NewBitmap()
		rb.AddRange(65533, 65536*20)
		rb.RemoveRange(65533+5, 65536*20-5)
		So(rb.GetCardinality(), ShouldEqual, 10)
	})
}

func TestDoubleAdd6(t *testing.T) {
	Convey("doubleadd6 ", t, func() {
		rb := NewBitmap()
		rb.AddRange(65533, 65536*20-5)
		rb.RemoveRange(65533+5, 65536*20-10)
		So(rb.GetCardinality(), ShouldEqual, 10)
	})
}

func TestDoubleAdd7(t *testing.T) {
	Convey("doubleadd7 ", t, func() {
		rb := NewBitmap()
		rb.AddRange(65533, 65536*20+1)
		rb.RemoveRange(65533+1, 65536*20)
		So(rb.GetCardinality(), ShouldEqual, 2)
	})
}

func TestDoubleAndNotBug01(t *testing.T) {
	Convey("AndNotBug01 ", t, func() {
		rb1 := NewBitmap()
		rb1.AddRange(0, 60000)
		rb2 := NewBitmap()
		rb2.AddRange(60000-10, 60000+10)
		rb2.AndNot(rb1)
		rb3 := NewBitmap()
		rb3.AddRange(60000, 60000+10)

		So(rb2.Equals(rb3), ShouldBeTrue)
	})
}

func TestAndNot(t *testing.T) {

	Convey("Test ANDNOT", t, func() {
		rr := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr.AddInt(k)
		}
		for k := 3 * 65536; k < 3*65536+9000; k++ {
			rr.AddInt(k)
		}
		for k := 4 * 65535; k < 4*65535+7000; k++ {
			rr.AddInt(k)
		}
		for k := 6 * 65535; k < 6*65535+10000; k++ {
			rr.AddInt(k)
		}
		for k := 8 * 65535; k < 8*65535+1000; k++ {
			rr.AddInt(k)
		}
		for k := 9 * 65535; k < 9*65535+30000; k++ {
			rr.AddInt(k)
		}

		rr2 := NewBitmap()
		for k := 4000; k < 4256; k++ {
			rr2.AddInt(k)
		}
		for k := 65536; k < 65536+4000; k++ {
			rr2.AddInt(k)
		}
		for k := 3*65536 + 2000; k < 3*65536+6000; k++ {
			rr2.AddInt(k)
		}
		for k := 6 * 65535; k < 6*65535+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 7 * 65535; k < 7*65535+1000; k++ {
			rr2.AddInt(k)
		}
		for k := 10 * 65535; k < 10*65535+5000; k++ {
			rr2.AddInt(k)
		}
		correct := AndNot(rr, rr2)
		rr.AndNot(rr2)

		So(correct.Equals(rr), ShouldEqual, true)
	})
}

func TestStats(t *testing.T) {
	Convey("Test Stats with empty bitmap", t, func() {
		expectedStats := Statistics{}
		rr := NewBitmap()
		So(rr.Stats(), ShouldResemble, expectedStats)
	})
	Convey("Test Stats with bitmap Container", t, func() {
		// Given a bitmap that should have a single bitmap container
		expectedStats := Statistics{
			Cardinality: 60000,
			Containers:  1,

			BitmapContainers:      1,
			BitmapContainerValues: 60000,
			BitmapContainerBytes:  8192,

			RunContainers:      0,
			RunContainerBytes:  0,
			RunContainerValues: 0,
		}
		rr := NewBitmap()
		for i := uint32(0); i < 60000; i++ {
			rr.Add(i)
		}
		So(rr.Stats(), ShouldResemble, expectedStats)
	})

	Convey("Test Stats with run Container", t, func() {
		// Given that we should have a single run container
		intSize := int(unsafe.Sizeof(int(0)))
		var runContainerBytes uint64
		if intSize == 4 {
			runContainerBytes = 40
		} else {
			runContainerBytes = 52
		}

		expectedStats := Statistics{
			Cardinality: 60000,
			Containers:  1,

			BitmapContainers:      0,
			BitmapContainerValues: 0,
			BitmapContainerBytes:  0,

			RunContainers:      1,
			RunContainerBytes:  runContainerBytes,
			RunContainerValues: 60000,
		}
		rr := NewBitmap()
		rr.AddRange(0, 60000)
		So(rr.Stats(), ShouldResemble, expectedStats)
	})
	Convey("Test Stats with Array Container", t, func() {
		// Given a bitmap that should have a single array container
		expectedStats := Statistics{
			Cardinality: 2,
			Containers:  1,

			ArrayContainers:      1,
			ArrayContainerValues: 2,
			ArrayContainerBytes:  4,
		}
		rr := NewBitmap()
		rr.Add(2)
		rr.Add(4)
		So(rr.Stats(), ShouldResemble, expectedStats)
	})
}

func TestFlipVerySmall(t *testing.T) {
	Convey("very small basic Flip test", t, func() {
		rb := NewBitmap()
		rb.Flip(0, 10) // got [0,9], card is 10
		rb.Flip(0, 1)  // give back the number 0, card goes to 9
		rbcard := rb.GetCardinality()
		So(rbcard, ShouldEqual, 9)
	})
}

func TestReverseIterator(t *testing.T) {
	{
		values := []uint32{0, 2, 15, 16, 31, 32, 33, 9999, MaxUint16, MaxUint32}
		bm := New()
		for n := 0; n < len(values); n++ {
			bm.Add(values[n])
		}
		i := bm.ReverseIterator()
		n := len(values) - 1
		for i.HasNext() {
			v := i.Next()
			if values[n] != v {
				t.Errorf("expected %d got %d", values[n], v)
			}
			n--
		}

		// HasNext() was terminating early - add test
		i = bm.ReverseIterator()
		n = len(values) - 1
		for ; n >= 0; n-- {
			v := i.Next()
			if values[n] != v {
				t.Errorf("expected %d got %d", values[n], v)
			}
			if n > 0 && !i.HasNext() {
				t.Errorf("expected HaveNext()=true for n=%d, values[n]=%d", n, values[n])
				t.FailNow()
			}
		}
	}
	{
		bm := New()
		i := bm.ReverseIterator()
		if i.HasNext() {
			t.Error("expected HasNext() to be false")
		}
	}
	{
		bm := New()
		bm.AddInt(0)
		i := bm.ReverseIterator()
		if !i.HasNext() {
			t.Error("expected HasNext() to be true")
		}
		if i.Next() != 0 {
			t.Error("expected 0")
		}
		if i.HasNext() {
			t.Error("expected HasNext() to be false")
		}
	}
	{
		bm := New()
		bm.AddInt(9999)
		i := bm.ReverseIterator()
		if !i.HasNext() {
			t.Error("expected HasNext() to be true")
		}
		if i.Next() != 9999 {
			t.Error("expected 9999")
		}
		if i.HasNext() {
			t.Error("expected HasNext() to be false")
		}
	}
	{
		bm := New()
		bm.AddInt(MaxUint16)
		i := bm.ReverseIterator()
		if !i.HasNext() {
			t.Error("expected HasNext() to be true")
		}
		if i.Next() != MaxUint16 {
			t.Error("expected MaxUint16")
		}
		if i.HasNext() {
			t.Error("expected HasNext() to be false")
		}
	}
	{
		bm := New()
		bm.Add(MaxUint32)
		i := bm.ReverseIterator()
		if !i.HasNext() {
			t.Error("expected HasNext() to be true")
		}
		if i.Next() != MaxUint32 {
			t.Error("expected MaxUint32")
		}
		if i.HasNext() {
			t.Error("expected HasNext() to be false")
		}
	}
}

func TestPackageFlipMaxRangeEnd(t *testing.T) {
	var empty Bitmap
	flipped := Flip(&empty, 0, MaxRange)
	assert.EqualValues(t, MaxRange, flipped.GetCardinality())
}

func TestBitmapFlipMaxRangeEnd(t *testing.T) {
	var bm Bitmap
	bm.Flip(0, MaxRange)
	assert.EqualValues(t, MaxRange, bm.GetCardinality())
}
