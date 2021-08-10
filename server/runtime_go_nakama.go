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
	metrics              *Metrics
	streamManager        StreamManager
	router               MessageRouter

	eventFn RuntimeEventCustomFunction

	node string

	matchCreateFn RuntimeMatchCreateFunction
}

func NewRuntimeGoNakamaModule(logger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, matchRegistry MatchRegistry, tracker Tracker, metrics *Metrics, streamManager StreamManager, router MessageRouter) *RuntimeGoNakamaModule {
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

func (n *RuntimeGoNakamaModule) AccountDeleteId(ctx context.Context, userID string, recorded bool) error {
	u, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	return DeleteAccount(ctx, n.logger, n.db, u, recorded)
}

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

func (n *RuntimeGoNakamaModule) UsersGetRandom(ctx context.Context, count int) ([]*api.User, error) {
	if count == 0 {
		return make([]*api.User, 0), nil
	}

	if count < 0 || count > 1000 {
		return nil, errors.New("count must be 0-1000")
	}

	return GetRandomUsers(ctx, n.logger, n.db, n.tracker, count)
}

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

func (n *RuntimeGoNakamaModule) LinkApple(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkApple(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

func (n *RuntimeGoNakamaModule) LinkCustom(ctx context.Context, userID, customID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkCustom(ctx, n.logger, n.db, id, customID)
}

func (n *RuntimeGoNakamaModule) LinkDevice(ctx context.Context, userID, deviceID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkDevice(ctx, n.logger, n.db, id, deviceID)
}

func (n *RuntimeGoNakamaModule) LinkEmail(ctx context.Context, userID, email, password string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkEmail(ctx, n.logger, n.db, id, email, password)
}

func (n *RuntimeGoNakamaModule) LinkFacebook(ctx context.Context, userID, username, token string, importFriends bool) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkFacebook(ctx, n.logger, n.db, n.socialClient, n.router, id, username, n.config.GetSocial().FacebookLimitedLogin.AppId, token, importFriends)
}

func (n *RuntimeGoNakamaModule) LinkFacebookInstantGame(ctx context.Context, userID, signedPlayerInfo string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkFacebookInstantGame(ctx, n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo)
}

func (n *RuntimeGoNakamaModule) LinkGameCenter(ctx context.Context, userID, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkGameCenter(ctx, n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyUrl)
}

func (n *RuntimeGoNakamaModule) LinkGoogle(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkGoogle(ctx, n.logger, n.db, n.socialClient, id, token)
}

func (n *RuntimeGoNakamaModule) LinkSteam(ctx context.Context, userID, username, token string, importFriends bool) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return LinkSteam(ctx, n.logger, n.db, n.config, n.socialClient, n.router, id, username, token, importFriends)
}

func (n *RuntimeGoNakamaModule) ReadFile(relPath string) (*os.File, error) {
	return FileRead(n.config.GetRuntime().Path, relPath)
}

func (n *RuntimeGoNakamaModule) UnlinkApple(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkApple(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

func (n *RuntimeGoNakamaModule) UnlinkCustom(ctx context.Context, userID, customID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkCustom(ctx, n.logger, n.db, id, customID)
}

func (n *RuntimeGoNakamaModule) UnlinkDevice(ctx context.Context, userID, deviceID string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkDevice(ctx, n.logger, n.db, id, deviceID)
}

func (n *RuntimeGoNakamaModule) UnlinkEmail(ctx context.Context, userID, email string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkEmail(ctx, n.logger, n.db, id, email)
}

func (n *RuntimeGoNakamaModule) UnlinkFacebook(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkFacebook(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, id, token)
}

func (n *RuntimeGoNakamaModule) UnlinkFacebookInstantGame(ctx context.Context, userID, signedPlayerInfo string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkFacebookInstantGame(ctx, n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo)
}

func (n *RuntimeGoNakamaModule) UnlinkGameCenter(ctx context.Context, userID, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkGameCenter(ctx, n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyUrl)
}

func (n *RuntimeGoNakamaModule) UnlinkGoogle(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkGoogle(ctx, n.logger, n.db, n.socialClient, id, token)
}

func (n *RuntimeGoNakamaModule) UnlinkSteam(ctx context.Context, userID, token string) error {
	id, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("user ID must be a valid identifier")
	}

	return UnlinkSteam(ctx, n.logger, n.db, n.config, n.socialClient, id, token)
}

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

func (n *RuntimeGoNakamaModule) SessionDisconnect(ctx context.Context, sessionID string, reason ...runtime.PresenceReason) error {
	sid, err := uuid.FromString(sessionID)
	if err != nil {
		return errors.New("expects valid session id")
	}

	return n.sessionRegistry.Disconnect(ctx, sid, reason...)
}

func (n *RuntimeGoNakamaModule) SessionLogout(userID, token, refreshToken string) error {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects valid user id")
	}

	return SessionLogout(n.config, n.sessionCache, uid, token, refreshToken)
}

func (n *RuntimeGoNakamaModule) MatchCreate(ctx context.Context, module string, params map[string]interface{}) (string, error) {
	if module == "" {
		return "", errors.New("expects module name")
	}

	n.RLock()
	fn := n.matchCreateFn
	n.RUnlock()

	return n.matchRegistry.CreateMatch(ctx, n.logger, fn, module, params)
}

func (n *RuntimeGoNakamaModule) MatchGet(ctx context.Context, id string) (*api.Match, error) {
	return n.matchRegistry.GetMatch(ctx, id)
}

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

func (n *RuntimeGoNakamaModule) WalletLedgerList(ctx context.Context, userID string, limit int, cursor string) ([]runtime.WalletLedgerItem, string, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, "", errors.New("expects a valid user id")
	}

	if limit < 0 || limit > 100 {
		return nil, "", errors.New("expects limit to be 0-100")
	}

	items, newCursor, err := ListWalletLedger(ctx, n.logger, n.db, uid, &limit, cursor)
	if err != nil {
		return nil, "", err
	}

	runtimeItems := make([]runtime.WalletLedgerItem, len(items))
	for i, item := range items {
		runtimeItems[i] = runtime.WalletLedgerItem(item)
	}
	return runtimeItems, newCursor, nil
}

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

func (n *RuntimeGoNakamaModule) LeaderboardDelete(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("expects a leaderboard ID string")
	}

	return n.leaderboardCache.Delete(ctx, id)
}

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

func (n *RuntimeGoNakamaModule) LeaderboardRecordDelete(ctx context.Context, id, ownerID string) error {
	if id == "" {
		return errors.New("expects a leaderboard ID string")
	}

	if _, err := uuid.FromString(ownerID); err != nil {
		return errors.New("expects owner ID to be a valid identifier")
	}

	return LeaderboardRecordDelete(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, uuid.Nil, id, ownerID)
}

func (n *RuntimeGoNakamaModule) LeaderboardsGetId(ctx context.Context, IDs []string) ([]*api.Leaderboard, error) {
	return LeaderboardsGet(n.leaderboardCache, IDs), nil
}

func (n *RuntimeGoNakamaModule) TournamentCreate(ctx context.Context, id string, sortOrder, operator, resetSchedule string, metadata map[string]interface{}, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error {
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
	if duration < 0 {
		return errors.New("duration must be >= 0")
	}
	if maxSize < 0 {
		return errors.New("maxSize must be >= 0")
	}
	if maxNumScore < 0 {
		return errors.New("maxNumScore must be >= 0")
	}

	return TournamentCreate(ctx, n.logger, n.leaderboardCache, n.leaderboardScheduler, id, sort, oper, resetSchedule, metadataStr, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired)
}

func (n *RuntimeGoNakamaModule) TournamentDelete(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("expects a tournament ID string")
	}

	return TournamentDelete(ctx, n.leaderboardCache, n.leaderboardRankCache, n.leaderboardScheduler, id)
}

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

func (n *RuntimeGoNakamaModule) TournamentsGetId(ctx context.Context, tournamentIDs []string) ([]*api.Tournament, error) {
	if len(tournamentIDs) == 0 {
		return []*api.Tournament{}, nil
	}

	return TournamentsGet(ctx, n.logger, n.db, tournamentIDs)
}

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

func (n *RuntimeGoNakamaModule) PurchaseGetByTransactionId(ctx context.Context, transactionID string) (string, *api.ValidatedPurchase, error) {
	if transactionID == "" {
		return "", nil, errors.New("expects a transaction id string.")
	}

	return GetPurchaseByTransactionID(ctx, n.logger, n.db, transactionID)
}

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

func (n *RuntimeGoNakamaModule) GroupDelete(ctx context.Context, id string) error {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	return DeleteGroup(ctx, n.logger, n.db, groupID, uuid.Nil)
}

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

func (n *RuntimeGoNakamaModule) MetricsCounterAdd(name string, tags map[string]string, delta int64) {
	n.metrics.CustomCounter(name, tags, delta)
}

func (n *RuntimeGoNakamaModule) MetricsGaugeSet(name string, tags map[string]string, value float64) {
	n.metrics.CustomGauge(name, tags, value)
}

func (n *RuntimeGoNakamaModule) MetricsTimerRecord(name string, tags map[string]string, value time.Duration) {
	n.metrics.CustomTimer(name, tags, value)
}

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

func (n *RuntimeGoNakamaModule) ChannelIdBuild(ctx context.Context, target string, chanType runtime.ChannelType) (string, error) {
	channelId, _, err := BuildChannelId(ctx, n.logger, n.db, uuid.Nil, target, rtapi.ChannelJoin_Type(chanType))
	if err != nil {
		return "", err
	}

	return channelId, nil
}
