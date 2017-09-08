package netcode

import (
	"bytes"
	"net"
	"testing"
)

const (
	TEST_PROTOCOL_ID          = 0x1122334455667788
	TEST_CONNECT_TOKEN_EXPIRY = 30
	TEST_SERVER_PORT          = 40000
	TEST_CLIENT_ID            = 0x1
	TEST_SEQUENCE_START       = 1000
	TEST_TIMEOUT_SECONDS      = 15
)

var TEST_PRIVATE_KEY = []byte{0x60, 0x6a, 0xbe, 0x6e, 0xc9, 0x19, 0x10, 0xea,
	0x9a, 0x65, 0x62, 0xf6, 0x6f, 0x2b, 0x30, 0xe4,
	0x43, 0x71, 0xd6, 0x2c, 0xd1, 0x99, 0x27, 0x26,
	0x6b, 0x3c, 0x60, 0xf4, 0xb7, 0x15, 0xab, 0xa1}

func TestConnectToken(t *testing.T) {
	var err error
	var tokenBuffer []byte
	var key []byte

	servers := testServers()

	if key, err = GenerateKey(); err != nil {
		t.Fatalf("error generating key %s\n", key)
	}

	inToken := testGenerateConnectToken(servers, key, t)

	// Writes the entire ConnectToken (including Private)
	if tokenBuffer, err = inToken.Write(); err != nil {
		t.Fatalf("error writing token: %s\n", err)
	}

	outToken, err := ReadConnectToken(tokenBuffer)
	if err != nil {
		t.Fatalf("error re-reading back token buffer: %s\n", err)
	}

	if string(inToken.VersionInfo) != string(outToken.VersionInfo) {
		t.Fatalf("version info did not match expected: %s got: %s\n", inToken.VersionInfo, outToken.VersionInfo)
	}

	if inToken.ProtocolId != outToken.ProtocolId {
		t.Fatalf("ProtocolId did not match expected: %s got: %s\n", inToken.ProtocolId, outToken.ProtocolId)
	}

	if inToken.CreateTimestamp != outToken.CreateTimestamp {
		t.Fatalf("CreateTimestamp did not match expected: %s got: %s\n", inToken.CreateTimestamp, outToken.CreateTimestamp)
	}

	if inToken.ExpireTimestamp != outToken.ExpireTimestamp {
		t.Fatalf("ExpireTimestamp did not match expected: %s got: %s\n", inToken.ExpireTimestamp, outToken.ExpireTimestamp)
	}

	if inToken.Sequence != outToken.Sequence {
		t.Fatalf("Sequence did not match expected: %s got: %s\n", inToken.Sequence, outToken.Sequence)
	}

	testCompareTokens(inToken, outToken, t)

	if bytes.Compare(inToken.PrivateData.Buffer(), outToken.PrivateData.Buffer()) != 0 {
		t.Fatalf("encrypted private data of tokens did not match\n%#v\n%#v", inToken.PrivateData.Buffer(), outToken.PrivateData.Buffer())
	}

	// need to decrypt the private tokens before we can compare
	if _, err := outToken.PrivateData.Decrypt(TEST_PROTOCOL_ID, outToken.ExpireTimestamp, outToken.Sequence, key); err != nil {
		t.Fatalf("error decrypting private out token data: %s\n", err)
	}

	if _, err := inToken.PrivateData.Decrypt(TEST_PROTOCOL_ID, inToken.ExpireTimestamp, inToken.Sequence, key); err != nil {
		t.Fatalf("error decrypting private in token data: %s\n", err)
	}

	// and re-read to set the properties in outToken private
	if err := outToken.PrivateData.Read(); err != nil {
		t.Fatalf("error reading private data %s", err)
	}

	testComparePrivateTokens(inToken.PrivateData, outToken.PrivateData, t)
}

func testGenerateConnectToken(servers []net.UDPAddr, privateKey []byte, t *testing.T) *ConnectToken {
	if privateKey == nil {
		privateKey = TEST_PRIVATE_KEY
	}

	userData, err := RandomBytes(USER_DATA_BYTES)
	if err != nil {
		t.Fatalf("error generating userdata bytes: %s\n", err)
	}

	connectToken := NewConnectToken()
	// generate will write & encrypt the ConnectTokenPrivate
	if err := connectToken.Generate(TEST_CLIENT_ID, servers, VERSION_INFO, TEST_PROTOCOL_ID, TEST_CONNECT_TOKEN_EXPIRY, TEST_TIMEOUT_SECONDS, TEST_SEQUENCE_START, userData, privateKey); err != nil {
		t.Fatalf("error generating token: %s\n", err)
	}
	return connectToken
}

func testServers() []net.UDPAddr {
	server := net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 40000}
	servers := make([]net.UDPAddr, 1)
	servers[0] = server
	return servers
}

func testCompareTokens(token1, token2 *ConnectToken, t *testing.T) {
	if len(token1.ServerAddrs) != len(token2.ServerAddrs) {
		t.Fatalf("time stamps do not match expected %d got %d", len(token1.ServerAddrs), len(token2.ServerAddrs))
	}

	token1Servers := token1.ServerAddrs
	token2Servers := token2.ServerAddrs

	for i := 0; i < len(token1.ServerAddrs); i += 1 {
		testCompareAddrs(token1Servers[i], token2Servers[i], t)
	}

	if !bytes.Equal(token1.ClientKey, token2.ClientKey) {
		t.Fatalf("ClientKey do not match expected %v got %v", token1.ClientKey, token2.ClientKey)
	}

	if !bytes.Equal(token1.ServerKey, token2.ServerKey) {
		t.Fatalf("ServerKey do not match expected %v got %v", token1.ServerKey, token2.ServerKey)
	}
}
