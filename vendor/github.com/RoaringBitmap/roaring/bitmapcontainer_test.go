package roaring

import (
	. "github.com/smartystreets/goconvey/convey"
	"math/rand"
	"testing"
)

func TestBitmapContainerNumberOfRuns024(t *testing.T) {

	Convey("bitmapContainer's numberOfRuns() function should be correct against the runContainer equivalent",
		t, func() {
			seed := int64(42)
			rand.Seed(seed)

			trials := []trial{
				{n: 1000, percentFill: .1, ntrial: 10},
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

					// RunContainer compute this automatically
					rc := newRunContainer16FromVals(false, a...)
					rcNr := rc.numberOfRuns()

					// vs bitmapContainer
					bc := newBitmapContainer()
					for k := range ma {
						bc.iadd(uint16(k))
					}

					bcNr := bc.numberOfRuns()
					So(bcNr, ShouldEqual, rcNr)
					//fmt.Printf("\nnum runs was: %v\n", rcNr)
				}
			}

			for i := range trials {
				tester(trials[i])
			}

		})
}

func TestBitmapcontainerAndCardinality(t *testing.T) {
	Convey("bitmap containers get cardinality in range, miss the last index, issue #183", t, func() {
		for r := 0; r <= 65535; r++ {
			c1 := newRunContainer16Range(0, uint16(r))
			c2 := newBitmapContainerwithRange(0, int(r))
			So(r+1, ShouldEqual, c1.andCardinality(c2))
		}
	})
}

func TestIssue181(t *testing.T) {

	Convey("Initial issue 181", t, func() {
		a := New()
		var x uint32

		// adding 1M integers
		for i := 1; i <= 1000000; i++ {
			x += uint32(rand.Intn(10) + 1)
			a.Add(x)
		}
		b := New()
		for i := 1; i <= int(x); i++ {
			b.Add(uint32(i))
		}
		So(b.AndCardinality(a), ShouldEqual, a.AndCardinality(b))
		So(b.AndCardinality(a), ShouldEqual, And(a, b).GetCardinality())
	})
	Convey("Second version of issue 181", t, func() {
		a := New()
		var x uint32

		// adding 1M integers
		for i := 1; i <= 1000000; i++ {
			x += uint32(rand.Intn(10) + 1)
			a.Add(x)
		}
		b := New()
		b.AddRange(1, uint64(x))

		So(b.AndCardinality(a), ShouldEqual, a.AndCardinality(b))
		So(b.AndCardinality(a), ShouldEqual, And(a, b).GetCardinality())

	})
}

func TestBitmapContainerReverseIterator(t *testing.T) {

	Convey("RunReverseIterator16 unit tests for cur, next, hasNext, and remove should pass", t, func() {
		{
			bc := newBitmapContainer()
			it := bc.getReverseIterator()
			So(it.hasNext(), ShouldBeFalse)
			So(func() { it.next() }, ShouldPanic)
		}
		{
			bc := newBitmapContainerwithRange(0, 0)
			it := bc.getReverseIterator()
			So(it.hasNext(), ShouldBeTrue)
			So(it.next(), ShouldResemble, uint16(0))
		}
		{
			bc := newBitmapContainerwithRange(4, 4)
			it := bc.getReverseIterator()
			So(it.hasNext(), ShouldBeTrue)
			So(it.next(), ShouldResemble, uint16(4))
		}
		{
			bc := newBitmapContainerwithRange(4, 9)
			it := bc.getReverseIterator()
			So(it.hasNext(), ShouldBeTrue)
			for i := 9; i >= 4; i-- {
				v := it.next()
				So(v, ShouldEqual, uint16(i))
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
			values := []uint16{0, 2, 15, 16, 31, 32, 33, 9999, MaxUint16}
			bc := newBitmapContainer()
			for n := 0; n < len(values); n++ {
				bc.iadd(values[n])
			}
			i := bc.getReverseIterator()
			n := len(values) - 1
			for i.hasNext() {
				v := i.next()
				if values[n] != v {
					t.Errorf("expected %d got %d", values[n], v)
				}
				n--
			}
		}

	})
}

func TestBitmapOffset(t *testing.T) {
	nums := []uint16{10, 100, 1000}
	expected := make([]int, len(nums))
	offtest := uint16(65000)
	v := container(newBitmapContainer())
	for i, n := range nums {
		v.iadd(n)
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
