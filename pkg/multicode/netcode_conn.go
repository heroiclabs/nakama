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
	"net"

	"github.com/wirepair/netcode"
	"go.uber.org/zap"
)

type NetcodeData struct {
	data []byte
	from *net.UDPAddr
}

type NetcodeConn struct {
	logger   *zap.Logger
	conn     *net.UDPConn
	closeCh  chan bool
	isClosed bool

	recvSize int
	sendSize int
	maxBytes int

	// Must NOT be a blocking call.
	recvHandlerFn func(data *NetcodeData)
}

func NewNetcodeConn(logger *zap.Logger, recvSize int, sendSize int, recvHandlerFn func(data *NetcodeData)) *NetcodeConn {
	return &NetcodeConn{
		logger: logger,
		// conn is set in Listen()
		closeCh:       make(chan bool),
		isClosed:      true,
		maxBytes:      netcode.MAX_PACKET_BYTES,
		recvSize:      recvSize,
		sendSize:      sendSize,
		recvHandlerFn: recvHandlerFn,
	}
}

func (c *NetcodeConn) WriteTo(b []byte, to *net.UDPAddr) (int, error) {
	if c.isClosed {
		return -1, netcode.ErrWriteClosedSocket
	}
	return c.conn.WriteTo(b, to)
}

func (c *NetcodeConn) Close() error {
	if !c.isClosed {
		close(c.closeCh)
	}
	c.isClosed = true

	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

func (c *NetcodeConn) Listen(address *net.UDPAddr) error {
	var err error

	if c.recvHandlerFn == nil {
		return netcode.ErrPacketHandlerBeforeListen
	}

	c.conn, err = net.ListenUDP(address.Network(), address)
	if err != nil {
		return err
	}

	c.create()
	return err
}

func (c *NetcodeConn) create() error {
	c.isClosed = false
	c.conn.SetReadBuffer(c.recvSize)
	c.conn.SetWriteBuffer(c.sendSize)
	go c.receiverLoop()
	return nil
}

func (c *NetcodeConn) receiverLoop() {
	for {

		if err := c.read(); err == nil {
			select {
			case <-c.closeCh:
				return
			default:
				continue
			}
		} else {
			if c.isClosed {
				return
			}
			c.logger.Error("error reading data from socket", zap.Error(err))
		}

	}
}

// read does the actual connection read call, verifies we have a
// buffer > 0 and < maxBytes and is of a valid packet type before
// we bother to attempt to actually dispatch it to the recvHandlerFn.
func (c *NetcodeConn) read() error {
	var n int
	var from *net.UDPAddr
	var err error
	netData := &NetcodeData{
		data: make([]byte, c.maxBytes),
	}

	n, from, err = c.conn.ReadFromUDP(netData.data)
	if err != nil {
		return err
	}

	if n == 0 {
		return netcode.ErrSocketZeroRecv
	}

	if n > c.maxBytes {
		return netcode.ErrPacketSizeMax
	}

	// check if it's a valid packet
	// Some repetition here but avoids allocating a packet struct until needed.
	var packetType netcode.PacketType
	switch packetType.Peek(netData.data) {
	case netcode.ConnectionRequest:
		break
	case netcode.ConnectionDenied:
		break
	case netcode.ConnectionChallenge:
		break
	case netcode.ConnectionResponse:
		break
	case netcode.ConnectionKeepAlive:
		break
	case netcode.ConnectionPayload:
		break
	case netcode.ConnectionDisconnect:
		break
	default:
		return netcode.ErrInvalidPacket
	}

	netData.data = netData.data[:n]
	netData.from = from
	c.recvHandlerFn(netData)
	return nil
}
