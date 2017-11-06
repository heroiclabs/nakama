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
	"sync"
	"sync/atomic"
	"time"

	"github.com/wirepair/netcode"
	"go.uber.org/zap"
)

// Not a true connection limit, only used to initialise/allocate various buffer and data structure sizes.
const MAX_CLIENTS = 1024

type Server struct {
	sync.Mutex
	logger             *zap.Logger
	listenAddr         *net.UDPAddr
	publicAddr         *net.UDPAddr
	protocolId         uint64
	privateKey         []byte
	maxPacketSize      int
	maxPacketFragments int

	// Will be handed off to a new goroutine.
	onConnect func(*ClientInstance)

	serverConn *NetcodeConn
	shutdownCh chan bool
	timeoutMs  int64

	clients        map[string]*ClientInstance
	globalSequence uint64

	allowedPackets []byte

	challengeKey      []byte
	challengeSequence uint64

	packetCh chan *NetcodeData
}

func NewServer(logger *zap.Logger, listenAddr, publicAddr *net.UDPAddr, privateKey []byte, protocolId uint64, maxPacketSizeBytes int64, onConnect func(*ClientInstance), timeoutMs int64) (*Server, error) {
	s := &Server{
		logger:     logger,
		listenAddr: listenAddr,
		publicAddr: publicAddr,
		protocolId: protocolId,
		privateKey: privateKey,
		// maxPacketSize set below.
		// maxPacketFragments set below.

		onConnect: onConnect,

		// serverConn set below.
		shutdownCh: make(chan bool),
		timeoutMs:  timeoutMs,

		clients:        make(map[string]*ClientInstance, MAX_CLIENTS),
		globalSequence: uint64(1) << 63,

		// allowedPackets set below.

		// challengeKey set below.
		challengeSequence: uint64(0),

		packetCh: make(chan *NetcodeData, MAX_CLIENTS*netcode.MAX_SERVER_PACKETS*2),
	}

	s.serverConn = NewNetcodeConn(logger, netcode.SOCKET_RCVBUF_SIZE*MAX_CLIENTS, netcode.SOCKET_SNDBUF_SIZE*MAX_CLIENTS, s.handleNetcodeData)

	// set allowed packets for this server
	s.allowedPackets = make([]byte, netcode.ConnectionNumPackets)
	s.allowedPackets[netcode.ConnectionRequest] = 1
	s.allowedPackets[netcode.ConnectionResponse] = 1
	s.allowedPackets[netcode.ConnectionKeepAlive] = 1
	s.allowedPackets[netcode.ConnectionPayload] = 1
	s.allowedPackets[netcode.ConnectionDisconnect] = 1

	var err error
	s.maxPacketSize, s.maxPacketFragments, err = PacketMaxValues(maxPacketSizeBytes)
	if err != nil {
		return nil, err
	}
	s.challengeKey, err = netcode.GenerateKey()
	if err != nil {
		return nil, err
	}

	return s, nil
}

func (s *Server) Listen() error {
	if err := s.serverConn.Listen(s.listenAddr); err != nil {
		return err
	}

	// Continuously process incoming packets.
	go func() {
		for {
			select {
			case recv := <-s.packetCh:
				if recv != nil {
					s.onPacketData(recv.data, recv.from)
				}
			case <-s.shutdownCh:
				return
			}
		}
	}()

	return nil
}

func (s *Server) Stop() {
	close(s.shutdownCh)

	// Send disconnect messages to any connected clients.
	s.Lock()
	for addr, clientInstance := range s.clients {
		clientInstance.close(true)
		delete(s.clients, addr)
	}
	s.Unlock()

	s.serverConn.Close()
	close(s.packetCh)
}

func (s *Server) closeClient(clientInstance *ClientInstance, sendDisconnect bool) {
	s.Lock()
	addr := clientInstance.Address.String()
	if foundInstance, ok := s.clients[addr]; !ok {
		s.Unlock()
		return
	} else if foundInstance == clientInstance {
		// In the unlikely case there is already another client taking up this address slot by the time this client is cleaned up.
		clientInstance.close(sendDisconnect)
		delete(s.clients, addr)
		s.logger.Debug("server closed client", zap.String("addr", addr))
	}
	s.Unlock()
}

// write the netcodeData to our buffered packet channel. The NetcodeConn verifies
// that the recv'd data is > 0 < maxBytes and is of a valid packet type before
// this is even called.
// Must NOT be a blocking call.
func (s *Server) handleNetcodeData(packetData *NetcodeData) {
	s.packetCh <- packetData
}

func (s *Server) onPacketData(packetData []byte, addr *net.UDPAddr) {
	s.Lock()
	clientInstance := s.clients[addr.String()]
	s.Unlock()
	var replayProtection *netcode.ReplayProtection
	var readPacketKey []byte
	if clientInstance != nil {
		replayProtection = clientInstance.replayProtection
		readPacketKey = clientInstance.recvKey
	}

	// TODO Read packet after handoff to client instance channel, to free up the server routine?

	// Packet type has already been validated by NetcodeConn, so `packet` will not be nil.
	packet := netcode.NewPacket(packetData)
	if clientInstance == nil && packet.GetType() != netcode.ConnectionRequest {
		// Don't even bother decoding, unknown addresses must open up communication strictly with a connection request.
		return
	}
	size := len(packetData)
	timestamp := uint64(time.Now().Unix())
	if err := packet.Read(packetData, size, s.protocolId, timestamp, readPacketKey, s.privateKey, s.allowedPackets, replayProtection); err != nil {
		// If there was no `readPacketKey` found then everything except a `ConnectionRequest` packet type will fail here.
		// Expired connect tokens also end up here.
		s.logger.Debug("error reading packet", zap.String("addr", addr.String()), zap.Error(err))
		return
	}

	s.processPacket(clientInstance, packet, addr)
}

func (s *Server) processPacket(clientInstance *ClientInstance, packet netcode.Packet, addr *net.UDPAddr) {
	switch packet.GetType() {
	case netcode.ConnectionRequest:
		s.logger.Debug("server received connection request", zap.String("addr", addr.String()))
		s.processConnectionRequest(packet, addr)
	case netcode.ConnectionResponse:
		s.logger.Debug("server received connection response", zap.String("addr", addr.String()))
		s.processConnectionResponse(clientInstance, packet, addr)
	case netcode.ConnectionKeepAlive:
		// Keep alive packets handled by individual client instances.
		// Will advance client expiry time.
		clientInstance.incomingPacketCh <- packet
	case netcode.ConnectionPayload:
		// Data packets handled by individual client instances.
		// Will advance client expiry time.
		clientInstance.incomingPacketCh <- packet
	case netcode.ConnectionDisconnect:
		s.logger.Debug("server received connection disconnect", zap.String("addr", addr.String()))
		// Disconnect packets not required when client triggers disconnect.
		// Send on a separate routine to unblock server, once client is dropped additional disconnects will not reach here.
		go clientInstance.Close(false)
	default:
		s.logger.Debug("server received unknown packet", zap.String("addr", addr.String()))
	}
}

func (s *Server) processConnectionRequest(packet netcode.Packet, addr *net.UDPAddr) {
	requestPacket, ok := packet.(*netcode.RequestPacket)
	if !ok {
		return
	}

	if len(requestPacket.Token.ServerAddrs) == 0 {
		s.logger.Debug("server ignored connection request. server address not in connect token whitelist")
		return
	}

	addrFound := false
	for _, tokenAddr := range requestPacket.Token.ServerAddrs {
		if addressEqual(s.publicAddr, &tokenAddr) {
			addrFound = true
			break
		}
	}

	if !addrFound {
		s.logger.Debug("server ignored connection request. server address not in connect token whitelist")
		return
	}

	addrStr := addr.String()
	s.Lock()
	if clientInstance, ok := s.clients[addrStr]; !ok {
		s.clients[addrStr] = NewClientInstance(s.logger, addr, s.serverConn, s.closeClient, requestPacket.ConnectTokenExpireTimestamp, s.protocolId, s.timeoutMs, requestPacket.Token.ServerKey, requestPacket.Token.ClientKey, s.maxPacketSize, s.maxPacketFragments)
	} else if clientInstance.IsConnected() {
		s.Unlock()
		s.logger.Debug("server ignored connection request. a client with this address is already connected", zap.String("addr", addr.String()))
		return
	}
	// SKIP FindClientIndexById - don't use the protocol client IDs.
	// SKIP FindOrAddTokenEntry - allow multiple connections with the same token.
	// SKIP ConnectedClientCount - allow arbitrary number of client connections.
	s.Unlock()

	var bytesWritten int
	var err error

	challenge := netcode.NewChallengeToken(requestPacket.Token.ClientId)
	challengeBuf := challenge.Write(requestPacket.Token.UserData)
	challengeSequence := atomic.AddUint64(&s.challengeSequence, 1) - 1

	if err := netcode.EncryptChallengeToken(challengeBuf, challengeSequence, s.challengeKey); err != nil {
		s.logger.Warn("server ignored connection request. failed to encrypt challenge token")
		return
	}

	challengePacket := &netcode.ChallengePacket{
		ChallengeTokenData:     challengeBuf,
		ChallengeTokenSequence: challengeSequence,
	}

	buffer := make([]byte, netcode.MAX_PACKET_BYTES)
	if bytesWritten, err = challengePacket.Write(buffer, s.protocolId, atomic.AddUint64(&s.globalSequence, 1)-1, requestPacket.Token.ServerKey); err != nil {
		s.logger.Error("server error while writing challenge packet", zap.Error(err))
		return
	}

	if _, err := s.serverConn.WriteTo(buffer[:bytesWritten], addr); err != nil {
		s.logger.Error("error sending packet", zap.String("addr", addr.String()), zap.Error(err))
	}

	// Do not trigger the application new client callback here while the connection is still in the challenge phase.
}

func (s *Server) processConnectionResponse(clientInstance *ClientInstance, packet netcode.Packet, addr *net.UDPAddr) {
	var err error
	var tokenBuffer []byte
	var challengeToken *netcode.ChallengeToken

	responsePacket, ok := packet.(*netcode.ResponsePacket)
	if !ok {
		return
	}

	if tokenBuffer, err = netcode.DecryptChallengeToken(responsePacket.ChallengeTokenData, responsePacket.ChallengeTokenSequence, s.challengeKey); err != nil {
		s.logger.Debug("failed to decrypt challenge token", zap.Error(err))
		return
	}

	if challengeToken, err = netcode.ReadChallengeToken(tokenBuffer); err != nil {
		s.logger.Debug("failed to read challenge token", zap.Error(err))
		return
	}

	// SKIP FindClientIndexById - don't use the protocol client IDs.
	// SKIP ConnectedClientCount - allow arbitrary number of client connections.

	// Only notify the application if this client is newly connected.
	// This handles duplicate connection challenge responses.
	if clientInstance.connect(challengeToken.UserData) {
		go s.onConnect(clientInstance)
	}
}

func addressEqual(addr1, addr2 *net.UDPAddr) bool {
	if addr1 == nil || addr2 == nil {
		return false
	}
	return addr1.IP.Equal(addr2.IP) && addr1.Port == addr2.Port
}
