package netcode

import (
	"bytes"
	"net"
	"testing"
)

func TestReadWriteShared(t *testing.T) {
	var err error
	var clientKey []byte
	var serverKey []byte
	clientKey, err = RandomBytes(KEY_BYTES)
	if err != nil {
		t.Fatalf("error generating client key")
	}

	serverKey, err = RandomBytes(KEY_BYTES)
	if err != nil {
		t.Fatalf("error generating server key")
	}

	server := net.UDPAddr{IP: net.ParseIP("::1"), Port: 40000}
	data := &sharedTokenData{}
	data.TimeoutSeconds = 10
	data.ServerAddrs = make([]net.UDPAddr, 1)
	data.ServerAddrs[0] = server
	data.ClientKey = clientKey
	data.ServerKey = serverKey

	buffer := NewBuffer(CONNECT_TOKEN_BYTES)
	if err := data.WriteShared(buffer); err != nil {
		t.Fatalf("error writing shared buffer: %s\n", err)
	}

	// reset
	buffer.Reset()
	outData := &sharedTokenData{}

	if err := outData.ReadShared(buffer); err != nil {
		t.Fatalf("error reading data: %s\n", err)
	}

	if !bytes.Equal(clientKey, outData.ClientKey) {
		t.Fatalf("timeout seconds did not match expected %d\ngot:%d\n", data.TimeoutSeconds, outData.TimeoutSeconds)
	}

	if !bytes.Equal(clientKey, outData.ClientKey) {
		t.Fatalf("client key did not match expected %#v\ngot:%#v\n", clientKey, outData.ClientKey)
	}

	if !bytes.Equal(serverKey, outData.ServerKey) {
		t.Fatalf("server key did not match")
	}

	if !outData.ServerAddrs[0].IP.Equal(server.IP) {
		t.Fatalf("server address did not match")
	}
}
