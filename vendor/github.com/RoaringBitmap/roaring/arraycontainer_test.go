package roaring

// to run just these tests: go test -run TestArrayContainer*

import (
	"math/rand"
	"reflect"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestArrayContainerTransition(t *testing.T) {
	v := container(newArrayContainer())
	arraytype := reflect.TypeOf(v)
	for i := 0; i < arrayDefaultMaxSize; i++ {
		v = v.iaddReturnMinimized(uint16(i))
	}
	if v.getCardinality() != arrayDefaultMaxSize {
		t.Errorf("Bad cardinality.")
	}
	if reflect.TypeOf(v) != arraytype {
		t.Errorf("Should be an array.")
	}
	for i := 0; i < arrayDefaultMaxSize; i++ {
		v = v.iaddReturnMinimized(uint16(i))
	}
	if v.getCardinality() != arrayDefaultMaxSize {
		t.Errorf("Bad cardinality.")
	}
	if reflect.TypeOf(v) != arraytype {
		t.Errorf("Should be an array.")
	}
	v = v.iaddReturnMinimized(uint16(arrayDefaultMaxSize))
	if v.getCardinality() != arrayDefaultMaxSize+1 {
		t.Errorf("Bad cardinality.")
	}
	if reflect.TypeOf(v) == arraytype {
		t.Errorf("Should be a bitmap.")
	}
	v = v.iremoveReturnMinimized(uint16(arrayDefaultMaxSize))
	if v.getCardinality() != arrayDefaultMaxSize {
		t.Errorf("Bad cardinality.")
	}
	if reflect.TypeOf(v) != arraytype {
		t.Errorf("Should be an array.")
	}
}

func TestArrayContainerRank(t *testing.T) {
	v := container(newArrayContainer())
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

func TestArrayOffset(t *testing.T) {
	nums := []uint16{10, 100, 1000}
	expected := make([]int, len(nums))
	offtest := uint16(65000)
	v := container(newArrayContainer())
	for i, n := range nums {
		v = v.iaddReturnMinimized(n)
		expected[i] = int(n) + int(offtest)
	}
	w := v.addOffset(offtest)
	w0card := w[0].getCardinality()
	w1card := w[1].getCardinality()
	if w0card+w1card != 3 {
		t.Errorf("Bogus cardinality.")
	}
	wout := make([]int, len(nums))
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

func TestArrayContainerMassiveSetAndGet(t *testing.T) {
	v := container(newArrayContainer())
	for j := 0; j <= arrayDefaultMaxSize; j++ {

		v = v.iaddReturnMinimized(uint16(j))
		if v.getCardinality() != 1+j {
			t.Errorf("Bogus cardinality %d %d. ", v.getCardinality(), j)
		}
		for i := 0; i <= arrayDefaultMaxSize; i++ {
			if i <= j {
				if v.contains(uint16(i)) != true {
					t.Errorf("I added a number in vain.")
				}
			} else {
				if v.contains(uint16(i)) != false {
					t.Errorf("Ghost content")
					break
				}
			}
		}
	}
}

type FakeContainer struct {
	arrayContainer
}

func TestArrayContainerUnsupportedType(t *testing.T) {
	a := container(newArrayContainer())
	testContainerPanics(t, a)
	b := container(newBitmapContainer())
	testContainerPanics(t, b)
}

func testContainerPanics(t *testing.T, c container) {
	f := &FakeContainer{}
	assertPanic(t, func() {
		c.or(f)
	})
	assertPanic(t, func() {
		c.ior(f)
	})
	assertPanic(t, func() {
		c.lazyIOR(f)
	})
	assertPanic(t, func() {
		c.lazyOR(f)
	})
	assertPanic(t, func() {
		c.and(f)
	})
	assertPanic(t, func() {
		c.intersects(f)
	})
	assertPanic(t, func() {
		c.iand(f)
	})
	assertPanic(t, func() {
		c.xor(f)
	})
	assertPanic(t, func() {
		c.andNot(f)
	})
	assertPanic(t, func() {
		c.iandNot(f)
	})
}

func assertPanic(t *testing.T, f func()) {
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("The code did not panic")
		}
	}()
	f()
}

func TestArrayContainerNumberOfRuns025(t *testing.T) {

	Convey("arrayContainer's numberOfRuns() function should be correct against the runContainer equivalent",
		t, func() {
			seed := int64(42)
			rand.Seed(seed)

			trials := []trial{
				{n: 1000, percentFill: .1, ntrial: 10},
				/*
					trial{n: 100, percentFill: .5, ntrial: 10},
					trial{n: 100, percentFill: .01, ntrial: 10},
					trial{n: 100, percentFill: .99, ntrial: 10},
				*/
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

					showArray16(a, "a")

					// RunContainer computes this automatically
					rc := newRunContainer16FromVals(false, a...)
					rcNr := rc.numberOfRuns()

					// vs arrayContainer
					ac := newArrayContainer()
					for k := range ma {
						ac.iadd(uint16(k))
					}

					acNr := ac.numberOfRuns()
					So(acNr, ShouldEqual, rcNr)

					// get coverage of arrayContainer coners...
					So(ac.serializedSizeInBytes(), ShouldEqual, 2*len(ma))

					So(func() { ac.iaddRange(2, 1) }, ShouldNotPanic)
					So(func() { ac.iremoveRange(2, 1) }, ShouldNotPanic)
					ac.iremoveRange(0, 2)
					ac.iremoveRange(0, 2)
					delete(ma, 0)
					delete(ma, 1)
					So(ac.getCardinality(), ShouldEqual, len(ma))
					ac.iadd(0)
					ac.iadd(1)
					ac.iadd(2)
					ma[0] = true
					ma[1] = true
					ma[2] = true
					newguy := ac.not(0, 3).(*arrayContainer)
					So(newguy.contains(0), ShouldBeFalse)
					So(newguy.contains(1), ShouldBeFalse)
					So(newguy.contains(2), ShouldBeFalse)
					newguy.notClose(0, 2)
					newguy.remove(2)
					newguy.remove(2)
					newguy.ior(ac)

					messedUp := newArrayContainer()
					So(messedUp.numberOfRuns(), ShouldEqual, 0)

					// messed up
					messedUp.content = []uint16{1, 1}
					So(func() { messedUp.numberOfRuns() }, ShouldPanic)
					messedUp.content = []uint16{2, 1}
					So(func() { messedUp.numberOfRuns() }, ShouldPanic)

					shouldBeBit := newArrayContainer()
					for i := 0; i < arrayDefaultMaxSize+1; i++ {
						shouldBeBit.iadd(uint16(i * 2))
					}
					bit := shouldBeBit.toEfficientContainer()
					_, isBit := bit.(*bitmapContainer)
					So(isBit, ShouldBeTrue)

					//fmt.Printf("\nnum runs was: %v\n", rcNr)
				}
			}

			for i := range trials {
				tester(trials[i])
			}

		})
}

func TestArrayContainerIaddRangeNearMax068(t *testing.T) {

	Convey("arrayContainer iaddRange should work near MaxUint16", t, func() {

		iv := []interval16{newInterval16Range(65525, 65527),
			newInterval16Range(65530, 65530),
			newInterval16Range(65534, 65535)}
		rc := newRunContainer16TakeOwnership(iv)

		ac2 := rc.toArrayContainer()
		So(ac2.equals(rc), ShouldBeTrue)
		So(rc.equals(ac2), ShouldBeTrue)

		ac := newArrayContainer()
		endx := int(MaxUint16) + 1
		first := endx - 3
		ac.iaddRange(first-20, endx-20)
		ac.iaddRange(first-6, endx-6)
		ac.iaddRange(first, endx)
		So(ac.getCardinality(), ShouldEqual, 9)

	})
}

func TestArrayContainerEtc070(t *testing.T) {

	Convey("arrayContainer rarely exercised code paths should get some coverage", t, func() {

		iv := []interval16{newInterval16Range(65525, 65527),
			newInterval16Range(65530, 65530),
			newInterval16Range(65534, 65535)}
		rc := newRunContainer16TakeOwnership(iv)
		ac := rc.toArrayContainer()

		// not when nothing to do just returns a clone
		So(ac.equals(ac.not(0, 0)), ShouldBeTrue)
		So(ac.equals(ac.notClose(1, 0)), ShouldBeTrue)

		// not will promote to bitmapContainer if card is big enough

		ac = newArrayContainer()
		ac.inot(0, MaxUint16+1)
		rc = newRunContainer16Range(0, MaxUint16)

		So(rc.equals(ac), ShouldBeTrue)

		// comparing two array containers with different card
		ac2 := newArrayContainer()
		So(ac2.equals(ac), ShouldBeFalse)

		// comparing two arrays with same card but different content
		ac3 := newArrayContainer()
		ac4 := newArrayContainer()
		ac3.iadd(1)
		ac3.iadd(2)
		ac4.iadd(1)
		So(ac3.equals(ac4), ShouldBeFalse)

		// compare array vs other with different card
		So(ac3.equals(rc), ShouldBeFalse)

		// compare array vs other, same card, different content
		rc = newRunContainer16Range(0, 0)
		So(ac4.equals(rc), ShouldBeFalse)

		// remove from middle of array
		ac5 := newArrayContainer()
		ac5.iaddRange(0, 10)
		So(ac5.getCardinality(), ShouldEqual, 10)
		ac6 := ac5.remove(5)
		So(ac6.getCardinality(), ShouldEqual, 9)

		// lazyorArray that converts to bitmap
		ac5.iaddRange(0, arrayLazyLowerBound-1)
		ac6.iaddRange(arrayLazyLowerBound, 2*arrayLazyLowerBound-2)
		ac6a := ac6.(*arrayContainer)
		bc := ac5.lazyorArray(ac6a)
		_, isBitmap := bc.(*bitmapContainer)
		So(isBitmap, ShouldBeTrue)

		// andBitmap
		ac = newArrayContainer()
		ac.iaddRange(0, 10)
		bc9 := newBitmapContainer()
		bc9.iaddRange(0, 5)
		and := ac.andBitmap(bc9)
		So(and.getCardinality(), ShouldEqual, 5)

		// numberOfRuns with 1 member
		ac10 := newArrayContainer()
		ac10.iadd(1)
		So(ac10.numberOfRuns(), ShouldEqual, 1)
	})
}

func TestArrayContainerIand(t *testing.T) {

	Convey("arrayContainer iand with full RLE container should work", t, func() {
		a := NewBitmap()
		a.AddRange(0, 200000)
		b := BitmapOf(50, 100000, 150000)

		b.And(a)

		r := b.ToArray()
		So(r, ShouldHaveLength, 3)
		So(r[0], ShouldEqual, 50)
		So(r[1], ShouldEqual, 100000)
		So(r[2], ShouldEqual, 150000)
	})
}
