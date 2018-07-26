package roaring

import (
	"encoding/binary"
	"math/rand"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestCountTrailingZeros072(t *testing.T) {
	Convey("countTrailingZeros", t, func() {
		So(numberOfTrailingZeros(0), ShouldEqual, 64)
		So(numberOfTrailingZeros(8), ShouldEqual, 3)
		So(numberOfTrailingZeros(7), ShouldEqual, 0)
		So(numberOfTrailingZeros(1<<17), ShouldEqual, 17)
		So(numberOfTrailingZeros(7<<17), ShouldEqual, 17)
		So(numberOfTrailingZeros(255<<33), ShouldEqual, 33)

		So(countTrailingZeros(0), ShouldEqual, 64)
		So(countTrailingZeros(8), ShouldEqual, 3)
		So(countTrailingZeros(7), ShouldEqual, 0)
		So(countTrailingZeros(1<<17), ShouldEqual, 17)
		So(countTrailingZeros(7<<17), ShouldEqual, 17)
		So(countTrailingZeros(255<<33), ShouldEqual, 33)

	})
}

func getRandomUint64Set(n int) []uint64 {
	seed := int64(42)
	rand.Seed(seed)

	var buf [8]byte
	var o []uint64
	for i := 0; i < n; i++ {
		rand.Read(buf[:])
		o = append(o, binary.LittleEndian.Uint64(buf[:]))
	}
	return o
}

func getAllOneBitUint64Set() []uint64 {
	var o []uint64
	for i := uint(0); i < 64; i++ {
		o = append(o, 1<<i)
	}
	return o
}

func Benchmark100OrigNumberOfTrailingZeros(b *testing.B) {
	b.StopTimer()

	r := getRandomUint64Set(64)
	r = append(r, getAllOneBitUint64Set()...)

	b.ResetTimer()
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		for i := range r {
			numberOfTrailingZeros(r[i])
		}
	}
}

func Benchmark100CountTrailingZeros(b *testing.B) {
	b.StopTimer()

	r := getRandomUint64Set(64)
	r = append(r, getAllOneBitUint64Set()...)

	b.ResetTimer()
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		for i := range r {
			countTrailingZeros(r[i])
		}
	}
}

func numberOfTrailingZeros(i uint64) int {
	if i == 0 {
		return 64
	}
	x := i
	n := int64(63)
	y := x << 32
	if y != 0 {
		n -= 32
		x = y
	}
	y = x << 16
	if y != 0 {
		n -= 16
		x = y
	}
	y = x << 8
	if y != 0 {
		n -= 8
		x = y
	}
	y = x << 4
	if y != 0 {
		n -= 4
		x = y
	}
	y = x << 2
	if y != 0 {
		n -= 2
		x = y
	}
	return int(n - int64(uint64(x<<1)>>63))
}
