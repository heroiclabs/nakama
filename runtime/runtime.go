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

package runtime

import (
	"context"
	"database/sql"
	"log"

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
)

const (
	RUNTIME_CTX_ENV              = "env"
	RUNTIME_CTX_MODE             = "execution_mode"
	RUNTIME_CTX_QUERY_PARAMS     = "query_params"
	RUNTIME_CTX_USER_ID          = "user_id"
	RUNTIME_CTX_USERNAME         = "username"
	RUNTIME_CTX_USER_SESSION_EXP = "user_session_exp"
	RUNTIME_CTX_SESSION_ID       = "session_id"
	RUNTIME_CTX_CLIENT_IP        = "client_ip"
	RUNTIME_CTX_CLIENT_PORT      = "client_port"
	RUNTIME_CTX_MATCH_ID         = "match_id"
	RUNTIME_CTX_MATCH_NODE       = "match_node"
	RUNTIME_CTX_MATCH_LABEL      = "match_label"
	RUNTIME_CTX_MATCH_TICK_RATE  = "match_tick_rate"
)

type Initializer interface {
	RegisterRpc(id string, fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, payload string) (string, error, int)) error

	RegisterBeforeRt(id string, fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, envelope *rtapi.Envelope) (*rtapi.Envelope, error)) error
	RegisterAfterRt(id string, fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, envelope *rtapi.Envelope) error) error

	RegisterBeforeGetAccount(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *empty.Empty) (*empty.Empty, error, int)) error
	RegisterAfterGetAccount(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Account) error) error
	RegisterBeforeUpdateAccount(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, int)) error
	RegisterAfterUpdateAccount(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeAuthenticateCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error, int)) error
	RegisterAfterAuthenticateCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Session) error) error
	RegisterBeforeAuthenticateDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error, int)) error
	RegisterAfterAuthenticateDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Session) error) error
	RegisterBeforeAuthenticateEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error, int)) error
	RegisterAfterAuthenticateEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Session) error) error
	RegisterBeforeAuthenticateFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error, int)) error
	RegisterAfterAuthenticateFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Session) error) error
	RegisterBeforeAuthenticateGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error, int)) error
	RegisterAfterAuthenticateGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Session) error) error
	RegisterBeforeAuthenticateGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error, int)) error
	RegisterAfterAuthenticateGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Session) error) error
	RegisterBeforeAuthenticateSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error, int)) error
	RegisterAfterAuthenticateSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Session) error) error
	RegisterBeforeListChannelMessages(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error, int)) error
	RegisterAfterListChannelMessages(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.ChannelMessageList) error) error
	RegisterBeforeListFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *empty.Empty) (*empty.Empty, error, int)) error
	RegisterAfterListFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Friends) error) error
	RegisterBeforeAddFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, int)) error
	RegisterAfterAddFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeDeleteFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, int)) error
	RegisterAfterDeleteFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeBlockFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, int)) error
	RegisterAfterBlockFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeImportFacebookFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, int)) error
	RegisterAfterImportFacebookFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeCreateGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error, int)) error
	RegisterAfterCreateGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Group) error) error
	RegisterBeforeUpdateGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error, int)) error
	RegisterAfterUpdateGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeDeleteGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error, int)) error
	RegisterAfterDeleteGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeJoinGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error, int)) error
	RegisterAfterJoinGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeLeaveGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error, int)) error
	RegisterAfterLeaveGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeAddGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error, int)) error
	RegisterAfterAddGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeKickGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error, int)) error
	RegisterAfterKickGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforePromoteGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error, int)) error
	RegisterAfterPromoteGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeListGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, int)) error
	RegisterAfterListGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.GroupUserList) error) error
	RegisterBeforeListUserGroups(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, int)) error
	RegisterAfterListUserGroups(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.UserGroupList) error) error
	RegisterBeforeListGroups(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, int)) error
	RegisterAfterListGroups(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.GroupList) error) error
	RegisterBeforeDeleteLeaderboardRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, int)) error
	RegisterAfterDeleteLeaderboardRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeListLeaderboardRecords(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, int)) error
	RegisterAfterListLeaderboardRecords(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.LeaderboardRecordList) error) error
	RegisterBeforeWriteLeaderboardRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, int)) error
	RegisterAfterWriteLeaderboardRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.LeaderboardRecord) error) error
	RegisterBeforeListLeaderboardRecordsAroundOwner(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, int)) error
	RegisterAfterListLeaderboardRecordsAroundOwner(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.LeaderboardRecordList) error) error
	RegisterBeforeLinkCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountCustom) (*api.AccountCustom, error, int)) error
	RegisterAfterLinkCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeLinkDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountDevice) (*api.AccountDevice, error, int)) error
	RegisterAfterLinkDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeLinkEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountEmail) (*api.AccountEmail, error, int)) error
	RegisterAfterLinkEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeLinkFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error, int)) error
	RegisterAfterLinkFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeLinkGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error, int)) error
	RegisterAfterLinkGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeLinkGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error, int)) error
	RegisterAfterLinkGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeLinkSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountSteam) (*api.AccountSteam, error, int)) error
	RegisterAfterLinkSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeListMatches(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, int)) error
	RegisterAfterListMatches(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.MatchList) error) error
	RegisterBeforeListNotifications(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, int)) error
	RegisterAfterListNotifications(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.NotificationList) error) error
	RegisterBeforeDeleteNotification(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, int)) error
	RegisterAfterDeleteNotification(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeListStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error, int)) error
	RegisterAfterListStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.StorageObjectList) error) error
	RegisterBeforeReadStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error, int)) error
	RegisterAfterReadStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.StorageObjects) error) error
	RegisterBeforeWriteStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error, int)) error
	RegisterAfterWriteStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.StorageObjectAcks) error) error
	RegisterBeforeDeleteStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error, int)) error
	RegisterAfterDeleteStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeJoinTournament(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error, int)) error
	RegisterAfterJoinTournament(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeListTournamentRecords(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error, int)) error
	RegisterAfterListTournamentRecords(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.TournamentRecordList) error) error
	RegisterBeforeListTournaments(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error, int)) error
	RegisterAfterListTournaments(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.TournamentList) error) error
	RegisterBeforeWriteTournamentRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error, int)) error
	RegisterAfterWriteTournamentRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.LeaderboardRecord) error) error
	RegisterBeforeListTournamentRecordsAroundOwner(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error, int)) error
	RegisterAfterListTournamentRecordsAroundOwner(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.TournamentRecordList) error) error
	RegisterBeforeUnlinkCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountCustom) (*api.AccountCustom, error, int)) error
	RegisterAfterUnlinkCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeUnlinkDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountDevice) (*api.AccountDevice, error, int)) error
	RegisterAfterUnlinkDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeUnlinkEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountEmail) (*api.AccountEmail, error, int)) error
	RegisterAfterUnlinkEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeUnlinkFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountFacebook) (*api.AccountFacebook, error, int)) error
	RegisterAfterUnlinkFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeUnlinkGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error, int)) error
	RegisterAfterUnlinkGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeUnlinkGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error, int)) error
	RegisterAfterUnlinkGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeUnlinkSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AccountSteam) (*api.AccountSteam, error, int)) error
	RegisterAfterUnlinkSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *empty.Empty) error) error
	RegisterBeforeGetUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.GetUsersRequest) (*api.GetUsersRequest, error, int)) error
	RegisterAfterGetUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Users) error) error

	RegisterMatchmakerMatched(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, entries []MatchmakerEntry) (string, error)) error

	RegisterMatch(name string, fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule) (Match, error)) error

	RegisterTournamentEnd(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, tournament *api.Tournament, end, reset int64) error) error
	RegisterTournamentReset(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, tournament *api.Tournament, end, reset int64) error) error

	RegisterLeaderboardReset(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, leaderboard Leaderboard, reset int64) error) error
}

type Leaderboard interface {
	GetId() string
	GetAuthoritative() bool
	GetSortOrder() string
	GetOperator() string
	GetReset() string
	GetMetadata() map[string]interface{}
	GetCreateTime() int64
}

type PresenceMeta interface {
	GetHidden() bool
	GetPersistence() bool
	GetUsername() string
	GetStatus() string
}

type Presence interface {
	PresenceMeta
	GetUserId() string
	GetSessionId() string
	GetNodeId() string
}

type MatchmakerEntry interface {
	GetPresence() Presence
	GetTicket() string
	GetProperties() map[string]interface{}
}

type MatchData interface {
	Presence
	GetOpCode() int64
	GetData() []byte
	GetReceiveTime() int64
}

type MatchDispatcher interface {
	BroadcastMessage(opCode int64, data []byte, presences []Presence, sender Presence) error
	MatchKick(presences []Presence) error
	MatchLabelUpdate(label string) error
}

type Match interface {
	MatchInit(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, params map[string]interface{}) (interface{}, int, string)
	MatchJoinAttempt(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, presence Presence) (interface{}, bool, string)
	MatchJoin(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, presences []Presence) interface{}
	MatchLeave(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, presences []Presence) interface{}
	MatchLoop(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, messages []MatchData) interface{}
}

type NotificationSend struct {
	UserID     string
	Subject    string
	Content    map[string]interface{}
	Code       int
	Sender     string
	Persistent bool
}

type WalletUpdate struct {
	UserID    string
	Changeset map[string]interface{}
	Metadata  map[string]interface{}
}

type WalletLedgerItem interface {
	GetID() string
	GetUserID() string
	GetCreateTime() int64
	GetUpdateTime() int64
	GetChangeset() map[string]interface{}
	GetMetadata() map[string]interface{}
}

type StorageRead struct {
	Collection string
	Key        string
	UserID     string
}

type StorageWrite struct {
	Collection      string
	Key             string
	UserID          string
	Value           string
	Version         string
	PermissionRead  int
	PermissionWrite int
}

type StorageDelete struct {
	Collection string
	Key        string
	UserID     string
	Version    string
}

type NakamaModule interface {
	AuthenticateCustom(id, username string, create bool) (string, string, bool, error)
	AuthenticateDevice(id, username string, create bool) (string, string, bool, error)
	AuthenticateEmail(email, password, username string, create bool) (string, string, bool, error)
	AuthenticateFacebook(token string, importFriends bool, username string, create bool) (string, string, bool, error)
	AuthenticateGameCenter(playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl, username string, create bool) (string, string, bool, error)
	AuthenticateGoogle(token, username string, create bool) (string, string, bool, error)
	AuthenticateSteam(token, username string, create bool) (string, string, bool, error)

	AuthenticateTokenGenerate(userID, username string, exp int64) (string, int64, error)

	AccountGetId(userID string) (*api.Account, error)
	// TODO nullable fields?
	AccountUpdateId(userID, username string, metadata map[string]interface{}, displayName, timezone, location, langTag, avatarUrl string) error

	UsersGetId(userIDs []string) ([]*api.User, error)
	UsersGetUsername(usernames []string) ([]*api.User, error)
	UsersBanId(userIDs []string) error
	UsersUnbanId(userIDs []string) error

	StreamUserList(mode uint8, subject, descriptor, label string, includeHidden, includeNotHidden bool) ([]Presence, error)
	StreamUserGet(mode uint8, subject, descriptor, label, userID, sessionID string) (PresenceMeta, error)
	StreamUserJoin(mode uint8, subject, descriptor, label, userID, sessionID string, hidden, persistence bool, status string) (bool, error)
	StreamUserUpdate(mode uint8, subject, descriptor, label, userID, sessionID string, hidden, persistence bool, status string) error
	StreamUserLeave(mode uint8, subject, descriptor, label, userID, sessionID string) error
	StreamCount(mode uint8, subject, descriptor, label string) (int, error)
	StreamClose(mode uint8, subject, descriptor, label string) error
	StreamSend(mode uint8, subject, descriptor, label, data string) error

	MatchCreate(module string, params map[string]interface{}) (string, error)
	MatchList(limit int, authoritative bool, label string, minSize, maxSize int) []*api.Match

	NotificationSend(userID, subject string, content map[string]interface{}, code int, sender string, persistent bool) error
	NotificationsSend(notifications []*NotificationSend) error

	WalletUpdate(userID string, changeset, metadata map[string]interface{}) error
	WalletsUpdate(updates []*WalletUpdate) error
	WalletLedgerUpdate(itemID string, metadata map[string]interface{}) (WalletLedgerItem, error)
	WalletLedgerList(userID string) ([]WalletLedgerItem, error)

	StorageList(userID, collection string, limit int, cursor string) ([]*api.StorageObject, string, error)
	StorageRead(reads []*StorageRead) ([]*api.StorageObject, error)
	StorageWrite(writes []*StorageWrite) ([]*api.StorageObjectAck, error)
	StorageDelete(deletes []*StorageDelete) error

	LeaderboardCreate(id string, authoritative bool, sortOrder, operator, resetSchedule string, metadata map[string]interface{}) error
	LeaderboardDelete(id string) error
	LeaderboardRecordsList(id string, ownerIDs []string, limit int, cursor string, expiry int64) ([]*api.LeaderboardRecord, []*api.LeaderboardRecord, string, string, error)
	LeaderboardRecordWrite(id, ownerID, username string, score, subscore int64, metadata map[string]interface{}) (*api.LeaderboardRecord, error)
	LeaderboardRecordDelete(id, ownerID string) error

	TournamentCreate(id string, sortOrder, operator, resetSchedule string, metadata map[string]interface{}, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error
	TournamentDelete(id string) error
	TournamentAddAttempt(id, ownerID string, count int) error
	TournamentJoin(id, ownerID, username string) error
	TournamentList(categoryStart, categoryEnd, startTime, endTime, limit int, cursor string) (*api.TournamentList, error)
	TournamentRecordWrite(id, ownerID, username string, score, subscore int64, metadata map[string]interface{}) (*api.LeaderboardRecord, error)
	TournamentRecordsHaystack(id, ownerID string, limit int) ([]*api.LeaderboardRecord, error)

	GroupCreate(userID, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) (*api.Group, error)
	GroupUpdate(id, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) error
	GroupDelete(id string) error
	GroupUsersList(id string) ([]*api.GroupUserList_GroupUser, error)
	UserGroupsList(userID string) ([]*api.UserGroupList_UserGroup, error)
}
