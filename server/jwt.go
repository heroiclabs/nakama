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
	"crypto"
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v4"
)

func generateJWTToken(signingKey string, claims jwt.Claims) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(signingKey))
}

func parseJWTToken(signingKey, tokenString string, outClaims jwt.Claims) error {
	token, err := jwt.ParseWithClaims(tokenString, outClaims, func(token *jwt.Token) (interface{}, error) {
		if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(signingKey), nil
	})
	if err != nil {
		return err
	}
	if !token.Valid {
		return errors.New("token is invalid")
	}

	if err := outClaims.Valid(); err != nil {
		return errors.New("failed to extract claims from token")
	}
	return nil
}
