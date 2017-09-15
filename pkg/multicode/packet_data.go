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

const MAX_PACKET_HEADER_BYTES = 9

type PacketData interface {
}

type SentPacketData struct {
	time        int64
	acked       bool
	packetBytes uint32
}

type ReceivedPacketData struct {
	time        int64
	packetBytes uint32
}

type FragmentReassemblyPacketData struct {
	sequence             uint16
	ack                  uint16
	ackBits              uint32
	numFragmentsReceived int
	numFragmentsTotal    int
	packetDataBuffer     []byte // TODO ?
	packetBytes          int
	packetHeaderBytes    int
	fragmentReceived     []bool
}

func (d *FragmentReassemblyPacketData) StoreFragmentData(channelID byte, sequence uint16, ack uint16, ackBits uint32, fragmentID int, fragmentSize int, fragmentData []byte, fragmentBytes int) {
	copyOffset := 0

	if fragmentID == 0 {
		// TODO Use a buffer pool.
		packetHeader := make([]byte, MAX_PACKET_HEADER_BYTES)
		d.packetHeaderBytes = WritePacketHeader(packetHeader, channelID, sequence, ack, ackBits)

		requiredBufferSize := d.packetHeaderBytes + fragmentSize
		if d.packetDataBuffer == nil {
			d.packetDataBuffer = make([]byte, requiredBufferSize)
		} else if len(d.packetDataBuffer) < requiredBufferSize {
			buf := make([]byte, requiredBufferSize)
			copy(buf, d.packetDataBuffer)
			d.packetDataBuffer = buf
		}

		copy(d.packetDataBuffer, packetHeader[:d.packetHeaderBytes])
		copyOffset = d.packetHeaderBytes

		fragmentBytes -= d.packetHeaderBytes
	}

	requiredTotalBufferSize := d.packetHeaderBytes + fragmentID*fragmentSize + fragmentBytes
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

	copy(d.packetDataBuffer[(d.packetHeaderBytes+fragmentID*fragmentSize):], fragmentData[copyOffset:(copyOffset+fragmentBytes)])
}
