// Copyright 2022 Heroic Labs.
// All rights reserved.
//
// NOTICE: All information contained herein is, and remains the property of Heroic
// Labs. and its suppliers, if any. The intellectual and technical concepts
// contained herein are proprietary to Heroic Labs. and its suppliers and may be
// covered by U.S. and Foreign Patents, patents in process, and are protected by
// trade secret or copyright law. Dissemination of this information or reproduction
// of this material is strictly forbidden unless prior written permission is
// obtained from Heroic Labs.

package server

import (
	"crypto/rand"
	"encoding/base32"
	"github.com/dgryski/dgoogauth"
	"math/big"
	"net/url"
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
