package netcode

import (
	"fmt"
	"net"
	"strings"
	"time"
)

// number of bytes for connect tokens
const CONNECT_TOKEN_BYTES = 2048

// Token used for connecting
type ConnectToken struct {
	sharedTokenData                      // a shared container holding the server addresses, client and server keys
	VersionInfo     []byte               // the version information for client <-> server communications
	ProtocolId      uint64               // protocol id for communications
	CreateTimestamp uint64               // when this token was created
	ExpireTimestamp uint64               // when this token expires
	Sequence        uint64               // the sequence id
	PrivateData     *ConnectTokenPrivate // reference to the private parts of this connect token
}

// Create a new empty token and empty private token
func NewConnectToken() *ConnectToken {
	token := &ConnectToken{}
	token.PrivateData = &ConnectTokenPrivate{}
	return token
}

// Generates the token and private token data with the supplied config values and sequence id.
// This will also write and encrypt the private token
func (token *ConnectToken) Generate(clientId uint64, serverAddrs []net.UDPAddr, versionInfo string, protocolId uint64, expireSeconds uint64, timeoutSeconds int32, sequence uint64, userData, privateKey []byte) error {
	token.CreateTimestamp = uint64(time.Now().Unix())
	if expireSeconds >= 0 {
		token.ExpireTimestamp = token.CreateTimestamp + expireSeconds
	} else {
		token.ExpireTimestamp = 0xFFFFFFFFFFFFFFFF
	}
	token.TimeoutSeconds = timeoutSeconds
	token.VersionInfo = []byte(VERSION_INFO)
	token.ProtocolId = protocolId
	token.Sequence = sequence

	token.PrivateData = NewConnectTokenPrivate(clientId, timeoutSeconds, serverAddrs, userData)
	if err := token.PrivateData.Generate(); err != nil {
		return err
	}

	token.ClientKey = token.PrivateData.ClientKey
	token.ServerKey = token.PrivateData.ServerKey
	token.ServerAddrs = serverAddrs

	if _, err := token.PrivateData.Write(); err != nil {
		return err
	}

	if err := token.PrivateData.Encrypt(token.ProtocolId, token.ExpireTimestamp, sequence, privateKey); err != nil {
		return err
	}

	return nil
}

// Writes the ConnectToken and previously encrypted ConnectTokenPrivate data to a byte slice
func (token *ConnectToken) Write() ([]byte, error) {
	buffer := NewBuffer(CONNECT_TOKEN_BYTES)
	buffer.WriteBytes(token.VersionInfo)
	buffer.WriteUint64(token.ProtocolId)
	buffer.WriteUint64(token.CreateTimestamp)
	buffer.WriteUint64(token.ExpireTimestamp)
	buffer.WriteUint64(token.Sequence)

	// assumes private token has already been encrypted
	buffer.WriteBytes(token.PrivateData.Buffer())

	// writes server/client key and addresses to public part of the buffer
	if err := token.WriteShared(buffer); err != nil {
		return nil, err
	}

	return buffer.Buf, nil
}

// Takes in a slice of decrypted connect token bytes and generates a new ConnectToken.
// Note that the ConnectTokenPrivate is still encrypted at this point.
func ReadConnectToken(tokenBuffer []byte) (*ConnectToken, error) {
	var err error
	var privateData []byte

	buffer := NewBufferFromBytes(tokenBuffer)
	token := NewConnectToken()

	if token.VersionInfo, err = buffer.GetBytes(VERSION_INFO_BYTES); err != nil {
		return nil, fmt.Errorf("read connect token data has bad version info %s", err)
	}

	if strings.Compare(VERSION_INFO, string(token.VersionInfo)) != 0 {
		return nil, fmt.Errorf("read connect token data has bad version info: " + string(token.VersionInfo))
	}

	if token.ProtocolId, err = buffer.GetUint64(); err != nil {
		return nil, fmt.Errorf("read connect token data has bad protocol id %s", err)
	}

	if token.CreateTimestamp, err = buffer.GetUint64(); err != nil {
		return nil, fmt.Errorf("read connect token data has bad create timestamp %s", err)
	}

	if token.ExpireTimestamp, err = buffer.GetUint64(); err != nil {
		return nil, fmt.Errorf("read connect token data has bad expire timestamp %s", err)
	}

	if token.CreateTimestamp > token.ExpireTimestamp {
		return nil, ErrExpiredTokenTimestamp
	}

	if token.Sequence, err = buffer.GetUint64(); err != nil {
		return nil, fmt.Errorf("read connect data has bad sequence %s", err)
	}

	if privateData, err = buffer.GetBytes(CONNECT_TOKEN_PRIVATE_BYTES); err != nil {
		return nil, fmt.Errorf("read connect data has bad private data %s", err)
	}

	// it is still encrypted at this point.
	token.PrivateData.TokenData = NewBufferFromBytes(privateData)

	// reads servers, client and server key
	if err = token.ReadShared(buffer); err != nil {
		return nil, err
	}

	return token, nil
}
