package multicode

import (
	"fmt"
	"github.com/wirepair/netcode"
	"go.uber.org/zap"
	"io"
	"net"
	"sync"
	"time"
)

// Higher value == more frequent keep alive sends and expiry checks within the connection timeout window.
const KEEP_ALIVE_EXPIRY_RESOLUTION = 4

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

	replayProtection *netcode.ReplayProtection
	packetCh         chan netcode.Packet
	packetData       []byte
}

func NewClientInstance(logger *zap.Logger, addr *net.UDPAddr, serverConn *NetcodeConn, closeClientFn func(*ClientInstance, bool), expiry uint64, protocolId uint64, timeoutMs int64, sendKey []byte, recvKey []byte) *ClientInstance {
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

		sequence: 0.0,
		lastSend: 0,
		// Assume clients are created off the back of an incoming connection request.
		// Setting a real value here avoids the expiry check routine from instantly killing
		// the client before the challenge and response handshake is even complete.
		lastRecv: nowMs(),

		ExpiresAt:  int64(expiry),
		UserData:   make([]byte, netcode.USER_DATA_BYTES),
		ProtocolId: protocolId,

		replayProtection: netcode.NewReplayProtection(),
		packetCh:         make(chan netcode.Packet, netcode.PACKET_QUEUE_SIZE),
		packetData:       make([]byte, netcode.MAX_PACKET_BYTES),
	}

	copy(c.sendKey, sendKey)
	copy(c.recvKey, recvKey)

	// Check client keep alive send and enforce expiry.
	go func() {
		// (Assumes KEEP_ALIVE_EXPIRY_RESOLUTION == 4, higher value means more frequent ticks.)
		// Resolution is timeout / 4 to reduce load caused by frequent checks.
		// In exchange for a 10 second timeout it could take up to 12.5 seconds to expire.
		// Similarly we sent up to 4 keep alive packets per timeout window.
		ticker := time.NewTicker(time.Duration(c.timeoutMs/KEEP_ALIVE_EXPIRY_RESOLUTION) * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				c.Lock()
				if c.stopped {
					c.Unlock()
					return
				}
				ts := nowMs()
				// Check if we need to send a keep alive to client.
				if c.connected && c.lastSend <= ts-c.timeoutMs {
					c.sendKeepAlive()
				}
				// Check if we've not seen a message from client in too long.
				// Expiry is checked regardless of c.connected to handle clients that request connection but never
				// respond to challenge to complete handshake.
				if c.lastRecv < ts-c.timeoutMs {
					c.Unlock()
					c.Close(true)
					return
				}
				c.Unlock()
			case <-c.shutdownCh:
				return
			}
		}
	}()

	return c
}

func (c *ClientInstance) Read() ([]byte, error) {
	for {
		select {
		case packet := <-c.packetCh:
			switch packet.GetType() {
			case netcode.ConnectionKeepAlive:
				c.Lock()
				if c.stopped {
					c.Unlock()
					return nil, io.EOF
				}
				if !c.confirmed {
					c.logger.Debug("server confirmed connection to client", zap.String("addr", c.Address.String()))
					c.confirmed = true
				}
				c.lastRecv = nowMs()
				c.Unlock()
				continue
			case netcode.ConnectionPayload:
				c.Lock()
				if c.stopped {
					c.Unlock()
					return nil, io.EOF
				}
				if !c.confirmed {
					c.logger.Debug("server confirmed connection to client", zap.String("addr", c.Address.String()))
					c.confirmed = true
				}
				c.lastRecv = nowMs()
				c.Unlock()
				p, ok := packet.(*netcode.PayloadPacket)
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

func (c *ClientInstance) Send(payloadData []byte) error {
	c.Lock()
	if c.stopped || !c.connected {
		c.Unlock()
		return io.ErrUnexpectedEOF
	}

	// Per spec all packets sent to unconfirmed clients are preceded by keep alive packets.
	if !c.confirmed {
		c.sendKeepAlive()
	}

	packet := netcode.NewPayloadPacket(payloadData)
	err := c.sendPacket(packet)
	c.Unlock()
	return err
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

	c.Unlock()

	// Do not close this, to avoid excessive locking we don't check the status of this channel before writing.
	// Leave it for GC to clean up.
	// close(c.packetCh)
	close(c.shutdownCh)
}

func (c *ClientInstance) connect(userData *netcode.Buffer) {
	c.Lock()
	if c.stopped || c.connected {
		c.Unlock()
		return
	}
	c.connected = true
	copy(c.UserData, userData.Bytes())
	c.sendKeepAlive()
	c.Unlock()
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

	if bytesWritten, err = packet.Write(c.packetData, c.ProtocolId, c.sequence, c.sendKey); err != nil {
		return fmt.Errorf("error: unable to write packet: %s", err)
	}

	if _, err := c.serverConn.WriteTo(c.packetData[:bytesWritten], c.Address); err != nil {
		c.logger.Error("error writing to client", zap.Error(err))
	}

	c.sequence++
	c.lastSend = nowMs()
	return nil
}

func nowMs() int64 {
	return int64(time.Nanosecond) * time.Now().UTC().UnixNano() / int64(time.Millisecond)
}
