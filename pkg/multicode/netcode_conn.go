package multicode

import (
	"github.com/wirepair/netcode"
	"go.uber.org/zap"
	"net"
)

type NetcodeData struct {
	data []byte
	from *net.UDPAddr
}

type NetcodeRecvHandler func(data *NetcodeData)

type NetcodeConn struct {
	logger   *zap.Logger
	conn     *net.UDPConn
	closeCh  chan bool
	isClosed bool

	recvSize int
	sendSize int
	maxBytes int

	// Must NOT be a blocking call.
	recvHandlerFn NetcodeRecvHandler
}

func NewNetcodeConn(logger *zap.Logger, recvSize int, sendSize int, recvHandlerFn NetcodeRecvHandler) *NetcodeConn {
	return &NetcodeConn{
		logger: logger,
		// conn is set in Dial()
		closeCh:       make(chan bool),
		isClosed:      true,
		maxBytes:      netcode.MAX_PACKET_BYTES,
		recvSize:      recvSize,
		sendSize:      sendSize,
		recvHandlerFn: recvHandlerFn,
	}
}

func (c *NetcodeConn) Write(b []byte) (int, error) {
	if c.isClosed {
		return -1, netcode.ErrWriteClosedSocket
	}
	return c.conn.Write(b)
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

// LocalAddr returns the local network address.
func (c *NetcodeConn) LocalAddr() net.Addr {
	return c.conn.LocalAddr()
}

// RemoteAddr returns the remote network address.
func (c *NetcodeConn) RemoteAddr() net.Addr {
	return c.conn.RemoteAddr()
}

func (c *NetcodeConn) Dial(address *net.UDPAddr) error {
	var err error

	if c.recvHandlerFn == nil {
		return netcode.ErrPacketHandlerBeforeListen
	}

	c.closeCh = make(chan bool)
	c.conn, err = net.DialUDP(address.Network(), nil, address)
	if err != nil {
		return err
	}
	return c.create()
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
		c.logger.Info("INCOMING PACKET! ConnectionRequest")
		break
	case netcode.ConnectionDenied:
		c.logger.Info("INCOMING PACKET! ConnectionDenied")
		break
	case netcode.ConnectionChallenge:
		c.logger.Info("INCOMING PACKET! ConnectionChallenge")
		break
	case netcode.ConnectionResponse:
		c.logger.Info("INCOMING PACKET! ConnectionResponse")
		break
	case netcode.ConnectionKeepAlive:
		c.logger.Info("INCOMING PACKET! ConnectionKeepAlive")
		break
	case netcode.ConnectionPayload:
		c.logger.Info("INCOMING PACKET! ConnectionPayload")
		break
	case netcode.ConnectionDisconnect:
		c.logger.Info("INCOMING PACKET! ConnectionDisconnect")
		break
	default:
		return netcode.ErrInvalidPacket
	}

	netData.data = netData.data[:n]
	netData.from = from
	c.recvHandlerFn(netData)
	return nil
}
