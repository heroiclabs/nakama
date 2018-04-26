package roaring

import (
	"fmt"
	"math/rand"
	"sort"
	"testing"
	//"unsafe"

	. "github.com/smartystreets/goconvey/convey"
)

func init() {
	rleVerbose = testing.Verbose()
}

func TestRleInterval16s(t *testing.T) {

	Convey("canMerge, and mergeInterval16s should do what they say", t, func() {
		a := newInterval16Range(0, 9)
		msg := a.String()
		p("a is %v", msg)
		b := newInterval16Range(0, 1)
		report := sliceToString16([]interval16{a, b})
		_ = report
		p("a and b together are: %s", report)
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

func TestRleRunIterator16(t *testing.T) {

	Convey("RunIterator16 unit tests for Cur, Next, HasNext, and Remove should pass", t, func() {
		{
			rc := newRunContainer16()
			msg := rc.String()
			_ = msg
			p("an empty container: '%s'\n", msg)
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

			buf := make([]uint32, 0)
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

			p("before Remove of 5, rc = '%s'", rc)

			So(it.remove(), ShouldEqual, uint16(5))

			p("after Remove of 5, rc = '%s'", rc)
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

			p("union with a full [0,2^16-1] container should yield that same single interval run container")
			rc2 = rc2.union(rc)
			So(rc2.numIntervals(), ShouldEqual, 1)
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

			p("before removing MaxUint16: %v", rc)

			So(rc.cardinality(), ShouldEqual, 12)
			So(rc.numIntervals(), ShouldEqual, 12)

			rc.removeKey(MaxUint16)
			p("after removing MaxUint16: %v", rc)
			So(rc.cardinality(), ShouldEqual, 11)
			So(rc.numIntervals(), ShouldEqual, 11)

			p("search for absent MaxUint16 should return the interval before our key")
			where, present, _ = rc.search(MaxUint16, nil)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)

			var numCompares int
			where, present, numCompares = rc.search(MaxUint16, nil)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)
			p("numCompares = %v", numCompares)
			So(numCompares, ShouldEqual, 3)

			p("confirm that opts searchOptions to search reduces search time")
			opts := &searchOptions{
				startIndex: 5,
			}
			where, present, numCompares = rc.search(MaxUint16, opts)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)
			p("numCompares = %v", numCompares)
			So(numCompares, ShouldEqual, 2)

			p("confirm that opts searchOptions to search is respected")
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

			p("a is %v", a)
			p("b is %v", b)

			So(haveOverlap16(newInterval16Range(0, 2), newInterval16Range(2, 2)), ShouldBeTrue)
			So(haveOverlap16(newInterval16Range(0, 2), newInterval16Range(3, 3)), ShouldBeFalse)

			isect := a.intersect(b)

			p("isect is %v", isect)

			So(isect.cardinality(), ShouldEqual, 3)
			So(isect.contains(4), ShouldBeTrue)
			So(isect.contains(6), ShouldBeTrue)
			So(isect.contains(8), ShouldBeTrue)

			newInterval16Range(0, MaxUint16)
			d := newRunContainer16TakeOwnership([]interval16{newInterval16Range(0, MaxUint16)})

			isect = isect.intersect(d)
			p("isect is %v", isect)
			So(isect.cardinality(), ShouldEqual, 3)
			So(isect.contains(4), ShouldBeTrue)
			So(isect.contains(6), ShouldBeTrue)
			So(isect.contains(8), ShouldBeTrue)

			p("test breaking apart intervals")
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

			p("e = %v", e)
			p("f = %v", f)

			{
				isect = e.intersect(f)
				p("isect of e and f is %v", isect)
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
				p("isect of f and e is %v", isect)
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
		p("seed is %v", seed)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .80, ntrial: 10},
			{n: 1000, percentFill: .20, ntrial: 20},
			{n: 10000, percentFill: .01, ntrial: 10},
			{n: 1000, percentFill: .99, ntrial: 10},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				p("TestRleRandomIntersection on check# j=%v", j)
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
						p("i is 0, so appending also to a the r0+1 == %v value", second)
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
				p("a is '%v'", stringA)

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
				p("after newRunContainer16FromArray(arr), arle is %v", arle)
				arle.set(false, a...)
				p("after set(false, a), arle is %v", arle)

				isect := arle.intersect(brle)

				p("isect is %v", isect)

				//showHash("hashi", hashi)

				for k := range hashi {
					p("hashi has %v, checking in isect", k)
					So(isect.contains(uint16(k)), ShouldBeTrue)
				}

				p("checking for cardinality agreement: isect is %v, len(hashi) is %v", isect.cardinality(), len(hashi))
				So(isect.cardinality(), ShouldEqual, len(hashi))
			}
			p("done with randomized intersect() checks for trial %#v", tr)
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRleRandomUnion16(t *testing.T) {

	Convey("RunContainer.union of two RunContainers should return their union, and this should hold over randomized container content when compared to union done with hash maps", t, func() {

		seed := int64(42)
		p("seed is %v", seed)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .80, ntrial: 10},
			{n: 1000, percentFill: .20, ntrial: 20},
			{n: 10000, percentFill: .01, ntrial: 10},
			{n: 1000, percentFill: .99, ntrial: 10, percentDelete: .04},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				p("TestRleRandomUnion on check# j=%v", j)
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

				p("union is %v", union)

				p("union.cardinality(): %v, versus len(hashu): %v", union.cardinality(), len(hashu))

				un := union.AsSlice()
				sort.Sort(uint16Slice(un))

				for kk, v := range un {
					p("kk:%v, RunContainer.union has %v, checking hashmap: %v", kk, v, hashu[int(v)])
					_ = kk
					So(hashu[int(v)], ShouldBeTrue)
				}

				for k := range hashu {
					p("hashu has %v, checking in union", k)
					So(union.contains(uint16(k)), ShouldBeTrue)
				}

				p("checking for cardinality agreement:")
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
					p("hashu has %v, checking in union", k)
					So(union.contains(uint16(k)), ShouldBeTrue)
				}

			}
			p("done with randomized Union() checks for trial %#v", tr)
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

		// p() code path
		cur := rleVerbose
		rleVerbose = true
		p("")
		rleVerbose = cur

		// RunContainer.String()
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
