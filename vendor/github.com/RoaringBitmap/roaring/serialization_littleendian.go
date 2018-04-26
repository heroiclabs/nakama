// +build 386 amd64,!appengine

package roaring

import (
	"io"
	"reflect"
	"unsafe"
)

func (ac *arrayContainer) writeTo(stream io.Writer) (int, error) {
	buf := uint16SliceAsByteSlice(ac.content)
	return stream.Write(buf)
}

func (bc *bitmapContainer) writeTo(stream io.Writer) (int, error) {
	buf := uint64SliceAsByteSlice(bc.bitmap)
	return stream.Write(buf)
}

// readFrom reads an arrayContainer from stream.
// PRE-REQUISITE: you must size the arrayContainer correctly (allocate b.content)
// *before* you call readFrom. We can't guess the size in the stream
// by this point.
func (ac *arrayContainer) readFrom(stream io.Reader) (int, error) {
	buf := uint16SliceAsByteSlice(ac.content)
	return io.ReadFull(stream, buf)
}

func (bc *bitmapContainer) readFrom(stream io.Reader) (int, error) {
	buf := uint64SliceAsByteSlice(bc.bitmap)
	n, err := io.ReadFull(stream, buf)
	bc.computeCardinality()
	return n, err
}

func uint64SliceAsByteSlice(slice []uint64) []byte {
	// make a new slice header
	header := *(*reflect.SliceHeader)(unsafe.Pointer(&slice))

	// update its capacity and length
	header.Len *= 8
	header.Cap *= 8

	// return it
	return *(*[]byte)(unsafe.Pointer(&header))
}

func uint16SliceAsByteSlice(slice []uint16) []byte {
	// make a new slice header
	header := *(*reflect.SliceHeader)(unsafe.Pointer(&slice))

	// update its capacity and length
	header.Len *= 2
	header.Cap *= 2

	// return it
	return *(*[]byte)(unsafe.Pointer(&header))
}

func (bc *bitmapContainer) asLittleEndianByteSlice() []byte {
	return uint64SliceAsByteSlice(bc.bitmap)
}

// Deserialization code follows

func byteSliceAsUint16Slice(slice []byte) []uint16 {
	if len(slice)%2 != 0 {
		panic("Slice size should be divisible by 2")
	}

	// make a new slice header
	header := *(*reflect.SliceHeader)(unsafe.Pointer(&slice))

	// update its capacity and length
	header.Len /= 2
	header.Cap /= 2

	// return it
	return *(*[]uint16)(unsafe.Pointer(&header))
}

func byteSliceAsUint64Slice(slice []byte) []uint64 {
	if len(slice)%8 != 0 {
		panic("Slice size should be divisible by 8")
	}

	// make a new slice header
	header := *(*reflect.SliceHeader)(unsafe.Pointer(&slice))

	// update its capacity and length
	header.Len /= 8
	header.Cap /= 8

	// return it
	return *(*[]uint64)(unsafe.Pointer(&header))
}

func byteSliceAsInterval16Slice(slice []byte) []interval16 {
	if len(slice)%4 != 0 {
		panic("Slice size should be divisible by 4")
	}

	// make a new slice header
	header := *(*reflect.SliceHeader)(unsafe.Pointer(&slice))

	// update its capacity and length
	header.Len /= 4
	header.Cap /= 4

	// return it
	return *(*[]interval16)(unsafe.Pointer(&header))
}
