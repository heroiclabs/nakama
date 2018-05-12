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
	"math/rand"
	"regexp"
	"strings"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/heroiclabs/nakama/api"
	"github.com/satori/go.uuid"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var (
	invalidCharsRegex = regexp.MustCompilePOSIX("([[:cntrl:]]|[[:space:]])+")
	emailRegex        = regexp.MustCompile("^.+@.+\\..+$")
)

func (s *ApiServer) AuthenticateCustom(ctx context.Context, in *api.AuthenticateCustomRequest) (*api.Session, error) {
	if in.Account == nil || in.Account.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "Custom ID is required.")
	} else if invalidCharsRegex.MatchString(in.Account.Id) {
		return nil, status.Error(codes.InvalidArgument, "Custom ID invalid, no spaces or control characters allowed.")
	} else if len(in.Account.Id) < 6 || len(in.Account.Id) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Custom ID invalid, must be 6-128 bytes.")
	}

	username := in.Username
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
	} else if len(username) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
	}

	create := in.Create == nil || in.Create.Value

	dbUserID, dbUsername, created, err := AuthenticateCustom(s.logger, s.db, in.Account.Id, username, create)
	if err != nil {
		return nil, err
	}

	token := generateToken(s.config, dbUserID, dbUsername)
	return &api.Session{Created: created, Token: token}, nil
}

func (s *ApiServer) AuthenticateDevice(ctx context.Context, in *api.AuthenticateDeviceRequest) (*api.Session, error) {
	if in.Account == nil || in.Account.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "Device ID is required.")
	} else if invalidCharsRegex.MatchString(in.Account.Id) {
		return nil, status.Error(codes.InvalidArgument, "Device ID invalid, no spaces or control characters allowed.")
	} else if len(in.Account.Id) < 10 || len(in.Account.Id) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Device ID invalid, must be 10-128 bytes.")
	}

	username := in.Username
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
	} else if len(username) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
	}

	create := in.Create == nil || in.Create.Value

	dbUserID, dbUsername, created, err := AuthenticateDevice(s.logger, s.db, in.Account.Id, username, create)
	if err != nil {
		return nil, err
	}

	token := generateToken(s.config, dbUserID, dbUsername)
	return &api.Session{Created: created, Token: token}, nil
}

func (s *ApiServer) AuthenticateEmail(ctx context.Context, in *api.AuthenticateEmailRequest) (*api.Session, error) {
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

	username := in.Username
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
	} else if len(username) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
	}

	create := in.Create == nil || in.Create.Value

	dbUserID, dbUsername, created, err := AuthenticateEmail(s.logger, s.db, cleanEmail, email.Password, username, create)
	if err != nil {
		return nil, err
	}

	token := generateToken(s.config, dbUserID, dbUsername)
	return &api.Session{Created: created, Token: token}, nil
}

func (s *ApiServer) AuthenticateFacebook(ctx context.Context, in *api.AuthenticateFacebookRequest) (*api.Session, error) {
	if in.Account == nil || in.Account.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Facebook access token is required.")
	}

	username := in.Username
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
	} else if len(username) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
	}

	create := in.Create == nil || in.Create.Value

	dbUserID, dbUsername, created, err := AuthenticateFacebook(s.logger, s.db, s.socialClient, in.Account.Token, username, create)
	if err != nil {
		return nil, err
	}

	// Import friends if requested.
	if in.Import == nil || in.Import.Value {
		importFacebookFriends(s.logger, s.db, s.router, s.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, in.Account.Token, false)
	}

	token := generateToken(s.config, dbUserID, dbUsername)
	return &api.Session{Created: created, Token: token}, nil
}

func (s *ApiServer) AuthenticateGameCenter(ctx context.Context, in *api.AuthenticateGameCenterRequest) (*api.Session, error) {
	if in.Account == nil {
		return nil, status.Error(codes.InvalidArgument, "GameCenter access credentials are required.")
	} else if in.Account.BundleId == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter bundle ID is required.")
	} else if in.Account.PlayerId == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter player ID is required.")
	} else if in.Account.PublicKeyUrl == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter public key URL is required.")
	} else if in.Account.Salt == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter salt is required.")
	} else if in.Account.Signature == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter signature is required.")
	} else if in.Account.TimestampSeconds == 0 {
		return nil, status.Error(codes.InvalidArgument, "GameCenter timestamp is required.")
	}

	username := in.Username
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
	} else if len(username) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
	}

	create := in.Create == nil || in.Create.Value

	dbUserID, dbUsername, created, err := AuthenticateGameCenter(s.logger, s.db, s.socialClient, in.Account.PlayerId, in.Account.BundleId, in.Account.TimestampSeconds, in.Account.Salt, in.Account.Signature, in.Account.PublicKeyUrl, username, create)
	if err != nil {
		return nil, err
	}

	token := generateToken(s.config, dbUserID, dbUsername)
	return &api.Session{Created: created, Token: token}, nil
}

func (s *ApiServer) AuthenticateGoogle(ctx context.Context, in *api.AuthenticateGoogleRequest) (*api.Session, error) {
	if in.Account == nil || in.Account.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Google access token is required.")
	}

	username := in.Username
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
	} else if len(username) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
	}

	create := in.Create == nil || in.Create.Value

	dbUserID, dbUsername, created, err := AuthenticateGoogle(s.logger, s.db, s.socialClient, in.Account.Token, username, create)
	if err != nil {
		return nil, err
	}

	token := generateToken(s.config, dbUserID, dbUsername)
	return &api.Session{Created: created, Token: token}, nil
}

func (s *ApiServer) AuthenticateSteam(ctx context.Context, in *api.AuthenticateSteamRequest) (*api.Session, error) {
	if s.config.GetSocial().Steam.PublisherKey == "" || s.config.GetSocial().Steam.AppID == 0 {
		return nil, status.Error(codes.FailedPrecondition, "Steam authentication is not configured.")
	}

	if in.Account == nil || in.Account.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Steam access token is required.")
	}

	username := in.Username
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, no spaces or control characters allowed.")
	} else if len(username) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
	}

	create := in.Create == nil || in.Create.Value

	dbUserID, dbUsername, created, err := AuthenticateSteam(s.logger, s.db, s.socialClient, s.config.GetSocial().Steam.AppID, s.config.GetSocial().Steam.PublisherKey, in.Account.Token, username, create)
	if err != nil {
		return nil, err
	}

	token := generateToken(s.config, dbUserID, dbUsername)
	return &api.Session{Created: created, Token: token}, nil
}

func generateToken(config Config, userID, username string) string {
	exp := time.Now().UTC().Add(time.Duration(config.GetSession().TokenExpirySec) * time.Second).Unix()
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

func generateUsername() string {
	const usernameAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	b := make([]byte, 10)
	for i := range b {
		b[i] = usernameAlphabet[rand.Intn(len(usernameAlphabet))]
	}
	return string(b)
}
