// Copyright 2019 The Nakama Authors
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
	"context"
	"crypto"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/jackc/pgtype"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type ConsoleTokenClaims struct {
	Username  string           `json:"usn,omitempty"`
	Email     string           `json:"ema,omitempty"`
	Role      console.UserRole `json:"rol,omitempty"`
	ExpiresAt int64            `json:"exp,omitempty"`
	Cookie    string           `json:"cki,omitempty"`
}

func (stc *ConsoleTokenClaims) Valid() error {
	// Verify expiry.
	if stc.ExpiresAt <= time.Now().UTC().Unix() {
		vErr := new(jwt.ValidationError)
		vErr.Inner = errors.New("Token is expired")
		vErr.Errors |= jwt.ValidationErrorExpired
		return vErr
	}
	return nil
}

func parseConsoleToken(hmacSecretByte []byte, tokenString string) (username, email string, role console.UserRole, exp int64, ok bool) {
	token, err := jwt.ParseWithClaims(tokenString, &ConsoleTokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return hmacSecretByte, nil
	})
	if err != nil {
		return
	}
	claims, ok := token.Claims.(*ConsoleTokenClaims)
	if !ok || !token.Valid {
		return
	}
	return claims.Username, claims.Email, claims.Role, claims.ExpiresAt, true
}

func (s *ConsoleServer) Authenticate(ctx context.Context, in *console.AuthenticateRequest) (*console.ConsoleSession, error) {
	role := console.UserRole_USER_ROLE_UNKNOWN
	var uname string
	var email string
	switch in.Username {
	case s.config.GetConsole().Username:
		if in.Password == s.config.GetConsole().Password {
			role = console.UserRole_USER_ROLE_ADMIN
			uname = in.Username
		}
	default:
		var err error
		uname, email, role, err = s.lookupConsoleUser(ctx, in.Username, in.Password)
		if err != nil {
			return nil, err
		}
	}

	if role == console.UserRole_USER_ROLE_UNKNOWN {
		return nil, status.Error(codes.Unauthenticated, "Invalid Nakama Console credentials.")
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, &ConsoleTokenClaims{
		ExpiresAt: time.Now().UTC().Add(time.Duration(s.config.GetConsole().TokenExpirySec) * time.Second).Unix(),
		Username:  uname,
		Email:     email,
		Role:      role,
		Cookie:    s.cookie,
	})
	key := []byte(s.config.GetConsole().SigningKey)
	signedToken, _ := token.SignedString(key)
	return &console.ConsoleSession{Token: signedToken}, nil
}

func (s *ConsoleServer) lookupConsoleUser(ctx context.Context, unameOrEmail, password string) (uname string, email string, role console.UserRole, err error) {
	role = console.UserRole_USER_ROLE_UNKNOWN
	query := "SELECT username, email, role, password, disable_time FROM console_user WHERE username = $1 OR email = $1"
	var dbPassword []byte
	var dbDisableTime pgtype.Timestamptz
	err = s.db.QueryRowContext(ctx, query, unameOrEmail).Scan(&uname, &email, &role, &dbPassword, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			err = nil
		}
		return
	}

	// Check if it's disabled.
	if dbDisableTime.Status == pgtype.Present && dbDisableTime.Time.Unix() != 0 {
		s.logger.Info("Console user account is disabled.", zap.String("username", unameOrEmail))
		err = status.Error(codes.PermissionDenied, "Console user account banned.")
		return
	}

	// Check password
	err = bcrypt.CompareHashAndPassword(dbPassword, []byte(password))
	if err != nil {
		err = status.Error(codes.Unauthenticated, "Invalid credentials.")
		return
	}

	return

}
