// Copyright 2017 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package multicode

import "io"

type ByteArrayReaderWriter struct {
	data          []byte
	readPosition  int
	writePosition int
}

// TODO Cache and reuse?
func NewByteArrayReaderWriter(data []byte) *ByteArrayReaderWriter {
	return &ByteArrayReaderWriter{
		data:          data,
		readPosition:  0,
		writePosition: 0,
	}
}

// Reset the read position in the stream to the given offset relative to the beginning of the stream.
func (s *ByteArrayReaderWriter) SeekRead(offset int) int {
	s.readPosition = offset
	return s.readPosition
}

// Reset the read position in the stream to the given offset relative to the beginning of the stream.
func (s *ByteArrayReaderWriter) SeekWrite(offset int) int {
	s.writePosition = offset
	return s.writePosition
}

func (s *ByteArrayReaderWriter) ReadByte() (byte, error) {
	buf := make([]byte, 1)
	if s.read(buf, 0, 1) != 1 {
		return 0, io.EOF
	}
	return buf[0], nil
}

func (s *ByteArrayReaderWriter) ReadUint16() (uint16, error) {
	buf := make([]byte, 2)
	if s.read(buf, 0, 2) != 2 {
		return 0, io.EOF
	}
	return uint16(uint32(buf[0]) | (uint32(buf[1])<<8)), nil
}

func (s *ByteArrayReaderWriter) ReadBuffer(buf []byte, length int) error {
	if s.read(buf, 0, length) != length {
		return io.EOF
	}
	return nil
}

func (s *ByteArrayReaderWriter) WriteByte(b byte) {
	s.write([]byte{b}, 0, 1)
}

func (s *ByteArrayReaderWriter) WriteUint16(u uint16) {
	s.write([]byte{byte(u), byte(uint32(u) >> 8)}, 0, 2)
}

func (s *ByteArrayReaderWriter) WriteBuffer(buf []byte, length int) {
	s.write(buf, 0, length)
	//for i := 0; i < length; i++ {
	//	s.WriteByte(buf[i])
	//}
}

func (s *ByteArrayReaderWriter) read(buffer []byte, offset, count int) int {
	readBytes := 0
	length := len(s.data)
	for i := 0; i < count && s.readPosition < length; i++ {
		buffer[i+offset] = s.data[s.readPosition]
		s.readPosition++
		readBytes++
	}
	return readBytes
}

func (s *ByteArrayReaderWriter) write(buffer []byte, offset, count int) {
	for i := 0; i < count; i++ {
		s.data[s.writePosition] = buffer[i+offset]
		s.writePosition++
	}
}
