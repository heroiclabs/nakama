package roaring

import (
	. "github.com/smartystreets/goconvey/convey"
	"testing"
)

func numberOfLeadingZeros(i uint64) int {
	if i == 0 {
		return 64
	}
	n := 1
	x := uint32(i >> 32)
	if x == 0 {
		n += 32
		x = uint32(i)
	}
	if (x >> 16) == 0 {
		n += 16
		x <<= 16
	}
	if (x >> 24) == 0 {
		n += 8
		x <<= 8
	}
	if x>>28 == 0 {
		n += 4
		x <<= 4
	}
	if x>>30 == 0 {
		n += 2
		x <<= 2

	}
	n -= int(x >> 31)
	return n
}

func TestCountLeadingZeros072(t *testing.T) {
	Convey("countLeadingZeros", t, func() {
		So(numberOfLeadingZeros(0), ShouldEqual, 64)
		So(numberOfLeadingZeros(8), ShouldEqual, 60)
		So(numberOfLeadingZeros(1<<17), ShouldEqual, 64-17-1)
		So(numberOfLeadingZeros(0xFFFFFFFFFFFFFFFF), ShouldEqual, 0)
		So(countLeadingZeros(0), ShouldEqual, 64)
		So(countLeadingZeros(8), ShouldEqual, 60)
		So(countLeadingZeros(1<<17), ShouldEqual, 64-17-1)
		So(countLeadingZeros(0xFFFFFFFFFFFFFFFF), ShouldEqual, 0)

	})
}
