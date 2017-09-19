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

type ReceivedPacketData struct {
	time        int64
	packetBytes uint32
}

type SequenceBufferReceived struct {
	sequence      uint16
	numEntries    uint16
	entrySequence []uint16
	entryData     []*ReceivedPacketData
}

func NewSequenceBufferReceived(bufferSize int) *SequenceBufferReceived {
	s := &SequenceBufferReceived{
		sequence:      0,
		numEntries:    uint16(bufferSize),
		entrySequence: make([]uint16, bufferSize),
		entryData:     make([]*ReceivedPacketData, bufferSize),
	}
	for i := 0; i < bufferSize; i++ {
		s.entrySequence[i] = NULL_SEQUENCE
		s.entryData[i] = &ReceivedPacketData{}
	}
	return s
}
