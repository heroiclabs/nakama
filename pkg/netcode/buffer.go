package netcode

import (
	"io"
	"math"
)

// Buffer is a helper struct for serializing and deserializing as the caller
// does not need to externally manage where in the buffer they are currently reading
// or writing to.
type Buffer struct {
	Buf []byte // the backing byte slice
	Pos int    // current position in read/write
}

// Creates a new Buffer with a backing byte slice of the provided size
func NewBuffer(size int) *Buffer {
	b := &Buffer{}
	b.Buf = make([]byte, size)
	return b
}

// Creates a new Buffer using the original backing slice
func NewBufferFromRef(buf []byte) *Buffer {
	b := &Buffer{}
	b.Buf = buf
	b.Pos = 0
	return b
}

// Creates a new buffer from a byte slice
func NewBufferFromBytes(buf []byte) *Buffer {
	b := &Buffer{}
	b.Buf = make([]byte, len(buf))
	copy(b.Buf, buf)
	return b
}

// Returns a copy of Buffer
func (b *Buffer) Copy() *Buffer {
	c := NewBuffer(len(b.Buf))
	copy(c.Buf, b.Buf)
	return c
}

// Gets the length of the backing byte slice
func (b *Buffer) Len() int {
	return len(b.Buf)
}

// Returns the backing byte slice
func (b *Buffer) Bytes() []byte {
	return b.Buf
}

// Resets the position back to beginning of buffer
func (b *Buffer) Reset() {
	b.Pos = 0
}

// GetByte decodes a little-endian byte
func (b *Buffer) GetByte() (byte, error) {
	return b.GetUint8()
}

// GetBytes returns a byte slice possibly smaller than length if bytes are not available from the
// reader.
func (b *Buffer) GetBytes(length int) ([]byte, error) {
	bufferLength := len(b.Buf)
	bufferWindow := b.Pos + length
	if bufferLength < length {
		return nil, io.EOF
	}
	if bufferWindow > bufferLength {
		return nil, io.EOF
	}
	value := b.Buf[b.Pos:bufferWindow]
	b.Pos += length
	return value, nil
}

// GetUint8 decodes a little-endian uint8 from the buffer
func (b *Buffer) GetUint8() (uint8, error) {
	buf, err := b.GetBytes(SizeUint8)
	if err != nil {
		return 0, nil
	}
	return uint8(buf[0]), nil
}

// GetUint16 decodes a little-endian uint16 from the buffer
func (b *Buffer) GetUint16() (uint16, error) {
	var n uint16
	buf, err := b.GetBytes(SizeUint16)
	if err != nil {
		return 0, nil
	}
	n |= uint16(buf[0])
	n |= uint16(buf[1]) << 8
	return n, nil
}

// GetUint32 decodes a little-endian uint32 from the buffer
func (b *Buffer) GetUint32() (uint32, error) {
	var n uint32
	buf, err := b.GetBytes(SizeUint32)
	if err != nil {
		return 0, nil
	}
	n |= uint32(buf[0])
	n |= uint32(buf[1]) << 8
	n |= uint32(buf[2]) << 16
	n |= uint32(buf[3]) << 24
	return n, nil
}

// GetUint64 decodes a little-endian uint64 from the buffer
func (b *Buffer) GetUint64() (uint64, error) {
	var n uint64
	buf, err := b.GetBytes(SizeUint64)
	if err != nil {
		return 0, nil
	}
	n |= uint64(buf[0])
	n |= uint64(buf[1]) << 8
	n |= uint64(buf[2]) << 16
	n |= uint64(buf[3]) << 24
	n |= uint64(buf[4]) << 32
	n |= uint64(buf[5]) << 40
	n |= uint64(buf[6]) << 48
	n |= uint64(buf[7]) << 56
	return n, nil
}

// GetInt8 decodes a little-endian int8 from the buffer
func (b *Buffer) GetInt8() (int8, error) {
	buf, err := b.GetBytes(SizeInt8)
	if err != nil {
		return 0, nil
	}
	return int8(buf[0]), nil
}

// GetInt16 decodes a little-endian int16 from the buffer
func (b *Buffer) GetInt16() (int16, error) {
	var n int16
	buf, err := b.GetBytes(SizeInt16)
	if err != nil {
		return 0, nil
	}
	n |= int16(buf[0])
	n |= int16(buf[1]) << 8
	return n, nil
}

// GetInt32 decodes a little-endian int32 from the buffer
func (b *Buffer) GetInt32() (int32, error) {
	var n int32
	buf, err := b.GetBytes(SizeInt32)
	if err != nil {
		return 0, nil
	}
	n |= int32(buf[0])
	n |= int32(buf[1]) << 8
	n |= int32(buf[2]) << 16
	n |= int32(buf[3]) << 24
	return n, nil
}

// GetInt64 decodes a little-endian int64 from the buffer
func (b *Buffer) GetInt64() (int64, error) {
	var n int64
	buf, err := b.GetBytes(SizeInt64)
	if err != nil {
		return 0, nil
	}
	n |= int64(buf[0])
	n |= int64(buf[1]) << 8
	n |= int64(buf[2]) << 16
	n |= int64(buf[3]) << 24
	n |= int64(buf[4]) << 32
	n |= int64(buf[5]) << 40
	n |= int64(buf[6]) << 48
	n |= int64(buf[7]) << 56
	return n, nil
}

// WriteByte encodes a little-endian uint8 into the buffer.
func (b *Buffer) WriteByte(n byte) {
	b.Buf[b.Pos] = n
	b.Pos++
}

// WriteBytes encodes a little-endian byte slice into the buffer
func (b *Buffer) WriteBytes(src []byte) {
	for i := 0; i < len(src); i += 1 {
		b.WriteByte(src[i])
	}
}

// WriteBytes encodes a little-endian byte slice into the buffer
func (b *Buffer) WriteBytesN(src []byte, length int) {
	for i := 0; i < length; i += 1 {
		b.WriteByte(src[i])
	}
}

// WriteUint8 encodes a little-endian uint8 into the buffer.
func (b *Buffer) WriteUint8(n uint8) {
	b.Buf[b.Pos] = byte(n)
	b.Pos++
}

// WriteUint16 encodes a little-endian uint16 into the buffer.
func (b *Buffer) WriteUint16(n uint16) {
	b.Buf[b.Pos] = byte(n)
	b.Pos++
	b.Buf[b.Pos] = byte(n >> 8)
	b.Pos++
}

// WriteUint32 encodes a little-endian uint32 into the buffer.
func (b *Buffer) WriteUint32(n uint32) {
	b.Buf[b.Pos] = byte(n)
	b.Pos++
	b.Buf[b.Pos] = byte(n >> 8)
	b.Pos++
	b.Buf[b.Pos] = byte(n >> 16)
	b.Pos++
	b.Buf[b.Pos] = byte(n >> 24)
	b.Pos++
}

// WriteUint64 encodes a little-endian uint64 into the buffer.
func (b *Buffer) WriteUint64(n uint64) {
	for i := uint(0); i < uint(SizeUint64); i++ {
		b.Buf[b.Pos] = byte(n >> (i * 8))
		b.Pos++
	}
}

// WriteInt8 encodes a little-endian int8 into the buffer.
func (b *Buffer) WriteInt8(n int8) {
	b.Buf[b.Pos] = byte(n)
	b.Pos++
}

// WriteInt16 encodes a little-endian int16 into the buffer.
func (b *Buffer) WriteInt16(n int16) {
	b.Buf[b.Pos] = byte(n)
	b.Pos++
	b.Buf[b.Pos] = byte(n >> 8)
	b.Pos++
}

// WriteInt32 encodes a little-endian int32 into the buffer.
func (b *Buffer) WriteInt32(n int32) {
	b.Buf[b.Pos] = byte(n)
	b.Pos++
	b.Buf[b.Pos] = byte(n >> 8)
	b.Pos++
	b.Buf[b.Pos] = byte(n >> 16)
	b.Pos++
	b.Buf[b.Pos] = byte(n >> 24)
	b.Pos++
}

// WriteInt64 encodes a little-endian int64 into the buffer.
func (b *Buffer) WriteInt64(n int64) {
	for i := uint(0); i < uint(SizeInt64); i++ {
		b.Buf[b.Pos] = byte(n >> (i * 8))
		b.Pos++
	}
}

// WriteFloat32 encodes a little-endian float32 into the buffer.
func (b *Buffer) WriteFloat32(n float32) {
	b.WriteUint32(math.Float32bits(n))
}

// WriteFloat64 encodes a little-endian float64 into the buffer.
func (b *Buffer) WriteFloat64(buf []byte, n float64) {
	b.WriteUint64(math.Float64bits(n))
}
