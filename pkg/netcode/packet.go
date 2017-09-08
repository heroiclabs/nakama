package netcode

import (
	"fmt"
)

const CONNECT_TOKEN_PRIVATE_BYTES = 1024
const CHALLENGE_TOKEN_BYTES = 300
const VERSION_INFO_BYTES = 13
const USER_DATA_BYTES = 256
const MAX_PACKET_BYTES = 1220
const MAX_PAYLOAD_BYTES = 1200
const MAX_ADDRESS_STRING_LENGTH = 256
const REPLAY_PROTECTION_BUFFER_SIZE = 256

const KEY_BYTES = 32
const MAC_BYTES = 16
const NONCE_BYTES = 8
const MAX_SERVERS_PER_CONNECT = 32

const VERSION_INFO = "NETCODE 1.01\x00"

const (
	ConnectionRequest PacketType = iota
	ConnectionDenied
	ConnectionChallenge
	ConnectionResponse
	ConnectionKeepAlive
	ConnectionPayload
	ConnectionDisconnect
)

// Used for determining the type of packet, part of the serialization protocol
type PacketType uint8

func (p PacketType) Peek(packetBuffer []byte) PacketType {
	prefix := uint8(packetBuffer[0])
	return PacketType(prefix & 0xF)
}

// reference map of packet -> string values
var packetTypeMap = map[PacketType]string{
	ConnectionRequest:    "CONNECTION_REQUEST",
	ConnectionDenied:     "CONNECTION_DENIED",
	ConnectionChallenge:  "CONNECTION_CHALLENGE",
	ConnectionResponse:   "CONNECTION_RESPONSE",
	ConnectionKeepAlive:  "CONNECTION_KEEPALIVE",
	ConnectionPayload:    "CONNECTION_PAYLOAD",
	ConnectionDisconnect: "CONNECTION_DISCONNECT",
}

// not a packet type, but value is last packetType+1
const ConnectionNumPackets = ConnectionDisconnect + 1

// Packet interface supporting reading and writing.
type Packet interface {
	GetType() PacketType                                                                                                                                                    // The type of packet
	Sequence() uint64                                                                                                                                                       // sequence number of this packet, if it supports it                                                                                                                                           // returns the packet type
	Write(buf []byte, protocolId, sequence uint64, writePacketKey []byte) (int, error)                                                                                      // writes and encrypts the packet data to the supplied buffer.
	Read(packetData []byte, packetLen int, protocolId, currentTimestamp uint64, readPacketKey, privateKey, allowedPackets []byte, replayProtection *ReplayProtection) error // reads in and decrypts from the supplied buffer to set the packet properties
}

// Returns the type of packet given packetbuffer by peaking the packet type
func NewPacket(packetBuffer []byte) Packet {
	var packetType PacketType
	t := packetType.Peek(packetBuffer)
	switch t {
	case ConnectionRequest:
		return &RequestPacket{}
	case ConnectionDenied:
		return &DeniedPacket{}
	case ConnectionChallenge:
		return &ChallengePacket{}
	case ConnectionResponse:
		return &ResponsePacket{}
	case ConnectionKeepAlive:
		return &KeepAlivePacket{}
	case ConnectionPayload:
		return &PayloadPacket{}
	case ConnectionDisconnect:
		return &DisconnectPacket{}
	}
	return nil
}

// The connection request packet
type RequestPacket struct {
	VersionInfo                 []byte               // version information of communications
	ProtocolId                  uint64               // protocol id used in communications
	ConnectTokenExpireTimestamp uint64               // when the connect token expires
	ConnectTokenSequence        uint64               // the sequence id of this token
	Token                       *ConnectTokenPrivate // reference to the private parts of this packet
	ConnectTokenData            []byte               // the encrypted Token after Write -> Encrypt
}

// request packets do not have a sequence value
func (p *RequestPacket) Sequence() uint64 {
	return 0
}

// Writes the RequestPacket data to a supplied buffer and returns the length of bytes written to it.
func (p *RequestPacket) Write(buf []byte, protocolId, sequence uint64, writePacketKey []byte) (int, error) {
	buffer := NewBufferFromRef(buf)
	buffer.WriteUint8(uint8(ConnectionRequest))
	buffer.WriteBytes(p.VersionInfo)
	buffer.WriteUint64(p.ProtocolId)
	buffer.WriteUint64(p.ConnectTokenExpireTimestamp)
	buffer.WriteUint64(p.ConnectTokenSequence)
	buffer.WriteBytes(p.ConnectTokenData) // write the encrypted connection token private data
	if buffer.Pos != 1+13+8+8+8+CONNECT_TOKEN_PRIVATE_BYTES {
		return -1, ErrInvalidBufferSize
	}
	return buffer.Pos, nil
}

// Reads a request packet and decrypts the connect token private data. Request packets do not return a sequenceId
func (p *RequestPacket) Read(packetData []byte, packetLen int, protocolId, currentTimestamp uint64, readPacketKey, privateKey, allowedPackets []byte, replayProtection *ReplayProtection) error {
	var err error
	var packetType uint8
	packetBuffer := NewBufferFromRef(packetData)
	if packetType, err = packetBuffer.GetUint8(); err != nil || PacketType(packetType) != ConnectionRequest {
		return ErrInvalidPacket
	}

	if allowedPackets[0] == 0 {
		return ErrRequestPacketTypeNotAllowed
	}

	if packetLen != 1+VERSION_INFO_BYTES+8+8+8+CONNECT_TOKEN_PRIVATE_BYTES {
		return ErrRequestBadPacketLength
	}

	if privateKey == nil {
		return ErrRequestPacketNoPrivateKey
	}

	p.VersionInfo, err = packetBuffer.GetBytes(VERSION_INFO_BYTES)
	if err != nil {
		return ErrRequestPacketBadVersionInfoBytes
	}

	if string(p.VersionInfo) != VERSION_INFO {
		return ErrRequestPacketBadVersionInfo
	}

	p.ProtocolId, err = packetBuffer.GetUint64()
	if err != nil || p.ProtocolId != protocolId {
		return ErrRequestPacketBadProtocolId
	}

	p.ConnectTokenExpireTimestamp, err = packetBuffer.GetUint64()
	if err != nil || p.ConnectTokenExpireTimestamp <= currentTimestamp {
		return ErrRequestPacketConnectTokenExpired
	}

	p.ConnectTokenSequence, err = packetBuffer.GetUint64()
	if err != nil {
		return err
	}

	if packetBuffer.Pos != 1+VERSION_INFO_BYTES+8+8+8 {
		return ErrRequestPacketBufferInvalidLength
	}

	var tokenBuffer []byte
	tokenBuffer, err = packetBuffer.GetBytes(CONNECT_TOKEN_PRIVATE_BYTES)
	if err != nil {
		return err
	}

	p.Token = NewConnectTokenPrivateEncrypted(tokenBuffer)
	if _, err := p.Token.Decrypt(p.ProtocolId, p.ConnectTokenExpireTimestamp, p.ConnectTokenSequence, privateKey); err != nil {
		return fmt.Errorf("error decrypting connect token private data: %s", err)
	}

	if err := p.Token.Read(); err != nil {
		return fmt.Errorf("error reading decrypted connect token private data: %s", err)
	}

	return nil
}

func (p *RequestPacket) GetType() PacketType {
	return ConnectionRequest
}

// Denied packet type, contains no information
type DeniedPacket struct {
	sequence uint64
}

func (p *DeniedPacket) Sequence() uint64 {
	return p.sequence
}

func (p *DeniedPacket) Write(buf []byte, protocolId, sequence uint64, writePacketKey []byte) (int, error) {
	buffer := NewBufferFromRef(buf)

	prefixByte, err := writePacketPrefix(p, buffer, sequence)
	if err != nil {
		return -1, err
	}

	// denied packets are empty
	return encryptPacket(buffer, buffer.Pos, buffer.Pos, prefixByte, protocolId, sequence, writePacketKey)
}

func (p *DeniedPacket) Read(packetData []byte, packetLen int, protocolId, currentTimestamp uint64, readPacketKey, privateKey, allowedPackets []byte, replayProtection *ReplayProtection) error {
	packetBuffer := NewBufferFromRef(packetData)
	sequence, decryptedBuf, err := decryptPacket(packetBuffer, packetLen, protocolId, readPacketKey, allowedPackets, replayProtection)
	if err != nil {
		return err
	}
	p.sequence = sequence

	if decryptedBuf.Len() != 0 {
		return ErrDeniedPacketDecryptedDataSize
	}
	return nil
}

func (p *DeniedPacket) GetType() PacketType {
	return ConnectionDenied
}

// Challenge packet containing token data and the sequence id used
type ChallengePacket struct {
	sequence               uint64
	ChallengeTokenSequence uint64
	ChallengeTokenData     []byte
}

func (p *ChallengePacket) Sequence() uint64 {
	return p.sequence
}

func (p *ChallengePacket) Write(buf []byte, protocolId, sequence uint64, writePacketKey []byte) (int, error) {
	buffer := NewBufferFromRef(buf)
	prefixByte, err := writePacketPrefix(p, buffer, sequence)
	if err != nil {
		return -1, err
	}

	encryptedStart := buffer.Pos
	buffer.WriteUint64(p.ChallengeTokenSequence)
	buffer.WriteBytesN(p.ChallengeTokenData, CHALLENGE_TOKEN_BYTES)
	encryptedFinish := buffer.Pos
	return encryptPacket(buffer, encryptedStart, encryptedFinish, prefixByte, protocolId, sequence, writePacketKey)
}

func (p *ChallengePacket) Read(packetData []byte, packetLen int, protocolId, currentTimestamp uint64, readPacketKey, privateKey, allowedPackets []byte, replayProtection *ReplayProtection) error {
	packetBuffer := NewBufferFromRef(packetData)
	sequence, decryptedBuf, err := decryptPacket(packetBuffer, packetLen, protocolId, readPacketKey, allowedPackets, replayProtection)
	if err != nil {
		return err
	}

	p.sequence = sequence
	if decryptedBuf.Len() != 8+CHALLENGE_TOKEN_BYTES {
		return ErrChallengePacketDecryptedDataSize
	}

	p.ChallengeTokenSequence, err = decryptedBuf.GetUint64()
	if err != nil {
		return ErrChallengePacketTokenSequence
	}

	p.ChallengeTokenData, err = decryptedBuf.GetBytes(CHALLENGE_TOKEN_BYTES)
	if err != nil {
		return ErrChallengePacketTokenData
	}

	return nil
}

func (p *ChallengePacket) GetType() PacketType {
	return ConnectionChallenge
}

// Response packet, containing the token data and sequence id
type ResponsePacket struct {
	sequence               uint64
	ChallengeTokenSequence uint64
	ChallengeTokenData     []byte
}

func (p *ResponsePacket) Sequence() uint64 {
	return p.sequence
}

func (p *ResponsePacket) Write(buf []byte, protocolId, sequence uint64, writePacketKey []byte) (int, error) {
	buffer := NewBufferFromRef(buf)
	prefixByte, err := writePacketPrefix(p, buffer, sequence)
	if err != nil {
		return -1, err
	}

	encryptedStart := buffer.Pos
	buffer.WriteUint64(p.ChallengeTokenSequence)
	buffer.WriteBytesN(p.ChallengeTokenData, CHALLENGE_TOKEN_BYTES)
	encryptedFinish := buffer.Pos
	return encryptPacket(buffer, encryptedStart, encryptedFinish, prefixByte, protocolId, sequence, writePacketKey)
}

func (p *ResponsePacket) Read(packetData []byte, packetLen int, protocolId, currentTimestamp uint64, readPacketKey, privateKey, allowedPackets []byte, replayProtection *ReplayProtection) error {
	packetBuffer := NewBufferFromRef(packetData)
	sequence, decryptedBuf, err := decryptPacket(packetBuffer, packetLen, protocolId, readPacketKey, allowedPackets, replayProtection)
	if err != nil {
		return err
	}
	p.sequence = sequence

	if decryptedBuf.Len() != 8+CHALLENGE_TOKEN_BYTES {
		return ErrResponsePacketDecryptedDataSize
	}

	p.ChallengeTokenSequence, err = decryptedBuf.GetUint64()
	if err != nil {
		return ErrResponsePacketTokenSequence
	}

	p.ChallengeTokenData, err = decryptedBuf.GetBytes(CHALLENGE_TOKEN_BYTES)
	if err != nil {
		return ErrResponsePacketTokenData
	}

	return nil
}

func (p *ResponsePacket) GetType() PacketType {
	return ConnectionResponse
}

// used for heart beats
type KeepAlivePacket struct {
	sequence    uint64
	ClientIndex uint32
	MaxClients  uint32
}

func (p *KeepAlivePacket) Sequence() uint64 {
	return p.sequence
}

func (p *KeepAlivePacket) Write(buf []byte, protocolId, sequence uint64, writePacketKey []byte) (int, error) {
	buffer := NewBufferFromRef(buf)
	prefixByte, err := writePacketPrefix(p, buffer, sequence)
	if err != nil {
		return -1, err
	}

	encryptedStart := buffer.Pos
	buffer.WriteUint32(uint32(p.ClientIndex))
	buffer.WriteUint32(uint32(p.MaxClients))
	encryptedFinish := buffer.Pos
	return encryptPacket(buffer, encryptedStart, encryptedFinish, prefixByte, protocolId, sequence, writePacketKey)
}

func (p *KeepAlivePacket) Read(packetData []byte, packetLen int, protocolId, currentTimestamp uint64, readPacketKey, privateKey, allowedPackets []byte, replayProtection *ReplayProtection) error {
	packetBuffer := NewBufferFromRef(packetData)
	sequence, decryptedBuf, err := decryptPacket(packetBuffer, packetLen, protocolId, readPacketKey, allowedPackets, replayProtection)
	if err != nil {
		return err
	}
	p.sequence = sequence

	if decryptedBuf.Len() != 8 {
		return ErrKeepAlivePacketDecryptedDataSize
	}

	p.ClientIndex, err = decryptedBuf.GetUint32()
	if err != nil {
		return ErrKeepAlivePacketClientIndex
	}

	p.MaxClients, err = decryptedBuf.GetUint32()
	if err != nil {
		return ErrKeepAlivePacketMaxClients
	}

	return nil
}

func (p *KeepAlivePacket) GetType() PacketType {
	return ConnectionKeepAlive
}

// Contains user supplied payload data between server <-> client
type PayloadPacket struct {
	sequence     uint64
	PayloadBytes uint32
	PayloadData  []byte
}

func (p *PayloadPacket) GetType() PacketType {
	return ConnectionPayload
}

// Helper function to create a new payload packet with the supplied buffer
func NewPayloadPacket(payloadData []byte) *PayloadPacket {
	packet := &PayloadPacket{}
	packet.PayloadBytes = uint32(len(payloadData))
	packet.PayloadData = payloadData
	return packet
}

func (p *PayloadPacket) Sequence() uint64 {
	return p.sequence
}

func (p *PayloadPacket) Write(buf []byte, protocolId, sequence uint64, writePacketKey []byte) (int, error) {
	buffer := NewBufferFromRef(buf)
	prefixByte, err := writePacketPrefix(p, buffer, sequence)
	if err != nil {
		return -1, err
	}
	encryptedStart := buffer.Pos
	buffer.WriteBytesN(p.PayloadData, int(p.PayloadBytes))
	encryptedFinish := buffer.Pos
	return encryptPacket(buffer, encryptedStart, encryptedFinish, prefixByte, protocolId, sequence, writePacketKey)
}

func (p *PayloadPacket) Read(packetData []byte, packetLen int, protocolId, currentTimestamp uint64, readPacketKey, privateKey, allowedPackets []byte, replayProtection *ReplayProtection) error {
	packetBuffer := NewBufferFromRef(packetData)
	sequence, decryptedBuf, err := decryptPacket(packetBuffer, packetLen, protocolId, readPacketKey, allowedPackets, replayProtection)
	if err != nil {
		return err
	}
	p.sequence = sequence

	decryptedSize := uint32(decryptedBuf.Len())
	if decryptedSize < 1 {
		return ErrPayloadPacketTooSmall
	}

	if decryptedSize > MAX_PAYLOAD_BYTES {
		return ErrPayloadPacketTooLarge
	}

	p.PayloadBytes = decryptedSize
	p.PayloadData = decryptedBuf.Bytes()
	return nil
}

// Signals to server/client to disconnect, contains no data.
type DisconnectPacket struct {
	sequence uint64
}

func (p *DisconnectPacket) Sequence() uint64 {
	return p.sequence
}

func (p *DisconnectPacket) Write(buf []byte, protocolId, sequence uint64, writePacketKey []byte) (int, error) {
	buffer := NewBufferFromRef(buf)
	prefixByte, err := writePacketPrefix(p, buffer, sequence)
	if err != nil {
		return -1, err
	}

	// denied packets are empty
	return encryptPacket(buffer, buffer.Pos, buffer.Pos, prefixByte, protocolId, sequence, writePacketKey)
}

func (p *DisconnectPacket) Read(packetData []byte, packetLen int, protocolId, currentTimestamp uint64, readPacketKey, privateKey, allowedPackets []byte, replayProtection *ReplayProtection) error {
	packetBuffer := NewBufferFromRef(packetData)
	sequence, decryptedBuf, err := decryptPacket(packetBuffer, packetLen, protocolId, readPacketKey, allowedPackets, replayProtection)
	if err != nil {
		return err
	}
	p.sequence = sequence

	if decryptedBuf.Len() != 0 {
		return ErrDisconnectPacketDecryptedDataSize
	}
	return nil
}

func (p *DisconnectPacket) GetType() PacketType {
	return ConnectionDisconnect
}

// Decrypts the packet after reading in the prefix byte and sequence id. Used for all PacketTypes except RequestPacket. Returns a buffer containing the decrypted data
func decryptPacket(packetBuffer *Buffer, packetLen int, protocolId uint64, readPacketKey, allowedPackets []byte, replayProtection *ReplayProtection) (uint64, *Buffer, error) {
	var packetSequence uint64

	prefixByte, err := packetBuffer.GetUint8()
	if err != nil {
		return 0, nil, ErrInvalidBufferLength
	}

	if packetSequence, err = readSequence(packetBuffer, packetLen, prefixByte); err != nil {
		return 0, nil, err
	}

	if err := validateSequence(packetLen, prefixByte, packetSequence, readPacketKey, allowedPackets, replayProtection); err != nil {
		return 0, nil, err
	}

	// decrypt the per-packet type data
	additionalData, nonce := packetCryptData(prefixByte, protocolId, packetSequence)

	encryptedSize := packetLen - packetBuffer.Pos
	if encryptedSize < MAC_BYTES {
		return 0, nil, ErrDecryptPacketPayloadTooSmall
	}

	encryptedBuff, err := packetBuffer.GetBytes(encryptedSize)
	if err != nil {
		return 0, nil, ErrDecryptPacketPayloadTooSmall
	}

	decryptedBuff, err := DecryptAead(encryptedBuff, additionalData, nonce, readPacketKey)
	if err != nil {
		return 0, nil, fmt.Errorf("ignored encrypted packet. failed to decrypt: %s", err)
	}

	return packetSequence, NewBufferFromRef(decryptedBuff), nil
}

// Reads and verifies the sequence id
func readSequence(packetBuffer *Buffer, packetLen int, prefixByte uint8) (uint64, error) {
	var sequence uint64

	sequenceBytes := prefixByte >> 4
	if sequenceBytes < 1 || sequenceBytes > 8 {
		return 0, ErrEncryptedPacketSequenceOutOfRange
	}

	if packetLen < 1+int(sequenceBytes)+MAC_BYTES {
		return 0, ErrEncryptedPacketBufferTooSmall
	}

	var i uint8
	// read variable length sequence number [1,8]
	for i = 0; i < sequenceBytes; i += 1 {
		val, err := packetBuffer.GetUint8()
		if err != nil {
			return 0, err
		}
		sequence |= (uint64(val) << (8 * i))
	}
	return sequence, nil
}

// Validates the data prior to the encrypted segment before we bother attempting to decrypt.
func validateSequence(packetLen int, prefixByte uint8, sequence uint64, readPacketKey, allowedPackets []byte, replayProtection *ReplayProtection) error {
	if readPacketKey == nil {
		return ErrEmptyPacketKey
	}

	if packetLen < 1+1+MAC_BYTES {
		return ErrEncryptedPacketTooSmall
	}

	packetType := prefixByte & 0xF
	if PacketType(packetType) >= ConnectionNumPackets {
		return fmt.Errorf("ignored encrypted packet. packet type %s is invalid", packetTypeMap[PacketType(packetType)])
	}

	if allowedPackets[packetType] == 0 {
		return fmt.Errorf("ignored encrypted packet. packet type %s is invalid", packetTypeMap[PacketType(packetType)])
	}

	// replay protection (optional)
	if replayProtection != nil && PacketType(packetType) >= ConnectionKeepAlive {
		if replayProtection.AlreadyReceived(sequence) {
			return fmt.Errorf("ignored connection payload packet. sequence %d already received (replay protection)", sequence)
		}
	}
	return nil
}

// write the prefix byte (this is a combination of the packet type and number of sequence bytes)
func writePacketPrefix(p Packet, buffer *Buffer, sequence uint64) (uint8, error) {
	sequenceBytes := sequenceNumberBytesRequired(sequence)
	if sequenceBytes < 1 || sequenceBytes > 8 {
		return 0, ErrInvalidSequenceBytes
	}

	prefixByte := uint8(p.GetType()) | uint8(sequenceBytes<<4)
	buffer.WriteUint8(prefixByte)

	sequenceTemp := sequence

	var i uint8
	for ; i < sequenceBytes; i += 1 {
		buffer.WriteUint8(uint8(sequenceTemp & 0xFF))
		sequenceTemp >>= 8
	}
	return prefixByte, nil
}

// Encrypts the packet data of the supplied buffer between encryptedStart and encrypedFinish.
func encryptPacket(buffer *Buffer, encryptedStart, encryptedFinish int, prefixByte uint8, protocolId, sequence uint64, writePacketKey []byte) (int, error) {
	// slice up the buffer for the bits we will encrypt
	encryptedBuffer := buffer.Buf[encryptedStart:encryptedFinish]

	additionalData, nonce := packetCryptData(prefixByte, protocolId, sequence)

	if err := EncryptAead(encryptedBuffer, additionalData, nonce, writePacketKey); err != nil {
		return -1, err
	}

	buffer.Pos += MAC_BYTES
	return buffer.Pos, nil
}

// used for encrypting the per-packet packet written with the prefix byte, protocol id and version as the associated data. this must match to decrypt.
func packetCryptData(prefixByte uint8, protocolId, sequence uint64) ([]byte, []byte) {
	additionalData := NewBuffer(VERSION_INFO_BYTES + 8 + 1)
	additionalData.WriteBytesN([]byte(VERSION_INFO), VERSION_INFO_BYTES)
	additionalData.WriteUint64(protocolId)
	additionalData.WriteUint8(prefixByte)

	nonce := NewBuffer(SizeUint64 + SizeUint32)
	nonce.WriteUint32(0)
	nonce.WriteUint64(sequence)
	return additionalData.Buf, nonce.Buf
}

// Depending on size of sequence number, we need to reserve N bytes
func sequenceNumberBytesRequired(sequence uint64) uint8 {
	var mask uint64
	mask = 0xFF00000000000000
	var i uint8
	for ; i < 7; i += 1 {
		if sequence&mask != 0 {
			break
		}
		mask >>= 8
	}
	return 8 - i
}
