package roaring

import (
	"bytes"
	"fmt"
	"math/rand"
	"runtime"
	"testing"

	"github.com/willf/bitset"
)

// BENCHMARKS, to run them type "go test -bench Benchmark -run -"

// go test -bench BenchmarkOrs -benchmem -run -
func BenchmarkOrs(b *testing.B) {

	bms := []*Bitmap{}
	maxCount := 50
	domain := 100000000
	bitmapCount := 100
	for i := 0; i < bitmapCount; i++ {
		newBm := NewBitmap()
		count := rand.Intn(maxCount) + 5
		for j := 0; j < count; j++ {
			v := uint32(rand.Intn(domain))
			newBm.Add(v)
		}
		bms = append(bms, newBm)
	}
	var twotwocard uint64
	var fastcard uint64
	var nextcard uint64

	b.Run("two-by-two", func(b *testing.B) {
		for n := 0; n < b.N; n++ {
			newBm := NewBitmap()
			for _, bm := range bms {
				newBm.Or(bm)
			}
			twotwocard = newBm.GetCardinality()
		}
		b.StopTimer()
	})

	b.Run("fast", func(b *testing.B) {
		for n := 0; n < b.N; n++ {
			newBm := FastOr(bms...)
			fastcard = newBm.GetCardinality()
		}
		b.StopTimer()
	})

	b.Run("next/add", func(b *testing.B) {
		buf := make([]uint32, 100)
		for n := 0; n < b.N; n++ {
			newBm := NewBitmap()
			for _, bm := range bms {
				iter := bm.ManyIterator()
				for vs := iter.NextMany(buf); vs != 0; vs = iter.NextMany(buf) {
					newBm.AddMany(buf[:vs])
				}
			}
			nextcard = newBm.GetCardinality()
		}
		b.StopTimer()
	})
	if fastcard != nextcard {
		b.Fatalf("Cardinalities don't match: %d, %d", fastcard, nextcard)
	}
	if fastcard != twotwocard {
		b.Fatalf("Cardinalities don't match: %d, %d", fastcard, twotwocard)
	}
}

var Rb *Bitmap

func BenchmarkNewBitmap(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		Rb = New()
	}
}

var emptyArray []byte

func BenchmarkEmptyArray(b *testing.B) {
	for i := 0; i < b.N; i++ {
		emptyArray = make([]byte, 0)
	}
}

var c9 uint

// go test -bench BenchmarkMemoryUsage -run -
func BenchmarkMemoryUsage(b *testing.B) {
	b.StopTimer()
	bitmaps := make([]*Bitmap, 0, 10)

	incr := uint32(1 << 16)
	max := uint32(1<<32 - 1)
	for x := 0; x < 10; x++ {
		rb := NewBitmap()

		var i uint32
		for i = 0; i <= max-incr; i += incr {
			rb.Add(i)
		}

		bitmaps = append(bitmaps, rb)
	}

	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	b.Logf("HeapInUse: %d, HeapObjects: %d", stats.HeapInuse, stats.HeapObjects)
	b.StartTimer()
}

// go test -bench BenchmarkIntersection -run -
func BenchmarkIntersectionBitset(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s1 := bitset.New(0)
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s1.Set(uint(r.Int31n(int32(sz))))
	}
	s2 := bitset.New(0)
	sz = 100000000
	initsize = 65000
	for i := 0; i < initsize; i++ {
		s2.Set(uint(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	card := uint(0)
	for j := 0; j < b.N; j++ {
		s3 := s1.Intersection(s2)
		card = card + s3.Count()
	}
}

// go test -bench BenchmarkIntersection -run -
func BenchmarkIntersectionRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s1 := NewBitmap()
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s1.Add(uint32(r.Int31n(int32(sz))))
	}
	s2 := NewBitmap()
	sz = 100000000
	initsize = 65000
	for i := 0; i < initsize; i++ {
		s2.Add(uint32(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	card := uint64(0)
	for j := 0; j < b.N; j++ {
		s3 := And(s1, s2)
		card = card + s3.GetCardinality()
	}
}

// go test -bench BenchmarkIntersectionCardinalityRoaring -run -
func BenchmarkIntersectionCardinalityRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s1 := NewBitmap()
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s1.Add(uint32(r.Int31n(int32(sz))))
	}
	s2 := NewBitmap()
	sz = 100000000
	initsize = 65000
	for i := 0; i < initsize; i++ {
		s2.Add(uint32(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	card := uint64(0)
	for j := 0; j < b.N; j++ {
		card += s1.AndCardinality(s2)
	}
}

// go test -bench BenchmarkUnion -run -
func BenchmarkUnionBitset(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s1 := bitset.New(0)
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s1.Set(uint(r.Int31n(int32(sz))))
	}
	s2 := bitset.New(0)
	sz = 100000000
	initsize = 65000
	for i := 0; i < initsize; i++ {
		s2.Set(uint(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	card := uint(0)
	for j := 0; j < b.N; j++ {
		s3 := s1.Union(s2)
		card = card + s3.Count()
	}
}

// go test -bench BenchmarkUnion -run -
func BenchmarkUnionRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s1 := NewBitmap()
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s1.Add(uint32(r.Int31n(int32(sz))))
	}
	s2 := NewBitmap()
	sz = 100000000
	initsize = 65000
	for i := 0; i < initsize; i++ {
		s2.Add(uint32(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	card := uint64(0)
	for j := 0; j < b.N; j++ {
		s3 := Or(s1, s2)
		card = card + s3.GetCardinality()
	}
}

// go test -bench BenchmarkSize -run -
func BenchmarkSizeBitset(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s1 := bitset.New(0)
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s1.Set(uint(r.Int31n(int32(sz))))
	}
	s2 := bitset.New(0)
	sz = 100000000
	initsize = 65000
	for i := 0; i < initsize; i++ {
		s2.Set(uint(r.Int31n(int32(sz))))
	}
	fmt.Printf("%.1f MB ", float32(s1.BinaryStorageSize()+s2.BinaryStorageSize())/(1024.0*1024))

}

// go test -bench BenchmarkSize -run -
func BenchmarkSizeRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s1 := NewBitmap()
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s1.Add(uint32(r.Int31n(int32(sz))))
	}
	s2 := NewBitmap()
	sz = 100000000
	initsize = 65000
	for i := 0; i < initsize; i++ {
		s2.Add(uint32(r.Int31n(int32(sz))))
	}
	fmt.Printf("%.1f MB ", float32(s1.GetSerializedSizeInBytes()+s2.GetSerializedSizeInBytes())/(1024.0*1024))

}

// go test -bench BenchmarkSet -run -
func BenchmarkSetRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	sz := 1000000
	s := NewBitmap()
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
}

func BenchmarkSetBitset(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	sz := 1000000
	s := bitset.New(0)
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		s.Set(uint(r.Int31n(int32(sz))))
	}
}

// go test -bench BenchmarkGetTest -run -
func BenchmarkGetTestRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	sz := 1000000
	initsize := 50000
	s := NewBitmap()
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		s.Contains(uint32(r.Int31n(int32(sz))))
	}
}

func BenchmarkGetTestBitSet(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	sz := 1000000
	initsize := 50000
	s := bitset.New(0)
	for i := 0; i < initsize; i++ {
		s.Set(uint(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		s.Test(uint(r.Int31n(int32(sz))))
	}
}

// go test -bench BenchmarkCount -run -
func BenchmarkCountRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 1000000
	initsize := 50000
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		s.GetCardinality()
	}
}

func BenchmarkCountBitset(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := bitset.New(0)
	sz := 1000000
	initsize := 50000
	for i := 0; i < initsize; i++ {

		s.Set(uint(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		s.Count()
	}
}

// go test -bench BenchmarkIterate -run -
func BenchmarkIterateRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	for j := 0; j < b.N; j++ {
		c9 = uint(0)
		i := s.Iterator()
		for i.HasNext() {
			i.Next()
			c9++
		}
	}
}

// go test -bench BenchmarkSparseIterate -run -
func BenchmarkSparseIterateRoaring(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 100000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	for j := 0; j < b.N; j++ {
		c9 = uint(0)
		i := s.Iterator()
		for i.HasNext() {
			i.Next()
			c9++
		}
	}

}

// go test -bench BenchmarkIterate -run -
func BenchmarkIterateBitset(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := bitset.New(0)
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Set(uint(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	for j := 0; j < b.N; j++ {
		c9 = uint(0)
		for i, e := s.NextSet(0); e; i, e = s.NextSet(i + 1) {
			c9++
		}
	}
}

// go test -bench BenchmarkSparseContains -run -
func BenchmarkSparseContains(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 10000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	var a [1024]uint32
	for i := 0; i < 1024; i++ {
		a[i] = uint32(r.Int31n(int32(sz)))
	}
	b.StartTimer()
	for j := 0; j < b.N; j++ {
		c9 = uint(0)
		for i := 0; i < 1024; i++ {
			if s.Contains(a[i]) {
				c9++
			}

		}
	}
}

// go test -bench BenchmarkSparseIterate -run -
func BenchmarkSparseIterateBitset(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := bitset.New(0)
	sz := 100000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Set(uint(r.Int31n(int32(sz))))
	}
	b.StartTimer()
	for j := 0; j < b.N; j++ {
		c9 = uint(0)
		for i, e := s.NextSet(0); e; i, e = s.NextSet(i + 1) {
			c9++
		}
	}
}

func BenchmarkSerializationSparse(b *testing.B) {
	b.ReportAllocs()
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 100000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	buf := make([]byte, 0, s.GetSerializedSizeInBytes())
	b.StartTimer()

	for j := 0; j < b.N; j++ {
		w := bytes.NewBuffer(buf[:0])
		s.WriteTo(w)
	}
}

func BenchmarkSerializationMid(b *testing.B) {
	b.ReportAllocs()
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 10000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	buf := make([]byte, 0, s.GetSerializedSizeInBytes())
	b.StartTimer()

	for j := 0; j < b.N; j++ {
		w := bytes.NewBuffer(buf[:0])
		s.WriteTo(w)
	}
}

func BenchmarkSerializationDense(b *testing.B) {
	b.ReportAllocs()
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 150000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	buf := make([]byte, 0, s.GetSerializedSizeInBytes())
	b.StartTimer()

	for j := 0; j < b.N; j++ {
		w := bytes.NewBuffer(buf[:0])
		s.WriteTo(w)
	}
}

func BenchmarkEqualsSparse(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	t := NewBitmap()
	sz := 100000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		n := uint32(r.Int31n(int32(sz)))
		s.Add(n)
		t.Add(n)
	}
	b.StartTimer()

	for j := 0; j < b.N; j++ {
		s.Equals(t)
	}
}

func BenchmarkEqualsClone(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 100000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		s.Add(uint32(r.Int31n(int32(sz))))
	}
	t := s.Clone()
	b.StartTimer()

	for j := 0; j < b.N; j++ {
		s.Equals(t)
	}
}

// go test -bench BenchmarkNexts -benchmem -run -
func BenchmarkNexts(b *testing.B) {

	for _, gap := range []uint32{1, 2, 4, 8, 16, 32, 64, 256, 1024, 8096} {

		rrs := make([]uint32, 500000)
		v := uint32(0)
		for i := range rrs {
			rrs[i] = v
			v += gap
		}

		bm := NewBitmap()
		bm.AddMany(rrs)

		var totnext uint64
		var totnextmany uint64

		density := float32(100) / float32(gap)

		densityStr := fmt.Sprintf("__%f%%", density)

		b.Run("next"+densityStr, func(b *testing.B) {
			for n := 0; n < b.N; n++ {
				totnext = 0
				iter := bm.Iterator()
				for iter.HasNext() {
					v := iter.Next()
					totnext += uint64(v)
				}
			}
			b.StopTimer()
		})

		b.Run("nextmany"+densityStr, func(b *testing.B) {
			for n := 0; n < b.N; n++ {
				totnextmany = 0
				iter := bm.ManyIterator()
				// worst case, in practice will reuse buffers across many roars
				buf := make([]uint32, 4096)
				for j := iter.NextMany(buf); j != 0; j = iter.NextMany(buf) {
					for i := 0; i < j; i++ {
						totnextmany += uint64(buf[i])
					}
				}
			}
			b.StopTimer()
		})

		if totnext != totnextmany {
			b.Fatalf("Cardinalities don't match: %d, %d", totnext, totnextmany)
		}
	}
}

// go test -bench BenchmarkRLENexts -benchmem -run -
func BenchmarkNextsRLE(b *testing.B) {

	var totadd uint64
	var totaddmany uint64

	bm := NewBitmap()
	bm.AddRange(0, 1000000)

	b.Run("next", func(b *testing.B) {
		for n := 0; n < b.N; n++ {
			totadd = 0
			iter := bm.Iterator()
			for iter.HasNext() {
				v := iter.Next()
				totadd += uint64(v)
			}
		}
		b.StopTimer()
	})

	b.Run("nextmany", func(b *testing.B) {
		for n := 0; n < b.N; n++ {
			totaddmany = 0
			iter := bm.ManyIterator()
			// worst case, in practice will reuse buffers across many roars
			buf := make([]uint32, 2048)
			for j := iter.NextMany(buf); j != 0; j = iter.NextMany(buf) {
				for i := 0; i < j; i++ {
					totaddmany += uint64(buf[i])
				}
			}
		}
		b.StopTimer()
	})
	if totadd != totaddmany {
		b.Fatalf("Cardinalities don't match: %d, %d", totadd, totaddmany)
	}

}

func BenchmarkXor(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 100000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		n := uint32(r.Int31n(int32(sz)))
		s.Add(n)
	}
	x2 := NewBitmap()
	for i := 0; i < initsize; i++ {
		n := uint32(r.Int31n(int32(sz)))
		x2.Add(n)
	}
	b.StartTimer()

	for j := 0; j < b.N; j++ {
		s.Clone().Xor(x2)
	}
}

func BenchmarkXorLopsided(b *testing.B) {
	b.StopTimer()
	r := rand.New(rand.NewSource(0))
	s := NewBitmap()
	sz := 100000000
	initsize := 65000
	for i := 0; i < initsize; i++ {
		n := uint32(r.Int31n(int32(sz)))
		s.Add(n)
	}
	x2 := NewBitmap()
	for i := 0; i < 32; i++ {
		n := uint32(r.Int31n(int32(sz)))
		x2.Add(n)
	}
	b.StartTimer()

	for j := 0; j < b.N; j++ {
		s.Clone().Xor(x2)
	}
}

func BenchmarkBitmapReuseWithoutClear(b *testing.B) {
	for j := 0; j < b.N; j++ {
		s := NewBitmap()
		for i := 0; i < 100000; i++ {
			s.Add(uint32(i * 4096))
		}
	}
}

func BenchmarkBitmapReuseWithClear(b *testing.B) {
	s := NewBitmap()
	for i := 0; i < 100000; i++ {
		s.Add(uint32(i * 4096))
	}
	b.ResetTimer()

	for j := 0; j < b.N; j++ {
		s.Clear() // reuse the same bitmap
		for i := 0; i < 100000; i++ {
			s.Add(uint32(i * 4096))
		}
	}
}
