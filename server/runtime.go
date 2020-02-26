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
	"context"
	"database/sql"
	"go.uber.org/atomic"
	"os"
	"path/filepath"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama/v2/social"
	"github.com/pkg/errors"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
)

var (
	ErrRuntimeRPCNotFound = errors.New("RPC function not found")
)

const API_PREFIX = "/nakama.api.Nakama/"
const RTAPI_PREFIX = "*rtapi.Envelope_"

type (
	RuntimeRpcFunction func(ctx context.Context, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, payload string) (string, error, codes.Code)

	RuntimeBeforeRtFunction func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) (*rtapi.Envelope, error)
	RuntimeAfterRtFunction  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) error

	RuntimeBeforeGetAccountFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code)
	RuntimeAfterGetAccountFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Account) error
	RuntimeBeforeUpdateAccountFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, codes.Code)
	RuntimeAfterUpdateAccountFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) error
	RuntimeBeforeAuthenticateCustomFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error, codes.Code)
	RuntimeAfterAuthenticateCustomFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateCustomRequest) error
	RuntimeBeforeAuthenticateDeviceFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error, codes.Code)
	RuntimeAfterAuthenticateDeviceFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateDeviceRequest) error
	RuntimeBeforeAuthenticateEmailFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error, codes.Code)
	RuntimeAfterAuthenticateEmailFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateEmailRequest) error
	RuntimeBeforeAuthenticateFacebookFunction              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error, codes.Code)
	RuntimeAfterAuthenticateFacebookFunction               func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateFacebookRequest) error
	RuntimeBeforeAuthenticateFacebookInstantGameFunction   func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookInstantGameRequest) (*api.AuthenticateFacebookInstantGameRequest, error, codes.Code)
	RuntimeAfterAuthenticateFacebookInstantGameFunction    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateFacebookInstantGameRequest) error
	RuntimeBeforeAuthenticateGameCenterFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error, codes.Code)
	RuntimeAfterAuthenticateGameCenterFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateGameCenterRequest) error
	RuntimeBeforeAuthenticateGoogleFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error, codes.Code)
	RuntimeAfterAuthenticateGoogleFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateGoogleRequest) error
	RuntimeBeforeAuthenticateSteamFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error, codes.Code)
	RuntimeAfterAuthenticateSteamFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateSteamRequest) error
	RuntimeBeforeListChannelMessagesFunction               func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error, codes.Code)
	RuntimeAfterListChannelMessagesFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ChannelMessageList, in *api.ListChannelMessagesRequest) error
	RuntimeBeforeListFriendsFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListFriendsRequest) (*api.ListFriendsRequest, error, codes.Code)
	RuntimeAfterListFriendsFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.FriendList) error
	RuntimeBeforeAddFriendsFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, codes.Code)
	RuntimeAfterAddFriendsFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) error
	RuntimeBeforeDeleteFriendsFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, codes.Code)
	RuntimeAfterDeleteFriendsFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) error
	RuntimeBeforeBlockFriendsFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, codes.Code)
	RuntimeAfterBlockFriendsFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) error
	RuntimeBeforeImportFacebookFriendsFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, codes.Code)
	RuntimeAfterImportFacebookFriendsFunction              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) error
	RuntimeBeforeCreateGroupFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error, codes.Code)
	RuntimeAfterCreateGroupFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Group, in *api.CreateGroupRequest) error
	RuntimeBeforeUpdateGroupFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error, codes.Code)
	RuntimeAfterUpdateGroupFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) error
	RuntimeBeforeDeleteGroupFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error, codes.Code)
	RuntimeAfterDeleteGroupFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) error
	RuntimeBeforeJoinGroupFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error, codes.Code)
	RuntimeAfterJoinGroupFunction                          func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) error
	RuntimeBeforeLeaveGroupFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error, codes.Code)
	RuntimeAfterLeaveGroupFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) error
	RuntimeBeforeAddGroupUsersFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error, codes.Code)
	RuntimeAfterAddGroupUsersFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) error
	RuntimeBeforeBanGroupUsersFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BanGroupUsersRequest) (*api.BanGroupUsersRequest, error, codes.Code)
	RuntimeAfterBanGroupUsersFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BanGroupUsersRequest) error
	RuntimeBeforeKickGroupUsersFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error, codes.Code)
	RuntimeAfterKickGroupUsersFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) error
	RuntimeBeforePromoteGroupUsersFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error, codes.Code)
	RuntimeAfterPromoteGroupUsersFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) error
	RuntimeBeforeListGroupUsersFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, codes.Code)
	RuntimeAfterListGroupUsersFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupUserList, in *api.ListGroupUsersRequest) error
	RuntimeBeforeListUserGroupsFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, codes.Code)
	RuntimeAfterListUserGroupsFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.UserGroupList, in *api.ListUserGroupsRequest) error
	RuntimeBeforeListGroupsFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, codes.Code)
	RuntimeAfterListGroupsFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupList, in *api.ListGroupsRequest) error
	RuntimeBeforeDeleteLeaderboardRecordFunction           func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, codes.Code)
	RuntimeAfterDeleteLeaderboardRecordFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) error
	RuntimeBeforeListLeaderboardRecordsFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, codes.Code)
	RuntimeAfterListLeaderboardRecordsFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsRequest) error
	RuntimeBeforeWriteLeaderboardRecordFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, codes.Code)
	RuntimeAfterWriteLeaderboardRecordFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteLeaderboardRecordRequest) error
	RuntimeBeforeListLeaderboardRecordsAroundOwnerFunction func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, codes.Code)
	RuntimeAfterListLeaderboardRecordsAroundOwnerFunction  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsAroundOwnerRequest) error
	RuntimeBeforeLinkCustomFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code)
	RuntimeAfterLinkCustomFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) error
	RuntimeBeforeLinkDeviceFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code)
	RuntimeAfterLinkDeviceFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) error
	RuntimeBeforeLinkEmailFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code)
	RuntimeAfterLinkEmailFunction                          func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) error
	RuntimeBeforeLinkFacebookFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error, codes.Code)
	RuntimeAfterLinkFacebookFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) error
	RuntimeBeforeLinkFacebookInstantGameFunction           func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error, codes.Code)
	RuntimeAfterLinkFacebookInstantGameFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) error
	RuntimeBeforeLinkGameCenterFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code)
	RuntimeAfterLinkGameCenterFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) error
	RuntimeBeforeLinkGoogleFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code)
	RuntimeAfterLinkGoogleFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) error
	RuntimeBeforeLinkSteamFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code)
	RuntimeAfterLinkSteamFunction                          func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) error
	RuntimeBeforeListMatchesFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, codes.Code)
	RuntimeAfterListMatchesFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.MatchList, in *api.ListMatchesRequest) error
	RuntimeBeforeListNotificationsFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, codes.Code)
	RuntimeAfterListNotificationsFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.NotificationList, in *api.ListNotificationsRequest) error
	RuntimeBeforeDeleteNotificationFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, codes.Code)
	RuntimeAfterDeleteNotificationFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) error
	RuntimeBeforeListStorageObjectsFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error, codes.Code)
	RuntimeAfterListStorageObjectsFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjectList, in *api.ListStorageObjectsRequest) error
	RuntimeBeforeReadStorageObjectsFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error, codes.Code)
	RuntimeAfterReadStorageObjectsFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjects, in *api.ReadStorageObjectsRequest) error
	RuntimeBeforeWriteStorageObjectsFunction               func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error, codes.Code)
	RuntimeAfterWriteStorageObjectsFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjectAcks, in *api.WriteStorageObjectsRequest) error
	RuntimeBeforeDeleteStorageObjectsFunction              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error, codes.Code)
	RuntimeAfterDeleteStorageObjectsFunction               func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) error
	RuntimeBeforeJoinTournamentFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error, codes.Code)
	RuntimeAfterJoinTournamentFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) error
	RuntimeBeforeListTournamentRecordsFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error, codes.Code)
	RuntimeAfterListTournamentRecordsFunction              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList, in *api.ListTournamentRecordsRequest) error
	RuntimeBeforeListTournamentsFunction                   func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error, codes.Code)
	RuntimeAfterListTournamentsFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentList, in *api.ListTournamentsRequest) error
	RuntimeBeforeWriteTournamentRecordFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error, codes.Code)
	RuntimeAfterWriteTournamentRecordFunction              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteTournamentRecordRequest) error
	RuntimeBeforeListTournamentRecordsAroundOwnerFunction  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error, codes.Code)
	RuntimeAfterListTournamentRecordsAroundOwnerFunction   func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList, in *api.ListTournamentRecordsAroundOwnerRequest) error
	RuntimeBeforeUnlinkCustomFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code)
	RuntimeAfterUnlinkCustomFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) error
	RuntimeBeforeUnlinkDeviceFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code)
	RuntimeAfterUnlinkDeviceFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) error
	RuntimeBeforeUnlinkEmailFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code)
	RuntimeAfterUnlinkEmailFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) error
	RuntimeBeforeUnlinkFacebookFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) (*api.AccountFacebook, error, codes.Code)
	RuntimeAfterUnlinkFacebookFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) error
	RuntimeBeforeUnlinkFacebookInstantGameFunction         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error, codes.Code)
	RuntimeAfterUnlinkFacebookInstantGameFunction          func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) error
	RuntimeBeforeUnlinkGameCenterFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code)
	RuntimeAfterUnlinkGameCenterFunction                   func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) error
	RuntimeBeforeUnlinkGoogleFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code)
	RuntimeAfterUnlinkGoogleFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) error
	RuntimeBeforeUnlinkSteamFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code)
	RuntimeAfterUnlinkSteamFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) error
	RuntimeBeforeGetUsersFunction                          func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.GetUsersRequest) (*api.GetUsersRequest, error, codes.Code)
	RuntimeAfterGetUsersFunction                           func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Users, in *api.GetUsersRequest) error
	RuntimeBeforeEventFunction                             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.Event) (*api.Event, error, codes.Code)
	RuntimeAfterEventFunction                              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.Event) error

	RuntimeMatchmakerMatchedFunction func(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error)

	RuntimeMatchCreateFunction       func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error)
	RuntimeMatchDeferMessageFunction func(msg *DeferredMessage) error

	RuntimeTournamentEndFunction   func(ctx context.Context, tournament *api.Tournament, end, reset int64) error
	RuntimeTournamentResetFunction func(ctx context.Context, tournament *api.Tournament, end, reset int64) error

	RuntimeLeaderboardResetFunction func(ctx context.Context, leaderboard runtime.Leaderboard, reset int64) error

	RuntimeEventFunction func(ctx context.Context, logger runtime.Logger, evt *api.Event)

	RuntimeEventCustomFunction       func(ctx context.Context, evt *api.Event)
	RuntimeEventSessionStartFunction func(userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, evtTimeSec int64)
	RuntimeEventSessionEndFunction   func(userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, evtTimeSec int64, reason string)
)

type RuntimeExecutionMode int

const (
	RuntimeExecutionModeEvent RuntimeExecutionMode = iota
	RuntimeExecutionModeRunOnce
	RuntimeExecutionModeRPC
	RuntimeExecutionModeBefore
	RuntimeExecutionModeAfter
	RuntimeExecutionModeMatch
	RuntimeExecutionModeMatchmaker
	RuntimeExecutionModeMatchCreate
	RuntimeExecutionModeTournamentEnd
	RuntimeExecutionModeTournamentReset
	RuntimeExecutionModeLeaderboardReset
)

func (e RuntimeExecutionMode) String() string {
	switch e {
	case RuntimeExecutionModeEvent:
		return "event"
	case RuntimeExecutionModeRunOnce:
		return "run_once"
	case RuntimeExecutionModeRPC:
		return "rpc"
	case RuntimeExecutionModeBefore:
		return "before"
	case RuntimeExecutionModeAfter:
		return "after"
	case RuntimeExecutionModeMatch:
		return "match"
	case RuntimeExecutionModeMatchmaker:
		return "matchmaker"
	case RuntimeExecutionModeMatchCreate:
		return "match_create"
	case RuntimeExecutionModeTournamentEnd:
		return "tournament_end"
	case RuntimeExecutionModeTournamentReset:
		return "tournament_reset"
	case RuntimeExecutionModeLeaderboardReset:
		return "leaderboard_reset"
	}

	return ""
}

type RuntimeMatchCore interface {
	MatchInit(presenceList *MatchPresenceList, deferMessageFn RuntimeMatchDeferMessageFunction, params map[string]interface{}) (interface{}, int, error)
	MatchJoinAttempt(tick int64, state interface{}, userID, sessionID uuid.UUID, username, node string, metadata map[string]string) (interface{}, bool, string, error)
	MatchJoin(tick int64, state interface{}, joins []*MatchPresence) (interface{}, error)
	MatchLeave(tick int64, state interface{}, leaves []*MatchPresence) (interface{}, error)
	MatchLoop(tick int64, state interface{}, inputCh <-chan *MatchDataMessage) (interface{}, error)
	MatchTerminate(tick int64, state interface{}, graceSeconds int) (interface{}, error)
	Label() string
	Cancel()
}

type RuntimeEventFunctions struct {
	sessionStartFunction RuntimeEventSessionStartFunction
	sessionEndFunction   RuntimeEventSessionEndFunction
	eventFunction        RuntimeEventCustomFunction
}

type RuntimeBeforeReqFunctions struct {
	beforeGetAccountFunction                        RuntimeBeforeGetAccountFunction
	beforeUpdateAccountFunction                     RuntimeBeforeUpdateAccountFunction
	beforeAuthenticateCustomFunction                RuntimeBeforeAuthenticateCustomFunction
	beforeAuthenticateDeviceFunction                RuntimeBeforeAuthenticateDeviceFunction
	beforeAuthenticateEmailFunction                 RuntimeBeforeAuthenticateEmailFunction
	beforeAuthenticateFacebookFunction              RuntimeBeforeAuthenticateFacebookFunction
	beforeAuthenticateFacebookInstantGameFunction   RuntimeBeforeAuthenticateFacebookInstantGameFunction
	beforeAuthenticateGameCenterFunction            RuntimeBeforeAuthenticateGameCenterFunction
	beforeAuthenticateGoogleFunction                RuntimeBeforeAuthenticateGoogleFunction
	beforeAuthenticateSteamFunction                 RuntimeBeforeAuthenticateSteamFunction
	beforeListChannelMessagesFunction               RuntimeBeforeListChannelMessagesFunction
	beforeListFriendsFunction                       RuntimeBeforeListFriendsFunction
	beforeAddFriendsFunction                        RuntimeBeforeAddFriendsFunction
	beforeDeleteFriendsFunction                     RuntimeBeforeDeleteFriendsFunction
	beforeBlockFriendsFunction                      RuntimeBeforeBlockFriendsFunction
	beforeImportFacebookFriendsFunction             RuntimeBeforeImportFacebookFriendsFunction
	beforeCreateGroupFunction                       RuntimeBeforeCreateGroupFunction
	beforeUpdateGroupFunction                       RuntimeBeforeUpdateGroupFunction
	beforeDeleteGroupFunction                       RuntimeBeforeDeleteGroupFunction
	beforeJoinGroupFunction                         RuntimeBeforeJoinGroupFunction
	beforeLeaveGroupFunction                        RuntimeBeforeLeaveGroupFunction
	beforeAddGroupUsersFunction                     RuntimeBeforeAddGroupUsersFunction
	beforeBanGroupUsersFunction                     RuntimeBeforeBanGroupUsersFunction
	beforeKickGroupUsersFunction                    RuntimeBeforeKickGroupUsersFunction
	beforePromoteGroupUsersFunction                 RuntimeBeforePromoteGroupUsersFunction
	beforeListGroupUsersFunction                    RuntimeBeforeListGroupUsersFunction
	beforeListUserGroupsFunction                    RuntimeBeforeListUserGroupsFunction
	beforeListGroupsFunction                        RuntimeBeforeListGroupsFunction
	beforeDeleteLeaderboardRecordFunction           RuntimeBeforeDeleteLeaderboardRecordFunction
	beforeListLeaderboardRecordsFunction            RuntimeBeforeListLeaderboardRecordsFunction
	beforeWriteLeaderboardRecordFunction            RuntimeBeforeWriteLeaderboardRecordFunction
	beforeListLeaderboardRecordsAroundOwnerFunction RuntimeBeforeListLeaderboardRecordsAroundOwnerFunction
	beforeLinkCustomFunction                        RuntimeBeforeLinkCustomFunction
	beforeLinkDeviceFunction                        RuntimeBeforeLinkDeviceFunction
	beforeLinkEmailFunction                         RuntimeBeforeLinkEmailFunction
	beforeLinkFacebookFunction                      RuntimeBeforeLinkFacebookFunction
	beforeLinkFacebookInstantGameFunction           RuntimeBeforeLinkFacebookInstantGameFunction
	beforeLinkGameCenterFunction                    RuntimeBeforeLinkGameCenterFunction
	beforeLinkGoogleFunction                        RuntimeBeforeLinkGoogleFunction
	beforeLinkSteamFunction                         RuntimeBeforeLinkSteamFunction
	beforeListMatchesFunction                       RuntimeBeforeListMatchesFunction
	beforeListNotificationsFunction                 RuntimeBeforeListNotificationsFunction
	beforeDeleteNotificationFunction                RuntimeBeforeDeleteNotificationFunction
	beforeListStorageObjectsFunction                RuntimeBeforeListStorageObjectsFunction
	beforeReadStorageObjectsFunction                RuntimeBeforeReadStorageObjectsFunction
	beforeWriteStorageObjectsFunction               RuntimeBeforeWriteStorageObjectsFunction
	beforeDeleteStorageObjectsFunction              RuntimeBeforeDeleteStorageObjectsFunction
	beforeJoinTournamentFunction                    RuntimeBeforeJoinTournamentFunction
	beforeListTournamentRecordsFunction             RuntimeBeforeListTournamentRecordsFunction
	beforeListTournamentsFunction                   RuntimeBeforeListTournamentsFunction
	beforeWriteTournamentRecordFunction             RuntimeBeforeWriteTournamentRecordFunction
	beforeListTournamentRecordsAroundOwnerFunction  RuntimeBeforeListTournamentRecordsAroundOwnerFunction
	beforeUnlinkCustomFunction                      RuntimeBeforeUnlinkCustomFunction
	beforeUnlinkDeviceFunction                      RuntimeBeforeUnlinkDeviceFunction
	beforeUnlinkEmailFunction                       RuntimeBeforeUnlinkEmailFunction
	beforeUnlinkFacebookFunction                    RuntimeBeforeUnlinkFacebookFunction
	beforeUnlinkFacebookInstantGameFunction         RuntimeBeforeUnlinkFacebookInstantGameFunction
	beforeUnlinkGameCenterFunction                  RuntimeBeforeUnlinkGameCenterFunction
	beforeUnlinkGoogleFunction                      RuntimeBeforeUnlinkGoogleFunction
	beforeUnlinkSteamFunction                       RuntimeBeforeUnlinkSteamFunction
	beforeGetUsersFunction                          RuntimeBeforeGetUsersFunction
	beforeEventFunction                             RuntimeBeforeEventFunction
}

type RuntimeAfterReqFunctions struct {
	afterGetAccountFunction                        RuntimeAfterGetAccountFunction
	afterUpdateAccountFunction                     RuntimeAfterUpdateAccountFunction
	afterAuthenticateCustomFunction                RuntimeAfterAuthenticateCustomFunction
	afterAuthenticateDeviceFunction                RuntimeAfterAuthenticateDeviceFunction
	afterAuthenticateEmailFunction                 RuntimeAfterAuthenticateEmailFunction
	afterAuthenticateFacebookFunction              RuntimeAfterAuthenticateFacebookFunction
	afterAuthenticateFacebookInstantGameFunction   RuntimeAfterAuthenticateFacebookInstantGameFunction
	afterAuthenticateGameCenterFunction            RuntimeAfterAuthenticateGameCenterFunction
	afterAuthenticateGoogleFunction                RuntimeAfterAuthenticateGoogleFunction
	afterAuthenticateSteamFunction                 RuntimeAfterAuthenticateSteamFunction
	afterListChannelMessagesFunction               RuntimeAfterListChannelMessagesFunction
	afterListFriendsFunction                       RuntimeAfterListFriendsFunction
	afterAddFriendsFunction                        RuntimeAfterAddFriendsFunction
	afterDeleteFriendsFunction                     RuntimeAfterDeleteFriendsFunction
	afterBlockFriendsFunction                      RuntimeAfterBlockFriendsFunction
	afterImportFacebookFriendsFunction             RuntimeAfterImportFacebookFriendsFunction
	afterCreateGroupFunction                       RuntimeAfterCreateGroupFunction
	afterUpdateGroupFunction                       RuntimeAfterUpdateGroupFunction
	afterDeleteGroupFunction                       RuntimeAfterDeleteGroupFunction
	afterJoinGroupFunction                         RuntimeAfterJoinGroupFunction
	afterLeaveGroupFunction                        RuntimeAfterLeaveGroupFunction
	afterAddGroupUsersFunction                     RuntimeAfterAddGroupUsersFunction
	afterBanGroupUsersFunction                     RuntimeAfterBanGroupUsersFunction
	afterKickGroupUsersFunction                    RuntimeAfterKickGroupUsersFunction
	afterPromoteGroupUsersFunction                 RuntimeAfterPromoteGroupUsersFunction
	afterListGroupUsersFunction                    RuntimeAfterListGroupUsersFunction
	afterListUserGroupsFunction                    RuntimeAfterListUserGroupsFunction
	afterListGroupsFunction                        RuntimeAfterListGroupsFunction
	afterDeleteLeaderboardRecordFunction           RuntimeAfterDeleteLeaderboardRecordFunction
	afterListLeaderboardRecordsFunction            RuntimeAfterListLeaderboardRecordsFunction
	afterWriteLeaderboardRecordFunction            RuntimeAfterWriteLeaderboardRecordFunction
	afterListLeaderboardRecordsAroundOwnerFunction RuntimeAfterListLeaderboardRecordsAroundOwnerFunction
	afterLinkCustomFunction                        RuntimeAfterLinkCustomFunction
	afterLinkDeviceFunction                        RuntimeAfterLinkDeviceFunction
	afterLinkEmailFunction                         RuntimeAfterLinkEmailFunction
	afterLinkFacebookFunction                      RuntimeAfterLinkFacebookFunction
	afterLinkFacebookInstantGameFunction           RuntimeAfterLinkFacebookInstantGameFunction
	afterLinkGameCenterFunction                    RuntimeAfterLinkGameCenterFunction
	afterLinkGoogleFunction                        RuntimeAfterLinkGoogleFunction
	afterLinkSteamFunction                         RuntimeAfterLinkSteamFunction
	afterListMatchesFunction                       RuntimeAfterListMatchesFunction
	afterListNotificationsFunction                 RuntimeAfterListNotificationsFunction
	afterDeleteNotificationFunction                RuntimeAfterDeleteNotificationFunction
	afterListStorageObjectsFunction                RuntimeAfterListStorageObjectsFunction
	afterReadStorageObjectsFunction                RuntimeAfterReadStorageObjectsFunction
	afterWriteStorageObjectsFunction               RuntimeAfterWriteStorageObjectsFunction
	afterDeleteStorageObjectsFunction              RuntimeAfterDeleteStorageObjectsFunction
	afterJoinTournamentFunction                    RuntimeAfterJoinTournamentFunction
	afterListTournamentRecordsFunction             RuntimeAfterListTournamentRecordsFunction
	afterListTournamentsFunction                   RuntimeAfterListTournamentsFunction
	afterWriteTournamentRecordFunction             RuntimeAfterWriteTournamentRecordFunction
	afterListTournamentRecordsAroundOwnerFunction  RuntimeAfterListTournamentRecordsAroundOwnerFunction
	afterUnlinkCustomFunction                      RuntimeAfterUnlinkCustomFunction
	afterUnlinkDeviceFunction                      RuntimeAfterUnlinkDeviceFunction
	afterUnlinkEmailFunction                       RuntimeAfterUnlinkEmailFunction
	afterUnlinkFacebookFunction                    RuntimeAfterUnlinkFacebookFunction
	afterUnlinkFacebookInstantGameFunction         RuntimeAfterUnlinkFacebookInstantGameFunction
	afterUnlinkGameCenterFunction                  RuntimeAfterUnlinkGameCenterFunction
	afterUnlinkGoogleFunction                      RuntimeAfterUnlinkGoogleFunction
	afterUnlinkSteamFunction                       RuntimeAfterUnlinkSteamFunction
	afterGetUsersFunction                          RuntimeAfterGetUsersFunction
	afterEventFunction                             RuntimeAfterEventFunction
}

type Runtime struct {
	matchCreateFunction RuntimeMatchCreateFunction

	rpcFunctions map[string]RuntimeRpcFunction

	beforeRtFunctions map[string]RuntimeBeforeRtFunction
	afterRtFunctions  map[string]RuntimeAfterRtFunction

	beforeReqFunctions *RuntimeBeforeReqFunctions
	afterReqFunctions  *RuntimeAfterReqFunctions

	matchmakerMatchedFunction RuntimeMatchmakerMatchedFunction

	tournamentEndFunction   RuntimeTournamentEndFunction
	tournamentResetFunction RuntimeTournamentResetFunction

	leaderboardResetFunction RuntimeLeaderboardResetFunction

	eventFunctions *RuntimeEventFunctions
}

func GetRuntimePaths(logger *zap.Logger, rootPath string) ([]string, error) {
	if err := os.MkdirAll(rootPath, os.ModePerm); err != nil {
		return nil, err
	}

	paths := make([]string, 0)
	if err := filepath.Walk(rootPath, func(path string, f os.FileInfo, err error) error {
		if err != nil {
			logger.Error("Error listing runtime path", zap.String("path", path), zap.Error(err))
			return err
		}

		// Ignore directories.
		if !f.IsDir() {
			paths = append(paths, path)
		}
		return nil
	}); err != nil {
		logger.Error("Failed to list runtime path", zap.Error(err))
		return nil, err
	}

	return paths, nil
}

func CheckRuntime(logger *zap.Logger, config Config) error {
	// Get all paths inside the configured runtime.
	paths, err := GetRuntimePaths(logger, config.GetRuntime().Path)
	if err != nil {
		return err
	}

	// Check any Go runtime modules.
	err = CheckRuntimeProviderGo(logger, config.GetRuntime().Path, paths)
	if err != nil {
		return err
	}

	// Check any Lua runtime modules.
	err = CheckRuntimeProviderLua(logger, config, paths)
	if err != nil {
		return err
	}

	return nil
}

func NewRuntime(logger, startupLogger *zap.Logger, db *sql.DB, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, streamManager StreamManager, router MessageRouter) (*Runtime, error) {
	runtimeConfig := config.GetRuntime()
	startupLogger.Info("Initialising runtime", zap.String("path", runtimeConfig.Path))

	paths, err := GetRuntimePaths(startupLogger, runtimeConfig.Path)
	if err != nil {
		return nil, err
	}

	startupLogger.Info("Initialising runtime event queue processor")
	eventQueue := NewRuntimeEventQueue(logger, config)
	startupLogger.Info("Runtime event queue processor started", zap.Int("size", config.GetRuntime().EventQueueSize), zap.Int("workers", config.GetRuntime().EventQueueWorkers))

	goModules, goRPCFunctions, goBeforeRtFunctions, goAfterRtFunctions, goBeforeReqFunctions, goAfterReqFunctions, goMatchmakerMatchedFunction, goMatchCreateFn, goTournamentEndFunction, goTournamentResetFunction, goLeaderboardResetFunction, allEventFunctions, goSetMatchCreateFn, goMatchNamesListFn, err := NewRuntimeProviderGo(logger, startupLogger, db, jsonpbMarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, streamManager, router, runtimeConfig.Path, paths, eventQueue)
	if err != nil {
		startupLogger.Error("Error initialising Go runtime provider", zap.Error(err))
		return nil, err
	}

	luaModules, luaRPCFunctions, luaBeforeRtFunctions, luaAfterRtFunctions, luaBeforeReqFunctions, luaAfterReqFunctions, luaMatchmakerMatchedFunction, allMatchCreateFn, luaTournamentEndFunction, luaTournamentResetFunction, luaLeaderboardResetFunction, err := NewRuntimeProviderLua(logger, startupLogger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, streamManager, router, goMatchCreateFn, runtimeConfig.Path, paths)
	if err != nil {
		startupLogger.Error("Error initialising Lua runtime provider", zap.Error(err))
		return nil, err
	}

	// allMatchCreateFn has already been set up by the Lua side to multiplex, now tell the Go side to use it too.
	goSetMatchCreateFn(allMatchCreateFn)

	allModules := make([]string, 0, len(goModules)+len(luaModules))
	for _, module := range luaModules {
		allModules = append(allModules, module)
	}
	for _, module := range goModules {
		allModules = append(allModules, module)
	}
	startupLogger.Info("Found runtime modules", zap.Int("count", len(allModules)), zap.Strings("modules", allModules))

	if allEventFunctions.eventFunction != nil {
		startupLogger.Info("Registered event function invocation for custom events")
	}
	if allEventFunctions.sessionStartFunction != nil {
		startupLogger.Info("Registered event function invocation", zap.String("id", "session_start"))
	}
	if allEventFunctions.sessionEndFunction != nil {
		startupLogger.Info("Registered event function invocation", zap.String("id", "session_end"))
	}

	allRPCFunctions := make(map[string]RuntimeRpcFunction, len(goRPCFunctions)+len(luaRPCFunctions))
	for id, fn := range luaRPCFunctions {
		allRPCFunctions[id] = fn
		startupLogger.Info("Registered Lua runtime RPC function invocation", zap.String("id", id))
	}
	for id, fn := range goRPCFunctions {
		allRPCFunctions[id] = fn
		startupLogger.Info("Registered Go runtime RPC function invocation", zap.String("id", id))
	}

	allBeforeRtFunctions := make(map[string]RuntimeBeforeRtFunction, len(goBeforeRtFunctions)+len(luaBeforeRtFunctions))
	for id, fn := range luaBeforeRtFunctions {
		allBeforeRtFunctions[id] = fn
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range goBeforeRtFunctions {
		allBeforeRtFunctions[id] = fn
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}

	allAfterRtFunctions := make(map[string]RuntimeAfterRtFunction, len(goAfterRtFunctions)+len(luaAfterRtFunctions))
	for id, fn := range luaAfterRtFunctions {
		allAfterRtFunctions[id] = fn
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range goAfterRtFunctions {
		allAfterRtFunctions[id] = fn
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}

	allBeforeReqFunctions := luaBeforeReqFunctions
	if allBeforeReqFunctions.beforeGetAccountFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "getaccount"))
	}
	if allBeforeReqFunctions.beforeUpdateAccountFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "updateaccount"))
	}
	if allBeforeReqFunctions.beforeAuthenticateCustomFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatecustom"))
	}
	if allBeforeReqFunctions.beforeAuthenticateDeviceFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatedevice"))
	}
	if allBeforeReqFunctions.beforeAuthenticateEmailFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticateemail"))
	}
	if allBeforeReqFunctions.beforeAuthenticateFacebookFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatefacebook"))
	}
	if allBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if allBeforeReqFunctions.beforeAuthenticateGameCenterFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticategamecenter"))
	}
	if allBeforeReqFunctions.beforeAuthenticateGoogleFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticategoogle"))
	}
	if allBeforeReqFunctions.beforeAuthenticateSteamFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatesteam"))
	}
	if allBeforeReqFunctions.beforeListChannelMessagesFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listchannelmessages"))
	}
	if allBeforeReqFunctions.beforeListFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listfriends"))
	}
	if allBeforeReqFunctions.beforeAddFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "addfriends"))
	}
	if allBeforeReqFunctions.beforeDeleteFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletefriends"))
	}
	if allBeforeReqFunctions.beforeBlockFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "blockfriends"))
	}
	if allBeforeReqFunctions.beforeImportFacebookFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "importfacebookfriends"))
	}
	if allBeforeReqFunctions.beforeCreateGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "creategroup"))
	}
	if allBeforeReqFunctions.beforeUpdateGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "updategroup"))
	}
	if allBeforeReqFunctions.beforeDeleteGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletegroup"))
	}
	if allBeforeReqFunctions.beforeJoinGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "joingroup"))
	}
	if allBeforeReqFunctions.beforeLeaveGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "leavegroup"))
	}
	if allBeforeReqFunctions.beforeAddGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "addgroupusers"))
	}
	if allBeforeReqFunctions.beforeBanGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "bangroupusers"))
	}
	if allBeforeReqFunctions.beforeKickGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "kickgroupusers"))
	}
	if allBeforeReqFunctions.beforePromoteGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "promotegroupusers"))
	}
	if allBeforeReqFunctions.beforeListGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listgroupusers"))
	}
	if allBeforeReqFunctions.beforeListUserGroupsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listusergroups"))
	}
	if allBeforeReqFunctions.beforeListGroupsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listgroups"))
	}
	if allBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if allBeforeReqFunctions.beforeListLeaderboardRecordsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if allBeforeReqFunctions.beforeWriteLeaderboardRecordFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if allBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if allBeforeReqFunctions.beforeLinkCustomFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkcustom"))
	}
	if allBeforeReqFunctions.beforeLinkDeviceFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkdevice"))
	}
	if allBeforeReqFunctions.beforeLinkEmailFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkemail"))
	}
	if allBeforeReqFunctions.beforeLinkFacebookFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkfacebook"))
	}
	if allBeforeReqFunctions.beforeLinkFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if allBeforeReqFunctions.beforeLinkGameCenterFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkgamecenter"))
	}
	if allBeforeReqFunctions.beforeLinkGoogleFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkgoogle"))
	}
	if allBeforeReqFunctions.beforeLinkSteamFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linksteam"))
	}
	if allBeforeReqFunctions.beforeListMatchesFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listmatches"))
	}
	if allBeforeReqFunctions.beforeListNotificationsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listnotifications"))
	}
	if allBeforeReqFunctions.beforeDeleteNotificationFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletenotification"))
	}
	if allBeforeReqFunctions.beforeListStorageObjectsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "liststorageobjects"))
	}
	if allBeforeReqFunctions.beforeReadStorageObjectsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "readstorageobjects"))
	}
	if allBeforeReqFunctions.beforeWriteStorageObjectsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writestorageobjects"))
	}
	if allBeforeReqFunctions.beforeDeleteStorageObjectsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletestorageobjects"))
	}
	if allBeforeReqFunctions.beforeJoinTournamentFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "jointournament"))
	}
	if allBeforeReqFunctions.beforeListTournamentRecordsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournamentrecords"))
	}
	if allBeforeReqFunctions.beforeListTournamentsFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournaments"))
	}
	if allBeforeReqFunctions.beforeWriteTournamentRecordFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writetournamentrecord"))
	}
	if allBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if allBeforeReqFunctions.beforeUnlinkCustomFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkcustom"))
	}
	if allBeforeReqFunctions.beforeUnlinkDeviceFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkdevice"))
	}
	if allBeforeReqFunctions.beforeUnlinkEmailFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkemail"))
	}
	if allBeforeReqFunctions.beforeUnlinkFacebookFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkfacebook"))
	}
	if allBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if allBeforeReqFunctions.beforeUnlinkGameCenterFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if allBeforeReqFunctions.beforeUnlinkGoogleFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkgoogle"))
	}
	if allBeforeReqFunctions.beforeUnlinkSteamFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinksteam"))
	}
	if allBeforeReqFunctions.beforeGetUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "getusers"))
	}
	if allBeforeReqFunctions.beforeEventFunction != nil {
		startupLogger.Info("Registered Lua runtime Before custom events function invocation")
	}
	if goBeforeReqFunctions.beforeGetAccountFunction != nil {
		allBeforeReqFunctions.beforeGetAccountFunction = goBeforeReqFunctions.beforeGetAccountFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "getaccount"))
	}
	if goBeforeReqFunctions.beforeUpdateAccountFunction != nil {
		allBeforeReqFunctions.beforeUpdateAccountFunction = goBeforeReqFunctions.beforeUpdateAccountFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "updateaccount"))
	}
	if goBeforeReqFunctions.beforeAuthenticateCustomFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateCustomFunction = goBeforeReqFunctions.beforeAuthenticateCustomFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatecustom"))
	}
	if goBeforeReqFunctions.beforeAuthenticateDeviceFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateDeviceFunction = goBeforeReqFunctions.beforeAuthenticateDeviceFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatedevice"))
	}
	if goBeforeReqFunctions.beforeAuthenticateEmailFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateEmailFunction = goBeforeReqFunctions.beforeAuthenticateEmailFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticateemail"))
	}
	if goBeforeReqFunctions.beforeAuthenticateFacebookFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateFacebookFunction = goBeforeReqFunctions.beforeAuthenticateFacebookFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatefacebook"))
	}
	if goBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction = goBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if goBeforeReqFunctions.beforeAuthenticateGameCenterFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateGameCenterFunction = goBeforeReqFunctions.beforeAuthenticateGameCenterFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticategamecenter"))
	}
	if goBeforeReqFunctions.beforeAuthenticateGoogleFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateGoogleFunction = goBeforeReqFunctions.beforeAuthenticateGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticategoogle"))
	}
	if goBeforeReqFunctions.beforeAuthenticateSteamFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateSteamFunction = goBeforeReqFunctions.beforeAuthenticateSteamFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatesteam"))
	}
	if goBeforeReqFunctions.beforeListChannelMessagesFunction != nil {
		allBeforeReqFunctions.beforeListChannelMessagesFunction = goBeforeReqFunctions.beforeListChannelMessagesFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listchannelmessages"))
	}
	if goBeforeReqFunctions.beforeListFriendsFunction != nil {
		allBeforeReqFunctions.beforeListFriendsFunction = goBeforeReqFunctions.beforeListFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listfriends"))
	}
	if goBeforeReqFunctions.beforeAddFriendsFunction != nil {
		allBeforeReqFunctions.beforeAddFriendsFunction = goBeforeReqFunctions.beforeAddFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "addfriends"))
	}
	if goBeforeReqFunctions.beforeDeleteFriendsFunction != nil {
		allBeforeReqFunctions.beforeDeleteFriendsFunction = goBeforeReqFunctions.beforeDeleteFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletefriends"))
	}
	if goBeforeReqFunctions.beforeBlockFriendsFunction != nil {
		allBeforeReqFunctions.beforeBlockFriendsFunction = goBeforeReqFunctions.beforeBlockFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "blockfriends"))
	}
	if goBeforeReqFunctions.beforeImportFacebookFriendsFunction != nil {
		allBeforeReqFunctions.beforeImportFacebookFriendsFunction = goBeforeReqFunctions.beforeImportFacebookFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "importfacebookfriends"))
	}
	if goBeforeReqFunctions.beforeCreateGroupFunction != nil {
		allBeforeReqFunctions.beforeCreateGroupFunction = goBeforeReqFunctions.beforeCreateGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "creategroup"))
	}
	if goBeforeReqFunctions.beforeUpdateGroupFunction != nil {
		allBeforeReqFunctions.beforeUpdateGroupFunction = goBeforeReqFunctions.beforeUpdateGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "updategroup"))
	}
	if goBeforeReqFunctions.beforeDeleteGroupFunction != nil {
		allBeforeReqFunctions.beforeDeleteGroupFunction = goBeforeReqFunctions.beforeDeleteGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletegroup"))
	}
	if goBeforeReqFunctions.beforeJoinGroupFunction != nil {
		allBeforeReqFunctions.beforeJoinGroupFunction = goBeforeReqFunctions.beforeJoinGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "joingroup"))
	}
	if goBeforeReqFunctions.beforeLeaveGroupFunction != nil {
		allBeforeReqFunctions.beforeLeaveGroupFunction = goBeforeReqFunctions.beforeLeaveGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "leavegroup"))
	}
	if goBeforeReqFunctions.beforeAddGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeAddGroupUsersFunction = goBeforeReqFunctions.beforeAddGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "addgroupusers"))
	}
	if goBeforeReqFunctions.beforeBanGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeBanGroupUsersFunction = goBeforeReqFunctions.beforeBanGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "bangroupusers"))
	}
	if goBeforeReqFunctions.beforeKickGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeKickGroupUsersFunction = goBeforeReqFunctions.beforeKickGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "kickgroupusers"))
	}
	if goBeforeReqFunctions.beforePromoteGroupUsersFunction != nil {
		allBeforeReqFunctions.beforePromoteGroupUsersFunction = goBeforeReqFunctions.beforePromoteGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "promotegroupusers"))
	}
	if goBeforeReqFunctions.beforeListGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeListGroupUsersFunction = goBeforeReqFunctions.beforeListGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listgroupusers"))
	}
	if goBeforeReqFunctions.beforeListUserGroupsFunction != nil {
		allBeforeReqFunctions.beforeListUserGroupsFunction = goBeforeReqFunctions.beforeListUserGroupsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listusergroups"))
	}
	if goBeforeReqFunctions.beforeListGroupsFunction != nil {
		allBeforeReqFunctions.beforeListGroupsFunction = goBeforeReqFunctions.beforeListGroupsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listgroups"))
	}
	if goBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction != nil {
		allBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction = goBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if goBeforeReqFunctions.beforeListLeaderboardRecordsFunction != nil {
		allBeforeReqFunctions.beforeListLeaderboardRecordsFunction = goBeforeReqFunctions.beforeListLeaderboardRecordsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if goBeforeReqFunctions.beforeWriteLeaderboardRecordFunction != nil {
		allBeforeReqFunctions.beforeWriteLeaderboardRecordFunction = goBeforeReqFunctions.beforeWriteLeaderboardRecordFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if goBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction != nil {
		allBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction = goBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if goBeforeReqFunctions.beforeLinkCustomFunction != nil {
		allBeforeReqFunctions.beforeLinkCustomFunction = goBeforeReqFunctions.beforeLinkCustomFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkcustom"))
	}
	if goBeforeReqFunctions.beforeLinkDeviceFunction != nil {
		allBeforeReqFunctions.beforeLinkDeviceFunction = goBeforeReqFunctions.beforeLinkDeviceFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkdevice"))
	}
	if goBeforeReqFunctions.beforeLinkEmailFunction != nil {
		allBeforeReqFunctions.beforeLinkEmailFunction = goBeforeReqFunctions.beforeLinkEmailFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkemail"))
	}
	if goBeforeReqFunctions.beforeLinkFacebookFunction != nil {
		allBeforeReqFunctions.beforeLinkFacebookFunction = goBeforeReqFunctions.beforeLinkFacebookFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkfacebook"))
	}
	if goBeforeReqFunctions.beforeLinkFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeLinkFacebookInstantGameFunction = goBeforeReqFunctions.beforeLinkFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if goBeforeReqFunctions.beforeLinkGameCenterFunction != nil {
		allBeforeReqFunctions.beforeLinkGameCenterFunction = goBeforeReqFunctions.beforeLinkGameCenterFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkgamecenter"))
	}
	if goBeforeReqFunctions.beforeLinkGoogleFunction != nil {
		allBeforeReqFunctions.beforeLinkGoogleFunction = goBeforeReqFunctions.beforeLinkGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkgoogle"))
	}
	if goBeforeReqFunctions.beforeLinkSteamFunction != nil {
		allBeforeReqFunctions.beforeLinkSteamFunction = goBeforeReqFunctions.beforeLinkSteamFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linksteam"))
	}
	if goBeforeReqFunctions.beforeListMatchesFunction != nil {
		allBeforeReqFunctions.beforeListMatchesFunction = goBeforeReqFunctions.beforeListMatchesFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listmatches"))
	}
	if goBeforeReqFunctions.beforeListNotificationsFunction != nil {
		allBeforeReqFunctions.beforeListNotificationsFunction = goBeforeReqFunctions.beforeListNotificationsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listnotifications"))
	}
	if goBeforeReqFunctions.beforeDeleteNotificationFunction != nil {
		allBeforeReqFunctions.beforeDeleteNotificationFunction = goBeforeReqFunctions.beforeDeleteNotificationFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletenotification"))
	}
	if goBeforeReqFunctions.beforeListStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeListStorageObjectsFunction = goBeforeReqFunctions.beforeListStorageObjectsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "liststorageobjects"))
	}
	if goBeforeReqFunctions.beforeReadStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeReadStorageObjectsFunction = goBeforeReqFunctions.beforeReadStorageObjectsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "readstorageobjects"))
	}
	if goBeforeReqFunctions.beforeWriteStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeWriteStorageObjectsFunction = goBeforeReqFunctions.beforeWriteStorageObjectsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "writestorageobjects"))
	}
	if goBeforeReqFunctions.beforeDeleteStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeDeleteStorageObjectsFunction = goBeforeReqFunctions.beforeDeleteStorageObjectsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletestorageobjects"))
	}
	if goBeforeReqFunctions.beforeJoinTournamentFunction != nil {
		allBeforeReqFunctions.beforeJoinTournamentFunction = goBeforeReqFunctions.beforeJoinTournamentFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "jointournament"))
	}
	if goBeforeReqFunctions.beforeListTournamentRecordsFunction != nil {
		allBeforeReqFunctions.beforeListTournamentRecordsFunction = goBeforeReqFunctions.beforeListTournamentRecordsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listtournamentrecords"))
	}
	if goBeforeReqFunctions.beforeListTournamentsFunction != nil {
		allBeforeReqFunctions.beforeListTournamentsFunction = goBeforeReqFunctions.beforeListTournamentsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listtournaments"))
	}
	if goBeforeReqFunctions.beforeWriteTournamentRecordFunction != nil {
		allBeforeReqFunctions.beforeWriteTournamentRecordFunction = goBeforeReqFunctions.beforeWriteTournamentRecordFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "writetournamentrecord"))
	}
	if goBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction != nil {
		allBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction = goBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if goBeforeReqFunctions.beforeUnlinkCustomFunction != nil {
		allBeforeReqFunctions.beforeUnlinkCustomFunction = goBeforeReqFunctions.beforeUnlinkCustomFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkcustom"))
	}
	if goBeforeReqFunctions.beforeUnlinkDeviceFunction != nil {
		allBeforeReqFunctions.beforeUnlinkDeviceFunction = goBeforeReqFunctions.beforeUnlinkDeviceFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkdevice"))
	}
	if goBeforeReqFunctions.beforeUnlinkEmailFunction != nil {
		allBeforeReqFunctions.beforeUnlinkEmailFunction = goBeforeReqFunctions.beforeUnlinkEmailFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkemail"))
	}
	if goBeforeReqFunctions.beforeUnlinkFacebookFunction != nil {
		allBeforeReqFunctions.beforeUnlinkFacebookFunction = goBeforeReqFunctions.beforeUnlinkFacebookFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkfacebook"))
	}
	if goBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction = goBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if goBeforeReqFunctions.beforeUnlinkGameCenterFunction != nil {
		allBeforeReqFunctions.beforeUnlinkGameCenterFunction = goBeforeReqFunctions.beforeUnlinkGameCenterFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if goBeforeReqFunctions.beforeUnlinkGoogleFunction != nil {
		allBeforeReqFunctions.beforeUnlinkGoogleFunction = goBeforeReqFunctions.beforeUnlinkGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkgoogle"))
	}
	if goBeforeReqFunctions.beforeUnlinkSteamFunction != nil {
		allBeforeReqFunctions.beforeUnlinkSteamFunction = goBeforeReqFunctions.beforeUnlinkSteamFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinksteam"))
	}
	if goBeforeReqFunctions.beforeGetUsersFunction != nil {
		allBeforeReqFunctions.beforeGetUsersFunction = goBeforeReqFunctions.beforeGetUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "getusers"))
	}
	if goBeforeReqFunctions.beforeEventFunction != nil {
		allBeforeReqFunctions.beforeEventFunction = goBeforeReqFunctions.beforeEventFunction
		startupLogger.Info("Registered Go runtime Before custom events function invocation")
	}

	allAfterReqFunctions := luaAfterReqFunctions
	if allAfterReqFunctions.afterGetAccountFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "getaccount"))
	}
	if allAfterReqFunctions.afterUpdateAccountFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "updateaccount"))
	}
	if allAfterReqFunctions.afterAuthenticateCustomFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatecustom"))
	}
	if allAfterReqFunctions.afterAuthenticateDeviceFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatedevice"))
	}
	if allAfterReqFunctions.afterAuthenticateEmailFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticateemail"))
	}
	if allAfterReqFunctions.afterAuthenticateFacebookFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatefacebook"))
	}
	if allAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if allAfterReqFunctions.afterAuthenticateGameCenterFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticategamecenter"))
	}
	if allAfterReqFunctions.afterAuthenticateGoogleFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticategoogle"))
	}
	if allAfterReqFunctions.afterAuthenticateSteamFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatesteam"))
	}
	if allAfterReqFunctions.afterListChannelMessagesFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listchannelmessages"))
	}
	if allAfterReqFunctions.afterListFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listfriends"))
	}
	if allAfterReqFunctions.afterAddFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "addfriends"))
	}
	if allAfterReqFunctions.afterDeleteFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletefriends"))
	}
	if allAfterReqFunctions.afterBlockFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "blockfriends"))
	}
	if allAfterReqFunctions.afterImportFacebookFriendsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "importfacebookfriends"))
	}
	if allAfterReqFunctions.afterCreateGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "creategroup"))
	}
	if allAfterReqFunctions.afterUpdateGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "updategroup"))
	}
	if allAfterReqFunctions.afterDeleteGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletegroup"))
	}
	if allAfterReqFunctions.afterJoinGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "joingroup"))
	}
	if allAfterReqFunctions.afterLeaveGroupFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "leavegroup"))
	}
	if allAfterReqFunctions.afterAddGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "addgroupusers"))
	}
	if allAfterReqFunctions.afterBanGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "bangroupusers"))
	}
	if allAfterReqFunctions.afterKickGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "kickgroupusers"))
	}
	if allAfterReqFunctions.afterPromoteGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "promotegroupusers"))
	}
	if allAfterReqFunctions.afterListGroupUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listgroupusers"))
	}
	if allAfterReqFunctions.afterListUserGroupsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listusergroups"))
	}
	if allAfterReqFunctions.afterListGroupsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listgroups"))
	}
	if allAfterReqFunctions.afterDeleteLeaderboardRecordFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if allAfterReqFunctions.afterListLeaderboardRecordsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if allAfterReqFunctions.afterWriteLeaderboardRecordFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if allAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if allAfterReqFunctions.afterLinkCustomFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkcustom"))
	}
	if allAfterReqFunctions.afterLinkDeviceFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkdevice"))
	}
	if allAfterReqFunctions.afterLinkEmailFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkemail"))
	}
	if allAfterReqFunctions.afterLinkFacebookFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkfacebook"))
	}
	if allAfterReqFunctions.afterLinkFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if allAfterReqFunctions.afterLinkGameCenterFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkgamecenter"))
	}
	if allAfterReqFunctions.afterLinkGoogleFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkgoogle"))
	}
	if allAfterReqFunctions.afterLinkSteamFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linksteam"))
	}
	if allAfterReqFunctions.afterListMatchesFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listmatches"))
	}
	if allAfterReqFunctions.afterListNotificationsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listnotifications"))
	}
	if allAfterReqFunctions.afterDeleteNotificationFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletenotification"))
	}
	if allAfterReqFunctions.afterListStorageObjectsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "liststorageobjects"))
	}
	if allAfterReqFunctions.afterReadStorageObjectsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "readstorageobjects"))
	}
	if allAfterReqFunctions.afterWriteStorageObjectsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writestorageobjects"))
	}
	if allAfterReqFunctions.afterDeleteStorageObjectsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletestorageobjects"))
	}
	if allAfterReqFunctions.afterJoinTournamentFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "jointournament"))
	}
	if allAfterReqFunctions.afterListTournamentRecordsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournamentrecords"))
	}
	if allAfterReqFunctions.afterListTournamentsFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournaments"))
	}
	if allAfterReqFunctions.afterWriteTournamentRecordFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writetournamentrecord"))
	}
	if allAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if allAfterReqFunctions.afterUnlinkCustomFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkcustom"))
	}
	if allAfterReqFunctions.afterUnlinkDeviceFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkdevice"))
	}
	if allAfterReqFunctions.afterUnlinkEmailFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkemail"))
	}
	if allAfterReqFunctions.afterUnlinkFacebookFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkfacebook"))
	}
	if allAfterReqFunctions.afterUnlinkFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if allAfterReqFunctions.afterUnlinkGameCenterFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if allAfterReqFunctions.afterUnlinkGoogleFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkgoogle"))
	}
	if allAfterReqFunctions.afterUnlinkSteamFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinksteam"))
	}
	if allAfterReqFunctions.afterGetUsersFunction != nil {
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "getusers"))
	}
	if allAfterReqFunctions.afterEventFunction != nil {
		startupLogger.Info("Registered Lua runtime After custom events function invocation")
	}
	if goAfterReqFunctions.afterGetAccountFunction != nil {
		allAfterReqFunctions.afterGetAccountFunction = goAfterReqFunctions.afterGetAccountFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "getaccount"))
	}
	if goAfterReqFunctions.afterUpdateAccountFunction != nil {
		allAfterReqFunctions.afterUpdateAccountFunction = goAfterReqFunctions.afterUpdateAccountFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "updateaccount"))
	}
	if goAfterReqFunctions.afterAuthenticateCustomFunction != nil {
		allAfterReqFunctions.afterAuthenticateCustomFunction = goAfterReqFunctions.afterAuthenticateCustomFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatecustom"))
	}
	if goAfterReqFunctions.afterAuthenticateDeviceFunction != nil {
		allAfterReqFunctions.afterAuthenticateDeviceFunction = goAfterReqFunctions.afterAuthenticateDeviceFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatedevice"))
	}
	if goAfterReqFunctions.afterAuthenticateEmailFunction != nil {
		allAfterReqFunctions.afterAuthenticateEmailFunction = goAfterReqFunctions.afterAuthenticateEmailFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticateemail"))
	}
	if goAfterReqFunctions.afterAuthenticateFacebookFunction != nil {
		allAfterReqFunctions.afterAuthenticateFacebookFunction = goAfterReqFunctions.afterAuthenticateFacebookFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatefacebook"))
	}
	if goAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction = goAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if goAfterReqFunctions.afterAuthenticateGameCenterFunction != nil {
		allAfterReqFunctions.afterAuthenticateGameCenterFunction = goAfterReqFunctions.afterAuthenticateGameCenterFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticategamecenter"))
	}
	if goAfterReqFunctions.afterAuthenticateGoogleFunction != nil {
		allAfterReqFunctions.afterAuthenticateGoogleFunction = goAfterReqFunctions.afterAuthenticateGoogleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticategoogle"))
	}
	if goAfterReqFunctions.afterAuthenticateSteamFunction != nil {
		allAfterReqFunctions.afterAuthenticateSteamFunction = goAfterReqFunctions.afterAuthenticateSteamFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatesteam"))
	}
	if goAfterReqFunctions.afterListChannelMessagesFunction != nil {
		allAfterReqFunctions.afterListChannelMessagesFunction = goAfterReqFunctions.afterListChannelMessagesFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listchannelmessages"))
	}
	if goAfterReqFunctions.afterListFriendsFunction != nil {
		allAfterReqFunctions.afterListFriendsFunction = goAfterReqFunctions.afterListFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listfriends"))
	}
	if goAfterReqFunctions.afterAddFriendsFunction != nil {
		allAfterReqFunctions.afterAddFriendsFunction = goAfterReqFunctions.afterAddFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "addfriends"))
	}
	if goAfterReqFunctions.afterDeleteFriendsFunction != nil {
		allAfterReqFunctions.afterDeleteFriendsFunction = goAfterReqFunctions.afterDeleteFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletefriends"))
	}
	if goAfterReqFunctions.afterBlockFriendsFunction != nil {
		allAfterReqFunctions.afterBlockFriendsFunction = goAfterReqFunctions.afterBlockFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "blockfriends"))
	}
	if goAfterReqFunctions.afterImportFacebookFriendsFunction != nil {
		allAfterReqFunctions.afterImportFacebookFriendsFunction = goAfterReqFunctions.afterImportFacebookFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "importfacebookfriends"))
	}
	if goAfterReqFunctions.afterCreateGroupFunction != nil {
		allAfterReqFunctions.afterCreateGroupFunction = goAfterReqFunctions.afterCreateGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "creategroup"))
	}
	if goAfterReqFunctions.afterUpdateGroupFunction != nil {
		allAfterReqFunctions.afterUpdateGroupFunction = goAfterReqFunctions.afterUpdateGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "updategroup"))
	}
	if goAfterReqFunctions.afterDeleteGroupFunction != nil {
		allAfterReqFunctions.afterDeleteGroupFunction = goAfterReqFunctions.afterDeleteGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletegroup"))
	}
	if goAfterReqFunctions.afterJoinGroupFunction != nil {
		allAfterReqFunctions.afterJoinGroupFunction = goAfterReqFunctions.afterJoinGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "joingroup"))
	}
	if goAfterReqFunctions.afterLeaveGroupFunction != nil {
		allAfterReqFunctions.afterLeaveGroupFunction = goAfterReqFunctions.afterLeaveGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "leavegroup"))
	}
	if goAfterReqFunctions.afterAddGroupUsersFunction != nil {
		allAfterReqFunctions.afterAddGroupUsersFunction = goAfterReqFunctions.afterAddGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "addgroupusers"))
	}
	if goAfterReqFunctions.afterBanGroupUsersFunction != nil {
		allAfterReqFunctions.afterBanGroupUsersFunction = goAfterReqFunctions.afterBanGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "bangroupusers"))
	}
	if goAfterReqFunctions.afterKickGroupUsersFunction != nil {
		allAfterReqFunctions.afterKickGroupUsersFunction = goAfterReqFunctions.afterKickGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "kickgroupusers"))
	}
	if goAfterReqFunctions.afterPromoteGroupUsersFunction != nil {
		allAfterReqFunctions.afterPromoteGroupUsersFunction = goAfterReqFunctions.afterPromoteGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "promotegroupusers"))
	}
	if goAfterReqFunctions.afterListGroupUsersFunction != nil {
		allAfterReqFunctions.afterListGroupUsersFunction = goAfterReqFunctions.afterListGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listgroupusers"))
	}
	if goAfterReqFunctions.afterListUserGroupsFunction != nil {
		allAfterReqFunctions.afterListUserGroupsFunction = goAfterReqFunctions.afterListUserGroupsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listusergroups"))
	}
	if goAfterReqFunctions.afterListGroupsFunction != nil {
		allAfterReqFunctions.afterListGroupsFunction = goAfterReqFunctions.afterListGroupsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listgroups"))
	}
	if goAfterReqFunctions.afterDeleteLeaderboardRecordFunction != nil {
		allAfterReqFunctions.afterDeleteLeaderboardRecordFunction = goAfterReqFunctions.afterDeleteLeaderboardRecordFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if goAfterReqFunctions.afterListLeaderboardRecordsFunction != nil {
		allAfterReqFunctions.afterListLeaderboardRecordsFunction = goAfterReqFunctions.afterListLeaderboardRecordsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if goAfterReqFunctions.afterWriteLeaderboardRecordFunction != nil {
		allAfterReqFunctions.afterWriteLeaderboardRecordFunction = goAfterReqFunctions.afterWriteLeaderboardRecordFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if goAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction != nil {
		allAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction = goAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if goAfterReqFunctions.afterLinkCustomFunction != nil {
		allAfterReqFunctions.afterLinkCustomFunction = goAfterReqFunctions.afterLinkCustomFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkcustom"))
	}
	if goAfterReqFunctions.afterLinkDeviceFunction != nil {
		allAfterReqFunctions.afterLinkDeviceFunction = goAfterReqFunctions.afterLinkDeviceFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkdevice"))
	}
	if goAfterReqFunctions.afterLinkEmailFunction != nil {
		allAfterReqFunctions.afterLinkEmailFunction = goAfterReqFunctions.afterLinkEmailFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkemail"))
	}
	if goAfterReqFunctions.afterLinkFacebookFunction != nil {
		allAfterReqFunctions.afterLinkFacebookFunction = goAfterReqFunctions.afterLinkFacebookFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkfacebook"))
	}
	if goAfterReqFunctions.afterLinkFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterLinkFacebookInstantGameFunction = goAfterReqFunctions.afterLinkFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if goAfterReqFunctions.afterLinkGameCenterFunction != nil {
		allAfterReqFunctions.afterLinkGameCenterFunction = goAfterReqFunctions.afterLinkGameCenterFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkgamecenter"))
	}
	if goAfterReqFunctions.afterLinkGoogleFunction != nil {
		allAfterReqFunctions.afterLinkGoogleFunction = goAfterReqFunctions.afterLinkGoogleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkgoogle"))
	}
	if goAfterReqFunctions.afterLinkSteamFunction != nil {
		allAfterReqFunctions.afterLinkSteamFunction = goAfterReqFunctions.afterLinkSteamFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linksteam"))
	}
	if goAfterReqFunctions.afterListMatchesFunction != nil {
		allAfterReqFunctions.afterListMatchesFunction = goAfterReqFunctions.afterListMatchesFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listmatches"))
	}
	if goAfterReqFunctions.afterListNotificationsFunction != nil {
		allAfterReqFunctions.afterListNotificationsFunction = goAfterReqFunctions.afterListNotificationsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listnotifications"))
	}
	if goAfterReqFunctions.afterDeleteNotificationFunction != nil {
		allAfterReqFunctions.afterDeleteNotificationFunction = goAfterReqFunctions.afterDeleteNotificationFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletenotification"))
	}
	if goAfterReqFunctions.afterListStorageObjectsFunction != nil {
		allAfterReqFunctions.afterListStorageObjectsFunction = goAfterReqFunctions.afterListStorageObjectsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "liststorageobjects"))
	}
	if goAfterReqFunctions.afterReadStorageObjectsFunction != nil {
		allAfterReqFunctions.afterReadStorageObjectsFunction = goAfterReqFunctions.afterReadStorageObjectsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "readstorageobjects"))
	}
	if goAfterReqFunctions.afterWriteStorageObjectsFunction != nil {
		allAfterReqFunctions.afterWriteStorageObjectsFunction = goAfterReqFunctions.afterWriteStorageObjectsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "writestorageobjects"))
	}
	if goAfterReqFunctions.afterDeleteStorageObjectsFunction != nil {
		allAfterReqFunctions.afterDeleteStorageObjectsFunction = goAfterReqFunctions.afterDeleteStorageObjectsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletestorageobjects"))
	}
	if goAfterReqFunctions.afterJoinTournamentFunction != nil {
		allAfterReqFunctions.afterJoinTournamentFunction = goAfterReqFunctions.afterJoinTournamentFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "jointournament"))
	}
	if goAfterReqFunctions.afterListTournamentRecordsFunction != nil {
		allAfterReqFunctions.afterListTournamentRecordsFunction = goAfterReqFunctions.afterListTournamentRecordsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listtournamentrecords"))
	}
	if goAfterReqFunctions.afterListTournamentsFunction != nil {
		allAfterReqFunctions.afterListTournamentsFunction = goAfterReqFunctions.afterListTournamentsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listtournaments"))
	}
	if goAfterReqFunctions.afterWriteTournamentRecordFunction != nil {
		allAfterReqFunctions.afterWriteTournamentRecordFunction = goAfterReqFunctions.afterWriteTournamentRecordFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "writetournamentrecord"))
	}
	if goAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction != nil {
		allAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction = goAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if goAfterReqFunctions.afterUnlinkCustomFunction != nil {
		allAfterReqFunctions.afterUnlinkCustomFunction = goAfterReqFunctions.afterUnlinkCustomFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkcustom"))
	}
	if goAfterReqFunctions.afterUnlinkDeviceFunction != nil {
		allAfterReqFunctions.afterUnlinkDeviceFunction = goAfterReqFunctions.afterUnlinkDeviceFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkdevice"))
	}
	if goAfterReqFunctions.afterUnlinkEmailFunction != nil {
		allAfterReqFunctions.afterUnlinkEmailFunction = goAfterReqFunctions.afterUnlinkEmailFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkemail"))
	}
	if goAfterReqFunctions.afterUnlinkFacebookFunction != nil {
		allAfterReqFunctions.afterUnlinkFacebookFunction = goAfterReqFunctions.afterUnlinkFacebookFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkfacebook"))
	}
	if goAfterReqFunctions.afterUnlinkFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterUnlinkFacebookInstantGameFunction = goAfterReqFunctions.afterUnlinkFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if goAfterReqFunctions.afterUnlinkGameCenterFunction != nil {
		allAfterReqFunctions.afterUnlinkGameCenterFunction = goAfterReqFunctions.afterUnlinkGameCenterFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if goAfterReqFunctions.afterUnlinkGoogleFunction != nil {
		allAfterReqFunctions.afterUnlinkGoogleFunction = goAfterReqFunctions.afterUnlinkGoogleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkgoogle"))
	}
	if goAfterReqFunctions.afterUnlinkSteamFunction != nil {
		allAfterReqFunctions.afterUnlinkSteamFunction = goAfterReqFunctions.afterUnlinkSteamFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinksteam"))
	}
	if goAfterReqFunctions.afterGetUsersFunction != nil {
		allAfterReqFunctions.afterGetUsersFunction = goAfterReqFunctions.afterGetUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "getusers"))
	}
	if goAfterReqFunctions.afterEventFunction != nil {
		allAfterReqFunctions.afterEventFunction = goAfterReqFunctions.afterEventFunction
		startupLogger.Info("Registered Go runtime After custom events function invocation")
	}

	var allMatchmakerMatchedFunction RuntimeMatchmakerMatchedFunction
	switch {
	case goMatchmakerMatchedFunction != nil:
		allMatchmakerMatchedFunction = goMatchmakerMatchedFunction
		startupLogger.Info("Registered Go runtime Matchmaker Matched function invocation")
	case luaMatchmakerMatchedFunction != nil:
		allMatchmakerMatchedFunction = luaMatchmakerMatchedFunction
		startupLogger.Info("Registered Lua runtime Matchmaker Matched function invocation")
	}

	var allTournamentEndFunction RuntimeTournamentEndFunction
	switch {
	case goTournamentEndFunction != nil:
		allTournamentEndFunction = goTournamentEndFunction
		startupLogger.Info("Registered Go runtime Tournament End function invocation")
	case luaTournamentEndFunction != nil:
		allTournamentEndFunction = luaTournamentEndFunction
		startupLogger.Info("Registered Lua runtime Tournament End function invocation")
	}

	var allTournamentResetFunction RuntimeTournamentResetFunction
	switch {
	case goTournamentResetFunction != nil:
		allTournamentResetFunction = goTournamentResetFunction
		startupLogger.Info("Registered Go runtime Tournament Reset function invocation")
	case luaTournamentResetFunction != nil:
		allTournamentResetFunction = luaTournamentResetFunction
		startupLogger.Info("Registered Lua runtime Tournament Reset function invocation")
	}

	var allLeaderboardResetFunction RuntimeLeaderboardResetFunction
	switch {
	case goLeaderboardResetFunction != nil:
		allLeaderboardResetFunction = goLeaderboardResetFunction
		startupLogger.Info("Registered Go runtime Leaderboard Reset function invocation")
	case luaLeaderboardResetFunction != nil:
		allLeaderboardResetFunction = luaLeaderboardResetFunction
		startupLogger.Info("Registered Lua runtime Leaderboard Reset function invocation")
	}

	// Lua matches are not registered the same, list only Go ones.
	goMatchNames := goMatchNamesListFn()
	for _, name := range goMatchNames {
		startupLogger.Info("Registered Go runtime Match creation function invocation", zap.String("name", name))
	}

	return &Runtime{
		matchCreateFunction:       allMatchCreateFn,
		rpcFunctions:              allRPCFunctions,
		beforeRtFunctions:         allBeforeRtFunctions,
		afterRtFunctions:          allAfterRtFunctions,
		beforeReqFunctions:        allBeforeReqFunctions,
		afterReqFunctions:         allAfterReqFunctions,
		matchmakerMatchedFunction: allMatchmakerMatchedFunction,
		tournamentEndFunction:     allTournamentEndFunction,
		tournamentResetFunction:   allTournamentResetFunction,
		leaderboardResetFunction:  allLeaderboardResetFunction,
		eventFunctions:            allEventFunctions,
	}, nil
}

func (r *Runtime) MatchCreateFunction() RuntimeMatchCreateFunction {
	return r.matchCreateFunction
}

func (r *Runtime) Rpc(id string) RuntimeRpcFunction {
	return r.rpcFunctions[id]
}

func (r *Runtime) BeforeRt(id string) RuntimeBeforeRtFunction {
	return r.beforeRtFunctions[id]
}

func (r *Runtime) AfterRt(id string) RuntimeAfterRtFunction {
	return r.afterRtFunctions[id]
}

func (r *Runtime) BeforeGetAccount() RuntimeBeforeGetAccountFunction {
	return r.beforeReqFunctions.beforeGetAccountFunction
}

func (r *Runtime) AfterGetAccount() RuntimeAfterGetAccountFunction {
	return r.afterReqFunctions.afterGetAccountFunction
}

func (r *Runtime) BeforeUpdateAccount() RuntimeBeforeUpdateAccountFunction {
	return r.beforeReqFunctions.beforeUpdateAccountFunction
}

func (r *Runtime) AfterUpdateAccount() RuntimeAfterUpdateAccountFunction {
	return r.afterReqFunctions.afterUpdateAccountFunction
}

func (r *Runtime) BeforeAuthenticateCustom() RuntimeBeforeAuthenticateCustomFunction {
	return r.beforeReqFunctions.beforeAuthenticateCustomFunction
}

func (r *Runtime) AfterAuthenticateCustom() RuntimeAfterAuthenticateCustomFunction {
	return r.afterReqFunctions.afterAuthenticateCustomFunction
}

func (r *Runtime) BeforeAuthenticateDevice() RuntimeBeforeAuthenticateDeviceFunction {
	return r.beforeReqFunctions.beforeAuthenticateDeviceFunction
}

func (r *Runtime) AfterAuthenticateDevice() RuntimeAfterAuthenticateDeviceFunction {
	return r.afterReqFunctions.afterAuthenticateDeviceFunction
}

func (r *Runtime) BeforeAuthenticateEmail() RuntimeBeforeAuthenticateEmailFunction {
	return r.beforeReqFunctions.beforeAuthenticateEmailFunction
}

func (r *Runtime) AfterAuthenticateEmail() RuntimeAfterAuthenticateEmailFunction {
	return r.afterReqFunctions.afterAuthenticateEmailFunction
}

func (r *Runtime) BeforeAuthenticateFacebook() RuntimeBeforeAuthenticateFacebookFunction {
	return r.beforeReqFunctions.beforeAuthenticateFacebookFunction
}

func (r *Runtime) AfterAuthenticateFacebook() RuntimeAfterAuthenticateFacebookFunction {
	return r.afterReqFunctions.afterAuthenticateFacebookFunction
}

func (r *Runtime) BeforeAuthenticateFacebookInstantGame() RuntimeBeforeAuthenticateFacebookInstantGameFunction {
	return r.beforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction
}

func (r *Runtime) AfterAuthenticateFacebookInstantGame() RuntimeAfterAuthenticateFacebookInstantGameFunction {
	return r.afterReqFunctions.afterAuthenticateFacebookInstantGameFunction
}

func (r *Runtime) BeforeAuthenticateGameCenter() RuntimeBeforeAuthenticateGameCenterFunction {
	return r.beforeReqFunctions.beforeAuthenticateGameCenterFunction
}

func (r *Runtime) AfterAuthenticateGameCenter() RuntimeAfterAuthenticateGameCenterFunction {
	return r.afterReqFunctions.afterAuthenticateGameCenterFunction
}

func (r *Runtime) BeforeAuthenticateGoogle() RuntimeBeforeAuthenticateGoogleFunction {
	return r.beforeReqFunctions.beforeAuthenticateGoogleFunction
}

func (r *Runtime) AfterAuthenticateGoogle() RuntimeAfterAuthenticateGoogleFunction {
	return r.afterReqFunctions.afterAuthenticateGoogleFunction
}

func (r *Runtime) BeforeAuthenticateSteam() RuntimeBeforeAuthenticateSteamFunction {
	return r.beforeReqFunctions.beforeAuthenticateSteamFunction
}

func (r *Runtime) AfterAuthenticateSteam() RuntimeAfterAuthenticateSteamFunction {
	return r.afterReqFunctions.afterAuthenticateSteamFunction
}

func (r *Runtime) BeforeListChannelMessages() RuntimeBeforeListChannelMessagesFunction {
	return r.beforeReqFunctions.beforeListChannelMessagesFunction
}

func (r *Runtime) AfterListChannelMessages() RuntimeAfterListChannelMessagesFunction {
	return r.afterReqFunctions.afterListChannelMessagesFunction
}

func (r *Runtime) BeforeListFriends() RuntimeBeforeListFriendsFunction {
	return r.beforeReqFunctions.beforeListFriendsFunction
}

func (r *Runtime) AfterListFriends() RuntimeAfterListFriendsFunction {
	return r.afterReqFunctions.afterListFriendsFunction
}

func (r *Runtime) BeforeAddFriends() RuntimeBeforeAddFriendsFunction {
	return r.beforeReqFunctions.beforeAddFriendsFunction
}

func (r *Runtime) AfterAddFriends() RuntimeAfterAddFriendsFunction {
	return r.afterReqFunctions.afterAddFriendsFunction
}

func (r *Runtime) BeforeDeleteFriends() RuntimeBeforeDeleteFriendsFunction {
	return r.beforeReqFunctions.beforeDeleteFriendsFunction
}

func (r *Runtime) AfterDeleteFriends() RuntimeAfterDeleteFriendsFunction {
	return r.afterReqFunctions.afterDeleteFriendsFunction
}

func (r *Runtime) BeforeBlockFriends() RuntimeBeforeBlockFriendsFunction {
	return r.beforeReqFunctions.beforeBlockFriendsFunction
}

func (r *Runtime) AfterBlockFriends() RuntimeAfterBlockFriendsFunction {
	return r.afterReqFunctions.afterBlockFriendsFunction
}

func (r *Runtime) BeforeImportFacebookFriends() RuntimeBeforeImportFacebookFriendsFunction {
	return r.beforeReqFunctions.beforeImportFacebookFriendsFunction
}

func (r *Runtime) AfterImportFacebookFriends() RuntimeAfterImportFacebookFriendsFunction {
	return r.afterReqFunctions.afterImportFacebookFriendsFunction
}

func (r *Runtime) BeforeCreateGroup() RuntimeBeforeCreateGroupFunction {
	return r.beforeReqFunctions.beforeCreateGroupFunction
}

func (r *Runtime) AfterCreateGroup() RuntimeAfterCreateGroupFunction {
	return r.afterReqFunctions.afterCreateGroupFunction
}

func (r *Runtime) BeforeUpdateGroup() RuntimeBeforeUpdateGroupFunction {
	return r.beforeReqFunctions.beforeUpdateGroupFunction
}

func (r *Runtime) AfterUpdateGroup() RuntimeAfterUpdateGroupFunction {
	return r.afterReqFunctions.afterUpdateGroupFunction
}

func (r *Runtime) BeforeDeleteGroup() RuntimeBeforeDeleteGroupFunction {
	return r.beforeReqFunctions.beforeDeleteGroupFunction
}

func (r *Runtime) AfterDeleteGroup() RuntimeAfterDeleteGroupFunction {
	return r.afterReqFunctions.afterDeleteGroupFunction
}

func (r *Runtime) BeforeJoinGroup() RuntimeBeforeJoinGroupFunction {
	return r.beforeReqFunctions.beforeJoinGroupFunction
}

func (r *Runtime) AfterJoinGroup() RuntimeAfterJoinGroupFunction {
	return r.afterReqFunctions.afterJoinGroupFunction
}

func (r *Runtime) BeforeLeaveGroup() RuntimeBeforeLeaveGroupFunction {
	return r.beforeReqFunctions.beforeLeaveGroupFunction
}

func (r *Runtime) AfterLeaveGroup() RuntimeAfterLeaveGroupFunction {
	return r.afterReqFunctions.afterLeaveGroupFunction
}

func (r *Runtime) BeforeAddGroupUsers() RuntimeBeforeAddGroupUsersFunction {
	return r.beforeReqFunctions.beforeAddGroupUsersFunction
}

func (r *Runtime) AfterAddGroupUsers() RuntimeAfterAddGroupUsersFunction {
	return r.afterReqFunctions.afterAddGroupUsersFunction
}

func (r *Runtime) BeforeBanGroupUsers() RuntimeBeforeBanGroupUsersFunction {
	return r.beforeReqFunctions.beforeBanGroupUsersFunction
}

func (r *Runtime) AfterBanGroupUsers() RuntimeAfterBanGroupUsersFunction {
	return r.afterReqFunctions.afterBanGroupUsersFunction
}

func (r *Runtime) BeforeKickGroupUsers() RuntimeBeforeKickGroupUsersFunction {
	return r.beforeReqFunctions.beforeKickGroupUsersFunction
}

func (r *Runtime) AfterKickGroupUsers() RuntimeAfterKickGroupUsersFunction {
	return r.afterReqFunctions.afterKickGroupUsersFunction
}

func (r *Runtime) BeforePromoteGroupUsers() RuntimeBeforePromoteGroupUsersFunction {
	return r.beforeReqFunctions.beforePromoteGroupUsersFunction
}

func (r *Runtime) AfterPromoteGroupUsers() RuntimeAfterPromoteGroupUsersFunction {
	return r.afterReqFunctions.afterPromoteGroupUsersFunction
}

func (r *Runtime) BeforeListGroupUsers() RuntimeBeforeListGroupUsersFunction {
	return r.beforeReqFunctions.beforeListGroupUsersFunction
}

func (r *Runtime) AfterListGroupUsers() RuntimeAfterListGroupUsersFunction {
	return r.afterReqFunctions.afterListGroupUsersFunction
}

func (r *Runtime) BeforeListUserGroups() RuntimeBeforeListUserGroupsFunction {
	return r.beforeReqFunctions.beforeListUserGroupsFunction
}

func (r *Runtime) AfterListUserGroups() RuntimeAfterListUserGroupsFunction {
	return r.afterReqFunctions.afterListUserGroupsFunction
}

func (r *Runtime) BeforeListGroups() RuntimeBeforeListGroupsFunction {
	return r.beforeReqFunctions.beforeListGroupsFunction
}

func (r *Runtime) AfterListGroups() RuntimeAfterListGroupsFunction {
	return r.afterReqFunctions.afterListGroupsFunction
}

func (r *Runtime) BeforeDeleteLeaderboardRecord() RuntimeBeforeDeleteLeaderboardRecordFunction {
	return r.beforeReqFunctions.beforeDeleteLeaderboardRecordFunction
}

func (r *Runtime) AfterDeleteLeaderboardRecord() RuntimeAfterDeleteLeaderboardRecordFunction {
	return r.afterReqFunctions.afterDeleteLeaderboardRecordFunction
}

func (r *Runtime) BeforeListLeaderboardRecords() RuntimeBeforeListLeaderboardRecordsFunction {
	return r.beforeReqFunctions.beforeListLeaderboardRecordsFunction
}

func (r *Runtime) AfterListLeaderboardRecords() RuntimeAfterListLeaderboardRecordsFunction {
	return r.afterReqFunctions.afterListLeaderboardRecordsFunction
}

func (r *Runtime) BeforeWriteLeaderboardRecord() RuntimeBeforeWriteLeaderboardRecordFunction {
	return r.beforeReqFunctions.beforeWriteLeaderboardRecordFunction
}

func (r *Runtime) AfterWriteLeaderboardRecord() RuntimeAfterWriteLeaderboardRecordFunction {
	return r.afterReqFunctions.afterWriteLeaderboardRecordFunction
}

func (r *Runtime) BeforeListLeaderboardRecordsAroundOwner() RuntimeBeforeListLeaderboardRecordsAroundOwnerFunction {
	return r.beforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction
}

func (r *Runtime) AfterListLeaderboardRecordsAroundOwner() RuntimeAfterListLeaderboardRecordsAroundOwnerFunction {
	return r.afterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction
}

func (r *Runtime) BeforeLinkCustom() RuntimeBeforeLinkCustomFunction {
	return r.beforeReqFunctions.beforeLinkCustomFunction
}

func (r *Runtime) AfterLinkCustom() RuntimeAfterLinkCustomFunction {
	return r.afterReqFunctions.afterLinkCustomFunction
}

func (r *Runtime) BeforeLinkDevice() RuntimeBeforeLinkDeviceFunction {
	return r.beforeReqFunctions.beforeLinkDeviceFunction
}

func (r *Runtime) AfterLinkDevice() RuntimeAfterLinkDeviceFunction {
	return r.afterReqFunctions.afterLinkDeviceFunction
}

func (r *Runtime) BeforeLinkEmail() RuntimeBeforeLinkEmailFunction {
	return r.beforeReqFunctions.beforeLinkEmailFunction
}

func (r *Runtime) AfterLinkEmail() RuntimeAfterLinkEmailFunction {
	return r.afterReqFunctions.afterLinkEmailFunction
}

func (r *Runtime) BeforeLinkFacebook() RuntimeBeforeLinkFacebookFunction {
	return r.beforeReqFunctions.beforeLinkFacebookFunction
}

func (r *Runtime) AfterLinkFacebook() RuntimeAfterLinkFacebookFunction {
	return r.afterReqFunctions.afterLinkFacebookFunction
}

func (r *Runtime) BeforeLinkFacebookInstantGame() RuntimeBeforeLinkFacebookInstantGameFunction {
	return r.beforeReqFunctions.beforeLinkFacebookInstantGameFunction
}

func (r *Runtime) AfterLinkFacebookInstantGame() RuntimeAfterLinkFacebookInstantGameFunction {
	return r.afterReqFunctions.afterLinkFacebookInstantGameFunction
}

func (r *Runtime) BeforeLinkGameCenter() RuntimeBeforeLinkGameCenterFunction {
	return r.beforeReqFunctions.beforeLinkGameCenterFunction
}

func (r *Runtime) AfterLinkGameCenter() RuntimeAfterLinkGameCenterFunction {
	return r.afterReqFunctions.afterLinkGameCenterFunction
}

func (r *Runtime) BeforeLinkGoogle() RuntimeBeforeLinkGoogleFunction {
	return r.beforeReqFunctions.beforeLinkGoogleFunction
}

func (r *Runtime) AfterLinkGoogle() RuntimeAfterLinkGoogleFunction {
	return r.afterReqFunctions.afterLinkGoogleFunction
}

func (r *Runtime) BeforeLinkSteam() RuntimeBeforeLinkSteamFunction {
	return r.beforeReqFunctions.beforeLinkSteamFunction
}

func (r *Runtime) AfterLinkSteam() RuntimeAfterLinkSteamFunction {
	return r.afterReqFunctions.afterLinkSteamFunction
}

func (r *Runtime) BeforeListMatches() RuntimeBeforeListMatchesFunction {
	return r.beforeReqFunctions.beforeListMatchesFunction
}

func (r *Runtime) AfterListMatches() RuntimeAfterListMatchesFunction {
	return r.afterReqFunctions.afterListMatchesFunction
}

func (r *Runtime) BeforeListNotifications() RuntimeBeforeListNotificationsFunction {
	return r.beforeReqFunctions.beforeListNotificationsFunction
}

func (r *Runtime) AfterListNotifications() RuntimeAfterListNotificationsFunction {
	return r.afterReqFunctions.afterListNotificationsFunction
}

func (r *Runtime) BeforeDeleteNotification() RuntimeBeforeDeleteNotificationFunction {
	return r.beforeReqFunctions.beforeDeleteNotificationFunction
}

func (r *Runtime) AfterDeleteNotification() RuntimeAfterDeleteNotificationFunction {
	return r.afterReqFunctions.afterDeleteNotificationFunction
}

func (r *Runtime) BeforeListStorageObjects() RuntimeBeforeListStorageObjectsFunction {
	return r.beforeReqFunctions.beforeListStorageObjectsFunction
}

func (r *Runtime) AfterListStorageObjects() RuntimeAfterListStorageObjectsFunction {
	return r.afterReqFunctions.afterListStorageObjectsFunction
}

func (r *Runtime) BeforeReadStorageObjects() RuntimeBeforeReadStorageObjectsFunction {
	return r.beforeReqFunctions.beforeReadStorageObjectsFunction
}

func (r *Runtime) AfterReadStorageObjects() RuntimeAfterReadStorageObjectsFunction {
	return r.afterReqFunctions.afterReadStorageObjectsFunction
}

func (r *Runtime) BeforeWriteStorageObjects() RuntimeBeforeWriteStorageObjectsFunction {
	return r.beforeReqFunctions.beforeWriteStorageObjectsFunction
}

func (r *Runtime) AfterWriteStorageObjects() RuntimeAfterWriteStorageObjectsFunction {
	return r.afterReqFunctions.afterWriteStorageObjectsFunction
}

func (r *Runtime) BeforeDeleteStorageObjects() RuntimeBeforeDeleteStorageObjectsFunction {
	return r.beforeReqFunctions.beforeDeleteStorageObjectsFunction
}

func (r *Runtime) AfterDeleteStorageObjects() RuntimeAfterDeleteStorageObjectsFunction {
	return r.afterReqFunctions.afterDeleteStorageObjectsFunction
}

func (r *Runtime) BeforeJoinTournament() RuntimeBeforeJoinTournamentFunction {
	return r.beforeReqFunctions.beforeJoinTournamentFunction
}

func (r *Runtime) AfterJoinTournament() RuntimeAfterJoinTournamentFunction {
	return r.afterReqFunctions.afterJoinTournamentFunction
}

func (r *Runtime) BeforeListTournamentRecords() RuntimeBeforeListTournamentRecordsFunction {
	return r.beforeReqFunctions.beforeListTournamentRecordsFunction
}

func (r *Runtime) AfterListTournamentRecords() RuntimeAfterListTournamentRecordsFunction {
	return r.afterReqFunctions.afterListTournamentRecordsFunction
}

func (r *Runtime) BeforeListTournaments() RuntimeBeforeListTournamentsFunction {
	return r.beforeReqFunctions.beforeListTournamentsFunction
}

func (r *Runtime) AfterListTournaments() RuntimeAfterListTournamentsFunction {
	return r.afterReqFunctions.afterListTournamentsFunction
}

func (r *Runtime) BeforeWriteTournamentRecord() RuntimeBeforeWriteTournamentRecordFunction {
	return r.beforeReqFunctions.beforeWriteTournamentRecordFunction
}

func (r *Runtime) AfterWriteTournamentRecord() RuntimeAfterWriteTournamentRecordFunction {
	return r.afterReqFunctions.afterWriteTournamentRecordFunction
}

func (r *Runtime) BeforeListTournamentRecordsAroundOwner() RuntimeBeforeListTournamentRecordsAroundOwnerFunction {
	return r.beforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction
}

func (r *Runtime) AfterListTournamentRecordsAroundOwner() RuntimeAfterListTournamentRecordsAroundOwnerFunction {
	return r.afterReqFunctions.afterListTournamentRecordsAroundOwnerFunction
}

func (r *Runtime) BeforeUnlinkCustom() RuntimeBeforeUnlinkCustomFunction {
	return r.beforeReqFunctions.beforeUnlinkCustomFunction
}

func (r *Runtime) AfterUnlinkCustom() RuntimeAfterUnlinkCustomFunction {
	return r.afterReqFunctions.afterUnlinkCustomFunction
}

func (r *Runtime) BeforeUnlinkDevice() RuntimeBeforeUnlinkDeviceFunction {
	return r.beforeReqFunctions.beforeUnlinkDeviceFunction
}

func (r *Runtime) AfterUnlinkDevice() RuntimeAfterUnlinkDeviceFunction {
	return r.afterReqFunctions.afterUnlinkDeviceFunction
}

func (r *Runtime) BeforeUnlinkEmail() RuntimeBeforeUnlinkEmailFunction {
	return r.beforeReqFunctions.beforeUnlinkEmailFunction
}

func (r *Runtime) AfterUnlinkEmail() RuntimeAfterUnlinkEmailFunction {
	return r.afterReqFunctions.afterUnlinkEmailFunction
}

func (r *Runtime) BeforeUnlinkFacebook() RuntimeBeforeUnlinkFacebookFunction {
	return r.beforeReqFunctions.beforeUnlinkFacebookFunction
}

func (r *Runtime) AfterUnlinkFacebook() RuntimeAfterUnlinkFacebookFunction {
	return r.afterReqFunctions.afterUnlinkFacebookFunction
}

func (r *Runtime) BeforeUnlinkFacebookInstantGame() RuntimeBeforeUnlinkFacebookInstantGameFunction {
	return r.beforeReqFunctions.beforeUnlinkFacebookInstantGameFunction
}

func (r *Runtime) AfterUnlinkFacebookInstantGame() RuntimeAfterUnlinkFacebookInstantGameFunction {
	return r.afterReqFunctions.afterUnlinkFacebookInstantGameFunction
}

func (r *Runtime) BeforeUnlinkGameCenter() RuntimeBeforeUnlinkGameCenterFunction {
	return r.beforeReqFunctions.beforeUnlinkGameCenterFunction
}

func (r *Runtime) AfterUnlinkGameCenter() RuntimeAfterUnlinkGameCenterFunction {
	return r.afterReqFunctions.afterUnlinkGameCenterFunction
}

func (r *Runtime) BeforeUnlinkGoogle() RuntimeBeforeUnlinkGoogleFunction {
	return r.beforeReqFunctions.beforeUnlinkGoogleFunction
}

func (r *Runtime) AfterUnlinkGoogle() RuntimeAfterUnlinkGoogleFunction {
	return r.afterReqFunctions.afterUnlinkGoogleFunction
}

func (r *Runtime) BeforeUnlinkSteam() RuntimeBeforeUnlinkSteamFunction {
	return r.beforeReqFunctions.beforeUnlinkSteamFunction
}

func (r *Runtime) AfterUnlinkSteam() RuntimeAfterUnlinkSteamFunction {
	return r.afterReqFunctions.afterUnlinkSteamFunction
}

func (r *Runtime) BeforeGetUsers() RuntimeBeforeGetUsersFunction {
	return r.beforeReqFunctions.beforeGetUsersFunction
}

func (r *Runtime) AfterGetUsers() RuntimeAfterGetUsersFunction {
	return r.afterReqFunctions.afterGetUsersFunction
}

func (r *Runtime) BeforeEvent() RuntimeBeforeEventFunction {
	return r.beforeReqFunctions.beforeEventFunction
}

func (r *Runtime) AfterEvent() RuntimeAfterEventFunction {
	return r.afterReqFunctions.afterEventFunction
}

func (r *Runtime) MatchmakerMatched() RuntimeMatchmakerMatchedFunction {
	return r.matchmakerMatchedFunction
}

func (r *Runtime) TournamentEnd() RuntimeTournamentEndFunction {
	return r.tournamentEndFunction
}

func (r *Runtime) TournamentReset() RuntimeTournamentResetFunction {
	return r.tournamentResetFunction
}

func (r *Runtime) LeaderboardReset() RuntimeLeaderboardResetFunction {
	return r.leaderboardResetFunction
}

func (r *Runtime) Event() RuntimeEventCustomFunction {
	return r.eventFunctions.eventFunction
}

func (r *Runtime) EventSessionStart() RuntimeEventSessionStartFunction {
	return r.eventFunctions.sessionStartFunction
}

func (r *Runtime) EventSessionEnd() RuntimeEventSessionEndFunction {
	return r.eventFunctions.sessionEndFunction
}
