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

	"github.com/gofrs/uuid/v5"
	jwt "github.com/golang-jwt/jwt/v4"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

type ConsoleTokenClaims struct {
	ID        string           `json:"id,omitempty"`
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

func parseConsoleToken(hmacSecretByte []byte, tokenString string) (id, username, email string, role console.UserRole, exp int64, ok bool) {
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
	return claims.ID, claims.Username, claims.Email, claims.Role, claims.ExpiresAt, true
}

func (s *ConsoleServer) Authenticate(ctx context.Context, in *console.AuthenticateRequest) (*console.ConsoleSession, error) {
	ip, _ := extractClientAddressFromContext(s.logger, ctx)
	if !s.loginAttemptCache.Allow(in.Username, ip) {
		return nil, status.Error(codes.ResourceExhausted, "Try again later.")
	}

	var role console.UserRole
	var uname string
	var email string
	var id uuid.UUID
	switch in.Username {
	case s.config.GetConsole().Username:
		if in.Password == s.config.GetConsole().Password {
			role = console.UserRole_USER_ROLE_ADMIN
			uname = in.Username
			id = uuid.Nil
		} else {
			if lockout, until := s.loginAttemptCache.Add(s.config.GetConsole().Username, ip); lockout != LockoutTypeNone {
				switch lockout {
				case LockoutTypeAccount:
					s.logger.Info(fmt.Sprintf("Console admin account locked until %v.", until))
				case LockoutTypeIp:
					s.logger.Info(fmt.Sprintf("Console admin IP locked until %v.", until))
				}
			}
			return nil, status.Error(codes.Unauthenticated, "Invalid credentials.")
		}
	default:
		var err error
		id, uname, email, role, err = s.lookupConsoleUser(ctx, in.Username, in.Password, ip)
		if err != nil {
			return nil, err
		}
	}

	if role == console.UserRole_USER_ROLE_UNKNOWN {
		return nil, status.Error(codes.Unauthenticated, "Invalid credentials.")
	}

	s.loginAttemptCache.Reset(uname)

	exp := time.Now().UTC().Add(time.Duration(s.config.GetConsole().TokenExpirySec) * time.Second).Unix()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, &ConsoleTokenClaims{
		ExpiresAt: exp,
		ID:        id.String(),
		Username:  uname,
		Email:     email,
		Role:      role,
		Cookie:    s.cookie,
	})
	key := []byte(s.config.GetConsole().SigningKey)
	signedToken, _ := token.SignedString(key)

	s.consoleSessionCache.Add(id, exp, signedToken, 0, "")
	return &console.ConsoleSession{Token: signedToken}, nil
}

func (s *ConsoleServer) AuthenticateLogout(ctx context.Context, in *console.AuthenticateLogoutRequest) (*emptypb.Empty, error) {
	token, err := jwt.Parse(in.Token, func(token *jwt.Token) (interface{}, error) {
		if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(s.config.GetConsole().SigningKey), nil
	})
	if err != nil {
		s.logger.Error("Failed to parse the session token.", zap.Error(err))
	}
	id, _, _, _, exp, ok := parseConsoleToken([]byte(s.config.GetConsole().SigningKey), in.Token)
	if !ok || !token.Valid {
		s.logger.Error("Invalid token.", zap.Error(err))
	}
	idUuid, err := uuid.FromString(id)
	if id != "" && err == nil {
		s.consoleSessionCache.Remove(idUuid, exp, in.Token, 0, "")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) lookupConsoleUser(ctx context.Context, unameOrEmail, password, ip string) (id uuid.UUID, uname string, email string, role console.UserRole, err error) {
	role = console.UserRole_USER_ROLE_UNKNOWN
	query := "SELECT id, username, email, role, password, disable_time FROM console_user WHERE username = $1 OR email = $1"
	var dbPassword []byte
	var dbDisableTime pgtype.Timestamptz
	err = s.db.QueryRowContext(ctx, query, unameOrEmail).Scan(&id, &uname, &email, &role, &dbPassword, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			if lockout, until := s.loginAttemptCache.Add("", ip); lockout == LockoutTypeIp {
				s.logger.Info(fmt.Sprintf("Console user IP locked until %v.", until))
			}
			err = status.Error(codes.Unauthenticated, "Invalid credentials.")
		}
		// Call hash function to help obfuscate response time when user does not exist.
		var dummyHash = []byte("$2y$10$x8B0hPVxYGDq7bZiYC9jcuwA0B9m4J6vYITYIv0nf.IfYuM1kGI3W")
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		return
	}

	// Check lockout again as the login attempt may have been through email.
	if !s.loginAttemptCache.Allow(uname, ip) {
		err = status.Error(codes.ResourceExhausted, "Try again later.")
		return
	}

	// Check if it's disabled.
	if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
		s.logger.Info("Console user account is disabled.", zap.String("username", unameOrEmail))
		err = status.Error(codes.PermissionDenied, "Invalid credentials.")
		return
	}

	// Check password
	err = bcrypt.CompareHashAndPassword(dbPassword, []byte(password))
	if err != nil {
		if lockout, until := s.loginAttemptCache.Add(uname, ip); lockout != LockoutTypeNone {
			switch lockout {
			case LockoutTypeAccount:
				s.logger.Info(fmt.Sprintf("Console user account locked until %v.", until))
			case LockoutTypeIp:
				s.logger.Info(fmt.Sprintf("Console user IP locked until %v.", until))
			}
		}
		err = status.Error(codes.Unauthenticated, "Invalid credentials.")
		return
	}

	return

}
