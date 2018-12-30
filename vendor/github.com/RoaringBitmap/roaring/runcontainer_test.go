package roaring

import (
	"fmt"
	. "github.com/smartystreets/goconvey/convey"
	"math/rand"
	"sort"
	"strings"
	"testing"
)

// trial is used in the randomized testing of runContainers
type trial struct {
	n           int
	percentFill float64
	ntrial      int

	// only in the union test
	// only subtract test
	percentDelete float64

	// only in 067 randomized operations
	// we do this + 1 passes
	numRandomOpsPass int

	// allow sampling range control
	// only recent tests respect this.
	srang *interval16
}

func TestRleInterval16s(t *testing.T) {

	Convey("canMerge, and mergeInterval16s should do what they say", t, func() {
		a := newInterval16Range(0, 9)
		b := newInterval16Range(0, 1)
		report := sliceToString16([]interval16{a, b})
		_ = report
		c := newInterval16Range(2, 4)
		d := newInterval16Range(2, 5)
		e := newInterval16Range(0, 4)
		f := newInterval16Range(9, 9)
		g := newInterval16Range(8, 9)
		h := newInterval16Range(5, 6)
		i := newInterval16Range(6, 6)

		aIb, empty := intersectInterval16s(a, b)
		So(empty, ShouldBeFalse)
		So(aIb, ShouldResemble, b)

		So(canMerge16(b, c), ShouldBeTrue)
		So(canMerge16(c, b), ShouldBeTrue)
		So(canMerge16(a, h), ShouldBeTrue)

		So(canMerge16(d, e), ShouldBeTrue)
		So(canMerge16(f, g), ShouldBeTrue)
		So(canMerge16(c, h), ShouldBeTrue)

		So(canMerge16(b, h), ShouldBeFalse)
		So(canMerge16(h, b), ShouldBeFalse)
		So(canMerge16(c, i), ShouldBeFalse)

		So(mergeInterval16s(b, c), ShouldResemble, e)
		So(mergeInterval16s(c, b), ShouldResemble, e)

		So(mergeInterval16s(h, i), ShouldResemble, h)
		So(mergeInterval16s(i, h), ShouldResemble, h)

		////// start
		So(mergeInterval16s(newInterval16Range(0, 0), newInterval16Range(1, 1)), ShouldResemble, newInterval16Range(0, 1))
		So(mergeInterval16s(newInterval16Range(1, 1), newInterval16Range(0, 0)), ShouldResemble, newInterval16Range(0, 1))
		So(mergeInterval16s(newInterval16Range(0, 4), newInterval16Range(3, 5)), ShouldResemble, newInterval16Range(0, 5))
		So(mergeInterval16s(newInterval16Range(0, 4), newInterval16Range(3, 4)), ShouldResemble, newInterval16Range(0, 4))

		So(mergeInterval16s(newInterval16Range(0, 8), newInterval16Range(1, 7)), ShouldResemble, newInterval16Range(0, 8))
		So(mergeInterval16s(newInterval16Range(1, 7), newInterval16Range(0, 8)), ShouldResemble, newInterval16Range(0, 8))

		So(func() { _ = mergeInterval16s(newInterval16Range(0, 0), newInterval16Range(2, 3)) }, ShouldPanic)

	})
}

func TestRunOffset(t *testing.T) {
	v := newRunContainer16TakeOwnership([]interval16{newInterval16Range(34, 39)})
	offtest := uint16(65500)
	w := v.addOffset(offtest)
	w0card := w[0].getCardinality()
	w1card := w[1].getCardinality()
	t.Logf("%d %d", w0card, w1card)
	if w0card+w1card != 6 {
		t.Errorf("Bogus cardinality.")
	}
	expected := []int{65534, 65535, 65536, 65537, 65538, 65539}
	wout := make([]int, len(expected))
	for i := 0; i < w0card; i++ {
		wout[i] = w[0].selectInt(uint16(i))
	}
	for i := 0; i < w1card; i++ {
		wout[i+w0card] = w[1].selectInt(uint16(i)) + 65536
	}
	t.Logf("%v %v", wout, expected)
	for i, x := range wout {
		if x != expected[i] {
			t.Errorf("found discrepancy %d!=%d", x, expected[i])
		}
	}
}

func TestRleRunIterator16(t *testing.T) {

	Convey("RunIterator16 unit tests for Cur, Next, HasNext, and Remove should pass", t, func() {
		{
			rc := newRunContainer16()
			msg := rc.String()
			_ = msg
			So(rc.cardinality(), ShouldEqual, 0)
			it := rc.newRunIterator16()
			So(it.hasNext(), ShouldBeFalse)
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{newInterval16Range(4, 4)})
			So(rc.cardinality(), ShouldEqual, 1)
			it := rc.newRunIterator16()
			So(it.hasNext(), ShouldBeTrue)
			So(it.next(), ShouldResemble, uint16(4))
			So(it.cur(), ShouldResemble, uint16(4))
		}
		{
			rc := newRunContainer16CopyIv([]interval16{newInterval16Range(4, 9)})
			So(rc.cardinality(), ShouldEqual, 6)
			it := rc.newRunIterator16()
			So(it.hasNext(), ShouldBeTrue)
			for i := 4; i < 10; i++ {
				So(it.next(), ShouldEqual, uint16(i))
			}
			So(it.hasNext(), ShouldBeFalse)
		}

		{
			// basic nextMany test
			rc := newRunContainer16CopyIv([]interval16{newInterval16Range(4, 9)})
			So(rc.cardinality(), ShouldEqual, 6)
			it := rc.newManyRunIterator16()

			buf := make([]uint32, 10)
			n := it.nextMany(0, buf)
			So(n, ShouldEqual, 6)
			expected := []uint32{4, 5, 6, 7, 8, 9, 0, 0, 0, 0}
			for i, e := range expected {
				So(buf[i], ShouldEqual, e)
			}
		}

		{
			// nextMany with len(buf) == 0
			rc := newRunContainer16CopyIv([]interval16{newInterval16Range(4, 9)})
			So(rc.cardinality(), ShouldEqual, 6)
			it := rc.newManyRunIterator16()
			var buf []uint32
			n := it.nextMany(0, buf)
			So(n, ShouldEqual, 0)
		}

		{
			// basic nextMany test across ranges
			rc := newRunContainer16CopyIv([]interval16{
				newInterval16Range(4, 7),
				newInterval16Range(11, 13),
				newInterval16Range(18, 21)})
			So(rc.cardinality(), ShouldEqual, 11)
			it := rc.newManyRunIterator16()

			buf := make([]uint32, 15)
			n := it.nextMany(0, buf)
			So(n, ShouldEqual, 11)
			expected := []uint32{4, 5, 6, 7, 11, 12, 13, 18, 19, 20, 21, 0, 0, 0, 0}
			for i, e := range expected {
				So(buf[i], ShouldEqual, e)
			}
		}
		{
			// basic nextMany test across ranges with different buffer sizes
			rc := newRunContainer16CopyIv([]interval16{
				newInterval16Range(4, 7),
				newInterval16Range(11, 13),
				newInterval16Range(18, 21)})
			expectedCard := 11
			expectedVals := []uint32{4, 5, 6, 7, 11, 12, 13, 18, 19, 20, 21}
			hs := uint32(1 << 16)

			So(rc.cardinality(), ShouldEqual, expectedCard)

			for bufSize := 2; bufSize < 15; bufSize++ {
				buf := make([]uint32, bufSize)
				seen := 0
				it := rc.newManyRunIterator16()
				for n := it.nextMany(hs, buf); n != 0; n = it.nextMany(hs, buf) {
					// catch runaway iteration
					So(seen+n, ShouldBeLessThanOrEqualTo, expectedCard)

					for i, e := range expectedVals[seen : seen+n] {
						So(buf[i], ShouldEqual, e+hs)
					}
					seen += n
					// if we have more values to return then we shouldn't leave empty slots in the buffer
					if seen < expectedCard {
						So(n, ShouldEqual, bufSize)
					}
				}
				So(seen, ShouldEqual, expectedCard)
			}
		}

		{
			// basic nextMany interaction with hasNext
			rc := newRunContainer16CopyIv([]interval16{newInterval16Range(4, 4)})
			So(rc.cardinality(), ShouldEqual, 1)
			it := rc.newManyRunIterator16()
			So(it.hasNext(), ShouldBeTrue)

			buf := make([]uint32, 4)

			n := it.nextMany(0, buf)
			So(n, ShouldEqual, 1)
			expected := []uint32{4, 0, 0, 0}
			for i, e := range expected {
				So(buf[i], ShouldEqual, e)
			}
			So(it.hasNext(), ShouldBeFalse)

			buf = make([]uint32, 4)
			n = it.nextMany(0, buf)
			So(n, ShouldEqual, 0)
			expected = []uint32{0, 0, 0, 0}
			for i, e := range expected {
				So(buf[i], ShouldEqual, e)
			}
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{newInterval16Range(4, 9)})
			card := rc.cardinality()
			So(card, ShouldEqual, 6)

			it := rc.newRunIterator16()
			So(it.hasNext(), ShouldBeTrue)
			for i := 4; i < 6; i++ {
				So(it.next(), ShouldEqual, uint16(i))
			}
			So(it.cur(), ShouldEqual, uint16(5))

			So(it.remove(), ShouldEqual, uint16(5))

			So(rc.cardinality(), ShouldEqual, 5)

			it2 := rc.newRunIterator16()
			So(rc.cardinality(), ShouldEqual, 5)
			So(it2.next(), ShouldEqual, uint16(4))
			for i := 6; i < 10; i++ {
				So(it2.next(), ShouldEqual, uint16(i))
			}
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{
				newInterval16Range(0, 0),
				newInterval16Range(2, 2),
				newInterval16Range(4, 4),
			})
			rc1 := newRunContainer16TakeOwnership([]interval16{
				newInterval16Range(6, 7),
				newInterval16Range(10, 11),
				newInterval16Range(MaxUint16, MaxUint16),
			})

			rc = rc.union(rc1)

			So(rc.cardinality(), ShouldEqual, 8)
			it := rc.newRunIterator16()
			So(it.next(), ShouldEqual, uint16(0))
			So(it.next(), ShouldEqual, uint16(2))
			So(it.next(), ShouldEqual, uint16(4))
			So(it.next(), ShouldEqual, uint16(6))
			So(it.next(), ShouldEqual, uint16(7))
			So(it.next(), ShouldEqual, uint16(10))
			So(it.next(), ShouldEqual, uint16(11))
			So(it.next(), ShouldEqual, uint16(MaxUint16))
			So(it.hasNext(), ShouldEqual, false)

			newInterval16Range(0, MaxUint16)
			rc2 := newRunContainer16TakeOwnership([]interval16{newInterval16Range(0, MaxUint16)})

			rc2 = rc2.union(rc)
			So(rc2.numIntervals(), ShouldEqual, 1)
		}
	})
}

func TestRleRunReverseIterator16(t *testing.T) {

	Convey("RunReverseIterator16 unit tests for cur, next, hasNext, and remove should pass", t, func() {
		{
			rc := newRunContainer16()
			it := rc.newRunReverseIterator16()
			So(it.hasNext(), ShouldBeFalse)
			So(func() { it.next() }, ShouldPanic)
			So(func() { it.remove() }, ShouldPanic)
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{newInterval16Range(0, 0)})
			it := rc.newRunReverseIterator16()
			So(it.hasNext(), ShouldBeTrue)
			So(it.next(), ShouldResemble, uint16(0))
			So(it.cur(), ShouldResemble, uint16(0))
			So(func() { it.next() }, ShouldPanic)
			So(it.remove(), ShouldEqual, uint16(0))
			So(func() { it.remove() }, ShouldPanic)
			So(it.hasNext(), ShouldBeFalse)
			So(func() { it.next() }, ShouldPanic)
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{newInterval16Range(4, 4)})
			it := rc.newRunReverseIterator16()
			So(it.hasNext(), ShouldBeTrue)
			So(it.next(), ShouldResemble, uint16(4))
			So(it.cur(), ShouldResemble, uint16(4))
			So(it.hasNext(), ShouldBeFalse)
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{newInterval16Range(MaxUint16, MaxUint16)})
			it := rc.newRunReverseIterator16()
			So(it.hasNext(), ShouldBeTrue)
			So(it.next(), ShouldResemble, uint16(MaxUint16))
			So(it.cur(), ShouldResemble, uint16(MaxUint16))
			So(it.hasNext(), ShouldBeFalse)
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{newInterval16Range(4, 9)})
			it := rc.newRunReverseIterator16()
			So(it.hasNext(), ShouldBeTrue)
			for i := 9; i >= 4; i-- {
				So(it.next(), ShouldEqual, uint16(i))
				if i > 4 {
					So(it.hasNext(), ShouldBeTrue)
				} else if i == 4 {
					So(it.hasNext(), ShouldBeFalse)
				}
			}
			So(it.hasNext(), ShouldBeFalse)
			So(func() { it.next() }, ShouldPanic)
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{newInterval16Range(4, 9)})
			it := rc.newRunReverseIterator16()
			So(it.hasNext(), ShouldBeTrue)
			for i := 9; i >= 5; i-- {
				So(it.next(), ShouldEqual, uint16(i))
			}
			So(it.cur(), ShouldEqual, uint16(5))
			So(it.remove(), ShouldEqual, uint16(5))
			So(rc.cardinality(), ShouldEqual, 5)

			it2 := rc.newRunReverseIterator16()
			So(rc.cardinality(), ShouldEqual, 5)
			So(it2.next(), ShouldEqual, uint16(9))
			for i := 8; i > 5; i-- {
				So(it2.next(), ShouldEqual, uint16(i))
			}
		}
		{
			rc := newRunContainer16TakeOwnership([]interval16{
				newInterval16Range(0, 0),
				newInterval16Range(2, 2),
				newInterval16Range(4, 4),
				newInterval16Range(6, 7),
				newInterval16Range(10, 12),
				newInterval16Range(MaxUint16, MaxUint16),
			})

			it := rc.newRunReverseIterator16()
			So(it.next(), ShouldEqual, uint16(MaxUint16))
			So(it.next(), ShouldEqual, uint16(12))
			So(it.next(), ShouldEqual, uint16(11))
			So(it.next(), ShouldEqual, uint16(10))
			So(it.next(), ShouldEqual, uint16(7))
			So(it.next(), ShouldEqual, uint16(6))
			So(it.next(), ShouldEqual, uint16(4))
			So(it.next(), ShouldEqual, uint16(2))
			So(it.next(), ShouldEqual, uint16(0))
			So(it.hasNext(), ShouldEqual, false)
			So(func() { it.next() }, ShouldPanic)
		}
	})
}

func TestRleRunSearch16(t *testing.T) {

	Convey("RunContainer16.search should respect the prior bounds we provide for efficiency of searching through a subset of the intervals", t, func() {
		{
			vals := []uint16{0, 2, 4, 6, 8, 10, 12, 14, 16, 18, MaxUint16 - 3, MaxUint16}
			exAt := []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11} // expected at
			absent := []uint16{1, 3, 5, 7, 9, 11, 13, 15, 17, 19, MaxUint16 - 2}

			rc := newRunContainer16FromVals(true, vals...)

			So(rc.cardinality(), ShouldEqual, 12)

			var where int64
			var present bool

			for i, v := range vals {
				where, present, _ = rc.search(int64(v), nil)
				So(present, ShouldBeTrue)
				So(where, ShouldEqual, exAt[i])
			}

			for i, v := range absent {
				where, present, _ = rc.search(int64(v), nil)
				So(present, ShouldBeFalse)
				So(where, ShouldEqual, i)
			}

			// delete the MaxUint16 so we can test
			// the behavior when searching near upper limit.

			So(rc.cardinality(), ShouldEqual, 12)
			So(rc.numIntervals(), ShouldEqual, 12)

			rc.removeKey(MaxUint16)
			So(rc.cardinality(), ShouldEqual, 11)
			So(rc.numIntervals(), ShouldEqual, 11)

			where, present, _ = rc.search(MaxUint16, nil)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)

			var numCompares int
			where, present, numCompares = rc.search(MaxUint16, nil)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)
			So(numCompares, ShouldEqual, 3)

			opts := &searchOptions{
				startIndex: 5,
			}
			where, present, numCompares = rc.search(MaxUint16, opts)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)
			So(numCompares, ShouldEqual, 2)

			where, present, _ = rc.search(MaxUint16-3, opts)
			So(present, ShouldBeTrue)
			So(where, ShouldEqual, 10)

			// with the bound in place, MaxUint16-3 should not be found
			opts.endxIndex = 10
			where, present, _ = rc.search(MaxUint16-3, opts)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 9)

		}
	})

}

func TestRleIntersection16(t *testing.T) {

	Convey("RunContainer16.intersect of two RunContainer16(s) should return their intersection", t, func() {
		{
			vals := []uint16{0, 2, 4, 6, 8, 10, 12, 14, 16, 18, MaxUint16 - 3, MaxUint16 - 1}

			a := newRunContainer16FromVals(true, vals[:5]...)
			b := newRunContainer16FromVals(true, vals[2:]...)
			So(haveOverlap16(newInterval16Range(0, 2), newInterval16Range(2, 2)), ShouldBeTrue)
			So(haveOverlap16(newInterval16Range(0, 2), newInterval16Range(3, 3)), ShouldBeFalse)

			isect := a.intersect(b)
			So(isect.cardinality(), ShouldEqual, 3)
			So(isect.contains(4), ShouldBeTrue)
			So(isect.contains(6), ShouldBeTrue)
			So(isect.contains(8), ShouldBeTrue)

			newInterval16Range(0, MaxUint16)
			d := newRunContainer16TakeOwnership([]interval16{newInterval16Range(0, MaxUint16)})

			isect = isect.intersect(d)
			So(isect.cardinality(), ShouldEqual, 3)
			So(isect.contains(4), ShouldBeTrue)
			So(isect.contains(6), ShouldBeTrue)
			So(isect.contains(8), ShouldBeTrue)

			e := newRunContainer16TakeOwnership(
				[]interval16{
					newInterval16Range(2, 4),
					newInterval16Range(8, 9),
					newInterval16Range(14, 16),
					newInterval16Range(20, 22)},
			)
			f := newRunContainer16TakeOwnership(
				[]interval16{
					newInterval16Range(3, 18),
					newInterval16Range(22, 23)},
			)

			{
				isect = e.intersect(f)
				So(isect.cardinality(), ShouldEqual, 8)
				So(isect.contains(3), ShouldBeTrue)
				So(isect.contains(4), ShouldBeTrue)
				So(isect.contains(8), ShouldBeTrue)
				So(isect.contains(9), ShouldBeTrue)
				So(isect.contains(14), ShouldBeTrue)
				So(isect.contains(15), ShouldBeTrue)
				So(isect.contains(16), ShouldBeTrue)
				So(isect.contains(22), ShouldBeTrue)
			}

			{
				// check for symmetry
				isect = f.intersect(e)
				So(isect.cardinality(), ShouldEqual, 8)
				So(isect.contains(3), ShouldBeTrue)
				So(isect.contains(4), ShouldBeTrue)
				So(isect.contains(8), ShouldBeTrue)
				So(isect.contains(9), ShouldBeTrue)
				So(isect.contains(14), ShouldBeTrue)
				So(isect.contains(15), ShouldBeTrue)
				So(isect.contains(16), ShouldBeTrue)
				So(isect.contains(22), ShouldBeTrue)
			}

		}
	})
}

func TestRleRandomIntersection16(t *testing.T) {

	Convey("RunContainer.intersect of two RunContainers should return their intersection, and this should hold over randomized container content when compared to intersection done with hash maps", t, func() {

		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .80, ntrial: 10},
			{n: 1000, percentFill: .20, ntrial: 20},
			{n: 10000, percentFill: .01, ntrial: 10},
			{n: 1000, percentFill: .99, ntrial: 10},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				var first, second int

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
					if i == 0 {
						first = r0
						second = r0 + 1
						a = append(a, uint16(second))
						ma[second] = true
					}

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				// print a; very likely it has dups
				sort.Sort(uint16Slice(a))
				stringA := ""
				for i := range a {
					stringA += fmt.Sprintf("%v, ", a[i])
				}

				// hash version of intersect:
				hashi := make(map[int]bool)
				for k := range ma {
					if mb[k] {
						hashi[k] = true
					}
				}

				// RunContainer's Intersect
				brle := newRunContainer16FromVals(false, b...)

				//arle := newRunContainer16FromVals(false, a...)
				// instead of the above line, create from array
				// get better test coverage:
				arr := newArrayContainerRange(int(first), int(second))
				arle := newRunContainer16FromArray(arr)
				arle.set(false, a...)

				isect := arle.intersect(brle)

				//showHash("hashi", hashi)

				for k := range hashi {
					So(isect.contains(uint16(k)), ShouldBeTrue)
				}

				So(isect.cardinality(), ShouldEqual, len(hashi))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRleRandomUnion16(t *testing.T) {

	Convey("RunContainer.union of two RunContainers should return their union, and this should hold over randomized container content when compared to union done with hash maps", t, func() {

		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .80, ntrial: 10},
			{n: 1000, percentFill: .20, ntrial: 20},
			{n: 10000, percentFill: .01, ntrial: 10},
			{n: 1000, percentFill: .99, ntrial: 10, percentDelete: .04},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				numDel := int(float64(n) * tr.percentDelete)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				// hash version of union:
				hashu := make(map[int]bool)
				for k := range ma {
					hashu[k] = true
				}
				for k := range mb {
					hashu[k] = true
				}

				//showHash("hashu", hashu)

				// RunContainer's Union
				arle := newRunContainer16()
				for i := range a {
					arle.Add(a[i])
				}
				brle := newRunContainer16()
				brle.set(false, b...)

				union := arle.union(brle)
				un := union.AsSlice()
				sort.Sort(uint16Slice(un))

				for kk, v := range un {
					_ = kk
					So(hashu[int(v)], ShouldBeTrue)
				}

				for k := range hashu {
					So(union.contains(uint16(k)), ShouldBeTrue)
				}

				So(union.cardinality(), ShouldEqual, len(hashu))

				// do the deletes, exercising the remove functionality
				for i := 0; i < numDel; i++ {
					r1 := rand.Intn(len(a))
					goner := a[r1]
					union.removeKey(goner)
					delete(hashu, int(goner))
				}
				// verify the same as in the hashu
				So(union.cardinality(), ShouldEqual, len(hashu))
				for k := range hashu {
					So(union.contains(uint16(k)), ShouldBeTrue)
				}

			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRleAndOrXor16(t *testing.T) {

	Convey("RunContainer And, Or, Xor tests", t, func() {
		{
			rc := newRunContainer16TakeOwnership([]interval16{
				newInterval16Range(0, 0),
				newInterval16Range(2, 2),
				newInterval16Range(4, 4),
			})
			b0 := NewBitmap()
			b0.Add(2)
			b0.Add(6)
			b0.Add(8)

			and := rc.And(b0)
			or := rc.Or(b0)
			xor := rc.Xor(b0)

			So(and.GetCardinality(), ShouldEqual, 1)
			So(or.GetCardinality(), ShouldEqual, 5)
			So(xor.GetCardinality(), ShouldEqual, 4)

			// test creating size 0 and 1 from array
			arr := newArrayContainerCapacity(0)
			empty := newRunContainer16FromArray(arr)
			onceler := newArrayContainerCapacity(1)
			onceler.content = append(onceler.content, uint16(0))
			oneZero := newRunContainer16FromArray(onceler)
			So(empty.cardinality(), ShouldEqual, 0)
			So(oneZero.cardinality(), ShouldEqual, 1)
			So(empty.And(b0).GetCardinality(), ShouldEqual, 0)
			So(empty.Or(b0).GetCardinality(), ShouldEqual, 3)

			// exercise newRunContainer16FromVals() with 0 and 1 inputs.
			empty2 := newRunContainer16FromVals(false, []uint16{}...)
			So(empty2.cardinality(), ShouldEqual, 0)
			one2 := newRunContainer16FromVals(false, []uint16{1}...)
			So(one2.cardinality(), ShouldEqual, 1)
		}
	})
}

func TestRlePanics16(t *testing.T) {

	Convey("Some RunContainer calls/methods should panic if misused", t, func() {

		// newRunContainer16FromVals
		So(func() { newRunContainer16FromVals(true, 1, 0) }, ShouldPanic)

		arr := newArrayContainerRange(1, 3)
		arr.content = []uint16{2, 3, 3, 2, 1}
		So(func() { newRunContainer16FromArray(arr) }, ShouldPanic)
	})
}

func TestRleCoverageOddsAndEnds16(t *testing.T) {

	Convey("Some RunContainer code paths that don't otherwise get coverage -- these should be tested to increase percentage of code coverage in testing", t, func() {

		rc := &runContainer16{}
		So(rc.String(), ShouldEqual, "runContainer16{}")
		rc.iv = make([]interval16, 1)
		rc.iv[0] = newInterval16Range(3, 4)
		So(rc.String(), ShouldEqual, "runContainer16{0:[3, 4], }")

		a := newInterval16Range(5, 9)
		b := newInterval16Range(0, 1)
		c := newInterval16Range(1, 2)

		// intersectInterval16s(a, b interval16)
		isect, isEmpty := intersectInterval16s(a, b)
		So(isEmpty, ShouldBeTrue)
		// [0,0] can't be trusted: So(isect.runlen(), ShouldEqual, 0)
		isect, isEmpty = intersectInterval16s(b, c)
		So(isEmpty, ShouldBeFalse)
		So(isect.runlen(), ShouldEqual, 1)

		// runContainer16.union
		{
			ra := newRunContainer16FromVals(false, 4, 5)
			rb := newRunContainer16FromVals(false, 4, 6, 8, 9, 10)
			ra.union(rb)
			So(rb.indexOfIntervalAtOrAfter(4, 2), ShouldEqual, 2)
			So(rb.indexOfIntervalAtOrAfter(3, 2), ShouldEqual, 2)
		}

		// runContainer.intersect
		{
			ra := newRunContainer16()
			rb := newRunContainer16()
			So(ra.intersect(rb).cardinality(), ShouldEqual, 0)
		}
		{
			ra := newRunContainer16FromVals(false, 1)
			rb := newRunContainer16FromVals(false, 4)
			So(ra.intersect(rb).cardinality(), ShouldEqual, 0)
		}

		// runContainer.Add
		{
			ra := newRunContainer16FromVals(false, 1)
			rb := newRunContainer16FromVals(false, 4)
			So(ra.cardinality(), ShouldEqual, 1)
			So(rb.cardinality(), ShouldEqual, 1)
			ra.Add(5)
			So(ra.cardinality(), ShouldEqual, 2)

			// newRunIterator16()
			empty := newRunContainer16()
			it := empty.newRunIterator16()
			So(func() { it.next() }, ShouldPanic)
			it2 := ra.newRunIterator16()
			it2.curIndex = int64(len(it2.rc.iv))
			So(func() { it2.next() }, ShouldPanic)

			// runIterator16.remove()
			emptyIt := empty.newRunIterator16()
			So(func() { emptyIt.remove() }, ShouldPanic)

			// newRunContainer16FromArray
			arr := newArrayContainerRange(1, 6)
			arr.content = []uint16{5, 5, 5, 6, 9}
			rc3 := newRunContainer16FromArray(arr)
			So(rc3.cardinality(), ShouldEqual, 3)

			// runContainer16SerializedSizeInBytes
			// runContainer16.SerializedSizeInBytes
			_ = runContainer16SerializedSizeInBytes(3)
			_ = rc3.serializedSizeInBytes()

			// findNextIntervalThatIntersectsStartingFrom
			idx, _ := rc3.findNextIntervalThatIntersectsStartingFrom(0, 100)
			So(idx, ShouldEqual, 1)

			// deleteAt / remove
			rc3.Add(10)
			rc3.removeKey(10)
			rc3.removeKey(9)
			So(rc3.cardinality(), ShouldEqual, 2)
			rc3.Add(9)
			rc3.Add(10)
			rc3.Add(12)
			So(rc3.cardinality(), ShouldEqual, 5)
			it3 := rc3.newRunIterator16()
			it3.next()
			it3.next()
			it3.next()
			it3.next()
			So(it3.cur(), ShouldEqual, uint16(10))
			it3.remove()
			So(it3.next(), ShouldEqual, uint16(12))
		}

		// runContainer16.equals
		{
			rc16 := newRunContainer16()
			So(rc16.equals16(rc16), ShouldBeTrue)
			rc16b := newRunContainer16()
			So(rc16.equals16(rc16b), ShouldBeTrue)
			rc16.Add(1)
			rc16b.Add(2)
			So(rc16.equals16(rc16b), ShouldBeFalse)
		}
	})
}

func TestRleStoringMax16(t *testing.T) {

	Convey("Storing the MaxUint16 should be possible, because it may be necessary to do so--users will assume that any valid uint16 should be storable. In particular the smaller 16-bit version will definitely expect full access to all bits.", t, func() {

		rc := newRunContainer16()
		rc.Add(MaxUint16)
		So(rc.contains(MaxUint16), ShouldBeTrue)
		So(rc.cardinality(), ShouldEqual, 1)
		rc.removeKey(MaxUint16)
		So(rc.contains(MaxUint16), ShouldBeFalse)
		So(rc.cardinality(), ShouldEqual, 0)

		rc.set(false, MaxUint16-1, MaxUint16)
		So(rc.cardinality(), ShouldEqual, 2)

		So(rc.contains(MaxUint16-1), ShouldBeTrue)
		So(rc.contains(MaxUint16), ShouldBeTrue)
		rc.removeKey(MaxUint16 - 1)
		So(rc.cardinality(), ShouldEqual, 1)
		rc.removeKey(MaxUint16)
		So(rc.cardinality(), ShouldEqual, 0)

		rc.set(false, MaxUint16-2, MaxUint16-1, MaxUint16)
		So(rc.cardinality(), ShouldEqual, 3)
		So(rc.numIntervals(), ShouldEqual, 1)
		rc.removeKey(MaxUint16 - 1)
		So(rc.numIntervals(), ShouldEqual, 2)
		So(rc.cardinality(), ShouldEqual, 2)

	})
}

// go test -bench BenchmarkFromBitmap -run -
func BenchmarkFromBitmap16(b *testing.B) {
	b.StopTimer()
	seed := int64(42)
	rand.Seed(seed)

	tr := trial{n: 10000, percentFill: .95, ntrial: 1, numRandomOpsPass: 100}
	_, _, bc := getRandomSameThreeContainers(tr)

	b.StartTimer()

	for j := 0; j < b.N; j++ {
		newRunContainer16FromBitmapContainer(bc)
	}
}

func TestRle16RandomIntersectAgainstOtherContainers010(t *testing.T) {

	Convey("runContainer16 `and` operation against other container types should correctly do the intersection", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .95, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				//showArray16(a, "a")
				//showArray16(b, "b")

				// hash version of intersect:
				hashi := make(map[int]bool)
				for k := range ma {
					if mb[k] {
						hashi[k] = true
					}
				}

				// RunContainer's Intersect
				rc := newRunContainer16FromVals(false, a...)

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, bv := range b {
					bc.iadd(bv)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, bv := range b {
					ac.iadd(bv)
				}

				// vs runContainer
				rcb := newRunContainer16FromVals(false, b...)

				rcVsBcIsect := rc.and(bc)
				rcVsAcIsect := rc.and(ac)
				rcVsRcbIsect := rc.and(rcb)

				for k := range hashi {
					So(rcVsBcIsect.contains(uint16(k)), ShouldBeTrue)

					So(rcVsAcIsect.contains(uint16(k)), ShouldBeTrue)

					So(rcVsRcbIsect.contains(uint16(k)), ShouldBeTrue)
				}

				So(rcVsBcIsect.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsAcIsect.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsRcbIsect.getCardinality(), ShouldEqual, len(hashi))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16RandomUnionAgainstOtherContainers011(t *testing.T) {

	Convey("runContainer16 `or` operation against other container types should correctly do the intersection", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .95, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				//showArray16(a, "a")
				//showArray16(b, "b")

				// hash version of union
				hashi := make(map[int]bool)
				for k := range ma {
					hashi[k] = true
				}
				for k := range mb {
					hashi[k] = true
				}

				// RunContainer's 'or'
				rc := newRunContainer16FromVals(false, a...)

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, bv := range b {
					bc.iadd(bv)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, bv := range b {
					ac.iadd(bv)
				}

				// vs runContainer
				rcb := newRunContainer16FromVals(false, b...)

				rcVsBcUnion := rc.or(bc)
				rcVsAcUnion := rc.or(ac)
				rcVsRcbUnion := rc.or(rcb)

				for k := range hashi {
					So(rcVsBcUnion.contains(uint16(k)), ShouldBeTrue)
					So(rcVsAcUnion.contains(uint16(k)), ShouldBeTrue)
					So(rcVsRcbUnion.contains(uint16(k)), ShouldBeTrue)
				}
				So(rcVsBcUnion.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsAcUnion.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsRcbUnion.getCardinality(), ShouldEqual, len(hashi))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16RandomInplaceUnionAgainstOtherContainers012(t *testing.T) {

	Convey("runContainer16 `ior` inplace union operation against other container types should correctly do the intersection", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 10, percentFill: .95, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				//showArray16(a, "a")
				//showArray16(b, "b")

				// hash version of union
				hashi := make(map[int]bool)
				for k := range ma {
					hashi[k] = true
				}
				for k := range mb {
					hashi[k] = true
				}

				// RunContainer's 'or'
				rc := newRunContainer16FromVals(false, a...)
				rcVsBcUnion := rc.Clone()
				rcVsAcUnion := rc.Clone()
				rcVsRcbUnion := rc.Clone()

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, bv := range b {
					bc.iadd(bv)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, bv := range b {
					ac.iadd(bv)
				}

				// vs runContainer
				rcb := newRunContainer16FromVals(false, b...)

				rcVsBcUnion.ior(bc)
				rcVsAcUnion.ior(ac)
				rcVsRcbUnion.ior(rcb)

				for k := range hashi {
					So(rcVsBcUnion.contains(uint16(k)), ShouldBeTrue)

					So(rcVsAcUnion.contains(uint16(k)), ShouldBeTrue)

					So(rcVsRcbUnion.contains(uint16(k)), ShouldBeTrue)
				}

				So(rcVsBcUnion.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsAcUnion.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsRcbUnion.getCardinality(), ShouldEqual, len(hashi))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16RandomInplaceIntersectAgainstOtherContainers014(t *testing.T) {

	Convey("runContainer16 `iand` inplace-and operation against other container types should correctly do the intersection", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .95, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				//showArray16(a, "a")
				//showArray16(b, "b")

				// hash version of intersect:
				hashi := make(map[int]bool)
				for k := range ma {
					if mb[k] {
						hashi[k] = true
					}
				}

				// RunContainer's Intersect
				rc := newRunContainer16FromVals(false, a...)

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, bv := range b {
					bc.iadd(bv)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, bv := range b {
					ac.iadd(bv)
				}

				// vs runContainer
				rcb := newRunContainer16FromVals(false, b...)

				var rcVsBcIsect container = rc.Clone()
				var rcVsAcIsect container = rc.Clone()
				var rcVsRcbIsect container = rc.Clone()

				rcVsBcIsect = rcVsBcIsect.iand(bc)
				rcVsAcIsect = rcVsAcIsect.iand(ac)
				rcVsRcbIsect = rcVsRcbIsect.iand(rcb)

				for k := range hashi {
					So(rcVsBcIsect.contains(uint16(k)), ShouldBeTrue)

					So(rcVsAcIsect.contains(uint16(k)), ShouldBeTrue)

					So(rcVsRcbIsect.contains(uint16(k)), ShouldBeTrue)
				}

				So(rcVsBcIsect.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsAcIsect.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsRcbIsect.getCardinality(), ShouldEqual, len(hashi))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16RemoveApi015(t *testing.T) {

	Convey("runContainer16 `remove` (a minus b) should work", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .95, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				//showArray16(a, "a")
				//showArray16(b, "b")

				// hash version of remove:
				hashrm := make(map[int]bool)
				for k := range ma {
					hashrm[k] = true
				}
				for k := range mb {
					delete(hashrm, k)
				}

				// RunContainer's remove
				rc := newRunContainer16FromVals(false, a...)

				for k := range mb {
					rc.iremove(uint16(k))
				}

				for k := range hashrm {
					So(rc.contains(uint16(k)), ShouldBeTrue)
				}

				So(rc.getCardinality(), ShouldEqual, len(hashrm))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func showArray16(a []uint16, name string) {
	sort.Sort(uint16Slice(a))
	stringA := ""
	for i := range a {
		stringA += fmt.Sprintf("%v, ", a[i])
	}
}

func TestRle16RandomAndNot016(t *testing.T) {

	Convey("runContainer16 `andNot` operation against other container types should correctly do the and-not operation", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 1000, percentFill: .95, ntrial: 2},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				//showArray16(a, "a")
				//showArray16(b, "b")

				// hash version of and-not
				hashi := make(map[int]bool)
				for k := range ma {
					hashi[k] = true
				}
				for k := range mb {
					delete(hashi, k)
				}

				// RunContainer's and-not
				rc := newRunContainer16FromVals(false, a...)

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, bv := range b {
					bc.iadd(bv)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, bv := range b {
					ac.iadd(bv)
				}

				// vs runContainer
				rcb := newRunContainer16FromVals(false, b...)

				rcVsBcAndnot := rc.andNot(bc)
				rcVsAcAndnot := rc.andNot(ac)
				rcVsRcbAndnot := rc.andNot(rcb)

				for k := range hashi {
					So(rcVsBcAndnot.contains(uint16(k)), ShouldBeTrue)
					So(rcVsAcAndnot.contains(uint16(k)), ShouldBeTrue)
					So(rcVsRcbAndnot.contains(uint16(k)), ShouldBeTrue)
				}

				So(rcVsBcAndnot.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsAcAndnot.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsRcbAndnot.getCardinality(), ShouldEqual, len(hashi))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16RandomInplaceAndNot017(t *testing.T) {

	Convey("runContainer16 `iandNot` operation against other container types should correctly do the inplace-and-not operation", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 1000, percentFill: .95, ntrial: 2},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				//showArray16(a, "a")
				//showArray16(b, "b")

				// hash version of and-not
				hashi := make(map[int]bool)
				for k := range ma {
					hashi[k] = true
				}
				for k := range mb {
					delete(hashi, k)
				}

				// RunContainer's and-not
				rc := newRunContainer16FromVals(false, a...)

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, bv := range b {
					bc.iadd(bv)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, bv := range b {
					ac.iadd(bv)
				}

				// vs runContainer
				rcb := newRunContainer16FromVals(false, b...)

				rcVsBcIandnot := rc.Clone()
				rcVsAcIandnot := rc.Clone()
				rcVsRcbIandnot := rc.Clone()

				rcVsBcIandnot.iandNot(bc)
				rcVsAcIandnot.iandNot(ac)
				rcVsRcbIandnot.iandNot(rcb)

				for k := range hashi {
					So(rcVsBcIandnot.contains(uint16(k)), ShouldBeTrue)
					So(rcVsAcIandnot.contains(uint16(k)), ShouldBeTrue)
					So(rcVsRcbIandnot.contains(uint16(k)), ShouldBeTrue)
				}
				So(rcVsBcIandnot.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsAcIandnot.getCardinality(), ShouldEqual, len(hashi))
				So(rcVsRcbIandnot.getCardinality(), ShouldEqual, len(hashi))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16InversionOfIntervals018(t *testing.T) {

	Convey("runContainer `invert` operation should do a NOT on the set of intervals, in-place", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 1000, percentFill: .90, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				hashNotA := make(map[int]bool)

				n := tr.n
				a := []uint16{}

				// hashNotA will be NOT ma
				//for i := 0; i < n; i++ {
				for i := 0; i < MaxUint16+1; i++ {
					hashNotA[i] = true
				}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
					delete(hashNotA, r0)
				}

				// RunContainer's invert
				rc := newRunContainer16FromVals(false, a...)

				inv := rc.invert()

				So(inv.cardinality(), ShouldEqual, 1+MaxUint16-rc.cardinality())

				for k := 0; k < n; k++ {
					if hashNotA[k] {
						So(inv.contains(uint16(k)), ShouldBeTrue)
					}
				}

				// skip for now, too big to do 2^16-1
				So(inv.getCardinality(), ShouldEqual, len(hashNotA))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16SubtractionOfIntervals019(t *testing.T) {

	Convey("runContainer `subtract` operation removes an interval in-place", t, func() {
		// basics

		i22 := newInterval16Range(2, 2)
		left, _ := i22.subtractInterval(i22)
		So(len(left), ShouldResemble, 0)

		v := newInterval16Range(1, 6)
		left, _ = v.subtractInterval(newInterval16Range(3, 4))
		So(len(left), ShouldResemble, 2)
		So(left[0].start, ShouldEqual, 1)
		So(left[0].last(), ShouldEqual, 2)
		So(left[1].start, ShouldEqual, 5)
		So(left[1].last(), ShouldEqual, 6)

		v = newInterval16Range(1, 6)
		left, _ = v.subtractInterval(newInterval16Range(4, 10))
		So(len(left), ShouldResemble, 1)
		So(left[0].start, ShouldEqual, 1)
		So(left[0].last(), ShouldEqual, 3)

		v = newInterval16Range(5, 10)
		left, _ = v.subtractInterval(newInterval16Range(0, 7))
		So(len(left), ShouldResemble, 1)
		So(left[0].start, ShouldEqual, 8)
		So(left[0].last(), ShouldEqual, 10)

		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 1000, percentFill: .90, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				// hashAminusB will be  ma - mb
				hashAminusB := make(map[int]bool)

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
					hashAminusB[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				for k := range mb {
					delete(hashAminusB, k)
				}

				// RunContainer's subtract A - B
				rc := newRunContainer16FromVals(false, a...)
				rcb := newRunContainer16FromVals(false, b...)

				abkup := rc.Clone()

				it := rcb.newRunIterator16()
				for it.hasNext() {
					nx := it.next()
					rc.isubtract(newInterval16Range(nx, nx))
				}

				// also check full interval subtraction
				for _, p := range rcb.iv {
					abkup.isubtract(p)
				}

				for k := range hashAminusB {
					So(rc.contains(uint16(k)), ShouldBeTrue)
					So(abkup.contains(uint16(k)), ShouldBeTrue)
				}
				So(rc.getCardinality(), ShouldEqual, len(hashAminusB))
				So(abkup.getCardinality(), ShouldEqual, len(hashAminusB))

			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16Rank020(t *testing.T) {
	v := container(newRunContainer16())
	v = v.iaddReturnMinimized(10)
	v = v.iaddReturnMinimized(100)
	v = v.iaddReturnMinimized(1000)
	if v.getCardinality() != 3 {
		t.Errorf("Bogus cardinality.")
	}
	for i := 0; i <= arrayDefaultMaxSize; i++ {
		thisrank := v.rank(uint16(i))
		if i < 10 {
			if thisrank != 0 {
				t.Errorf("At %d should be zero but is %d ", i, thisrank)
			}
		} else if i < 100 {
			if thisrank != 1 {
				t.Errorf("At %d should be zero but is %d ", i, thisrank)
			}
		} else if i < 1000 {
			if thisrank != 2 {
				t.Errorf("At %d should be zero but is %d ", i, thisrank)
			}
		} else {
			if thisrank != 3 {
				t.Errorf("At %d should be zero but is %d ", i, thisrank)
			}
		}
	}
}

func TestRle16NotAlsoKnownAsFlipRange021(t *testing.T) {

	Convey("runContainer `Not` operation should flip the bits of a range on the new returned container", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .8, ntrial: 2},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {

				// what is the interval we are going to flip?

				ma := make(map[int]bool)
				flipped := make(map[int]bool)

				n := tr.n
				a := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
					flipped[r0] = true
				}

				// pick an interval to flip
				begin := rand.Intn(n)
				last := rand.Intn(n)
				if last < begin {
					begin, last = last, begin
				}

				// do the flip on the hash `flipped`
				for i := begin; i <= last; i++ {
					if flipped[i] {
						delete(flipped, i)
					} else {
						flipped[i] = true
					}
				}

				// RunContainer's Not
				rc := newRunContainer16FromVals(false, a...)
				flp := rc.Not(begin, last+1)
				So(flp.cardinality(), ShouldEqual, len(flipped))

				for k := 0; k < n; k++ {
					if flipped[k] {
						So(flp.contains(uint16(k)), ShouldBeTrue)
					} else {
						So(flp.contains(uint16(k)), ShouldBeFalse)
					}
				}

				So(flp.getCardinality(), ShouldEqual, len(flipped))
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRleEquals022(t *testing.T) {

	Convey("runContainer `equals` should accurately compare contents against other container types", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .2, ntrial: 10},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {

				ma := make(map[int]bool)

				n := tr.n
				a := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
				}

				rc := newRunContainer16FromVals(false, a...)

				// make bitmap and array versions:
				bc := newBitmapContainer()
				ac := newArrayContainer()
				for k := range ma {
					ac.iadd(uint16(k))
					bc.iadd(uint16(k))
				}

				// compare equals() across all three
				So(rc.equals(ac), ShouldBeTrue)
				So(rc.equals(bc), ShouldBeTrue)

				So(ac.equals(rc), ShouldBeTrue)
				So(ac.equals(bc), ShouldBeTrue)

				So(bc.equals(ac), ShouldBeTrue)
				So(bc.equals(rc), ShouldBeTrue)

				// and for good measure, check against the hash
				So(rc.getCardinality(), ShouldEqual, len(ma))
				So(ac.getCardinality(), ShouldEqual, len(ma))
				So(bc.getCardinality(), ShouldEqual, len(ma))
				for k := range ma {
					So(rc.contains(uint16(k)), ShouldBeTrue)
					So(ac.contains(uint16(k)), ShouldBeTrue)
					So(bc.contains(uint16(k)), ShouldBeTrue)
				}
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRleIntersects023(t *testing.T) {

	Convey("runContainer `intersects` query should work against any mix of container types", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 10, percentFill: .293, ntrial: 1000},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {

				ma := make(map[int]bool)
				mb := make(map[int]bool)

				n := tr.n
				a := []uint16{}
				b := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint16(r1))
					mb[r1] = true
				}

				// determine if they intersect from the maps
				isect := false
				for k := range ma {
					if mb[k] {
						isect = true
						break
					}
				}

				rcA := newRunContainer16FromVals(false, a...)
				rcB := newRunContainer16FromVals(false, b...)

				// make bitmap and array versions:
				bcA := newBitmapContainer()
				bcB := newBitmapContainer()

				acA := newArrayContainer()
				acB := newArrayContainer()
				for k := range ma {
					acA.iadd(uint16(k))
					bcA.iadd(uint16(k))
				}
				for k := range mb {
					acB.iadd(uint16(k))
					bcB.iadd(uint16(k))
				}

				// compare intersects() across all three

				// same type
				So(rcA.intersects(rcB), ShouldEqual, isect)
				So(acA.intersects(acB), ShouldEqual, isect)
				So(bcA.intersects(bcB), ShouldEqual, isect)

				// across types
				So(rcA.intersects(acB), ShouldEqual, isect)
				So(rcA.intersects(bcB), ShouldEqual, isect)

				So(acA.intersects(rcB), ShouldEqual, isect)
				So(acA.intersects(bcB), ShouldEqual, isect)

				So(bcA.intersects(acB), ShouldEqual, isect)
				So(bcA.intersects(rcB), ShouldEqual, isect)

				// and swap the call pattern, so we test B intersects A as well.

				// same type
				So(rcB.intersects(rcA), ShouldEqual, isect)
				So(acB.intersects(acA), ShouldEqual, isect)
				So(bcB.intersects(bcA), ShouldEqual, isect)

				// across types
				So(rcB.intersects(acA), ShouldEqual, isect)
				So(rcB.intersects(bcA), ShouldEqual, isect)

				So(acB.intersects(rcA), ShouldEqual, isect)
				So(acB.intersects(bcA), ShouldEqual, isect)

				So(bcB.intersects(acA), ShouldEqual, isect)
				So(bcB.intersects(rcA), ShouldEqual, isect)

			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRleToEfficientContainer027(t *testing.T) {

	Convey("runContainer toEfficientContainer should return equivalent containers", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		// 4096 or fewer integers -> array typically

		trials := []trial{
			{n: 8000, percentFill: .01, ntrial: 10},
			{n: 8000, percentFill: .99, ntrial: 10},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {

				ma := make(map[int]bool)

				n := tr.n
				a := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
				}

				rc := newRunContainer16FromVals(false, a...)

				c := rc.toEfficientContainer()
				So(rc.equals(c), ShouldBeTrue)

			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})

	Convey("runContainer toEfficientContainer should return an equivalent bitmap when that is efficient", t, func() {

		a := []uint16{}

		// odd intergers should be smallest as a bitmap
		for i := 0; i < MaxUint16; i++ {
			if i%2 == 1 {
				a = append(a, uint16(i))
			}
		}

		rc := newRunContainer16FromVals(false, a...)

		c := rc.toEfficientContainer()
		So(rc.equals(c), ShouldBeTrue)

		_, isBitmapContainer := c.(*bitmapContainer)
		So(isBitmapContainer, ShouldBeTrue)

	})
}

func TestRle16RandomFillLeastSignificant16bits029(t *testing.T) {

	Convey("runContainer16.fillLeastSignificant16bits() should fill contents as expected, matching the same function on bitmap and array containers", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .95, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)

				n := tr.n
				a := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
				}

				//showArray16(a, "a")

				// RunContainer
				rc := newRunContainer16FromVals(false, a...)

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, av := range a {
					bc.iadd(av)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, av := range a {
					ac.iadd(av)
				}

				acOut := make([]uint32, n+10)
				bcOut := make([]uint32, n+10)
				rcOut := make([]uint32, n+10)

				pos2 := 0

				// see Bitmap.ToArray() for principal use
				hs := uint32(43) << 16
				ac.fillLeastSignificant16bits(acOut, pos2, hs)
				bc.fillLeastSignificant16bits(bcOut, pos2, hs)
				rc.fillLeastSignificant16bits(rcOut, pos2, hs)

				So(rcOut, ShouldResemble, acOut)
				So(rcOut, ShouldResemble, bcOut)
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16RandomGetShortIterator030(t *testing.T) {

	Convey("runContainer16.getShortIterator should traverse the contents expected, matching the traversal of the bitmap and array containers", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .95, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)

				n := tr.n
				a := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
				}

				//showArray16(a, "a")

				// RunContainer
				rc := newRunContainer16FromVals(false, a...)

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, av := range a {
					bc.iadd(av)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, av := range a {
					ac.iadd(av)
				}

				rit := rc.getShortIterator()
				ait := ac.getShortIterator()
				bit := bc.getShortIterator()

				for ait.hasNext() {
					rn := rit.next()
					an := ait.next()
					bn := bit.next()
					So(rn, ShouldEqual, an)
					So(rn, ShouldEqual, bn)
				}
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRle16RandomIaddRangeIremoveRange031(t *testing.T) {

	Convey("runContainer16.iaddRange and iremoveRange should add/remove contents as expected, matching the same operations on the bitmap and array containers and the hashmap pos control", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 101, percentFill: .9, ntrial: 10},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)

				n := tr.n
				a := []uint16{}

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint16(r0))
					ma[r0] = true
				}

				//showArray16(a, "a")

				// RunContainer
				rc := newRunContainer16FromVals(false, a...)

				// vs bitmapContainer
				bc := newBitmapContainer()
				for _, av := range a {
					bc.iadd(av)
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for _, av := range a {
					ac.iadd(av)
				}

				// iaddRange and iRemoveRange : pick some distinct random endpoints
				a0 := rand.Intn(n)
				a1 := a0
				for a1 == a0 {
					a1 = rand.Intn(n)
				}
				if a0 > a1 {
					a0, a1 = a1, a0
				}

				r0 := rand.Intn(n)
				r1 := r0
				for r1 == r0 {
					r1 = rand.Intn(n)
				}
				if r0 > r1 {
					r0, r1 = r1, r0
				}

				// do the add
				for i := a0; i <= a1; i++ {
					ma[i] = true
				}
				// then the remove
				for i := r0; i <= r1; i++ {
					delete(ma, i)
				}

				rc.iaddRange(a0, a1+1)
				rc.iremoveRange(r0, r1+1)

				bc.iaddRange(a0, a1+1)
				bc.iremoveRange(r0, r1+1)

				ac.iaddRange(a0, a1+1)
				ac.iremoveRange(r0, r1+1)

				So(rc.getCardinality(), ShouldEqual, len(ma))
				So(rc.getCardinality(), ShouldEqual, ac.getCardinality())
				So(rc.getCardinality(), ShouldEqual, bc.getCardinality())

				rit := rc.getShortIterator()
				ait := ac.getShortIterator()
				bit := bc.getShortIterator()

				for ait.hasNext() {
					rn := rit.next()
					an := ait.next()
					bn := bit.next()
					So(rn, ShouldEqual, an)
					So(rn, ShouldEqual, bn)
				}
				// verify againt the map
				for k := range ma {
					So(rc.contains(uint16(k)), ShouldBeTrue)
				}

				// coverage for run16 method
				So(rc.serializedSizeInBytes(), ShouldEqual, 2+4*rc.numberOfRuns())
			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestAllContainerMethodsAllContainerTypes065(t *testing.T) {

	Convey("each of the container methods that takes two containers should handle all 3x3==9 possible ways of being called -- without panic", t, func() {
		a := newArrayContainer()
		r := newRunContainer16()
		b := newBitmapContainer()

		arr := []container{a, r, b}
		for _, i := range arr {
			for _, j := range arr {
				i.and(j)
				i.iand(j)
				i.andNot(j)

				i.iandNot(j)
				i.xor(j)
				i.equals(j)

				i.or(j)
				i.ior(j)
				i.intersects(j)

				i.lazyOR(j)
				i.lazyIOR(j)
			}
		}
	})

}

type twoCall func(r container) container

type twofer struct {
	name string
	call twoCall
	cn   container
}

func TestAllContainerMethodsAllContainerTypesWithData067(t *testing.T) {
	Convey("each of the container methods that takes two containers should handle all 3x3==9 possible ways of being called -- and return results that agree with each other", t, func() {

		//rleVerbose = true

		seed := int64(42)
		rand.Seed(seed)

		srang := newInterval16Range(MaxUint16-100, MaxUint16)
		trials := []trial{
			{n: 100, percentFill: .7, ntrial: 1, numRandomOpsPass: 100},
			{n: 100, percentFill: .7, ntrial: 1, numRandomOpsPass: 100, srang: &srang}}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {

				a, r, b := getRandomSameThreeContainers(tr)
				a2, r2, b2 := getRandomSameThreeContainers(tr)

				receiver := []container{a, r, b}
				arg := []container{a2, r2, b2}
				callme := []twofer{}

				nCalls := 0
				for k, c := range receiver {
					callme = append(callme, twofer{"and", c.and, c})
					callme = append(callme, twofer{"iand", c.iand, c})
					callme = append(callme, twofer{"ior", c.ior, c})
					callme = append(callme, twofer{"lazyOR", c.lazyOR, c})
					callme = append(callme, twofer{"lazyIOR", c.lazyIOR, c})
					callme = append(callme, twofer{"or", c.or, c})
					callme = append(callme, twofer{"xor", c.xor, c})
					callme = append(callme, twofer{"andNot", c.andNot, c})
					callme = append(callme, twofer{"iandNot", c.iandNot, c})
					if k == 0 {
						nCalls = len(callme)
					}
				}

				for pass := 0; pass < tr.numRandomOpsPass+1; pass++ {
					for k := 0; k < nCalls; k++ {
						perm := getRandomPermutation(nCalls)
						kk := perm[k]
						c1 := callme[kk]          // array receiver
						c2 := callme[kk+nCalls]   // run receiver
						c3 := callme[kk+2*nCalls] // bitmap receiver

						if c1.name != c2.name {
							panic("internal logic error")
						}
						if c3.name != c2.name {
							panic("internal logic error")
						}

						for k2, a := range arg {

							if !c1.cn.equals(c2.cn) {
								panic("c1 not equal to c2")
							}
							if !c1.cn.equals(c3.cn) {
								panic("c1 not equal to c3")
							}

							res1 := c1.call(a) // array
							res2 := c2.call(a) // run
							res3 := c3.call(a) // bitmap

							z := c1.name

							// In-place operation are best effort
							// User should not assume the receiver is modified, returned container has to be used
							if strings.HasPrefix(z, "i") {
								c1.cn = res1
								c2.cn = res2
								c3.cn = res3
							}

							if strings.HasPrefix(z, "lazy") {
								// on purpose, the lazy functions
								// do not scan to update their cardinality
								if asBc, isBc := res1.(*bitmapContainer); isBc {
									asBc.computeCardinality()
								}
								if asBc, isBc := res2.(*bitmapContainer); isBc {
									asBc.computeCardinality()
								}
								if asBc, isBc := res3.(*bitmapContainer); isBc {
									asBc.computeCardinality()
								}
							}

							// check for equality all ways...
							// excercising equals() calls too.

							if !res1.equals(res2) {
								panic(fmt.Sprintf("k:%v, k2:%v, res1 != res2,"+
									" call is '%s'", k, k2, c1.name))
							}
							if !res2.equals(res1) {
								panic(fmt.Sprintf("k:%v, k2:%v, res2 != res1,"+
									" call is '%s'", k, k2, c1.name))
							}
							if !res1.equals(res3) {
								panic(fmt.Sprintf("k:%v, k2:%v, res1 != res3,"+
									" call is '%s'", k, k2, c1.name))
							}
							if !res3.equals(res1) {
								panic(fmt.Sprintf("k:%v, k2:%v, res3 != res1,"+
									" call is '%s'", k, k2, c1.name))
							}
							if !res2.equals(res3) {
								panic(fmt.Sprintf("k:%v, k2:%v, res2 != res3,"+
									" call is '%s'", k, k2, c1.name))
							}
							if !res3.equals(res2) {
								panic(fmt.Sprintf("k:%v, k2:%v, res3 != res2,"+
									" call is '%s'", k, k2, c1.name))
							}
						}
					} // end k
				} // end pass

			} // end j
		} // end tester

		for i := range trials {
			tester(trials[i])
		}

	})

}

// generate random contents, then return that same
// logical content in three different container types
func getRandomSameThreeContainers(tr trial) (*arrayContainer, *runContainer16, *bitmapContainer) {

	ma := make(map[int]bool)

	n := tr.n
	a := []uint16{}

	var samp interval16
	if tr.srang != nil {
		samp = *tr.srang
	} else {
		if n-1 > MaxUint16 {
			panic(fmt.Errorf("n out of range: %v", n))
		}
		samp.start = 0
		samp.length = uint16(n - 2)
	}

	draw := int(float64(n) * tr.percentFill)
	for i := 0; i < draw; i++ {
		r0 := int(samp.start) + rand.Intn(int(samp.runlen()))
		a = append(a, uint16(r0))
		ma[r0] = true
	}

	rc := newRunContainer16FromVals(false, a...)

	// vs bitmapContainer
	bc := newBitmapContainerFromRun(rc)
	ac := rc.toArrayContainer()

	return ac, rc, bc
}
