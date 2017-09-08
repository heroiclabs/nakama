package netcode

import (
	"go.uber.org/zap"
	"net"
)

type AwesomeNetcodeConn struct {
	logger   *zap.Logger
	conn     *net.UDPConn
	closeCh  chan struct{}
	isClosed bool

	recvSize int
	sendSize int
	maxBytes int

	recvHandlerFn NetcodeRecvHandler
}

func NewAwesomeNetcodeConn(logger *zap.Logger) *AwesomeNetcodeConn {
	c := &AwesomeNetcodeConn{
		logger: logger,
	}

	c.closeCh = make(chan struct{})
	c.isClosed = true
	c.maxBytes = MAX_PACKET_BYTES
	c.recvSize = SOCKET_RCVBUF_SIZE
	c.sendSize = SOCKET_SNDBUF_SIZE
	return c
}

func (c *AwesomeNetcodeConn) SetRecvHandler(recvHandlerFn NetcodeRecvHandler) {
	c.recvHandlerFn = recvHandlerFn
}

func (c *AwesomeNetcodeConn) Write(b []byte) (int, error) {
	if c.isClosed {
		return -1, ErrWriteClosedSocket
	}
	return c.conn.Write(b)
}

func (c *AwesomeNetcodeConn) WriteTo(b []byte, to *net.UDPAddr) (int, error) {
	if c.isClosed {
		return -1, ErrWriteClosedSocket
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
		return ErrPacketHandlerBeforeListen
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
		return ErrPacketHandlerBeforeListen
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
	go c.readLoop()
	return nil
}

func (c *AwesomeNetcodeConn) receiver(ch chan *NetcodeData) {
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
	netData := &NetcodeData{}
	netData.data = make([]byte, c.maxBytes)

	n, from, err = c.conn.ReadFromUDP(netData.data)
	if err != nil {
		return err
	}

	if n == 0 {
		return ErrSocketZeroRecv
	}

	if n > c.maxBytes {
		return ErrPacketSizeMax
	}

	// check if it's a valid packet
	if NewPacket(netData.data) == nil {
		return ErrInvalidPacket
	}

	netData.data = netData.data[:n]
	netData.from = from
	c.recvHandlerFn(netData)
	return nil
}

// dispatch the NetcodeData to the bound recvHandler function.
func (c *AwesomeNetcodeConn) readLoop() {
	dataCh := make(chan *NetcodeData)
	go c.receiver(dataCh)
}
