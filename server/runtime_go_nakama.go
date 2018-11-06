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
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/gorhill/cronexpr"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/runtime"
	"github.com/heroiclabs/nakama/social"
	"github.com/pkg/errors"
	"go.uber.org/zap"
)

type RuntimeGoNakamaModule struct {
	sync.RWMutex
	logger               *zap.Logger
	db                   *sql.DB
	config               Config
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	leaderboardScheduler LeaderboardScheduler
	sessionRegistry      *SessionRegistry
	matchRegistry        MatchRegistry
	tracker              Tracker
	router               MessageRouter

	node string

	matchCreateFn RuntimeMatchCreateFunction
}

func NewRuntimeGoNakamaModule(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter) *RuntimeGoNakamaModule {
	return &RuntimeGoNakamaModule{
		logger:               logger,
		db:                   db,
		config:               config,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		leaderboardScheduler: leaderboardScheduler,
		sessionRegistry:      sessionRegistry,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		router:               router,

		node: config.GetName(),
	}
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
	} else if invalidCharsRegex.MatchString(username) {
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
	} else if invalidCharsRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	return AuthenticateDevice(ctx, n.logger, n.db, id, username, create)
}

func (n *RuntimeGoNakamaModule) AuthenticateEmail(ctx context.Context, email, password, username string, create bool) (string, string, bool, error) {
	if email == "" {
		return "", "", false, errors.New("expects email string")
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
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
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
	} else if invalidCharsRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	dbUserID, dbUsername, created, err := AuthenticateFacebook(ctx, n.logger, n.db, n.socialClient, token, username, create)
	if err == nil && importFriends {
		importFacebookFriends(ctx, n.logger, n.db, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
	}

	return dbUserID, dbUsername, created, err
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
	} else if invalidCharsRegex.MatchString(username) {
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
	} else if invalidCharsRegex.MatchString(username) {
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
	} else if invalidCharsRegex.MatchString(username) {
		return "", "", false, errors.New("expects username to be valid, no spaces or control characters allowed")
	} else if len(username) > 128 {
		return "", "", false, errors.New("expects id to be valid, must be 1-128 bytes")
	}

	return AuthenticateSteam(ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().Steam.AppID, n.config.GetSocial().Steam.PublisherKey, token, username, create)
}

func (n *RuntimeGoNakamaModule) AuthenticateTokenGenerate(userID, username string, exp int64) (string, int64, error) {
	if userID == "" {
		return "", 0, errors.New("expects user id")
	}
	_, err := uuid.FromString(userID)
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

	token, exp := generateTokenWithExpiry(n.config, userID, username, exp)
	return token, exp, nil
}

func (n *RuntimeGoNakamaModule) AccountGetId(ctx context.Context, userID string) (*api.Account, error) {
	u, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("invalid user id")
	}

	return GetAccount(ctx, n.logger, n.db, n.tracker, u)
}

func (n *RuntimeGoNakamaModule) AccountUpdateId(ctx context.Context, userID, username string, metadata map[string]interface{}, displayName, timezone, location, langTag, avatarUrl string) error {
	u, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects user ID to be a valid identifier")
	}

	var metadataWrapper *wrappers.StringValue
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return errors.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataWrapper = &wrappers.StringValue{Value: string(metadataBytes)}
	}

	displayNameWrapper := &wrappers.StringValue{Value: displayName}
	timezoneWrapper := &wrappers.StringValue{Value: timezone}
	locationWrapper := &wrappers.StringValue{Value: location}
	langWrapper := &wrappers.StringValue{Value: langTag}
	avatarWrapper := &wrappers.StringValue{Value: avatarUrl}

	return UpdateAccount(ctx, n.logger, n.db, u, username, displayNameWrapper, timezoneWrapper, locationWrapper, langWrapper, avatarWrapper, metadataWrapper)
}

func (n *RuntimeGoNakamaModule) UsersGetId(ctx context.Context, userIDs []string) ([]*api.User, error) {
	if len(userIDs) == 0 {
		return make([]*api.User, 0), nil
	}

	for _, id := range userIDs {
		if _, err := uuid.FromString(id); err != nil {
			return nil, errors.New("each user id must be a valid id string")
		}
	}

	users, err := GetUsers(ctx, n.logger, n.db, n.tracker, userIDs, nil, nil)
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

func (n *RuntimeGoNakamaModule) UsersBanId(ctx context.Context, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}

	for _, id := range userIDs {
		if _, err := uuid.FromString(id); err != nil {
			return errors.New("each user id must be a valid id string")
		}
	}

	return BanUsers(ctx, n.logger, n.db, userIDs)
}

func (n *RuntimeGoNakamaModule) UsersUnbanId(ctx context.Context, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}

	for _, id := range userIDs {
		if _, err := uuid.FromString(id); err != nil {
			return errors.New("each user id must be a valid id string")
		}
	}

	return UnbanUsers(ctx, n.logger, n.db, userIDs)
}

func (n *RuntimeGoNakamaModule) StreamUserList(mode uint8, subject, descriptor, label string, includeHidden, includeNotHidden bool) ([]runtime.Presence, error) {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return nil, errors.New("stream descriptor must be a valid identifier")
		}
	}

	presences := n.tracker.ListByStream(stream, includeHidden, includeNotHidden)
	runtimePresences := make([]runtime.Presence, len(presences))
	for i, p := range presences {
		runtimePresences[i] = runtime.Presence(p)
	}
	return runtimePresences, nil
}

func (n *RuntimeGoNakamaModule) StreamUserGet(mode uint8, subject, descriptor, label, userID, sessionID string) (runtime.PresenceMeta, error) {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return nil, errors.New("stream descriptor must be a valid identifier")
		}
	}

	if meta := n.tracker.GetLocalBySessionIDStreamUserID(sid, stream, uid); meta != nil {
		return meta, nil
	}
	return nil, nil
}

func (n *RuntimeGoNakamaModule) StreamUserJoin(mode uint8, subject, descriptor, label, userID, sessionID string, hidden, persistence bool, status string) (bool, error) {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return false, errors.New("stream descriptor must be a valid identifier")
		}
	}

	// Look up the session.
	session := n.sessionRegistry.Get(sid)
	if session == nil {
		return false, errors.New("session id does not exist")
	}

	success, newlyTracked := n.tracker.Track(sid, stream, uid, PresenceMeta{
		Format:      session.Format(),
		Hidden:      hidden,
		Persistence: persistence,
		Username:    session.Username(),
		Status:      status,
	}, false)
	if !success {
		return false, errors.New("tracker rejected new presence, session is closing")
	}

	return newlyTracked, nil
}

func (n *RuntimeGoNakamaModule) StreamUserUpdate(mode uint8, subject, descriptor, label, userID, sessionID string, hidden, persistence bool, status string) error {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return errors.New("stream descriptor must be a valid identifier")
		}
	}

	// Look up the session.
	session := n.sessionRegistry.Get(sid)
	if session == nil {
		return errors.New("session id does not exist")
	}

	if !n.tracker.Update(sid, stream, uid, PresenceMeta{
		Format:      session.Format(),
		Hidden:      hidden,
		Persistence: persistence,
		Username:    session.Username(),
		Status:      status,
	}, false) {
		return errors.New("tracker rejected updated presence, session is closing")
	}

	return nil
}

func (n *RuntimeGoNakamaModule) StreamUserLeave(mode uint8, subject, descriptor, label, userID, sessionID string) error {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return errors.New("stream descriptor must be a valid identifier")
		}
	}

	n.tracker.Untrack(sid, stream, uid)

	return nil
}

func (n *RuntimeGoNakamaModule) StreamCount(mode uint8, subject, descriptor, label string) (int, error) {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return 0, errors.New("stream descriptor must be a valid identifier")
		}
	}

	return n.tracker.CountByStream(stream), nil
}

func (n *RuntimeGoNakamaModule) StreamClose(mode uint8, subject, descriptor, label string) error {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return errors.New("stream descriptor must be a valid identifier")
		}
	}

	n.tracker.UntrackByStream(stream)

	return nil
}

func (n *RuntimeGoNakamaModule) StreamSend(mode uint8, subject, descriptor, label, data string) error {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return errors.New("stream descriptor must be a valid identifier")
		}
	}

	streamWire := &rtapi.Stream{
		Mode:  int32(stream.Mode),
		Label: stream.Label,
	}
	if stream.Subject != uuid.Nil {
		streamWire.Subject = stream.Subject.String()
	}
	if stream.Descriptor != uuid.Nil {
		streamWire.Descriptor_ = stream.Descriptor.String()
	}
	msg := &rtapi.Envelope{Message: &rtapi.Envelope_StreamData{StreamData: &rtapi.StreamData{
		Stream: streamWire,
		// No sender.
		Data: data,
	}}}
	n.router.SendToStream(n.logger, stream, msg)

	return nil
}

func (n *RuntimeGoNakamaModule) StreamSendRaw(mode uint8, subject, descriptor, label string, msg *rtapi.Envelope) error {
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
	if descriptor != "" {
		stream.Descriptor, err = uuid.FromString(descriptor)
		if err != nil {
			return errors.New("stream descriptor must be a valid identifier")
		}
	}
	if msg == nil {
		return errors.New("expects a valid message")
	}

	n.router.SendToStream(n.logger, stream, msg)

	return nil
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

func (n *RuntimeGoNakamaModule) MatchList(ctx context.Context, limit int, authoritative bool, label string, minSize, maxSize int, query string) ([]*api.Match, error) {
	authoritativeWrapper := &wrappers.BoolValue{Value: authoritative}
	var labelWrapper *wrappers.StringValue
	if label != "" {
		labelWrapper = &wrappers.StringValue{Value: label}
	}
	var queryWrapper *wrappers.StringValue
	if query != "" {
		queryWrapper = &wrappers.StringValue{Value: query}
	}
	minSizeWrapper := &wrappers.Int32Value{Value: int32(minSize)}
	maxSizeWrapper := &wrappers.Int32Value{Value: int32(maxSize)}

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
		return errors.Errorf("failed to convert content: %s", err.Error())
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
		CreateTime: &timestamp.Timestamp{Seconds: time.Now().UTC().Unix()},
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
			return errors.Errorf("failed to convert content: %s", err.Error())
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
			no = make([]*api.Notification, 0)
		}
		no = append(no, &api.Notification{
			Id:         uuid.Must(uuid.NewV4()).String(),
			Subject:    notification.Subject,
			Content:    contentString,
			Code:       int32(notification.Code),
			SenderId:   senderID,
			Persistent: notification.Persistent,
			CreateTime: &timestamp.Timestamp{Seconds: time.Now().UTC().Unix()},
		})
		ns[uid] = no
	}

	return NotificationSend(ctx, n.logger, n.db, n.router, ns)
}

func (n *RuntimeGoNakamaModule) WalletUpdate(ctx context.Context, userID string, changeset, metadata map[string]interface{}, updateLedger bool) error {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return errors.New("expects a valid user id")
	}

	metadataBytes := []byte("{}")
	if metadata != nil {
		metadataBytes, err = json.Marshal(metadata)
		if err != nil {
			return errors.Errorf("failed to convert metadata: %s", err.Error())
		}
	}

	return UpdateWallets(ctx, n.logger, n.db, []*walletUpdate{&walletUpdate{
		UserID:    uid,
		Changeset: changeset,
		Metadata:  string(metadataBytes),
	}}, updateLedger)
}

func (n *RuntimeGoNakamaModule) WalletsUpdate(ctx context.Context, updates []*runtime.WalletUpdate, updateLedger bool) error {
	size := len(updates)
	if size == 0 {
		return nil
	}

	walletUpdates := make([]*walletUpdate, size)

	for i, update := range updates {
		uid, err := uuid.FromString(update.UserID)
		if err != nil {
			return errors.New("expects a valid user id")
		}

		metadataBytes := []byte("{}")
		if update.Metadata != nil {
			metadataBytes, err = json.Marshal(update.Metadata)
			if err != nil {
				return errors.Errorf("failed to convert metadata: %s", err.Error())
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
		return nil, errors.Errorf("failed to convert metadata: %s", err.Error())
	}

	return UpdateWalletLedger(ctx, n.logger, n.db, id, string(metadataBytes))
}

func (n *RuntimeGoNakamaModule) WalletLedgerList(ctx context.Context, userID string) ([]runtime.WalletLedgerItem, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("expects a valid user id")
	}

	items, err := ListWalletLedger(ctx, n.logger, n.db, uid)
	if err != nil {
		return nil, err
	}

	runtimeItems := make([]runtime.WalletLedgerItem, len(items))
	for i, item := range items {
		runtimeItems[i] = runtime.WalletLedgerItem(item)
	}
	return runtimeItems, nil
}

func (n *RuntimeGoNakamaModule) StorageList(ctx context.Context, userID, collection string, limit int, cursor string) ([]*api.StorageObject, string, error) {
	uid := uuid.Nil
	var err error
	if userID != "" {
		uid, err = uuid.FromString(userID)
		if err != nil {
			return nil, "", errors.New("expects an empty or valid user id")
		}
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

	data := make(map[uuid.UUID][]*api.WriteStorageObject)

	for _, write := range writes {
		if write.Collection == "" {
			return nil, errors.New("expects collection to be a non-empty string")
		}
		if write.Key == "" {
			return nil, errors.New("expects key to be a non-empty string")
		}
		uid := uuid.Nil
		var err error
		if write.UserID != "" {
			uid, err = uuid.FromString(write.UserID)
			if err != nil {
				return nil, errors.New("expects an empty or valid user id")
			}
		}
		var valueMap map[string]interface{}
		err = json.Unmarshal([]byte(write.Value), &valueMap)
		if err != nil {
			return nil, errors.New("value must be a JSON-encoded object")
		}

		d := &api.WriteStorageObject{
			Collection:      write.Collection,
			Key:             write.Key,
			Value:           write.Value,
			Version:         write.Version,
			PermissionRead:  &wrappers.Int32Value{Value: int32(write.PermissionRead)},
			PermissionWrite: &wrappers.Int32Value{Value: int32(write.PermissionWrite)},
		}

		if objects, ok := data[uid]; !ok {
			data[uid] = []*api.WriteStorageObject{d}
		} else {
			data[uid] = append(objects, d)
		}
	}

	acks, _, err := StorageWriteObjects(ctx, n.logger, n.db, true, data)
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

	objectIDs := make(map[uuid.UUID][]*api.DeleteStorageObjectId)

	for _, del := range deletes {
		if del.Collection == "" {
			return errors.New("expects collection to be a non-empty string")
		}
		if del.Key == "" {
			return errors.New("expects key to be a non-empty string")
		}
		uid := uuid.Nil
		var err error
		if del.UserID != "" {
			uid, err = uuid.FromString(del.UserID)
			if err != nil {
				return errors.New("expects an empty or valid user id")
			}
		}

		objectID := &api.DeleteStorageObjectId{
			Collection: del.Collection,
			Key:        del.Key,
			Version:    del.Version,
		}

		if objects, ok := objectIDs[uid]; !ok {
			objectIDs[uid] = []*api.DeleteStorageObjectId{objectID}
		} else {
			objectIDs[uid] = append(objects, objectID)
		}
	}

	_, err := StorageDeleteObjects(ctx, n.logger, n.db, true, objectIDs)

	return err
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
	default:
		return errors.New("expects sort order to be 'best', 'set', or 'incr'")
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
			return errors.Errorf("error encoding metadata: %v", err.Error())
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

func (n *RuntimeGoNakamaModule) LeaderboardRecordsList(ctx context.Context, id string, ownerIDs []string, limit int, cursor string, expiry int64) ([]*api.LeaderboardRecord, []*api.LeaderboardRecord, string, string, error) {
	if id == "" {
		return nil, nil, "", "", errors.New("expects a leaderboard ID string")
	}

	for _, o := range ownerIDs {
		if _, err := uuid.FromString(o); err != nil {
			return nil, nil, "", "", errors.New("expects each owner ID to be a valid identifier")
		}
	}

	var limitWrapper *wrappers.Int32Value
	if limit < 0 || limit > 10000 {
		return nil, nil, "", "", errors.New("expects limit to be 0-10000")
	} else {
		limitWrapper = &wrappers.Int32Value{Value: int32(limit)}
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

func (n *RuntimeGoNakamaModule) LeaderboardRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}) (*api.LeaderboardRecord, error) {
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
			return nil, errors.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataStr = string(metadataBytes)
	}

	return LeaderboardRecordWrite(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, uuid.Nil, id, ownerID, username, score, subscore, metadataStr)
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
	default:
		return errors.New("expects sort order to be 'best', 'set', or 'incr'")
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
			return errors.Errorf("error encoding metadata: %v", err.Error())
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
	if endTime < startTime {
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

	return TournamentDelete(ctx, n.logger, n.leaderboardCache, n.leaderboardRankCache, n.leaderboardScheduler, id)
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

	var cursorPtr *tournamentListCursor
	if cursor != "" {
		if cb, err := base64.StdEncoding.DecodeString(cursor); err != nil {
			return nil, errors.New("expects cursor to be valid when provided")
		} else {
			cursorPtr = &tournamentListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursorPtr); err != nil {
				return nil, errors.New("expects cursor to be valid when provided")
			}
		}
	}

	return TournamentList(ctx, n.logger, n.db, categoryStart, categoryEnd, startTime, endTime, limit, cursorPtr)
}

func (n *RuntimeGoNakamaModule) TournamentRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}) (*api.LeaderboardRecord, error) {
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
			return nil, errors.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataStr = string(metadataBytes)
	}

	return TournamentRecordWrite(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, id, owner, username, score, subscore, metadataStr)
}

func (n *RuntimeGoNakamaModule) TournamentRecordsHaystack(ctx context.Context, id, ownerID string, limit int) ([]*api.LeaderboardRecord, error) {
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

	return TournamentRecordsHaystack(ctx, n.logger, n.db, n.leaderboardCache, n.leaderboardRankCache, id, owner, limit)
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

	groups, err := GetGroups(ctx, n.logger, n.db, groupIDs)
	if err != nil {
		return nil, err
	}

	return groups, nil
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
			return nil, errors.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataStr = string(metadataBytes)
	}

	if maxCount < 0 || maxCount > 100 {
		return nil, errors.New("expects max_count to be > 0 and <= 100")
	}

	return CreateGroup(ctx, n.logger, n.db, uid, cid, name, langTag, description, avatarUrl, metadataStr, open, maxCount)
}

func (n *RuntimeGoNakamaModule) GroupUpdate(ctx context.Context, id, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) error {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	var nameWrapper *wrappers.StringValue
	if name != "" {
		nameWrapper = &wrappers.StringValue{Value: name}
	}

	var creatorIDByte []byte
	if creatorID != "" {
		cuid, err := uuid.FromString(creatorID)
		if err != nil {
			return errors.New("expects creator ID to be a valid identifier")
		}
		creatorIDByte = cuid.Bytes()
	}

	var langTagWrapper *wrappers.StringValue
	if langTag != "" {
		langTagWrapper = &wrappers.StringValue{Value: langTag}
	}

	var descriptionWrapper *wrappers.StringValue
	if description != "" {
		descriptionWrapper = &wrappers.StringValue{Value: description}
	}

	var avatarUrlWrapper *wrappers.StringValue
	if avatarUrl != "" {
		avatarUrlWrapper = &wrappers.StringValue{Value: avatarUrl}
	}

	openWrapper := &wrappers.BoolValue{Value: open}

	var metadataWrapper *wrappers.StringValue
	if metadata != nil {
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			return errors.Errorf("error encoding metadata: %v", err.Error())
		}
		metadataWrapper = &wrappers.StringValue{Value: string(metadataBytes)}
	}

	maxCountValue := 0
	if maxCount > 0 && maxCount <= 100 {
		maxCountValue = maxCount
	}

	return UpdateGroup(ctx, n.logger, n.db, groupID, uuid.Nil, creatorIDByte, nameWrapper, langTagWrapper, descriptionWrapper, avatarUrlWrapper, metadataWrapper, openWrapper, maxCountValue)
}

func (n *RuntimeGoNakamaModule) GroupDelete(ctx context.Context, id string) error {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return errors.New("expects group ID to be a valid identifier")
	}

	return DeleteGroup(ctx, n.logger, n.db, groupID, uuid.Nil)
}

func (n *RuntimeGoNakamaModule) GroupUsersList(ctx context.Context, id string) ([]*api.GroupUserList_GroupUser, error) {
	groupID, err := uuid.FromString(id)
	if err != nil {
		return nil, errors.New("expects group ID to be a valid identifier")
	}

	users, err := ListGroupUsers(ctx, n.logger, n.db, n.tracker, groupID)
	if err != nil {
		return nil, err
	}

	return users.GroupUsers, nil
}

func (n *RuntimeGoNakamaModule) UserGroupsList(ctx context.Context, userID string) ([]*api.UserGroupList_UserGroup, error) {
	uid, err := uuid.FromString(userID)
	if err != nil {
		return nil, errors.New("expects user ID to be a valid identifier")
	}

	groups, err := ListUserGroups(ctx, n.logger, n.db, uid)
	if err != nil {
		return nil, err
	}

	return groups.UserGroups, nil
}

func (n *RuntimeGoNakamaModule) SetMatchCreateFn(fn RuntimeMatchCreateFunction) {
	n.Lock()
	n.matchCreateFn = fn
	n.Unlock()
}
