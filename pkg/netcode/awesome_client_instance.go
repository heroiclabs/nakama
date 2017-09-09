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

	serverConn    *AwesomeNetcodeConn
	closeClientFn func(*AwesomeClientInstance, bool)
	confirmed     bool
	connected     bool

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

func NewAwesomeClientInstance(logger *zap.Logger, addr *net.UDPAddr, serverConn *AwesomeNetcodeConn, closeClientFn func(*AwesomeClientInstance, bool), protocolId uint64, sendKey []byte, recvKey []byte) *AwesomeClientInstance {
	c := &AwesomeClientInstance{
		logger:        logger,
		Address:       addr,
		serverConn:    serverConn,
		closeClientFn: closeClientFn,
		confirmed:     false,
		connected:     false,

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

	//go func() {
	//	ticker := time.NewTicker(time.Duration(s.timeoutMs/2) * time.Millisecond)
	//
	//	for {
	//		select {
	//		case <-ticker.C:
	//			ts := int64(time.Nanosecond) * time.Now().UTC().UnixNano() / int64(time.Millisecond)
	//
	//			s.Lock()
	//			for addr, clientInstance := range s.clients {
	//				if clientInstance.stopped {
	//					delete(s.clients, addr)
	//					continue
	//				}
	//			}
	//			s.Unlock()
	//		case <-s.shutdownCh:
	//			ticker.Stop()
	//			return
	//		}
	//	}
	//}()

	return c
}

func (c *AwesomeClientInstance) Read() ([]byte, error) {
	for {
		select {
		case packet := <-c.packetCh:
			switch packet.GetType() {
			case ConnectionKeepAlive:
				c.Lock()
				if c.stopped {
					c.Unlock()
					return nil, io.EOF
				}
				if !c.confirmed {
					c.logger.Debug("server confirmed connection to client", zap.String("addr", c.Address.String()))
					c.confirmed = true
				}
				c.Unlock()
				continue
			case ConnectionPayload:
				c.Lock()
				if c.stopped {
					c.Unlock()
					return nil, io.EOF
				}
				if !c.confirmed {
					c.logger.Debug("server confirmed connection to client", zap.String("addr", c.Address.String()))
					c.confirmed = true
				}
				c.Unlock()
				p, ok := packet.(*PayloadPacket)
				if !ok {
					// Should not happen, already checked the type.
					// If it does then silently discard the packet and keep waiting.
					c.logger.Debug("not a payload packet")
					continue
				}
				return p.PayloadData, nil
			default:
				// Silently discard any other packets and keep waiting.
				// The server should not have sent any other types down the channel but handle it just in case.
				c.logger.Debug("not a keep alive or payload packet")
				continue
			}
		case <-c.shutdownCh:
			return nil, io.EOF
		}
	}
}

func (c *AwesomeClientInstance) Send(payloadData []byte) error {
	c.Lock()
	if c.stopped || !c.connected {
		c.Unlock()
		return io.ErrUnexpectedEOF
	}

	// Per spec all packets sent to unconfirmed clients are preceded by keep alive packets.
	if !c.confirmed {
		c.sendKeepAlive()
	}

	packet := NewPayloadPacket(payloadData)
	err := c.sendPacket(packet)
	c.Unlock()
	return err
}

func (c *AwesomeClientInstance) Close(sendDisconnect bool) {
	c.closeClientFn(c, sendDisconnect)
}

func (c *AwesomeClientInstance) close(sendDisconnect bool) {
	c.Lock()
	if c.stopped {
		c.Unlock()
		return
	}
	c.stopped = true

	if sendDisconnect && c.connected {
		packet := &DisconnectPacket{}
		for i := 0; i < NUM_DISCONNECT_PACKETS; i += 1 {
			c.sendPacket(packet)
		}
	}

	c.Unlock()

	// Do not close this, to avoid excessive locking we don't check the status of this channel before writing.
	// Leave it for GC to clean up.
	// close(c.packetCh)
	close(c.shutdownCh)
}

func (c *AwesomeClientInstance) connect(userData *Buffer) {
	c.Lock()
	if c.stopped || c.connected {
		c.Unlock()
		return
	}
	c.connected = true
	copy(c.userData, userData.Bytes())
	c.sendKeepAlive()
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
	var bytesWritten int
	var err error

	if bytesWritten, err = packet.Write(c.packetData, c.protocolId, c.sequence, c.sendKey); err != nil {
		return fmt.Errorf("error: unable to write packet: %s", err)
	}

	if _, err := c.serverConn.WriteTo(c.packetData[:bytesWritten], c.Address); err != nil {
		c.logger.Error("error writing to client", zap.Error(err))
	}

	c.sequence++
	return nil
}
