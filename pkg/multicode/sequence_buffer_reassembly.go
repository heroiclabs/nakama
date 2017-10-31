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

type FragmentReassemblyPacketData struct {
	sequence             uint16
	ack                  uint16
	ackBits              uint32
	numFragmentsReceived int
	numFragmentsTotal    int
	packetDataBuffer     []byte // TODO Replace with a pooled and/or resizable buffer?
	packetBytes          int
	headerOffset         int
	fragmentReceived     []bool
}

func NewFragmentReassemblyPacketData() *FragmentReassemblyPacketData {
	return &FragmentReassemblyPacketData{
		fragmentReceived: make([]bool, 256),
	}
}

func (d *FragmentReassemblyPacketData) StoreFragmentData(channelID byte, sequence uint16, ack uint16, ackBits uint32, fragmentID int, fragmentSize int, fragmentData []byte, fragmentBytes int) {
	copyOffset := 0

	if fragmentID == 0 {
		// TODO Use a buffer pool.
		packetHeader := make([]byte, MAX_PACKET_HEADER_BYTES)
		headerBytes := WritePacketHeader(packetHeader, channelID, sequence, ack, ackBits)
		d.headerOffset = MAX_PACKET_HEADER_BYTES - headerBytes

		requiredBufferSize := MAX_PACKET_HEADER_BYTES + fragmentSize
		if d.packetDataBuffer == nil {
			d.packetDataBuffer = make([]byte, requiredBufferSize)
		} else if len(d.packetDataBuffer) < requiredBufferSize {
			buf := make([]byte, requiredBufferSize)
			copy(buf, d.packetDataBuffer)
			d.packetDataBuffer = buf
		}

		copy(d.packetDataBuffer[d.headerOffset:], packetHeader[:headerBytes])
		copyOffset = headerBytes

		fragmentBytes -= headerBytes
	}

	requiredTotalBufferSize := MAX_PACKET_HEADER_BYTES + fragmentID*fragmentSize + fragmentBytes
	if d.packetDataBuffer == nil {
		d.packetDataBuffer = make([]byte, requiredTotalBufferSize)
	} else {
		buf := make([]byte, requiredTotalBufferSize)
		copy(buf, d.packetDataBuffer)
		d.packetDataBuffer = buf
	}

	if fragmentID == d.numFragmentsTotal-1 {
		d.packetBytes = (d.numFragmentsTotal-1)*fragmentSize + fragmentBytes
	}

	copy(d.packetDataBuffer[(MAX_PACKET_HEADER_BYTES+fragmentID*fragmentSize):], fragmentData[copyOffset:(copyOffset+fragmentBytes)])
}

func (d *FragmentReassemblyPacketData) Clear() {
	d.fragmentReceived = make([]bool, 256)
}

type SequenceBufferReassembly struct {
	sequence      uint16
	numEntries    uint16
	entrySequence []uint32
	entryData     []*FragmentReassemblyPacketData
}

func NewSequenceBufferReassembly(bufferSize int) *SequenceBufferReassembly {
	s := &SequenceBufferReassembly{
		sequence:      0,
		numEntries:    uint16(bufferSize),
		entrySequence: make([]uint32, bufferSize),
		entryData:     make([]*FragmentReassemblyPacketData, bufferSize),
	}
	for i := 0; i < bufferSize; i++ {
		s.entrySequence[i] = NULL_SEQUENCE
		s.entryData[i] = NewFragmentReassemblyPacketData()
	}
	return s
}

func (s *SequenceBufferReassembly) Find(sequence uint16) *FragmentReassemblyPacketData {
	index := sequence % s.numEntries
	sequenceNum := s.entrySequence[index]
	if sequenceNum == uint32(sequence) {
		return s.entryData[index]
	}
	return nil
}

func (s *SequenceBufferReassembly) Insert(sequence uint16) *FragmentReassemblyPacketData {
	if SequenceLessThan(sequence, s.sequence-s.numEntries) {
		return nil
	}

	if SequenceGreaterThan(sequence+1, s.sequence) {
		s.RemoveEntries(int32(s.sequence), int32(sequence))
		s.sequence = sequence + 1
	}

	index := sequence % s.numEntries
	s.entrySequence[index] = uint32(sequence)
	return s.entryData[index]
}

func (s *SequenceBufferReassembly) Remove(sequence uint16) {
	s.entrySequence[sequence%s.numEntries] = NULL_SEQUENCE
}

func (s *SequenceBufferReassembly) RemoveEntries(startSequence, finishSequence int32) {
	if finishSequence < startSequence {
		finishSequence += 65536
	}
	if uint16(finishSequence-startSequence) < s.numEntries {
		for sequence := startSequence; sequence <= finishSequence; sequence++ {
			s.entrySequence[uint16(sequence)%s.numEntries] = NULL_SEQUENCE
		}
	} else {
		for i := uint16(0); i < s.numEntries; i++ {
			s.entrySequence[i] = NULL_SEQUENCE
		}
	}
}
