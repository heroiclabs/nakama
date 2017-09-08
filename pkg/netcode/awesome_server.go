package netcode

import (
	"go.uber.org/zap"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

const MAX_CLIENTS = 1024

type AwesomeServer struct {
	sync.Mutex
	logger     *zap.Logger
	serverAddr *net.UDPAddr
	protocolId uint64
	privateKey []byte

	serverConn *AwesomeNetcodeConn
	shutdownCh chan struct{}
	running    bool
	timeoutMs  int

	clients        map[string]*AwesomeClientInstance
	globalSequence uint64

	allowedPackets []byte

	challengeKey      []byte
	challengeSequence uint64

	packetCh chan *NetcodeData
}

func NewAwesomeServer(logger *zap.Logger, serverAddress *net.UDPAddr, privateKey []byte, protocolId uint64, timeoutMs int) (*AwesomeServer, error) {
	s := &AwesomeServer{
		logger:     logger,
		serverAddr: serverAddress,
		protocolId: protocolId,
		privateKey: privateKey,

		// serverConn set below.
		shutdownCh: make(chan struct{}),
		running:    false,
		timeoutMs:  timeoutMs,

		clients:        make(map[string]*AwesomeClientInstance, MAX_CLIENTS),
		globalSequence: uint64(1) << 63,

		// allowedPackets set below.

		// challengeKey set below.
		challengeSequence: uint64(0),

		packetCh: make(chan *NetcodeData, MAX_CLIENTS*MAX_SERVER_PACKETS*2),
	}

	s.serverConn = NewAwesomeNetcodeConn(logger)
	s.serverConn.SetReadBuffer(SOCKET_RCVBUF_SIZE * MAX_CLIENTS)
	s.serverConn.SetWriteBuffer(SOCKET_SNDBUF_SIZE * MAX_CLIENTS)
	s.serverConn.SetRecvHandler(s.handleNetcodeData)

	// set allowed packets for this server
	s.allowedPackets = make([]byte, ConnectionNumPackets)
	s.allowedPackets[ConnectionRequest] = 1
	s.allowedPackets[ConnectionResponse] = 1
	s.allowedPackets[ConnectionKeepAlive] = 1
	s.allowedPackets[ConnectionPayload] = 1
	s.allowedPackets[ConnectionDisconnect] = 1

	var err error
	s.challengeKey, err = GenerateKey()
	if err != nil {
		return nil, err
	}

	return s, nil
}

// increments the challenge sequence and returns the un-incremented value
func (s *AwesomeServer) incChallengeSequence() uint64 {
	val := atomic.AddUint64(&s.challengeSequence, 1)
	return val - 1
}

func (s *AwesomeServer) incGlobalSequence() uint64 {
	val := atomic.AddUint64(&s.globalSequence, 1)
	return val - 1
}

func (s *AwesomeServer) Listen() error {
	s.running = true

	if err := s.serverConn.Listen(s.serverAddr); err != nil {
		return err
	}

	// Periodically drop expired/shutdown clients.
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

	// Continuously process incoming packets as fast as possible.
	go func() {
		for {
			select {
			case recv := <-s.packetCh:
				s.onPacketData(recv.data, recv.from)
			case <-s.shutdownCh:
				return
			}
		}
	}()

	return nil
}

func (s *AwesomeServer) Stop() error {
	if !s.running {
		return nil
	}
	s.running = false
	close(s.shutdownCh)

	// Send disconnect messages to any connected clients.
	s.Lock()
	for addr, clientInstance := range s.clients {
		if !clientInstance.connected || clientInstance.stopped {
			continue
		}

		packet := &DisconnectPacket{}
		for i := 0; i < NUM_DISCONNECT_PACKETS; i += 1 {
			clientInstance.sendPacket(packet)
		}

		clientInstance.Close()
		delete(s.clients, addr)
	}
	s.Unlock()

	s.serverConn.Close()
	close(s.packetCh)

	return nil
}

func (s *AwesomeServer) dropClientInstance(addr *net.UDPAddr) {
	s.Lock()
	delete(s.clients, addr.String())
	s.Unlock()
}

// write the netcodeData to our buffered packet channel. The NetcodeConn verifies
// that the recv'd data is > 0 < maxBytes and is of a valid packet type before
// this is even called.
// NOTE: we will block the netcodeConn from processing which is what we want since
// we want to synchronize access from the Update call.
func (s *AwesomeServer) handleNetcodeData(packetData *NetcodeData) {
	s.packetCh <- packetData
}

func (s *AwesomeServer) onPacketData(packetData []byte, addr *net.UDPAddr) {
	if !s.running {
		return
	}

	s.Lock()
	clientInstance := s.clients[addr.String()]
	s.Unlock()
	var replayProtection *ReplayProtection
	var readPacketKey []byte
	if clientInstance != nil {
		replayProtection = clientInstance.replayProtection
		// TODO check key expiry
		readPacketKey = clientInstance.recvKey
	}

	//encryptionIndex := -1
	//clientIndex := s.clientManager.FindClientIndexByAddress(addr)
	//if clientIndex != -1 {
	//	encryptionIndex = s.clientManager.FindEncryptionIndexByClientIndex(clientIndex)
	//} else {
	//	encryptionIndex = s.clientManager.FindEncryptionEntryIndex(addr, s.serverTime)
	//}
	//readPacketKey = s.clientManager.GetEncryptionEntryRecvKey(encryptionIndex)

	timestamp := uint64(time.Now().Unix())

	// TODO Do this after handoff to client instance routine?

	packet := NewPacket(packetData)
	if clientInstance == nil && packet.GetType() != ConnectionRequest {
		// Don't even bother decoding, unknown addresses must open up communication strictly with a connection request.
		return
	}
	size := len(packetData)
	if err := packet.Read(packetData, size, s.protocolId, timestamp, readPacketKey, s.privateKey, s.allowedPackets, replayProtection); err != nil {
		// If there was no `readPacketKey` found then everything except a `ConnectionRequest` packet type will fail here.
		s.logger.Debug("error reading packet", zap.String("addr", addr.String()), zap.Error(err))
		return
	}

	s.processPacket(clientInstance, packet, addr)
}

func (s *AwesomeServer) processPacket(clientInstance *AwesomeClientInstance, packet Packet, addr *net.UDPAddr) {
	switch packet.GetType() {
	case ConnectionRequest:
		s.logger.Debug("server received connection request", zap.String("addr", addr.String()))
		s.processConnectionRequest(packet, addr)
	case ConnectionResponse:
		s.logger.Debug("server received connection response", zap.String("addr", addr.String()))
		s.processConnectionResponse(clientInstance, packet, addr)
	case ConnectionKeepAlive:
		// Pass keep alive packets to client instance as well.
		// Will be used to advance expiry time.
		clientInstance.packetCh <- packet
	case ConnectionPayload:
		clientInstance.packetCh <- packet
	case ConnectionDisconnect:
		//if clientIndex == -1 {
		//	return
		//}
		//client := s.clientManager.instances[clientIndex]
		//log.Printf("server received disconnect packet from client %d:%s\n", client.clientId, client.address.String())
		//s.clientManager.disconnectClient(client, false, s.serverTime)
		//if !clientInstance.connected {
		//	return
		//}

		//if sendDisconnect {
		//	packet := &DisconnectPacket{}
		//	writePacketKey := m.GetEncryptionEntrySendKey(client.encryptionIndex)
		//	if writePacketKey == nil {
		//		log.Printf("error: unable to retrieve encryption key for client for disconnect: %d\n", client.clientId)
		//	} else {
		//		for i := 0; i < NUM_DISCONNECT_PACKETS; i += 1 {
		//			client.SendPacket(packet, writePacketKey, serverTime)
		//		}
		//	}
		//}
		//log.Printf("removing encryption entry for: %s", client.address.String())
		//m.RemoveEncryptionEntry(client.address, serverTime)
		//client.Clear()

		s.logger.Debug("server received connection disconnect", zap.String("addr", addr.String()))
		if clientInstance == nil {
			return
		}
		clientInstance.Close()
		s.Lock()
		delete(s.clients, addr.String())
		s.Unlock()
	}
}

func (s *AwesomeServer) processConnectionRequest(packet Packet, addr *net.UDPAddr) {
	requestPacket, ok := packet.(*RequestPacket)
	if !ok {
		return
	}

	if len(requestPacket.Token.ServerAddrs) == 0 {
		s.logger.Debug("server ignored connection request. server address not in connect token whitelist")
		return
	}

	addrFound := false
	for _, tokenAddr := range requestPacket.Token.ServerAddrs {
		if addressEqual(s.serverAddr, &tokenAddr) {
			addrFound = true
			break
		}
	}

	if !addrFound {
		s.logger.Debug("server ignored connection request. server address not in connect token whitelist")
		return
	}

	s.Lock()
	clientInstance := s.clients[addr.String()]
	s.Unlock()
	if clientInstance != nil {
		s.logger.Debug("server ignored connection request. a client with this address is already connected", zap.String("addr", addr.String()))
		return
	}

	// SKIP FindClientIndexById - don't use the protocol client IDs.
	// SKIP FindOrAddTokenEntry - allow multiple connections with the same token.
	// SKIP ConnectedClientCount - allow arbitrary number of client connections.

	s.Lock()
	s.clients[addr.String()] = NewAwesomeClientInstance(s.logger, addr, s.serverConn, s.protocolId, requestPacket.Token.ServerKey, requestPacket.Token.ClientKey)
	s.Unlock()

	var bytesWritten int
	var err error

	challenge := NewChallengeToken(requestPacket.Token.ClientId)
	challengeBuf := challenge.Write(requestPacket.Token.UserData)
	challengeSequence := s.incChallengeSequence()

	if err := EncryptChallengeToken(challengeBuf, challengeSequence, s.challengeKey); err != nil {
		s.logger.Debug("server ignored connection request. failed to encrypt challenge token")
		return
	}

	challengePacket := &ChallengePacket{}
	challengePacket.ChallengeTokenData = challengeBuf
	challengePacket.ChallengeTokenSequence = challengeSequence

	buffer := make([]byte, MAX_PACKET_BYTES)
	if bytesWritten, err = challengePacket.Write(buffer, s.protocolId, s.incGlobalSequence(), requestPacket.Token.ServerKey); err != nil {
		s.logger.Error("server error while writing challenge packet", zap.Error(err))
		return
	}

	if _, err := s.serverConn.WriteTo(buffer[:bytesWritten], addr); err != nil {
		s.logger.Error("error sending packet", zap.String("addr", addr.String()), zap.Error(err))
	}
}

func (s *AwesomeServer) processConnectionResponse(clientInstance *AwesomeClientInstance, packet Packet, addr *net.UDPAddr) {
	var err error
	var tokenBuffer []byte
	var challengeToken *ChallengeToken

	responsePacket, ok := packet.(*ResponsePacket)
	if !ok {
		return
	}

	if tokenBuffer, err = DecryptChallengeToken(responsePacket.ChallengeTokenData, responsePacket.ChallengeTokenSequence, s.challengeKey); err != nil {
		s.logger.Debug("failed to decrypt challenge token", zap.Error(err))
		return
	}

	if challengeToken, err = ReadChallengeToken(tokenBuffer); err != nil {
		s.logger.Debug("failed to read challenge token", zap.Error(err))
		return
	}

	// SKIP FindClientIndexById - don't use the protocol client IDs.
	// SKIP ConnectedClientCount - allow arbitrary number of client connections.

	clientInstance.connect(challengeToken.UserData)
	clientInstance.sendKeepAlive()
}
