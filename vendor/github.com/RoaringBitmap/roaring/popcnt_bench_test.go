package roaring

import "testing"

func BenchmarkPopcount(b *testing.B) {
	b.StopTimer()

	r := getRandomUint64Set(64)

	b.ResetTimer()
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		popcntSlice(r)
	}
}
