package msgp

import (
	"bytes"
	"fmt"
	"log"
	"math"
	"reflect"
	"testing"
	"time"
)

func TestReadMapHeaderBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := []uint32{0, 1, 5, 49082}

	for i, v := range tests {
		buf.Reset()
		en.WriteMapHeader(v)
		en.Flush()

		out, left, err := ReadMapHeaderBytes(buf.Bytes())
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}

		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}

		if out != v {
			t.Errorf("%d in; %d out", v, out)
		}
	}
}

func BenchmarkReadMapHeaderBytes(b *testing.B) {
	sizes := []uint32{1, 100, tuint16, tuint32}
	buf := make([]byte, 0, 5*len(sizes))
	for _, sz := range sizes {
		buf = AppendMapHeader(buf, sz)
	}
	b.SetBytes(int64(len(buf) / len(sizes)))
	b.ReportAllocs()
	b.ResetTimer()
	o := buf
	for i := 0; i < b.N; i++ {
		_, buf, _ = ReadMapHeaderBytes(buf)
		if len(buf) == 0 {
			buf = o
		}
	}
}

func TestReadArrayHeaderBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := []uint32{0, 1, 5, 49082}

	for i, v := range tests {
		buf.Reset()
		en.WriteArrayHeader(v)
		en.Flush()

		out, left, err := ReadArrayHeaderBytes(buf.Bytes())
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}

		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}

		if out != v {
			t.Errorf("%d in; %d out", v, out)
		}
	}
}

func BenchmarkReadArrayHeaderBytes(b *testing.B) {
	sizes := []uint32{1, 100, tuint16, tuint32}
	buf := make([]byte, 0, 5*len(sizes))
	for _, sz := range sizes {
		buf = AppendArrayHeader(buf, sz)
	}
	b.SetBytes(int64(len(buf) / len(sizes)))
	b.ReportAllocs()
	b.ResetTimer()
	o := buf
	for i := 0; i < b.N; i++ {
		_, buf, _ = ReadArrayHeaderBytes(buf)
		if len(buf) == 0 {
			buf = o
		}
	}
}

func TestReadNilBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)
	en.WriteNil()
	en.Flush()

	left, err := ReadNilBytes(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("expected 0 bytes left; found %d", len(left))
	}
}

func BenchmarkReadNilByte(b *testing.B) {
	buf := []byte{mnil}
	b.SetBytes(1)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ReadNilBytes(buf)
	}
}

func TestReadFloat64Bytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)
	en.WriteFloat64(3.14159)
	en.Flush()

	out, left, err := ReadFloat64Bytes(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("expected 0 bytes left; found %d", len(left))
	}
	if out != 3.14159 {
		t.Errorf("%f in; %f out", 3.14159, out)
	}
}

func BenchmarkReadFloat64Bytes(b *testing.B) {
	f := float64(3.14159)
	buf := make([]byte, 0, 9)
	buf = AppendFloat64(buf, f)
	b.SetBytes(int64(len(buf)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ReadFloat64Bytes(buf)
	}
}

func TestReadFloat32Bytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)
	en.WriteFloat32(3.1)
	en.Flush()

	out, left, err := ReadFloat32Bytes(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("expected 0 bytes left; found %d", len(left))
	}
	if out != 3.1 {
		t.Errorf("%f in; %f out", 3.1, out)
	}
}

func BenchmarkReadFloat32Bytes(b *testing.B) {
	f := float32(3.14159)
	buf := make([]byte, 0, 5)
	buf = AppendFloat32(buf, f)
	b.SetBytes(int64(len(buf)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ReadFloat32Bytes(buf)
	}
}

func TestReadBoolBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := []bool{true, false}

	for i, v := range tests {
		buf.Reset()
		en.WriteBool(v)
		en.Flush()
		out, left, err := ReadBoolBytes(buf.Bytes())

		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}

		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}

		if out != v {
			t.Errorf("%t in; %t out", v, out)
		}
	}
}

func BenchmarkReadBoolBytes(b *testing.B) {
	buf := []byte{mtrue, mfalse, mtrue, mfalse}
	b.SetBytes(1)
	b.ReportAllocs()
	b.ResetTimer()
	o := buf
	for i := 0; i < b.N; i++ {
		_, buf, _ = ReadBoolBytes(buf)
		if len(buf) == 0 {
			buf = o
		}
	}
}

func TestReadInt64Bytes(t *testing.T) {
	var buf bytes.Buffer
	wr := NewWriter(&buf)

	ints := []int64{-100000, -5000, -5, 0, 8, 240, int64(tuint16), int64(tuint32), int64(tuint64),
		-5, -30, 0, 1, 127, 300, 40921, 34908219}

	uints := []uint64{0, 8, 240, uint64(tuint16), uint64(tuint32), uint64(tuint64)}

	all := make([]interface{}, 0, len(ints)+len(uints))
	for _, v := range ints {
		all = append(all, v)
	}
	for _, v := range uints {
		all = append(all, v)
	}

	for i, num := range all {
		buf.Reset()
		var err error

		var in int64
		switch num := num.(type) {
		case int64:
			err = wr.WriteInt64(num)
			in = num
		case uint64:
			err = wr.WriteUint64(num)
			in = int64(num)
		default:
			panic(num)
		}
		if err != nil {
			t.Fatal(err)
		}
		err = wr.Flush()
		if err != nil {
			t.Fatal(err)
		}

		out, left, err := ReadInt64Bytes(buf.Bytes())
		if out != in {
			t.Errorf("Test case %d: put %d in and got %d out", i, num, in)
		}
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
	}
}

func TestReadUint64Bytes(t *testing.T) {
	var buf bytes.Buffer
	wr := NewWriter(&buf)

	vs := []interface{}{
		int64(0), int64(8), int64(240), int64(tuint16), int64(tuint32), int64(tuint64),
		uint64(0), uint64(8), uint64(240), uint64(tuint16), uint64(tuint32), uint64(tuint64),
		uint64(math.MaxUint64),
	}

	for i, num := range vs {
		buf.Reset()
		var err error

		var in uint64
		switch num := num.(type) {
		case int64:
			err = wr.WriteInt64(num)
			in = uint64(num)
		case uint64:
			err = wr.WriteUint64(num)
			in = (num)
		default:
			panic(num)
		}
		if err != nil {
			t.Fatal(err)
		}
		err = wr.Flush()
		if err != nil {
			t.Fatal(err)
		}

		out, left, err := ReadUint64Bytes(buf.Bytes())
		if out != in {
			t.Errorf("Test case %d: put %d in and got %d out", i, num, in)
		}
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
	}
}

func TestReadIntBytesOverflows(t *testing.T) {
	var buf bytes.Buffer
	wr := NewWriter(&buf)

	i8, i16, i32, i64, u8, u16, u32, u64 := 1, 2, 3, 4, 5, 6, 7, 8

	overflowErr := func(err error, failBits int) bool {
		bits := 0
		switch err := err.(type) {
		case IntOverflow:
			bits = err.FailedBitsize
		case UintOverflow:
			bits = err.FailedBitsize
		}
		if bits == failBits {
			return true
		}
		log.Println("bits mismatch", bits, failBits)
		return false
	}

	belowZeroErr := func(err error, failBits int) bool {
		switch err.(type) {
		case UintBelowZero:
			return true
		}
		return false
	}

	vs := []struct {
		v        interface{}
		rdBits   int
		failBits int
		errCheck func(err error, failBits int) bool
	}{
		{uint64(math.MaxInt64), i32, 32, overflowErr},
		{uint64(math.MaxInt64), i16, 16, overflowErr},
		{uint64(math.MaxInt64), i8, 8, overflowErr},

		{uint64(math.MaxUint64), i64, 64, overflowErr},
		{uint64(math.MaxUint64), i32, 64, overflowErr},
		{uint64(math.MaxUint64), i16, 64, overflowErr},
		{uint64(math.MaxUint64), i8, 64, overflowErr},

		{uint64(math.MaxUint32), i32, 32, overflowErr},
		{uint64(math.MaxUint32), i16, 16, overflowErr},
		{uint64(math.MaxUint32), i8, 8, overflowErr},

		{int64(math.MinInt64), u64, 64, belowZeroErr},
		{int64(math.MinInt64), u32, 64, belowZeroErr},
		{int64(math.MinInt64), u16, 64, belowZeroErr},
		{int64(math.MinInt64), u8, 64, belowZeroErr},
		{int64(math.MinInt32), u64, 64, belowZeroErr},
		{int64(math.MinInt32), u32, 32, belowZeroErr},
		{int64(math.MinInt32), u16, 16, belowZeroErr},
		{int64(math.MinInt32), u8, 8, belowZeroErr},
		{int64(math.MinInt16), u64, 64, belowZeroErr},
		{int64(math.MinInt16), u32, 32, belowZeroErr},
		{int64(math.MinInt16), u16, 16, belowZeroErr},
		{int64(math.MinInt16), u8, 8, belowZeroErr},
		{int64(math.MinInt8), u64, 64, belowZeroErr},
		{int64(math.MinInt8), u32, 32, belowZeroErr},
		{int64(math.MinInt8), u16, 16, belowZeroErr},
		{int64(math.MinInt8), u8, 8, belowZeroErr},
		{-1, u64, 64, belowZeroErr},
		{-1, u32, 32, belowZeroErr},
		{-1, u16, 16, belowZeroErr},
		{-1, u8, 8, belowZeroErr},
	}

	for i, v := range vs {
		t.Run(fmt.Sprintf("%d", i), func(t *testing.T) {
			buf.Reset()
			switch num := v.v.(type) {
			case int:
				wr.WriteInt64(int64(num))
			case int64:
				wr.WriteInt64(num)
			case uint64:
				wr.WriteUint64(num)
			default:
				panic(num)
			}
			wr.Flush()

			var err error
			switch v.rdBits {
			case i64:
				_, _, err = ReadInt64Bytes(buf.Bytes())
			case i32:
				_, _, err = ReadInt32Bytes(buf.Bytes())
			case i16:
				_, _, err = ReadInt16Bytes(buf.Bytes())
			case i8:
				_, _, err = ReadInt8Bytes(buf.Bytes())
			case u64:
				_, _, err = ReadUint64Bytes(buf.Bytes())
			case u32:
				_, _, err = ReadUint32Bytes(buf.Bytes())
			case u16:
				_, _, err = ReadUint16Bytes(buf.Bytes())
			case u8:
				_, _, err = ReadUint8Bytes(buf.Bytes())
			}
			if !v.errCheck(err, v.failBits) {
				t.Fatal(err)
			}
		})
	}
}

func TestReadBytesBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := [][]byte{[]byte{}, []byte("some bytes"), []byte("some more bytes")}
	var scratch []byte

	for i, v := range tests {
		buf.Reset()
		en.WriteBytes(v)
		en.Flush()
		out, left, err := ReadBytesBytes(buf.Bytes(), scratch)
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
		if !bytes.Equal(out, v) {
			t.Errorf("%q in; %q out", v, out)
		}
	}
}

func TestReadZCBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := [][]byte{[]byte{}, []byte("some bytes"), []byte("some more bytes")}

	for i, v := range tests {
		buf.Reset()
		en.WriteBytes(v)
		en.Flush()
		out, left, err := ReadBytesZC(buf.Bytes())
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
		if !bytes.Equal(out, v) {
			t.Errorf("%q in; %q out", v, out)
		}
	}
}

func TestReadZCString(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := []string{"", "hello", "here's another string......"}

	for i, v := range tests {
		buf.Reset()
		en.WriteString(v)
		en.Flush()

		out, left, err := ReadStringZC(buf.Bytes())
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
		if string(out) != v {
			t.Errorf("%q in; %q out", v, out)
		}
	}
}

func TestReadStringBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := []string{"", "hello", "here's another string......"}

	for i, v := range tests {
		buf.Reset()
		en.WriteString(v)
		en.Flush()

		out, left, err := ReadStringBytes(buf.Bytes())
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
		if out != v {
			t.Errorf("%q in; %q out", v, out)
		}
	}
}

func TestReadComplex128Bytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := []complex128{complex(0, 0), complex(12.8, 32.0)}

	for i, v := range tests {
		buf.Reset()
		en.WriteComplex128(v)
		en.Flush()

		out, left, err := ReadComplex128Bytes(buf.Bytes())
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
		if out != v {
			t.Errorf("%f in; %f out", v, out)
		}
	}
}

func TestReadComplex64Bytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := []complex64{complex(0, 0), complex(12.8, 32.0)}

	for i, v := range tests {
		buf.Reset()
		en.WriteComplex64(v)
		en.Flush()

		out, left, err := ReadComplex64Bytes(buf.Bytes())
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
		if out != v {
			t.Errorf("%f in; %f out", v, out)
		}
	}
}

func TestReadTimeBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	now := time.Now()
	en.WriteTime(now)
	en.Flush()
	out, left, err := ReadTimeBytes(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}

	if len(left) != 0 {
		t.Errorf("expected 0 bytes left; found %d", len(left))
	}
	if !now.Equal(out) {
		t.Errorf("%s in; %s out", now, out)
	}
}

func BenchmarkReadTimeBytes(b *testing.B) {
	data := AppendTime(nil, time.Now())
	b.SetBytes(15)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ReadTimeBytes(data)
	}
}

func TestReadIntfBytes(t *testing.T) {
	var buf bytes.Buffer
	en := NewWriter(&buf)

	tests := make([]interface{}, 0, 10)
	tests = append(tests, float64(3.5))
	tests = append(tests, int64(-49082))
	tests = append(tests, uint64(34908))
	tests = append(tests, string("hello!"))
	tests = append(tests, []byte("blah."))
	tests = append(tests, map[string]interface{}{
		"key_one": 3.5,
		"key_two": "hi.",
	})

	for i, v := range tests {
		buf.Reset()
		if err := en.WriteIntf(v); err != nil {
			t.Fatal(err)
		}
		en.Flush()

		out, left, err := ReadIntfBytes(buf.Bytes())
		if err != nil {
			t.Errorf("test case %d: %s", i, err)
		}
		if len(left) != 0 {
			t.Errorf("expected 0 bytes left; found %d", len(left))
		}
		if !reflect.DeepEqual(v, out) {
			t.Errorf("ReadIntf(): %v in; %v out", v, out)
		}
	}

}

func BenchmarkSkipBytes(b *testing.B) {
	var buf bytes.Buffer
	en := NewWriter(&buf)
	en.WriteMapHeader(6)

	en.WriteString("thing_one")
	en.WriteString("value_one")

	en.WriteString("thing_two")
	en.WriteFloat64(3.14159)

	en.WriteString("some_bytes")
	en.WriteBytes([]byte("nkl4321rqw908vxzpojnlk2314rqew098-s09123rdscasd"))

	en.WriteString("the_time")
	en.WriteTime(time.Now())

	en.WriteString("what?")
	en.WriteBool(true)

	en.WriteString("ext")
	en.WriteExtension(&RawExtension{Type: 55, Data: []byte("raw data!!!")})
	en.Flush()

	bts := buf.Bytes()
	b.SetBytes(int64(len(bts)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := Skip(bts)
		if err != nil {
			b.Fatal(err)
		}
	}
}
