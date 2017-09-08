package netcode

import (
	"net"
)

// The private parts of a connect token
type ConnectTokenPrivate struct {
	sharedTokenData         // holds the server addresses, client <-> server keys
	ClientId        uint64  // id for this token
	UserData        []byte  // used to store user data
	mac             []byte  // used to store the message authentication code after encryption/before decryption
	TokenData       *Buffer // used to store the serialized/encrypted buffer
}

// Create a new connect token private with an empty TokenData buffer
func NewConnectTokenPrivate(clientId uint64, timeoutSeconds int32, serverAddrs []net.UDPAddr, userData []byte) *ConnectTokenPrivate {
	p := &ConnectTokenPrivate{}
	p.TokenData = NewBuffer(CONNECT_TOKEN_PRIVATE_BYTES)
	p.TimeoutSeconds = timeoutSeconds
	p.ClientId = clientId
	p.UserData = userData
	p.ServerAddrs = serverAddrs
	p.mac = make([]byte, MAC_BYTES)
	return p
}

func (p *ConnectTokenPrivate) Generate() error {
	return p.GenerateShared()
}

// Create a new connect token private with an pre-set, encrypted buffer
// Caller is expected to call Decrypt() and Read() to set the instances properties
func NewConnectTokenPrivateEncrypted(buffer []byte) *ConnectTokenPrivate {
	p := &ConnectTokenPrivate{}
	p.mac = make([]byte, MAC_BYTES)
	p.TokenData = NewBufferFromRef(buffer)
	return p
}

// Helper to return the internal []byte of the private data
func (p *ConnectTokenPrivate) Buffer() []byte {
	return p.TokenData.Buf
}

// Returns the message authentication code for the encrypted buffer
// by splicing the token data, returns an empty byte slice if the tokendata
// buffer is empty/less than MAC_BYTES
func (p *ConnectTokenPrivate) Mac() []byte {
	return p.mac
}

// Reads the token properties from the internal TokenData buffer.
func (p *ConnectTokenPrivate) Read() error {
	var err error

	if p.ClientId, err = p.TokenData.GetUint64(); err != nil {
		return err
	}

	if err = p.ReadShared(p.TokenData); err != nil {
		return err
	}

	if p.UserData, err = p.TokenData.GetBytes(USER_DATA_BYTES); err != nil {
		return ErrReadingUserData
	}

	return nil
}

// Writes the token data to our TokenData buffer and alternatively returns the buffer to caller.
func (p *ConnectTokenPrivate) Write() ([]byte, error) {
	p.TokenData.WriteUint64(p.ClientId)

	if err := p.WriteShared(p.TokenData); err != nil {
		return nil, err
	}

	p.TokenData.WriteBytesN(p.UserData, USER_DATA_BYTES)
	return p.TokenData.Buf, nil
}

// Encrypts, in place, the TokenData buffer, assumes Write() has already been called.
func (p *ConnectTokenPrivate) Encrypt(protocolId, expireTimestamp, sequence uint64, privateKey []byte) error {
	additionalData, nonce := buildTokenCryptData(protocolId, expireTimestamp, sequence)
	encBuf := p.TokenData.Buf[:CONNECT_TOKEN_PRIVATE_BYTES-MAC_BYTES]
	if err := EncryptAead(encBuf, additionalData, nonce, privateKey); err != nil {
		return err
	}

	if len(p.TokenData.Buf) != CONNECT_TOKEN_PRIVATE_BYTES {
		return ErrInvalidTokenPrivateByteSize
	}

	copy(p.mac, p.TokenData.Buf[CONNECT_TOKEN_PRIVATE_BYTES-MAC_BYTES:])
	return nil
}

// Decrypts the internal TokenData buffer, assumes that TokenData has been populated with the encrypted data
// (most likely via NewConnectTokenPrivateEncrypted(...)). Optionally returns the decrypted buffer to caller.
func (p *ConnectTokenPrivate) Decrypt(protocolId, expireTimestamp, sequence uint64, privateKey []byte) ([]byte, error) {
	var err error

	if len(p.TokenData.Buf) != CONNECT_TOKEN_PRIVATE_BYTES {
		return nil, ErrInvalidTokenPrivateByteSize
	}

	copy(p.mac, p.TokenData.Buf[CONNECT_TOKEN_PRIVATE_BYTES-MAC_BYTES:])
	additionalData, nonce := buildTokenCryptData(protocolId, expireTimestamp, sequence)
	if p.TokenData.Buf, err = DecryptAead(p.TokenData.Buf, additionalData, nonce, privateKey); err != nil {
		return nil, err
	}
	p.TokenData.Reset() // reset for reads
	return p.TokenData.Buf, nil
}

// Builds the additional data and nonce necessary for encryption and decryption.
func buildTokenCryptData(protocolId, expireTimestamp, sequence uint64) ([]byte, []byte) {
	additionalData := NewBuffer(VERSION_INFO_BYTES + 8 + 8)
	additionalData.WriteBytes([]byte(VERSION_INFO))
	additionalData.WriteUint64(protocolId)
	additionalData.WriteUint64(expireTimestamp)

	nonce := NewBuffer(SizeUint64 + SizeUint32)
	nonce.WriteUint32(0)
	nonce.WriteUint64(sequence)
	return additionalData.Buf, nonce.Buf
}
