package netcode

import (
	"bytes"
	"net"
	"testing"
	"time"
)

func TestConnectTokenPrivate(t *testing.T) {

	server := net.UDPAddr{IP: net.ParseIP("::1"), Port: 40000}
	servers := make([]net.UDPAddr, 1)
	servers[0] = server

	currentTimestamp := uint64(time.Now().Unix())
	expireTimestamp := uint64(currentTimestamp + TEST_CONNECT_TOKEN_EXPIRY)
	timeoutSeconds := (int32)(10)

	userData, err := RandomBytes(USER_DATA_BYTES)
	if err != nil {
		t.Fatalf("error generating random bytes: %s\n", err)
	}

	token1 := NewConnectTokenPrivate(TEST_CLIENT_ID, timeoutSeconds, servers, userData)
	if err := token1.Generate(); err != nil {
		t.Fatalf("error generating key: %s\n", err)
	}

	if _, err := token1.Write(); err != nil {
		t.Fatalf("error writing token private data")
	}

	if err := token1.Encrypt(TEST_PROTOCOL_ID, expireTimestamp, TEST_SEQUENCE_START, TEST_PRIVATE_KEY); err != nil {
		t.Fatalf("error encrypting token: %s\n", err)
	}

	encryptedToken := make([]byte, len(token1.Buffer()))
	copy(encryptedToken, token1.Buffer())
	token2 := NewConnectTokenPrivateEncrypted(encryptedToken)

	if _, err := token2.Decrypt(TEST_PROTOCOL_ID, expireTimestamp, TEST_SEQUENCE_START, TEST_PRIVATE_KEY); err != nil {
		t.Fatalf("error decrypting token: %s", err)
	}

	if err := token2.Read(); err != nil {
		t.Fatalf("error reading token: %s\n", err)
	}

	testComparePrivateTokens(token1, token2, t)

	token2.TokenData.Reset()

	// have to regrow the slice to contain space for MAC_BYTES
	mac := make([]byte, MAC_BYTES)
	token2.TokenData.Buf = append(token2.TokenData.Buf, mac...)

	if _, err = token2.Write(); err != nil {
		t.Fatalf("error writing token2 buffer")
	}

	if err := token2.Encrypt(TEST_PROTOCOL_ID, expireTimestamp, TEST_SEQUENCE_START, TEST_PRIVATE_KEY); err != nil {
		t.Fatalf("error encrypting second token: %s\n", err)
	}

	if len(token1.Buffer()) != len(token2.Buffer()) {
		t.Fatalf("encrypted buffer lengths did not match %d and %d\n", len(token1.Buffer()), len(token2.Buffer()))
	}

	if !bytes.Equal(token1.Buffer(), token2.Buffer()) {
		t.Fatalf("encrypted private bits didn't match\n%#v\n and\n%#v\n", token1.Buffer(), token2.Buffer())
	}
}

func testComparePrivateTokens(token1, token2 *ConnectTokenPrivate, t *testing.T) {
	if token1.ClientId != token2.ClientId {
		t.Fatalf("clientIds do not match expected %d got %d", token1.ClientId, token2.ClientId)
	}

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

func testCompareAddrs(addr1, addr2 net.UDPAddr, t *testing.T) {
	if addr1.IP.String() != addr2.IP.String() {
		t.Fatalf("ip addresses were not equal: %s and %s\n", addr1.IP.String(), addr2.IP.String())
	}

	if addr1.Port != addr2.Port {
		t.Fatalf("server ports did not match: expected %s got %s\n", addr1.Port, addr2.Port)
	}

}
