package netcode

import (
	"bytes"
	"net"
	"testing"
	"time"
)

func TestSequence(t *testing.T) {
	seq := sequenceNumberBytesRequired(0)
	if seq != 1 {
		t.Fatal("expected 0, got: ", seq)
	}

	seq = sequenceNumberBytesRequired(0x11)
	if seq != 1 {
		t.Fatal("expected 1, got: ", seq)
	}

	seq = sequenceNumberBytesRequired(0x1122)
	if seq != 2 {
		t.Fatal("expected 2, got: ", seq)
	}

	seq = sequenceNumberBytesRequired(0x112233)
	if seq != 3 {
		t.Fatal("expected 3, got: ", seq)
	}

	seq = sequenceNumberBytesRequired(0x11223344)
	if seq != 4 {
		t.Fatal("expected 4, got: ", seq)
	}

	seq = sequenceNumberBytesRequired(0x1122334455)
	if seq != 5 {
		t.Fatal("expected 5, got: ", seq)
	}

	seq = sequenceNumberBytesRequired(0x112233445566)
	if seq != 6 {
		t.Fatal("expected 6, got: ", seq)
	}

	seq = sequenceNumberBytesRequired(0x11223344556677)
	if seq != 7 {
		t.Fatal("expected 7, got: ", seq)
	}

	seq = sequenceNumberBytesRequired(0x1122334455667788)
	if seq != 8 {
		t.Fatal("expected 8, got: ", seq)
	}

}

func TestConnectionRequestPacket(t *testing.T) {
	connectTokenKey, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating connect token key: %s\n", err)
	}
	inputPacket, decryptedToken := testBuildRequestPacket(connectTokenKey, t)

	// write the connection request packet to a buffer
	buffer := make([]byte, 2048)
	packetKey, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating key")
	}

	bytesWritten, err := inputPacket.Write(buffer, TEST_PROTOCOL_ID, TEST_SEQUENCE_START, packetKey)
	if err != nil {
		t.Fatalf("error writing packet: %s\n", err)
	}

	if bytesWritten <= 0 {
		t.Fatalf("did not write any bytes for this packet")
	}

	allowedPackets := make([]byte, ConnectionNumPackets)
	for i := 0; i < len(allowedPackets); i += 1 {
		allowedPackets[i] = 1
	}

	outputPacket := &RequestPacket{}

	//
	if err := outputPacket.Read(buffer, bytesWritten, TEST_PROTOCOL_ID, uint64(time.Now().Unix()), packetKey, connectTokenKey, allowedPackets, nil); err != nil {
		t.Fatalf("error reading packet: %s\n", err)
	}

	if !bytes.Equal(inputPacket.VersionInfo, outputPacket.VersionInfo) {
		t.Fatalf("version info did not match")
	}

	if inputPacket.ProtocolId != outputPacket.ProtocolId {
		t.Fatalf("ProtocolId did not match")
	}

	if inputPacket.ConnectTokenExpireTimestamp != outputPacket.ConnectTokenExpireTimestamp {
		t.Fatalf("ConnectTokenExpireTimestamp did not match")
	}

	if inputPacket.ConnectTokenSequence != outputPacket.ConnectTokenSequence {
		t.Fatalf("ConnectTokenSequence did not match")
	}

	if bytes.Compare(decryptedToken, outputPacket.Token.TokenData.Buf) != 0 {
		t.Fatalf("TokenData did not match")
	}
}

func TestConnectionDeniedPacket(t *testing.T) {
	// setup a connection denied packet
	inputPacket := &DeniedPacket{}

	buffer := make([]byte, MAX_PACKET_BYTES)

	packetKey, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating key")
	}

	// write the packet to a buffer
	bytesWritten, err := inputPacket.Write(buffer, TEST_PROTOCOL_ID, TEST_SEQUENCE_START, packetKey)
	if err != nil {
		t.Fatalf("error writing packet: %s\n", err)
	}

	if bytesWritten <= 0 {
		t.Fatalf("did not write any bytes for this packet")
	}

	allowedPackets := make([]byte, ConnectionNumPackets)
	for i := 0; i < len(allowedPackets); i += 1 {
		allowedPackets[i] = 1
	}

	outputPacket := &DeniedPacket{}

	if err := outputPacket.Read(buffer, bytesWritten, TEST_PROTOCOL_ID, uint64(time.Now().Unix()), packetKey, nil, allowedPackets, nil); err != nil {
		t.Fatalf("error reading packet: %s\n", err)
	}

	if outputPacket.GetType() != ConnectionDenied {
		t.Fatalf("did not get a denied packet after read")
	}
}

func TestConnectionChallengePacket(t *testing.T) {
	var err error

	// setup a connection challenge packet
	inputPacket := &ChallengePacket{}
	inputPacket.ChallengeTokenSequence = 0
	inputPacket.ChallengeTokenData, err = RandomBytes(CHALLENGE_TOKEN_BYTES)
	if err != nil {
		t.Fatalf("error generating random bytes")
	}

	buffer := make([]byte, MAX_PACKET_BYTES)

	packetKey, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating key")
	}

	// write the packet to a buffer
	bytesWritten, err := inputPacket.Write(buffer, TEST_PROTOCOL_ID, TEST_SEQUENCE_START, packetKey)
	if err != nil {
		t.Fatalf("error writing packet: %s\n", err)
	}

	if bytesWritten <= 0 {
		t.Fatalf("did not write any bytes for this packet")
	}

	allowedPackets := make([]byte, ConnectionNumPackets)
	for i := 0; i < len(allowedPackets); i += 1 {
		allowedPackets[i] = 1
	}

	outputPacket := &ChallengePacket{}

	if err := outputPacket.Read(buffer, bytesWritten, TEST_PROTOCOL_ID, uint64(time.Now().Unix()), packetKey, nil, allowedPackets, nil); err != nil {
		t.Fatalf("error reading packet: %s\n", err)
	}

	if inputPacket.ChallengeTokenSequence != outputPacket.ChallengeTokenSequence {
		t.Fatalf("input and output sequence differed, expected %d got %d\n", inputPacket.ChallengeTokenSequence, outputPacket.ChallengeTokenSequence)
	}

	if !bytes.Equal(inputPacket.ChallengeTokenData, outputPacket.ChallengeTokenData) {
		t.Fatalf("challenge token data was not equal\n")
	}
}

func TestConnectionResponsePacket(t *testing.T) {
	var err error

	// setup a connection response packet
	inputPacket := &ResponsePacket{}
	inputPacket.ChallengeTokenSequence = 0
	inputPacket.ChallengeTokenData, err = RandomBytes(CHALLENGE_TOKEN_BYTES)
	if err != nil {
		t.Fatalf("error generating random bytes")
	}

	buffer := make([]byte, MAX_PACKET_BYTES)

	packetKey, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating key")
	}

	// write the packet to a buffer
	bytesWritten, err := inputPacket.Write(buffer, TEST_PROTOCOL_ID, TEST_SEQUENCE_START, packetKey)
	if err != nil {
		t.Fatalf("error writing packet: %s\n", err)
	}

	if bytesWritten <= 0 {
		t.Fatalf("did not write any bytes for this packet")
	}

	allowedPackets := make([]byte, ConnectionNumPackets)
	for i := 0; i < len(allowedPackets); i += 1 {
		allowedPackets[i] = 1
	}

	outputPacket := &ResponsePacket{}

	if err := outputPacket.Read(buffer, bytesWritten, TEST_PROTOCOL_ID, uint64(time.Now().Unix()), packetKey, nil, allowedPackets, nil); err != nil {
		t.Fatalf("error reading packet: %s\n", err)
	}

	if inputPacket.ChallengeTokenSequence != outputPacket.ChallengeTokenSequence {
		t.Fatalf("input and output sequence differed, expected %d got %d\n", inputPacket.ChallengeTokenSequence, outputPacket.ChallengeTokenSequence)
	}

	if !bytes.Equal(inputPacket.ChallengeTokenData, outputPacket.ChallengeTokenData) {
		t.Fatalf("response challenge token data was not equal\n")
	}
}

func TestConnectionKeepAlivePacket(t *testing.T) {
	var err error

	// setup a connection challenge packet
	inputPacket := &KeepAlivePacket{}
	inputPacket.ClientIndex = 10
	inputPacket.MaxClients = 16

	buffer := make([]byte, MAX_PACKET_BYTES)

	packetKey, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating key")
	}

	// write the packet to a buffer
	bytesWritten, err := inputPacket.Write(buffer, TEST_PROTOCOL_ID, TEST_SEQUENCE_START, packetKey)
	if err != nil {
		t.Fatalf("error writing packet: %s\n", err)
	}

	if bytesWritten <= 0 {
		t.Fatalf("did not write any bytes for this packet")
	}

	allowedPackets := make([]byte, ConnectionNumPackets)
	for i := 0; i < len(allowedPackets); i += 1 {
		allowedPackets[i] = 1
	}

	outputPacket := &KeepAlivePacket{}

	if err := outputPacket.Read(buffer, bytesWritten, TEST_PROTOCOL_ID, uint64(time.Now().Unix()), packetKey, nil, allowedPackets, nil); err != nil {
		t.Fatalf("error reading packet: %s\n", err)
	}

	if inputPacket.ClientIndex != outputPacket.ClientIndex {
		t.Fatalf("input and output index differed, expected %d got %d\n", inputPacket.ClientIndex, outputPacket.ClientIndex)
	}

	if inputPacket.MaxClients != outputPacket.MaxClients {
		t.Fatalf("input and output maxclients differed, expected %d got %d\n", inputPacket.MaxClients, outputPacket.MaxClients)
	}
}

func TestConnectionPayloadPacket(t *testing.T) {
	var err error
	payloadData, err := RandomBytes(MAX_PAYLOAD_BYTES)
	if err != nil {
		t.Fatalf("error generating random payload data: %s\n", err)
	}

	inputPacket := NewPayloadPacket(payloadData)

	buffer := make([]byte, MAX_PACKET_BYTES)

	packetKey, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating key")
	}

	// write the packet to a buffer
	bytesWritten, err := inputPacket.Write(buffer, TEST_PROTOCOL_ID, TEST_SEQUENCE_START, packetKey)
	if err != nil {
		t.Fatalf("error writing packet: %s\n", err)
	}

	if bytesWritten <= 0 {
		t.Fatalf("did not write any bytes for this packet")
	}

	allowedPackets := make([]byte, ConnectionNumPackets)
	for i := 0; i < len(allowedPackets); i += 1 {
		allowedPackets[i] = 1
	}

	outputPacket := &PayloadPacket{}

	if err := outputPacket.Read(buffer, bytesWritten, TEST_PROTOCOL_ID, uint64(time.Now().Unix()), packetKey, nil, allowedPackets, nil); err != nil {
		t.Fatalf("error reading packet: %s\n", err)
	}

	if inputPacket.PayloadBytes != outputPacket.PayloadBytes {
		t.Fatalf("input and output index differed, expected %d got %d\n", inputPacket.PayloadBytes, outputPacket.PayloadBytes)
	}

	if !bytes.Equal(inputPacket.PayloadData, outputPacket.PayloadData) {
		t.Fatalf("input and output payload differed, expected %v got %v\n", inputPacket.PayloadData, outputPacket.PayloadData)
	}
}

func TestDisconnectPacket(t *testing.T) {
	inputPacket := &DisconnectPacket{}
	buffer := make([]byte, MAX_PACKET_BYTES)

	packetKey, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating key")
	}

	// write the packet to a buffer
	bytesWritten, err := inputPacket.Write(buffer, TEST_PROTOCOL_ID, TEST_SEQUENCE_START, packetKey)
	if err != nil {
		t.Fatalf("error writing packet: %s\n", err)
	}

	if bytesWritten <= 0 {
		t.Fatalf("did not write any bytes for this packet")
	}

	allowedPackets := make([]byte, ConnectionNumPackets)
	for i := 0; i < len(allowedPackets); i += 1 {
		allowedPackets[i] = 1
	}

	outputPacket := &DisconnectPacket{}
	if err := outputPacket.Read(buffer, bytesWritten, TEST_PROTOCOL_ID, uint64(time.Now().Unix()), packetKey, nil, allowedPackets, nil); err != nil {
		t.Fatalf("error reading packet: %s\n", err)
	}

}

func testBuildRequestPacket(connectTokenKey []byte, t *testing.T) (*RequestPacket, []byte) {
	addr := net.UDPAddr{IP: net.ParseIP("::"), Port: TEST_SERVER_PORT}
	serverAddrs := make([]net.UDPAddr, 1)
	serverAddrs[0] = addr

	connectToken := testGenerateConnectToken(serverAddrs, connectTokenKey, t)

	_, err := connectToken.Write()
	if err != nil {
		t.Fatalf("error writing private data: %s\n", err)
	}

	tokenData, err := connectToken.PrivateData.Decrypt(TEST_PROTOCOL_ID, connectToken.ExpireTimestamp, TEST_SEQUENCE_START, connectTokenKey)
	if err != nil {
		t.Fatalf("error decrypting connect token: %s", err)
	}
	decryptedToken := make([]byte, len(tokenData))
	copy(decryptedToken, tokenData)

	// need to re-encrypt the private data
	connectToken.PrivateData.TokenData.Reset()
	// have to regrow the slice to contain MAC_BYTES
	mac := make([]byte, MAC_BYTES)
	connectToken.PrivateData.TokenData.Buf = append(connectToken.PrivateData.TokenData.Buf, mac...)
	if err := connectToken.PrivateData.Encrypt(TEST_PROTOCOL_ID, connectToken.ExpireTimestamp, TEST_SEQUENCE_START, connectTokenKey); err != nil {
		t.Fatalf("error re-encrypting connect private token: %s\n", err)
	}

	// setup a connection request packet wrapping the encrypted connect token
	inputPacket := &RequestPacket{}
	inputPacket.VersionInfo = []byte(VERSION_INFO)
	inputPacket.ProtocolId = TEST_PROTOCOL_ID
	inputPacket.ConnectTokenExpireTimestamp = connectToken.ExpireTimestamp
	inputPacket.ConnectTokenSequence = TEST_SEQUENCE_START
	inputPacket.Token = connectToken.PrivateData
	inputPacket.ConnectTokenData = connectToken.PrivateData.Buffer()
	return inputPacket, decryptedToken
}
