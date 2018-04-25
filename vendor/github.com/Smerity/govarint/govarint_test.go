package govarint

import "bytes"
import "io"
import "math/rand"
import "testing"

var fourU32 = []uint32{
	0,
	1,
	0,
	256,
}

var fiveU32 = []uint32{
	42,
	4294967196,
	384,
	9716053,
	1024 + 256 + 3,
}

var testU32 = []uint32{
	0,
	1,
	2,
	10,
	20,
	63,
	64,
	65,
	127,
	128,
	129,
	255,
	256,
	257,
}

var testU64 = []uint64{
	0,
	1,
	2,
	10,
	20,
	63,
	64,
	65,
	127,
	128,
	129,
	255,
	256,
	257,
	///
	1<<32 - 1,
	1 << 32,
	1 << 33,
	1 << 42,
	1<<63 - 1,
	1 << 63,
}

func TestEncodeAndDecodeU32(t *testing.T) {
	for _, expected := range testU32 {
		var buf bytes.Buffer
		enc := NewU32Base128Encoder(&buf)
		enc.PutU32(expected)
		enc.Close()
		dec := NewU32Base128Decoder(&buf)
		x, err := dec.GetU32()
		if x != expected || err != nil {
			t.Errorf("ReadUvarint(%v): got x = %d, expected = %d, err = %s", buf, x, expected, err)
		}
	}
	var buf bytes.Buffer
	enc := NewU32Base128Encoder(&buf)
	for _, expected := range testU32 {
		enc.PutU32(expected)
	}
	enc.Close()
	dec := NewU32Base128Decoder(&buf)
	i := 0
	for {
		x, err := dec.GetU32()
		if err == io.EOF {
			break
		}
		if x != testU32[i] || err != nil {
			t.Errorf("ReadUvarint(%v): got x = %d, expected = %d, err = %s", buf, x, testU32[i], err)
		}
		i += 1
	}
	if i != len(testU32) {
		t.Errorf("Only %d integers were decoded when %d were encoded", i, len(testU32))
	}
}

func TestEncodeAndDecodeU64(t *testing.T) {
	for _, expected := range testU64 {
		var buf bytes.Buffer
		enc := NewU64Base128Encoder(&buf)
		enc.PutU64(expected)
		enc.Close()
		dec := NewU64Base128Decoder(&buf)
		x, err := dec.GetU64()
		if x != expected || err != nil {
			t.Errorf("ReadUvarint(%v): got x = %d, expected = %d, err = %s", buf, x, expected, err)
		}
	}
}

func TestU32GroupVarintFour(t *testing.T) {
	var buf bytes.Buffer
	enc := NewU32GroupVarintEncoder(&buf)
	for _, expected := range fourU32 {
		enc.PutU32(expected)
	}
	enc.Close()
	dec := NewU32GroupVarintDecoder(&buf)
	i := 0
	for {
		x, err := dec.GetU32()
		if err == io.EOF {
			break
		}
		if err != nil && x != fourU32[i] {
			t.Errorf("ReadUvarint(%v): got x = %d, expected = %d, err = %s", buf, x, testU32[i], err)
		}
		i += 1
	}
	if i != len(fourU32) {
		t.Errorf("%d integers were decoded when %d were encoded", i, len(fourU32))
	}
}

func TestU32GroupVarintFive(t *testing.T) {
	var buf bytes.Buffer
	enc := NewU32GroupVarintEncoder(&buf)
	for _, expected := range fiveU32 {
		enc.PutU32(expected)
	}
	enc.Close()
	dec := NewU32GroupVarintDecoder(&buf)
	i := 0
	for {
		x, err := dec.GetU32()
		if err == io.EOF {
			break
		}
		if err != nil && x != fiveU32[i] {
			t.Errorf("ReadUvarint(%v): got x = %d, expected = %d, err = %s", buf, x, testU32[i], err)
		}
		i += 1
	}
	if i != len(fiveU32) {
		t.Errorf("%d integers were decoded when %d were encoded", i, len(fiveU32))
	}
}

func TestU32GroupVarint14(t *testing.T) {
	var buf bytes.Buffer
	for length := 0; length < len(testU32); length++ {
		subset := testU32[:length]
		enc := NewU32GroupVarintEncoder(&buf)
		for _, expected := range subset {
			enc.PutU32(expected)
		}
		enc.Close()
		dec := NewU32GroupVarintDecoder(&buf)
		i := 0
		for {
			x, err := dec.GetU32()
			if err == io.EOF {
				break
			}
			if err != nil && x != subset[i] {
				t.Errorf("ReadUvarint(%v): got x = %d, expected = %d, err = %s", buf, x, subset[i], err)
			}
			i += 1
		}
		if i != len(subset) {
			t.Errorf("%d integers were decoded when %d were encoded", i, len(subset))
		}
	}
}

func generateRandomU14() (uint64, []uint32) {
	// Need to be aware to make it fair for Base128
	// Base128 has 7 usable bits per byte
	rand.Seed(42)
	testSize := 1000000
	data := make([]uint32, testSize, testSize)
	total := uint64(0)
	for i := range data {
		data[i] = rand.Uint32() % 16384
		total += uint64(data[i])
	}
	return total, data
}

func speedTest(b *testing.B, dec U32VarintDecoder, readBuf *bytes.Reader, expectedTotal uint64) {
	total := uint64(0)
	idx := 0
	for {
		x, err := dec.GetU32()
		if err == io.EOF {
			break
		}
		if err != nil {
			b.Errorf("Hit err: %v", err)
		}
		total += uint64(x)
		idx += 1
	}
	if total != expectedTotal {
		b.Errorf("Total was %d when %d was expected, having read %d integers", total, expectedTotal, idx)
	}
}

func BenchmarkBase128(b *testing.B) {
	b.StopTimer()
	//
	var buf bytes.Buffer
	enc := NewU32Base128Encoder(&buf)
	expectedTotal, data := generateRandomU14()
	for _, expected := range data {
		enc.PutU32(expected)
	}
	enc.Close()
	//
	readBuf := bytes.NewReader(buf.Bytes())
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		readBuf.Seek(0, 0)
		dec := NewU32Base128Decoder(readBuf)
		speedTest(b, dec, readBuf, expectedTotal)
	}
}

func BenchmarkGroupVarint(b *testing.B) {
	b.StopTimer()
	//
	var buf bytes.Buffer
	enc := NewU32GroupVarintEncoder(&buf)
	expectedTotal, data := generateRandomU14()
	for _, expected := range data {
		enc.PutU32(expected)
	}
	enc.Close()
	//
	readBuf := bytes.NewReader(buf.Bytes())
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		readBuf.Seek(0, 0)
		dec := NewU32GroupVarintDecoder(readBuf)
		speedTest(b, dec, readBuf, expectedTotal)
	}
}
