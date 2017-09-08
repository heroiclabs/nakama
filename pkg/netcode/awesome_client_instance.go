package netcode

import (
	"fmt"
	"go.uber.org/zap"
	"io"
	"net"
	"sync"
)

type AwesomeClientInstance struct {
	sync.Mutex
	logger  *zap.Logger
	Address *net.UDPAddr

	serverConn *AwesomeNetcodeConn
	confirmed  bool
	connected  bool

	//encryption *encryptionEntry
	//expireTime float64
	//lastAccess float64
	//timeout    int

	sendKey []byte
	recvKey []byte

	shutdownCh chan (bool)
	stopped    bool

	sequence uint64

	userData   []byte
	protocolId uint64

	replayProtection *ReplayProtection
	packetCh         chan Packet
	packetData       []byte
}

func NewAwesomeClientInstance(logger *zap.Logger, addr *net.UDPAddr, serverConn *AwesomeNetcodeConn, protocolId uint64, sendKey []byte, recvKey []byte) *AwesomeClientInstance {
	c := &AwesomeClientInstance{
		logger:     logger,
		Address:    addr,
		serverConn: serverConn,
		confirmed:  false,
		connected:  false,

		sendKey: make([]byte, KEY_BYTES),
		recvKey: make([]byte, KEY_BYTES),

		shutdownCh: make(chan bool),
		stopped:    false,

		sequence: 0.0,

		userData:   make([]byte, USER_DATA_BYTES),
		protocolId: protocolId,

		replayProtection: NewReplayProtection(),
		packetCh:         make(chan Packet, PACKET_QUEUE_SIZE),
		packetData:       make([]byte, MAX_PACKET_BYTES),
	}

	copy(c.sendKey, sendKey)
	copy(c.recvKey, recvKey)

	return c
}

func (c *AwesomeClientInstance) Read() ([]byte, error) {
	for {
		select {
		case packet := <-c.packetCh:
			switch packet.GetType() {
			case ConnectionKeepAlive:
				c.Lock()
				if !c.confirmed {
					c.logger.Debug("server confirmed connection to client", zap.String("addr", c.Address.String()))
					c.confirmed = true
				}
				c.Unlock()
				continue
			case ConnectionPayload:
				c.Lock()
				if !c.confirmed {
					c.logger.Debug("server confirmed connection to client", zap.String("addr", c.Address.String()))
					c.confirmed = true
				}
				c.Unlock()
				p, ok := packet.(*PayloadPacket)
				if !ok {
					// Should not happen, already checked the type.
					c.logger.Debug("not a payload packet")
					continue
				}
				return p.PayloadData, nil
			default:
				// Silently discard any other packets and keep waiting.
				continue
			}
		case <-c.shutdownCh:
			return nil, io.EOF
		}
	}
}

func (c *AwesomeClientInstance) Send(payloadData []byte) error {
	isConfirmed := false
	isConnected := false
	c.Lock()
	if c.stopped {
		c.Unlock()
		return io.ErrUnexpectedEOF
	}
	isConfirmed = c.confirmed
	isConnected = c.connected
	c.Unlock()

	if isConfirmed {
		// No problem if confirmation happens between check above and here.
		c.sendKeepAlive()
	}

	if isConnected {
		packet := NewPayloadPacket(payloadData)
		return c.sendPacket(packet)
	}
	return io.ErrUnexpectedEOF
}

func (c *AwesomeClientInstance) Close() {
	c.Lock()
	if c.stopped {
		c.Unlock()
		return
	}
	c.stopped = true
	c.Unlock()
	close(c.shutdownCh)

	// Do not close this, to avoid excessive locking we don't check the status of this channel before writing.
	// Leave it for GC to clean up.
	// close(c.packetCh)
}

func (c *AwesomeClientInstance) connect(userData *Buffer) {
	c.Lock()
	if c.stopped || c.connected {
		c.Unlock()
		return
	}
	c.connected = true
	copy(c.userData, userData.Bytes())
	c.Unlock()
}

func (c *AwesomeClientInstance) sendKeepAlive() {
	packet := &KeepAlivePacket{
		ClientIndex: uint32(0),
		MaxClients:  uint32(2),
	}

	if err := c.sendPacket(packet); err != nil {
		c.logger.Error("error sending keep alive", zap.Error(err))
	}
}

func (c *AwesomeClientInstance) sendPacket(packet Packet) error {
	c.Lock()
	if c.stopped || c.connected {
		c.Unlock()
		return nil
	}
	var bytesWritten int
	var err error

	if bytesWritten, err = packet.Write(c.packetData, c.protocolId, c.sequence, c.sendKey); err != nil {
		c.Unlock()
		return fmt.Errorf("error: unable to write packet: %s", err)
	}

	if _, err := c.serverConn.WriteTo(c.packetData[:bytesWritten], c.Address); err != nil {
		c.logger.Error("error writing to client", zap.Error(err))
	}

	c.sequence++
	c.Unlock()
	return nil
}
