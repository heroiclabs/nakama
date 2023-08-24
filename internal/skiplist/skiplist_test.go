package skiplist

import (
	"fmt"
	"math/rand"
	"sort"
	"testing"
)

type Int int

func (i Int) Less(other interface{}) bool {
	return i < other.(Int)
}

func TestInt(t *testing.T) {
	sl := New()
	if sl.Len() != 0 || sl.Front() != nil {
		t.Fatal()
	}

	testData := []Int{Int(1), Int(2), Int(3)}

	sl.Insert(testData[0])
	if sl.Len() != 1 || sl.Front().Value.(Int) != testData[0] {
		t.Fatal()
	}

	sl.Insert(testData[2])
	if sl.Len() != 2 || sl.Front().Value.(Int) != testData[0] {
		t.Fatal()
	}

	sl.Insert(testData[1])
	if sl.Len() != 3 || sl.Front().Value.(Int) != testData[0] {
		t.Fatal()
	}

	sl.Insert(Int(-999))
	sl.Insert(Int(-888))
	sl.Insert(Int(888))
	sl.Insert(Int(999))
	sl.Insert(Int(1000))

	expect := []Int{Int(-999), Int(-888), Int(1), Int(2), Int(3), Int(888), Int(999), Int(1000)}
	ret := make([]Int, 0)

	for e := sl.Front(); e != nil; e = e.Next() {
		ret = append(ret, e.Value.(Int))
	}
	for i := 0; i < len(ret); i++ {
		if ret[i] != expect[i] {
			t.Fatal()
		}
	}

	e := sl.Find(Int(2))
	if e == nil || e.Value.(Int) != 2 {
		t.Fatal()
	}

	ret = make([]Int, 0)
	for ; e != nil; e = e.Next() {
		ret = append(ret, e.Value.(Int))
	}
	for i := 0; i < len(ret); i++ {
		if ret[i] != expect[i+3] {
			t.Fatal()
		}
	}

	sl.Remove(sl.Find(Int(2)))
	sl.Delete(Int(888))
	sl.Delete(Int(1000))

	if sl.Front().Value.(Int) != -999 {
		t.Fatal()
	}

	sl.Remove(sl.Front())
	if sl.Front().Value.(Int) != -888 {
		t.Fatal()
	}

	if e = sl.Insert(Int(2)); e.Value.(Int) != 2 {
		t.Fatal()
	}
	sl.Delete(Int(-888))

	if r := sl.Delete(Int(123)); r != nil {
		t.Fatal()
	}

	if sl.Len() != 4 {
		t.Fatal()
	}

	sl.Insert(Int(2))
	sl.Insert(Int(2))
	sl.Insert(Int(1))

	if e = sl.Find(Int(2)); e == nil {
		t.Fatal()
	}

	expect = []Int{Int(2), Int(2), Int(2), Int(3), Int(999)}
	ret = make([]Int, 0)
	for ; e != nil; e = e.Next() {
		ret = append(ret, e.Value.(Int))
	}
	for i := 0; i < len(ret); i++ {
		if ret[i] != expect[i] {
			t.Fatal()
		}
	}

	sl2 := sl.Init()
	if sl.Len() != 0 || sl.Front() != nil ||
		sl2.Len() != 0 || sl2.Front() != nil {
		t.Fatal()
	}

	// for i := 0; i < 100; i++ {
	// 	sl.Insert(Int(rand.Intn(200)))
	// }
	// output(sl)
}

func TestRank(t *testing.T) {
	sl := New()

	for i := 1; i <= 10; i++ {
		sl.Insert(Int(i))
	}

	for i := 1; i <= 10; i++ {
		if sl.GetRank(Int(i)) != i {
			t.Fatal()
		}
	}

	for i := 1; i <= 10; i++ {
		if sl.GetElementByRank(i).Value != Int(i) {
			t.Fatal()
		}
	}

	if sl.GetRank(Int(0)) != 0 || sl.GetRank(Int(11)) != 0 {
		t.Fatal()
	}

	if sl.GetElementByRank(11) != nil || sl.GetElementByRank(12) != nil {
		t.Fatal()
	}

	expect := []Int{Int(7), Int(8), Int(9), Int(10)}
	for e, i := sl.GetElementByRank(7), 0; e != nil; e, i = e.Next(), i+1 {
		if e.Value != expect[i] {
			t.Fatal()
		}
	}

	sl = sl.Init()
	mark := make(map[int]bool)
	ss := make([]int, 0)

	for i := 1; i <= 100000; i++ {
		x := rand.Int()
		if !mark[x] {
			mark[x] = true
			sl.Insert(Int(x))
			ss = append(ss, x)
		}
	}
	sort.Ints(ss)

	for i := 0; i < len(ss); i++ {
		if sl.GetElementByRank(i+1).Value != Int(ss[i]) || sl.GetRank(Int(ss[i])) != i+1 {
			t.Fatal()
		}
	}

	// output(sl)
}

func BenchmarkIntInsertOrder(b *testing.B) {
	b.StopTimer()
	sl := New()
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		sl.Insert(Int(i))
	}
}

func BenchmarkIntInsertRandom(b *testing.B) {
	b.StopTimer()
	sl := New()
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		sl.Insert(Int(rand.Int()))
	}
}

func BenchmarkIntDeleteOrder(b *testing.B) {
	b.StopTimer()
	sl := New()
	for i := 0; i < 1000000; i++ {
		sl.Insert(Int(i))
	}
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		sl.Delete(Int(i))
	}
}

func BenchmarkIntDeleteRandome(b *testing.B) {
	b.StopTimer()
	sl := New()
	for i := 0; i < 1000000; i++ {
		sl.Insert(Int(rand.Int()))
	}
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		sl.Delete(Int(rand.Int()))
	}
}

func BenchmarkIntFindOrder(b *testing.B) {
	b.StopTimer()
	sl := New()
	for i := 0; i < 1000000; i++ {
		sl.Insert(Int(i))
	}
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		sl.Find(Int(i))
	}
}

func BenchmarkIntFindRandom(b *testing.B) {
	b.StopTimer()
	sl := New()
	for i := 0; i < 1000000; i++ {
		sl.Insert(Int(rand.Int()))
	}
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		sl.Find(Int(rand.Int()))
	}
}

func BenchmarkIntRankOrder(b *testing.B) {
	b.StopTimer()
	sl := New()
	for i := 0; i < 1000000; i++ {
		sl.Insert(Int(i))
	}
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		sl.GetRank(Int(i))
	}
}

func BenchmarkIntRankRandom(b *testing.B) {
	b.StopTimer()
	sl := New()
	for i := 0; i < 1000000; i++ {
		sl.Insert(Int(rand.Int()))
	}
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		sl.GetRank(Int(rand.Int()))
	}
}

// nolint:unused
func output(sl *SkipList) {
	var x *Element
	for i := 0; i < SKIPLIST_MAXLEVEL; i++ {
		fmt.Printf("LEVEL[%v]: ", i)
		count := 0
		x = sl.header.level[i].forward
		for x != nil {
			// fmt.Printf("%v -> ", x.Value)
			count++
			x = x.level[i].forward
		}
		// fmt.Println("NIL")
		fmt.Println("count==", count)
	}
}
