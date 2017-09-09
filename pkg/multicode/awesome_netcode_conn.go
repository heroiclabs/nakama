package multicode

import (
	"go.uber.org/zap"
	"net"
	"github.com/wirepair/netcode"
)

type AwesomeNetcodeData struct {
	data []byte
	from *net.UDPAddr
}

type AwesomeNetcodeRecvHandler func(data *AwesomeNetcodeData)

type AwesomeNetcodeConn struct {
	logger   *zap.Logger
	conn     *net.UDPConn
	closeCh  chan struct{}
	isClosed bool

	recvSize int
	sendSize int
	maxBytes int

	// Must NOT be a blocking call.
	recvHandlerFn AwesomeNetcodeRecvHandler
}

func NewAwesomeNetcodeConn(logger *zap.Logger) *AwesomeNetcodeConn {
	c := &AwesomeNetcodeConn{
		logger: logger,
	}

	c.closeCh = make(chan struct{})
	c.isClosed = true
	c.maxBytes = netcode.MAX_PACKET_BYTES
	c.recvSize = netcode.SOCKET_RCVBUF_SIZE
	c.sendSize = netcode.SOCKET_SNDBUF_SIZE
	return c
}

func (c *AwesomeNetcodeConn) SetRecvHandler(recvHandlerFn AwesomeNetcodeRecvHandler) {
	c.recvHandlerFn = recvHandlerFn
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

func (c *AwesomeNetcodeConn) SetReadBuffer(bytes int) {
	c.recvSize = bytes
}

func (c *AwesomeNetcodeConn) SetWriteBuffer(bytes int) {
	c.sendSize = bytes
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

	c.closeCh = make(chan struct{})
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
	netData := &AwesomeNetcodeData{}
	netData.data = make([]byte, c.maxBytes)

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
