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

func TestRleInterval32s(t *testing.T) {

	Convey("canMerge, and mergeInterval32s should do what they say", t, func() {
		a := interval32{start: 0, last: 9}
		msg := a.String()
		p("a is %v", msg)
		b := interval32{start: 0, last: 1}
		report := sliceToString32([]interval32{a, b})
		_ = report
		p("a and b together are: %s", report)
		c := interval32{start: 2, last: 4}
		d := interval32{start: 2, last: 5}
		e := interval32{start: 0, last: 4}
		f := interval32{start: 9, last: 9}
		g := interval32{start: 8, last: 9}
		h := interval32{start: 5, last: 6}
		i := interval32{start: 6, last: 6}

		aIb, empty := intersectInterval32s(a, b)
		So(empty, ShouldBeFalse)
		So(aIb, ShouldResemble, b)

		So(canMerge32(b, c), ShouldBeTrue)
		So(canMerge32(c, b), ShouldBeTrue)
		So(canMerge32(a, h), ShouldBeTrue)

		So(canMerge32(d, e), ShouldBeTrue)
		So(canMerge32(f, g), ShouldBeTrue)
		So(canMerge32(c, h), ShouldBeTrue)

		So(canMerge32(b, h), ShouldBeFalse)
		So(canMerge32(h, b), ShouldBeFalse)
		So(canMerge32(c, i), ShouldBeFalse)

		So(mergeInterval32s(b, c), ShouldResemble, e)
		So(mergeInterval32s(c, b), ShouldResemble, e)

		So(mergeInterval32s(h, i), ShouldResemble, h)
		So(mergeInterval32s(i, h), ShouldResemble, h)

		////// start
		So(mergeInterval32s(interval32{start: 0, last: 0}, interval32{start: 1, last: 1}), ShouldResemble, interval32{start: 0, last: 1})
		So(mergeInterval32s(interval32{start: 1, last: 1}, interval32{start: 0, last: 0}), ShouldResemble, interval32{start: 0, last: 1})
		So(mergeInterval32s(interval32{start: 0, last: 4}, interval32{start: 3, last: 5}), ShouldResemble, interval32{start: 0, last: 5})
		So(mergeInterval32s(interval32{start: 0, last: 4}, interval32{start: 3, last: 4}), ShouldResemble, interval32{start: 0, last: 4})

		So(mergeInterval32s(interval32{start: 0, last: 8}, interval32{start: 1, last: 7}), ShouldResemble, interval32{start: 0, last: 8})
		So(mergeInterval32s(interval32{start: 1, last: 7}, interval32{start: 0, last: 8}), ShouldResemble, interval32{start: 0, last: 8})

		So(func() { _ = mergeInterval32s(interval32{start: 0, last: 0}, interval32{start: 2, last: 3}) }, ShouldPanic)

	})
}

func TestRleRunIterator32(t *testing.T) {

	Convey("RunIterator32 unit tests for Cur, Next, HasNext, and Remove should pass", t, func() {
		{
			rc := newRunContainer32()
			msg := rc.String()
			_ = msg
			p("an empty container: '%s'\n", msg)
			So(rc.cardinality(), ShouldEqual, 0)
			it := rc.newRunIterator32()
			So(it.hasNext(), ShouldBeFalse)
		}
		{
			rc := newRunContainer32TakeOwnership([]interval32{{start: 4, last: 4}})
			So(rc.cardinality(), ShouldEqual, 1)
			it := rc.newRunIterator32()
			So(it.hasNext(), ShouldBeTrue)
			So(it.next(), ShouldResemble, uint32(4))
			So(it.cur(), ShouldResemble, uint32(4))
		}
		{
			rc := newRunContainer32CopyIv([]interval32{{start: 4, last: 9}})
			So(rc.cardinality(), ShouldEqual, 6)
			it := rc.newRunIterator32()
			So(it.hasNext(), ShouldBeTrue)
			for i := 4; i < 10; i++ {
				So(it.next(), ShouldEqual, uint32(i))
			}
			So(it.hasNext(), ShouldBeFalse)
		}

		{
			rc := newRunContainer32TakeOwnership([]interval32{{start: 4, last: 9}})
			card := rc.cardinality()
			So(card, ShouldEqual, 6)
			//So(rc.serializedSizeInBytes(), ShouldEqual, 2+4*rc.numberOfRuns())

			it := rc.newRunIterator32()
			So(it.hasNext(), ShouldBeTrue)
			for i := 4; i < 6; i++ {
				So(it.next(), ShouldEqual, uint32(i))
			}
			So(it.cur(), ShouldEqual, uint32(5))

			p("before Remove of 5, rc = '%s'", rc)

			So(it.remove(), ShouldEqual, uint32(5))

			p("after Remove of 5, rc = '%s'", rc)
			So(rc.cardinality(), ShouldEqual, 5)

			it2 := rc.newRunIterator32()
			So(rc.cardinality(), ShouldEqual, 5)
			So(it2.next(), ShouldEqual, uint32(4))
			for i := 6; i < 10; i++ {
				So(it2.next(), ShouldEqual, uint32(i))
			}
		}
		{
			rc := newRunContainer32TakeOwnership([]interval32{
				{start: 0, last: 0},
				{start: 2, last: 2},
				{start: 4, last: 4},
			})
			rc1 := newRunContainer32TakeOwnership([]interval32{
				{start: 6, last: 7},
				{start: 10, last: 11},
				{start: MaxUint32, last: MaxUint32},
			})

			rc = rc.union(rc1)

			So(rc.cardinality(), ShouldEqual, 8)
			it := rc.newRunIterator32()
			So(it.next(), ShouldEqual, uint32(0))
			So(it.next(), ShouldEqual, uint32(2))
			So(it.next(), ShouldEqual, uint32(4))
			So(it.next(), ShouldEqual, uint32(6))
			So(it.next(), ShouldEqual, uint32(7))
			So(it.next(), ShouldEqual, uint32(10))
			So(it.next(), ShouldEqual, uint32(11))
			So(it.next(), ShouldEqual, uint32(MaxUint32))
			So(it.hasNext(), ShouldEqual, false)

			rc2 := newRunContainer32TakeOwnership([]interval32{
				{start: 0, last: MaxUint32},
			})

			p("union with a full [0,2^32-1] container should yield that same single interval run container")
			rc2 = rc2.union(rc)
			So(rc2.numIntervals(), ShouldEqual, 1)
		}
	})
}

func TestRleRunSearch32(t *testing.T) {

	Convey("RunContainer32.search should respect the prior bounds we provide for efficiency of searching through a subset of the intervals", t, func() {
		{
			vals := []uint32{0, 2, 4, 6, 8, 10, 12, 14, 16, 18, MaxUint32 - 3, MaxUint32}
			exAt := []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11} // expected at
			absent := []uint32{1, 3, 5, 7, 9, 11, 13, 15, 17, 19, MaxUint32 - 2}

			rc := newRunContainer32FromVals(true, vals...)

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

			// delete the MaxUint32 so we can test
			// the behavior when searching near upper limit.

			p("before removing MaxUint32: %v", rc)

			So(rc.cardinality(), ShouldEqual, 12)
			So(rc.numIntervals(), ShouldEqual, 12)

			rc.removeKey(MaxUint32)
			p("after removing MaxUint32: %v", rc)
			So(rc.cardinality(), ShouldEqual, 11)
			So(rc.numIntervals(), ShouldEqual, 11)

			p("search for absent MaxUint32 should return the interval before our key")
			where, present, _ = rc.search(MaxUint32, nil)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)

			var numCompares int
			where, present, numCompares = rc.search(MaxUint32, nil)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)
			p("numCompares = %v", numCompares)
			So(numCompares, ShouldEqual, 3)

			p("confirm that opts searchOptions to search reduces search time")
			opts := &searchOptions{
				startIndex: 5,
			}
			where, present, numCompares = rc.search(MaxUint32, opts)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 10)
			p("numCompares = %v", numCompares)
			So(numCompares, ShouldEqual, 2)

			p("confirm that opts searchOptions to search is respected")
			where, present, _ = rc.search(MaxUint32-3, opts)
			So(present, ShouldBeTrue)
			So(where, ShouldEqual, 10)

			// with the bound in place, MaxUint32-3 should not be found
			opts.endxIndex = 10
			where, present, _ = rc.search(MaxUint32-3, opts)
			So(present, ShouldBeFalse)
			So(where, ShouldEqual, 9)

		}
	})

}

func TestRleIntersection32(t *testing.T) {

	Convey("RunContainer32.intersect of two RunContainer32(s) should return their intersection", t, func() {
		{
			vals := []uint32{0, 2, 4, 6, 8, 10, 12, 14, 16, 18, MaxUint32 - 3, MaxUint32 - 1}

			a := newRunContainer32FromVals(true, vals[:5]...)
			b := newRunContainer32FromVals(true, vals[2:]...)

			p("a is %v", a)
			p("b is %v", b)

			So(haveOverlap32(interval32{0, 2}, interval32{2, 2}), ShouldBeTrue)
			So(haveOverlap32(interval32{0, 2}, interval32{3, 3}), ShouldBeFalse)

			isect := a.intersect(b)

			p("isect is %v", isect)

			So(isect.cardinality(), ShouldEqual, 3)
			So(isect.contains(4), ShouldBeTrue)
			So(isect.contains(6), ShouldBeTrue)
			So(isect.contains(8), ShouldBeTrue)

			d := newRunContainer32TakeOwnership([]interval32{{start: 0, last: MaxUint32}})

			isect = isect.intersect(d)
			p("isect is %v", isect)
			So(isect.cardinality(), ShouldEqual, 3)
			So(isect.contains(4), ShouldBeTrue)
			So(isect.contains(6), ShouldBeTrue)
			So(isect.contains(8), ShouldBeTrue)

			p("test breaking apart intervals")
			e := newRunContainer32TakeOwnership([]interval32{{2, 4}, {8, 9}, {14, 16}, {20, 22}})
			f := newRunContainer32TakeOwnership([]interval32{{3, 18}, {22, 23}})

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

func TestRleRandomIntersection32(t *testing.T) {

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
				a := []uint32{}
				b := []uint32{}

				var first, second int

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint32(r0))
					ma[r0] = true
					if i == 0 {
						first = r0
						second = r0 + 1
						p("i is 0, so appending also to a the r0+1 == %v value", second)
						a = append(a, uint32(second))
						ma[second] = true
					}

					r1 := rand.Intn(n)
					b = append(b, uint32(r1))
					mb[r1] = true
				}

				// print a; very likely it has dups
				sort.Sort(uint32Slice(a))
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
				brle := newRunContainer32FromVals(false, b...)

				//arle := newRunContainer32FromVals(false, a...)
				// instead of the above line, create from array
				// get better test coverage:
				arr := newArrayContainerRange(int(first), int(second))
				arle := newRunContainer32FromArray(arr)
				p("after newRunContainer32FromArray(arr), arle is %v", arle)
				arle.set(false, a...)
				p("after set(false, a), arle is %v", arle)

				isect := arle.intersect(brle)

				p("isect is %v", isect)

				//showHash("hashi", hashi)

				for k := range hashi {
					p("hashi has %v, checking in isect", k)
					So(isect.contains(uint32(k)), ShouldBeTrue)
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

func TestRleRandomUnion32(t *testing.T) {

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
				a := []uint32{}
				b := []uint32{}

				draw := int(float64(n) * tr.percentFill)
				numDel := int(float64(n) * tr.percentDelete)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					a = append(a, uint32(r0))
					ma[r0] = true

					r1 := rand.Intn(n)
					b = append(b, uint32(r1))
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
				arle := newRunContainer32()
				for i := range a {
					arle.Add(a[i])
				}
				brle := newRunContainer32()
				brle.set(false, b...)

				union := arle.union(brle)

				p("union is %v", union)

				p("union.cardinality(): %v, versus len(hashu): %v", union.cardinality(), len(hashu))

				un := union.AsSlice()
				sort.Sort(uint32Slice(un))

				for kk, v := range un {
					p("kk:%v, RunContainer.union has %v, checking hashmap: %v", kk, v, hashu[int(v)])
					_ = kk
					So(hashu[int(v)], ShouldBeTrue)
				}

				for k := range hashu {
					p("hashu has %v, checking in union", k)
					So(union.contains(uint32(k)), ShouldBeTrue)
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
					So(union.contains(uint32(k)), ShouldBeTrue)
				}

			}
			p("done with randomized Union() checks for trial %#v", tr)
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestRleAndOrXor32(t *testing.T) {

	Convey("RunContainer And, Or, Xor tests", t, func() {
		{
			rc := newRunContainer32TakeOwnership([]interval32{
				{start: 0, last: 0},
				{start: 2, last: 2},
				{start: 4, last: 4},
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
			empty := newRunContainer32FromArray(arr)
			onceler := newArrayContainerCapacity(1)
			onceler.content = append(onceler.content, uint16(0))
			oneZero := newRunContainer32FromArray(onceler)
			So(empty.cardinality(), ShouldEqual, 0)
			So(oneZero.cardinality(), ShouldEqual, 1)
			So(empty.And(b0).GetCardinality(), ShouldEqual, 0)
			So(empty.Or(b0).GetCardinality(), ShouldEqual, 3)

			// exercise newRunContainer32FromVals() with 0 and 1 inputs.
			empty2 := newRunContainer32FromVals(false, []uint32{}...)
			So(empty2.cardinality(), ShouldEqual, 0)
			one2 := newRunContainer32FromVals(false, []uint32{1}...)
			So(one2.cardinality(), ShouldEqual, 1)
		}
	})
}

func TestRlePanics32(t *testing.T) {

	Convey("Some RunContainer calls/methods should panic if misused", t, func() {

		// newRunContainer32FromVals
		So(func() { newRunContainer32FromVals(true, 1, 0) }, ShouldPanic)

		arr := newArrayContainerRange(1, 3)
		arr.content = []uint16{2, 3, 3, 2, 1}
		So(func() { newRunContainer32FromArray(arr) }, ShouldPanic)
	})
}

func TestRleCoverageOddsAndEnds32(t *testing.T) {

	Convey("Some RunContainer code paths that don't otherwise get coverage -- these should be tested to increase percentage of code coverage in testing", t, func() {

		// p() code path
		cur := rleVerbose
		rleVerbose = true
		p("")
		rleVerbose = cur

		// RunContainer.String()
		rc := &runContainer32{}
		So(rc.String(), ShouldEqual, "runContainer32{}")
		rc.iv = make([]interval32, 1)
		rc.iv[0] = interval32{start: 3, last: 4}
		So(rc.String(), ShouldEqual, "runContainer32{0:[3, 4], }")

		a := interval32{start: 5, last: 9}
		b := interval32{start: 0, last: 1}
		c := interval32{start: 1, last: 2}

		// intersectInterval32s(a, b interval32)
		isect, isEmpty := intersectInterval32s(a, b)
		So(isEmpty, ShouldBeTrue)
		// [0,0] can't be trusted: So(isect.runlen(), ShouldEqual, 0)
		isect, isEmpty = intersectInterval32s(b, c)
		So(isEmpty, ShouldBeFalse)
		So(isect.runlen(), ShouldEqual, 1)

		// runContainer32.union
		{
			ra := newRunContainer32FromVals(false, 4, 5)
			rb := newRunContainer32FromVals(false, 4, 6, 8, 9, 10)
			ra.union(rb)
			So(rb.indexOfIntervalAtOrAfter(4, 2), ShouldEqual, 2)
			So(rb.indexOfIntervalAtOrAfter(3, 2), ShouldEqual, 2)
		}

		// runContainer.intersect
		{
			ra := newRunContainer32()
			rb := newRunContainer32()
			So(ra.intersect(rb).cardinality(), ShouldEqual, 0)
		}
		{
			ra := newRunContainer32FromVals(false, 1)
			rb := newRunContainer32FromVals(false, 4)
			So(ra.intersect(rb).cardinality(), ShouldEqual, 0)
		}

		// runContainer.Add
		{
			ra := newRunContainer32FromVals(false, 1)
			rb := newRunContainer32FromVals(false, 4)
			So(ra.cardinality(), ShouldEqual, 1)
			So(rb.cardinality(), ShouldEqual, 1)
			ra.Add(5)
			So(ra.cardinality(), ShouldEqual, 2)

			// newRunIterator32()
			empty := newRunContainer32()
			it := empty.newRunIterator32()
			So(func() { it.next() }, ShouldPanic)
			it2 := ra.newRunIterator32()
			it2.curIndex = int64(len(it2.rc.iv))
			So(func() { it2.next() }, ShouldPanic)

			// runIterator32.remove()
			emptyIt := empty.newRunIterator32()
			So(func() { emptyIt.remove() }, ShouldPanic)

			// newRunContainer32FromArray
			arr := newArrayContainerRange(1, 6)
			arr.content = []uint16{5, 5, 5, 6, 9}
			rc3 := newRunContainer32FromArray(arr)
			So(rc3.cardinality(), ShouldEqual, 3)

			// runContainer32SerializedSizeInBytes
			// runContainer32.SerializedSizeInBytes
			_ = runContainer32SerializedSizeInBytes(3)
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
			it3 := rc3.newRunIterator32()
			it3.next()
			it3.next()
			it3.next()
			it3.next()
			So(it3.cur(), ShouldEqual, uint32(10))
			it3.remove()
			So(it3.next(), ShouldEqual, uint32(12))
		}

		// runContainer32.equals
		{
			rc32 := newRunContainer32()
			So(rc32.equals32(rc32), ShouldBeTrue)
			rc32b := newRunContainer32()
			So(rc32.equals32(rc32b), ShouldBeTrue)
			rc32.Add(1)
			rc32b.Add(2)
			So(rc32.equals32(rc32b), ShouldBeFalse)
		}
	})
}

func TestRleStoringMax32(t *testing.T) {

	Convey("Storing the MaxUint32 should be possible, because it may be necessary to do so--users will assume that any valid uint32 should be storable. In particular the smaller 16-bit version will definitely expect full access to all bits.", t, func() {

		rc := newRunContainer32()
		rc.Add(MaxUint32)
		So(rc.contains(MaxUint32), ShouldBeTrue)
		So(rc.cardinality(), ShouldEqual, 1)
		rc.removeKey(MaxUint32)
		So(rc.contains(MaxUint32), ShouldBeFalse)
		So(rc.cardinality(), ShouldEqual, 0)

		rc.set(false, MaxUint32-1, MaxUint32)
		So(rc.cardinality(), ShouldEqual, 2)

		So(rc.contains(MaxUint32-1), ShouldBeTrue)
		So(rc.contains(MaxUint32), ShouldBeTrue)
		rc.removeKey(MaxUint32 - 1)
		So(rc.cardinality(), ShouldEqual, 1)
		rc.removeKey(MaxUint32)
		So(rc.cardinality(), ShouldEqual, 0)

		rc.set(false, MaxUint32-2, MaxUint32-1, MaxUint32)
		So(rc.cardinality(), ShouldEqual, 3)
		So(rc.numIntervals(), ShouldEqual, 1)
		rc.removeKey(MaxUint32 - 1)
		So(rc.numIntervals(), ShouldEqual, 2)
		So(rc.cardinality(), ShouldEqual, 2)

	})
}

// go test -bench BenchmarkFromBitmap -run -
func BenchmarkFromBitmap32(b *testing.B) {
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
