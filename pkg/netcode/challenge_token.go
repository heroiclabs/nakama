package netcode

// Challenge tokens are used in certain packet types
type ChallengeToken struct {
	ClientId  uint64  // the clientId associated with this token
	UserData  *Buffer // the userdata payload
	TokenData *Buffer // the serialized payload container
}

// Creates a new empty challenge token with only the clientId set
func NewChallengeToken(clientId uint64) *ChallengeToken {
	token := &ChallengeToken{}
	token.ClientId = clientId
	token.UserData = NewBuffer(USER_DATA_BYTES)
	return token
}

// Serializes the client id and userData, also sets the UserData buffer.
func (t *ChallengeToken) Write(userData []byte) []byte {
	t.UserData.WriteBytes(userData)

	tokenData := NewBuffer(CHALLENGE_TOKEN_BYTES)
	tokenData.WriteUint64(t.ClientId)
	tokenData.WriteBytes(userData)
	return tokenData.Buf
}

// Encrypts the TokenData buffer with the sequence nonce and provided key
func EncryptChallengeToken(tokenBuffer []byte, sequence uint64, key []byte) error {
	nonce := NewBuffer(SizeUint64 + SizeUint32)
	nonce.WriteUint32(0)
	nonce.WriteUint64(sequence)
	err := EncryptAead(tokenBuffer[:CHALLENGE_TOKEN_BYTES-MAC_BYTES], nil, nonce.Bytes(), key)
	return err
}

// Decrypts the TokenData buffer with the sequence nonce and provided key, updating the
// internal TokenData buffer
func DecryptChallengeToken(tokenBuffer []byte, sequence uint64, key []byte) ([]byte, error) {
	nonce := NewBuffer(SizeUint64 + SizeUint32)
	nonce.WriteUint32(0)
	nonce.WriteUint64(sequence)
	return DecryptAead(tokenBuffer, nil, nonce.Bytes(), key)
}

// Generates a new ChallengeToken from the provided buffer byte slice. Only sets the ClientId
// and UserData buffer.
func ReadChallengeToken(buffer []byte) (*ChallengeToken, error) {
	var err error
	var clientId uint64
	var userData []byte
	tokenBuffer := NewBufferFromBytes(buffer)

	clientId, err = tokenBuffer.GetUint64()
	if err != nil {
		return nil, err
	}
	token := NewChallengeToken(clientId)

	userData, err = tokenBuffer.GetBytes(USER_DATA_BYTES)
	if err != nil {
		return nil, err
	}
	token.UserData.WriteBytes(userData)
	token.UserData.Reset()

	return token, nil
}
