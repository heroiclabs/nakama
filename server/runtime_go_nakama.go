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
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type RuntimeGoNakamaModule struct {
	sync.RWMutex
	logger               *zap.Logger
	db                   *sql.DB
	protojsonMarshaler   *protojson.MarshalOptions
	config               Config
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	leaderboardScheduler LeaderboardScheduler
	sessionRegistry      SessionRegistry
	sessionCache         SessionCache
	matchRegistry        MatchRegistry
	tracker              Tracker
	metrics              Metrics
	streamManager        StreamManager
	router               MessageRouter

	eventFn RuntimeEventCustomFunction

	node string

	matchCreateFn RuntimeMatchCreateFunction
}

func NewRuntimeGoNakamaModule(logger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, matchRegistry MatchRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter) *RuntimeGoNakamaModule {
	return &RuntimeGoNakamaModule{
		logger:               logger,
		db:                   db,
		protojsonMarshaler:   protojsonMarshaler,
		config:               config,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		leaderboardScheduler: leaderboardScheduler,
		sessionRegistry:      sessionRegistry,
		sessionCache:         sessionCache,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		metrics:              metrics,
		streamManager:        streamManager,
		router:               router,

		node: config.GetName(),
	}
}

// @summary Authenticate user and create a session token using an Apple sign in token.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param token(string) Apple sign in token.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateApple(ctx context.Context, token, username string, create bool) (string, string, bool, error) {
	if n.config.GetSocial().Apple.BundleId == "" {
		return "", "", false, errors.New("Apple authentication is not configured")
	}

	if token == "" {
		return "", "", false, errors.New("expects token string")
	}

	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	return AuthenticateApple(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().Apple.BundleId, token, username, create)
}

// @summary Authenticate user and create a session token using a custom authentication managed by an external service or source not already supported by Nakama.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) Custom ID to use to authenticate the user. Must be between 6-128 characters.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateCustom(ctx context.Context, id, username string, create bool) (string, string, bool, error) {
	if id == "" {
		return "", "", false, errors.New("expects id string")
	} else if invalidCharsRegex.MatchString(id) {
		return "", "", false, errors.New("expects id to be valid, no spaces or control characters allowed")
	} else if len(id) < 6 || len(id) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 6-128 bytes")
	}

	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	return AuthenticateCustom(ctx, n.logger, n.db, id, username, create)
}

// @summary Authenticate user and create a session token using a device identifier.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) Device ID to use to authenticate the user. Must be between 1-128 characters.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateDevice(ctx context.Context, id, username string, create bool) (string, string, bool, error) {
	if id == "" {
		return "", "", false, errors.New("expects id string")
	} else if invalidCharsRegex.MatchString(id) {
		return "", "", false, errors.New("expects id to be valid, no spaces or control characters allowed")
	} else if len(id) < 10 || len(id) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 10-128 bytes")
	}

	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	return AuthenticateDevice(ctx, n.logger, n.db, id, username, create)
}

// @summary Authenticate user and create a session token using an email address and password.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param email(string) Email address to use to authenticate the user. Must be between 10-255 characters.
// @param password(string) Password to set. Must be longer than 8 characters.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateEmail(ctx context.Context, email, password, username string, create bool) (string, string, bool, error) {
	var attemptUsernameLogin bool
	if email == "" {
		attemptUsernameLogin = true
	} else if invalidCharsRegex.MatchString(email) {
		return "", "", false, errors.New("expects email to be valid, no spaces or control characters allowed")
	} else if !emailRegex.MatchString(email) {
		return "", "", false, errors.New("expects email to be valid, invalid email address format")
	} else if len(email) < 10 || len(email) > 255 {
		return "", "", false, errors.New("expects email to be valid, must be 10-255 bytes")
	}

	if password == "" {
		return "", "", false, errors.New("expects password string")
	} else if len(password) < 8 {
		return "", "", false, errors.New("expects password to be valid, must be longer than 8 characters")
	}

	if username == "" {
		if attemptUsernameLogin {
			return "", "", false, errors.New("expects username string when email is not supplied")
		}

		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	if attemptUsernameLogin {
		dbUserID, err := AuthenticateUsername(ctx, n.logger, n.db, username, password)
		return dbUserID, username, false, err
	}

	cleanEmail := strings.ToLower(email)

	return AuthenticateEmail(ctx, n.logger, n.db, cleanEmail, password, username, create)
}

// @summary Authenticate user and create a session token using a Facebook account token.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param token(string) Facebook OAuth or Limited Login (JWT) access token.
// @param import(bool) Whether to automatically import Facebook friends after authentication. This is true by default.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateFacebook(ctx context.Context, token string, importFriends bool, username string, create bool) (string, string, bool, error) {
	if token == "" {
		return "", "", false, errors.New("expects access token string")
	}

	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	dbUserID, dbUsername, created, importFriendsPossible, err := AuthenticateFacebook(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, token, username, create)
	if err == nil && importFriends && importFriendsPossible {
		// Errors are logged before this point and failure here does not invalidate the whole operation.
		_ = importFacebookFriends(ctx, n.logger, n.db, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
	}

	return dbUserID, dbUsername, created, err
}

// @summary Authenticate user and create a session token using a Facebook Instant Game.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param playerInfo(string) Facebook Player info.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateFacebookInstantGame(ctx context.Context, signedPlayerInfo string, username string, create bool) (string, string, bool, error) {
	if signedPlayerInfo == "" {
		return "", "", false, errors.New("expects signed player info")
	}

	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	return AuthenticateFacebookInstantGame(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookInstantGame.AppSecret, signedPlayerInfo, username, create)
}

// @summary Authenticate user and create a session token using Apple Game Center credentials.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param playerId(string) PlayerId provided by GameCenter.
// @param bundleId(string) BundleId of your app on iTunesConnect.
// @param timestamp(int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(string) A random string returned by Game Center authentication on client.
// @param signature(string) A signature returned by Game Center authentication on client.
// @param publicKeyUrl(string) A URL to the public key returned by Game Center authentication on client.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateGameCenter(ctx context.Context, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl, username string, create bool) (string, string, bool, error) {
	if playerID == "" {
		return "", "", false, errors.New("expects player ID string")
	}
	if bundleID == "" {
		return "", "", false, errors.New("expects bundle ID string")
	}
	if timestamp == 0 {
		return "", "", false, errors.New("expects timestamp value")
	}
	if salt == "" {
		return "", "", false, errors.New("expects salt string")
	}
	if signature == "" {
		return "", "", false, errors.New("expects signature string")
	}
	if publicKeyUrl == "" {
		return "", "", false, errors.New("expects public key URL string")
	}

	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	return AuthenticateGameCenter(ctx, n.logger, n.db, n.socialClient, playerID, bundleID, timestamp, salt, signature, publicKeyUrl, username, create)
}

// @summary Authenticate user and create a session token using a Google ID token.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param token(string) Google OAuth access token.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateGoogle(ctx context.Context, token, username string, create bool) (string, string, bool, error) {
	if token == "" {
		return "", "", false, errors.New("expects ID token string")
	}

	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	return AuthenticateGoogle(ctx, n.logger, n.db, n.socialClient, token, username, create)
}

// @summary Authenticate user and create a session token using a Steam account token.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param token(string) Steam token.
// @param username(string) The user's username. If left empty, one is generated.
// @param create(bool) Create user if one didn't exist previously. By default this is set to true.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateSteam(ctx context.Context, token, username string, create bool) (string, string, bool, error) {
	if n.config.GetSocial().Steam.PublisherKey == "" || n.config.GetSocial().Steam.AppID == 0 {
		return "", "", false, errors.New("Steam authentication is not configured")
	}

	if token == "" {
		return "", "", false, errors.New("expects token string")
	}

	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	userID, username, _, created, err := AuthenticateSteam(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().Steam.AppID, n.config.GetSocial().Steam.PublisherKey, token, username, create)

	return userID, username, created, err
}

// @summary Generate a Nakama session token from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) User ID to use to generate the token.
// @param username(string) The user's username. If left empty, one is generated.
// @param expiresAt(number) Optional. Number of seconds the token should be valid for. Defaults to server configured expiry time.
// @return token(string) The Nakama session token.
// @return validity(number) The period for which the token remains valid.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AuthenticateTokenGenerate(userID, username string, exp int64, vars map[string]string) (string, int64, error) {
	if userID == "" {
		return "", 0, errors.New("expects user id")
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		return "", 0, errors.New("expects valid user id")
	}

	if username == "" {
		return "", 0, errors.New("expects username")
	}

	if exp == 0 {
		// If expiry is 0 or not set, use standard configured expiry.
		exp = time.Now().UTC().Add(time.Duration(n.config.GetSession().TokenExpirySec) * time.Second).Unix()
	}

	token, exp := generateTokenWithExpiry(n.config.GetSession().EncryptionKey, userID, username, vars, exp)
	n.sessionCache.Add(uid, exp, token, 0, "")
	return token, exp, nil
}

// @summary Fetch account information by user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) User ID to fetch information for. Must be valid UUID.
// @return account(*api.Account) All account information including wallet, device IDs and more.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AccountGetId(ctx context.Context, userID string) (*api.Account, error) {
	u, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("invalid user id")
	}

	account, err := GetAccount(ctx, n.logger, n.db, n.tracker, u)
	if err != nil {
		return nil, err
	}

	return account, nil
}

// @summary Fetch information for multiple accounts by user IDs.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userIds([]string) Array of user IDs to fetch information for. Must be valid UUID.
// @return account(*api.Account) An array of accounts.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AccountsGetId(ctx context.Context, userIDs []string) ([]*api.Account, error) {
	if len(userIDs) == 0 {
		return make([]*api.Account, 0), nil
	}

	for _, id := range userIDs {
		if _, err := uuid.FromString(id); err != nil {
			return nil, errors.New("each user id must be a valid id string")
		}
	}

	return GetAccounts(ctx, n.logger, n.db, n.tracker, userIDs)
}

// @summary Update an account by user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) User ID for which the information is to be updated. Must be valid UUID.
// @param metadata(map[string]interface{}) The metadata to update for this account.
// @param username(string) Username to be set. Must be unique. Use "" if it is not being updated.
// @param displayName(string) Display name to be updated. Use "" if it is not being updated.
// @param timezone(string) Timezone to be updated. Use "" if it is not being updated.
// @param location(string) Location to be updated. Use "" if it is not being updated.
// @param language(string) Lang tag to be updated. Use "" if it is not being updated.
// @param avatarUrl(string) User's avatar URL. Use "" if it is not being updated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AccountUpdateId(ctx context.Context, userID, username string, metadata map[string]interface{}, displayName, timezone, location, langTag, avatarUrl string) error {
	u, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	var metadataWrapper *wrapperspb.StringValue
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return fmt.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataWrapper = &wrapperspb.StringValue{Value: string(metadataBytes)}
	}

	var displayNameWrapper *wrapperspb.StringValue
	if displayName != "" {
		displayNameWrapper = &wrapperspb.StringValue{Value: displayName}
	}
	var timezoneWrapper *wrapperspb.StringValue
	if timezone != "" {
		timezoneWrapper = &wrapperspb.StringValue{Value: timezone}
	}
	var locationWrapper *wrapperspb.StringValue
	if location != "" {
		locationWrapper = &wrapperspb.StringValue{Value: location}
	}
	var langWrapper *wrapperspb.StringValue
	if langTag != "" {
		langWrapper = &wrapperspb.StringValue{Value: langTag}
	}
	var avatarWrapper *wrapperspb.StringValue
	if avatarUrl != "" {
		avatarWrapper = &wrapperspb.StringValue{Value: avatarUrl}
	}

	return UpdateAccounts(ctx, n.logger, n.db, []*accountUpdate{{
		userID:      u,
		username:    username,
		displayName: displayNameWrapper,
		timezone:    timezoneWrapper,
		location:    locationWrapper,
		langTag:     langWrapper,
		avatarURL:   avatarWrapper,
		metadata:    metadataWrapper,
	}})
}

// @summary Delete an account by user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) User ID for the account to be deleted. Must be valid UUID.
// @param recorded(bool) Whether to record this deletion in the database. By default this is set to false.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AccountDeleteId(ctx context.Context, userID string, recorded bool) error {
	u, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	return DeleteAccount(ctx, n.logger, n.db, u, recorded)
}

// @summary Export account information for a specified user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) User ID for the account to be exported. Must be valid UUID.
// @return export(string) Account information for the provided user ID, in JSON format.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AccountExportId(ctx context.Context, userID string) (string, error) {
	u, err := uuid.FromString(userID)
	if err != nil {
		return "", errors.New("expects user ID to be a valid identifier")
	}

	export, err := ExportAccount(ctx, n.logger, n.db, u)
	if err != nil {
		return "", fmt.Errorf("error exporting account: %v", err.Error())
	}

	exportBytes, err := n.protojsonMarshaler.Marshal(export)
	if err != nil {
		return "", fmt.Errorf("error encoding account export: %v", err.Error())
	}

	return string(exportBytes), nil
}

// @summary Fetch one or more users by ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userIds([]string) An array of user IDs to fetch.
// @return users([]*api.Users) A list of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UsersGetId(ctx context.Context, userIDs []string, facebookIDs []string) ([]*api.User, error) {
	if len(userIDs) == 0 && len(facebookIDs) == 0 {
		return make([]*api.User, 0), nil
	}

	for _, id := range userIDs {
		if _, err := uuid.FromString(id); err != nil {
			return nil, errors.New("each user id must be a valid id string")
		}
	}

	users, err := GetUsers(ctx, n.logger, n.db, n.tracker, userIDs, nil, facebookIDs)
	if err != nil {
		return nil, err
	}

	return users.Users, nil
}

// @summary Fetch one or more users by username.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param usernames([]string) An array of usernames to fetch.
// @return users([]*api.Users) A list of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UsersGetUsername(ctx context.Context, usernames []string) ([]*api.User, error) {
	if len(usernames) == 0 {
		return make([]*api.User, 0), nil
	}

	for _, username := range usernames {
		if username == "" {
			return nil, errors.New("each username must be a string")
		}
	}

	users, err := GetUsers(ctx, n.logger, n.db, n.tracker, nil, usernames, nil)
	if err != nil {
		return nil, err
	}

	return users.Users, nil
}

// @summary Fetch one or more users randomly.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param count(int) The number of users to fetch.
// @return users([]*api.Users) A list of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UsersGetRandom(ctx context.Context, count int) ([]*api.User, error) {
	if count == 0 {
		return make([]*api.User, 0), nil
	}

	if count < 0 || count > 1000 {
		return nil, errors.New("count must be 0-1000")
	}

	return GetRandomUsers(ctx, n.logger, n.db, n.tracker, count)
}

// @summary Ban one or more users by ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userIds([]string) An array of user IDs to ban.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UsersBanId(ctx context.Context, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}

	ids := make([]uuid.UUID, 0, len(userIDs))
	for _, id := range userIDs {
		id, err := uuid.FromString(id)
		if err != nil {
			return errors.New("each user id must be a valid id string")
		}
		ids = append(ids, id)
	}

	return BanUsers(ctx, n.logger, n.db, n.sessionCache, ids)
}

// @summary Unban one or more users by ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userIds([]string) An array of user IDs to unban.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UsersUnbanId(ctx context.Context, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}

	ids := make([]uuid.UUID, 0, len(userIDs))
	for _, id := range userIDs {
		id, err := uuid.FromString(id)
		if err != nil {
			return errors.New("each user id must be a valid id string")
		}
		ids = append(ids, id)
	}

	return UnbanUsers(ctx, n.logger, n.db, n.sessionCache, ids)
}

// @summary Link Apple authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param token(string) Apple sign in token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkApple(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkApple(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

// @summary Link custom authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param customId(string) Custom ID to be linked to the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkCustom(ctx context.Context, userID, customID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkCustom(ctx, n.logger, n.db, id, customID)
}

// @summary Link device authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param deviceId(string) Device ID to be linked to the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkDevice(ctx context.Context, userID, deviceID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkDevice(ctx, n.logger, n.db, id, deviceID)
}

// @summary Link email authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param email(string) Authentication email to be linked to the user.
// @param password(string) Password to set. Must be longer than 8 characters.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkEmail(ctx context.Context, userID, email, password string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkEmail(ctx, n.logger, n.db, id, email, password)
}

// @summary Link Facebook authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param username(string) If left empty, one is generated.
// @param token(string) Facebook OAuth or Limited Login (JWT) access token.
// @param importFriends(bool) Whether to automatically import Facebook friends after authentication. This is true by default.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkFacebook(ctx context.Context, userID, username, token string, importFriends bool) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkFacebook(ctx, n.logger, n.db, n.socialClient, n.router, id, username, n.config.GetSocial().FacebookLimitedLogin.AppId, token, importFriends)
}

// @summary Link Facebook Instant Game authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param playerInfo(string) Facebook player info.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkFacebookInstantGame(ctx context.Context, userID, signedPlayerInfo string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkFacebookInstantGame(ctx, n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo)
}

// @summary Link Apple Game Center authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param playerId(string) Player ID provided by Game Center.
// @param bundleId(string) Bundle ID of your app on iTunesConnect.
// @param timestamp(int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(string) A random string returned by Game Center authentication on client.
// @param signature(string) A signature returned by Game Center authentication on client.
// @param publicKeyUrl(string) A URL to the public key returned by Game Center authentication on client.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkGameCenter(ctx context.Context, userID, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkGameCenter(ctx, n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyUrl)
}

// @summary Link Google authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param token(string) Google OAuth access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkGoogle(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkGoogle(ctx, n.logger, n.db, n.socialClient, id, token)
}

// @summary Link Steam authentication to a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be linked.
// @param username(string) If left empty, one is generated.
// @param token(string) Steam access token.
// @param importFriends(bool) Whether to automatically import Steam friends after authentication. This is true by default.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkSteam(ctx context.Context, userID, username, token string, importFriends bool) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkSteam(ctx, n.logger, n.db, n.config, n.socialClient, n.router, id, username, token, importFriends)
}

// @summary Read file from user device.
// @param relPath(string) Relative path to the file to be read.
// @return fileRead(*os.File) The read file.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ReadFile(relPath string) (*os.File, error) {
	return FileRead(n.config.GetRuntime().Path, relPath)
}

// @summary Unlink Apple authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param token(string) Apple sign in token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkApple(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkApple(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

// @summary Unlink custom authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param customId(string) Custom ID to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkCustom(ctx context.Context, userID, customID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkCustom(ctx, n.logger, n.db, id, customID)
}

// @summary Unlink device authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param deviceId(string) Device ID to be unlinked to the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkDevice(ctx context.Context, userID, deviceID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkDevice(ctx, n.logger, n.db, id, deviceID)
}

// @summary Unlink email authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param email(string) Email to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkEmail(ctx context.Context, userID, email string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkEmail(ctx, n.logger, n.db, id, email)
}

// @summary Unlink Facebook authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param token(string) Facebook OAuth or Limited Login (JWT) access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkFacebook(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkFacebook(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, id, token)
}

// @summary Unlink Facebook Instant Game authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param playerInfo(string) Facebook player info.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkFacebookInstantGame(ctx context.Context, userID, signedPlayerInfo string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkFacebookInstantGame(ctx, n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo)
}

// @summary Unlink Apple Game Center authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param playerId(string) Player ID provided by Game Center.
// @param bundleId(string) Bundle ID of your app on iTunesConnect.
// @param timestamp(int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(string) A random string returned by Game Center authentication on client.
// @param signature(string) A signature returned by Game Center authentication on client.
// @param publicKeyUrl(string) A URL to the public key returned by Game Center authentication on client.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkGameCenter(ctx context.Context, userID, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkGameCenter(ctx, n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyUrl)
}

// @summary Unlink Google authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param token(string) Google OAuth access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkGoogle(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkGoogle(ctx, n.logger, n.db, n.socialClient, id, token)
}

// @summary Unlink Steam authentication from a user ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID to be unlinked.
// @param token(string) Steam access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkSteam(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkSteam(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

// @summary List all users currently online and connected to a stream.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @param includeHidden(bool) Include stream presences marked as hidden in the results.
// @param includeNotHidden(bool) Include stream presences not marked as hidden in the results.
// @return presences([]runtime.Presences) Array of stream presences and their information.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamUserList(mode uint8, subject, subcontext, label string, includeHidden, includeNotHidden bool) ([]runtime.Presence, error) {
	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	var err error
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return nil, errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return nil, errors.New("stream subcontext must be a valid identifier")
		}
	}

	presences := n.tracker.ListByStream(stream, includeHidden, includeNotHidden)
	runtimePresences := make([]runtime.Presence, len(presences))
	for i, p := range presences {
		runtimePresences[i] = runtime.Presence(p)
	}
	return runtimePresences, nil
}

// @summary Retreive a stream presence and metadata by user ID.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @param userId(string) The user ID to fetch information for.
// @param sessionId(string) The current session ID for the user.
// @return meta(runtime.PresenceMeta) Presence and metadata for the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamUserGet(mode uint8, subject, subcontext, label, userID, sessionID string) (runtime.PresenceMeta, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("expects valid user id")
	}

	sid, err := uuid.FromString(sessionID)
	if err != nil {
		return nil, errors.New("expects valid session id")
	}

	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return nil, errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return nil, errors.New("stream subcontext must be a valid identifier")
		}
	}

	if meta := n.tracker.GetLocalBySessionIDStreamUserID(sid, stream, uid); meta != nil {
		return meta, nil
	}
	return nil, nil
}

// @summary Add a user to a stream.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @param userId(string) The user ID to be added.
// @param sessionId(string) The current session ID for the user.
// @param hidden(bool) Whether the user will be marked as hidden.
// @param persistence(bool) Whether message data should be stored in the database.
// @param status(string) User status message.
// @return success(bool) Whether the user was successfully added.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamUserJoin(mode uint8, subject, subcontext, label, userID, sessionID string, hidden, persistence bool, status string) (bool, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return false, errors.New("expects valid user id")
	}

	sid, err := uuid.FromString(sessionID)
	if err != nil {
		return false, errors.New("expects valid session id")
	}

	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return false, errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return false, errors.New("stream subcontext must be a valid identifier")
		}
	}

	success, newlyTracked, err := n.streamManager.UserJoin(stream, uid, sid, hidden, persistence, status)
	if err != nil {
		return false, err
	}
	if !success {
		return false, errors.New("tracker rejected new presence, session is closing")
	}

	return newlyTracked, nil
}

// @summary Update a stream user by ID.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @param userId(string) The user ID to be updated.
// @param sessionId(string) The current session ID for the user.
// @param hidden(bool) Whether the user will be marked as hidden.
// @param persistence(bool) Whether message data should be stored in the database.
// @param status(string) User status message.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamUserUpdate(mode uint8, subject, subcontext, label, userID, sessionID string, hidden, persistence bool, status string) error {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects valid user id")
	}

	sid, err := uuid.FromString(sessionID)
	if err != nil {
		return errors.New("expects valid session id")
	}

	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return errors.New("stream subcontext must be a valid identifier")
		}
	}

	success, err := n.streamManager.UserUpdate(stream, uid, sid, hidden, persistence, status)
	if err != nil {
		return err
	}
	if !success {
		return errors.New("tracker rejected updated presence, session is closing")
	}

	return nil
}

// @summary Remove a user from a stream.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @param userId(string) The user ID to be removed.
// @param sessionId(string) The current session ID for the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamUserLeave(mode uint8, subject, subcontext, label, userID, sessionID string) error {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects valid user id")
	}

	sid, err := uuid.FromString(sessionID)
	if err != nil {
		return errors.New("expects valid session id")
	}

	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return errors.New("stream subcontext must be a valid identifier")
		}
	}

	return n.streamManager.UserLeave(stream, uid, sid)
}

// @summary Kick a user from a stream.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @param presence(runtime.Presence) The presence to be kicked.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamUserKick(mode uint8, subject, subcontext, label string, presence runtime.Presence) error {
	uid, err := uuid.FromString(presence.GetUserId())
	if err != nil {
		return errors.New("expects valid user id")
	}

	sid, err := uuid.FromString(presence.GetSessionId())
	if err != nil {
		return errors.New("expects valid session id")
	}

	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return errors.New("stream subcontext must be a valid identifier")
		}
	}

	return n.streamManager.UserLeave(stream, uid, sid)
}

// @summary Get a count of stream presences.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @return countByStream(int) Number of current stream presences.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamCount(mode uint8, subject, subcontext, label string) (int, error) {
	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	var err error
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return 0, errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return 0, errors.New("stream subcontext must be a valid identifier")
		}
	}

	return n.tracker.CountByStream(stream), nil
}

// @summary Close a stream and remove all presences on it.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamClose(mode uint8, subject, subcontext, label string) error {
	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	var err error
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return errors.New("stream subcontext must be a valid identifier")
		}
	}

	n.tracker.UntrackByStream(stream)

	return nil
}

// @summary Send data to presences on a stream.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @param data(string) The data to send.
// @param presences([]runtime.Presence) Array of presences to receive the sent data. If not set, will be sent to all presences.
// @param reliable(bool) Whether the sender has been validated prior.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamSend(mode uint8, subject, subcontext, label, data string, presences []runtime.Presence, reliable bool) error {
	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	var err error
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return errors.New("stream subcontext must be a valid identifier")
		}
	}

	var presenceIDs []*PresenceID
	if l := len(presences); l != 0 {
		presenceIDs = make([]*PresenceID, 0, l)
		for _, presence := range presences {
			sessionID, err := uuid.FromString(presence.GetSessionId())
			if err != nil {
				return errors.New("expects each presence session id to be a valid identifier")
			}
			node := presence.GetNodeId()
			if node == "" {
				node = n.node
			}

			presenceIDs = append(presenceIDs, &PresenceID{
				SessionID: sessionID,
				Node:      node,
			})
		}
	}

	streamWire := &rtapi.Stream{
		Mode:  int32(stream.Mode),
		Label: stream.Label,
	}
	if stream.Subject != uuid.Nil {
		streamWire.Subject = stream.Subject.String()
	}
	if stream.Subcontext != uuid.Nil {
		streamWire.Subcontext = stream.Subcontext.String()
	}
	msg := &rtapi.Envelope{Message: &rtapi.Envelope_StreamData{StreamData: &rtapi.StreamData{
		Stream: streamWire,
		// No sender.
		Data:     data,
		Reliable: reliable,
	}}}

	if len(presenceIDs) == 0 {
		// Sending to whole stream.
		n.router.SendToStream(n.logger, stream, msg, reliable)
	} else {
		// Sending to a subset of stream users.
		n.router.SendToPresenceIDs(n.logger, presenceIDs, msg, reliable)
	}

	return nil
}

// @summary Send a message to presences on a stream.
// @param mode(uint8) The type of stream, 'chat' for example.
// @param subject(string) The primary stream subject, typically a user ID.
// @param subcontext(string) A secondary subject, for example for direct chat between two users.
// @param label(string) Meta-information about the stream, for example a chat room name.
// @param msg(*rtapi.Envelope) The message to send.
// @param presences([]runtime.Presence) Array of presences to receive the sent data. If not set, will be sent to all presences.
// @param reliable(bool) Whether the sender has been validated prior.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StreamSendRaw(mode uint8, subject, subcontext, label string, msg *rtapi.Envelope, presences []runtime.Presence, reliable bool) error {
	stream := PresenceStream{
		Mode:  mode,
		Label: label,
	}
	var err error
	if subject != "" {
		stream.Subject, err = uuid.FromString(subject)
		if err != nil {
			return errors.New("stream subject must be a valid identifier")
		}
	}
	if subcontext != "" {
		stream.Subcontext, err = uuid.FromString(subcontext)
		if err != nil {
			return errors.New("stream subcontext must be a valid identifier")
		}
	}
	if msg == nil {
		return errors.New("expects a valid message")
	}

	var presenceIDs []*PresenceID
	if l := len(presences); l != 0 {
		presenceIDs = make([]*PresenceID, 0, l)
		for _, presence := range presences {
			sessionID, err := uuid.FromString(presence.GetSessionId())
			if err != nil {
				return errors.New("expects each presence session id to be a valid identifier")
			}
			node := presence.GetNodeId()
			if node == "" {
				node = n.node
			}

			presenceIDs = append(presenceIDs, &PresenceID{
				SessionID: sessionID,
				Node:      node,
			})
		}
	}

	if len(presenceIDs) == 0 {
		// Sending to whole stream.
		n.router.SendToStream(n.logger, stream, msg, reliable)
	} else {
		// Sending to a subset of stream users.
		n.router.SendToPresenceIDs(n.logger, presenceIDs, msg, reliable)
	}

	return nil
}

// @summary Disconnect a session.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param sessionId(string) The ID of the session to be disconnected.
// @param reason(runtime.PresenceReason) The reason for the session disconnect.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) SessionDisconnect(ctx context.Context, sessionID string, reason ...runtime.PresenceReason) error {
	sid, err := uuid.FromString(sessionID)
	if err != nil {
		return errors.New("expects valid session id")
	}

	return n.sessionRegistry.Disconnect(ctx, sid, reason...)
}

// @summary Log out a user from their current session.
// @param userId(string) The ID of the user to be logged out.
// @param token(string) The current session authentication token.
// @param refreshToken(string) The current session refresh token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) SessionLogout(userID, token, refreshToken string) error {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects valid user id")
	}

	return SessionLogout(n.config, n.sessionCache, uid, token, refreshToken)
}

// @summary Create a new authoritative realtime multiplayer match running on the given runtime module name. The given params are passed to the match's init hook.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param module(string) The name of an available runtime module that will be responsible for the match. This was registered in InitModule.
// @param params(map[string]interface{}) Any value to pass to the match init hook.
// @return matchId(string) The match ID of the newly created match. Clients can immediately use this ID to join the match.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MatchCreate(ctx context.Context, module string, params map[string]interface{}) (string, error) {
	if module == "" {
		return "", errors.New("expects module name")
	}

	n.RLock()
	fn := n.matchCreateFn
	n.RUnlock()

	return n.matchRegistry.CreateMatch(ctx, n.logger, fn, module, params)
}

// @summary Get information on a running match.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The ID of the match to fetch.
// @return match(*api.Match) Information for the running match.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MatchGet(ctx context.Context, id string) (*api.Match, error) {
	return n.matchRegistry.GetMatch(ctx, id)
}

// @summary List currently running realtime multiplayer matches and optionally filter them by authoritative mode, label, and current participant count.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param limit(int) The maximum number of matches to list. Default 1.
// @param authoritative(bool) Set true to only return authoritative matches, false to only return relayed matches. Default false.
// @param label(string) A label to filter authoritative matches by. Default "" meaning any label matches.
// @param minSize(int) Inclusive lower limit of current match participants.
// @param maxSize(int) Inclusive upper limit of current match participants.
// @param query(String) Additional query parameters to shortlist matches.
// @return match(*api.Match) A list of matches matching the parameters criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MatchList(ctx context.Context, limit int, authoritative bool, label string, minSize, maxSize *int, query string) ([]*api.Match, error) {
	authoritativeWrapper := &wrapperspb.BoolValue{Value: authoritative}
	var labelWrapper *wrapperspb.StringValue
	if label != "" {
		labelWrapper = &wrapperspb.StringValue{Value: label}
	}
	var queryWrapper *wrapperspb.StringValue
	if query != "" {
		queryWrapper = &wrapperspb.StringValue{Value: query}
	}
	var minSizeWrapper *wrapperspb.Int32Value
	if minSize != nil {
		minSizeWrapper = &wrapperspb.Int32Value{Value: int32(*minSize)}
	}
	var maxSizeWrapper *wrapperspb.Int32Value
	if maxSize != nil {
		maxSizeWrapper = &wrapperspb.Int32Value{Value: int32(*maxSize)}
	}

	return n.matchRegistry.ListMatches(ctx, limit, authoritativeWrapper, labelWrapper, minSizeWrapper, maxSizeWrapper, queryWrapper)
}

// @summary Allow the match handler to be sent a reservation signal to mark a user ID or session ID into the match state ahead of their join attempt and eventual join flow. Called when the match handler receives a runtime signal.
// @param ctx(context.Context) Context object represents information about the match and server for information purposes.
// @param id(string) The user ID or session ID to send a reservation signal for.
// @param data(string) An arbitrary input supplied by the runtime caller of the signal.
// @return state(interface{}) An (optionally) updated state. May be any non-nil value, or nil to end the match.
// @return data(string) Arbitrary data to return to the runtime caller of the signal. May be a string or nil.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MatchSignal(ctx context.Context, id string, data string) (string, error) {
	return n.matchRegistry.Signal(ctx, id, data)
}

// @summary Send one in-app notification to a user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID of the user to be sent the notification.
// @param subject(string) Notification subject. Must be set.
// @param content(map[string]interface{}) Notification content. Must be set but can be an struct.
// @param code(int) Notification code to use. Must be equal or greater than 0.
// @param sender(string) The sender of this notification. If left empty, it will be assumed that it is a system notification.
// @param persistent(bool) Whether to record this in the database for later listing. Defaults to false.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) NotificationSend(ctx context.Context, userID, subject string, content map[string]interface{}, code int, sender string, persistent bool) error {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects userID to be a valid UUID")
	}

	if subject == "" {
		return errors.New("expects subject to be a non-empty string")
	}

	contentBytes, err := json.Marshal(content)
	if err != nil {
		return fmt.Errorf("failed to convert content: %s", err.Error())
	}
	contentString := string(contentBytes)

	if code <= 0 {
		return errors.New("expects code to number above 0")
	}

	senderID := uuid.Nil.String()
	if sender != "" {
		suid, err := uuid.FromString(sender)
		if err != nil {
			return errors.New("expects sender to either be an empty string or a valid UUID")
		}
		senderID = suid.String()
	}

	nots := []*api.Notification{{
		Id:         uuid.Must(uuid.NewV4()).String(),
		Subject:    subject,
		Content:    contentString,
		Code:       int32(code),
		SenderId:   senderID,
		Persistent: persistent,
		CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
	}}
	notifications := map[uuid.UUID][]*api.Notification{
		uid: nots,
	}

	return NotificationSend(ctx, n.logger, n.db, n.router, notifications)
}

// @summary Send one or more in-app notifications to a user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param notifications([]*runtime.NotificationsSend) A list of notifications to be sent together.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) NotificationsSend(ctx context.Context, notifications []*runtime.NotificationSend) error {
	ns := make(map[uuid.UUID][]*api.Notification)

	for _, notification := range notifications {
		uid, err := uuid.FromString(notification.UserID)
		if err != nil {
			return errors.New("expects userID to be a valid UUID")
		}

		if notification.Subject == "" {
			return errors.New("expects subject to be a non-empty string")
		}

		contentBytes, err := json.Marshal(notification.Content)
		if err != nil {
			return fmt.Errorf("failed to convert content: %s", err.Error())
		}
		contentString := string(contentBytes)

		if notification.Code <= 0 {
			return errors.New("expects code to number above 0")
		}

		senderID := uuid.Nil.String()
		if notification.Sender != "" {
			suid, err := uuid.FromString(notification.Sender)
			if err != nil {
				return errors.New("expects sender to either be an empty string or a valid UUID")
			}
			senderID = suid.String()
		}

		no := ns[uid]
		if no == nil {
			no = make([]*api.Notification, 0, 1)
		}
		no = append(no, &api.Notification{
			Id:         uuid.Must(uuid.NewV4()).String(),
			Subject:    notification.Subject,
			Content:    contentString,
			Code:       int32(notification.Code),
			SenderId:   senderID,
			Persistent: notification.Persistent,
			CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
		})
		ns[uid] = no
	}

	return NotificationSend(ctx, n.logger, n.db, n.router, ns)
}

// @summary Update a user's wallet with the given changeset.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The ID of the user whose wallet to update.
// @param changeset(map[string]int64) The set of wallet operations to apply.
// @param metadata(map[string]interface{}) Additional metadata to tag the wallet update with.
// @param updateLedger(bool) Whether to record this update in the ledger. Defaults to false.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) WalletUpdate(ctx context.Context, userID string, changeset map[string]int64, metadata map[string]interface{}, updateLedger bool) (map[string]int64, map[string]int64, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, nil, errors.New("expects a valid user id")
	}

	metadataBytes := []byte("{}")
	if metadata != nil {
		metadataBytes, err = json.Marshal(metadata)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to convert metadata: %s", err.Error())
		}
	}

	results, err := UpdateWallets(ctx, n.logger, n.db, []*walletUpdate{{
		UserID:    uid,
		Changeset: changeset,
		Metadata:  string(metadataBytes),
	}}, updateLedger)
	if err != nil {
		if len(results) == 0 {
			return nil, nil, err
		}
		return results[0].Updated, results[0].Previous, err
	}

	if len(results) == 0 {
		// May happen if user ID does not exist.
		return nil, nil, errors.New("user not found")
	}

	return results[0].Updated, results[0].Previous, nil
}

// @summary Update one or more user wallets with individual changesets. This function will also insert a new wallet ledger item into each user's wallet history that tracks their update.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param updates([]*runtime.WalletUpdate) The set of user wallet update operations to apply.
// @param updateLedger(bool) Whether to record this update in the ledger. Defaults to false.
// @return updateWallets(runtime.WallateUpdateResult) A list of wallet update results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) WalletsUpdate(ctx context.Context, updates []*runtime.WalletUpdate, updateLedger bool) ([]*runtime.WalletUpdateResult, error) {
	size := len(updates)
	if size == 0 {
		return nil, nil
	}

	walletUpdates := make([]*walletUpdate, size)

	for i, update := range updates {
		uid, err := uuid.FromString(update.UserID)
		if err != nil {
			return nil, errors.New("expects a valid user id")
		}

		metadataBytes := []byte("{}")
		if update.Metadata != nil {
			metadataBytes, err = json.Marshal(update.Metadata)
			if err != nil {
				return nil, fmt.Errorf("failed to convert metadata: %s", err.Error())
			}
		}

		walletUpdates[i] = &walletUpdate{
			UserID:    uid,
			Changeset: update.Changeset,
			Metadata:  string(metadataBytes),
		}
	}

	return UpdateWallets(ctx, n.logger, n.db, walletUpdates, updateLedger)
}

// @summary Update the metadata for a particular wallet update in a user's wallet ledger history. Useful when adding a note to a transaction for example.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param itemId(string) The ID of the wallet ledger item to update.
// @param metadata(map[string]interface{}) The new metadata to set on the wallet ledger item.
// @return updateWalletLedger(runtime.WalletLedgerItem) The updated wallet ledger item.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) WalletLedgerUpdate(ctx context.Context, itemID string, metadata map[string]interface{}) (runtime.WalletLedgerItem, error) {
	id, err := uuid.FromString(itemID)
	if err != nil {
		return nil, errors.New("expects a valid item id")
	}

	metadataBytes, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to convert metadata: %s", err.Error())
	}

	return UpdateWalletLedger(ctx, n.logger, n.db, id, string(metadataBytes))
}

// @summary List all wallet updates for a particular user from oldest to newest.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The ID of the user to list wallet updates for.
// @param limit(int) Limit number of results. Defaults to 100.
// @param cursor(string) Pagination cursor from previous result. If none available set to nil or "" (empty string).
// @return runtimeItems([]runtime.WalletLedgerItem) A Go slice containing wallet entries with Id, UserId, CreateTime, UpdateTime, Changeset, Metadata parameters.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) WalletLedgerList(ctx context.Context, userID string, limit int, cursor string) ([]runtime.WalletLedgerItem, string, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, "", errors.New("expects a valid user id")
	}

	if limit < 0 || limit > 100 {
		return nil, "", errors.New("expects limit to be 0-100")
	}

	items, newCursor, _, err := ListWalletLedger(ctx, n.logger, n.db, uid, &limit, cursor)
	if err != nil {
		return nil, "", err
	}

	runtimeItems := make([]runtime.WalletLedgerItem, len(items))
	for i, item := range items {
		runtimeItems[i] = runtime.WalletLedgerItem(item)
	}
	return runtimeItems, newCursor, nil
}

// @summary List records in a collection and page through results. The records returned can be filtered to those owned by the user or "" for public records.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) User ID to list records for or "" (empty string) for public records.
// @param collection(string) Collection to list data from.
// @param limit(int) Limit number of records retrieved. Defaults to 100.
// @param cursor(string) Pagination cursor from previous result. If none available set to nil or "" (empty string).
// @return objects([]*api.StorageObject) A list of storage objects.
// @return cursor(string) Pagination cursor.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StorageList(ctx context.Context, userID, collection string, limit int, cursor string) ([]*api.StorageObject, string, error) {
	var uid *uuid.UUID
	if userID != "" {
		u, err := uuid.FromString(userID)
		if err != nil {
			return nil, "", errors.New("expects an empty or valid user id")
		}
		uid = &u
	}

	objectList, _, err := StorageListObjects(ctx, n.logger, n.db, uuid.Nil, uid, collection, limit, cursor)
	if err != nil {
		return nil, "", err
	}

	return objectList.Objects, objectList.Cursor, nil
}

// @summary Fetch one or more records by their bucket/collection/keyname and optional user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param objectIds([]*runtime.StorageReads) An array of object identifiers to be fetched.
// @return objects([]*api.StorageObject) A list of matches matching the parameters criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StorageRead(ctx context.Context, reads []*runtime.StorageRead) ([]*api.StorageObject, error) {
	size := len(reads)
	if size == 0 {
		return make([]*api.StorageObject, 0), nil
	}
	objectIDs := make([]*api.ReadStorageObjectId, size)

	for i, read := range reads {
		if read.Collection == "" {
			return nil, errors.New("expects collection to be a non-empty string")
		}
		if read.Key == "" {
			return nil, errors.New("expects key to be a non-empty string")
		}
		uid := uuid.Nil
		var err error
		if read.UserID != "" {
			uid, err = uuid.FromString(read.UserID)
			if err != nil {
				return nil, errors.New("expects an empty or valid user id")
			}
		}

		objectIDs[i] = &api.ReadStorageObjectId{
			Collection: read.Collection,
			Key:        read.Key,
			UserId:     uid.String(),
		}
	}

	objects, err := StorageReadObjects(ctx, n.logger, n.db, uuid.Nil, objectIDs)
	if err != nil {
		return nil, err
	}

	return objects.Objects, nil
}

// @summary Write one or more objects by their collection/keyname and optional user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param objectIds([]*runtime.StorageWrite) An array of object identifiers to be written.
// @return acks([]*api.StorageObjectAcks) A list of acks with the version of the written objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StorageWrite(ctx context.Context, writes []*runtime.StorageWrite) ([]*api.StorageObjectAck, error) {
	size := len(writes)
	if size == 0 {
		return make([]*api.StorageObjectAck, 0), nil
	}

	ops := make(StorageOpWrites, 0, size)

	for _, write := range writes {
		if write.Collection == "" {
			return nil, errors.New("expects collection to be a non-empty string")
		}
		if write.Key == "" {
			return nil, errors.New("expects key to be a non-empty string")
		}
		if write.UserID != "" {
			if _, err := uuid.FromString(write.UserID); err != nil {
				return nil, errors.New("expects an empty or valid user id")
			}
		}
		if maybeJSON := []byte(write.Value); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
			return nil, errors.New("value must be a JSON-encoded object")
		}

		op := &StorageOpWrite{
			Object: &api.WriteStorageObject{
				Collection:      write.Collection,
				Key:             write.Key,
				Value:           write.Value,
				Version:         write.Version,
				PermissionRead:  &wrapperspb.Int32Value{Value: int32(write.PermissionRead)},
				PermissionWrite: &wrapperspb.Int32Value{Value: int32(write.PermissionWrite)},
			},
		}
		if write.UserID == "" {
			op.OwnerID = uuid.Nil.String()
		} else {
			op.OwnerID = write.UserID
		}

		ops = append(ops, op)
	}

	acks, _, err := StorageWriteObjects(ctx, n.logger, n.db, true, ops)
	if err != nil {
		return nil, err
	}

	return acks.Acks, nil
}

// @summary Remove one or more objects by their collection/keyname and optional user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param objectIds([]*runtime.StorageDelete) An array of object identifiers to be deleted.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StorageDelete(ctx context.Context, deletes []*runtime.StorageDelete) error {
	size := len(deletes)
	if size == 0 {
		return nil
	}

	ops := make(StorageOpDeletes, 0, size)

	for _, del := range deletes {
		if del.Collection == "" {
			return errors.New("expects collection to be a non-empty string")
		}
		if del.Key == "" {
			return errors.New("expects key to be a non-empty string")
		}
		if del.UserID != "" {
			if _, err := uuid.FromString(del.UserID); err != nil {
				return errors.New("expects an empty or valid user id")
			}
		}

		op := &StorageOpDelete{
			ObjectID: &api.DeleteStorageObjectId{
				Collection: del.Collection,
				Key:        del.Key,
				Version:    del.Version,
			},
		}
		if del.UserID == "" {
			op.OwnerID = uuid.Nil.String()
		} else {
			op.OwnerID = del.UserID
		}

		ops = append(ops, op)
	}

	_, err := StorageDeleteObjects(ctx, n.logger, n.db, true, ops)

	return err
}

// @summary Update account, storage, and wallet information simultaneously.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param accountUpdates([]*runtime.AccountUpdate) Array of account information to be updated.
// @param storageWrites([]*runtime.StorageWrite) Array of storage objects to be updated.
// @param walletUpdates([]*runtime.WalletUpdate) Array of wallet updates to be made.
// @param updateLedger(bool) Whether to record this wallet update in the ledger. Defaults to false.
// @return storageWriteOps([]*api.StorageObjectAck) A list of acks with the version of the written objects.
// @return walletUpdateOps(*runtime.WalletUpdateResult) A list of wallet updates results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MultiUpdate(ctx context.Context, accountUpdates []*runtime.AccountUpdate, storageWrites []*runtime.StorageWrite, walletUpdates []*runtime.WalletUpdate, updateLedger bool) ([]*api.StorageObjectAck, []*runtime.WalletUpdateResult, error) {
	// Process account update inputs.
	accountUpdateOps := make([]*accountUpdate, 0, len(accountUpdates))
	for _, update := range accountUpdates {
		u, err := uuid.FromString(update.UserID)
		if err != nil {
			return nil, nil, errors.New("expects user ID to be a valid identifier")
		}

		var metadataWrapper *wrapperspb.StringValue
		if update.Metadata != nil {
			metadataBytes, err := json.Marshal(update.Metadata)
			if err != nil {
				return nil, nil, fmt.Errorf("error encoding metadata: %v", err.Error())
			}
			metadataWrapper = &wrapperspb.StringValue{Value: string(metadataBytes)}
		}

		var displayNameWrapper *wrapperspb.StringValue
		if update.DisplayName != "" {
			displayNameWrapper = &wrapperspb.StringValue{Value: update.DisplayName}
		}
		var timezoneWrapper *wrapperspb.StringValue
		if update.Timezone != "" {
			timezoneWrapper = &wrapperspb.StringValue{Value: update.Timezone}
		}
		var locationWrapper *wrapperspb.StringValue
		if update.Location != "" {
			locationWrapper = &wrapperspb.StringValue{Value: update.Location}
		}
		var langWrapper *wrapperspb.StringValue
		if update.LangTag != "" {
			langWrapper = &wrapperspb.StringValue{Value: update.LangTag}
		}
		var avatarWrapper *wrapperspb.StringValue
		if update.AvatarUrl != "" {
			avatarWrapper = &wrapperspb.StringValue{Value: update.AvatarUrl}
		}

		accountUpdateOps = append(accountUpdateOps, &accountUpdate{
			userID:      u,
			username:    update.Username,
			displayName: displayNameWrapper,
			timezone:    timezoneWrapper,
			location:    locationWrapper,
			langTag:     langWrapper,
			avatarURL:   avatarWrapper,
			metadata:    metadataWrapper,
		})
	}

	// Process storage write inputs.
	storageWriteOps := make(StorageOpWrites, 0, len(storageWrites))
	for _, write := range storageWrites {
		if write.Collection == "" {
			return nil, nil, errors.New("expects collection to be a non-empty string")
		}
		if write.Key == "" {
			return nil, nil, errors.New("expects key to be a non-empty string")
		}
		if write.UserID != "" {
			if _, err := uuid.FromString(write.UserID); err != nil {
				return nil, nil, errors.New("expects an empty or valid user id")
			}
		}
		if maybeJSON := []byte(write.Value); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
			return nil, nil, errors.New("value must be a JSON-encoded object")
		}

		op := &StorageOpWrite{
			Object: &api.WriteStorageObject{
				Collection:      write.Collection,
				Key:             write.Key,
				Value:           write.Value,
				Version:         write.Version,
				PermissionRead:  &wrapperspb.Int32Value{Value: int32(write.PermissionRead)},
				PermissionWrite: &wrapperspb.Int32Value{Value: int32(write.PermissionWrite)},
			},
		}
		if write.UserID == "" {
			op.OwnerID = uuid.Nil.String()
		} else {
			op.OwnerID = write.UserID
		}

		storageWriteOps = append(storageWriteOps, op)
	}

	// Process wallet update inputs.
	walletUpdateOps := make([]*walletUpdate, len(walletUpdates))
	for i, update := range walletUpdates {
		uid, err := uuid.FromString(update.UserID)
		if err != nil {
			return nil, nil, errors.New("expects a valid user id")
		}

		metadataBytes := []byte("{}")
		if update.Metadata != nil {
			metadataBytes, err = json.Marshal(update.Metadata)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to convert metadata: %s", err.Error())
			}
		}

		walletUpdateOps[i] = &walletUpdate{
			UserID:    uid,
			Changeset: update.Changeset,
			Metadata:  string(metadataBytes),
		}
	}

	return MultiUpdate(ctx, n.logger, n.db, accountUpdateOps, storageWriteOps, walletUpdateOps, updateLedger)
}

// @summary Setup a new dynamic leaderboard with the specified ID and various configuration settings. The leaderboard will be created if it doesn't already exist, otherwise its configuration will not be updated.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the new leaderboard. This is used by clients to submit scores.
// @param authoritative(bool) Mark the leaderboard as authoritative which ensures updates can only be made via the Go runtime. No client can submit a score directly. Default false.
// @param sortOrder(string) The sort order for records in the leaderboard; possible values are "asc" or "desc". Default "desc".
// @param operator(string) The operator that determines how scores behave when submitted; possible values are "best", "set", or "incr". Default "best".
// @param resetSchedule(string) The cron format used to define the reset schedule for the leaderboard. This controls when a leaderboard is reset and can be used to power daily/weekly/monthly leaderboards.
// @param metadata(map[string]interface{}) The metadata you want associated to the leaderboard. Some good examples are weather conditions for a racing game.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardCreate(ctx context.Context, id string, authoritative bool, sortOrder, operator, resetSchedule string, metadata map[string]interface{}) error {
	if id == "" {
		return errors.New("expects a leaderboard ID string")
	}

	sort := LeaderboardSortOrderDescending
	switch sortOrder {
	case "desc":
		sort = LeaderboardSortOrderDescending
	case "asc":
		sort = LeaderboardSortOrderAscending
	default:
		return errors.New("expects sort order to be 'asc' or 'desc'")
	}

	oper := LeaderboardOperatorBest
	switch operator {
	case "best":
		oper = LeaderboardOperatorBest
	case "set":
		oper = LeaderboardOperatorSet
	case "incr":
		oper = LeaderboardOperatorIncrement
	case "decr":
		oper = LeaderboardOperatorDecrement
	default:
		return errors.New("expects operator to be 'best', 'set', 'incr' or 'decr'")
	}

	if resetSchedule != "" {
		if _, err := cronexpr.Parse(resetSchedule); err != nil {
			return errors.New("expects reset schedule to be a valid CRON expression")
		}
	}

	metadataStr := "{}"
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return fmt.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataStr = string(metadataBytes)
	}

	_, err := n.leaderboardCache.Create(ctx, id, authoritative, sort, oper, resetSchedule, metadataStr)
	if err != nil {
		return err
	}

	n.leaderboardScheduler.Update()

	return nil
}

// @summary Delete a leaderboard and all scores that belong to it.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the leaderboard to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardDelete(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("expects a leaderboard ID string")
	}

	return n.leaderboardCache.Delete(ctx, id)
}

// @summary Find leaderboards which have been created on the server. Leaderboards can be filtered with categories.
// @param categoryStart(int) Filter leaderboards with categories greater or equal than this value.
// @param categoryEnd(int) Filter leaderboards with categories equal or less than this value.
// @param limit(int) Return only the required number of leaderboards denoted by this limit value.
// @param cursor(string) Cursor to paginate to the next result set. If this is empty/null there are no further results.
// @return leaderboardList(*api.LeaderboardList) A list of leaderboard results and possibly a cursor.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardList(categoryStart, categoryEnd, limit int, cursor string) (*api.LeaderboardList, error) {
	if categoryStart < 0 || categoryStart >= 128 {
		return nil, errors.New("categoryStart must be 0-127")
	}
	if categoryEnd < 0 || categoryEnd >= 128 {
		return nil, errors.New("categoryEnd must be 0-127")
	}

	if limit < 1 || limit > 100 {
		return nil, errors.New("limit must be 1-100")
	}

	var cursorPtr *LeaderboardListCursor
	if cursor != "" {
		cb, err := base64.StdEncoding.DecodeString(cursor)
		if err != nil {
			return nil, errors.New("expects cursor to be valid when provided")
		}
		cursorPtr = &LeaderboardListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursorPtr); err != nil {
			return nil, errors.New("expects cursor to be valid when provided")
		}
	}

	return LeaderboardList(n.logger, n.leaderboardCache, categoryStart, categoryEnd, limit, cursorPtr)
}

// @summary List records on the specified leaderboard, optionally filtering to only a subset of records by their owners. Records will be listed in the preconfigured leaderboard sort order.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the leaderboard to list. Mandatory field.
// @param owners([]string) Array of owners to filter to.
// @param limit(int) The maximum number of records to return (Max 10,000).
// @param cursor(string) Cursor to paginate to the next result set. If this is empty/null there are no further results.
// @return records(*api.LeaderboardRecord) A page of leaderboard records.
// @return ownerRecords(*api.LeaderboardRecord) A list of owner leaderboard records (empty if the owners input parameter is not set).
// @return nextCursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any).
// @return prevCursor(string) An optional previous page cursor that can be used to retrieve the previous page of records (if any).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardRecordsList(ctx context.Context, id string, ownerIDs []string, limit int, cursor string, expiry int64) ([]*api.LeaderboardRecord, []*api.LeaderboardRecord, string, string, error) {
	if id == "" {
		return nil, nil, "", "", errors.New("expects a leaderboard ID string")
	}

	for _, o := range ownerIDs {
		if _, err := uuid.FromString(o); err != nil {
			return nil, nil, "", "", errors.New("expects each owner ID to be a valid identifier")
		}
	}

	var limitWrapper *wrapperspb.Int32Value
	if limit < 0 || limit > 10000 {
		return nil, nil, "", "", errors.New("expects limit to be 0-10000")
	} else if limit > 0 {
		limitWrapper = &wrapperspb.Int32Value{Value: int32(limit)}
	}

	if expiry < 0 {
		return nil, nil, "", "", errors.New("expects expiry to equal or greater than 0")
	}

	list, err := LeaderboardRecordsList(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, id, limitWrapper, cursor, ownerIDs, expiry)
	if err != nil {
		return nil, nil, "", "", err
	}

	return list.Records, list.OwnerRecords, list.NextCursor, list.PrevCursor, nil
}

// @summary Use the preconfigured operator for the given leaderboard to submit a score for a particular user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the leaderboard to submit to.
// @param owner(string) The owner of this score submission. Mandatory field.
// @param username(string) The owner username of this score submission, if it's a user.
// @param score(int64) The score to submit. Default 0.
// @param subscore(int64) A secondary subscore parameter for the submission. Default 0.
// @param metadata(map[string]interface{}) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
// @return record(*api.LeaderboardRecord) The newly created leaderboard record.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}, overrideOperator *int) (*api.LeaderboardRecord, error) {
	if id == "" {
		return nil, errors.New("expects a leaderboard ID string")
	}

	if _, err := uuid.FromString(ownerID); err != nil {
		return nil, errors.New("expects owner ID to be a valid identifier")
	}

	// Username is optional.

	if score < 0 {
		return nil, errors.New("expects score to be >= 0")
	}
	if subscore < 0 {
		return nil, errors.New("expects subscore to be >= 0")
	}

	metadataStr := ""
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return nil, fmt.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataStr = string(metadataBytes)
	}

	operator := api.Operator_NO_OVERRIDE
	if overrideOperator != nil {
		if _, ok := api.Operator_name[int32(*overrideOperator)]; !ok {
			return nil, ErrInvalidOperator
		}
		operator = api.Operator(*overrideOperator)
	}

	return LeaderboardRecordWrite(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, uuid.Nil, id, ownerID, username, score, subscore, metadataStr, operator)
}

// @summary Remove an owner's record from a leaderboard, if one exists.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the leaderboard to delete from.
// @param owner(string) The owner of the score to delete. Mandatory field.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardRecordDelete(ctx context.Context, id, ownerID string) error {
	if id == "" {
		return errors.New("expects a leaderboard ID string")
	}

	if _, err := uuid.FromString(ownerID); err != nil {
		return errors.New("expects owner ID to be a valid identifier")
	}

	return LeaderboardRecordDelete(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, uuid.Nil, id, ownerID)
}

// @summary Fetch one or more leaderboards by ID.
// @param ids([]string) The table array of leaderboard ids.
// @return leaderboardsGet(*api.Leaderboard) The leaderboard records according to ID.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardsGetId(ctx context.Context, IDs []string) ([]*api.Leaderboard, error) {
	return LeaderboardsGet(n.leaderboardCache, IDs), nil
}

// @summary Setup a new dynamic tournament with the specified ID and various configuration settings. The underlying leaderboard will be created if it doesn't already exist, otherwise its configuration will not be updated.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the new tournament. This is used by clients to submit scores.
// @param authoritative(bool) Whether the tournament created is server authoritative. Default true.
// @param sortOrder(string) The sort order for records in the tournament. Possible values are "asc" or "desc" (Default).
// @param operator(string) The operator that determines how scores behave when submitted. The possible values are "best" (Default), "set", or "incr".
// @param resetSchedule(string) The cron format used to define the reset schedule for the tournament. This controls when the underlying leaderboard resets and the tournament is considered active again. Optional.
// @param metadata(map[string]interface{}) The metadata you want associated to the tournament. Some good examples are weather conditions for a racing game. Optional.
// @param title(string) The title of the tournament. Optional.
// @param description(string) The description of the tournament. Optional.
// @param category(int) A category associated with the tournament. This can be used to filter different types of tournaments. Between 0 and 127. Optional.
// @param startTime(int) The start time of the tournament. Leave empty for immediately or a future time.
// @param endTime(int) The end time of the tournament. When the end time is elapsed, the tournament will not reset and will cease to exist. Must be greater than startTime if set. Default value is never.
// @param duration(int) The active duration for a tournament. This is the duration when clients are able to submit new records. The duration starts from either the reset period or tournament start time whichever is sooner. A game client can query the tournament for results between end of duration and next reset period.
// @param maxSize(int) Maximum size of participants in a tournament. Optional.
// @param maxNumScore(int) Maximum submission attempts for a tournament record.
// @param joinRequired(bool) Whether the tournament needs to be joined before a record write is allowed. Defaults to false.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentCreate(ctx context.Context, id string, authoritative bool, sortOrder, operator, resetSchedule string, metadata map[string]interface{}, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	sort := LeaderboardSortOrderDescending
	switch sortOrder {
	case "desc":
		sort = LeaderboardSortOrderDescending
	case "asc":
		sort = LeaderboardSortOrderAscending
	default:
		return errors.New("expects sort order to be 'asc' or 'desc'")
	}

	oper := LeaderboardOperatorBest
	switch operator {
	case "best":
		oper = LeaderboardOperatorBest
	case "set":
		oper = LeaderboardOperatorSet
	case "incr":
		oper = LeaderboardOperatorIncrement
	case "decr":
		oper = LeaderboardOperatorDecrement
	default:
		return errors.New("expects sort order to be 'best', 'set', 'incr' or 'decr'")
	}

	if resetSchedule != "" {
		if _, err := cronexpr.Parse(resetSchedule); err != nil {
			return errors.New("expects reset schedule to be a valid CRON expression")
		}
	}

	metadataStr := "{}"
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return fmt.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataStr = string(metadataBytes)
	}

	if category < 0 || category >= 128 {
		return errors.New("category must be 0-127")
	}
	if startTime < 0 {
		return errors.New("startTime must be >= 0")
	}
	if endTime < 0 {
		return errors.New("endTime must be >= 0")
	}
	if endTime != 0 && endTime < startTime {
		return errors.New("endTime must be >= startTime")
	}
	if duration <= 0 {
		return errors.New("duration must be > 0")
	}
	if maxSize < 0 {
		return errors.New("maxSize must be >= 0")
	}
	if maxNumScore < 0 {
		return errors.New("maxNumScore must be >= 0")
	}

	return TournamentCreate(ctx, n.logger, n.leaderboardCache, n.leaderboardScheduler, id, authoritative, sort, oper, resetSchedule, metadataStr, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired)
}

// @summary Delete a tournament and all records that belong to it.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the tournament to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentDelete(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	return TournamentDelete(ctx, n.leaderboardCache, n.leaderboardRankCache, n.leaderboardScheduler, id)
}

// @summary Add additional score attempts to the owner's tournament record. This overrides the max number of score attempts allowed in the tournament for this specific owner.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the tournament to update.
// @param owner(string) The owner of the records to increment the count for.
// @param count(int) The number of attempt counts to increment. Can be negative to decrease count.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentAddAttempt(ctx context.Context, id, ownerID string, count int) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	if ownerID == "" {
		return errors.New("expects a owner ID string")
	} else if _, err := uuid.FromString(ownerID); err != nil {
		return errors.New("expects owner ID to be a valid identifier")
	}

	if count == 0 {
		return errors.New("expects an attempt count number != 0")
	}

	return TournamentAddAttempt(ctx, n.logger, n.db, n.leaderboardCache, id, ownerID, count)
}

// @summary A tournament may need to be joined before the owner can submit scores. This operation is idempotent and will always succeed for the owner even if they have already joined the tournament.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the tournament to join.
// @param ownerId(string) The owner of the record.
// @param username(string) The username of the record owner.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentJoin(ctx context.Context, id, ownerID, username string) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	if ownerID == "" {
		return errors.New("expects a owner ID string")
	} else if _, err := uuid.FromString(ownerID); err != nil {
		return errors.New("expects owner ID to be a valid identifier")
	}

	if username == "" {
		return errors.New("expects a username string")
	}

	return TournamentJoin(ctx, n.logger, n.db, n.leaderboardCache, ownerID, username, id)
}

// @summary Fetch one or more tournaments by ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param ids([]string) The table array of tournament ids.
// @return result([]*api.Tournament) Array of tournament records.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentsGetId(ctx context.Context, tournamentIDs []string) ([]*api.Tournament, error) {
	if len(tournamentIDs) == 0 {
		return []*api.Tournament{}, nil
	}

	return TournamentsGet(ctx, n.logger, n.db, tournamentIDs)
}

// @summary Find tournaments which have been created on the server. Tournaments can be filtered with categories and via start and end times.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param categoryStart(int) Filter tournament with categories greater or equal than this value.
// @param categoryEnd(int) Filter tournament with categories equal or less than this value.
// @param startTime(int) Filter tournament with that start after this time.
// @param endTime(int) Filter tournament with that end before this time.
// @param limit(int) Return only the required number of tournament denoted by this limit value. Defaults to 10.
// @param cursor(string) Cursor to paginate to the next result set. If this is empty/null there is no further results.
// @return tournamentList([]*api.TournamentList) A list of tournament results and possibly a cursor.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentList(ctx context.Context, categoryStart, categoryEnd, startTime, endTime, limit int, cursor string) (*api.TournamentList, error) {
	if categoryStart < 0 || categoryStart >= 128 {
		return nil, errors.New("categoryStart must be 0-127")
	}
	if categoryEnd < 0 || categoryEnd >= 128 {
		return nil, errors.New("categoryEnd must be 0-127")
	}
	if startTime < 0 {
		return nil, errors.New("startTime must be >= 0")
	}
	if endTime < 0 {
		return nil, errors.New("endTime must be >= 0")
	}
	if endTime < startTime {
		return nil, errors.New("endTime must be >= startTime")
	}

	if limit < 1 || limit > 100 {
		return nil, errors.New("limit must be 1-100")
	}

	var cursorPtr *TournamentListCursor
	if cursor != "" {
		cb, err := base64.StdEncoding.DecodeString(cursor)
		if err != nil {
			return nil, errors.New("expects cursor to be valid when provided")
		}
		cursorPtr = &TournamentListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursorPtr); err != nil {
			return nil, errors.New("expects cursor to be valid when provided")
		}
	}

	return TournamentList(ctx, n.logger, n.db, n.leaderboardCache, categoryStart, categoryEnd, startTime, endTime, limit, cursorPtr)
}

// @summary List records on the specified tournament, optionally filtering to only a subset of records by their owners. Records will be listed in the preconfigured tournament sort order.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param tournamentId(string) The ID of the tournament to list records for.
// @param ownerIds([]string) Array of owner IDs to filter results by. Optional.
// @param limit(int) Return only the required number of tournament records denoted by this limit value. Max is 10000.
// @param cursor(string) Cursor to paginate to the next result set. If this is empty/null there are no further results.
// @param overrideExpiry(int64) Records with expiry in the part are not returned unless within this defined limit. Must be equal or greater than 0.
// @return records(*api.LeaderboardRecord) A page of tournament records.
// @return ownerRecords(*api.LeaderboardRecord) A list of owner tournament records (empty if the owners input parameter is not set).
// @return prevCursor(string) An optional previous page cursor that can be used to retrieve the previous page of records (if any).
// @return nextCursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentRecordsList(ctx context.Context, tournamentId string, ownerIDs []string, limit int, cursor string, overrideExpiry int64) ([]*api.LeaderboardRecord, []*api.LeaderboardRecord, string, string, error) {
	if tournamentId == "" {
		return nil, nil, "", "", errors.New("expects a tournament ID strings")
	}
	for _, ownerID := range ownerIDs {
		if _, err := uuid.FromString(ownerID); err != nil {
			return nil, nil, "", "", errors.New("One or more ownerIDs are invalid.")
		}
	}
	var limitWrapper *wrapperspb.Int32Value
	if limit < 0 || limit > 10000 {
		return nil, nil, "", "", errors.New("expects limit to be 0-10000")
	} else if limit > 0 {
		limitWrapper = &wrapperspb.Int32Value{Value: int32(limit)}
	}

	if overrideExpiry < 0 {
		return nil, nil, "", "", errors.New("expects expiry to equal or greater than 0")
	}

	records, err := TournamentRecordsList(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, tournamentId, ownerIDs, limitWrapper, cursor, overrideExpiry)
	if err != nil {
		return nil, nil, "", "", err
	}

	return records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, nil
}

// @summary Submit a score and optional subscore to a tournament leaderboard. If the tournament has been configured with join required this will fail unless the owner has already joined the tournament.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The unique identifier for the tournament leaderboard to submit to.
// @param owner(string) The owner of this score submission. Mandatory field.
// @param username(string) The owner username of this score submission, if it's a user.
// @param score(int64) The score to submit. Default 0.
// @return subscore(int64) A secondary subscore parameter for the submission. Default 0.
// @return metadata(map[string]interface{}) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
// @return result(*api.LeaderboardRecord) The newly created leaderboard record.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}, overrideOperator *int) (*api.LeaderboardRecord, error) {
	if id == "" {
		return nil, errors.New("expects a tournament ID string")
	}

	owner, err := uuid.FromString(ownerID)
	if err != nil {
		return nil, errors.New("expects owner ID to be a valid identifier")
	}

	// Username is optional.

	metadataStr := "{}"
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return nil, fmt.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataStr = string(metadataBytes)
	}

	operator := api.Operator_NO_OVERRIDE
	if overrideOperator != nil {
		if _, ok := api.Operator_name[int32(*overrideOperator)]; !ok {
			return nil, ErrInvalidOperator
		}
		operator = api.Operator(*overrideOperator)
	}

	return TournamentRecordWrite(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, uuid.Nil, id, owner, username, score, subscore, metadataStr, operator)
}

// @summary Fetch the list of tournament records around the owner.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param id(string) The ID of the tournament to list records for.
// @param ownerId(string) The owner ID around which to show records.
// @param limit(int) Return only the required number of tournament records denoted by this limit value. Between 1-100.
// @param expiry(int64) Time since epoch in seconds. Must be greater than 0.
// @return tournamentRecordsHaystack(*api.Tournament) A list of tournament records.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentRecordsHaystack(ctx context.Context, id, ownerID string, limit int, expiry int64) ([]*api.LeaderboardRecord, error) {
	if id == "" {
		return nil, errors.New("expects a tournament ID string")
	}

	owner, err := uuid.FromString(ownerID)
	if err != nil {
		return nil, errors.New("expects owner ID to be a valid identifier")
	}

	if limit < 1 || limit > 100 {
		return nil, errors.New("limit must be 1-100")
	}

	if expiry < 0 {
		return nil, errors.New("expiry should be time since epoch in seconds and has to be a positive integer")
	}

	return TournamentRecordsHaystack(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, id, owner, limit, expiry)
}

// @summary Validates and stores the purchases present in an Apple App Store Receipt.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID of the owner of the receipt.
// @param receipt(string) Base-64 encoded receipt data returned by the purchase operation itself.
// @param passwordOverride(string) Optional. Override the iap.apple.shared_password provided in your configuration.
// @return validation(*api.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseValidateApple(ctx context.Context, userID, receipt string, passwordOverride ...string) (*api.ValidatePurchaseResponse, error) {
	if n.config.GetIAP().Apple.SharedPassword == "" && len(passwordOverride) == 0 {
		return nil, errors.New("Apple IAP is not configured.")
	}
	password := n.config.GetIAP().Apple.SharedPassword
	if len(passwordOverride) > 1 {
		return nil, errors.New("Expects a single password override parameter")
	} else if len(passwordOverride) == 1 {
		password = passwordOverride[0]
	}

	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("user ID must be a valid id string")
	}

	if len(receipt) < 1 {
		return nil, errors.New("receipt cannot be empty string")
	}

	validation, err := ValidatePurchasesApple(ctx, n.logger, n.db, uid, password, receipt)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @summary Validates and stores a purchase receipt from the Google Play Store.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID of the owner of the receipt.
// @param receipt(string) JSON encoded Google receipt.
// @return validation(*api.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseValidateGoogle(ctx context.Context, userID, receipt string) (*api.ValidatePurchaseResponse, error) {
	if n.config.GetIAP().Google.ClientEmail == "" || n.config.GetIAP().Google.PrivateKey == "" {
		return nil, errors.New("Google IAP is not configured.")
	}

	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("user ID must be a valid id string")
	}

	if len(receipt) < 1 {
		return nil, errors.New("receipt cannot be empty string")
	}

	validation, err := ValidatePurchaseGoogle(ctx, n.logger, n.db, uid, n.config.GetIAP().Google, receipt)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @summary Validates and stores a purchase receipt from the Huawei App Gallery.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The user ID of the owner of the receipt.
// @param receipt(string) The Huawei receipt data.
// @param signature(string) The receipt signature.
// @return validation(*api.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseValidateHuawei(ctx context.Context, userID, signature, inAppPurchaseData string) (*api.ValidatePurchaseResponse, error) {
	if n.config.GetIAP().Huawei.ClientID == "" ||
		n.config.GetIAP().Huawei.ClientSecret == "" ||
		n.config.GetIAP().Huawei.PublicKey == "" {
		return nil, errors.New("Huawei IAP is not configured.")
	}

	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("user ID must be a valid id string")
	}

	if len(signature) < 1 {
		return nil, errors.New("signature cannot be empty string")
	}

	if len(inAppPurchaseData) < 1 {
		return nil, errors.New("inAppPurchaseData cannot be empty string")
	}

	validation, err := ValidatePurchaseHuawei(ctx, n.logger, n.db, uid, n.config.GetIAP().Huawei, inAppPurchaseData, signature)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @summary List stored validated purchase receipts.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) Filter by user ID. Can be an empty string to list purchases for all users.
// @param limit(int) Limit number of records retrieved. Defaults to 100.
// @param cursor(string) Pagination cursor from previous result. If none available set to nil or "" (empty string).
// @return listPurchases(*api.PurchaseList) A page of stored validated purchases.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchasesList(ctx context.Context, userID string, limit int, cursor string) (*api.PurchaseList, error) {
	if userID != "" {
		if _, err := uuid.FromString(userID); err != nil {
			return nil, errors.New("expects a valid user ID")
		}
	}

	if limit <= 0 || limit > 100 {
		return nil, errors.New("limit must be a positive value <= 100")
	}

	return ListPurchases(ctx, n.logger, n.db, userID, limit, cursor)
}

// @summary Look up a purchase receipt by transaction ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param transactionId(string) Transaction ID of the purchase to look up.
// @return owner(string) The owner of the purchase.
// @return purchase(*api.ValidatedPurchase) A validated purchase.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseGetByTransactionId(ctx context.Context, transactionID string) (string, *api.ValidatedPurchase, error) {
	if transactionID == "" {
		return "", nil, errors.New("expects a transaction id string.")
	}

	return GetPurchaseByTransactionID(ctx, n.logger, n.db, transactionID)
}

// @summary Fetch one or more groups by their ID.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupIds([]string) An array of strings of the IDs for the groups to get.
// @return getGroups([]*api.Group) An array of groups with their fields.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupsGetId(ctx context.Context, groupIDs []string) ([]*api.Group, error) {
	if len(groupIDs) == 0 {
		return make([]*api.Group, 0), nil
	}

	for _, id := range groupIDs {
		if _, err := uuid.FromString(id); err != nil {
			return nil, errors.New("each group id must be a valid id string")
		}
	}

	return GetGroups(ctx, n.logger, n.db, groupIDs)
}

// @summary Setup a group with various configuration settings. The group will be created if they don't exist or fail if the group name is taken.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) Mandatory. The user ID to be associated as the group superadmin.
// @param name(string) Mandatory. Group name, must be unique.
// @param creatorId(string) The user ID to be associated as creator. If not set or nil/null, system user will be set.
// @param langTag(string) Group language. If not set will default to 'en'.
// @param description(string) Group description, can be left empty as nil/null.
// @param avatarUrl(string) URL to the group avatar, can be left empty as nil/null.
// @param open(bool) Whether the group is for anyone to join, or members will need to send invitations to join. Defaults to false.
// @param metadata(map[string]interface{}) Custom information to store for this group. Can be left empty as nil/null.
// @param maxCount(int) Maximum number of members to have in the group. Defaults to 100.
// @return createGroup(*api.Group) The groupId of the newly created group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupCreate(ctx context.Context, userID, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) (*api.Group, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("expects user ID to be a valid identifier")
	}

	if name == "" {
		return nil, errors.New("expects group name not be empty")
	}

	cid := uuid.Nil
	if creatorID != "" {
		cid, err = uuid.FromString(creatorID)
		if err != nil {
			return nil, errors.New("expects creator ID to be a valid identifier")
		}
	}

	metadataStr := ""
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return nil, fmt.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataStr = string(metadataBytes)
	}

	if maxCount < 1 {
		return nil, errors.New("expects max_count to be >= 1")
	}

	return CreateGroup(ctx, n.logger, n.db, uid, cid, name, langTag, description, avatarUrl, metadataStr, open, maxCount)
}

// @summary Update a group with various configuration settings. The group which is updated can change some or all of its fields.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group to update.
// @param userId(string) User ID calling the update operation for permission checking. Set as nil to enact the changes as the system user.
// @param name(string) Group name, can be empty if not changed.
// @param creatorId(string) The user ID to be associated as creator. Can be empty if not changed.
// @param langTag(string) Group language. Empty if not updated.
// @param description(string) Group description, can be left empty if not updated.
// @param avatarUrl(string) URL to the group avatar, can be left empty if not updated.
// @param open(bool) Whether the group is for anyone to join or not.
// @param metadata(map[string]interface{}) Custom information to store for this group. Use nil if field is not being updated.
// @param maxCount(int) Maximum number of members to have in the group. Use 0, nil/null if field is not being updated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUpdate(ctx context.Context, id, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) error {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	var nameWrapper *wrapperspb.StringValue
	if name != "" {
		nameWrapper = &wrapperspb.StringValue{Value: name}
	}

	creator := uuid.Nil
	if creatorID != "" {
		var err error
		creator, err = uuid.FromString(creatorID)
		if err != nil {
			return errors.New("expects creator ID to be a valid identifier")
		}
	}

	var langTagWrapper *wrapperspb.StringValue
	if langTag != "" {
		langTagWrapper = &wrapperspb.StringValue{Value: langTag}
	}

	var descriptionWrapper *wrapperspb.StringValue
	if description != "" {
		descriptionWrapper = &wrapperspb.StringValue{Value: description}
	}

	var avatarURLWrapper *wrapperspb.StringValue
	if avatarUrl != "" {
		avatarURLWrapper = &wrapperspb.StringValue{Value: avatarUrl}
	}

	openWrapper := &wrapperspb.BoolValue{Value: open}

	var metadataWrapper *wrapperspb.StringValue
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return fmt.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataWrapper = &wrapperspb.StringValue{Value: string(metadataBytes)}
	}

	maxCountValue := 0
	if maxCount > 0 && maxCount <= 100 {
		maxCountValue = maxCount
	}

	return UpdateGroup(ctx, n.logger, n.db, groupID, uuid.Nil, creator, nameWrapper, langTagWrapper, descriptionWrapper, avatarURLWrapper, metadataWrapper, openWrapper, maxCountValue)
}

// @summary Delete a group.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupDelete(ctx context.Context, id string) error {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	return DeleteGroup(ctx, n.logger, n.db, groupID, uuid.Nil)
}

// @summary Join a group for a particular user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group to join.
// @param userId(string) The user ID to add to this group.
// @param username(string) The username of the user to add to this group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUserJoin(ctx context.Context, groupID, userID, username string) error {
	group, err := uuid.FromString(groupID)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	user, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	if username == "" {
		return errors.New("expects a username string")
	}

	return JoinGroup(ctx, n.logger, n.db, n.router, group, user, username)
}

// @summary Leave a group for a particular user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group to leave.
// @param userId(string) The user ID to remove from this group.
// @param username(string) The username of the user to remove from this group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUserLeave(ctx context.Context, groupID, userID, username string) error {
	group, err := uuid.FromString(groupID)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	user, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	if username == "" {
		return errors.New("expects a username string")
	}

	return LeaveGroup(ctx, n.logger, n.db, n.router, group, user, username)
}

// @summary Add users to a group.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group to add users to.
// @param userIds([]string) Table array of user IDs to add to this group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersAdd(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be a valid identifier")
		}
	}

	group, err := uuid.FromString(groupID)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	if len(userIDs) == 0 {
		return nil
	}

	users := make([]uuid.UUID, 0, len(userIDs))
	for _, userID := range userIDs {
		uid, err := uuid.FromString(userID)
		if err != nil {
			return errors.New("expects each user ID to be a valid identifier")
		}
		if uid == uuid.Nil {
			return errors.New("cannot add the root user")
		}
		users = append(users, uid)
	}

	return AddGroupUsers(ctx, n.logger, n.db, n.router, caller, group, users)
}

// @summary Kick users from a group.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group to kick users from.
// @param userIds([]string) Table array of user IDs to kick.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersKick(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be a valid identifier")
		}
	}

	group, err := uuid.FromString(groupID)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	if len(userIDs) == 0 {
		return nil
	}

	users := make([]uuid.UUID, 0, len(userIDs))
	for _, userID := range userIDs {
		uid, err := uuid.FromString(userID)
		if err != nil {
			return errors.New("expects each user ID to be a valid identifier")
		}
		if uid == uuid.Nil {
			return errors.New("cannot kick the root user")
		}
		users = append(users, uid)
	}

	return KickGroupUsers(ctx, n.logger, n.db, n.router, caller, group, users)
}

// @summary Promote users in a group.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group whose members are being promoted.
// @param userIds([]string) Table array of user IDs to promote.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersPromote(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be a valid identifier")
		}
	}

	group, err := uuid.FromString(groupID)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	if len(userIDs) == 0 {
		return nil
	}

	users := make([]uuid.UUID, 0, len(userIDs))
	for _, userID := range userIDs {
		uid, err := uuid.FromString(userID)
		if err != nil {
			return errors.New("expects each user ID to be a valid identifier")
		}
		if uid == uuid.Nil {
			return errors.New("cannot promote the root user")
		}
		users = append(users, uid)
	}

	return PromoteGroupUsers(ctx, n.logger, n.db, n.router, caller, group, users)
}

// @summary Demote users in a group.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group whose members are being demoted.
// @param userIds([]string) Table array of user IDs to demote.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersDemote(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be a valid identifier")
		}
	}

	group, err := uuid.FromString(groupID)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	if len(userIDs) == 0 {
		return nil
	}

	users := make([]uuid.UUID, 0, len(userIDs))
	for _, userID := range userIDs {
		uid, err := uuid.FromString(userID)
		if err != nil {
			return errors.New("expects each user ID to be a valid identifier")
		}
		if uid == uuid.Nil {
			return errors.New("cannot demote the root user")
		}
		users = append(users, uid)
	}

	return DemoteGroupUsers(ctx, n.logger, n.db, n.router, caller, group, users)
}

// @summary List all members, admins and superadmins which belong to a group. This also list incoming join requests.	ctx
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param groupId(string) The ID of the group to list members for.
// @return groupUsers([]*api.GroupUserList_GroupUser) The user information for members, admins and superadmins for the group. Also users who sent a join request.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersList(ctx context.Context, id string, limit int, state *int, cursor string) ([]*api.GroupUserList_GroupUser, string, error) {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return nil, "", errors.New("expects group ID to be a valid identifier")
	}

	if limit < 1 || limit > 100 {
		return nil, "", errors.New("expects limit to be 1-100")
	}

	var stateWrapper *wrapperspb.Int32Value
	if state != nil {
		stateValue := *state
		if stateValue < 0 || stateValue > 4 {
			return nil, "", errors.New("expects state to be 0-4")
		}
		stateWrapper = &wrapperspb.Int32Value{Value: int32(stateValue)}
	}

	users, err := ListGroupUsers(ctx, n.logger, n.db, n.tracker, groupID, limit, stateWrapper, cursor)
	if err != nil {
		return nil, "", err
	}

	return users.GroupUsers, users.Cursor, nil
}

// @summary Find groups based on the entered criteria.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param name(string) Search for groups that contain this value in their name.
// @param langTag(string) Filter based upon the entered language tag.
// @param members(int) Search by number of group members.
// @param open(bool) Filter based on whether groups are Open or Closed.
// @param limit(int) Return only the required number of groups denoted by this limit value.
// @param cursor(string) Cursor to paginate to the next result set. If this is empty/null there is no further results.
// @return groups([]*api.Group) A list of groups.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupsList(ctx context.Context, name, langTag string, members *int, open *bool, limit int, cursor string) ([]*api.Group, string, error) {
	if name != "" && (langTag != "" || members != nil || open != nil) {
		return nil, "", errors.New("name filter cannot be combined with any other filter")
	}

	edgeCount := -1
	if members != nil {
		edgeCount = *members
	}

	if limit < 1 || limit > 100 {
		return nil, "", errors.New("expects limit to be 1-100")
	}

	groups, err := ListGroups(ctx, n.logger, n.db, name, langTag, open, edgeCount, limit, cursor)
	if err != nil {
		return nil, "", err
	}

	return groups.Groups, groups.Cursor, nil
}

// @summary List all groups which a user belongs to and whether they've been accepted or if it's an invite.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The ID of the user to list groups for.
// @return userGroups([]*api.UserGroupList_UserGroup) A table of groups with their fields.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UserGroupsList(ctx context.Context, userID string, limit int, state *int, cursor string) ([]*api.UserGroupList_UserGroup, string, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, "", errors.New("expects user ID to be a valid identifier")
	}

	if limit < 1 || limit > 100 {
		return nil, "", errors.New("expects limit to be 1-100")
	}

	var stateWrapper *wrapperspb.Int32Value
	if state != nil {
		stateValue := *state
		if stateValue < 0 || stateValue > 4 {
			return nil, "", errors.New("expects state to be 0-4")
		}
		stateWrapper = &wrapperspb.Int32Value{Value: int32(stateValue)}
	}

	groups, err := ListUserGroups(ctx, n.logger, n.db, uid, limit, stateWrapper, cursor)
	if err != nil {
		return nil, "", err
	}

	return groups.UserGroups, groups.Cursor, nil
}

// @summary Generate an event.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param evt(*api.Event) The event to be generated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) Event(ctx context.Context, evt *api.Event) error {
	if ctx == nil {
		return errors.New("expects a non-nil context")
	}
	if evt == nil {
		return errors.New("expects a non-nil event")
	}

	n.RLock()
	fn := n.eventFn
	n.RUnlock()
	if fn != nil {
		fn(ctx, evt)
	}

	return nil
}

// @summary Add a custom metrics counter.
// @param name(string) The name of the custom metrics counter.
// @param tags(map[string]string) The metrics tags associated with this counter.
// @param delta(int64) Value to update this metric with.
func (n *RuntimeGoNakamaModule) MetricsCounterAdd(name string, tags map[string]string, delta int64) {
	n.metrics.CustomCounter(name, tags, delta)
}

// @summary Add a custom metrics gauge.
// @param name(string) The name of the custom metrics gauge.
// @param tags(map[string]string) The metrics tags associated with this gauge.
// @param value(float64) Value to update this metric with.
func (n *RuntimeGoNakamaModule) MetricsGaugeSet(name string, tags map[string]string, value float64) {
	n.metrics.CustomGauge(name, tags, value)
}

// @summary Add a custom metrics timer.
// @param name(string) The name of the custom metrics timer.
// @param tags(map[string]string) The metrics tags associated with this timer.
// @param value(time.Duration) Value to update this metric with.
func (n *RuntimeGoNakamaModule) MetricsTimerRecord(name string, tags map[string]string, value time.Duration) {
	n.metrics.CustomTimer(name, tags, value)
}

// @summary List all friends, invites, invited, and blocked which belong to a user.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param userId(string) The ID of the user who's friends, invites, invited, and blocked you want to list.
// @param limit(int) The number of friends to retrieve in this page of results. No more than 100 limit allowed per result.
// @param state(int) The state of the friendship with the user. If unspecified this returns friends in all states for the user.
// @param cursor(string) The cursor returned from a previous listing request. Used to obtain the next page of results.
// @return friends([]*api.Friend) The user information for users that are friends of the current user.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) FriendsList(ctx context.Context, userID string, limit int, state *int, cursor string) ([]*api.Friend, string, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, "", errors.New("expects user ID to be a valid identifier")
	}

	if limit < 1 || limit > 100 {
		return nil, "", errors.New("expects limit to be 1-100")
	}

	var stateWrapper *wrapperspb.Int32Value
	if state != nil {
		stateValue := *state
		if stateValue < 0 || stateValue > 3 {
			return nil, "", errors.New("expects state to be 0-3")
		}
		stateWrapper = &wrapperspb.Int32Value{Value: int32(stateValue)}
	}

	friends, err := ListFriends(ctx, n.logger, n.db, n.tracker, uid, limit, stateWrapper, cursor)
	if err != nil {
		return nil, "", err
	}

	return friends.Friends, friends.Cursor, nil
}

func (n *RuntimeGoNakamaModule) SetEventFn(fn RuntimeEventCustomFunction) {
	n.Lock()
	n.eventFn = fn
	n.Unlock()
}

// @summary Register a function that processes events published to the server.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param channelId(string) The ID of the channel to send the message on.
// @param content(map[string]interface{}) Message content. Must be set.
// @param senderId(string) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(string) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(bool) Whether to record this message in the channel history. Defaults to true.
// @return channelMessageSend(*rtapi.ChannelMessageAck) Message sent ack.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ChannelMessageSend(ctx context.Context, channelId string, content map[string]interface{}, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	channelIdToStreamResult, err := ChannelIdToStream(channelId)
	if err != nil {
		return nil, err
	}

	contentStr := "{}"
	if content != nil {
		contentBytes, err := json.Marshal(content)
		if err != nil {
			return nil, fmt.Errorf("error encoding content: %v", err.Error())
		}
		contentStr = string(contentBytes)
	}

	return ChannelMessageSend(ctx, n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelId, contentStr, senderId, senderUsername, persist)
}

// @summary Update a message on a realtime chat channel.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param channelId(string) The ID of the channel to send the message on.
// @param messageId(string) The ID of the message to update.
// @param content(map[string]interface{}) Message content. Must be set.
// @param senderId(string) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(string) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(bool) Whether to record this message in the channel history. Defaults to true.
// @return channelMessageSend(*rtapi.ChannelMessageAck) Message updated ack.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ChannelMessageUpdate(ctx context.Context, channelId, messageId string, content map[string]interface{}, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	channelIdToStreamResult, err := ChannelIdToStream(channelId)
	if err != nil {
		return nil, err
	}

	contentStr := "{}"
	if content != nil {
		contentBytes, err := json.Marshal(content)
		if err != nil {
			return nil, fmt.Errorf("error encoding content: %v", err.Error())
		}
		contentStr = string(contentBytes)
	}

	return ChannelMessageUpdate(ctx, n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelId, messageId, contentStr, senderId, senderUsername, persist)
}

// @summary Create a channel identifier to be used in other runtime calls. Does not create a channel.
// @param ctx(context.Context) The context object represents information about the server and requester.
// @param target(string) Can be the room name, group identifier, or another username.
// @param chanType(runtime.ChannelType) The type of channel, for example group or direct.
// @return channelId(string) The generated ID representing a channel.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ChannelIdBuild(ctx context.Context, target string, chanType runtime.ChannelType) (string, error) {
	channelId, _, err := BuildChannelId(ctx, n.logger, n.db, uuid.Nil, target, rtapi.ChannelJoin_Type(chanType))
	if err != nil {
		return "", err
	}

	return channelId, nil
}
