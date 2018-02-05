// Copyright 2018 The Nakama Authors
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
	"golang.org/x/net/context"
	"github.com/heroiclabs/nakama/api"
	"regexp"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"math/rand"
	"time"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"database/sql"
	"github.com/dgrijalva/jwt-go"
	"strings"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

var (
	invalidCharsRegex = regexp.MustCompilePOSIX("([[:cntrl:]]|[[:space:]])+")
	emailRegex        = regexp.MustCompile("^.+@.+\\..+$")
)

func (s *ApiServer) AuthenticateCustomFunc(ctx context.Context, in *api.AuthenticateCustom) (*api.Session, error) {
	if in.Account == nil || in.Account.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "Custom ID is required.")
	} else if invalidCharsRegex.MatchString(in.Account.Id) {
		return nil, status.Error(codes.InvalidArgument, "Custom ID invalid, no spaces or control characters allowed.")
	} else if len(in.Account.Id) < 10 || len(in.Account.Id) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Custom ID invalid, must be 10-128 bytes.")
	}

	if in.Create == nil || in.Create.Value {
		// Use existing user account if found, otherwise create a new user account.
		username := in.Username
		if username == "" {
			username = generateUsername(s.random)
		} else if invalidCharsRegex.MatchString(username) {
			return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
		} else if len(username) > 128 {
			return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
		}

		userID := uuid.NewV4().String()
		ts := time.Now().UTC().Unix()
		// NOTE: This query relies on the `custom_id` conflict triggering before the `users_username_key`
		// constraint violation to ensure we fall to the RETURNING case and ignore the new username for
		// existing user accounts. The DO UPDATE SET is to trick the DB into having the data we need to return.
		query := `
INSERT INTO users (id, username, custom_id, created_at, updated_at)
VALUES ($1, $2, $3, $4, $4)
ON CONFLICT (custom_id) DO UPDATE SET custom_id = $3
RETURNING id, username, custom_id, disabled_at`
		params := []interface{}{userID, username, in.Account.Id, ts}

		var dbUserID string
		var dbUsername string
		var dbCustomId sql.NullString
		var dbDisabledAt int64
		err := s.db.QueryRow(query, params...).Scan(&dbUserID, &dbUsername, &dbCustomId, &dbDisabledAt)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return nil, status.Error(codes.AlreadyExists, "Username is already in use.")
			}
			s.logger.Error("Cannot find or create user with custom ID.", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error finding or creating user account.")
		}

		if dbDisabledAt != 0 {
			return nil, status.Error(codes.PermissionDenied, "User account is disabled.")
		}

		token := generateToken(s.config, dbUserID, dbUsername)
		return &api.Session{Token: token}, nil
	} else {
		// Do not create a new user account.
		query := `
SELECT id, username, disabled_at
FROM users
WHERE custom_id = $1`
		params := []interface{}{in.Account.Id}

		var dbUserID string
		var dbUsername string
		var dbDisabledAt int64
		err := s.db.QueryRow(query, params...).Scan(&dbUserID, &dbUsername, &dbDisabledAt)
		if err != nil {
			if err == sql.ErrNoRows {
				// No user account found.
				return nil, status.Error(codes.NotFound, "User account not found.")
			} else {
				s.logger.Error("Cannot find user with custom ID.", zap.Error(err))
				return nil, status.Error(codes.Internal, "Error finding user account.")
			}
		}

		if dbDisabledAt != 0 {
			return nil, status.Error(codes.PermissionDenied, "User account is disabled.")
		}

		token := generateToken(s.config, dbUserID, dbUsername)
		return &api.Session{Token: token}, nil
	}
}

func (s *ApiServer) AuthenticateDeviceFunc(ctx context.Context, in *api.AuthenticateDevice) (*api.Session, error) {
	if in.Account == nil || in.Account.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "Device ID is required.")
	} else if invalidCharsRegex.MatchString(in.Account.Id) {
		return nil, status.Error(codes.InvalidArgument, "Device ID invalid, no spaces or control characters allowed.")
	} else if len(in.Account.Id) < 10 || len(in.Account.Id) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Device ID invalid, must be 10-128 bytes.")
	}

	if in.Create == nil || in.Create.Value {
		// Use existing user account if found, otherwise create a new user account.
		username := in.Username
		if username == "" {
			username = generateUsername(s.random)
		} else if invalidCharsRegex.MatchString(username) {
			return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
		} else if len(username) > 128 {
			return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
		}

		var dbUserID string
		var dbUsername string
		fnErr := Transact(s.logger, s.db, func (tx *sql.Tx) error {
			userID := uuid.NewV4().String()
			ts := time.Now().UTC().Unix()
			query := `
INSERT INTO users (id, username, created_at, updated_at)
SELECT $1 AS id,
			 $2 AS username,
			 $4 AS created_at,
			 $4 AS updated_at
WHERE NOT EXISTS
    (SELECT id
     FROM user_device
     WHERE id = $3::VARCHAR)
RETURNING id, username, disabled_at`
			params := []interface{}{userID, username, in.Account.Id, ts}

			var dbDisabledAt int64
			err := tx.QueryRow(query, params...).Scan(&dbUserID, &dbUsername, &dbDisabledAt)
			if err != nil {
				if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
					return status.Error(codes.AlreadyExists, "Username is already in use.")
				}
				s.logger.Error("Cannot find or create user with device ID.", zap.Error(err))
				return status.Error(codes.Internal, "Error finding or creating user account.")
			}

			if dbDisabledAt != 0 {
				return status.Error(codes.PermissionDenied, "User account is disabled.")
			}

			query = "INSERT INTO user_device (id, user_id) VALUES ($1, $2)"
			params = []interface{}{in.Account.Id, userID}
			_, err = tx.Exec(query, params...)
			if err != nil {
				s.logger.Error("Cannot add device ID.", zap.Error(err))
				return status.Error(codes.Internal, "Error finding or creating user account.")
			}

			return nil
		})

		if fnErr != nil {
			return nil, fnErr
		}

		token := generateToken(s.config, dbUserID, dbUsername)
		return &api.Session{Token: token}, nil
	} else {
		query := "SELECT user_id FROM user_device WHERE id = $1"
		params := []interface{}{in.Account.Id}

		var dbUserID string
		err := s.db.QueryRow(query, params...).Scan(&dbUserID)
		if err != nil {
			if err == sql.ErrNoRows {
				// No user account found.
				return nil, status.Error(codes.NotFound, "Device ID not found.")
			} else {
				s.logger.Error("Cannot find user with device ID.", zap.Error(err))
				return nil, status.Error(codes.Internal, "Error finding user account.")
			}
		}

		query = "SELECT username, disabled_at FROM users WHERE id = $1"
		params = []interface{}{dbUserID}
		var dbUsername string
		var dbDisabledAt int64

		err = s.db.QueryRow(query, params...).Scan(&dbUsername, &dbDisabledAt)
		if err != nil {
			s.logger.Error("Cannot find user with device ID.", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error finding user account.")
		}

		if dbDisabledAt != 0 {
			return nil, status.Error(codes.PermissionDenied, "User account is disabled.")
		}

		token := generateToken(s.config, dbUserID, dbUsername)
		return &api.Session{Token: token}, nil
	}
}

func (s *ApiServer) AuthenticateEmailFunc(ctx context.Context, in *api.AuthenticateEmail) (*api.Session, error) {
	email := in.Account
	if email == nil || email.Email == "" || email.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "Email address and password is required.")
	} else if invalidCharsRegex.MatchString(email.Email) {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address, no spaces or control characters allowed.")
	} else if len(email.Password) < 8 {
		return nil, status.Error(codes.InvalidArgument, "Password must be longer than 8 characters.")
	} else if !emailRegex.MatchString(email.Email) {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address format.")
	} else if len(email.Email) < 10 || len(email.Email) > 255 {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address, must be 10-255 bytes.")
	}

	cleanEmail := strings.ToLower(email.Email)
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(email.Password), bcrypt.DefaultCost)

	if in.Create == nil || in.Create.Value {
		// Use existing user account if found, otherwise create a new user account.
		username := in.Username
		if username == "" {
			username = generateUsername(s.random)
		} else if invalidCharsRegex.MatchString(username) {
			return nil, status.Error(codes.InvalidArgument, "Username invalid , no spaces or control characters allowed.")
		} else if len(username) > 128 {
			return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
		}

		userID := uuid.NewV4().String()
		ts := time.Now().UTC().Unix()
		query := `
INSERT INTO users (id, username, email, password, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $5)
ON CONFLICT (email) DO UPDATE SET email = $3, password = $4
RETURNING id, username, disabled_at`
		params := []interface{}{userID, username, cleanEmail, hashedPassword, ts}

		var dbUserID string
		var dbUsername string
		var dbDisabledAt int64
		err := s.db.QueryRow(query, params...).Scan(&dbUserID, &dbUsername, &dbDisabledAt)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return nil, status.Error(codes.AlreadyExists, "Username is already in use.")
			}
			s.logger.Error("Cannot find or create user with email.", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error finding or creating user account.")
		}

		if dbDisabledAt != 0 {
			return nil, status.Error(codes.PermissionDenied, "User account is disabled")
		}

		token := generateToken(s.config, dbUserID, dbUsername)
		return &api.Session{Token: token}, nil
	} else {
		// Do not create a new user account.
		query := `
SELECT id, username, password, disabled_at
FROM users
WHERE email = $1`
		params := []interface{}{cleanEmail}

		var dbUserID string
		var dbUsername string
		var dbPassword string
		var dbDisabledAt int64
		err := s.db.QueryRow(query, params...).Scan(&dbUserID, &dbUsername, &dbPassword, &dbDisabledAt)
		if err != nil {
			if err == sql.ErrNoRows {
				// No user account found.
				return nil, status.Error(codes.NotFound, "User account not found.")
			} else {
				s.logger.Error("Cannot find user with email.", zap.Error(err))
				return nil, status.Error(codes.Internal, "Error finding user account.")
			}
		}

		if dbDisabledAt != 0 {
			return nil, status.Error(codes.PermissionDenied, "User account is disabled.")
		}

		err = bcrypt.CompareHashAndPassword(hashedPassword, []byte(email.Password))
		if err != nil {
			return nil, status.Error(codes.Unauthenticated, "Invalid credentials.")
		}

		token := generateToken(s.config, dbUserID, dbUsername)
		return &api.Session{Token: token}, nil
	}
}

func (s *ApiServer) AuthenticateFacebookFunc(ctx context.Context, in *api.AuthenticateFacebook) (*api.Session, error) {
	return nil, nil
}

func (s *ApiServer) AuthenticateGameCenterFunc(ctx context.Context, in *api.AuthenticateGameCenter) (*api.Session, error) {
	return nil, nil
}

func (s *ApiServer) AuthenticateGoogleFunc(ctx context.Context, in *api.AuthenticateGoogle) (*api.Session, error) {
	return nil, nil
}

func (s *ApiServer) AuthenticateSteamFunc(ctx context.Context, in *api.AuthenticateSteam) (*api.Session, error) {
	return nil, nil
}

func generateToken(config Config, userID, username string) string {
	exp := time.Now().UTC().Add(time.Duration(config.GetSession().TokenExpiryMs) * time.Millisecond).Unix()
	return generateTokenWithExpiry(config, userID, username, exp)
}

func generateTokenWithExpiry(config Config, userID, username string, exp int64) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uid": userID,
		"exp": exp,
		"usn": username,
	})
	signedToken, _ := token.SignedString([]byte(config.GetSession().EncryptionKey))
	return signedToken
}

func generateUsername(random *rand.Rand) string {
	const usernameAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	b := make([]byte, 10)
	for i := range b {
		b[i] = usernameAlphabet[random.Intn(len(usernameAlphabet))]
	}
	return string(b)
}
