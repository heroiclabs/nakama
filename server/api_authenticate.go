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
	"fmt"
	"go.opencensus.io/stats"
	"go.opencensus.io/tag"
	"go.opencensus.io/trace"
	"go.uber.org/zap"
	"math/rand"
	"regexp"
	"strings"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama/api"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var (
	invalidCharsRegex = regexp.MustCompilePOSIX("([[:cntrl:]]|[[:space:]])+")
	emailRegex        = regexp.MustCompile("^.+@.+\\..+$")
)

func (s *ApiServer) AuthenticateCustom(ctx context.Context, in *api.AuthenticateCustomRequest) (*api.Session, error) {
	// Before hook.
	if fn := s.runtime.BeforeAuthenticateCustom(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, "", "", 0, clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

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

	token, exp := generateToken(s.config, dbUserID, dbUsername)
	session := &api.Session{Created: created, Token: token}

	// After hook.
	if fn := s.runtime.AfterAuthenticateCustom(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, dbUserID, dbUsername, exp, clientIP, clientPort, session)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return session, nil
}

func (s *ApiServer) AuthenticateDevice(ctx context.Context, in *api.AuthenticateDeviceRequest) (*api.Session, error) {
	// Before hook.
	if fn := s.runtime.BeforeAuthenticateDevice(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, "", "", 0, clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

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

	token, exp := generateToken(s.config, dbUserID, dbUsername)
	session := &api.Session{Created: created, Token: token}

	// After hook.
	if fn := s.runtime.AfterAuthenticateDevice(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, dbUserID, dbUsername, exp, clientIP, clientPort, session)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return session, nil
}

func (s *ApiServer) AuthenticateEmail(ctx context.Context, in *api.AuthenticateEmailRequest) (*api.Session, error) {
	// Before hook.
	if fn := s.runtime.BeforeAuthenticateEmail(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, "", "", 0, clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

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

	token, exp := generateToken(s.config, dbUserID, dbUsername)
	session := &api.Session{Created: created, Token: token}

	// After hook.
	if fn := s.runtime.AfterAuthenticateEmail(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, dbUserID, dbUsername, exp, clientIP, clientPort, session)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return session, nil
}

func (s *ApiServer) AuthenticateFacebook(ctx context.Context, in *api.AuthenticateFacebookRequest) (*api.Session, error) {
	// Before hook.
	if fn := s.runtime.BeforeAuthenticateFacebook(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, "", "", 0, clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

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

	token, exp := generateToken(s.config, dbUserID, dbUsername)
	session := &api.Session{Created: created, Token: token}

	// After hook.
	if fn := s.runtime.AfterAuthenticateFacebook(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, dbUserID, dbUsername, exp, clientIP, clientPort, session)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return session, nil
}

func (s *ApiServer) AuthenticateGameCenter(ctx context.Context, in *api.AuthenticateGameCenterRequest) (*api.Session, error) {
	// Before hook.
	if fn := s.runtime.BeforeAuthenticateGameCenter(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, "", "", 0, clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

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

	token, exp := generateToken(s.config, dbUserID, dbUsername)
	session := &api.Session{Created: created, Token: token}

	// After hook.
	if fn := s.runtime.AfterAuthenticateGameCenter(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, dbUserID, dbUsername, exp, clientIP, clientPort, session)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return session, nil
}

func (s *ApiServer) AuthenticateGoogle(ctx context.Context, in *api.AuthenticateGoogleRequest) (*api.Session, error) {
	// Before hook.
	if fn := s.runtime.BeforeAuthenticateGoogle(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, "", "", 0, clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

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

	token, exp := generateToken(s.config, dbUserID, dbUsername)
	session := &api.Session{Created: created, Token: token}

	// After hook.
	if fn := s.runtime.AfterAuthenticateGoogle(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, dbUserID, dbUsername, exp, clientIP, clientPort, session)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return session, nil
}

func (s *ApiServer) AuthenticateSteam(ctx context.Context, in *api.AuthenticateSteamRequest) (*api.Session, error) {
	// Before hook.
	if fn := s.runtime.BeforeAuthenticateSteam(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, "", "", 0, clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

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

	token, exp := generateToken(s.config, dbUserID, dbUsername)
	session := &api.Session{Created: created, Token: token}

	// After hook.
	if fn := s.runtime.AfterAuthenticateSteam(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, dbUserID, dbUsername, exp, clientIP, clientPort, session)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return session, nil
}

func generateToken(config Config, userID, username string) (string, int64) {
	exp := time.Now().UTC().Add(time.Duration(config.GetSession().TokenExpirySec) * time.Second).Unix()
	return generateTokenWithExpiry(config, userID, username, exp)
}

func generateTokenWithExpiry(config Config, userID, username string, exp int64) (string, int64) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uid": userID,
		"exp": exp,
		"usn": username,
	})
	signedToken, _ := token.SignedString([]byte(config.GetSession().EncryptionKey))
	return signedToken, exp
}

func generateUsername() string {
	const usernameAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	b := make([]byte, 10)
	for i := range b {
		b[i] = usernameAlphabet[rand.Intn(len(usernameAlphabet))]
	}
	return string(b)
}
