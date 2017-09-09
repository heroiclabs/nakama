package multicode

import (
	"github.com/wirepair/netcode"
	"go.uber.org/zap"
	"net"
)

type AwesomeNetcodeData struct {
	data []byte
	from *net.UDPAddr
}

type AwesomeNetcodeRecvHandler func(data *AwesomeNetcodeData)

type AwesomeNetcodeConn struct {
	logger   *zap.Logger
	conn     *net.UDPConn
	closeCh  chan bool
	isClosed bool

	recvSize int
	sendSize int
	maxBytes int

	// Must NOT be a blocking call.
	recvHandlerFn AwesomeNetcodeRecvHandler
}

func NewAwesomeNetcodeConn(logger *zap.Logger, recvSize int, sendSize int, recvHandlerFn AwesomeNetcodeRecvHandler) *AwesomeNetcodeConn {
	return &AwesomeNetcodeConn{
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

func (c *AwesomeNetcodeConn) Write(b []byte) (int, error) {
	if c.isClosed {
		return -1, netcode.ErrWriteClosedSocket
	}
	return c.conn.Write(b)
}

func (c *AwesomeNetcodeConn) WriteTo(b []byte, to *net.UDPAddr) (int, error) {
	if c.isClosed {
		return -1, netcode.ErrWriteClosedSocket
	}
	return c.conn.WriteTo(b, to)
}

func (c *AwesomeNetcodeConn) Close() error {
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
func (c *AwesomeNetcodeConn) LocalAddr() net.Addr {
	return c.conn.LocalAddr()
}

// RemoteAddr returns the remote network address.
func (c *AwesomeNetcodeConn) RemoteAddr() net.Addr {
	return c.conn.RemoteAddr()
}

func (c *AwesomeNetcodeConn) Dial(address *net.UDPAddr) error {
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

func (c *AwesomeNetcodeConn) Listen(address *net.UDPAddr) error {
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

func (c *AwesomeNetcodeConn) create() error {
	c.isClosed = false
	c.conn.SetReadBuffer(c.recvSize)
	c.conn.SetWriteBuffer(c.sendSize)
	go c.receiverLoop()
	return nil
}

func (c *AwesomeNetcodeConn) receiverLoop() {
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
func (c *AwesomeNetcodeConn) read() error {
	var n int
	var from *net.UDPAddr
	var err error
	netData := &AwesomeNetcodeData{
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
