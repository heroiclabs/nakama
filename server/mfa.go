// Copyright 2024 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"crypto/rand"
	"encoding/base32"
	"math/big"
	"net/url"

	"github.com/dgryski/dgoogauth"
)

const (
	MFAIssuer     = "HeroicLabs"
	MFAWindowSize = 3
)

func generateRecoveryCodes() ([]string, error) {
	recoveryCodes := make([]string, 16)
	for i := range recoveryCodes {
		value, err := rand.Int(rand.Reader, big.NewInt(89999999))
		if err != nil {
			return nil, err
		}
		code := value.Add(value, big.NewInt(10000000))
		recoveryCodes[i] = code.String()
	}
	return recoveryCodes, nil
}

func generateMFASecret() (string, error) {
	mfaSecret := make([]byte, 10) // the secret is an 80-bit string according to dgoogauth.OTPConfig.Secret documentation
	if _, err := rand.Read(mfaSecret); err != nil {
		return "", err
	}

	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(mfaSecret), nil
}

func generateMFAUrl(mfaSecret, username string) string {
	mfaConfig := &dgoogauth.OTPConfig{
		Secret:     mfaSecret,
		WindowSize: MFAWindowSize,
		UTC:        true,
	}

	return url.QueryEscape(mfaConfig.ProvisionURIWithIssuer(username, MFAIssuer))
}
