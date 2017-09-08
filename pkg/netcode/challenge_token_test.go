package netcode

import (
	"bytes"
	"testing"
)

func TestNewChallengeToken(t *testing.T) {
	var err error
	var userData []byte
	var decryptedBuffer []byte

	token := NewChallengeToken(TEST_CLIENT_ID)
	if userData, err = RandomBytes(USER_DATA_BYTES); err != nil {
		t.Fatalf("error generating random data\n")
	}
	tokenBuffer := token.Write(userData)

	var sequence uint64
	sequence = 1000
	key, err := GenerateKey()
	if err != nil {
		t.Fatalf("error generating key\n")
	}

	if err := EncryptChallengeToken(tokenBuffer, sequence, key); err != nil {
		t.Fatalf("error encrypting challenge token: %s\n", err)
	}

	if decryptedBuffer, err = DecryptChallengeToken(tokenBuffer, sequence, key); err != nil {
		t.Fatalf("error decrypting challenge token: %s\n", err)
	}

	newToken, err := ReadChallengeToken(decryptedBuffer)
	if err != nil {
		t.Fatalf("error reading token data %s\n", err)
	}

	if newToken.ClientId != token.ClientId {
		t.Fatalf("token client id did not match, expected %d got %d\n", token.ClientId, newToken.ClientId)
	}

	if !bytes.Equal(newToken.UserData.Buf, token.UserData.Buf) {
		t.Fatalf("user data did not match expected\n %#v\ngot\n%#v!", token.UserData.Buf, newToken.UserData.Buf)
	}
}
