package roaring

// to run just these tests: go test -run TestSerialization*

import (
	"bytes"
	"encoding/binary"
	"encoding/gob"
	"fmt"
	"io/ioutil"
	"math/rand"
	"os"
	"path/filepath"
	"runtime/debug"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestSerializationOfEmptyBitmap(t *testing.T) {
	rb := NewBitmap()

	buf := &bytes.Buffer{}
	_, err := rb.WriteTo(buf)
	if err != nil {
		t.Errorf("Failed writing")
	}
	if uint64(buf.Len()) != rb.GetSerializedSizeInBytes() {
		t.Errorf("Bad GetSerializedSizeInBytes")
	}
	newrb := NewBitmap()
	_, err = newrb.ReadFrom(buf)
	if err != nil {
		t.Errorf("Failed reading: %v", err)
	}
	if !rb.Equals(newrb) {
		t.Errorf("Cannot retrieve serialized version; rb != newrb")
	}
}

func TestBase64_036(t *testing.T) {
	rb := BitmapOf(1, 2, 3, 4, 5, 100, 1000)

	bstr, _ := rb.ToBase64()

	if bstr == "" {
		t.Errorf("ToBase64 failed returned empty string")
	}

	newrb := NewBitmap()

	_, err := newrb.FromBase64(bstr)

	if err != nil {
		t.Errorf("Failed reading from base64 string")
	}

	if !rb.Equals(newrb) {
		t.Errorf("comparing the base64 to and from failed cannot retrieve serialized version")
	}
}

func TestSerializationBasic037(t *testing.T) {

	rb := BitmapOf(1, 2, 3, 4, 5, 100, 1000)

	buf := &bytes.Buffer{}
	_, err := rb.WriteTo(buf)
	if err != nil {
		t.Errorf("Failed writing")
	}
	if uint64(buf.Len()) != rb.GetSerializedSizeInBytes() {
		t.Errorf("Bad GetSerializedSizeInBytes")
	}
	newrb := NewBitmap()
	_, err = newrb.ReadFrom(buf)
	if err != nil {
		t.Errorf("Failed reading")
	}
	if !rb.Equals(newrb) {
		t.Errorf("Cannot retrieve serialized version; rb != newrb")
	}
}

func TestSerializationToFile038(t *testing.T) {
	rb := BitmapOf(1, 2, 3, 4, 5, 100, 1000)
	fname := "myfile.bin"
	fout, err := os.OpenFile(fname, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0660)
	if err != nil {
		t.Errorf("Can't open a file for writing")
	}
	var l int64
	l, err = rb.WriteTo(fout)
	if err != nil {
		t.Errorf("Failed writing")
	}
	if uint64(l) != rb.GetSerializedSizeInBytes() {
		t.Errorf("Bad GetSerializedSizeInBytes")
	}
	fout.Close()

	newrb := NewBitmap()
	fin, err := os.Open(fname)

	if err != nil {
		t.Errorf("Failed reading")
	}
	defer func() {
		fin.Close()
		err := os.Remove(fname)
		if err != nil {
			t.Errorf("could not delete %s ", fname)
		}
	}()
	_, _ = newrb.ReadFrom(fin)
	if !rb.Equals(newrb) {
		t.Errorf("Cannot retrieve serialized version")
	}
}

func TestSerializationReadRunsFromFile039(t *testing.T) {
	fn := "testdata/bitmapwithruns.bin"

	by, err := ioutil.ReadFile(fn)
	if err != nil {
		panic(err)
	}

	newrb := NewBitmap()
	_, err = newrb.ReadFrom(bytes.NewBuffer(by))
	if err != nil {
		t.Errorf("Failed reading %s: %s", fn, err)
	}
}

func TestSerializationBasic4WriteAndReadFile040(t *testing.T) {

	fname := "testdata/all3.classic"

	rb := NewBitmap()
	for k := uint32(0); k < 100000; k += 1000 {
		rb.Add(k)
	}
	for k := uint32(100000); k < 200000; k++ {
		rb.Add(3 * k)
	}
	for k := uint32(700000); k < 800000; k++ {
		rb.Add(k)
	}
	rb.highlowcontainer.runOptimize()

	fout, err := os.Create(fname)
	if err != nil {
		t.Errorf("Failed creating '%s'", fname)
	}
	var l int64

	l, err = rb.WriteTo(fout)
	if err != nil {
		t.Errorf("Failed writing to '%s'", fname)
	}
	if uint64(l) != rb.GetSerializedSizeInBytes() {
		t.Errorf("Bad GetSerializedSizeInBytes")
	}
	fout.Close()

	fin, err := os.Open(fname)
	if err != nil {
		t.Errorf("Failed to Open '%s'", fname)
	}
	defer fin.Close()

	newrb := NewBitmap()
	_, err = newrb.ReadFrom(fin)
	if err != nil {
		t.Errorf("Failed reading from '%s': %s", fname, err)
	}
	if !rb.Equals(newrb) {
		t.Errorf("Bad serialization")
	}
}

func TestSerializationFromJava051(t *testing.T) {
	fname := "testdata/bitmapwithoutruns.bin"
	newrb := NewBitmap()
	fin, err := os.Open(fname)

	if err != nil {
		t.Errorf("Failed reading")
	}
	defer func() {
		fin.Close()
	}()

	_, _ = newrb.ReadFrom(fin)
	fmt.Println(newrb.GetCardinality())
	rb := NewBitmap()
	for k := uint32(0); k < 100000; k += 1000 {
		rb.Add(k)
	}
	for k := uint32(100000); k < 200000; k++ {
		rb.Add(3 * k)
	}
	for k := uint32(700000); k < 800000; k++ {
		rb.Add(k)
	}
	fmt.Println(rb.GetCardinality())
	if !rb.Equals(newrb) {
		t.Errorf("Bad serialization")
	}

}

func TestSerializationFromJavaWithRuns052(t *testing.T) {
	fname := "testdata/bitmapwithruns.bin"
	newrb := NewBitmap()
	fin, err := os.Open(fname)

	if err != nil {
		t.Errorf("Failed reading")
	}
	defer func() {
		fin.Close()
	}()
	_, _ = newrb.ReadFrom(fin)
	rb := NewBitmap()
	for k := uint32(0); k < 100000; k += 1000 {
		rb.Add(k)
	}
	for k := uint32(100000); k < 200000; k++ {
		rb.Add(3 * k)
	}
	for k := uint32(700000); k < 800000; k++ {
		rb.Add(k)
	}
	if !rb.Equals(newrb) {
		t.Errorf("Bad serialization")
	}

}

func TestSerializationBasic2_041(t *testing.T) {

	rb := BitmapOf(1, 2, 3, 4, 5, 100, 1000, 10000, 100000, 1000000)
	buf := &bytes.Buffer{}
	sz := rb.GetSerializedSizeInBytes()
	ub := BoundSerializedSizeInBytes(rb.GetCardinality(), 1000001)
	if sz > ub+10 {
		t.Errorf("Bad GetSerializedSizeInBytes; sz=%v, upper-bound=%v", sz, ub)
	}
	l := int(rb.GetSerializedSizeInBytes())
	_, err := rb.WriteTo(buf)
	if err != nil {
		t.Errorf("Failed writing")
	}
	if l != buf.Len() {
		t.Errorf("Bad GetSerializedSizeInBytes")
	}
	newrb := NewBitmap()
	_, err = newrb.ReadFrom(buf)
	if err != nil {
		t.Errorf("Failed reading")
	}
	if !rb.Equals(newrb) {
		t.Errorf("Cannot retrieve serialized version")
	}
}

func TestSerializationBasic3_042(t *testing.T) {

	Convey("roaringarray.writeTo and .readFrom should serialize and unserialize when containing all 3 container types", t, func() {
		rb := BitmapOf(1, 2, 3, 4, 5, 100, 1000, 10000, 100000, 1000000)
		for i := 5000000; i < 5000000+2*(1<<16); i++ {
			rb.AddInt(i)
		}

		// confirm all three types present
		var bc, ac, rc bool
		for _, v := range rb.highlowcontainer.containers {
			switch cn := v.(type) {
			case *bitmapContainer:
				bc = true
			case *arrayContainer:
				ac = true
			case *runContainer16:
				rc = true
			default:
				panic(fmt.Errorf("Unrecognized container implementation: %T", cn))
			}
		}
		if !bc {
			t.Errorf("no bitmapContainer found, change your test input so we test all three!")
		}
		if !ac {
			t.Errorf("no arrayContainer found, change your test input so we test all three!")
		}
		if !rc {
			t.Errorf("no runContainer16 found, change your test input so we test all three!")
		}

		var buf bytes.Buffer
		_, err := rb.WriteTo(&buf)
		if err != nil {
			t.Errorf("Failed writing")
		}
		if uint64(buf.Len()) != rb.GetSerializedSizeInBytes() {
			t.Errorf("Bad GetSerializedSizeInBytes")
		}

		newrb := NewBitmap()
		_, err = newrb.ReadFrom(&buf)
		if err != nil {
			t.Errorf("Failed reading")
		}
		c1, c2 := rb.GetCardinality(), newrb.GetCardinality()
		So(c2, ShouldEqual, c1)
		So(newrb.Equals(rb), ShouldBeTrue)
	})
}

func TestGobcoding043(t *testing.T) {
	rb := BitmapOf(1, 2, 3, 4, 5, 100, 1000)

	buf := new(bytes.Buffer)
	encoder := gob.NewEncoder(buf)
	err := encoder.Encode(rb)
	if err != nil {
		t.Errorf("Gob encoding failed")
	}

	var b Bitmap
	decoder := gob.NewDecoder(buf)
	err = decoder.Decode(&b)
	if err != nil {
		t.Errorf("Gob decoding failed")
	}

	if !b.Equals(rb) {
		t.Errorf("Decoded bitmap does not equal input bitmap")
	}
}

func TestSerializationRunContainerMsgpack028(t *testing.T) {

	Convey("runContainer writeTo and readFrom should return logically equivalent containers", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 10, percentFill: .2, ntrial: 10},
			{n: 10, percentFill: .8, ntrial: 10},
			{n: 10, percentFill: .50, ntrial: 10},
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

				orig := newRunContainer16FromVals(false, a...)

				// serialize
				var buf bytes.Buffer
				_, err := orig.writeToMsgpack(&buf)
				if err != nil {
					panic(err)
				}

				// deserialize
				restored := &runContainer16{}
				_, err = restored.readFromMsgpack(&buf)
				if err != nil {
					panic(err)
				}

				// and compare
				So(restored.equals(orig), ShouldBeTrue)

			}
		}

		for i := range trials {
			tester(trials[i])
		}

	})
}

func TestSerializationArrayOnly032(t *testing.T) {

	Convey("arrayContainer writeTo and readFrom should return logically equivalent containers, so long as you pre-size the write target properly", t, func() {

		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 101, percentFill: .50, ntrial: 10},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)

				n := tr.n

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					ma[r0] = true
				}

				// vs arrayContainer
				ac := newArrayContainer()
				for k := range ma {
					ac.iadd(uint16(k))
				}

				buf := &bytes.Buffer{}
				_, err := ac.writeTo(buf)
				panicOn(err)
				// have to pre-size the array write-target properly
				// by telling it the cardinality to read.
				ac2 := newArrayContainerSize(int(ac.getCardinality()))

				_, err = ac2.readFrom(buf)
				panicOn(err)
				So(ac2.String(), ShouldResemble, ac.String())
			}
		}

		for i := range trials {
			tester(trials[i])
		}
	})
}

func TestSerializationRunOnly033(t *testing.T) {

	Convey("runContainer16 writeTo and readFrom should return logically equivalent containers", t, func() {

		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 100, percentFill: .50, ntrial: 1},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)

				n := tr.n

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					ma[r0] = true
				}

				ac := newRunContainer16()
				for k := range ma {
					ac.iadd(uint16(k))
				}

				buf := &bytes.Buffer{}
				_, err := ac.writeTo(buf)
				panicOn(err)
				ac2 := newRunContainer16()

				_, err = ac2.readFrom(buf)
				panicOn(err)
				So(ac2.equals(ac), ShouldBeTrue)
				So(ac2.String(), ShouldResemble, ac.String())
			}
		}

		for i := range trials {
			tester(trials[i])
		}
	})
}

func TestSerializationBitmapOnly034(t *testing.T) {

	Convey("bitmapContainer writeTo and readFrom should return logically equivalent containers", t, func() {
		seed := int64(42)
		rand.Seed(seed)

		trials := []trial{
			{n: 8192, percentFill: .99, ntrial: 10},
		}

		tester := func(tr trial) {
			for j := 0; j < tr.ntrial; j++ {
				ma := make(map[int]bool)

				n := tr.n

				draw := int(float64(n) * tr.percentFill)
				for i := 0; i < draw; i++ {
					r0 := rand.Intn(n)
					ma[r0] = true
				}

				bc := newBitmapContainer()
				for k := range ma {
					bc.iadd(uint16(k))
				}

				buf := &bytes.Buffer{}
				_, err := bc.writeTo(buf)
				panicOn(err)
				bc2 := newBitmapContainer()

				_, err = bc2.readFrom(buf)
				panicOn(err)
				So(bc2.String(), ShouldResemble, bc.String())
				So(bc2.equals(bc), ShouldBeTrue)
			}
		}

		for i := range trials {
			tester(trials[i])
		}
	})
}

func TestSerializationBasicMsgpack035(t *testing.T) {

	Convey("roaringarray.writeToMsgpack and .readFromMsgpack should serialize and unserialize when containing all 3 container types", t, func() {
		rb := BitmapOf(1, 2, 3, 4, 5, 100, 1000, 10000, 100000, 1000000)
		for i := 5000000; i < 5000000+2*(1<<16); i++ {
			rb.AddInt(i)
		}

		// confirm all three types present
		var bc, ac, rc bool
		for _, v := range rb.highlowcontainer.containers {
			switch cn := v.(type) {
			case *bitmapContainer:
				bc = true
				So(cn.containerType(), ShouldEqual, bitmapContype)
			case *arrayContainer:
				ac = true
				So(cn.containerType(), ShouldEqual, arrayContype)
			case *runContainer16:
				rc = true
				So(cn.containerType(), ShouldEqual, run16Contype)
			default:
				panic(fmt.Errorf("Unrecognized container implementation: %T", cn))
			}
		}
		if !bc {
			t.Errorf("no bitmapContainer found, change your test input so we test all three!")
		}
		if !ac {
			t.Errorf("no arrayContainer found, change your test input so we test all three!")
		}
		if !rc {
			t.Errorf("no runContainer16 found, change your test input so we test all three!")
		}

		var buf bytes.Buffer
		_, err := rb.WriteToMsgpack(&buf)
		if err != nil {
			t.Errorf("Failed writing")
		}

		newrb := NewBitmap()
		_, err = newrb.ReadFromMsgpack(&buf)
		if err != nil {
			t.Errorf("Failed reading")
		}
		c1, c2 := rb.GetCardinality(), newrb.GetCardinality()
		So(c2, ShouldEqual, c1)
		So(newrb.Equals(rb), ShouldBeTrue)
	})
}

func TestByteSliceAsUint16Slice(t *testing.T) {
	t.Run("valid slice", func(t *testing.T) {
		expectedSize := 2
		slice := make([]byte, 4)
		binary.LittleEndian.PutUint16(slice, 42)
		binary.LittleEndian.PutUint16(slice[2:], 43)

		uint16Slice := byteSliceAsUint16Slice(slice)

		if len(uint16Slice) != expectedSize {
			t.Errorf("Expected output slice length %d, got %d", expectedSize, len(uint16Slice))
		}
		if cap(uint16Slice) != expectedSize {
			t.Errorf("Expected output slice cap %d, got %d", expectedSize, cap(uint16Slice))
		}

		if uint16Slice[0] != 42 || uint16Slice[1] != 43 {
			t.Errorf("Unexpected value found in result slice")
		}
	})

	t.Run("empty slice", func(t *testing.T) {
		slice := make([]byte, 0, 0)

		uint16Slice := byteSliceAsUint16Slice(slice)
		if len(uint16Slice) != 0 {
			t.Errorf("Expected output slice length 0, got %d", len(uint16Slice))
		}
		if cap(uint16Slice) != 0 {
			t.Errorf("Expected output slice cap 0, got %d", len(uint16Slice))
		}
	})

	t.Run("invalid slice size", func(t *testing.T) {
		defer func() {
			// All fine
			_ = recover()
		}()

		slice := make([]byte, 1, 1)

		byteSliceAsUint16Slice(slice)

		t.Errorf("byteSliceAsUint16Slice should panic on invalid slice size")
	})
}

func TestByteSliceAsUint64Slice(t *testing.T) {
	t.Run("valid slice", func(t *testing.T) {
		expectedSize := 2
		slice := make([]byte, 16)
		binary.LittleEndian.PutUint64(slice, 42)
		binary.LittleEndian.PutUint64(slice[8:], 43)

		uint64Slice := byteSliceAsUint64Slice(slice)

		if len(uint64Slice) != expectedSize {
			t.Errorf("Expected output slice length %d, got %d", expectedSize, len(uint64Slice))
		}
		if cap(uint64Slice) != expectedSize {
			t.Errorf("Expected output slice cap %d, got %d", expectedSize, cap(uint64Slice))
		}

		if uint64Slice[0] != 42 || uint64Slice[1] != 43 {
			t.Errorf("Unexpected value found in result slice")
		}
	})

	t.Run("empty slice", func(t *testing.T) {
		slice := make([]byte, 0, 0)

		uint64Slice := byteSliceAsUint64Slice(slice)
		if len(uint64Slice) != 0 {
			t.Errorf("Expected output slice length 0, got %d", len(uint64Slice))
		}
		if len(uint64Slice) != 0 {
			t.Errorf("Expected output slice length 0, got %d", len(uint64Slice))
		}
	})

	t.Run("invalid slice size", func(t *testing.T) {
		defer func() {
			// All fine
			_ = recover()
		}()

		slice := make([]byte, 1, 1)

		byteSliceAsUint64Slice(slice)

		t.Errorf("byteSliceAsUint64Slice should panic on invalid slice size")
	})
}

func TestByteSliceAsInterval16Slice(t *testing.T) {
	t.Run("valid slice", func(t *testing.T) {
		expectedSize := 2
		slice := make([]byte, 8)
		binary.LittleEndian.PutUint16(slice, 10)
		binary.LittleEndian.PutUint16(slice[2:], 2)
		binary.LittleEndian.PutUint16(slice[4:], 20)
		binary.LittleEndian.PutUint16(slice[6:], 2)

		intervalSlice := byteSliceAsInterval16Slice(slice)

		if len(intervalSlice) != expectedSize {
			t.Errorf("Expected output slice length %d, got %d", expectedSize, len(intervalSlice))
		}

		if cap(intervalSlice) != expectedSize {
			t.Errorf("Expected output slice cap %d, got %d", expectedSize, len(intervalSlice))
		}

		i1 := newInterval16Range(10, 12)
		i2 := newInterval16Range(20, 22)
		if intervalSlice[0] != i1 || intervalSlice[1] != i2 {
			t.Errorf("Unexpected items in result slice")
		}
	})

	t.Run("empty slice", func(t *testing.T) {
		slice := make([]byte, 0, 0)

		intervalSlice := byteSliceAsInterval16Slice(slice)
		if len(intervalSlice) != 0 {
			t.Errorf("Expected output slice length 0, got %d", len(intervalSlice))
		}
		if len(intervalSlice) != 0 {
			t.Errorf("Expected output slice length 0, got %d", len(intervalSlice))
		}
	})

	t.Run("invalid slice length", func(t *testing.T) {
		defer func() {
			// All fine
			_ = recover()
		}()

		slice := make([]byte, 1, 1)

		byteSliceAsInterval16Slice(slice)

		t.Errorf("byteSliceAsInterval16Slice should panic on invalid slice size")

	})

}

func TestBitmap_FromBuffer(t *testing.T) {
	t.Run("empty bitmap", func(t *testing.T) {
		rb := NewBitmap()

		buf := &bytes.Buffer{}
		_, err := rb.WriteTo(buf)
		if err != nil {
			t.Fatalf("Failed writing")
		}
		if uint64(buf.Len()) != rb.GetSerializedSizeInBytes() {
			t.Errorf("Bad GetSerializedSizeInBytes")
		}
		newRb := NewBitmap()
		newRb.FromBuffer(buf.Bytes())

		if err != nil {
			t.Errorf("Failed reading: %v", err)
		}
		if !rb.Equals(newRb) {
			t.Errorf("Cannot retrieve serialized version; rb != newRb")
		}
	})

	t.Run("basic bitmap of 7 elements", func(t *testing.T) {
		rb := BitmapOf(1, 2, 3, 4, 5, 100, 1000)

		buf := &bytes.Buffer{}
		_, err := rb.WriteTo(buf)
		if err != nil {
			t.Fatalf("Failed writing")
		}

		newRb := NewBitmap()
		_, err = newRb.FromBuffer(buf.Bytes())
		if err != nil {
			t.Errorf("Failed reading")
		}
		if !rb.Equals(newRb) {
			t.Errorf("Cannot retrieve serialized version; rb != newRb")
		}
	})

	t.Run("bitmap with runs", func(t *testing.T) {
		file := "testdata/bitmapwithruns.bin"

		buf, err := ioutil.ReadFile(file)
		if err != nil {
			t.Fatalf("Failed to read file")
		}

		rb := NewBitmap()
		_, err = rb.FromBuffer(buf)

		if err != nil {
			t.Errorf("Failed reading %s: %s", file, err)
		}
		if rb.Stats().RunContainers != 3 {
			t.Errorf("Bitmap should contain 3 run containers, was: %d", rb.Stats().RunContainers)
		}
		if rb.Stats().Containers != 11 {
			t.Errorf("Bitmap should contain a total of 11 containers, was %d", rb.Stats().Containers)
		}
	})

	t.Run("bitmap without runs", func(t *testing.T) {
		fn := "testdata/bitmapwithruns.bin"

		buf, err := ioutil.ReadFile(fn)
		if err != nil {
			t.Fatalf("Failed to read file")
		}

		rb := NewBitmap()
		_, err = rb.FromBuffer(buf)
		if err != nil {
			t.Errorf("Failed reading %s: %s", fn, err)
		}
	})
	// all3.classic somehow created by other tests.
	t.Run("all3.classic bitmap", func(t *testing.T) {
		file := "testdata/all3.classic"

		buf, err := ioutil.ReadFile(file)
		if err != nil {
			t.Fatalf("Failed to read file")
		}

		rb := NewBitmap()
		_, err = rb.FromBuffer(buf)
		if err != nil {
			t.Errorf("Failed reading %s: %s", file, err)
		}
	})
	t.Run("testdata/bitmapwithruns.bin bitmap Ops", func(t *testing.T) {
		file := "testdata/bitmapwithruns.bin"

		buf, err := ioutil.ReadFile(file)
		if err != nil {
			t.Fatalf("Failed to read file")
		}
		empt := NewBitmap()

		rb1 := NewBitmap()
		_, err = rb1.FromBuffer(buf)
		if err != nil {
			t.Errorf("Failed reading %s: %s", file, err)
		}
		rb2 := NewBitmap()
		_, err = rb2.FromBuffer(buf)
		if err != nil {
			t.Errorf("Failed reading %s: %s", file, err)
		}
		rbor := Or(rb1, rb2)
		rbfastor := FastOr(rb1, rb2)
		rband := And(rb1, rb2)
		rbxor := Xor(rb1, rb2)
		rbandnot := AndNot(rb1, rb2)
		if !rbor.Equals(rb1) {
			t.Errorf("Bug in OR")
		}
		if !rbfastor.Equals(rbor) {
			t.Errorf("Bug in FASTOR")
		}
		if !rband.Equals(rb1) {
			t.Errorf("Bug in AND")
		}
		if !rbxor.Equals(empt) {
			t.Errorf("Bug in XOR")
		}
		if !rbandnot.Equals(empt) {
			t.Errorf("Bug in ANDNOT")
		}
	})
	t.Run("marking all containers as requiring COW", func(t *testing.T) {
		file := "testdata/bitmapwithruns.bin"

		buf, err := ioutil.ReadFile(file)
		if err != nil {
			t.Fatalf("Failed to read file")
		}

		rb := NewBitmap()
		_, err = rb.FromBuffer(buf)

		if err != nil {
			t.Fatalf("Failed reading %s: %s", file, err)
		}

		for i, cow := range rb.highlowcontainer.needCopyOnWrite {
			if !cow {
				t.Errorf("Container at pos %d was not marked as needs-copy-on-write", i)
			}
		}
	})

}

func catchPanic(t *testing.T, f func(), name string) {
	defer func() {
		if err := recover(); err != nil {
			t.Error("panicked "+name+":", err)
			t.Log("stack:\n", string(debug.Stack()))
		}
	}()
	f()
}

func TestSerializationCrashers(t *testing.T) {
	crashers, err := filepath.Glob("testdata/crash*")
	if err != nil {
		t.Errorf("error globbing testdata/crash*: %v", err)
		return
	}

	for _, crasher := range crashers {
		data, err := ioutil.ReadFile(crasher)
		if err != nil {
			t.Errorf("error opening crasher %v: %v", crasher, err)
			continue
		}

		// take a copy in case the stream is modified during unpacking attempt
		orig := make([]byte, len(data))
		copy(orig, data)

		catchPanic(t, func() { NewBitmap().FromBuffer(data) }, "FromBuffer("+crasher+")")

		// reset for next one
		copy(data, orig)
		catchPanic(t, func() { NewBitmap().ReadFrom(bytes.NewReader(data)) }, "ReadFrom("+crasher+")")
	}
}
