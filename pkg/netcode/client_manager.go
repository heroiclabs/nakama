package netcode

import (
	"bytes"
	"log"
	"net"
)

type connectTokenEntry struct {
	mac     []byte
	address *net.UDPAddr
	time    float64
}

type encryptionEntry struct {
	expireTime float64
	lastAccess float64
	timeout    int
	address    *net.UDPAddr
	sendKey    []byte
	recvKey    []byte
}

type ClientManager struct {
	maxClients int
	maxEntries int
	timeout    float64

	instances            []*ClientInstance
	connectedClientIds   []uint64 // slice of connected clientIds
	connectTokensEntries []*connectTokenEntry
	cryptoEntries        []*encryptionEntry
	numCryptoEntries     int

	emptyMac      []byte // used to ensure empty mac (all empty bytes) doesn't match
	emptyWriteKey []byte // used to test for empty write key
}

func NewClientManager(timeout float64, maxClients int) *ClientManager {
	m := &ClientManager{}
	m.maxClients = maxClients
	m.maxEntries = maxClients * 8
	m.connectedClientIds = make([]uint64, maxClients)
	m.timeout = timeout
	m.emptyMac = make([]byte, MAC_BYTES)
	m.emptyWriteKey = make([]byte, KEY_BYTES)
	m.resetClientInstances()
	m.resetTokenEntries()
	m.resetCryptoEntries()
	return m
}

func (m *ClientManager) setTimeout(timeout float64) {
	m.timeout = timeout
}

func (m *ClientManager) resetClientInstances() {
	m.instances = make([]*ClientInstance, m.maxClients)
	for i := 0; i < m.maxClients; i += 1 {
		instance := NewClientInstance()
		m.instances[i] = instance
	}
}

// preallocate the token buffers so we don't have to do nil checks
func (m *ClientManager) resetTokenEntries() {
	m.connectTokensEntries = make([]*connectTokenEntry, m.maxEntries)
	for i := 0; i < m.maxEntries; i += 1 {
		entry := &connectTokenEntry{}
		m.clearTokenEntry(entry)
		m.connectTokensEntries[i] = entry
	}
}

func (m *ClientManager) clearTokenEntry(entry *connectTokenEntry) {
	entry.mac = make([]byte, MAC_BYTES)
	entry.address = nil
	entry.time = -1
}

// preallocate the crypto entries so we don't have to do nil checks
func (m *ClientManager) resetCryptoEntries() {
	m.cryptoEntries = make([]*encryptionEntry, m.maxEntries)
	for i := 0; i < m.maxEntries; i += 1 {
		entry := &encryptionEntry{}
		m.clearCryptoEntry(entry)
		m.cryptoEntries[i] = entry
	}
}

func (m *ClientManager) clearCryptoEntry(entry *encryptionEntry) {
	entry.expireTime = -1
	entry.lastAccess = -1000
	entry.address = nil
	entry.sendKey = make([]byte, KEY_BYTES)
	entry.recvKey = make([]byte, KEY_BYTES)
}

func (m *ClientManager) FindFreeClientIndex() int {
	for i := 0; i < m.maxClients; i += 1 {
		if !m.instances[i].connected {
			return i
		}
	}
	return -1
}

// Returns the clientIds of the connected clients. To avoid allocating a buffer everytime this is called
// we simply re-add all connected clients to the connectedClientIds buffer and return the slice of how
// many we were able to add.
func (m *ClientManager) ConnectedClients() []uint64 {
	i := 0
	for clientIndex := 0; clientIndex < m.maxClients; clientIndex += 1 {
		client := m.instances[clientIndex]
		if client.connected && client.address != nil {
			m.connectedClientIds[i] = client.clientId
			i++
		}
	}
	return m.connectedClientIds[0:i]
}

func (m *ClientManager) ConnectedClientCount() int {
	return len(m.ConnectedClients())
}

// Initializes the client with the clientId
func (m *ClientManager) ConnectClient(addr *net.UDPAddr, challengeToken *ChallengeToken) *ClientInstance {
	clientIndex := m.FindFreeClientIndex()
	if clientIndex == -1 {
		log.Printf("failure to find free client index\n")
		return nil
	}
	client := m.instances[clientIndex]
	client.clientIndex = clientIndex
	client.connected = true
	client.sequence = 0
	client.clientId = challengeToken.ClientId
	client.address = addr
	copy(client.userData, challengeToken.UserData.Bytes())
	return client
}

// Disconnects the client referenced by the provided clientIndex.
func (m *ClientManager) DisconnectClient(clientIndex int, sendDisconnect bool, serverTime float64) {
	instance := m.instances[clientIndex]
	m.disconnectClient(instance, sendDisconnect, serverTime)
}

// Finds the client index referenced by the provided UDPAddr.
func (m *ClientManager) FindClientIndexByAddress(addr *net.UDPAddr) int {
	for i := 0; i < m.maxClients; i += 1 {
		instance := m.instances[i]
		if instance.address != nil && instance.connected && addressEqual(instance.address, addr) {
			return i
		}
	}
	return -1
}

// Finds the client index via the provided clientId.
func (m *ClientManager) FindClientIndexById(clientId uint64) int {
	for i := 0; i < m.maxClients; i += 1 {
		instance := m.instances[i]
		if instance.address != nil && instance.connected && instance.clientId == clientId {
			return i
		}
	}
	return -1
}

// Finds the encryption index via the provided clientIndex, returns -1 if not found.
func (m *ClientManager) FindEncryptionIndexByClientIndex(clientIndex int) int {
	if clientIndex < 0 || clientIndex > m.maxClients {
		return -1
	}

	return m.instances[clientIndex].encryptionIndex
}

// Finds an encryption entry index via the provided UDPAddr.
func (m *ClientManager) FindEncryptionEntryIndex(addr *net.UDPAddr, serverTime float64) int {
	for i := 0; i < m.numCryptoEntries; i += 1 {
		entry := m.cryptoEntries[i]
		if entry == nil || entry.address == nil {
			continue
		}

		lastAccessTimeout := entry.lastAccess + m.timeout
		if addressEqual(entry.address, addr) && serverTimedout(lastAccessTimeout, serverTime) && (entry.expireTime < 0 || entry.expireTime >= serverTime) {
			entry.lastAccess = serverTime
			return i
		}
	}
	return -1
}

// Finds or adds a token entry to our token entry slice.
func (m *ClientManager) FindOrAddTokenEntry(connectTokenMac []byte, addr *net.UDPAddr, serverTime float64) bool {
	var oldestTime float64

	tokenIndex := -1
	oldestIndex := -1

	if bytes.Equal(connectTokenMac, m.emptyMac) {
		return false
	}

	// find the matching entry for the token mac and the oldest token entry.
	for i := 0; i < m.maxEntries; i += 1 {
		if bytes.Equal(m.connectTokensEntries[i].mac, connectTokenMac) {
			tokenIndex = i
		}

		if oldestIndex == -1 || m.connectTokensEntries[i].time < oldestTime {
			oldestTime = m.connectTokensEntries[i].time
			oldestIndex = i
		}
	}

	// if no entry is found with the mac, this is a new connect token. replace the oldest token entry.
	if tokenIndex == -1 {
		m.connectTokensEntries[oldestIndex].time = serverTime
		m.connectTokensEntries[oldestIndex].address = addr
		m.connectTokensEntries[oldestIndex].mac = connectTokenMac
		log.Printf("new connect token added for %s\n", addr.String())
		return true
	}

	// allow connect tokens we have already seen from the same address
	if addressEqual(m.connectTokensEntries[tokenIndex].address, addr) {
		return true
	}

	return false
}

// Adds a new encryption mapping of client/server keys.
func (m *ClientManager) AddEncryptionMapping(connectToken *ConnectTokenPrivate, addr *net.UDPAddr, serverTime, expireTime float64) bool {
	// already list
	for i := 0; i < m.maxEntries; i += 1 {
		entry := m.cryptoEntries[i]

		lastAccessTimeout := entry.lastAccess + m.timeout
		if entry.address != nil && addressEqual(entry.address, addr) && serverTimedout(lastAccessTimeout, serverTime) {
			entry.expireTime = expireTime
			entry.lastAccess = serverTime
			copy(entry.sendKey, connectToken.ServerKey)
			copy(entry.recvKey, connectToken.ClientKey)
			log.Printf("re-added encryption mapping for %s encIdx: %d\n", addr.String(), i)
			return true
		}
	}

	// not in our list.
	for i := 0; i < m.maxEntries; i += 1 {
		entry := m.cryptoEntries[i]
		if entry.lastAccess+m.timeout < serverTime || (entry.expireTime >= 0 && entry.expireTime < serverTime) {
			entry.address = addr
			entry.expireTime = expireTime
			entry.lastAccess = serverTime
			copy(entry.sendKey, connectToken.ServerKey)
			copy(entry.recvKey, connectToken.ClientKey)
			if i+1 > m.numCryptoEntries {
				m.numCryptoEntries = i + 1
			}
			return true
		}
	}

	return false
}

// Update the encryption entry for the  provided encryption index.
func (m *ClientManager) TouchEncryptionEntry(encryptionIndex int, addr *net.UDPAddr, serverTime float64) bool {
	if encryptionIndex < 0 || encryptionIndex > m.numCryptoEntries {
		return false
	}

	if !addressEqual(m.cryptoEntries[encryptionIndex].address, addr) {
		return false
	}

	m.cryptoEntries[encryptionIndex].lastAccess = serverTime
	return true
}

// Sets the expiration for this encryption entry.
func (m *ClientManager) SetEncryptionEntryExpiration(encryptionIndex int, expireTime float64) bool {
	if encryptionIndex < 0 || encryptionIndex > m.numCryptoEntries {
		return false
	}

	m.cryptoEntries[encryptionIndex].expireTime = expireTime
	return true
}

// Removes the encryption entry for this UDPAddr.
func (m *ClientManager) RemoveEncryptionEntry(addr *net.UDPAddr, serverTime float64) bool {
	for i := 0; i < m.numCryptoEntries; i += 1 {
		entry := m.cryptoEntries[i]
		if !addressEqual(entry.address, addr) {
			continue
		}

		m.clearCryptoEntry(entry)

		if i+1 == m.numCryptoEntries {
			index := i - 1
			for index >= 0 {
				lastAccessTimeout := m.cryptoEntries[index].lastAccess + m.timeout
				if serverTimedout(lastAccessTimeout, serverTime) && (m.cryptoEntries[index].expireTime < 0 || m.cryptoEntries[index].expireTime > serverTime) {
					break
				}
				index--
			}
			m.numCryptoEntries = index + 1
		}

		return true
	}

	return false
}

// Returns the encryption send key.
func (m *ClientManager) GetEncryptionEntrySendKey(index int) []byte {
	return m.getEncryptionEntryKey(index, true)
}

// Returns the encryption recv key.
func (m *ClientManager) GetEncryptionEntryRecvKey(index int) []byte {
	return m.getEncryptionEntryKey(index, false)
}

func (m *ClientManager) getEncryptionEntryKey(index int, sendKey bool) []byte {
	if index == -1 || index < 0 || index > m.numCryptoEntries {
		return nil
	}

	if sendKey {
		return m.cryptoEntries[index].sendKey
	}

	return m.cryptoEntries[index].recvKey
}

func (m *ClientManager) sendPayloads(payloadData []byte, serverTime float64) {
	for i := 0; i < m.maxClients; i += 1 {
		m.sendPayloadToInstance(i, payloadData, serverTime)
	}
}

func (m *ClientManager) sendPayloadToInstance(index int, payloadData []byte, serverTime float64) {
	instance := m.instances[index]
	if instance.encryptionIndex == -1 {
		return
	}

	writePacketKey := m.GetEncryptionEntrySendKey(instance.encryptionIndex)
	if bytes.Equal(writePacketKey, m.emptyWriteKey) || instance.address == nil {
		return
	}

	if !instance.confirmed {
		packet := &KeepAlivePacket{}
		packet.ClientIndex = uint32(instance.clientIndex)
		packet.MaxClients = uint32(m.maxClients)
		instance.SendPacket(packet, writePacketKey, serverTime)
	}

	if instance.connected {
		if !m.TouchEncryptionEntry(instance.encryptionIndex, instance.address, serverTime) {
			log.Printf("error: encryption mapping is out of date for client %d\n", instance.clientIndex)
			return
		}
		packet := NewPayloadPacket(payloadData)
		instance.SendPacket(packet, writePacketKey, serverTime)
	}
}

// Send keep alives to all connected clients.
func (m *ClientManager) SendKeepAlives(serverTime float64) {
	for i := 0; i < m.maxClients; i += 1 {
		instance := m.instances[i]
		if !instance.connected {
			continue
		}

		writePacketKey := m.GetEncryptionEntrySendKey(instance.encryptionIndex)
		if bytes.Equal(writePacketKey, m.emptyWriteKey) || instance.address == nil {
			continue
		}

		shouldSendTime := instance.lastSendTime + float64(1.0/PACKET_SEND_RATE)
		if shouldSendTime < serverTime || floatEquals(shouldSendTime, serverTime) {
			if !m.TouchEncryptionEntry(instance.encryptionIndex, instance.address, serverTime) {
				log.Printf("error: encryption mapping is out of date for client %d\n", instance.clientIndex)
				continue
			}

			packet := &KeepAlivePacket{}
			packet.ClientIndex = uint32(instance.clientIndex)
			packet.MaxClients = uint32(m.maxClients)
			instance.SendPacket(packet, writePacketKey, serverTime)
		}
	}
}

// Checks and disconnects any clients that have timed out.
func (m *ClientManager) CheckTimeouts(serverTime float64) {
	for i := 0; i < m.maxClients; i += 1 {
		instance := m.instances[i]
		timeout := instance.lastRecvTime + m.timeout

		if instance.connected && (timeout < serverTime || floatEquals(timeout, serverTime)) {
			log.Printf("server timed out client: %d\n", i)
			m.disconnectClient(instance, false, serverTime)
		}
	}
}

func (m *ClientManager) disconnectClients(serverTime float64) {
	for clientIndex := 0; clientIndex < m.maxClients; clientIndex += 1 {
		instance := m.instances[clientIndex]
		m.disconnectClient(instance, true, serverTime)
	}
}

func (m *ClientManager) disconnectClient(client *ClientInstance, sendDisconnect bool, serverTime float64) {
	if !client.connected {
		return
	}

	if sendDisconnect {
		packet := &DisconnectPacket{}
		writePacketKey := m.GetEncryptionEntrySendKey(client.encryptionIndex)
		if writePacketKey == nil {
			log.Printf("error: unable to retrieve encryption key for client for disconnect: %d\n", client.clientId)
		} else {
			for i := 0; i < NUM_DISCONNECT_PACKETS; i += 1 {
				client.SendPacket(packet, writePacketKey, serverTime)
			}
		}
	}
	log.Printf("removing encryption entry for: %s", client.address.String())
	m.RemoveEncryptionEntry(client.address, serverTime)
	client.Clear()
}

const EPSILON float64 = 0.000001

func floatEquals(a, b float64) bool {
	if (a-b) < EPSILON && (b-a) < EPSILON {
		return true
	}
	return false
}

// checks if last access + timeout is > or = to serverTime.
func serverTimedout(lastAccessTimeout, serverTime float64) bool {
	return (lastAccessTimeout > serverTime || floatEquals(lastAccessTimeout, serverTime))
}
