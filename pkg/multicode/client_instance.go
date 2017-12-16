// BSD 3-Clause License
//
// Copyright (c) 2017, Isaac Dawson
// Copyright (c) 2017, The Nakama Authors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// * Redistributions of source code must retain the above copyright notice, this
// list of conditions and the following disclaimer.
//
// * Redistributions in binary form must reproduce the above copyright notice,
// this list of conditions and the following disclaimer in the documentation
// and/or other materials provided with the distribution.
//
// * Neither the name of the copyright holder nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
// FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

package multicode

import (
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/wirepair/netcode"
	"go.uber.org/zap"
)

const (
	KEEP_ALIVE_RESOLUTION = 4
	RELIABLE_CHANNEL_ID   = byte(0)
	UNRELIABLE_CHANNEL_ID = byte(1)
)

var ErrClientInstanceClosed = errors.New("client instance closed")
var ErrClientInstanceUnreliableDataTooLarge = errors.New("client instance unreliable data too large")
var ErrClientInstanceNotConnected = errors.New("client instance not connected")
var ErrClientInstanceSendBufferFull = errors.New("client instance reliable send buffer full")

type ClientInstance struct {
	sync.Mutex
	logger  *zap.Logger
	Address *net.UDPAddr

	serverConn    *NetcodeConn
	closeClientFn func(*ClientInstance, bool)
	confirmed     bool
	connected     bool

	timeoutMs int64
	sendKey   []byte
	recvKey   []byte

	shutdownCh chan bool
	stopped    bool

	sequence uint64
	lastSend int64
	lastRecv int64

	ExpiresAt  int64
	UserData   []byte
	ProtocolId uint64

	replayProtection   *netcode.ReplayProtection
	incomingPacketCh   chan netcode.Packet
	outgoingPacketData []byte

	// Unreliable channel.
	unreliableController    *ReliablePacketController
	unreliableReceiveBuffer *SequenceBufferReceived

	// Reliable channel.
	reliableCh            chan []byte
	reliableController    *ReliablePacketController
	reliablePacker        []byte
	reliablePackerLength  int
	reliablePackerSeq     []uint16
	reliableSendBuffer    *SequenceBufferPacket
	reliableReceiveBuffer *SequenceBufferPacket
	reliableAckBuffer     *SequenceBufferOutgoing
	reliableOldestUnacked uint16
	reliableSequence      uint16
	reliableNextReceive   uint16
}

func NewClientInstance(logger *zap.Logger, addr *net.UDPAddr, serverConn *NetcodeConn, closeClientFn func(*ClientInstance, bool), expiry uint64, protocolId uint64, timeoutMs int64, sendKey []byte, recvKey []byte, maxPacketSize int, maxPacketFragments int) *ClientInstance {
	c := &ClientInstance{
		logger:        logger,
		Address:       addr,
		serverConn:    serverConn,
		closeClientFn: closeClientFn,
		confirmed:     false,
		connected:     false,

		timeoutMs: timeoutMs,
		sendKey:   make([]byte, netcode.KEY_BYTES),
		recvKey:   make([]byte, netcode.KEY_BYTES),

		shutdownCh: make(chan bool),
		stopped:    false,

		sequence: 0,
		lastSend: 0,
		// Assume client instances are created off the back of an incoming connection request.
		// Setting a real value here avoids the expiry check routine from instantly killing
		// the client before the challenge and response handshake is even complete.
		lastRecv: nowMs(),

		ExpiresAt:  int64(expiry),
		UserData:   make([]byte, netcode.USER_DATA_BYTES),
		ProtocolId: protocolId,

		replayProtection:   netcode.NewReplayProtection(),
		incomingPacketCh:   make(chan netcode.Packet, netcode.PACKET_QUEUE_SIZE),
		outgoingPacketData: make([]byte, netcode.MAX_PACKET_BYTES),

		unreliableController:    NewReliablePacketController(1024, 1),
		unreliableReceiveBuffer: NewSequenceBufferReceived(256),

		reliableCh:            make(chan []byte, netcode.PACKET_QUEUE_SIZE),
		reliableController:    NewReliablePacketController(maxPacketSize, maxPacketFragments),
		reliablePacker:        nil,
		reliablePackerLength:  0,
		reliablePackerSeq:     make([]uint16, 0),
		reliableSendBuffer:    NewSequenceBufferPacket(256),
		reliableReceiveBuffer: NewSequenceBufferPacket(256),
		reliableAckBuffer:     NewSequenceBufferOutgoing(256),
		reliableOldestUnacked: 0,
		reliableSequence:      0,
		reliableNextReceive:   0,
	}

	copy(c.sendKey, sendKey)
	copy(c.recvKey, recvKey)

	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()

		// Send keep alive packets.
		// Enforce expiry.
		// Resend reliable data.
		for {
			select {
			case <-ticker.C:
				c.Lock()
				if c.stopped {
					c.Unlock()
					return
				}
				ts := nowMs()

				// Check if we've not seen a message from client in too long.
				// Expiry is checked regardless of c.connected to handle clients that request connection but never
				// respond to challenge to complete handshake.
				if c.lastRecv < ts-c.timeoutMs {
					// Only send disconnects if client was fully connected.
					sendDisconnect := c.connected
					c.Unlock()
					c.Close(sendDisconnect)
					return
				}

				// Check if we need to send a keep alive to client.
				// Keep alive packets will be sent up to KEEP_ALIVE_RESOLUTION times during the timeout window, if needed.
				if c.connected && c.lastSend <= ts-(c.timeoutMs/KEEP_ALIVE_RESOLUTION) {
					c.sendKeepAlive()
				}

				// If we're connected resend any reliable messages that have not been acked yet.
				if c.connected {
					for seq := c.reliableOldestUnacked; SequenceLessThan(seq, c.reliableSequence); seq++ {
						// Never send messages with sequence >= oldest unacked + buffer size.
						if seq >= c.reliableOldestUnacked+256 {
							break
						}
						p := c.reliableSendBuffer.Find(seq)
						if p != nil && !p.writeLock {
							// Do not resend the same packet more than once per 100ms.
							if ts-p.time < 100 {
								continue
							}

							packetFits := false
							if p.length < c.reliableController.fragmentThreshold {
								packetFits = c.reliablePackerLength+p.length <= c.reliableController.fragmentThreshold-MAX_PACKET_HEADER_BYTES
							} else {
								packetFits = c.reliablePackerLength+p.length <= c.reliableController.maxPacketSize-FRAGMENT_HEADER_BYTES-MAX_PACKET_HEADER_BYTES
							}

							if !packetFits {
								c.flushReliablePacker(ts)
							}

							p.time = ts
							if c.reliablePacker == nil {
								c.reliablePacker = make([]byte, p.length)
								c.reliablePackerLength = p.length
								copy(c.reliablePacker, p.buffer[:p.length])
							} else {
								c.reliablePacker = append(c.reliablePacker[:c.reliablePackerLength], p.buffer[:p.length]...)
								c.reliablePackerLength += p.length
							}
							c.reliablePackerSeq = append(c.reliablePackerSeq, seq)
						}
					}

					c.flushReliablePacker(ts)
				}

				c.Unlock()
			case <-c.shutdownCh:
				return
			}
		}
	}()

	return c
}

func (c *ClientInstance) IsConnected() bool {
	c.Lock()
	defer c.Unlock()
	return c.connected
}

// An external routine is expected to continuously call this, otherwise
// no input attributed to this client instance will be processed.
func (c *ClientInstance) Read() ([]byte, bool, error) {
readLoop:
	for {
		select {
		case reliableData := <-c.reliableCh:
			return reliableData, true, nil
		case packet := <-c.incomingPacketCh:
			if packet == nil {
				return nil, false, ErrClientInstanceClosed
			}
			switch packet.GetType() {
			case netcode.ConnectionKeepAlive:
				c.Lock()
				if c.stopped {
					c.Unlock()
					return nil, false, ErrClientInstanceClosed
				}
				if !c.confirmed {
					c.logger.Debug("server confirmed connection to client", zap.String("addr", c.Address.String()))
					c.confirmed = true
				}
				c.lastRecv = nowMs()
				c.Unlock()
				continue
			case netcode.ConnectionPayload:
				ts := nowMs()

				// General client instance maintenance.
				c.Lock()
				if c.stopped {
					c.Unlock()
					return nil, false, ErrClientInstanceClosed
				}
				if !c.confirmed {
					c.logger.Debug("server confirmed connection to client", zap.String("addr", c.Address.String()))
					c.confirmed = true
				}
				c.lastRecv = ts

				// Check we have a valid payload packet.
				p, ok := packet.(*netcode.PayloadPacket)
				if !ok {
					c.Unlock()
					// Should not happen, already checked the type.
					// If it does then silently discard the packet and keep waiting.
					c.logger.Debug("not a payload packet")
					continue
				}

				// Process through the correct channel.
				channelID := p.PayloadData[1]
				if channelID == RELIABLE_CHANNEL_ID {
					// Reliable.
					// Sequence unused here, the controller will drop anything with an unexpected sequence.
					_, data, length, ackSequences, err := c.reliableController.ReceivePacket(ts, p.PayloadData, len(p.PayloadData))
					if err != nil {
						c.Unlock()
						c.logger.Debug("error processing reliable packet", zap.Error(err))
						continue
					}

					// Process possible received acks.
					if ackSequences != nil {
						for _, ackSequence := range ackSequences {
							outgoing := c.reliableAckBuffer.Find(ackSequence)
							if outgoing == nil {
								// This sequence ID is already acked.
								continue
							}

							for _, outgoingSequence := range outgoing.messageIDs {
								if c.reliableSendBuffer.Exists(outgoingSequence) {
									c.reliableSendBuffer.Find(outgoingSequence).writeLock = true
									c.reliableSendBuffer.Remove(outgoingSequence)
								}
							}

							allAcked := true
							for seq := uint16(c.reliableOldestUnacked); seq == c.reliableSequence || SequenceLessThan(seq, c.reliableSequence); seq++ {
								// If it's still in send buffer, it hasn't been acked yet.
								if c.reliableSendBuffer.Exists(seq) {
									c.reliableOldestUnacked = seq
									allAcked = false
									break
								}
							}
							if allAcked {
								c.reliableOldestUnacked = c.reliableSequence
							}
						}
					}

					// Process possible reassembled data.
					if data != nil {
						rw := NewByteArrayReaderWriter(data)
						for rw.readPosition < length {
							messageID, err := rw.ReadUint16()
							if err != nil {
								c.Unlock()
								c.logger.Debug("error processing reliable packet message ID", zap.Error(err))
								continue readLoop
							}
							messageLengthUint16, err := ReadVariableLengthUint16(rw)
							if err != nil {
								c.Unlock()
								c.logger.Debug("error processing reliable packet message length", zap.Error(err))
								continue readLoop
							}
							if messageLengthUint16 == 0 {
								c.Unlock()
								continue readLoop
							}

							messageLength := int(messageLengthUint16)
							if !c.reliableReceiveBuffer.Exists(messageID) {
								receivedMessage := c.reliableReceiveBuffer.Insert(messageID)
								receivedMessage.Resize(messageLength)
								err := rw.ReadBuffer(receivedMessage.buffer, messageLength)
								if err != nil {
									c.Unlock()
									c.logger.Debug("error processing reliable packet read buffer", zap.Error(err))
									continue readLoop
								}
							} else {
								rw.SeekRead(rw.readPosition + messageLength)
							}

							// Process the receive buffer as far as possible.
							// If the message just received was out of order then there may be some number of 'newer' messages
							// ready to be handed off to the application in order.
							for c.reliableReceiveBuffer.Exists(c.reliableNextReceive) {
								msg := c.reliableReceiveBuffer.Find(c.reliableNextReceive)
								c.reliableCh <- msg.buffer[:msg.length]
								c.reliableReceiveBuffer.Remove(c.reliableNextReceive)
								c.reliableNextReceive++
							}
						}
					}

					c.Unlock()
					continue
				} else if channelID == UNRELIABLE_CHANNEL_ID {
					// Unreliable.
					// Unreliable packets are not expected to generate ack sequences, so ignore that return value.
					sequence, data, length, _, err := c.unreliableController.ReceivePacket(ts, p.PayloadData, len(p.PayloadData))
					if err != nil {
						c.Unlock()
						c.logger.Debug("error processing unreliable packet", zap.Error(err))
						continue
					}
					if data != nil {
						// A packet is ready to be processed, ie. either arrived complete or has finished reassembly.
						if !c.unreliableReceiveBuffer.Exists(sequence) {
							// If it wasn't a stale packet, deliver to the reader.
							c.unreliableReceiveBuffer.Insert(sequence)
							c.Unlock()
							return data[:length], false, nil
						}
						c.Unlock()
						continue
					}
				}

				// Other channel IDs not supported.
				c.Unlock()
				c.logger.Debug("server received payload with unknown channelID")
				continue
				//return p.PayloadData, nil
			default:
				// Silently discard any other packets and keep waiting.
				// The server should not have sent any other types down the channel but handle it just in case.
				c.logger.Debug("not a keep alive or payload packet")
				continue
			}
		case <-c.shutdownCh:
			return nil, false, ErrClientInstanceClosed
		}
	}
}

// NOTE: Only for payload data packets, other protocol-level messages MUST be sent through other functions.
func (c *ClientInstance) Send(payloadData []byte, reliable bool) error {
	if !reliable && len(payloadData) > FRAGMENT_SIZE {
		c.logger.Warn("server attempting to send unreliable packet data exceeding unreliable max length, dropping packet")
		return ErrClientInstanceUnreliableDataTooLarge
	}

	c.Lock()
	if c.stopped || !c.connected {
		c.Unlock()
		return ErrClientInstanceNotConnected
	}

	var sequence uint16
	var fragments [][]byte
	var fragmentLengths []int
	var err error
	if reliable {
		// Reliable.
		sendBufferSize := uint16(0)
		for seq := c.reliableOldestUnacked; SequenceLessThan(seq, c.reliableSequence); seq++ {
			if c.reliableSendBuffer.Exists(seq) {
				sendBufferSize++
			}
		}
		if sendBufferSize == c.reliableSendBuffer.numEntries {
			// TODO alternatively schedule packets to be sent later?
			c.Unlock()
			return ErrClientInstanceSendBufferFull
		}

		sequence = c.reliableSequence
		c.reliableSequence++

		p := c.reliableSendBuffer.Insert(sequence)
		p.time = -1
		// Allow space for header.
		payloadLength := len(payloadData)
		varLength, err := GetVariableLengthBytes(uint16(payloadLength))
		if err != nil {
			c.Unlock()
			return err
		}
		p.Resize(payloadLength + 2 + varLength)
		rw := NewByteArrayReaderWriter(p.buffer)
		rw.WriteUint16(sequence)
		err = WriteVariableLengthUint16(uint16(payloadLength), rw)
		if err != nil {
			c.Unlock()
			return err
		}
		rw.WriteBuffer(payloadData, payloadLength)
		p.writeLock = false

		// TODO send immediately.
	} else {
		// Unreliable.
		sequence, fragments, fragmentLengths, err = c.unreliableController.SendPacket(nowMs(), payloadData, len(payloadData), byte(1))
	}
	if err != nil {
		c.Unlock()
		return err
	}

	// Per spec all packets sent to unconfirmed clients are preceded by keep alive packets.
	if !c.confirmed {
		c.sendKeepAlive()
	}

	for i := 0; i < len(fragments); i++ {
		packet := netcode.NewPayloadPacket(fragments[i][:fragmentLengths[i]])
		err := c.sendPacket(packet)
		if err != nil {
			c.Unlock()
			return err
		}
	}

	c.Unlock()
	return nil
}

func (c *ClientInstance) Close(sendDisconnect bool) {
	// Hand off close control to server, so it can lock around the actual close and dropping the client from address map.
	c.closeClientFn(c, sendDisconnect)
}

func (c *ClientInstance) close(sendDisconnect bool) {
	c.Lock()
	if c.stopped {
		c.Unlock()
		return
	}
	c.stopped = true

	if sendDisconnect && c.connected {
		packet := &netcode.DisconnectPacket{}
		for i := 0; i < netcode.NUM_DISCONNECT_PACKETS; i += 1 {
			c.sendPacket(packet)
		}
	}

	c.connected = false
	c.Unlock()

	// Do not close this, to avoid excessive locking we don't check the status of some channels before writing.
	// Leave it for GC to clean up.
	// close(c.incomingPacketCh)
	// close(c.reliableCh)
	close(c.shutdownCh)
}

// Returns true if this is a new connection, false otherwise.
// This allows handling of duplicate connection challenge responses.
func (c *ClientInstance) connect(userData *netcode.Buffer) bool {
	c.Lock()
	if c.stopped || c.connected {
		c.Unlock()
		return false
	}
	c.connected = true
	copy(c.UserData, userData.Bytes())
	c.sendKeepAlive()
	c.Unlock()
	return true
}

func (c *ClientInstance) sendKeepAlive() {
	packet := &netcode.KeepAlivePacket{
		ClientIndex: uint32(0),
		MaxClients:  uint32(2),
	}

	if err := c.sendPacket(packet); err != nil {
		c.logger.Error("error sending keep alive", zap.Error(err))
	}
}

func (c *ClientInstance) sendPacket(packet netcode.Packet) error {
	var bytesWritten int
	var err error

	if bytesWritten, err = packet.Write(c.outgoingPacketData, c.ProtocolId, c.sequence, c.sendKey); err != nil {
		return fmt.Errorf("error: unable to write packet: %s", err)
	}

	if _, err := c.serverConn.WriteTo(c.outgoingPacketData[:bytesWritten], c.Address); err != nil {
		c.logger.Error("error writing to client", zap.Error(err))
	}

	c.sequence++
	c.lastSend = nowMs()
	return nil
}

func nowMs() int64 {
	return int64(time.Nanosecond) * time.Now().UTC().UnixNano() / int64(time.Millisecond)
}

func (c *ClientInstance) flushReliablePacker(ts int64) {
	// Expects to be called inside a lock.
	if c.reliablePackerLength > 0 {
		seq, fragments, fragmentLengths, err := c.reliableController.SendPacket(ts, c.reliablePacker, c.reliablePackerLength, RELIABLE_CHANNEL_ID)
		if err != nil {
			c.logger.Debug("error flushing reliable packer", zap.Error(err))
			return
		}

		p := c.reliableAckBuffer.Insert(seq)
		p.messageIDs = c.reliablePackerSeq
		c.reliablePackerSeq = make([]uint16, 0)

		c.reliablePackerLength = 0

		for i := 0; i < len(fragments); i++ {
			packet := netcode.NewPayloadPacket(fragments[i][:fragmentLengths[i]])
			err := c.sendPacket(packet)
			if err != nil {
				c.logger.Debug("error flushing reliable packer data to network")
				return
			}
		}
	} else {
		// If no outgoing packets, ensure at least an empty ack message is sent.
		data, length := c.reliableController.SendAck(RELIABLE_CHANNEL_ID)
		packet := netcode.NewPayloadPacket(data[:length])
		err := c.sendPacket(packet)
		if err != nil {
			c.logger.Debug("error flushing reliable packer ack to network")
			return
		}
	}
}
