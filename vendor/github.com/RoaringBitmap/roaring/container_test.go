package roaring

import (
	"log"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func makeContainer(ss []uint16) container {
	c := newArrayContainer()
	for _, s := range ss {
		c.iadd(s)
	}
	return c
}

func checkContent(c container, s []uint16) bool {
	si := c.getShortIterator()
	ctr := 0
	fail := false
	for si.hasNext() {
		if ctr == len(s) {
			log.Println("HERE")
			fail = true
			break
		}
		i := si.next()
		if i != s[ctr] {

			log.Println("THERE", i, s[ctr])
			fail = true
			break
		}
		ctr++
	}
	if ctr != len(s) {
		log.Println("LAST")
		fail = true
	}
	if fail {
		log.Println("fail, found ")
		si = c.getShortIterator()
		z := 0
		for si.hasNext() {
			si.next()
			z++
		}
		log.Println(z, len(s))
	}

	return !fail
}

func TestContainerReverseIterator(t *testing.T) {
	Convey("ArrayReverseIterator", t, func() {
		content := []uint16{1, 3, 5, 7, 9}
		c := makeContainer(content)
		si := c.getReverseIterator()
		i := 4
		for si.hasNext() {
			So(si.next(), ShouldEqual, content[i])
			i--
		}
		So(i, ShouldEqual, -1)
	})
}

func TestRoaringContainer(t *testing.T) {
	Convey("countTrailingZeros", t, func() {
		x := uint64(0)
		o := countTrailingZeros(x)
		So(o, ShouldEqual, 64)
		x = 1 << 3
		o = countTrailingZeros(x)
		So(o, ShouldEqual, 3)
	})
	Convey("ArrayShortIterator", t, func() {
		content := []uint16{1, 3, 5, 7, 9}
		c := makeContainer(content)
		si := c.getShortIterator()
		i := 0
		for si.hasNext() {
			si.next()
			i++
		}

		So(i, ShouldEqual, 5)
	})

	Convey("BinarySearch", t, func() {
		content := []uint16{1, 3, 5, 7, 9}
		res := binarySearch(content, 5)
		So(res, ShouldEqual, 2)
		res = binarySearch(content, 4)
		So(res, ShouldBeLessThan, 0)
	})
	Convey("bitmapcontainer", t, func() {
		content := []uint16{1, 3, 5, 7, 9}
		a := newArrayContainer()
		b := newBitmapContainer()
		for _, v := range content {
			a.iadd(v)
			b.iadd(v)
		}
		c := a.toBitmapContainer()

		So(a.getCardinality(), ShouldEqual, b.getCardinality())
		So(c.getCardinality(), ShouldEqual, b.getCardinality())

	})
	Convey("inottest0", t, func() {
		content := []uint16{9}
		c := makeContainer(content)
		c = c.inot(0, 11)
		si := c.getShortIterator()
		i := 0
		for si.hasNext() {
			si.next()
			i++
		}
		So(i, ShouldEqual, 10)
	})

	Convey("inotTest1", t, func() {
		// Array container, range is complete
		content := []uint16{1, 3, 5, 7, 9}
		//content := []uint16{1}
		edge := 1 << 13
		c := makeContainer(content)
		c = c.inot(0, edge+1)
		size := edge - len(content)
		s := make([]uint16, size+1)
		pos := 0
		for i := uint16(0); i < uint16(edge+1); i++ {
			if binarySearch(content, i) < 0 {
				s[pos] = i
				pos++
			}
		}
		So(checkContent(c, s), ShouldEqual, true)
	})

}
