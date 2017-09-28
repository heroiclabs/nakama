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

import (
	"errors"
	"math"
)

var ErrReliablePacketControllerPacketDataTooLarge = errors.New("reliable packet controller packet data too large")

type ReliablePacketController struct {
	maxPacketSize                int
	fragmentThreshold            int
	maxFragments                 int
	fragmentSize                 int
	sentPacketBufferSize         uint16
	receivedPacketBufferSize     uint16
	fragmentReassemblyBufferSize int
	rttSmoothFactor              float64
	packetLossSmoothingFactor    float64
	bandwidthSmoothingFactor     float64
	packetHeaderSize             int

	time int64
	// TODO flip this responsibility.
	// A function used to send outgoing data.
	sendFn func([]byte, int)
	// TODO flip this responsibility.
	// A function used to hand off data ready for the application to consume.
	receiveFn func(uint16, []byte, int)
	// TODO flip?
	ackFn func(uint16)

	rtt                   float64
	packetLoss            float64
	sentBandwidthKBPS     float64
	receivedBandwidthKBPS float64
	ackedBandwidthKBPS    float64
	sequence              uint16
	sentPackets           *SequenceBufferSent
	receivedPackets       *SequenceBufferReceived
	fragmentReassembly    *SequenceBufferReassembly
}

func NewReliablePacketController(time int64, sendFn func([]byte, int), receiveFn func(uint16, []byte, int), ackFn func(uint16)) *ReliablePacketController {
	return &ReliablePacketController{
		maxPacketSize:                16 * 1024,
		fragmentThreshold:            1024,
		maxFragments:                 16,
		fragmentSize:                 1024,
		sentPacketBufferSize:         256,
		receivedPacketBufferSize:     256,
		fragmentReassemblyBufferSize: 64,
		rttSmoothFactor:              0.25,
		packetLossSmoothingFactor:    0.1,
		bandwidthSmoothingFactor:     0.1,
		packetHeaderSize:             28,

		time:      time,
		sendFn:    sendFn,
		receiveFn: receiveFn,
		ackFn:     ackFn,

		sentPackets:        NewSequenceBufferSent(256),
		receivedPackets:    NewSequenceBufferReceived(256),
		fragmentReassembly: NewSequenceBufferReassembly(64),
	}
}

func (r *ReliablePacketController) Update(time int64) {
	r.time = time

	r.calculatePacketLoss()
	r.calculateSentBandwidth()
	r.calculateReceivedBandwidth()
	r.calculateAckedBandwidth()
}

func (r *ReliablePacketController) SendAck(channelID byte) {
	ack, ackBits := r.receivedPackets.GenerateAckBits()
	// TODO pool.
	transmitData := make([]byte, 16)
	headerBytes := WriteAckPacket(transmitData, channelID, ack, ackBits)
	r.sendFn(transmitData, headerBytes)
}

func (r *ReliablePacketController) SendPacket(packetData []byte, length int, channelID byte) (uint16, error) {
	if length > r.maxPacketSize {
		return 0, ErrReliablePacketControllerPacketDataTooLarge
	}

	sequence := r.sequence
	r.sequence++
	ack, ackBits := r.receivedPackets.GenerateAckBits()
	sentPacketData := r.sentPackets.Insert(sequence)
	// TODO use current time from function call
	sentPacketData.time = r.time
	sentPacketData.packetBytes = uint32(r.packetHeaderSize + length)
	sentPacketData.acked = false
	if length <= r.fragmentThreshold {
		// Regular, non-fragmented packet.
		// TODO pool.
		transmitData := make([]byte, 2048)
		headerBytes := WritePacketHeader(transmitData, channelID, sequence, ack, ackBits)
		transmitBufferLength := length + headerBytes
		copy(transmitData[headerBytes:], packetData[:length])

		r.sendFn(transmitData, transmitBufferLength)
	} else {
		// Fragmented packet.
		packetHeader := make([]byte, MAX_PACKET_HEADER_BYTES)
		packetHeaderBytes := WritePacketHeader(packetHeader, channelID, sequence, ack, ackBits)

		numFragments := byte(length / r.fragmentSize)
		if (length % r.fragmentSize) != 0 {
			numFragments += 1
		}

		fragmentPacketData := make([]byte, 2048)
		qpos := 1

		prefixByte := byte(1)
		prefixByte |= (channelID & 0x03) << 6

		for fragmentID := byte(0); fragmentID < numFragments; fragmentID++ {
			rw := NewByteArrayReaderWriter(fragmentPacketData)
			rw.WriteByte(prefixByte)
			rw.WriteByte(channelID)
			rw.WriteUint16(sequence)
			rw.WriteByte(fragmentID)
			rw.WriteByte(numFragments - 1)
			if fragmentID == 0 {
				rw.WriteBuffer(packetHeader, packetHeaderBytes)
			}

			bytesToCopy := r.fragmentSize
			if qpos+bytesToCopy > length {
				bytesToCopy = length - qpos
			}
			for i := 0; i < bytesToCopy; i++ {
				rw.WriteByte(packetData[qpos])
				qpos++
			}

			fragmentPacketBytes := rw.writePosition
			r.sendFn(fragmentPacketData, fragmentPacketBytes)
		}
	}

	return sequence, nil
}

func (r *ReliablePacketController) ReceivePacket(packetData []byte, bufferLength int) error {
	if bufferLength > r.maxPacketSize {
		return ErrReliablePacketControllerPacketDataTooLarge
	}

	prefixByte := packetData[0]
	if prefixByte&1 == 0 {
		// Regular, non-fragmented packet.
		packetHeaderBytes, _, sequence, ack, ackBits, err := ReadPacketHeader(packetData, 0, bufferLength)
		if err != nil {
			return err
		}
		isStale := r.receivedPackets.TestInsert(sequence)
		// All stale packets are dropped.
		if !isStale && (prefixByte&0x80) == 0 {
			r.receiveFn(sequence, packetData[packetHeaderBytes:(packetHeaderBytes+bufferLength-packetHeaderBytes)], bufferLength-packetHeaderBytes)

			receivedPacketData := r.receivedPackets.Insert(sequence)
			// TODO use current time from function call
			receivedPacketData.time = r.time
			receivedPacketData.packetBytes = uint32(r.packetHeaderSize + bufferLength)
		}
		if !isStale || (prefixByte&0x80) != 0 {
			for i := uint16(0); i < 32; i++ {
				if (ackBits & 1) != 0 {
					ackSequence := ack - i
					sentPacketData := r.sentPackets.Find(ackSequence)
					if sentPacketData != nil && !sentPacketData.acked {
						sentPacketData.acked = true
						if r.ackFn != nil {
							r.ackFn(ackSequence)
						}
						// TODO use current time from function call
						rtt := float64((r.time - sentPacketData.time) * 1000)
						if (r.rtt == 0 && rtt > 0) || math.Abs(r.rtt-rtt) < 0.00001 {
							r.rtt = rtt
						} else {
							r.rtt += (rtt - r.rtt) * r.rttSmoothFactor
						}
					}
				}
				ackBits >>= 1
			}
		}
	} else {
		// Fragmented packet.
		fragmentHeaderBytes, fragmentID, numFragments, _, sequence, ack, ackBits, channelID, err := ReadFragmentHeader(packetData, 0, bufferLength, r.maxFragments, r.fragmentSize)
		if err != nil {
			return err
		}
		reassemblyData := r.fragmentReassembly.Find(sequence)
		if reassemblyData == nil {
			reassemblyData = r.fragmentReassembly.Insert(sequence)
			if reassemblyData == nil {
				// Insert fail indicates stale.
				return nil
			}
			reassemblyData.sequence = sequence
			reassemblyData.ack = 0
			reassemblyData.ackBits = 0
			reassemblyData.numFragmentsReceived = 0
			reassemblyData.numFragmentsTotal = numFragments
			reassemblyData.packetBytes = 0
		}
		if numFragments != reassemblyData.numFragmentsTotal {
			return nil
		}
		if reassemblyData.fragmentReceived[fragmentID] {
			return nil
		}
		reassemblyData.numFragmentsReceived++
		reassemblyData.fragmentReceived[fragmentID] = true

		// TODO not needed?
		tempFragmentData := make([]byte, 2048)
		copy(tempFragmentData, packetData[fragmentHeaderBytes:(fragmentHeaderBytes+bufferLength-fragmentHeaderBytes)])

		reassemblyData.StoreFragmentData(channelID, sequence, ack, ackBits, fragmentID, r.fragmentSize, tempFragmentData, bufferLength-fragmentHeaderBytes)

		if reassemblyData.numFragmentsReceived == reassemblyData.numFragmentsTotal {
			// TODO no need for another slice?
			length := len(reassemblyData.packetDataBuffer) - reassemblyData.headerOffset
			temp := make([]byte, length)
			copy(temp, reassemblyData.packetDataBuffer[reassemblyData.headerOffset:(reassemblyData.headerOffset+length)])

			// Pass it back to this same function as a non-fragmented packet.
			err := r.ReceivePacket(temp, length)
			if err != nil {
				return err
			}

			// TODO is clearing fragmentReassembly.packetDataBuffer necessary?
			reassemblyData.packetDataBuffer = nil
			r.fragmentReassembly.Remove(sequence)
		}
	}

	return nil
}

func (r *ReliablePacketController) calculatePacketLoss() {
	baseSequence := (r.sentPackets.sequence - r.sentPacketBufferSize + 1) + 0xFFFF
	numDropped := 0
	numSamples := r.sentPacketBufferSize / 2
	for i := uint16(0); i < numSamples; i++ {
		sequence := baseSequence + i
		sentPacketData := r.sentPackets.Find(sequence)
		if sentPacketData != nil && !sentPacketData.acked {
			numDropped++
		}
	}
	packetLoss := float64(numDropped) / float64(numSamples)
	if math.Abs(r.packetLoss-packetLoss) > 0.00001 {
		r.packetLoss += (packetLoss - r.packetLoss) * r.packetLossSmoothingFactor
	} else {
		r.packetLoss = packetLoss
	}
}

func (r *ReliablePacketController) calculateSentBandwidth() {
	baseSequence := (r.sentPackets.sequence - r.sentPacketBufferSize + 1) + 0xFFFF
	bytesSent := uint32(0)
	startTime := int64(math.MaxInt64)
	finishTime := int64(0)
	numSamples := r.sentPacketBufferSize / 2

	for i := uint16(0); i < numSamples; i++ {
		sequence := baseSequence + i
		sentPacketData := r.sentPackets.Find(sequence)
		if sentPacketData == nil {
			continue
		}

		bytesSent += sentPacketData.packetBytes
		if startTime > sentPacketData.time {
			startTime = sentPacketData.time
		}
		if finishTime < sentPacketData.time {
			finishTime = sentPacketData.time
		}
	}

	if startTime != int64(math.MaxInt64) && finishTime != 0 {
		sentBandwidth := float64(bytesSent) / float64(finishTime-startTime) * 8 / 1000
		if math.Abs(r.sentBandwidthKBPS-sentBandwidth) > 0.00001 {
			r.sentBandwidthKBPS += (sentBandwidth - r.sentBandwidthKBPS) * r.bandwidthSmoothingFactor
		} else {
			r.sentBandwidthKBPS = sentBandwidth
		}
	}
}

func (r *ReliablePacketController) calculateReceivedBandwidth() {
	baseSequence := (r.receivedPackets.sequence - r.receivedPacketBufferSize + 1) + 0xFFFF
	bytesReceived := uint32(0)
	startTime := int64(math.MaxInt64)
	finishTime := int64(0)
	numSamples := r.receivedPacketBufferSize / 2

	for i := uint16(0); i < numSamples; i++ {
		sequence := baseSequence + i
		receivedPacketData := r.receivedPackets.Find(sequence)
		if receivedPacketData == nil {
			continue
		}

		bytesReceived += receivedPacketData.packetBytes
		if startTime > receivedPacketData.time {
			startTime = receivedPacketData.time
		}
		if finishTime < receivedPacketData.time {
			finishTime = receivedPacketData.time
		}
	}

	if startTime != int64(math.MaxInt64) && finishTime != 0 {
		receivedBandwidth := float64(bytesReceived) / float64(finishTime-startTime) * 8 / 1000
		if math.Abs(r.receivedBandwidthKBPS-receivedBandwidth) > 0.00001 {
			r.receivedBandwidthKBPS += (receivedBandwidth - r.receivedBandwidthKBPS) * r.bandwidthSmoothingFactor
		} else {
			r.receivedBandwidthKBPS = receivedBandwidth
		}
	}
}

func (r *ReliablePacketController) calculateAckedBandwidth() {
	baseSequence := (r.sentPackets.sequence - r.sentPacketBufferSize + 1) + 0xFFFF
	bytesSent := uint32(0)
	startTime := int64(math.MaxInt64)
	finishTime := int64(0)
	numSamples := r.sentPacketBufferSize / 2

	for i := uint16(0); i < numSamples; i++ {
		sequence := baseSequence + i
		sentPacketData := r.sentPackets.Find(sequence)
		if sentPacketData == nil || sentPacketData.acked == false {
			continue
		}

		bytesSent += sentPacketData.packetBytes
		if startTime > sentPacketData.time {
			startTime = sentPacketData.time
		}
		if finishTime < sentPacketData.time {
			finishTime = sentPacketData.time
		}
	}

	if startTime != int64(math.MaxInt64) && finishTime != 0 {
		ackedBandwidth := float64(bytesSent) / float64(finishTime-startTime) * 8 / 1000
		if math.Abs(r.ackedBandwidthKBPS-ackedBandwidth) > 0.00001 {
			r.ackedBandwidthKBPS += (ackedBandwidth - r.ackedBandwidthKBPS) * r.bandwidthSmoothingFactor
		} else {
			r.ackedBandwidthKBPS = ackedBandwidth
		}
	}
}
