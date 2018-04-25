package roaring

// to run just these tests: go test -run TestFastAggregations*

import (
	"container/heap"
	. "github.com/smartystreets/goconvey/convey"
	"testing"
)

func TestFastAggregationsSize(t *testing.T) {
	Convey("Fast", t, func() {
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
		pq := make(priorityQueue, 3)
		pq[0] = &item{rb1, 0}
		pq[1] = &item{rb2, 1}
		pq[2] = &item{rb3, 2}
		heap.Init(&pq)
		So(heap.Pop(&pq).(*item).value.GetSizeInBytes(), ShouldEqual, rb3.GetSizeInBytes())
		So(heap.Pop(&pq).(*item).value.GetSizeInBytes(), ShouldEqual, rb2.GetSizeInBytes())
		So(heap.Pop(&pq).(*item).value.GetSizeInBytes(), ShouldEqual, rb1.GetSizeInBytes())
	})
}

func TestFastAggregationsCont(t *testing.T) {
	Convey("Fast", t, func() {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()
		for i := uint32(0); i < 10; i += 3 {
			rb1.Add(i)
		}
		for i := uint32(0); i < 10; i += 7 {
			rb2.Add(i)
		}
		for i := uint32(0); i < 10; i += 1001 {
			rb3.Add(i)
		}
		for i := uint32(1000000); i < 1000000+10; i += 1001 {
			rb1.Add(i)
		}
		for i := uint32(1000000); i < 1000000+10; i += 7 {
			rb2.Add(i)
		}
		for i := uint32(1000000); i < 1000000+10; i += 3 {
			rb3.Add(i)
		}
		rb1.Add(500000)
		pq := make(containerPriorityQueue, 3)
		pq[0] = &containeritem{rb1, 0, 0}
		pq[1] = &containeritem{rb2, 0, 1}
		pq[2] = &containeritem{rb3, 0, 2}
		heap.Init(&pq)
		expected := []int{6, 4, 5, 6, 5, 4, 6}
		counter := 0
		for pq.Len() > 0 {
			x1 := heap.Pop(&pq).(*containeritem)
			So(x1.value.GetCardinality(), ShouldEqual, expected[counter])
			counter++
			x1.keyindex++
			if x1.keyindex < x1.value.highlowcontainer.size() {
				heap.Push(&pq, x1)
			}
		}
	})
}

func TestFastAggregationsAdvanced_run(t *testing.T) {
	Convey("Fast", t, func() {
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
		So(FastOr(rb1, rb2, rb3).Equals(rb1), ShouldEqual, true)
		So(HeapOr(rb1, rb2, rb3).Equals(rb1), ShouldEqual, true)
		So(HeapOr(rb1, rb2, rb3).GetCardinality(), ShouldEqual, rb1.GetCardinality())
		So(HeapXor(rb1, rb2, rb3).Equals(bigxor), ShouldEqual, true)
		So(FastAnd(rb1, rb2, rb3).Equals(bigand), ShouldEqual, true)
	})
}

func TestFastAggregationsXOR(t *testing.T) {
	Convey("Fast", t, func() {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()

		for i := uint32(0); i < 40000; i++ {
			rb1.Add(i)
		}
		for i := uint32(0); i < 40000; i += 4000 {
			rb2.Add(i)
		}
		for i := uint32(0); i < 40000; i += 5000 {
			rb3.Add(i)
		}
		So(rb1.GetCardinality() == 40000, ShouldEqual, true)

		xor1 := Xor(rb1, rb2)
		xor1alt := Xor(rb2, rb1)
		So(xor1alt.Equals(xor1), ShouldEqual, true)
		So(HeapXor(rb1, rb2).Equals(xor1), ShouldEqual, true)

		xor2 := Xor(rb2, rb3)
		xor2alt := Xor(rb3, rb2)
		So(xor2alt.Equals(xor2), ShouldEqual, true)
		So(HeapXor(rb2, rb3).Equals(xor2), ShouldEqual, true)

		bigxor := Xor(Xor(rb1, rb2), rb3)
		bigxoralt1 := Xor(rb1, Xor(rb2, rb3))
		bigxoralt2 := Xor(rb1, Xor(rb3, rb2))
		bigxoralt3 := Xor(rb3, Xor(rb1, rb2))
		bigxoralt4 := Xor(Xor(rb1, rb2), rb3)

		So(bigxoralt2.Equals(bigxor), ShouldEqual, true)
		So(bigxoralt1.Equals(bigxor), ShouldEqual, true)
		So(bigxoralt3.Equals(bigxor), ShouldEqual, true)
		So(bigxoralt4.Equals(bigxor), ShouldEqual, true)

		So(HeapXor(rb1, rb2, rb3).Equals(bigxor), ShouldEqual, true)
	})
}

func TestFastAggregationsXOR_run(t *testing.T) {
	Convey("Fast", t, func() {
		rb1 := NewBitmap()
		rb2 := NewBitmap()
		rb3 := NewBitmap()

		for i := uint32(0); i < 40000; i++ {
			rb1.Add(i)
		}
		rb1.RunOptimize()
		for i := uint32(0); i < 40000; i += 4000 {
			rb2.Add(i)
		}
		for i := uint32(0); i < 40000; i += 5000 {
			rb3.Add(i)
		}
		So(rb1.GetCardinality() == 40000, ShouldEqual, true)

		xor1 := Xor(rb1, rb2)
		xor1alt := Xor(rb2, rb1)
		So(xor1alt.Equals(xor1), ShouldEqual, true)
		So(HeapXor(rb1, rb2).Equals(xor1), ShouldEqual, true)

		xor2 := Xor(rb2, rb3)
		xor2alt := Xor(rb3, rb2)
		So(xor2alt.Equals(xor2), ShouldEqual, true)
		So(HeapXor(rb2, rb3).Equals(xor2), ShouldEqual, true)

		bigxor := Xor(Xor(rb1, rb2), rb3)
		bigxoralt1 := Xor(rb1, Xor(rb2, rb3))
		bigxoralt2 := Xor(rb1, Xor(rb3, rb2))
		bigxoralt3 := Xor(rb3, Xor(rb1, rb2))
		bigxoralt4 := Xor(Xor(rb1, rb2), rb3)

		So(bigxoralt2.Equals(bigxor), ShouldEqual, true)
		So(bigxoralt1.Equals(bigxor), ShouldEqual, true)
		So(bigxoralt3.Equals(bigxor), ShouldEqual, true)
		So(bigxoralt4.Equals(bigxor), ShouldEqual, true)

		So(HeapXor(rb1, rb2, rb3).Equals(bigxor), ShouldEqual, true)
	})
}
