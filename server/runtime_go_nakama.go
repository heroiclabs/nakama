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

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	"github.com/heroiclabs/nakama/v3/internal/satori"
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
	statusRegistry       StatusRegistry
	matchRegistry        MatchRegistry
	tracker              Tracker
	metrics              Metrics
	streamManager        StreamManager
	router               MessageRouter
	eventFn              RuntimeEventCustomFunction
	node                 string
	matchCreateFn        RuntimeMatchCreateFunction
	satori               runtime.Satori
	fleetManager         runtime.FleetManager
	storageIndex         StorageIndex
}

func NewRuntimeGoNakamaModule(logger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, storageIndex StorageIndex) *RuntimeGoNakamaModule {
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
		statusRegistry:       statusRegistry,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		metrics:              metrics,
		streamManager:        streamManager,
		router:               router,
		storageIndex:         storageIndex,

		node: config.GetName(),

		satori: satori.NewSatoriClient(logger, config.GetSatori().Url, config.GetSatori().ApiKeyName, config.GetSatori().ApiKey, config.GetSatori().SigningKey),
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using an Apple sign in token.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param token(type=string) Apple sign in token.
// @param username(type=string) The user's username. If left empty, one is generated.
// @param create(type=bool) Create user if one didn't exist previously.
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

// @group authenticate
// @summary Authenticate user and create a session token using a custom authentication managed by an external service or source not already supported by Nakama.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) Custom ID to use to authenticate the user. Must be between 6-128 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool) Create user if one didn't exist previously.
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

// @group authenticate
// @summary Authenticate user and create a session token using a device identifier.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) Device ID to use to authenticate the user. Must be between 1-128 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
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

// @group authenticate
// @summary Authenticate user and create a session token using an email address and password.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param email(type=string) Email address to use to authenticate the user. Must be between 10-255 characters.
// @param password(type=string) Password to set. Must be longer than 8 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
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

// @group authenticate
// @summary Authenticate user and create a session token using a Facebook account token.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param token(type=string) Facebook OAuth or Limited Login (JWT) access token.
// @param import(type=bool) Whether to automatically import Facebook friends after authentication.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool) Create user if one didn't exist previously.
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

	dbUserID, dbUsername, created, err := AuthenticateFacebook(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, token, username, create)
	if err == nil && importFriends {
		// Errors are logged before this point and failure here does not invalidate the whole operation.
		_ = importFacebookFriends(ctx, n.logger, n.db, n.tracker, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
	}

	return dbUserID, dbUsername, created, err
}

// @group authenticate
// @summary Authenticate user and create a session token using a Facebook Instant Game.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param playerInfo(type=string) Facebook Player info.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool) Create user if one didn't exist previously.
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

// @group authenticate
// @summary Authenticate user and create a session token using Apple Game Center credentials.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param playerId(type=string) PlayerId provided by GameCenter.
// @param bundleId(type=string) BundleId of your app on iTunesConnect.
// @param timestamp(type=int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(type=string) A random string returned by Game Center authentication on client.
// @param signature(type=string) A signature returned by Game Center authentication on client.
// @param publicKeyUrl(type=string) A URL to the public key returned by Game Center authentication on client.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool) Create user if one didn't exist previously.
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

// @group authenticate
// @summary Authenticate user and create a session token using a Google ID token.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param token(type=string) Google OAuth access token.
// @param username(type=string) The user's username. If left empty, one is generated.
// @param create(type=bool) Create user if one didn't exist previously.
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

// @group authenticate
// @summary Authenticate user and create a session token using a Steam account token.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param token(type=string) Steam token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
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

// @group authenticate
// @summary Generate a Nakama session token from a user ID.
// @param userId(type=string) User ID to use to generate the token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param expiresAt(type=int64, optional=true) UTC time in seconds when the token must expire. Defaults to server configured expiry time.
// @param vars(type=map[string]string, optional=true) Extra information that will be bundled in the session token.
// @return token(string) The Nakama session token.
// @return validity(int64) The period for which the token remains valid.
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
		username = generateUsername()
	}

	if exp == 0 {
		// If expiry is 0 or not set, use standard configured expiry.
		exp = time.Now().UTC().Add(time.Duration(n.config.GetSession().TokenExpirySec) * time.Second).Unix()
	}

	tokenId := uuid.Must(uuid.NewV4()).String()
	token, exp := generateTokenWithExpiry(n.config.GetSession().EncryptionKey, tokenId, userID, username, vars, exp)
	n.sessionCache.Add(uid, exp, tokenId, 0, "")
	return token, exp, nil
}

// @group accounts
// @summary Fetch account information by user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) User ID to fetch information for. Must be valid UUID.
// @return account(*api.Account) All account information including wallet, device IDs and more.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AccountGetId(ctx context.Context, userID string) (*api.Account, error) {
	u, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("invalid user id")
	}

	account, err := GetAccount(ctx, n.logger, n.db, n.statusRegistry, u)
	if err != nil {
		return nil, err
	}

	return account, nil
}

// @group accounts
// @summary Fetch information for multiple accounts by user IDs.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userIds(type=[]string) Array of user IDs to fetch information for. Must be valid UUID.
// @return account([]*api.Account) An array of accounts.
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

	return GetAccounts(ctx, n.logger, n.db, n.statusRegistry, userIDs)
}

// @group accounts
// @summary Update an account by user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) User ID for which the information is to be updated. Must be valid UUID.
// @param metadata(type=map[string]interface{}) The metadata to update for this account.
// @param username(type=string) Username to be set. Must be unique. Use "" if it is not being updated.
// @param displayName(type=string) Display name to be updated. Use "" if it is not being updated.
// @param timezone(type=string) Timezone to be updated. Use "" if it is not being updated.
// @param location(type=string) Location to be updated. Use "" if it is not being updated.
// @param language(type=string) Lang tag to be updated. Use "" if it is not being updated.
// @param avatarUrl(type=string) User's avatar URL. Use "" if it is not being updated.
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

// @group accounts
// @summary Delete an account by user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) User ID for the account to be deleted. Must be valid UUID.
// @param recorded(type=bool, default=false) Whether to record this deletion in the database.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) AccountDeleteId(ctx context.Context, userID string, recorded bool) error {
	u, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	return DeleteAccount(ctx, n.logger, n.db, n.config, n.leaderboardCache, n.leaderboardRankCache, n.sessionRegistry, n.sessionCache, n.tracker, u, recorded)
}

// @group accounts
// @summary Export account information for a specified user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) User ID for the account to be exported. Must be valid UUID.
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

// @group users
// @summary Fetch one or more users by ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userIds(type=[]string) An array of user IDs to fetch.
// @return users([]*api.User) A list of user record objects.
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

	users, err := GetUsers(ctx, n.logger, n.db, n.statusRegistry, userIDs, nil, facebookIDs)
	if err != nil {
		return nil, err
	}

	return users.Users, nil
}

// @group users
// @summary Fetch one or more users by username.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param usernames(type=[]string) An array of usernames to fetch.
// @return users([]*api.User) A list of user record objects.
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

	users, err := GetUsers(ctx, n.logger, n.db, n.statusRegistry, nil, usernames, nil)
	if err != nil {
		return nil, err
	}

	return users.Users, nil
}

// @group users
// @summary Fetch one or more users randomly.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param count(type=int) The number of users to fetch.
// @return users([]*api.User) A list of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UsersGetRandom(ctx context.Context, count int) ([]*api.User, error) {
	if count == 0 {
		return make([]*api.User, 0), nil
	}

	if count < 0 || count > 1000 {
		return nil, errors.New("count must be 0-1000")
	}

	return GetRandomUsers(ctx, n.logger, n.db, n.statusRegistry, count)
}

// @group users
// @summary Ban one or more users by ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userIds(type=[]string) An array of user IDs to ban.
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

	return BanUsers(ctx, n.logger, n.db, n.config, n.sessionCache, n.sessionRegistry, n.tracker, ids)
}

// @group users
// @summary Unban one or more users by ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userIds(type=[]string) An array of user IDs to unban.
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

// @group authenticate
// @summary Link Apple authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param token(type=string) Apple sign in token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkApple(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkApple(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

// @group authenticate
// @summary Link custom authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param customId(type=string) Custom ID to be linked to the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkCustom(ctx context.Context, userID, customID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkCustom(ctx, n.logger, n.db, id, customID)
}

// @group authenticate
// @summary Link device authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param deviceId(type=string) Device ID to be linked to the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkDevice(ctx context.Context, userID, deviceID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkDevice(ctx, n.logger, n.db, id, deviceID)
}

// @group authenticate
// @summary Link email authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param email(type=string) Authentication email to be linked to the user.
// @param password(type=string) Password to set. Must be longer than 8 characters.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkEmail(ctx context.Context, userID, email, password string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkEmail(ctx, n.logger, n.db, id, email, password)
}

// @group authenticate
// @summary Link Facebook authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param username(type=string, optional=true) If left empty, one is generated.
// @param token(type=string) Facebook OAuth or Limited Login (JWT) access token.
// @param importFriends(type=bool) Whether to automatically import Facebook friends after authentication.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkFacebook(ctx context.Context, userID, username, token string, importFriends bool) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkFacebook(ctx, n.logger, n.db, n.socialClient, n.tracker, n.router, id, username, n.config.GetSocial().FacebookLimitedLogin.AppId, token, importFriends)
}

// @group authenticate
// @summary Link Facebook Instant Game authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param signedPlayerInfo(type=string) Facebook player info.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkFacebookInstantGame(ctx context.Context, userID, signedPlayerInfo string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkFacebookInstantGame(ctx, n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo)
}

// @group authenticate
// @summary Link Apple Game Center authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param playerId(type=string) Player ID provided by Game Center.
// @param bundleId(type=string) Bundle ID of your app on iTunesConnect.
// @param timestamp(type=int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(type=string) A random string returned by Game Center authentication on client.
// @param signature(type=string) A signature returned by Game Center authentication on client.
// @param publicKeyUrl(type=string) A URL to the public key returned by Game Center authentication on client.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkGameCenter(ctx context.Context, userID, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkGameCenter(ctx, n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyUrl)
}

// @group authenticate
// @summary Link Google authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param token(type=string) Google OAuth access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkGoogle(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkGoogle(ctx, n.logger, n.db, n.socialClient, id, token)
}

// @group authenticate
// @summary Link Steam authentication to a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be linked.
// @param username(type=string, optional=true) If left empty, one is generated.
// @param token(type=string) Steam access token.
// @param importFriends(type=bool) Whether to automatically import Steam friends after authentication.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LinkSteam(ctx context.Context, userID, username, token string, importFriends bool) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkSteam(ctx, n.logger, n.db, n.config, n.socialClient, n.tracker, n.router, id, username, token, importFriends)
}

// @group utils
// @summary Parses a CRON expression and a timestamp in UTC seconds, and returns the next matching timestamp in UTC seconds.
// @param expression(type=string) A valid CRON expression in standard format, for example "0 0 * * *" (meaning at midnight).
// @param timestamp(type=int64) A time value expressed as UTC seconds.
// @return nextTs(int64) The next UTC seconds timestamp (number) that matches the given CRON expression, and is immediately after the given timestamp.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) CronNext(expression string, timestamp int64) (int64, error) {
	expr, err := cronexpr.Parse(expression)
	if err != nil {
		return 0, errors.New("expects a valid cron string")
	}

	t := time.Unix(timestamp, 0).UTC()
	next := expr.Next(t)
	nextTs := next.UTC().Unix()

	return nextTs, nil
}

// @group utils
// @summary Parses a CRON expression and a timestamp in UTC seconds, and returns the previous matching timestamp in UTC seconds.
// @param expression(type=string) A valid CRON expression in standard format, for example "0 0 * * *" (meaning at midnight).
// @param timestamp(type=int64) A time value expressed as UTC seconds.
// @return prevTs(int64) The previous UTC seconds timestamp (number) that matches the given CRON expression, and is immediately before the given timestamp.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) CronPrev(expression string, timestamp int64) (int64, error) {
	expr, err := cronexpr.Parse(expression)
	if err != nil {
		return 0, errors.New("expects a valid cron string")
	}

	t := time.Unix(timestamp, 0).UTC()
	next := expr.Last(t)
	nextTs := next.UTC().Unix()

	return nextTs, nil
}

// @group utils
// @summary Read file from user device.
// @param relPath(type=string) Relative path to the file to be read.
// @return fileRead(*os.File) The read file.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ReadFile(relPath string) (*os.File, error) {
	return FileRead(n.config.GetRuntime().Path, relPath)
}

// @group authenticate
// @summary Unlink Apple authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param token(type=string) Apple sign in token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkApple(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkApple(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

// @group authenticate
// @summary Unlink custom authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param customId(type=string) Custom ID to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkCustom(ctx context.Context, userID, customID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkCustom(ctx, n.logger, n.db, id, customID)
}

// @group authenticate
// @summary Unlink device authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param deviceId(type=string) Device ID to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkDevice(ctx context.Context, userID, deviceID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkDevice(ctx, n.logger, n.db, id, deviceID)
}

// @group authenticate
// @summary Unlink email authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param email(type=string) Email to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkEmail(ctx context.Context, userID, email string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkEmail(ctx, n.logger, n.db, id, email)
}

// @group authenticate
// @summary Unlink Facebook authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param token(type=string) Facebook OAuth or Limited Login (JWT) access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkFacebook(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkFacebook(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, id, token)
}

// @group authenticate
// @summary Unlink Facebook Instant Game authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param playerInfo(type=string) Facebook player info.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkFacebookInstantGame(ctx context.Context, userID, signedPlayerInfo string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkFacebookInstantGame(ctx, n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo)
}

// @group authenticate
// @summary Unlink Apple Game Center authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param playerId(type=string) Player ID provided by Game Center.
// @param bundleId(type=string) Bundle ID of your app on iTunesConnect.
// @param timestamp(type=int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(type=string) A random string returned by Game Center authentication on client.
// @param signature(type=string) A signature returned by Game Center authentication on client.
// @param publicKeyUrl(type=string) A URL to the public key returned by Game Center authentication on client.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkGameCenter(ctx context.Context, userID, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkGameCenter(ctx, n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyUrl)
}

// @group authenticate
// @summary Unlink Google authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param token(type=string) Google OAuth access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkGoogle(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkGoogle(ctx, n.logger, n.db, n.socialClient, id, token)
}

// @group authenticate
// @summary Unlink Steam authentication from a user ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be unlinked.
// @param token(type=string) Steam access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) UnlinkSteam(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkSteam(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

// @group streams
// @summary List all users currently online and connected to a stream.
// @param mode(type=uint8) The type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
// @param includeHidden(type=bool, optional=true) Include stream presences marked as hidden in the results.
// @param includeNotHidden(type=bool, optional=true) Include stream presences not marked as hidden in the results.
// @return presences([]runtime.Presence) Array of stream presences and their information.
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

// @group streams
// @summary Retrieve a stream presence and metadata by user ID.
// @param mode(type=uint8) The type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
// @param userId(type=string) The user ID to fetch information for.
// @param sessionId(type=string) The current session ID for the user.
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

// @group streams
// @summary Add a user to a stream.
// @param mode(type=uint8) The type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
// @param userId(type=string) The user ID to be added.
// @param sessionId(type=string) The current session ID for the user.
// @param hidden(type=bool) Whether the user will be marked as hidden.
// @param persistence(type=bool) Whether message data should be stored in the database.
// @param status(type=string) User status message.
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

// @group streams
// @summary Update a stream user by ID.
// @param mode(type=uint8) The type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
// @param userId(type=string) The user ID to be updated.
// @param sessionId(type=string) The current session ID for the user.
// @param hidden(type=bool) Whether the user will be marked as hidden.
// @param persistence(type=bool) Whether message data should be stored in the database.
// @param status(type=string) User status message.
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

// @group streams
// @summary Remove a user from a stream.
// @param mode(type=uint8) The Type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
// @param userId(type=string) The user ID to be removed.
// @param sessionId(type=string) The current session ID for the user.
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

// @group streams
// @summary Kick a user from a stream.
// @param mode(type=uint8) The Type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
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

// @group streams
// @summary Get a count of stream presences.
// @param mode(type=uint8) The Type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
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

// @group streams
// @summary Close a stream and remove all presences on it.
// @param mode(type=uint8) The Type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
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

// @group streams
// @summary Send data to presences on a stream.
// @param mode(type=uint8) The Type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
// @param data(type=string) The data to send.
// @param presences(type=[]runtime.Presence, optional=true, default=all) Array of presences to receive the sent data.
// @param reliable(type=bool) Whether the sender has been validated prior.
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

// @group streams
// @summary Send a message to presences on a stream.
// @param mode(type=uint8) The Type of stream, '2' for a chat channel for example.
// @param subject(type=string) The primary stream subject, typically a user ID.
// @param subcontext(type=string) A secondary subject, for example for direct chat between two users.
// @param label(type=string) Meta-information about the stream, for example a chat room name.
// @param msg(type=*rtapi.Envelope) The message to send.
// @param presences(type=[]runtime.Presence, optional=true, default=all) Array of presences to receive the sent data.
// @param reliable(type=bool) Whether the sender has been validated prior.
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

// @group sessions
// @summary Disconnect a session.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param sessionId(type=string) The ID of the session to be disconnected.
// @param reason(type=runtime.PresenceReason, optional=true) The reason for the session disconnect.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) SessionDisconnect(ctx context.Context, sessionID string, reason ...runtime.PresenceReason) error {
	sid, err := uuid.FromString(sessionID)
	if err != nil {
		return errors.New("expects valid session id")
	}

	return n.sessionRegistry.Disconnect(ctx, sid, false, reason...)
}

// @group sessions
// @summary Log out a user from their current session.
// @param userId(type=string) The ID of the user to be logged out.
// @param token(type=string, optional=true) The current session authentication token. If the current auth and refresh tokens are not provided, all user sessions will be logged out.
// @param refreshToken(type=string, optional=true) The current session refresh token. If the current auth and refresh tokens are not provided, all user sessions will be logged out.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) SessionLogout(userID, token, refreshToken string) error {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects valid user id")
	}

	return SessionLogout(n.config, n.sessionCache, uid, token, refreshToken)
}

// @group matches
// @summary Create a new authoritative realtime multiplayer match running on the given runtime module name. The given params are passed to the match's init hook.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param module(type=string) The name of an available runtime module that will be responsible for the match. This was registered in InitModule.
// @param params(type=map[string]interface{}) Any value to pass to the match init hook.
// @return matchId(string) The match ID of the newly created match. Clients can immediately use this ID to join the match.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MatchCreate(ctx context.Context, module string, params map[string]interface{}) (string, error) {
	if module == "" {
		return "", errors.New("expects module name")
	}

	n.RLock()
	fn := n.matchCreateFn
	n.RUnlock()

	return n.matchRegistry.CreateMatch(ctx, fn, module, params)
}

// @group matches
// @summary Get information on a running match.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The ID of the match to fetch.
// @return match(*api.Match) Information for the running match.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MatchGet(ctx context.Context, id string) (*api.Match, error) {
	match, _, err := n.matchRegistry.GetMatch(ctx, id)
	return match, err
}

// @group matches
// @summary List currently running realtime multiplayer matches and optionally filter them by authoritative mode, label, and current participant count.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param limit(type=int, optional=true, default=100) The maximum number of matches to list.
// @param authoritative(type=bool, optional=true, default=false) Set true to only return authoritative matches, false to only return relayed matches.
// @param label(type=string, default="") A label to filter authoritative matches by. Default "" means any label matches.
// @param minSize(type=int) Inclusive lower limit of current match participants.
// @param maxSize(type=int) Inclusive upper limit of current match participants.
// @param query(type=string) Additional query parameters to shortlist matches.
// @return match([]*api.Match) A list of matches matching the parameters criteria.
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
	matches, _, err := n.matchRegistry.ListMatches(ctx, limit, authoritativeWrapper, labelWrapper, minSizeWrapper, maxSizeWrapper, queryWrapper, nil)
	return matches, err
}

// @group matches
// @summary Allow the match handler to be sent a reservation signal to mark a user ID or session ID into the match state ahead of their join attempt and eventual join flow. Called when the match handler receives a runtime signal.
// @param ctx(type=context.Context) Context object represents information about the match and server for information purposes.
// @param id(type=string) The user ID or session ID to send a reservation signal for.
// @param data(type=string) An arbitrary input supplied by the runtime caller of the signal.
// @return state(interface{}) An (optionally) updated state. May be any non-nil value, or nil to end the match.
// @return data(string) Arbitrary data to return to the runtime caller of the signal. May be a string or nil.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MatchSignal(ctx context.Context, id string, data string) (string, error) {
	return n.matchRegistry.Signal(ctx, id, data)
}

// @group notifications
// @summary Send one in-app notification to a user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID of the user to be sent the notification.
// @param subject(type=string) Notification subject.
// @param content(type=map[string]interface{}) Notification content. Must be set but can be an struct.
// @param code(type=int) Notification code to use. Must be equal or greater than 0.
// @param sender(type=string, optional=true) The sender of this notification. If left empty, it will be assumed that it is a system notification.
// @param persistent(type=bool, default=false) Whether to record this in the database for later listing.
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

	return NotificationSend(ctx, n.logger, n.db, n.tracker, n.router, notifications)
}

// @group notifications
// @summary Send one or more in-app notifications to a user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param notifications(type=[]*runtime.NotificationSend) A list of notifications to be sent together.
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

	return NotificationSend(ctx, n.logger, n.db, n.tracker, n.router, ns)
}

// @group notifications
// @summary Send an in-app notification to all users.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param subject(type=string) Notification subject.
// @param content(type=map[string]interface{}) Notification content. Must be set but can be any empty map.
// @param code(type=int) Notification code to use. Must be greater than or equal to 0.
// @param persistent(type=bool) Whether to record this in the database for later listing.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) NotificationSendAll(ctx context.Context, subject string, content map[string]interface{}, code int, persistent bool) error {
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
	createTime := &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()}

	not := &api.Notification{
		Id:         uuid.Must(uuid.NewV4()).String(),
		Subject:    subject,
		Content:    contentString,
		Code:       int32(code),
		SenderId:   senderID,
		Persistent: persistent,
		CreateTime: createTime,
	}

	return NotificationSendAll(ctx, n.logger, n.db, n.tracker, n.router, not)
}

// @group notifications
// @summary Delete one or more in-app notifications.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param notifications(type=[]*runtime.NotificationDelete) A list of notifications to be deleted.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) NotificationsDelete(ctx context.Context, notifications []*runtime.NotificationDelete) error {
	ns := make(map[uuid.UUID][]string)

	for _, notification := range notifications {
		uid, err := uuid.FromString(notification.UserID)
		if err != nil {
			return errors.New("expects userID to be a valid UUID")
		}

		_, err = uuid.FromString(notification.NotificationID)
		if err != nil {
			return errors.New("expects notificationID to be a valid UUID")
		}

		no := ns[uid]
		if no == nil {
			no = make([]string, 0, 1)
		}
		no = append(no, notification.NotificationID)
		ns[uid] = no
	}

	for uid, notificationIDs := range ns {
		err := NotificationDelete(ctx, n.logger, n.db, uid, notificationIDs)
		if err != nil {
			return err
		}
	}
	return nil
}

// @group notifications
// @summary Get notifications by their id.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userID(type=string) Optional userID to scope results to that user only.
// @param ids(type=[]string) A list of notification ids.
// @return notifications([]*api.Notification) A list of notifications.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) NotificationsGetId(ctx context.Context, userID string, ids []string) ([]*runtime.Notification, error) {
	return NotificationsGetId(ctx, n.logger, n.db, userID, ids...)
}

// @group notifications
// @summary Delete notifications by their id.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userID(type=string) Optional userID to scope deletions to that user only. Use empty string to ignore.
// @param ids(type=[]string) A list of notification ids.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) NotificationsDeleteId(ctx context.Context, userID string, ids []string) error {
	return NotificationsDeleteId(ctx, n.logger, n.db, userID, ids...)
}

// @group wallets
// @summary Update a user's wallet with the given changeset.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The ID of the user whose wallet to update.
// @param changeset(type=map[string]int64) The set of wallet operations to apply.
// @param metadata(type=map[string]interface{}) Additional metadata to tag the wallet update with.
// @param updateLedger(type=bool, default=false) Whether to record this update in the ledger.
// @return updatedValue(map) The updated wallet value.
// @return previousValue(map) The previous wallet value.
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

// @group wallets
// @summary Update one or more user wallets with individual changesets. This function will also insert a new wallet ledger item into each user's wallet history that tracks their update.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param updates(type=[]*runtime.WalletUpdate) The set of user wallet update operations to apply.
// @param updateLedger(type=bool, default=false) Whether to record this update in the ledger.
// @return updateWallets([]runtime.WalletUpdateResult) A list of wallet update results.
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

// @group wallets
// @summary Update the metadata for a particular wallet update in a user's wallet ledger history. Useful when adding a note to a transaction for example.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param itemId(type=string) The ID of the wallet ledger item to update.
// @param metadata(type=map[string]interface{}) The new metadata to set on the wallet ledger item.
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

// @group wallets
// @summary List all wallet updates for a particular user from oldest to newest.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The ID of the user to list wallet updates for.
// @param limit(type=int, optional=true, default=100) Limit number of results.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
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

// @group storage
// @summary List records in a collection and page through results. The records returned can be filtered to those owned by the user or "" for public records.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param callerId(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permissions are bypassed.
// @param userId(type=string) User ID to list records for or "" (empty string) for public records.
// @param collection(type=string) Collection to list data from.
// @param limit(type=int, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return objects([]*api.StorageObject) A list of storage objects.
// @return cursor(string) Pagination cursor. Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StorageList(ctx context.Context, callerID, userID, collection string, limit int, cursor string) ([]*api.StorageObject, string, error) {
	cid := uuid.Nil
	if callerID != "" {
		u, err := uuid.FromString(callerID)
		if err != nil {
			return nil, "", errors.New("expects an empty or valid caller id")
		}
		cid = u
	}

	var uid *uuid.UUID
	if userID != "" {
		u, err := uuid.FromString(userID)
		if err != nil {
			return nil, "", errors.New("expects an empty or valid user id")
		}
		uid = &u
	}

	if limit < 0 {
		return nil, "", errors.New("limit must not be negative")
	}

	objectList, _, err := StorageListObjects(ctx, n.logger, n.db, cid, uid, collection, limit, cursor)
	if err != nil {
		return nil, "", err
	}

	return objectList.Objects, objectList.Cursor, nil
}

// @group storage
// @summary Fetch one or more records by their bucket/collection/keyname and optional user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param objectIds(type=[]*runtime.StorageRead) An array of object identifiers to be fetched.
// @return objects([]*api.StorageObject) A list of storage objects matching the parameters criteria.
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

// @group storage
// @summary Write one or more objects by their collection/keyname and optional user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param objectIds(type=[]*runtime.StorageWrite) An array of object identifiers to be written.
// @return acks([]*api.StorageObjectAck) A list of acks with the version of the written objects.
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

	acks, _, err := StorageWriteObjects(ctx, n.logger, n.db, n.metrics, n.storageIndex, true, ops)
	if err != nil {
		return nil, err
	}

	return acks.Acks, nil
}

// @group storage
// @summary Remove one or more objects by their collection/keyname and optional user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param objectIds(type=[]*runtime.StorageDelete) An array of object identifiers to be deleted.
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

	_, err := StorageDeleteObjects(ctx, n.logger, n.db, n.storageIndex, true, ops)

	return err
}

// @group storage
// @summary List storage index entries
// @param indexName(type=string) Name of the index to list entries from.
// @param callerId(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty, defaults to system user and permissions are bypassed.
// @param queryString(type=string) Query to filter index entries.
// @param limit(type=int) Maximum number of results to be returned.
// @param order(type=[]string, optional=true) The storage object fields to sort the query results by. The prefix '-' before a field name indicates descending order. All specified fields must be indexed and sortable.
// @return objects(*api.StorageObjectList) A list of storage objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) StorageIndexList(ctx context.Context, callerID, indexName, query string, limit int, order []string) (*api.StorageObjects, error) {
	cid := uuid.Nil
	if callerID != "" {
		id, err := uuid.FromString(callerID)
		if err != nil {
			return nil, errors.New("expects caller id to be empty or a valid user id")
		}
		cid = id
	}

	if indexName == "" {
		return nil, errors.New("expects a non-empty indexName")
	}

	if limit < 1 || limit > 10_000 {
		return nil, errors.New("limit must be 1-10000")
	}

	return n.storageIndex.List(ctx, cid, indexName, query, limit, order)
}

// @group users
// @summary Update account, storage, and wallet information simultaneously.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param accountUpdates(type=[]*runtime.AccountUpdate) Array of account information to be updated.
// @param storageWrites(type=[]*runtime.StorageWrite) Array of storage objects to be updated.
// @param storageDeletes(type=[]*runtime.StorageDelete) Array of storage objects to be deleted.
// @param walletUpdates(type=[]*runtime.WalletUpdate) Array of wallet updates to be made.
// @param updateLedger(type=bool, optional=true, default=false) Whether to record this wallet update in the ledger.
// @return storageWriteOps([]*api.StorageObjectAck) A list of acks with the version of the written objects.
// @return walletUpdateOps([]*runtime.WalletUpdateResult) A list of wallet updates results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) MultiUpdate(ctx context.Context, accountUpdates []*runtime.AccountUpdate, storageWrites []*runtime.StorageWrite, storageDeletes []*runtime.StorageDelete, walletUpdates []*runtime.WalletUpdate, updateLedger bool) ([]*api.StorageObjectAck, []*runtime.WalletUpdateResult, error) {
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

	// Process storage delete inputs.
	storageDeleteOps := make(StorageOpDeletes, 0, len(storageDeletes))
	for _, del := range storageDeletes {
		if del.Collection == "" {
			return nil, nil, errors.New("expects collection to be a non-empty string")
		}
		if del.Key == "" {
			return nil, nil, errors.New("expects key to be a non-empty string")
		}
		if del.UserID != "" {
			if _, err := uuid.FromString(del.UserID); err != nil {
				return nil, nil, errors.New("expects an empty or valid user id")
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

		storageDeleteOps = append(storageDeleteOps, op)
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

	return MultiUpdate(ctx, n.logger, n.db, n.metrics, accountUpdateOps, storageWriteOps, storageDeleteOps, n.storageIndex, walletUpdateOps, updateLedger)
}

// @group leaderboards
// @summary Setup a new dynamic leaderboard with the specified ID and various configuration settings. The leaderboard will be created if it doesn't already exist, otherwise its configuration will not be updated.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param leaderboardID(type=string) The unique identifier for the new leaderboard. This is used by clients to submit scores.
// @param authoritative(type=bool, default=false) Mark the leaderboard as authoritative which ensures updates can only be made via the Go runtime. No client can submit a score directly.
// @param sortOrder(type=string, default="desc") The sort order for records in the leaderboard. Possible values are "asc" or "desc".
// @param operator(type=string, default="best") The operator that determines how scores behave when submitted. Possible values are "best", "set", or "incr".
// @param resetSchedule(type=string) The cron format used to define the reset schedule for the leaderboard. This controls when a leaderboard is reset and can be used to power daily/weekly/monthly leaderboards.
// @param metadata(type=map[string]interface{}) The metadata you want associated to the leaderboard. Some good examples are weather conditions for a racing game.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardCreate(ctx context.Context, id string, authoritative bool, sortOrder, operator, resetSchedule string, metadata map[string]interface{}, enableRanks bool) error {
	if id == "" {
		return errors.New("expects a leaderboard ID string")
	}

	sort := LeaderboardSortOrderDescending //nolint:ineffassign
	switch sortOrder {
	case "desc", "descending":
		sort = LeaderboardSortOrderDescending
	case "asc", "ascending":
		sort = LeaderboardSortOrderAscending
	default:
		return errors.New("expects sort order to be 'asc' or 'desc'")
	}

	oper := LeaderboardOperatorBest //nolint:ineffassign
	switch operator {
	case "best":
		oper = LeaderboardOperatorBest
	case "set":
		oper = LeaderboardOperatorSet
	case "incr", "increment":
		oper = LeaderboardOperatorIncrement
	case "decr", "decrement":
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

	_, created, err := n.leaderboardCache.Create(ctx, id, authoritative, sort, oper, resetSchedule, metadataStr, enableRanks)
	if err != nil {
		return err
	}

	if created {
		// Only need to update the scheduler for newly created leaderboards.
		n.leaderboardScheduler.Update()
	}

	return nil
}

// @group leaderboards
// @summary Delete a leaderboard and all scores that belong to it.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the leaderboard to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardDelete(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("expects a leaderboard ID string")
	}

	_, err := n.leaderboardCache.Delete(ctx, n.leaderboardRankCache, n.leaderboardScheduler, id)
	if err != nil {
		return err
	}

	return nil
}

// @group leaderboards
// @summary Find leaderboards which have been created on the server. Leaderboards can be filtered with categories.
// @param limit(type=int) Return only the required number of leaderboards denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return leaderboardList(*api.LeaderboardList) A list of leaderboard results and possibly a cursor. If cursor is empty/nil there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardList(limit int, cursor string) (*api.LeaderboardList, error) {
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

	return LeaderboardList(n.logger, n.leaderboardCache, limit, cursorPtr)
}

// @group leaderboards
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The leaderboard id.
// @return error(error) An optional error value if an error occurred.
// @summary Disable a leaderboard rank cache freeing its allocated resources. If already disabled is a NOOP.
func (n *RuntimeGoNakamaModule) LeaderboardRanksDisable(ctx context.Context, id string) error {
	return DisableTournamentRanks(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, id)
}

// @group leaderboards
// @summary List records on the specified leaderboard, optionally filtering to only a subset of records by their owners. Records will be listed in the preconfigured leaderboard sort order.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the leaderboard to list.
// @param owners(type=[]string) Array of owners to filter to.
// @param limit(type=int) The maximum number of records to return (Max 10,000).
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param overrideExpiry(type=int) Records with expiry in the past are not returned unless within this defined limit. Must be equal or greater than 0.
// @return records([]*api.LeaderboardRecord) A page of leaderboard records.
// @return ownerRecords([]*api.LeaderboardRecord) A list of owner leaderboard records (empty if the owners input parameter is not set).
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

// @group leaderboards
// @summary Build a cursor to be used with leaderboardRecordsList to fetch records starting at a given rank. Only available if rank cache is not disabled for the leaderboard.
// @param leaderboardID(type=string) The unique identifier of the leaderboard.
// @param rank(type=int64) The rank to start listing leaderboard records from.
// @param overrideExpiry(type=int64) Records with expiry in the past are not returned unless within this defined limit. Must be equal or greater than 0.
// @return leaderboardListCursor(string) A string cursor to be used with leaderboardRecordsList.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardRecordsListCursorFromRank(id string, rank, expiry int64) (string, error) {
	if id == "" {
		return "", errors.New("invalid leaderboard id")
	}

	if rank < 1 {
		return "", errors.New("invalid rank - must be > 1")
	}

	if expiry < 0 {
		return "", errors.New("expects expiry to equal or greater than 0")
	}

	l := n.leaderboardCache.Get(id)
	if l == nil {
		return "", ErrLeaderboardNotFound
	}

	expiryTime, ok := calculateExpiryOverride(expiry, l)
	if !ok {
		return "", errors.New("invalid expiry")
	}

	rank-- // Fetch previous entry to include requested rank in the results
	if rank == 0 {
		return "", nil
	}

	ownerId, score, subscore, err := n.leaderboardRankCache.GetDataByRank(id, expiryTime, l.SortOrder, rank)
	if err != nil {
		return "", fmt.Errorf("failed to get cursor from rank: %s", err.Error())
	}

	cursor := &leaderboardRecordListCursor{
		IsNext:        true,
		LeaderboardId: id,
		ExpiryTime:    expiryTime,
		Score:         score,
		Subscore:      subscore,
		OwnerId:       ownerId.String(),
		Rank:          rank,
	}

	cursorStr, err := marshalLeaderboardRecordsListCursor(cursor)
	if err != nil {
		return "", fmt.Errorf("failed to marshal leaderboard cursor: %s", err.Error())
	}

	return cursorStr, nil
}

// @group leaderboards
// @summary Use the preconfigured operator for the given leaderboard to submit a score for a particular user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the leaderboard to submit to.
// @param owner(type=string) The owner of this score submission.
// @param username(type=string) The owner username of this score submission, if it's a user.
// @param score(type=int64) The score to submit.
// @param subscore(type=int64, optional=true) A secondary subscore parameter for the submission.
// @param metadata(type=map[string]interface{}, optional=true) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
// @param overrideOperator(type=*int) An override operator for the new record. The accepted values include: 0 (no override), 1 (best), 2 (set), 3 (incr), 4 (decr). Passing nil is the same as passing a pointer to 0 (no override), which uses the default leaderboard operator.
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

// @group leaderboards
// @summary Remove an owner's record from a leaderboard, if one exists.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the leaderboard to delete from.
// @param owner(type=string) The owner of the score to delete.
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

// @group leaderboards
// @summary Fetch the list of leaderboard records around the owner.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The ID of the leaderboard to list records for.
// @param ownerId(type=string) The owner ID around which to show records.
// @param limit(type=int) Return only the required number of leaderboard records denoted by this limit value. Between 1-100.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param expiry(type=int64) Time since epoch in seconds. Must be greater than 0.
// @return leaderboardRecordsHaystack(*api.LeaderboardRecordList) A list of leaderboard records and possibly a cursor. If cursor is empty/nil there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardRecordsHaystack(ctx context.Context, id, ownerID string, limit int, cursor string, expiry int64) (*api.LeaderboardRecordList, error) {
	if id == "" {
		return nil, errors.New("expects a leaderboard ID string")
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

	return LeaderboardRecordsHaystack(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, id, cursor, owner, limit, expiry)
}

// @group leaderboards
// @summary Fetch one or more leaderboards by ID.
// @param ids(type=[]string) The table array of leaderboard ids.
// @return leaderboardsGet([]*api.Leaderboard) The leaderboard records according to ID.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) LeaderboardsGetId(ctx context.Context, IDs []string) ([]*api.Leaderboard, error) {
	return LeaderboardsGet(n.leaderboardCache, IDs), nil
}

// @group tournaments
// @summary Setup a new dynamic tournament with the specified ID and various configuration settings. The underlying leaderboard will be created if it doesn't already exist, otherwise its configuration will not be updated.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the new tournament. This is used by clients to submit scores.
// @param authoritative(type=bool) Whether the tournament created is server authoritative.
// @param sortOrder(type=string, default="desc") The sort order for records in the tournament. Possible values are "asc" or "desc".
// @param operator(type=string, default="best") The operator that determines how scores behave when submitted. The possible values are "best", "set", or "incr".
// @param resetSchedule(type=string) The cron format used to define the reset schedule for the tournament. This controls when the underlying leaderboard resets and the tournament is considered active again.
// @param metadata(type=map[string]interface{}) The metadata you want associated to the tournament. Some good examples are weather conditions for a racing game.
// @param title(type=string) The title of the tournament.
// @param description(type=string) The description of the tournament.
// @param category(type=int) A category associated with the tournament. This can be used to filter different types of tournaments. Between 0 and 127.
// @param startTime(type=int, optional=true) The start time of the tournament. Leave empty for immediately or a future time.
// @param endTime(type=int, optional=true, default=never) The end time of the tournament. When the end time is elapsed, the tournament will not reset and will cease to exist. Must be greater than startTime if set.
// @param duration(type=int) The active duration for a tournament. This is the duration when clients are able to submit new records. The duration starts from either the reset period or tournament start time, whichever is sooner. A game client can query the tournament for results between end of duration and next reset period.
// @param maxSize(type=int) Maximum size of participants in a tournament.
// @param maxNumScore(type=int, default=1000000) Maximum submission attempts for a tournament record.
// @param joinRequired(type=bool, default=false) Whether the tournament needs to be joined before a record write is allowed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentCreate(ctx context.Context, id string, authoritative bool, sortOrder, operator, resetSchedule string, metadata map[string]interface{}, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired, enableRanks bool) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	sort := LeaderboardSortOrderDescending //nolint:ineffassign
	switch sortOrder {
	case "desc", "descending":
		sort = LeaderboardSortOrderDescending
	case "asc", "ascending":
		sort = LeaderboardSortOrderAscending
	default:
		return errors.New("expects sort order to be 'asc' or 'desc'")
	}

	oper := LeaderboardOperatorBest //nolint:ineffassign
	switch operator {
	case "best":
		oper = LeaderboardOperatorBest
	case "set":
		oper = LeaderboardOperatorSet
	case "incr", "increment":
		oper = LeaderboardOperatorIncrement
	case "decr", "decrement":
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

	return TournamentCreate(ctx, n.logger, n.leaderboardCache, n.leaderboardScheduler, id, authoritative, sort, oper, resetSchedule, metadataStr, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired, enableRanks)
}

// @group tournaments
// @summary Delete a tournament and all records that belong to it.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the tournament to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentDelete(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	return TournamentDelete(ctx, n.leaderboardCache, n.leaderboardRankCache, n.leaderboardScheduler, id)
}

// @group tournaments
// @summary Add additional score attempts to the owner's tournament record. This overrides the max number of score attempts allowed in the tournament for this specific owner.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the tournament to update.
// @param owner(type=string) The owner of the records to increment the count for.
// @param count(type=int) The number of attempt counts to increment. Can be negative to decrease count.
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

// @group tournaments
// @summary A tournament may need to be joined before the owner can submit scores. This operation is idempotent and will always succeed for the owner even if they have already joined the tournament.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the tournament to join.
// @param ownerId(type=string) The owner of the record.
// @param username(type=string) The username of the record owner.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentJoin(ctx context.Context, id, ownerID, username string) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	if ownerID == "" {
		return errors.New("expects a owner ID string")
	}
	oid, err := uuid.FromString(ownerID)
	if err != nil {
		return errors.New("expects owner ID to be a valid identifier")
	}

	if username == "" {
		return errors.New("expects a username string")
	}

	return TournamentJoin(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, oid, username, id)
}

// @group tournaments
// @summary Fetch one or more tournaments by ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param ids(type=[]string) The table array of tournament ids.
// @return result([]*api.Tournament) Array of tournament records.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentsGetId(ctx context.Context, tournamentIDs []string) ([]*api.Tournament, error) {
	if len(tournamentIDs) == 0 {
		return []*api.Tournament{}, nil
	}

	return TournamentsGet(ctx, n.logger, n.db, n.leaderboardCache, tournamentIDs)
}

// @group tournaments
// @summary Find tournaments which have been created on the server. Tournaments can be filtered with categories and via start and end times.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param categoryStart(type=int) Filter tournaments with categories greater or equal than this value.
// @param categoryEnd(type=int) Filter tournaments with categories equal or less than this value.
// @param startTime(type=int) Filter tournaments that start after this time.
// @param endTime(type=int) Filter tournaments that end before this time.
// @param limit(type=int, default=10) Return only the required number of tournament denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return tournamentList([]*api.TournamentList) A list of tournament results and possibly a cursor. If cursor is empty/nil there are no further results.
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

// @group tournaments
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The tournament id.
// @return error(error) An optional error value if an error occurred.
// @summary Disable a tournament rank cache freeing its allocated resources. If already disabled is a NOOP.
func (n *RuntimeGoNakamaModule) TournamentRanksDisable(ctx context.Context, id string) error {
	return DisableTournamentRanks(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, id)
}

// @group tournaments
// @summary List records on the specified tournament, optionally filtering to only a subset of records by their owners. Records will be listed in the preconfigured tournament sort order.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param tournamentId(type=string) The ID of the tournament to list records for.
// @param ownerIds(type=[]string) Array of owner IDs to filter results by.
// @param limit(type=int) Return only the required number of tournament records denoted by this limit value. Max is 10000.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param overrideExpiry(type=int64) Records with expiry in the past are not returned unless within this defined limit. Must be equal or greater than 0.
// @return records([]*api.LeaderboardRecord) A page of tournament records.
// @return ownerRecords([]*api.LeaderboardRecord) A list of owner tournament records (empty if the owners input parameter is not set).
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

// @group tournaments
// @summary Submit a score and optional subscore to a tournament leaderboard. If the tournament has been configured with join required this will fail unless the owner has already joined the tournament.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the tournament leaderboard to submit to.
// @param owner(type=string) The owner of this score submission.
// @param username(type=string) The owner username of this score submission, if it's a user.
// @param score(type=int64) The score to submit.
// @param subscore(type=int64, optional=true) A secondary subscore parameter for the submission.
// @param metadata(type=map[string]interface{}, optional=true) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
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

// @group tournaments
// @summary Remove an owner's record from a tournament, if one exists.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The unique identifier for the tournament to delete from.
// @param owner(type=string) The owner of the score to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentRecordDelete(ctx context.Context, id, ownerID string) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	if _, err := uuid.FromString(ownerID); err != nil {
		return errors.New("expects owner ID to be a valid identifier")
	}

	return TournamentRecordDelete(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, uuid.Nil, id, ownerID)
}

// @group tournaments
// @summary Fetch the list of tournament records around the owner.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param id(type=string) The ID of the tournament to list records for.
// @param ownerId(type=string) The owner ID around which to show records.
// @param limit(type=int) Return only the required number of tournament records denoted by this limit value. Between 1-100.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param expiry(type=int64) Time since epoch in seconds. Must be greater than 0.
// @return tournamentRecordsHaystack(*api.TournamentRecordList) A list of tournament records and possibly a cursor. If cursor is empty/nil there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) TournamentRecordsHaystack(ctx context.Context, id, ownerID string, limit int, cursor string, expiry int64) (*api.TournamentRecordList, error) {
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

	return TournamentRecordsHaystack(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, id, cursor, owner, limit, expiry)
}

// @group purchases
// @summary Validates and stores the purchases present in an Apple App Store Receipt.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) Base-64 encoded receipt data returned by the purchase operation itself.
// @param persist(type=bool) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @param passwordOverride(type=string, optional=true) Override the iap.apple.shared_password provided in your configuration.
// @return validation(*api.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseValidateApple(ctx context.Context, userID, receipt string, persist bool, passwordOverride ...string) (*api.ValidatePurchaseResponse, error) {
	if n.config.GetIAP().Apple.SharedPassword == "" && len(passwordOverride) == 0 {
		return nil, errors.New("apple IAP is not configured")
	}
	password := n.config.GetIAP().Apple.SharedPassword
	if len(passwordOverride) > 1 {
		return nil, errors.New("expects a single password override parameter")
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

	validation, err := ValidatePurchasesApple(ctx, n.logger, n.db, uid, password, receipt, persist)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @group purchases
// @summary Validates and stores a purchase receipt from the Google Play Store.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) JSON encoded Google receipt.
// @param persist(type=bool) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @param overrides(type=string, optional=true) Override the iap.google.client_email and iap.google.private_key provided in your configuration.
// @return validation(*api.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseValidateGoogle(ctx context.Context, userID, receipt string, persist bool, overrides ...struct {
	ClientEmail string
	PrivateKey  string
}) (*api.ValidatePurchaseResponse, error) {
	clientEmail := n.config.GetIAP().Google.ClientEmail
	privateKey := n.config.GetIAP().Google.PrivateKey

	if len(overrides) > 1 {
		return nil, errors.New("expects a single override parameter")
	} else if len(overrides) == 1 {
		if overrides[0].ClientEmail != "" {
			clientEmail = overrides[0].ClientEmail
		}
		if overrides[0].PrivateKey != "" {
			privateKey = overrides[0].PrivateKey
		}
	}

	if clientEmail == "" || privateKey == "" {
		return nil, errors.New("google IAP is not configured")
	}

	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("user ID must be a valid id string")
	}

	if len(receipt) < 1 {
		return nil, errors.New("receipt cannot be empty string")
	}

	configOverride := &IAPGoogleConfig{
		ClientEmail: clientEmail,
		PrivateKey:  privateKey,
	}

	validation, err := ValidatePurchaseGoogle(ctx, n.logger, n.db, uid, configOverride, receipt, persist)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @group purchases
// @summary Validates and stores a purchase receipt from the Huawei App Gallery.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) The Huawei receipt data.
// @param signature(type=string) The receipt signature.
// @param persist(type=bool) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @return validation(*api.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseValidateHuawei(ctx context.Context, userID, signature, inAppPurchaseData string, persist bool) (*api.ValidatePurchaseResponse, error) {
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

	validation, err := ValidatePurchaseHuawei(ctx, n.logger, n.db, uid, n.config.GetIAP().Huawei, inAppPurchaseData, signature, persist)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @group purchases
// @summary Validates and stores a purchase receipt from Facebook Instant Games.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID of the owner of the receipt.
// @param signedRequest(type=string) The Facebook Instant signedRequest receipt data.
// @param persist(type=bool) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @return validation(*api.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseValidateFacebookInstant(ctx context.Context, userID, signedRequest string, persist bool) (*api.ValidatePurchaseResponse, error) {
	if n.config.GetIAP().FacebookInstant.AppSecret == "" {
		return nil, errors.New("facebook instant IAP is not configured")
	}

	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("user ID must be a valid id string")
	}

	if len(signedRequest) < 1 {
		return nil, errors.New("signedRequest cannot be empty string")
	}

	validation, err := ValidatePurchaseFacebookInstant(ctx, n.logger, n.db, uid, n.config.GetIAP().FacebookInstant, signedRequest, persist)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @group purchases
// @summary List stored validated purchase receipts.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) Filter by user ID. Can be an empty string to list purchases for all users.
// @param limit(type=int, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return listPurchases(*api.PurchaseList) A page of stored validated purchases and possibly a cursor. If cursor is empty/nil there are no further results.
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

// @group purchases
// @summary Look up a purchase receipt by transaction ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param transactionId(type=string) Transaction ID of the purchase to look up.
// @return purchase(*api.ValidatedPurchase) A validated purchase.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) PurchaseGetByTransactionId(ctx context.Context, transactionID string) (*api.ValidatedPurchase, error) {
	if transactionID == "" {
		return nil, errors.New("expects a transaction id string.")
	}

	return GetPurchaseByTransactionId(ctx, n.logger, n.db, transactionID)
}

// @group subscriptions
// @summary Validates and stores the subscription present in an Apple App Store Receipt.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) Base-64 encoded receipt data returned by the purchase operation itself.
// @param persist(type=bool) Persist the subscription.
// @param passwordOverride(type=string, optional=true) Override the iap.apple.shared_password provided in your configuration.
// @return validation(*api.ValidateSubscriptionResponse) The resulting successfully validated subscription purchase.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) SubscriptionValidateApple(ctx context.Context, userID, receipt string, persist bool, passwordOverride ...string) (*api.ValidateSubscriptionResponse, error) {
	if n.config.GetIAP().Apple.SharedPassword == "" && len(passwordOverride) == 0 {
		return nil, errors.New("apple IAP is not configured")
	}
	password := n.config.GetIAP().Apple.SharedPassword
	if len(passwordOverride) > 1 {
		return nil, errors.New("expects a single password override parameter")
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

	validation, err := ValidateSubscriptionApple(ctx, n.logger, n.db, uid, password, receipt, persist)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @group subscriptions
// @summary Validates and stores a subscription receipt from the Google Play Store.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) JSON encoded Google receipt.
// @param persist(type=bool) Persist the subscription.
// @param overrides(type=string, optional=true) Override the iap.google.client_email and iap.google.private_key provided in your configuration.
// @return validation(*api.ValidateSubscriptionResponse) The resulting successfully validated subscription.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) SubscriptionValidateGoogle(ctx context.Context, userID, receipt string, persist bool, overrides ...struct {
	ClientEmail string
	PrivateKey  string
}) (*api.ValidateSubscriptionResponse, error) {
	clientEmail := n.config.GetIAP().Google.ClientEmail
	privateKey := n.config.GetIAP().Google.PrivateKey

	if len(overrides) > 1 {
		return nil, errors.New("expects a single override parameter")
	} else if len(overrides) == 1 {
		if overrides[0].ClientEmail != "" {
			clientEmail = overrides[0].ClientEmail
		}
		if overrides[0].PrivateKey != "" {
			privateKey = overrides[0].PrivateKey
		}
	}

	if clientEmail == "" || privateKey == "" {
		return nil, errors.New("google IAP is not configured")
	}

	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("user ID must be a valid id string")
	}

	if len(receipt) < 1 {
		return nil, errors.New("receipt cannot be empty string")
	}

	configOverride := &IAPGoogleConfig{
		ClientEmail: clientEmail,
		PrivateKey:  privateKey,
	}

	validation, err := ValidateSubscriptionGoogle(ctx, n.logger, n.db, uid, configOverride, receipt, persist)
	if err != nil {
		return nil, err
	}

	return validation, nil
}

// @group subscriptions
// @summary List stored validated subscriptions.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) Filter by user ID. Can be an empty string to list purchases for all users.
// @param limit(type=int, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return listSubscriptions(*api.SubscriptionList) A page of stored validated subscriptions and possibly a cursor. If cursor is empty/nil there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) SubscriptionsList(ctx context.Context, userID string, limit int, cursor string) (*api.SubscriptionList, error) {
	if userID != "" {
		if _, err := uuid.FromString(userID); err != nil {
			return nil, errors.New("expects a valid user ID")
		}
	}

	if limit <= 0 || limit > 100 {
		return nil, errors.New("limit must be a positive value <= 100")
	}

	return ListSubscriptions(ctx, n.logger, n.db, userID, limit, cursor)
}

// @group subscriptions
// @summary Look up a subscription receipt by productID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) User ID of the subscription owner.
// @param productId(type=string) Product ID of the subscription to look up.
// @return subscription(*api.ValidatedSubscription) A validated subscription.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) SubscriptionGetByProductId(ctx context.Context, userID, productID string) (*api.ValidatedSubscription, error) {
	if _, err := uuid.FromString(userID); err != nil {
		return nil, errors.New("expects a valid user ID")
	}

	if productID == "" {
		return nil, errors.New("expects a product id string.")
	}

	return GetSubscriptionByProductId(ctx, n.logger, n.db, userID, productID)
}

// @group groups
// @summary Fetch one or more groups by their ID.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param groupIds(type=[]string) An array of strings of the IDs for the groups to get.
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

// @group groups
// @summary Setup a group with various configuration settings. The group will be created if they don't exist or fail if the group name is taken.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The user ID to be associated as the group superadmin.
// @param name(type=string) Group name, must be unique.
// @param creatorId(type=string, optional=true) The user ID to be associated as creator. If not set or nil/null, system user will be set.
// @param langTag(type=string, optional=true, default="en") Group language.
// @param description(type=string, optional=true) Group description, can be left empty as nil/null.
// @param avatarUrl(type=string, optional=true) URL to the group avatar, can be left empty as nil/null.
// @param open(type=bool, optional=true, default=false) Whether the group is for anyone to join, or members will need to send invitations to join.
// @param metadata(type=map[string]interface{}, optional=true) Custom information to store for this group. Can be left empty as nil/null.
// @param maxCount(type=int, default=100) Maximum number of members to have in the group.
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

// @group groups
// @summary Update a group with various configuration settings. The group which is updated can change some or all of its fields.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param groupId(type=string) The ID of the group to update.
// @param userId(type=string) User ID calling the update operation for permission checking. Set as empty string to enact the changes as the system user.
// @param name(type=string) Group name, can be empty if not changed.
// @param creatorId(type=string) The user ID to be associated as creator. Can be empty if not changed.
// @param langTag(type=string) Group language. Empty if not updated.
// @param description(type=string) Group description, can be left empty if not updated.
// @param avatarUrl(type=string) URL to the group avatar, can be left empty if not updated.
// @param open(type=bool) Whether the group is for anyone to join or not.
// @param metadata(type=map[string]interface{}) Custom information to store for this group. Use nil if field is not being updated.
// @param maxCount(type=int) Maximum number of members to have in the group. Use 0, nil/null if field is not being updated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUpdate(ctx context.Context, id, userID, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) error {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	var uid uuid.UUID
	if userID != "" {
		uid, err = uuid.FromString(userID)
		if err != nil {
			return errors.New("expects user ID to be a valid identifier")
		}
	} else {
		uid = uuid.Nil
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

	return UpdateGroup(ctx, n.logger, n.db, groupID, uid, creator, nameWrapper, langTagWrapper, descriptionWrapper, avatarURLWrapper, metadataWrapper, openWrapper, maxCount)
}

// @group groups
// @summary Delete a group.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param groupId(type=string) The ID of the group to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupDelete(ctx context.Context, id string) error {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	return DeleteGroup(ctx, n.logger, n.db, groupID, uuid.Nil)
}

// @group groups
// @summary Join a group for a particular user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param groupId(type=string) The ID of the group to join.
// @param userId(type=string) The user ID to add to this group.
// @param username(type=string) The username of the user to add to this group.
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

	return JoinGroup(ctx, n.logger, n.db, n.tracker, n.router, group, user, username)
}

// @group groups
// @summary Leave a group for a particular user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param groupId(type=string) The ID of the group to leave.
// @param userId(type=string) The user ID to remove from this group.
// @param username(type=string) The username of the user to remove from this group.
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

	return LeaveGroup(ctx, n.logger, n.db, n.tracker, n.router, n.streamManager, group, user, username)
}

// @group groups
// @summary Add users to a group.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param callerId(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permissions are bypassed.
// @param groupId(type=string) The ID of the group to add users to.
// @param userIds(type=[]string) Table array of user IDs to add to this group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersAdd(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be empty or a valid identifier")
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

	return AddGroupUsers(ctx, n.logger, n.db, n.tracker, n.router, caller, group, users)
}

// @group groups
// @summary Ban users from a group.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param callerId(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permissions are bypassed.
// @param groupId(type=string) The ID of the group to ban users from.
// @param userIds(type=[]string) Table array of user IDs to ban from this group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersBan(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be empty or a valid identifier")
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
			return errors.New("cannot ban the root user")
		}
		users = append(users, uid)
	}

	return BanGroupUsers(ctx, n.logger, n.db, n.tracker, n.router, n.streamManager, caller, group, users)
}

// @group groups
// @summary Kick users from a group.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param callerId(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permissions are bypassed.
// @param groupId(type=string) The ID of the group to kick users from.
// @param userIds(type=[]string) Table array of user IDs to kick.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersKick(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be empty or a valid identifier")
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

	return KickGroupUsers(ctx, n.logger, n.db, n.tracker, n.router, n.streamManager, caller, group, users, false)
}

// @group groups
// @summary Promote users in a group.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param callerId(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permissions are bypassed.
// @param groupId(type=string) The ID of the group whose members are being promoted.
// @param userIds(type=[]string) Table array of user IDs to promote.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersPromote(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be empty or a valid identifier")
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

// @group groups
// @summary Demote users in a group.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param callerId(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permissions are bypassed.
// @param groupId(type=string) The ID of the group whose members are being demoted.
// @param userIds(type=[]string) Table array of user IDs to demote.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupUsersDemote(ctx context.Context, callerID, groupID string, userIDs []string) error {
	caller := uuid.Nil
	if callerID != "" {
		var err error
		if caller, err = uuid.FromString(callerID); err != nil {
			return errors.New("expects caller ID to be empty or a valid identifier")
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

// @group groups
// @summary List all members, admins and superadmins which belong to a group. This also lists incoming join requests.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param groupId(type=string) The ID of the group to list members for.
// @param limit(type=int) Return only the required number of users denoted by this limit value.
// @param state(type=int) Return only the users matching this state value, '0' for superadmins for example.
// @param cursor(type=string) Pagination cursor from previous result. Don't set to start fetching from the beginning.
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

	users, err := ListGroupUsers(ctx, n.logger, n.db, n.statusRegistry, groupID, limit, stateWrapper, cursor)
	if err != nil {
		return nil, "", err
	}

	return users.GroupUsers, users.Cursor, nil
}

// @group groups
// @summary Find groups based on the entered criteria.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param name(type=string, optional=true) Search for groups that contain this value in their name. Cannot be combined with any other filter.
// @param langTag(type=string, optional=true) Filter based upon the entered language tag.
// @param members(type=int, optional=true) Search by number of group members.
// @param open(type=bool, optional=true) Filter based on whether groups are Open or Closed.
// @param limit(type=int, optional=true) Return only the required number of groups denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return groups([]*api.Group) A list of groups.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
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

// @group groups
// @summary Fetch one or more groups randomly.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param count(type=int) The number of groups to fetch.
// @return users([]*api.Group) A list of group record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) GroupsGetRandom(ctx context.Context, count int) ([]*api.Group, error) {
	if count == 0 {
		return make([]*api.Group, 0), nil
	}

	if count < 0 || count > 1000 {
		return nil, errors.New("count must be 0-1000")
	}

	return GetRandomGroups(ctx, n.logger, n.db, count)
}

// @group groups
// @summary List all groups which a user belongs to and whether they've been accepted or if it's an invite.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The ID of the user to list groups for.
// @param limit(type=int) The maximum number of entries in the listing.
// @param state(type=int, optional=true) The state of the user within the group. If unspecified this returns users in all states.
// @param cursor(type=string) Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return userGroups([]*api.UserGroupList_UserGroup) A table of groups with their fields.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
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

// @group events
// @summary Generate an event.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param evt(type=*api.Event) The event to be generated.
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

// @group metrics
// @summary Add a custom metrics counter.
// @param name(type=string) The name of the custom metrics counter.
// @param tags(type=map[string]string) The metrics tags associated with this counter.
// @param delta(type=int64) Value to update this metric with.
func (n *RuntimeGoNakamaModule) MetricsCounterAdd(name string, tags map[string]string, delta int64) {
	n.metrics.CustomCounter(name, tags, delta)
}

// @group metrics
// @summary Add a custom metrics gauge.
// @param name(type=string) The name of the custom metrics gauge.
// @param tags(type=map[string]string) The metrics tags associated with this gauge.
// @param value(type=float64) Value to update this metric with.
func (n *RuntimeGoNakamaModule) MetricsGaugeSet(name string, tags map[string]string, value float64) {
	n.metrics.CustomGauge(name, tags, value)
}

// @group metrics
// @summary Add a custom metrics timer.
// @param name(type=string) The name of the custom metrics timer.
// @param tags(type=map[string]string) The metrics tags associated with this timer.
// @param value(type=time.Duration) Value to update this metric with.
func (n *RuntimeGoNakamaModule) MetricsTimerRecord(name string, tags map[string]string, value time.Duration) {
	n.metrics.CustomTimer(name, tags, value)
}

// @group friends
// @summary List all friends, invites, invited, and blocked which belong to a user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The ID of the user whose friends, invites, invited, and blocked you want to list.
// @param limit(type=int) The number of friends to retrieve in this page of results. No more than 100 limit allowed per result.
// @param state(type=int, optional=true) The state of the friendship with the user. If unspecified this returns friends in all states for the user.
// @param cursor(type=string) Pagination cursor from previous result. Set to "" to start fetching from the beginning.
// @return friends([]*api.Friend) The user information for users that are friends of the current user.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
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

	friends, err := ListFriends(ctx, n.logger, n.db, n.statusRegistry, uid, limit, stateWrapper, cursor)
	if err != nil {
		return nil, "", err
	}

	return friends.Friends, friends.Cursor, nil
}

// @group friends
// @summary List friends of friends.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The ID of the user whose friends of friends you want to list.
// @param limit(type=int) The number of friends of friends to retrieve in this page of results. No more than 100 limit allowed per result.
// @param cursor(type=string) Pagination cursor from previous result. Set to "" to start fetching from the beginning.
// @return friends([]*api.FriendsOfFriendsList_FriendOfFriend) The user information for users that are friends of friends the current user.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) FriendsOfFriendsList(ctx context.Context, userID string, limit int, cursor string) ([]*api.FriendsOfFriendsList_FriendOfFriend, string, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, "", errors.New("expects user ID to be a valid identifier")
	}

	if limit < 1 || limit > 1000 {
		return nil, "", errors.New("expects limit to be 1-1000")
	}

	friends, err := ListFriendsOfFriends(ctx, n.logger, n.db, n.statusRegistry, uid, limit, cursor)
	if err != nil {
		return nil, "", err
	}

	return friends.FriendsOfFriends, friends.Cursor, nil
}

// @group friends
// @summary Add friends to a user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The ID of the user to whom you want to add friends.
// @param username(type=string) The name of the user to whom you want to add friends.
// @param ids(type=[]string) The IDs of the users you want to add as friends.
// @param usernames(type=[]string) The usernames of the users you want to add as friends.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) FriendsAdd(ctx context.Context, userID string, username string, ids []string, usernames []string) error {
	userUUID, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	if len(ids) == 0 && len(usernames) == 0 {
		return nil
	}

	for _, id := range ids {
		if userID == id {
			return errors.New("cannot add self as friend")
		}
		if uid, err := uuid.FromString(id); err != nil || uid == uuid.Nil {
			return fmt.Errorf("invalid user ID '%v'", id)
		}
	}

	for _, u := range usernames {
		if u == "" {
			return errors.New("username to add must not be empty")
		}
		if username == u {
			return errors.New("cannot add self as friend")
		}
	}

	fetchIDs, err := fetchUserID(ctx, n.db, usernames)
	if err != nil {
		n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernames))
		return errors.New("error while trying to add friends")
	}

	if len(fetchIDs)+len(ids) == 0 {
		return errors.New("no valid ID or username was provided")
	}

	allIDs := make([]string, 0, len(ids)+len(fetchIDs))
	allIDs = append(allIDs, ids...)
	allIDs = append(allIDs, fetchIDs...)

	err = AddFriends(ctx, n.logger, n.db, n.tracker, n.router, userUUID, username, allIDs)
	if err != nil {
		return err
	}

	return nil
}

// @group friends
// @summary Delete friends from a user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The ID of the user from whom you want to delete friends.
// @param username(type=string) The name of the user from whom you want to delete friends.
// @param ids(type=[]string) The IDs of the users you want to delete as friends.
// @param usernames(type=[]string) The usernames of the users you want to delete as friends.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) FriendsDelete(ctx context.Context, userID string, username string, ids []string, usernames []string) error {
	userUUID, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	if len(ids) == 0 && len(usernames) == 0 {
		return nil
	}

	for _, id := range ids {
		if userID == id {
			return errors.New("cannot delete self")
		}
		if uid, err := uuid.FromString(id); err != nil || uid == uuid.Nil {
			return fmt.Errorf("invalid user ID '%v'", id)
		}
	}

	for _, u := range usernames {
		if u == "" {
			return errors.New("username to delete must not be empty")
		}
		if username == u {
			return errors.New("cannot delete self")
		}
	}

	fetchIDs, err := fetchUserID(ctx, n.db, usernames)
	if err != nil {
		n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernames))
		return errors.New("error while trying to delete friends")
	}

	if len(fetchIDs)+len(ids) == 0 {
		return errors.New("no valid ID or username was provided")
	}

	allIDs := make([]string, 0, len(ids)+len(fetchIDs))
	allIDs = append(allIDs, ids...)
	allIDs = append(allIDs, fetchIDs...)

	err = DeleteFriends(ctx, n.logger, n.db, userUUID, allIDs)
	if err != nil {
		return err
	}

	return nil
}

// @group friends
// @summary Block friends for a user.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param userId(type=string) The ID of the user for whom you want to block friends.
// @param username(type=string) The name of the user for whom you want to block friends.
// @param ids(type=[]string) The IDs of the users you want to block as friends.
// @param usernames(type=[]string) The usernames of the users you want to block as friends.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) FriendsBlock(ctx context.Context, userID string, username string, ids []string, usernames []string) error {
	userUUID, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	if len(ids) == 0 && len(usernames) == 0 {
		return nil
	}

	for _, id := range ids {
		if userID == id {
			return errors.New("cannot block self")
		}
		if uid, err := uuid.FromString(id); err != nil || uid == uuid.Nil {
			return fmt.Errorf("invalid user ID '%v'", id)
		}
	}

	for _, u := range usernames {
		if u == "" {
			return errors.New("username to block must not be empty")
		}
		if username == u {
			return errors.New("cannot block self")
		}
	}

	fetchIDs, err := fetchUserID(ctx, n.db, usernames)
	if err != nil {
		n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernames))
		return errors.New("error while trying to block friends")
	}

	if len(fetchIDs)+len(ids) == 0 {
		return errors.New("no valid ID or username was provided")
	}

	allIDs := make([]string, 0, len(ids)+len(fetchIDs))
	allIDs = append(allIDs, ids...)
	allIDs = append(allIDs, fetchIDs...)

	err = BlockFriends(ctx, n.logger, n.db, n.tracker, userUUID, allIDs)
	if err != nil {
		return err
	}

	return nil
}

func (n *RuntimeGoNakamaModule) SetEventFn(fn RuntimeEventCustomFunction) {
	n.Lock()
	n.eventFn = fn
	n.Unlock()
}

// @group chat
// @summary Send a message on a realtime chat channel.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param channelId(type=string) The ID of the channel to send the message on.
// @param content(type=map[string]interface{}) Message content.
// @param senderId(type=string, optional=true) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string, optional=true) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool) Whether to record this message in the channel history.
// @return channelMessageSend(*rtapi.ChannelMessageAck) Message sent ack containing the following variables: 'channelId', 'contentStr', 'senderId', 'senderUsername', and 'persist'.
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

// @group chat
// @summary Update a message on a realtime chat channel.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param channelId(type=string) The ID of the channel to send the message on.
// @param messageId(type=string) The ID of the message to update.
// @param content(type=map[string]interface{}) Message content.
// @param senderId(type=string, optional=true) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string, optional=true) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool) Whether to record this message in the channel history.
// @return channelMessageUpdate(*rtapi.ChannelMessageAck) Message updated ack containing the following variables: 'channelId', 'contentStr', 'senderId', 'senderUsername', and 'persist'.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ChannelMessageUpdate(ctx context.Context, channelId, messageId string, content map[string]interface{}, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	channelIdToStreamResult, err := ChannelIdToStream(channelId)
	if err != nil {
		return nil, err
	}

	if _, err := uuid.FromString(messageId); err != nil {
		return nil, errChannelMessageIdInvalid
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

// @group chat
// @summary Remove a message on a realtime chat channel.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param channelId(type=string) The ID of the channel to remove the message on.
// @param messageId(type=string) The ID of the message to remove.
// @param senderId(type=string, optional=true) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string, optional=true) The username of the user who sent this message. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool) Whether to record this in the channel history.
// @return channelMessageRemove(*rtapi.ChannelMessageAck) Message removed ack containing the following variables: 'channelId', 'contentStr', 'senderId', 'senderUsername', and 'persist'.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ChannelMessageRemove(ctx context.Context, channelId, messageId string, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	channelIdToStreamResult, err := ChannelIdToStream(channelId)
	if err != nil {
		return nil, err
	}

	if _, err := uuid.FromString(messageId); err != nil {
		return nil, errChannelMessageIdInvalid
	}

	return ChannelMessageRemove(ctx, n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelId, messageId, senderId, senderUsername, persist)
}

// @group chat
// @summary List messages from a realtime chat channel.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param channelId(type=string) The ID of the channel to list messages from.
// @param limit(type=int) The number of messages to return per page.
// @param forward(type=bool) Whether to list messages from oldest to newest, or newest to oldest.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return channelMessageList([]*rtapi.ChannelMessage) Messages from the specified channel.
// @return nextCursor(string) Cursor for the next page of messages, if any.
// @return prevCursor(string) Cursor for the previous page of messages, if any.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ChannelMessagesList(ctx context.Context, channelId string, limit int, forward bool, cursor string) ([]*api.ChannelMessage, string, string, error) {
	channelIdToStreamResult, err := ChannelIdToStream(channelId)
	if err != nil {
		return nil, "", "", err
	}

	if limit < 1 || limit > 100 {
		return nil, "", "", errors.New("limit must be 1-100")
	}

	list, err := ChannelMessagesList(ctx, n.logger, n.db, uuid.Nil, channelIdToStreamResult.Stream, channelId, limit, forward, cursor)
	if err != nil {
		return nil, "", "", err
	}

	return list.Messages, list.NextCursor, list.PrevCursor, nil
}

// @group chat
// @summary Create a channel identifier to be used in other runtime calls. Does not create a channel.
// @param ctx(type=context.Context) The context object represents information about the server and requester.
// @param senderId(type=string) UserID of the message sender (when applicable). An empty string defaults to the system user.
// @param target(type=string) Can be the room name, group identifier, or another username.
// @param chanType(type=runtime.ChannelType) The type of channel, either Room (1), Direct (2), or Group (3).
// @return channelId(string) The generated ID representing a channel.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeGoNakamaModule) ChannelIdBuild(ctx context.Context, senderId, target string, chanType runtime.ChannelType) (string, error) {
	senderUUID := uuid.Nil
	if senderId != "" {
		var err error
		senderUUID, err = uuid.FromString(senderId)
		if err != nil {
			return "", err
		}
	}

	channelId, _, err := BuildChannelId(ctx, n.logger, n.db, senderUUID, target, rtapi.ChannelJoin_Type(chanType))
	if err != nil {
		return "", err
	}

	return channelId, nil
}

// @group satori
// @summary Get the Satori client.
// @return satori(runtime.Satori) The Satori client.
func (n *RuntimeGoNakamaModule) GetSatori() runtime.Satori {
	return n.satori
}

func (n *RuntimeGoNakamaModule) GetFleetManager() runtime.FleetManager {
	return n.fleetManager
}
