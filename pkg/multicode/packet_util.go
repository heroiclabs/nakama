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

import "errors"

const (
	MAX_PACKET_HEADER_BYTES = 10
	FRAGMENT_HEADER_BYTES   = 6
	NULL_SEQUENCE           = uint32(0xFFFFFFFF)
)

var ErrValueOutOfRange = errors.New("variable length value out of range")

func GetVariableLengthBytes(val uint16) (int, error) {
	if val > 0x7fff {
		return 0, ErrValueOutOfRange
	}
	b := byte(val >> 7)
	if b != 0 {
		return 2, nil
	}
	return 1, nil
}

func WriteVariableLengthUint16(val uint16, rw *ByteArrayReaderWriter) error {
	if val > 0x7fff {
		return ErrValueOutOfRange
	}
	b1 := byte(val & 0x007F) // Lowest 7 bits.
	b2 := byte(val >> 7)     // Remaining 8 bits.
	if b2 != 0 {
		b1 |= 0x80
	}
	rw.WriteByte(b1)
	if b2 != 0 {
		rw.WriteByte(b2)
	}
	return nil
}

func ReadVariableLengthUint16(rw *ByteArrayReaderWriter) (uint16, error) {
	var val uint16
	b1, err := rw.ReadByte()
	if err != nil {
		return 0, err
	}
	val |= uint16(b1 & 0x7F)
	if (b1 & 0x80) != 0 {
		b2, err := rw.ReadByte()
		if err != nil {
			return 0, err
		}
		val |= (uint16(b2) << 7)
	}
	return val, nil
}

func SequenceGreaterThan(s1, s2 uint16) bool {
	return ((s1 > s2) && (s1-s2 <= 32768)) || ((s1 < s2) && (s2-s1 > 32768))
}

func SequenceLessThan(s1, s2 uint16) bool {
	return SequenceGreaterThan(s2, s1)
}

func ReadPacketHeader(packetBuffer []byte, offset, bufferLength int) (int, byte, uint16, uint16, uint32, error) {
	if bufferLength < 4 {
		return 0, 0, 0, 0, 0, errors.New("buffer too small for packet header")
	}

	rw := NewByteArrayReaderWriter(packetBuffer)
	rw.SeekRead(offset)

	var err error

	var prefixByte byte
	if prefixByte, err = rw.ReadByte(); err != nil {
		return 0, 0, 0, 0, 0, err
	} else if (prefixByte & 1) != 0 {
		return 0, 0, 0, 0, 0, errors.New("header does not indicate regular packet")
	}

	var channelID byte
	if channelID, err = rw.ReadByte(); err != nil {
		return 0, 0, 0, 0, 0, err
	}

	var sequence uint16
	// Ack packets don't have sequence numbers.
	if (prefixByte & 0x80) == 0 {
		if sequence, err = rw.ReadUint16(); err != nil {
			return 0, channelID, 0, 0, 0, err
		}
	}

	var ack uint16
	if (prefixByte & (1 << 5)) != 0 {
		if bufferLength < 2+1 {
			return 0, channelID, sequence, 0, 0, errors.New("buffer too small for packet header")
		}
		var sequenceDiff byte
		if sequenceDiff, err = rw.ReadByte(); err != nil {
			return 0, channelID, sequence, 0, 0, err
		}
		ack = uint16(sequence - uint16(sequenceDiff))
	} else {
		if bufferLength < 2+2 {
			return 0, channelID, sequence, 0, 0, errors.New("buffer too small for packet header")
		}
		if ack, err = rw.ReadUint16(); err != nil {
			return 0, channelID, sequence, 0, 0, err
		}
	}

	expectedBytes := 0
	for i := uint(0); i <= 4; i++ {
		if (prefixByte & (1 << i)) != 0 {
			expectedBytes++
		}
	}
	if bufferLength < (bufferLength-rw.readPosition)+expectedBytes {
		return 0, channelID, sequence, ack, 0, errors.New("buffer too small for packet header")
	}

	ackBits := uint32(0xFFFFFFFF)
	if (prefixByte & (1 << 1)) != 0 {
		ackBits &= 0xFFFFFF00
		var b byte
		if b, err = rw.ReadByte(); err != nil {
			return 0, channelID, sequence, ack, 0, err
		} else {
			ackBits |= uint32(b)
		}
	}
	if (prefixByte & (1 << 2)) != 0 {
		ackBits &= 0xFFFF00FF
		var b byte
		if b, err = rw.ReadByte(); err != nil {
			return 0, channelID, sequence, ack, 0, err
		} else {
			ackBits |= (uint32(b) << 8)
		}
	}
	if (prefixByte & (1 << 3)) != 0 {
		ackBits &= 0xFF00FFFF
		var b byte
		if b, err = rw.ReadByte(); err != nil {
			return 0, channelID, sequence, ack, 0, err
		} else {
			ackBits |= (uint32(b) << 16)
		}
	}
	if (prefixByte & (1 << 4)) != 0 {
		ackBits &= 0x00FFFFFF
		var b byte
		if b, err = rw.ReadByte(); err != nil {
			return 0, channelID, sequence, ack, 0, err
		} else {
			ackBits |= (uint32(b) << 24)
		}
	}

	return rw.readPosition - offset, channelID, sequence, ack, ackBits, nil
}

func ReadFragmentHeader(packetBuffer []byte, offset, bufferLength, maxFragments, fragmentSize int) (int, int, int, int, uint16, uint16, uint32, byte, error) {
	if bufferLength < FRAGMENT_HEADER_BYTES {
		return 0, 0, 0, 0, 0, 0, 0, 0, errors.New("buffer too small for packet header")
	}

	rw := NewByteArrayReaderWriter(packetBuffer)
	rw.SeekRead(offset)

	var err error

	var prefixByte byte
	if prefixByte, err = rw.ReadByte(); err != nil {
		return 0, 0, 0, 0, 0, 0, 0, 0, err
	} else if prefixByte != 1 {
		return 0, 0, 0, 0, 0, 0, 0, 0, errors.New("packet header indicates non-fragment packet")
	}

	var channelID byte
	if channelID, err = rw.ReadByte(); err != nil {
		return 0, 0, 0, 0, 0, 0, 0, 0, err
	}

	var sequence uint16
	if sequence, err = rw.ReadUint16(); err != nil {
		return 0, 0, 0, 0, 0, 0, 0, channelID, err
	}

	var fragmentID int
	var fragmentIDByte byte
	if fragmentIDByte, err = rw.ReadByte(); err != nil {
		return 0, 0, 0, 0, sequence, 0, 0, channelID, err
	} else {
		fragmentID = int(fragmentIDByte)
	}

	var numFragments int
	var numFragmentsByte byte
	if numFragmentsByte, err = rw.ReadByte(); err != nil {
		return 0, fragmentID, 0, 0, sequence, 0, 0, channelID, err
	} else {
		numFragments = int(numFragmentsByte) + 1
		if numFragments > maxFragments {
			return 0, fragmentID, 0, 0, sequence, 0, 0, channelID, errors.New("packet header indicates fragments outside of max range")
		} else if fragmentID >= numFragments {
			return 0, fragmentID, 0, 0, sequence, 0, 0, channelID, errors.New("packet header indicates fragment ID outside of fragment count")
		}
	}

	fragmentBytes := bufferLength - FRAGMENT_HEADER_BYTES

	var ack uint16
	var ackBits uint32

	if fragmentID == 0 {
		var packetHeaderBytes int
		//var packetChannelID byte
		var packetSequence uint16
		//if packetHeaderBytes, packetChannelID, packetSequence, ack, ackBits, err = ReadPacketHeader(packetBuffer, FRAGMENT_HEADER_BYTES, bufferLength); err != nil {
		if packetHeaderBytes, _, packetSequence, ack, ackBits, err = ReadPacketHeader(packetBuffer, FRAGMENT_HEADER_BYTES, bufferLength); err != nil {
			return 0, fragmentID, numFragments, 0, sequence, 0, 0, channelID, err
		} else if packetSequence != sequence {
			return 0, fragmentID, numFragments, 0, sequence, 0, 0, channelID, errors.New("bad packet sequence in fragment")
		}
		fragmentBytes = bufferLength - packetHeaderBytes - FRAGMENT_HEADER_BYTES
	}

	if fragmentBytes > fragmentSize {
		return 0, fragmentID, numFragments, 0, sequence, ack, ackBits, channelID, errors.New("fragment bytes remaining > indicated fragment size")
	}
	if fragmentID != numFragments-1 && fragmentBytes != fragmentSize {
		return 0, fragmentID, numFragments, 0, sequence, ack, ackBits, channelID, errors.New("fragment bytes remaining > indicated fragment size")
	}

	return rw.readPosition - offset, fragmentID, numFragments, fragmentBytes, sequence, ack, ackBits, channelID, nil
}

func WriteAckPacket(packetBuffer []byte, channelID byte, ack uint16, ackBits uint32) int {
	rw := NewByteArrayReaderWriter(packetBuffer)

	prefixByte := byte(0x80) // Top bit set, indicates ack packet.

	if (ackBits & 0x000000FF) != 0x000000FF {
		prefixByte |= 1 << 1
	}
	if (ackBits & 0x0000FF00) != 0x0000FF00 {
		prefixByte |= 1 << 2
	}
	if (ackBits & 0x00FF0000) != 0x00FF0000 {
		prefixByte |= 1 << 3
	}
	if (ackBits & 0xFF000000) != 0xFF000000 {
		prefixByte |= 1 << 4
	}

	rw.WriteByte(prefixByte)
	rw.WriteByte(channelID)
	rw.WriteUint16(ack)

	if (ackBits & 0x000000FF) != 0x000000FF {
		rw.WriteByte(byte(ackBits & 0x000000FF))
	}
	if (ackBits & 0x0000FF00) != 0x0000FF00 {
		rw.WriteByte(byte((ackBits & 0x0000FF00) >> 8))
	}
	if (ackBits & 0x00FF0000) != 0x00FF0000 {
		rw.WriteByte(byte((ackBits & 0x00FF0000) >> 16))
	}
	if (ackBits & 0xFF000000) != 0xFF000000 {
		rw.WriteByte(byte((ackBits & 0xFF000000) >> 24))
	}

	return rw.writePosition
}

func WritePacketHeader(packetBuffer []byte, channelID byte, sequence uint16, ack uint16, ackBits uint32) int {
	rw := NewByteArrayReaderWriter(packetBuffer)

	prefixByte := byte(0)

	if (ackBits & 0x000000FF) != 0x000000FF {
		prefixByte |= 1 << 1
	}
	if (ackBits & 0x0000FF00) != 0x0000FF00 {
		prefixByte |= 1 << 2
	}
	if (ackBits & 0x00FF0000) != 0x00FF0000 {
		prefixByte |= 1 << 3
	}
	if (ackBits & 0xFF000000) != 0xFF000000 {
		prefixByte |= 1 << 4
	}

	sequenceDiff := int32(sequence - ack)
	if sequenceDiff < 0 {
		sequenceDiff += 65536
	}
	if sequenceDiff <= 255 {
		prefixByte |= 1 << 5
	}

	rw.WriteByte(prefixByte)
	rw.WriteByte(channelID)
	rw.WriteUint16(sequence)

	if sequenceDiff <= 255 {
		rw.WriteByte(byte(sequenceDiff))
	} else {
		rw.WriteUint16(ack)
	}

	if (ackBits & 0x000000FF) != 0x000000FF {
		rw.WriteByte(byte(ackBits & 0x000000FF))
	}
	if (ackBits & 0x0000FF00) != 0x0000FF00 {
		rw.WriteByte(byte((ackBits & 0x0000FF00) >> 8))
	}
	if (ackBits & 0x00FF0000) != 0x00FF0000 {
		rw.WriteByte(byte((ackBits & 0x00FF0000) >> 16))
	}
	if (ackBits & 0xFF000000) != 0xFF000000 {
		rw.WriteByte(byte((ackBits & 0xFF000000) >> 24))
	}

	return rw.writePosition
}
