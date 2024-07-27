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
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

var (
	ErrRuntimeRPCNotFound = errors.New("RPC function not found")
)

const API_PREFIX = "/nakama.api.Nakama/"
const RTAPI_PREFIX = "*rtapi.Envelope_"

var API_PREFIX_LOWERCASE = strings.ToLower(API_PREFIX)
var RTAPI_PREFIX_LOWERCASE = strings.ToLower(RTAPI_PREFIX)

type (
	RuntimeRpcFunction func(ctx context.Context, headers, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang, payload string) (string, error, codes.Code)

	RuntimeBeforeRtFunction func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, in *rtapi.Envelope) (*rtapi.Envelope, error)
	RuntimeAfterRtFunction  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, out, in *rtapi.Envelope) error

	RuntimeBeforeGetAccountFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code)
	RuntimeAfterGetAccountFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Account) error
	RuntimeBeforeUpdateAccountFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, codes.Code)
	RuntimeAfterUpdateAccountFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) error
	RuntimeBeforeDeleteAccountFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code)
	RuntimeAfterDeleteAccountFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) error
	RuntimeBeforeSessionRefreshFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionRefreshRequest) (*api.SessionRefreshRequest, error, codes.Code)
	RuntimeAfterSessionRefreshFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.SessionRefreshRequest) error
	RuntimeBeforeSessionLogoutFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionLogoutRequest) (*api.SessionLogoutRequest, error, codes.Code)
	RuntimeAfterSessionLogoutFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionLogoutRequest) error
	RuntimeBeforeAuthenticateAppleFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateAppleRequest) (*api.AuthenticateAppleRequest, error, codes.Code)
	RuntimeAfterAuthenticateAppleFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateAppleRequest) error
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
	RuntimeBeforeListFriendsOfFriendsFunction              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListFriendsOfFriendsRequest) (*api.ListFriendsOfFriendsRequest, error, codes.Code)
	RuntimeAfterListFriendsOfFriendsFunction               func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.FriendsOfFriendsList) error
	RuntimeBeforeAddFriendsFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, codes.Code)
	RuntimeAfterAddFriendsFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) error
	RuntimeBeforeDeleteFriendsFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, codes.Code)
	RuntimeAfterDeleteFriendsFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) error
	RuntimeBeforeBlockFriendsFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, codes.Code)
	RuntimeAfterBlockFriendsFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) error
	RuntimeBeforeImportFacebookFriendsFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, codes.Code)
	RuntimeAfterImportFacebookFriendsFunction              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) error
	RuntimeBeforeImportSteamFriendsFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportSteamFriendsRequest) (*api.ImportSteamFriendsRequest, error, codes.Code)
	RuntimeAfterImportSteamFriendsFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportSteamFriendsRequest) error
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
	RuntimeBeforeDemoteGroupUsersFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DemoteGroupUsersRequest) (*api.DemoteGroupUsersRequest, error, codes.Code)
	RuntimeAfterDemoteGroupUsersFunction                   func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DemoteGroupUsersRequest) error
	RuntimeBeforeListGroupUsersFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, codes.Code)
	RuntimeAfterListGroupUsersFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupUserList, in *api.ListGroupUsersRequest) error
	RuntimeBeforeListUserGroupsFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, codes.Code)
	RuntimeAfterListUserGroupsFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.UserGroupList, in *api.ListUserGroupsRequest) error
	RuntimeBeforeListGroupsFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, codes.Code)
	RuntimeAfterListGroupsFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupList, in *api.ListGroupsRequest) error
	RuntimeBeforeDeleteLeaderboardRecordFunction           func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, codes.Code)
	RuntimeAfterDeleteLeaderboardRecordFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) error
	RuntimeBeforeDeleteTournamentRecordFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteTournamentRecordRequest) (*api.DeleteTournamentRecordRequest, error, codes.Code)
	RuntimeAfterDeleteTournamentRecordFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteTournamentRecordRequest) error
	RuntimeBeforeListLeaderboardRecordsFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, codes.Code)
	RuntimeAfterListLeaderboardRecordsFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsRequest) error
	RuntimeBeforeWriteLeaderboardRecordFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, codes.Code)
	RuntimeAfterWriteLeaderboardRecordFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteLeaderboardRecordRequest) error
	RuntimeBeforeListLeaderboardRecordsAroundOwnerFunction func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, codes.Code)
	RuntimeAfterListLeaderboardRecordsAroundOwnerFunction  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsAroundOwnerRequest) error
	RuntimeBeforeLinkAppleFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) (*api.AccountApple, error, codes.Code)
	RuntimeAfterLinkAppleFunction                          func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) error
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
	RuntimeBeforeLinkSteamFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkSteamRequest) (*api.LinkSteamRequest, error, codes.Code)
	RuntimeAfterLinkSteamFunction                          func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkSteamRequest) error
	RuntimeBeforeListMatchesFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, codes.Code)
	RuntimeAfterListMatchesFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.MatchList, in *api.ListMatchesRequest) error
	RuntimeBeforeListNotificationsFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, codes.Code)
	RuntimeAfterListNotificationsFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.NotificationList, in *api.ListNotificationsRequest) error
	RuntimeBeforeDeleteNotificationsFunction               func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, codes.Code)
	RuntimeAfterDeleteNotificationsFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) error
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
	RuntimeBeforeUnlinkAppleFunction                       func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) (*api.AccountApple, error, codes.Code)
	RuntimeAfterUnlinkAppleFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) error
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
	RuntimeBeforeValidatePurchaseAppleFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseAppleRequest) (*api.ValidatePurchaseAppleRequest, error, codes.Code)
	RuntimeAfterValidatePurchaseAppleFunction              func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseAppleRequest) error
	RuntimeBeforeValidateSubscriptionAppleFunction         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidateSubscriptionAppleRequest) (*api.ValidateSubscriptionAppleRequest, error, codes.Code)
	RuntimeAfterValidateSubscriptionAppleFunction          func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionAppleRequest) error
	RuntimeBeforeValidatePurchaseGoogleFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseGoogleRequest) (*api.ValidatePurchaseGoogleRequest, error, codes.Code)
	RuntimeAfterValidatePurchaseGoogleFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseGoogleRequest) error
	RuntimeBeforeValidateSubscriptionGoogleFunction        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidateSubscriptionGoogleRequest) (*api.ValidateSubscriptionGoogleRequest, error, codes.Code)
	RuntimeAfterValidateSubscriptionGoogleFunction         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionGoogleRequest) error
	RuntimeBeforeValidatePurchaseHuaweiFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseHuaweiRequest) (*api.ValidatePurchaseHuaweiRequest, error, codes.Code)
	RuntimeAfterValidatePurchaseHuaweiFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseHuaweiRequest) error
	RuntimeBeforeValidatePurchaseFacebookInstantFunction   func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseFacebookInstantRequest) (*api.ValidatePurchaseFacebookInstantRequest, error, codes.Code)
	RuntimeAfterValidatePurchaseFacebookInstantFunction    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseFacebookInstantRequest) error
	RuntimeBeforeListSubscriptionsFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListSubscriptionsRequest) (*api.ListSubscriptionsRequest, error, codes.Code)
	RuntimeAfterListSubscriptionsFunction                  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.SubscriptionList, in *api.ListSubscriptionsRequest) error
	RuntimeBeforeGetSubscriptionFunction                   func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.GetSubscriptionRequest) (*api.GetSubscriptionRequest, error, codes.Code)
	RuntimeAfterGetSubscriptionFunction                    func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatedSubscription, in *api.GetSubscriptionRequest) error
	RuntimeBeforeGetMatchmakerStatsFunction                func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code)
	RuntimeAfterGetMatchmakerStatsFunction                 func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.MatchmakerStats) error

	RuntimeMatchmakerMatchedFunction  func(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error)
	RuntimeMatchmakerOverrideFunction func(ctx context.Context, candidateMatches [][]*MatchmakerEntry) (matches [][]*MatchmakerEntry)

	RuntimeMatchCreateFunction       func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error)
	RuntimeMatchDeferMessageFunction func(msg *DeferredMessage) error

	RuntimeTournamentEndFunction   func(ctx context.Context, tournament *api.Tournament, end, reset int64) error
	RuntimeTournamentResetFunction func(ctx context.Context, tournament *api.Tournament, end, reset int64) error

	RuntimeLeaderboardResetFunction func(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error

	RuntimePurchaseNotificationAppleFunction      func(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error
	RuntimeSubscriptionNotificationAppleFunction  func(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error
	RuntimePurchaseNotificationGoogleFunction     func(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error
	RuntimeSubscriptionNotificationGoogleFunction func(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error

	RuntimeStorageIndexFilterFunction func(ctx context.Context, write *StorageOpWrite) (bool, error)

	RuntimeEventFunction func(ctx context.Context, logger runtime.Logger, evt *api.Event)

	RuntimeEventCustomFunction       func(ctx context.Context, evt *api.Event)
	RuntimeEventSessionStartFunction func(userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, evtTimeSec int64)
	RuntimeEventSessionEndFunction   func(userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, evtTimeSec int64, reason string)
	RuntimeShutdownFunction          func(ctx context.Context)
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
	RuntimeExecutionModeMatchmakerOverride
	RuntimeExecutionModeMatchCreate
	RuntimeExecutionModeTournamentEnd
	RuntimeExecutionModeTournamentReset
	RuntimeExecutionModeLeaderboardReset
	RuntimeExecutionModePurchaseNotificationApple
	RuntimeExecutionModeSubscriptionNotificationApple
	RuntimeExecutionModePurchaseNotificationGoogle
	RuntimeExecutionModeSubscriptionNotificationGoogle
	RuntimeExecutionModeStorageIndexFilter
	RuntimeExecutionModeShutdown
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
	case RuntimeExecutionModeMatchmakerOverride:
		return "matchmaker_override"
	case RuntimeExecutionModeMatchCreate:
		return "match_create"
	case RuntimeExecutionModeTournamentEnd:
		return "tournament_end"
	case RuntimeExecutionModeTournamentReset:
		return "tournament_reset"
	case RuntimeExecutionModeLeaderboardReset:
		return "leaderboard_reset"
	case RuntimeExecutionModePurchaseNotificationApple:
		return "purchase_notification_apple"
	case RuntimeExecutionModeSubscriptionNotificationApple:
		return "subscription_notification_apple"
	case RuntimeExecutionModePurchaseNotificationGoogle:
		return "purchase_notification_google"
	case RuntimeExecutionModeSubscriptionNotificationGoogle:
		return "subscription_notification_google"
	case RuntimeExecutionModeStorageIndexFilter:
		return "storage_index_filter"
	case RuntimeExecutionModeShutdown:
		return "shutdown"
	}

	return ""
}

type RuntimeMatchCore interface {
	MatchInit(presenceList *MatchPresenceList, deferMessageFn RuntimeMatchDeferMessageFunction, params map[string]interface{}) (interface{}, int, error)
	MatchJoinAttempt(tick int64, state interface{}, userID, sessionID uuid.UUID, username string, sessionExpiry int64, vars map[string]string, clientIP, clientPort, node string, metadata map[string]string) (interface{}, bool, string, error)
	MatchJoin(tick int64, state interface{}, joins []*MatchPresence) (interface{}, error)
	MatchLeave(tick int64, state interface{}, leaves []*MatchPresence) (interface{}, error)
	MatchLoop(tick int64, state interface{}, inputCh <-chan *MatchDataMessage) (interface{}, error)
	MatchTerminate(tick int64, state interface{}, graceSeconds int) (interface{}, error)
	MatchSignal(tick int64, state interface{}, data string) (interface{}, string, error)
	GetState(state interface{}) (string, error)
	Label() string
	TickRate() int
	HandlerName() string
	CreateTime() int64
	Cancel()
	Cleanup()
}

type RuntimeEventFunctions struct {
	sessionStartFunction RuntimeEventSessionStartFunction
	sessionEndFunction   RuntimeEventSessionEndFunction
	eventFunction        RuntimeEventCustomFunction
}

type moduleInfo struct {
	path    string
	modTime time.Time
}

type RuntimeInfo struct {
	GoRpcFunctions         []string
	LuaRpcFunctions        []string
	JavaScriptRpcFunctions []string
	GoModules              []*moduleInfo
	LuaModules             []*moduleInfo
	JavaScriptModules      []*moduleInfo
}

type RuntimeBeforeReqFunctions struct {
	beforeGetAccountFunction                        RuntimeBeforeGetAccountFunction
	beforeUpdateAccountFunction                     RuntimeBeforeUpdateAccountFunction
	beforeDeleteAccountFunction                     RuntimeBeforeDeleteAccountFunction
	beforeSessionRefreshFunction                    RuntimeBeforeSessionRefreshFunction
	beforeSessionLogoutFunction                     RuntimeBeforeSessionLogoutFunction
	beforeAuthenticateAppleFunction                 RuntimeBeforeAuthenticateAppleFunction
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
	beforeListFriendsOfFriendsFunction              RuntimeBeforeListFriendsOfFriendsFunction
	beforeAddFriendsFunction                        RuntimeBeforeAddFriendsFunction
	beforeDeleteFriendsFunction                     RuntimeBeforeDeleteFriendsFunction
	beforeBlockFriendsFunction                      RuntimeBeforeBlockFriendsFunction
	beforeImportFacebookFriendsFunction             RuntimeBeforeImportFacebookFriendsFunction
	beforeImportSteamFriendsFunction                RuntimeBeforeImportSteamFriendsFunction
	beforeCreateGroupFunction                       RuntimeBeforeCreateGroupFunction
	beforeUpdateGroupFunction                       RuntimeBeforeUpdateGroupFunction
	beforeDeleteGroupFunction                       RuntimeBeforeDeleteGroupFunction
	beforeJoinGroupFunction                         RuntimeBeforeJoinGroupFunction
	beforeLeaveGroupFunction                        RuntimeBeforeLeaveGroupFunction
	beforeAddGroupUsersFunction                     RuntimeBeforeAddGroupUsersFunction
	beforeBanGroupUsersFunction                     RuntimeBeforeBanGroupUsersFunction
	beforeKickGroupUsersFunction                    RuntimeBeforeKickGroupUsersFunction
	beforePromoteGroupUsersFunction                 RuntimeBeforePromoteGroupUsersFunction
	beforeDemoteGroupUsersFunction                  RuntimeBeforeDemoteGroupUsersFunction
	beforeListGroupUsersFunction                    RuntimeBeforeListGroupUsersFunction
	beforeListUserGroupsFunction                    RuntimeBeforeListUserGroupsFunction
	beforeListGroupsFunction                        RuntimeBeforeListGroupsFunction
	beforeDeleteLeaderboardRecordFunction           RuntimeBeforeDeleteLeaderboardRecordFunction
	beforeDeleteTournamentRecordFunction            RuntimeBeforeDeleteTournamentRecordFunction
	beforeListLeaderboardRecordsFunction            RuntimeBeforeListLeaderboardRecordsFunction
	beforeWriteLeaderboardRecordFunction            RuntimeBeforeWriteLeaderboardRecordFunction
	beforeListLeaderboardRecordsAroundOwnerFunction RuntimeBeforeListLeaderboardRecordsAroundOwnerFunction
	beforeLinkAppleFunction                         RuntimeBeforeLinkAppleFunction
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
	beforeDeleteNotificationsFunction               RuntimeBeforeDeleteNotificationsFunction
	beforeListStorageObjectsFunction                RuntimeBeforeListStorageObjectsFunction
	beforeReadStorageObjectsFunction                RuntimeBeforeReadStorageObjectsFunction
	beforeWriteStorageObjectsFunction               RuntimeBeforeWriteStorageObjectsFunction
	beforeDeleteStorageObjectsFunction              RuntimeBeforeDeleteStorageObjectsFunction
	beforeJoinTournamentFunction                    RuntimeBeforeJoinTournamentFunction
	beforeListTournamentRecordsFunction             RuntimeBeforeListTournamentRecordsFunction
	beforeListTournamentsFunction                   RuntimeBeforeListTournamentsFunction
	beforeWriteTournamentRecordFunction             RuntimeBeforeWriteTournamentRecordFunction
	beforeListTournamentRecordsAroundOwnerFunction  RuntimeBeforeListTournamentRecordsAroundOwnerFunction
	beforeUnlinkAppleFunction                       RuntimeBeforeUnlinkAppleFunction
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
	beforeValidatePurchaseAppleFunction             RuntimeBeforeValidatePurchaseAppleFunction
	beforeValidateSubscriptionAppleFunction         RuntimeBeforeValidateSubscriptionAppleFunction
	beforeValidatePurchaseGoogleFunction            RuntimeBeforeValidatePurchaseGoogleFunction
	beforeValidateSubscriptionGoogleFunction        RuntimeBeforeValidateSubscriptionGoogleFunction
	beforeValidatePurchaseHuaweiFunction            RuntimeBeforeValidatePurchaseHuaweiFunction
	beforeValidatePurchaseFacebookInstantFunction   RuntimeBeforeValidatePurchaseFacebookInstantFunction
	beforeListSubscriptionsFunction                 RuntimeBeforeListSubscriptionsFunction
	beforeGetSubscriptionFunction                   RuntimeBeforeGetSubscriptionFunction
	beforeGetMatchmakerStatsFunction                RuntimeBeforeGetMatchmakerStatsFunction
}

type RuntimeAfterReqFunctions struct {
	afterGetAccountFunction                        RuntimeAfterGetAccountFunction
	afterUpdateAccountFunction                     RuntimeAfterUpdateAccountFunction
	afterDeleteAccountFunction                     RuntimeAfterDeleteAccountFunction
	afterSessionRefreshFunction                    RuntimeAfterSessionRefreshFunction
	afterSessionLogoutFunction                     RuntimeAfterSessionLogoutFunction
	afterAuthenticateAppleFunction                 RuntimeAfterAuthenticateAppleFunction
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
	afterListFriendsOfFriendsFunction              RuntimeAfterListFriendsOfFriendsFunction
	afterAddFriendsFunction                        RuntimeAfterAddFriendsFunction
	afterDeleteFriendsFunction                     RuntimeAfterDeleteFriendsFunction
	afterBlockFriendsFunction                      RuntimeAfterBlockFriendsFunction
	afterImportFacebookFriendsFunction             RuntimeAfterImportFacebookFriendsFunction
	afterImportSteamFriendsFunction                RuntimeAfterImportSteamFriendsFunction
	afterCreateGroupFunction                       RuntimeAfterCreateGroupFunction
	afterUpdateGroupFunction                       RuntimeAfterUpdateGroupFunction
	afterDeleteGroupFunction                       RuntimeAfterDeleteGroupFunction
	afterJoinGroupFunction                         RuntimeAfterJoinGroupFunction
	afterLeaveGroupFunction                        RuntimeAfterLeaveGroupFunction
	afterAddGroupUsersFunction                     RuntimeAfterAddGroupUsersFunction
	afterBanGroupUsersFunction                     RuntimeAfterBanGroupUsersFunction
	afterKickGroupUsersFunction                    RuntimeAfterKickGroupUsersFunction
	afterPromoteGroupUsersFunction                 RuntimeAfterPromoteGroupUsersFunction
	afterDemoteGroupUsersFunction                  RuntimeAfterDemoteGroupUsersFunction
	afterListGroupUsersFunction                    RuntimeAfterListGroupUsersFunction
	afterListUserGroupsFunction                    RuntimeAfterListUserGroupsFunction
	afterListGroupsFunction                        RuntimeAfterListGroupsFunction
	afterDeleteLeaderboardRecordFunction           RuntimeAfterDeleteLeaderboardRecordFunction
	afterDeleteTournamentRecordFunction            RuntimeAfterDeleteTournamentRecordFunction
	afterListLeaderboardRecordsFunction            RuntimeAfterListLeaderboardRecordsFunction
	afterWriteLeaderboardRecordFunction            RuntimeAfterWriteLeaderboardRecordFunction
	afterListLeaderboardRecordsAroundOwnerFunction RuntimeAfterListLeaderboardRecordsAroundOwnerFunction
	afterLinkAppleFunction                         RuntimeAfterLinkAppleFunction
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
	afterDeleteNotificationsFunction               RuntimeAfterDeleteNotificationsFunction
	afterListStorageObjectsFunction                RuntimeAfterListStorageObjectsFunction
	afterReadStorageObjectsFunction                RuntimeAfterReadStorageObjectsFunction
	afterWriteStorageObjectsFunction               RuntimeAfterWriteStorageObjectsFunction
	afterDeleteStorageObjectsFunction              RuntimeAfterDeleteStorageObjectsFunction
	afterJoinTournamentFunction                    RuntimeAfterJoinTournamentFunction
	afterListTournamentRecordsFunction             RuntimeAfterListTournamentRecordsFunction
	afterListTournamentsFunction                   RuntimeAfterListTournamentsFunction
	afterWriteTournamentRecordFunction             RuntimeAfterWriteTournamentRecordFunction
	afterListTournamentRecordsAroundOwnerFunction  RuntimeAfterListTournamentRecordsAroundOwnerFunction
	afterUnlinkAppleFunction                       RuntimeAfterUnlinkAppleFunction
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
	afterValidatePurchaseAppleFunction             RuntimeAfterValidatePurchaseAppleFunction
	afterValidateSubscriptionAppleFunction         RuntimeAfterValidateSubscriptionAppleFunction
	afterValidatePurchaseGoogleFunction            RuntimeAfterValidatePurchaseGoogleFunction
	afterValidateSubscriptionGoogleFunction        RuntimeAfterValidateSubscriptionGoogleFunction
	afterValidatePurchaseHuaweiFunction            RuntimeAfterValidatePurchaseHuaweiFunction
	afterValidatePurchaseFacebookInstantFunction   RuntimeAfterValidatePurchaseFacebookInstantFunction
	afterListSubscriptionsFunction                 RuntimeAfterListSubscriptionsFunction
	afterGetSubscriptionFunction                   RuntimeAfterGetSubscriptionFunction
	afterGetMatchmakerStatsFunction                RuntimeAfterGetMatchmakerStatsFunction
}

type Runtime struct {
	matchCreateFunction RuntimeMatchCreateFunction

	rpcFunctions map[string]RuntimeRpcFunction

	beforeRtFunctions map[string]RuntimeBeforeRtFunction
	afterRtFunctions  map[string]RuntimeAfterRtFunction

	beforeReqFunctions *RuntimeBeforeReqFunctions
	afterReqFunctions  *RuntimeAfterReqFunctions

	matchmakerMatchedFunction  RuntimeMatchmakerMatchedFunction
	matchmakerOverrideFunction RuntimeMatchmakerOverrideFunction

	tournamentEndFunction                  RuntimeTournamentEndFunction
	tournamentResetFunction                RuntimeTournamentResetFunction
	purchaseNotificationAppleFunction      RuntimePurchaseNotificationAppleFunction
	subscriptionNotificationAppleFunction  RuntimeSubscriptionNotificationAppleFunction
	purchaseNotificationGoogleFunction     RuntimePurchaseNotificationGoogleFunction
	subscriptionNotificationGoogleFunction RuntimeSubscriptionNotificationGoogleFunction

	storageIndexFilterFunctions map[string]RuntimeStorageIndexFilterFunction

	leaderboardResetFunction RuntimeLeaderboardResetFunction

	eventFunctions *RuntimeEventFunctions

	shutdownFunction RuntimeShutdownFunction

	fleetManager runtime.FleetManager
}

type MatchNamesListFunction func() []string

type MatchProvider struct {
	sync.RWMutex
	providers     []RuntimeMatchCreateFunction
	providerNames []string
}

func (mp *MatchProvider) RegisterCreateFn(name string, fn RuntimeMatchCreateFunction) {
	mp.Lock()
	newProviders := make([]RuntimeMatchCreateFunction, len(mp.providers)+1)
	copy(newProviders, mp.providers)
	newProviders[len(mp.providers)] = fn
	mp.providers = newProviders

	newProviderNames := make([]string, len(mp.providerNames)+1)
	copy(newProviderNames, mp.providerNames)
	newProviderNames[len(mp.providerNames)] = name
	mp.providerNames = newProviderNames
	mp.Unlock()
}

func (mp *MatchProvider) CreateMatch(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error) {
	mp.RLock()
	providers := mp.providers
	mp.RUnlock()
	for _, p := range providers {
		core, err := p(ctx, logger, id, node, stopped, name)
		if err != nil {
			return nil, err
		}
		if core != nil {
			return core, nil
		}
	}
	return nil, nil
}

func NewMatchProvider() *MatchProvider {
	return &MatchProvider{
		providers:     make([]RuntimeMatchCreateFunction, 0),
		providerNames: make([]string, 0),
	}
}

func GetRuntimePaths(logger *zap.Logger, rootPath string) ([]string, error) {
	if err := os.MkdirAll(rootPath, os.ModePerm); err != nil {
		return nil, err
	}

	paths := make([]string, 0, 5)
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

func CheckRuntime(logger *zap.Logger, config Config, version string) error {
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
	err = CheckRuntimeProviderLua(logger, config, version, paths)
	if err != nil {
		return err
	}

	// Check any JavaScript runtime modules.
	err = CheckRuntimeProviderJavascript(logger, config, version)
	if err != nil {
		return err
	}

	return nil
}

func NewRuntime(ctx context.Context, logger, startupLogger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, version string, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, storageIndex StorageIndex, fmCallbackHandler runtime.FmCallbackHandler) (*Runtime, *RuntimeInfo, error) {
	runtimeConfig := config.GetRuntime()
	startupLogger.Info("Initialising runtime", zap.String("path", runtimeConfig.Path))

	paths, err := GetRuntimePaths(startupLogger, runtimeConfig.Path)
	if err != nil {
		return nil, nil, err
	}

	startupLogger.Info("Initialising runtime event queue processor")
	eventQueue := NewRuntimeEventQueue(logger, config, metrics)
	startupLogger.Info("Runtime event queue processor started", zap.Int("size", config.GetRuntime().EventQueueSize), zap.Int("workers", config.GetRuntime().EventQueueWorkers))

	matchProvider := NewMatchProvider()

	goModules, goRPCFns, goBeforeRtFns, goAfterRtFns, goBeforeReqFns, goAfterReqFns, goMatchmakerMatchedFn, goMatchmakerCustomMatchingFn, goTournamentEndFn, goTournamentResetFn, goLeaderboardResetFn, goShutdownFn, goPurchaseNotificationAppleFn, goSubscriptionNotificationAppleFn, goPurchaseNotificationGoogleFn, goSubscriptionNotificationGoogleFn, goIndexFilterFns, fleetManager, allEventFns, goMatchNamesListFn, err := NewRuntimeProviderGo(ctx, logger, startupLogger, db, protojsonMarshaler, config, version, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, storageIndex, runtimeConfig.Path, paths, eventQueue, matchProvider, fmCallbackHandler)
	if err != nil {
		startupLogger.Error("Error initialising Go runtime provider", zap.Error(err))
		return nil, nil, err
	}

	luaModules, luaRPCFns, luaBeforeRtFns, luaAfterRtFns, luaBeforeReqFns, luaAfterReqFns, luaMatchmakerMatchedFn, luaTournamentEndFn, luaTournamentResetFn, luaLeaderboardResetFn, luaShutdownFn, luaPurchaseNotificationAppleFn, luaSubscriptionNotificationAppleFn, luaPurchaseNotificationGoogleFn, luaSubscriptionNotificationGoogleFn, luaIndexFilterFns, err := NewRuntimeProviderLua(ctx, logger, startupLogger, db, protojsonMarshaler, protojsonUnmarshaler, config, version, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, allEventFns.eventFunction, runtimeConfig.Path, paths, matchProvider, storageIndex)
	if err != nil {
		startupLogger.Error("Error initialising Lua runtime provider", zap.Error(err))
		return nil, nil, err
	}

	jsModules, jsRPCFns, jsBeforeRtFns, jsAfterRtFns, jsBeforeReqFns, jsAfterReqFns, jsMatchmakerMatchedFn, jsTournamentEndFn, jsTournamentResetFn, jsLeaderboardResetFn, jsShutdownFn, jsPurchaseNotificationAppleFn, jsSubscriptionNotificationAppleFn, jsPurchaseNotificationGoogleFn, jsSubscriptionNotificationGoogleFn, jsIndexFilterFns, err := NewRuntimeProviderJS(ctx, logger, startupLogger, db, protojsonMarshaler, protojsonUnmarshaler, config, version, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, allEventFns.eventFunction, runtimeConfig.Path, runtimeConfig.JsEntrypoint, matchProvider, storageIndex)
	if err != nil {
		startupLogger.Error("Error initialising JavaScript runtime provider", zap.Error(err))
		return nil, nil, err
	}

	allModules := make([]string, 0, len(jsModules)+len(luaModules)+len(goModules))
	allModules = append(allModules, jsModules...)
	allModules = append(allModules, luaModules...)
	allModules = append(allModules, goModules...)

	startupLogger.Info("Found runtime modules", zap.Int("count", len(allModules)), zap.Strings("modules", allModules))

	if allEventFns.eventFunction != nil {
		startupLogger.Info("Registered event function invocation for custom events")
	}
	if allEventFns.sessionStartFunction != nil {
		startupLogger.Info("Registered event function invocation", zap.String("id", "session_start"))
	}
	if allEventFns.sessionEndFunction != nil {
		startupLogger.Info("Registered event function invocation", zap.String("id", "session_end"))
	}

	allRPCFunctions := make(map[string]RuntimeRpcFunction, len(goRPCFns)+len(luaRPCFns)+len(jsRPCFns))
	jsRpcIDs := make(map[string]bool, len(jsRPCFns))
	for id, fn := range jsRPCFns {
		allRPCFunctions[id] = fn
		jsRpcIDs[id] = true
		startupLogger.Info("Registered JavaScript runtime RPC function invocation", zap.String("id", id))
	}
	luaRpcIDs := make(map[string]bool, len(luaRPCFns))
	for id, fn := range luaRPCFns {
		allRPCFunctions[id] = fn
		delete(jsRpcIDs, id)
		luaRpcIDs[id] = true
		startupLogger.Info("Registered Lua runtime RPC function invocation", zap.String("id", id))
	}
	goRpcIDs := make(map[string]bool, len(goRPCFns))
	for id, fn := range goRPCFns {
		allRPCFunctions[id] = fn
		delete(luaRpcIDs, id)
		goRpcIDs[id] = true
		startupLogger.Info("Registered Go runtime RPC function invocation", zap.String("id", id))
	}

	allBeforeRtFunctions := make(map[string]RuntimeBeforeRtFunction, len(jsBeforeRtFns)+len(luaBeforeRtFns)+len(goBeforeRtFns))
	for id, fn := range jsBeforeRtFns {
		allBeforeRtFunctions[id] = fn
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range luaBeforeRtFns {
		allBeforeRtFunctions[id] = fn
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range goBeforeRtFns {
		allBeforeRtFunctions[id] = fn
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}

	allAfterRtFunctions := make(map[string]RuntimeAfterRtFunction, len(jsAfterRtFns)+len(luaAfterRtFns)+len(goAfterRtFns))
	for id, fn := range jsAfterRtFns {
		allAfterRtFunctions[id] = fn
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range luaAfterRtFns {
		allAfterRtFunctions[id] = fn
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range goAfterRtFns {
		allAfterRtFunctions[id] = fn
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}

	allBeforeReqFunctions := jsBeforeReqFns
	// Register JavaScript Before Req functions
	if allBeforeReqFunctions.beforeGetAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "getaccount"))
	}
	if allBeforeReqFunctions.beforeGetMatchmakerStatsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "getmatchmakerstats"))
	}
	if allBeforeReqFunctions.beforeUpdateAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "updateaccount"))
	}
	if allBeforeReqFunctions.beforeDeleteAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "deleteaccount"))
	}
	if allBeforeReqFunctions.beforeSessionRefreshFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "sessionrefresh"))
	}
	if allBeforeReqFunctions.beforeSessionLogoutFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "sessionlogout"))
	}
	if allBeforeReqFunctions.beforeAuthenticateAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticateapple"))
	}
	if allBeforeReqFunctions.beforeAuthenticateCustomFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticatecustom"))
	}
	if allBeforeReqFunctions.beforeAuthenticateDeviceFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticatedevice"))
	}
	if allBeforeReqFunctions.beforeAuthenticateEmailFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticateemail"))
	}
	if allBeforeReqFunctions.beforeAuthenticateFacebookFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticatefacebook"))
	}
	if allBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if allBeforeReqFunctions.beforeAuthenticateGameCenterFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticategamecenter"))
	}
	if allBeforeReqFunctions.beforeAuthenticateGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticategoogle"))
	}
	if allBeforeReqFunctions.beforeAuthenticateSteamFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "authenticatesteam"))
	}
	if allBeforeReqFunctions.beforeListChannelMessagesFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listchannelmessages"))
	}
	if allBeforeReqFunctions.beforeListFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listfriends"))
	}
	if allBeforeReqFunctions.beforeListFriendsOfFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listfriendsoffriends"))
	}
	if allBeforeReqFunctions.beforeAddFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "addfriends"))
	}
	if allBeforeReqFunctions.beforeDeleteFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "deletefriends"))
	}
	if allBeforeReqFunctions.beforeBlockFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "blockfriends"))
	}
	if allBeforeReqFunctions.beforeImportFacebookFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "importfacebookfriends"))
	}
	if allBeforeReqFunctions.beforeImportSteamFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "importsteamfriends"))
	}
	if allBeforeReqFunctions.beforeCreateGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "creategroup"))
	}
	if allBeforeReqFunctions.beforeUpdateGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "updategroup"))
	}
	if allBeforeReqFunctions.beforeDeleteGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "deletegroup"))
	}
	if allBeforeReqFunctions.beforeJoinGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "joingroup"))
	}
	if allBeforeReqFunctions.beforeLeaveGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "leavegroup"))
	}
	if allBeforeReqFunctions.beforeAddGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "addgroupusers"))
	}
	if allBeforeReqFunctions.beforeBanGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "bangroupusers"))
	}
	if allBeforeReqFunctions.beforeKickGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "kickgroupusers"))
	}
	if allBeforeReqFunctions.beforePromoteGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "promotegroupusers"))
	}
	if allBeforeReqFunctions.beforeDemoteGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "demotegroupusers"))
	}
	if allBeforeReqFunctions.beforeListGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listgroupusers"))
	}
	if allBeforeReqFunctions.beforeListUserGroupsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listusergroups"))
	}
	if allBeforeReqFunctions.beforeListGroupsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listgroups"))
	}
	if allBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if allBeforeReqFunctions.beforeDeleteTournamentRecordFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "deletetournamentrecord"))
	}
	if allBeforeReqFunctions.beforeListLeaderboardRecordsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if allBeforeReqFunctions.beforeWriteLeaderboardRecordFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if allBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if allBeforeReqFunctions.beforeLinkAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linkapple"))
	}
	if allBeforeReqFunctions.beforeLinkCustomFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linkcustom"))
	}
	if allBeforeReqFunctions.beforeLinkDeviceFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linkdevice"))
	}
	if allBeforeReqFunctions.beforeLinkEmailFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linkemail"))
	}
	if allBeforeReqFunctions.beforeLinkFacebookFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linkfacebook"))
	}
	if allBeforeReqFunctions.beforeLinkFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if allBeforeReqFunctions.beforeLinkGameCenterFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linkgamecenter"))
	}
	if allBeforeReqFunctions.beforeLinkGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linkgoogle"))
	}
	if allBeforeReqFunctions.beforeLinkSteamFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "linksteam"))
	}
	if allBeforeReqFunctions.beforeListMatchesFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listmatches"))
	}
	if allBeforeReqFunctions.beforeListNotificationsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listnotifications"))
	}
	if allBeforeReqFunctions.beforeDeleteNotificationsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "deletenotifications"))
	}
	if allBeforeReqFunctions.beforeListStorageObjectsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "liststorageobjects"))
	}
	if allBeforeReqFunctions.beforeReadStorageObjectsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "readstorageobjects"))
	}
	if allBeforeReqFunctions.beforeWriteStorageObjectsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "writestorageobjects"))
	}
	if allBeforeReqFunctions.beforeDeleteStorageObjectsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "deletestorageobjects"))
	}
	if allBeforeReqFunctions.beforeJoinTournamentFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "jointournament"))
	}
	if allBeforeReqFunctions.beforeListTournamentRecordsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listtournamentrecords"))
	}
	if allBeforeReqFunctions.beforeListTournamentsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listtournaments"))
	}
	if allBeforeReqFunctions.beforeWriteTournamentRecordFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "writetournamentrecord"))
	}
	if allBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if allBeforeReqFunctions.beforeUnlinkAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinkapple"))
	}
	if allBeforeReqFunctions.beforeUnlinkCustomFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinkcustom"))
	}
	if allBeforeReqFunctions.beforeUnlinkDeviceFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinkdevice"))
	}
	if allBeforeReqFunctions.beforeUnlinkEmailFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinkemail"))
	}
	if allBeforeReqFunctions.beforeUnlinkFacebookFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinkfacebook"))
	}
	if allBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if allBeforeReqFunctions.beforeUnlinkGameCenterFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if allBeforeReqFunctions.beforeUnlinkGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinkgoogle"))
	}
	if allBeforeReqFunctions.beforeUnlinkSteamFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "unlinksteam"))
	}
	if allBeforeReqFunctions.beforeGetUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "getusers"))
	}
	if allBeforeReqFunctions.beforeValidatePurchaseAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if allBeforeReqFunctions.beforeValidatePurchaseGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if allBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if allBeforeReqFunctions.beforeValidatePurchaseFacebookInstantFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatepurchasefacebookinstant"))
	}
	if allBeforeReqFunctions.beforeValidateSubscriptionAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatesubscriptionapple"))
	}
	if allBeforeReqFunctions.beforeValidateSubscriptionGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatesubscriptiongoogle"))
	}
	if allBeforeReqFunctions.beforeGetSubscriptionFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "getsubscription"))
	}
	if allBeforeReqFunctions.beforeListSubscriptionsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listsubscriptions"))
	}
	if allBeforeReqFunctions.beforeEventFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before custom events function invocation")
	}

	// Register Lua Before Req functions
	if luaBeforeReqFns.beforeGetAccountFunction != nil {
		allBeforeReqFunctions.beforeGetAccountFunction = luaBeforeReqFns.beforeGetAccountFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "getaccount"))
	}
	if luaBeforeReqFns.beforeGetMatchmakerStatsFunction != nil {
		allBeforeReqFunctions.beforeGetMatchmakerStatsFunction = luaBeforeReqFns.beforeGetMatchmakerStatsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "getmatchmakerstats"))
	}
	if luaBeforeReqFns.beforeUpdateAccountFunction != nil {
		allBeforeReqFunctions.beforeUpdateAccountFunction = luaBeforeReqFns.beforeUpdateAccountFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "updateaccount"))
	}
	if luaBeforeReqFns.beforeDeleteAccountFunction != nil {
		allBeforeReqFunctions.beforeDeleteAccountFunction = luaBeforeReqFns.beforeDeleteAccountFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deleteaccount"))
	}
	if luaBeforeReqFns.beforeSessionRefreshFunction != nil {
		allBeforeReqFunctions.beforeSessionRefreshFunction = luaBeforeReqFns.beforeSessionRefreshFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "sessionrefresh"))
	}
	if luaBeforeReqFns.beforeSessionLogoutFunction != nil {
		allBeforeReqFunctions.beforeSessionLogoutFunction = luaBeforeReqFns.beforeSessionLogoutFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "sessionlogout"))
	}
	if luaBeforeReqFns.beforeAuthenticateAppleFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateAppleFunction = luaBeforeReqFns.beforeAuthenticateAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticateapple"))
	}
	if luaBeforeReqFns.beforeAuthenticateCustomFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateCustomFunction = luaBeforeReqFns.beforeAuthenticateCustomFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatecustom"))
	}
	if luaBeforeReqFns.beforeAuthenticateDeviceFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateDeviceFunction = luaBeforeReqFns.beforeAuthenticateDeviceFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatedevice"))
	}
	if luaBeforeReqFns.beforeAuthenticateEmailFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateEmailFunction = luaBeforeReqFns.beforeAuthenticateEmailFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticateemail"))
	}
	if luaBeforeReqFns.beforeAuthenticateFacebookFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateFacebookFunction = luaBeforeReqFns.beforeAuthenticateFacebookFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatefacebook"))
	}
	if luaBeforeReqFns.beforeAuthenticateFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction = luaBeforeReqFns.beforeAuthenticateFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if luaBeforeReqFns.beforeAuthenticateGameCenterFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateGameCenterFunction = luaBeforeReqFns.beforeAuthenticateGameCenterFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticategamecenter"))
	}
	if luaBeforeReqFns.beforeAuthenticateGoogleFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateGoogleFunction = luaBeforeReqFns.beforeAuthenticateGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticategoogle"))
	}
	if luaBeforeReqFns.beforeAuthenticateSteamFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateSteamFunction = luaBeforeReqFns.beforeAuthenticateSteamFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatesteam"))
	}
	if luaBeforeReqFns.beforeListChannelMessagesFunction != nil {
		allBeforeReqFunctions.beforeListChannelMessagesFunction = luaBeforeReqFns.beforeListChannelMessagesFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listchannelmessages"))
	}
	if luaBeforeReqFns.beforeListFriendsFunction != nil {
		allBeforeReqFunctions.beforeListFriendsFunction = luaBeforeReqFns.beforeListFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listfriends"))
	}
	if luaBeforeReqFns.beforeListFriendsOfFriendsFunction != nil {
		allBeforeReqFunctions.beforeListFriendsOfFriendsFunction = luaBeforeReqFns.beforeListFriendsOfFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listfriendsoffriends"))
	}
	if luaBeforeReqFns.beforeAddFriendsFunction != nil {
		allBeforeReqFunctions.beforeAddFriendsFunction = luaBeforeReqFns.beforeAddFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "addfriends"))
	}
	if luaBeforeReqFns.beforeDeleteFriendsFunction != nil {
		allBeforeReqFunctions.beforeDeleteFriendsFunction = luaBeforeReqFns.beforeDeleteFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletefriends"))
	}
	if luaBeforeReqFns.beforeBlockFriendsFunction != nil {
		allBeforeReqFunctions.beforeBlockFriendsFunction = luaBeforeReqFns.beforeBlockFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "blockfriends"))
	}
	if luaBeforeReqFns.beforeImportFacebookFriendsFunction != nil {
		allBeforeReqFunctions.beforeImportFacebookFriendsFunction = luaBeforeReqFns.beforeImportFacebookFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "importfacebookfriends"))
	}
	if luaBeforeReqFns.beforeImportSteamFriendsFunction != nil {
		allBeforeReqFunctions.beforeImportSteamFriendsFunction = luaBeforeReqFns.beforeImportSteamFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "importsteamfriends"))
	}
	if luaBeforeReqFns.beforeCreateGroupFunction != nil {
		allBeforeReqFunctions.beforeCreateGroupFunction = luaBeforeReqFns.beforeCreateGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "creategroup"))
	}
	if luaBeforeReqFns.beforeUpdateGroupFunction != nil {
		allBeforeReqFunctions.beforeUpdateGroupFunction = luaBeforeReqFns.beforeUpdateGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "updategroup"))
	}
	if luaBeforeReqFns.beforeDeleteGroupFunction != nil {
		allBeforeReqFunctions.beforeDeleteGroupFunction = luaBeforeReqFns.beforeDeleteGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletegroup"))
	}
	if luaBeforeReqFns.beforeJoinGroupFunction != nil {
		allBeforeReqFunctions.beforeJoinGroupFunction = luaBeforeReqFns.beforeJoinGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "joingroup"))
	}
	if luaBeforeReqFns.beforeLeaveGroupFunction != nil {
		allBeforeReqFunctions.beforeLeaveGroupFunction = luaBeforeReqFns.beforeLeaveGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "leavegroup"))
	}
	if luaBeforeReqFns.beforeAddGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeAddGroupUsersFunction = luaBeforeReqFns.beforeAddGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "addgroupusers"))
	}
	if luaBeforeReqFns.beforeBanGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeBanGroupUsersFunction = luaBeforeReqFns.beforeBanGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "bangroupusers"))
	}
	if luaBeforeReqFns.beforeKickGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeKickGroupUsersFunction = luaBeforeReqFns.beforeKickGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "kickgroupusers"))
	}
	if luaBeforeReqFns.beforePromoteGroupUsersFunction != nil {
		allBeforeReqFunctions.beforePromoteGroupUsersFunction = luaBeforeReqFns.beforePromoteGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "promotegroupusers"))
	}
	if luaBeforeReqFns.beforeListGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeListGroupUsersFunction = luaBeforeReqFns.beforeListGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listgroupusers"))
	}
	if luaBeforeReqFns.beforeListUserGroupsFunction != nil {
		allBeforeReqFunctions.beforeListUserGroupsFunction = luaBeforeReqFns.beforeListUserGroupsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listusergroups"))
	}
	if luaBeforeReqFns.beforeListGroupsFunction != nil {
		allBeforeReqFunctions.beforeListGroupsFunction = luaBeforeReqFns.beforeListGroupsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listgroups"))
	}
	if luaBeforeReqFns.beforeDeleteLeaderboardRecordFunction != nil {
		allBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction = luaBeforeReqFns.beforeDeleteLeaderboardRecordFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if luaBeforeReqFns.beforeDeleteTournamentRecordFunction != nil {
		allBeforeReqFunctions.beforeDeleteTournamentRecordFunction = luaBeforeReqFns.beforeDeleteTournamentRecordFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletetournamentrecord"))
	}
	if luaBeforeReqFns.beforeListLeaderboardRecordsFunction != nil {
		allBeforeReqFunctions.beforeListLeaderboardRecordsFunction = luaBeforeReqFns.beforeListLeaderboardRecordsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if luaBeforeReqFns.beforeWriteLeaderboardRecordFunction != nil {
		allBeforeReqFunctions.beforeWriteLeaderboardRecordFunction = luaBeforeReqFns.beforeWriteLeaderboardRecordFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if luaBeforeReqFns.beforeListLeaderboardRecordsAroundOwnerFunction != nil {
		allBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction = luaBeforeReqFns.beforeListLeaderboardRecordsAroundOwnerFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if luaBeforeReqFns.beforeLinkAppleFunction != nil {
		allBeforeReqFunctions.beforeLinkAppleFunction = luaBeforeReqFns.beforeLinkAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkapple"))
	}
	if luaBeforeReqFns.beforeLinkCustomFunction != nil {
		allBeforeReqFunctions.beforeLinkCustomFunction = luaBeforeReqFns.beforeLinkCustomFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkcustom"))
	}
	if luaBeforeReqFns.beforeLinkDeviceFunction != nil {
		allBeforeReqFunctions.beforeLinkDeviceFunction = luaBeforeReqFns.beforeLinkDeviceFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkdevice"))
	}
	if luaBeforeReqFns.beforeLinkEmailFunction != nil {
		allBeforeReqFunctions.beforeLinkEmailFunction = luaBeforeReqFns.beforeLinkEmailFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkemail"))
	}
	if luaBeforeReqFns.beforeLinkFacebookFunction != nil {
		allBeforeReqFunctions.beforeLinkFacebookFunction = luaBeforeReqFns.beforeLinkFacebookFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkfacebook"))
	}
	if luaBeforeReqFns.beforeLinkFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeLinkFacebookInstantGameFunction = luaBeforeReqFns.beforeLinkFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if luaBeforeReqFns.beforeLinkGameCenterFunction != nil {
		allBeforeReqFunctions.beforeLinkGameCenterFunction = luaBeforeReqFns.beforeLinkGameCenterFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkgamecenter"))
	}
	if luaBeforeReqFns.beforeLinkGoogleFunction != nil {
		allBeforeReqFunctions.beforeLinkGoogleFunction = luaBeforeReqFns.beforeLinkGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkgoogle"))
	}
	if luaBeforeReqFns.beforeLinkSteamFunction != nil {
		allBeforeReqFunctions.beforeLinkSteamFunction = luaBeforeReqFns.beforeLinkSteamFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linksteam"))
	}
	if luaBeforeReqFns.beforeListMatchesFunction != nil {
		allBeforeReqFunctions.beforeListMatchesFunction = luaBeforeReqFns.beforeListMatchesFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listmatches"))
	}
	if luaBeforeReqFns.beforeListNotificationsFunction != nil {
		allBeforeReqFunctions.beforeListNotificationsFunction = luaBeforeReqFns.beforeListNotificationsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listnotifications"))
	}
	if luaBeforeReqFns.beforeDeleteNotificationsFunction != nil {
		allBeforeReqFunctions.beforeDeleteNotificationsFunction = luaBeforeReqFns.beforeDeleteNotificationsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletenotifications"))
	}
	if luaBeforeReqFns.beforeListStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeListStorageObjectsFunction = luaBeforeReqFns.beforeListStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "liststorageobjects"))
	}
	if luaBeforeReqFns.beforeReadStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeReadStorageObjectsFunction = luaBeforeReqFns.beforeReadStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "readstorageobjects"))
	}
	if luaBeforeReqFns.beforeWriteStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeWriteStorageObjectsFunction = luaBeforeReqFns.beforeWriteStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writestorageobjects"))
	}
	if luaBeforeReqFns.beforeDeleteStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeDeleteStorageObjectsFunction = luaBeforeReqFns.beforeDeleteStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletestorageobjects"))
	}
	if luaBeforeReqFns.beforeJoinTournamentFunction != nil {
		allBeforeReqFunctions.beforeJoinTournamentFunction = luaBeforeReqFns.beforeJoinTournamentFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "jointournament"))
	}
	if luaBeforeReqFns.beforeListTournamentRecordsFunction != nil {
		allBeforeReqFunctions.beforeListTournamentRecordsFunction = luaBeforeReqFns.beforeListTournamentRecordsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournamentrecords"))
	}
	if luaBeforeReqFns.beforeListTournamentsFunction != nil {
		allBeforeReqFunctions.beforeListTournamentsFunction = luaBeforeReqFns.beforeListTournamentsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournaments"))
	}
	if luaBeforeReqFns.beforeWriteTournamentRecordFunction != nil {
		allBeforeReqFunctions.beforeWriteTournamentRecordFunction = luaBeforeReqFns.beforeWriteTournamentRecordFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writetournamentrecord"))
	}
	if luaBeforeReqFns.beforeListTournamentRecordsAroundOwnerFunction != nil {
		allBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction = luaBeforeReqFns.beforeListTournamentRecordsAroundOwnerFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if luaBeforeReqFns.beforeUnlinkAppleFunction != nil {
		allBeforeReqFunctions.beforeUnlinkAppleFunction = luaBeforeReqFns.beforeUnlinkAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkapple"))
	}
	if luaBeforeReqFns.beforeUnlinkCustomFunction != nil {
		allBeforeReqFunctions.beforeUnlinkCustomFunction = luaBeforeReqFns.beforeUnlinkCustomFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkcustom"))
	}
	if luaBeforeReqFns.beforeUnlinkDeviceFunction != nil {
		allBeforeReqFunctions.beforeUnlinkDeviceFunction = luaBeforeReqFns.beforeUnlinkDeviceFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkdevice"))
	}
	if luaBeforeReqFns.beforeUnlinkEmailFunction != nil {
		allBeforeReqFunctions.beforeUnlinkEmailFunction = luaBeforeReqFns.beforeUnlinkEmailFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkemail"))
	}
	if luaBeforeReqFns.beforeUnlinkFacebookFunction != nil {
		allBeforeReqFunctions.beforeUnlinkFacebookFunction = luaBeforeReqFns.beforeUnlinkFacebookFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkfacebook"))
	}
	if luaBeforeReqFns.beforeUnlinkFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction = luaBeforeReqFns.beforeUnlinkFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if luaBeforeReqFns.beforeUnlinkGameCenterFunction != nil {
		allBeforeReqFunctions.beforeUnlinkGameCenterFunction = luaBeforeReqFns.beforeUnlinkGameCenterFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if luaBeforeReqFns.beforeUnlinkGoogleFunction != nil {
		allBeforeReqFunctions.beforeUnlinkGoogleFunction = luaBeforeReqFns.beforeUnlinkGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkgoogle"))
	}
	if luaBeforeReqFns.beforeUnlinkSteamFunction != nil {
		allBeforeReqFunctions.beforeUnlinkSteamFunction = luaBeforeReqFns.beforeUnlinkSteamFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinksteam"))
	}
	if luaBeforeReqFns.beforeGetUsersFunction != nil {
		allBeforeReqFunctions.beforeGetUsersFunction = luaBeforeReqFns.beforeGetUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "getusers"))
	}
	if luaBeforeReqFns.beforeValidatePurchaseAppleFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseAppleFunction = luaBeforeReqFns.beforeValidatePurchaseAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if luaBeforeReqFns.beforeValidatePurchaseGoogleFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseGoogleFunction = luaBeforeReqFns.beforeValidatePurchaseGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if luaBeforeReqFns.beforeValidatePurchaseHuaweiFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction = luaBeforeReqFns.beforeValidatePurchaseHuaweiFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if luaBeforeReqFns.beforeValidatePurchaseFacebookInstantFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseFacebookInstantFunction = luaBeforeReqFns.beforeValidatePurchaseFacebookInstantFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchasefacebookinstant"))
	}
	if luaBeforeReqFns.beforeValidateSubscriptionAppleFunction != nil {
		allBeforeReqFunctions.beforeValidateSubscriptionAppleFunction = luaBeforeReqFns.beforeValidateSubscriptionAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatesubscriptionapple"))
	}
	if luaBeforeReqFns.beforeValidateSubscriptionGoogleFunction != nil {
		allBeforeReqFunctions.beforeValidateSubscriptionGoogleFunction = luaBeforeReqFns.beforeValidateSubscriptionGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatesubscriptiongoogle"))
	}
	if luaBeforeReqFns.beforeGetSubscriptionFunction != nil {
		allBeforeReqFunctions.beforeGetSubscriptionFunction = luaBeforeReqFns.beforeGetSubscriptionFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "getsubscription"))
	}
	if luaBeforeReqFns.beforeListSubscriptionsFunction != nil {
		allBeforeReqFunctions.beforeListSubscriptionsFunction = luaBeforeReqFns.beforeListSubscriptionsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listsubscriptions"))
	}
	if luaBeforeReqFns.beforeEventFunction != nil {
		allBeforeReqFunctions.beforeEventFunction = luaBeforeReqFns.beforeEventFunction
		startupLogger.Info("Registered Lua runtime Before custom events function invocation")
	}

	// Register Go Before Req functions
	if goBeforeReqFns.beforeGetAccountFunction != nil {
		allBeforeReqFunctions.beforeGetAccountFunction = goBeforeReqFns.beforeGetAccountFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "getaccount"))
	}
	if goBeforeReqFns.beforeGetMatchmakerStatsFunction != nil {
		allBeforeReqFunctions.beforeGetMatchmakerStatsFunction = goBeforeReqFns.beforeGetMatchmakerStatsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "getmatchmakerstats"))
	}
	if goBeforeReqFns.beforeUpdateAccountFunction != nil {
		allBeforeReqFunctions.beforeUpdateAccountFunction = goBeforeReqFns.beforeUpdateAccountFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "updateaccount"))
	}
	if goBeforeReqFns.beforeDeleteAccountFunction != nil {
		allBeforeReqFunctions.beforeDeleteAccountFunction = goBeforeReqFns.beforeDeleteAccountFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deleteaccount"))
	}
	if goBeforeReqFns.beforeSessionRefreshFunction != nil {
		allBeforeReqFunctions.beforeSessionRefreshFunction = goBeforeReqFns.beforeSessionRefreshFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "sessionrefresh"))
	}
	if goBeforeReqFns.beforeSessionLogoutFunction != nil {
		allBeforeReqFunctions.beforeSessionLogoutFunction = goBeforeReqFns.beforeSessionLogoutFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "sessionlogout"))
	}
	if goBeforeReqFns.beforeAuthenticateAppleFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateAppleFunction = goBeforeReqFns.beforeAuthenticateAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticateapple"))
	}
	if goBeforeReqFns.beforeAuthenticateCustomFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateCustomFunction = goBeforeReqFns.beforeAuthenticateCustomFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatecustom"))
	}
	if goBeforeReqFns.beforeAuthenticateDeviceFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateDeviceFunction = goBeforeReqFns.beforeAuthenticateDeviceFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatedevice"))
	}
	if goBeforeReqFns.beforeAuthenticateEmailFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateEmailFunction = goBeforeReqFns.beforeAuthenticateEmailFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticateemail"))
	}
	if goBeforeReqFns.beforeAuthenticateFacebookFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateFacebookFunction = goBeforeReqFns.beforeAuthenticateFacebookFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatefacebook"))
	}
	if goBeforeReqFns.beforeAuthenticateFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction = goBeforeReqFns.beforeAuthenticateFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if goBeforeReqFns.beforeAuthenticateGameCenterFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateGameCenterFunction = goBeforeReqFns.beforeAuthenticateGameCenterFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticategamecenter"))
	}
	if goBeforeReqFns.beforeAuthenticateGoogleFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateGoogleFunction = goBeforeReqFns.beforeAuthenticateGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticategoogle"))
	}
	if goBeforeReqFns.beforeAuthenticateSteamFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateSteamFunction = goBeforeReqFns.beforeAuthenticateSteamFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticatesteam"))
	}
	if goBeforeReqFns.beforeListChannelMessagesFunction != nil {
		allBeforeReqFunctions.beforeListChannelMessagesFunction = goBeforeReqFns.beforeListChannelMessagesFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listchannelmessages"))
	}
	if goBeforeReqFns.beforeListFriendsFunction != nil {
		allBeforeReqFunctions.beforeListFriendsFunction = goBeforeReqFns.beforeListFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listfriends"))
	}
	if goBeforeReqFns.beforeAddFriendsFunction != nil {
		allBeforeReqFunctions.beforeAddFriendsFunction = goBeforeReqFns.beforeAddFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "addfriends"))
	}
	if goBeforeReqFns.beforeDeleteFriendsFunction != nil {
		allBeforeReqFunctions.beforeDeleteFriendsFunction = goBeforeReqFns.beforeDeleteFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletefriends"))
	}
	if goBeforeReqFns.beforeBlockFriendsFunction != nil {
		allBeforeReqFunctions.beforeBlockFriendsFunction = goBeforeReqFns.beforeBlockFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "blockfriends"))
	}
	if goBeforeReqFns.beforeImportFacebookFriendsFunction != nil {
		allBeforeReqFunctions.beforeImportFacebookFriendsFunction = goBeforeReqFns.beforeImportFacebookFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "importfacebookfriends"))
	}
	if goBeforeReqFns.beforeImportSteamFriendsFunction != nil {
		allBeforeReqFunctions.beforeImportSteamFriendsFunction = goBeforeReqFns.beforeImportSteamFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "importsteamfriends"))
	}
	if goBeforeReqFns.beforeCreateGroupFunction != nil {
		allBeforeReqFunctions.beforeCreateGroupFunction = goBeforeReqFns.beforeCreateGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "creategroup"))
	}
	if goBeforeReqFns.beforeUpdateGroupFunction != nil {
		allBeforeReqFunctions.beforeUpdateGroupFunction = goBeforeReqFns.beforeUpdateGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "updategroup"))
	}
	if goBeforeReqFns.beforeDeleteGroupFunction != nil {
		allBeforeReqFunctions.beforeDeleteGroupFunction = goBeforeReqFns.beforeDeleteGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletegroup"))
	}
	if goBeforeReqFns.beforeJoinGroupFunction != nil {
		allBeforeReqFunctions.beforeJoinGroupFunction = goBeforeReqFns.beforeJoinGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "joingroup"))
	}
	if goBeforeReqFns.beforeLeaveGroupFunction != nil {
		allBeforeReqFunctions.beforeLeaveGroupFunction = goBeforeReqFns.beforeLeaveGroupFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "leavegroup"))
	}
	if goBeforeReqFns.beforeAddGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeAddGroupUsersFunction = goBeforeReqFns.beforeAddGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "addgroupusers"))
	}
	if goBeforeReqFns.beforeBanGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeBanGroupUsersFunction = goBeforeReqFns.beforeBanGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "bangroupusers"))
	}
	if goBeforeReqFns.beforeKickGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeKickGroupUsersFunction = goBeforeReqFns.beforeKickGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "kickgroupusers"))
	}
	if goBeforeReqFns.beforePromoteGroupUsersFunction != nil {
		allBeforeReqFunctions.beforePromoteGroupUsersFunction = goBeforeReqFns.beforePromoteGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "promotegroupusers"))
	}
	if goBeforeReqFns.beforeDemoteGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeDemoteGroupUsersFunction = goBeforeReqFns.beforeDemoteGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "demotegroupusers"))
	}
	if goBeforeReqFns.beforeListGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeListGroupUsersFunction = goBeforeReqFns.beforeListGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listgroupusers"))
	}
	if goBeforeReqFns.beforeListUserGroupsFunction != nil {
		allBeforeReqFunctions.beforeListUserGroupsFunction = goBeforeReqFns.beforeListUserGroupsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listusergroups"))
	}
	if goBeforeReqFns.beforeListGroupsFunction != nil {
		allBeforeReqFunctions.beforeListGroupsFunction = goBeforeReqFns.beforeListGroupsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listgroups"))
	}
	if goBeforeReqFns.beforeDeleteLeaderboardRecordFunction != nil {
		allBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction = goBeforeReqFns.beforeDeleteLeaderboardRecordFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if goBeforeReqFns.beforeDeleteTournamentRecordFunction != nil {
		allBeforeReqFunctions.beforeDeleteTournamentRecordFunction = goBeforeReqFns.beforeDeleteTournamentRecordFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletetournamentrecord"))
	}
	if goBeforeReqFns.beforeListLeaderboardRecordsFunction != nil {
		allBeforeReqFunctions.beforeListLeaderboardRecordsFunction = goBeforeReqFns.beforeListLeaderboardRecordsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if goBeforeReqFns.beforeWriteLeaderboardRecordFunction != nil {
		allBeforeReqFunctions.beforeWriteLeaderboardRecordFunction = goBeforeReqFns.beforeWriteLeaderboardRecordFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if goBeforeReqFns.beforeListLeaderboardRecordsAroundOwnerFunction != nil {
		allBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction = goBeforeReqFns.beforeListLeaderboardRecordsAroundOwnerFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if goBeforeReqFns.beforeLinkAppleFunction != nil {
		allBeforeReqFunctions.beforeLinkAppleFunction = goBeforeReqFns.beforeLinkAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkapple"))
	}
	if goBeforeReqFns.beforeLinkCustomFunction != nil {
		allBeforeReqFunctions.beforeLinkCustomFunction = goBeforeReqFns.beforeLinkCustomFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkcustom"))
	}
	if goBeforeReqFns.beforeLinkDeviceFunction != nil {
		allBeforeReqFunctions.beforeLinkDeviceFunction = goBeforeReqFns.beforeLinkDeviceFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkdevice"))
	}
	if goBeforeReqFns.beforeLinkEmailFunction != nil {
		allBeforeReqFunctions.beforeLinkEmailFunction = goBeforeReqFns.beforeLinkEmailFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkemail"))
	}
	if goBeforeReqFns.beforeLinkFacebookFunction != nil {
		allBeforeReqFunctions.beforeLinkFacebookFunction = goBeforeReqFns.beforeLinkFacebookFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkfacebook"))
	}
	if goBeforeReqFns.beforeLinkFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeLinkFacebookInstantGameFunction = goBeforeReqFns.beforeLinkFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if goBeforeReqFns.beforeLinkGameCenterFunction != nil {
		allBeforeReqFunctions.beforeLinkGameCenterFunction = goBeforeReqFns.beforeLinkGameCenterFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkgamecenter"))
	}
	if goBeforeReqFns.beforeLinkGoogleFunction != nil {
		allBeforeReqFunctions.beforeLinkGoogleFunction = goBeforeReqFns.beforeLinkGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkgoogle"))
	}
	if goBeforeReqFns.beforeLinkSteamFunction != nil {
		allBeforeReqFunctions.beforeLinkSteamFunction = goBeforeReqFns.beforeLinkSteamFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linksteam"))
	}
	if goBeforeReqFns.beforeListMatchesFunction != nil {
		allBeforeReqFunctions.beforeListMatchesFunction = goBeforeReqFns.beforeListMatchesFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listmatches"))
	}
	if goBeforeReqFns.beforeListNotificationsFunction != nil {
		allBeforeReqFunctions.beforeListNotificationsFunction = goBeforeReqFns.beforeListNotificationsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listnotifications"))
	}
	if goBeforeReqFns.beforeDeleteNotificationsFunction != nil {
		allBeforeReqFunctions.beforeDeleteNotificationsFunction = goBeforeReqFns.beforeDeleteNotificationsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletenotifications"))
	}
	if goBeforeReqFns.beforeListStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeListStorageObjectsFunction = goBeforeReqFns.beforeListStorageObjectsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "liststorageobjects"))
	}
	if goBeforeReqFns.beforeReadStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeReadStorageObjectsFunction = goBeforeReqFns.beforeReadStorageObjectsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "readstorageobjects"))
	}
	if goBeforeReqFns.beforeWriteStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeWriteStorageObjectsFunction = goBeforeReqFns.beforeWriteStorageObjectsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "writestorageobjects"))
	}
	if goBeforeReqFns.beforeDeleteStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeDeleteStorageObjectsFunction = goBeforeReqFns.beforeDeleteStorageObjectsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "deletestorageobjects"))
	}
	if goBeforeReqFns.beforeJoinTournamentFunction != nil {
		allBeforeReqFunctions.beforeJoinTournamentFunction = goBeforeReqFns.beforeJoinTournamentFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "jointournament"))
	}
	if goBeforeReqFns.beforeListTournamentRecordsFunction != nil {
		allBeforeReqFunctions.beforeListTournamentRecordsFunction = goBeforeReqFns.beforeListTournamentRecordsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listtournamentrecords"))
	}
	if goBeforeReqFns.beforeListTournamentsFunction != nil {
		allBeforeReqFunctions.beforeListTournamentsFunction = goBeforeReqFns.beforeListTournamentsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listtournaments"))
	}
	if goBeforeReqFns.beforeWriteTournamentRecordFunction != nil {
		allBeforeReqFunctions.beforeWriteTournamentRecordFunction = goBeforeReqFns.beforeWriteTournamentRecordFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "writetournamentrecord"))
	}
	if goBeforeReqFns.beforeListTournamentRecordsAroundOwnerFunction != nil {
		allBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction = goBeforeReqFns.beforeListTournamentRecordsAroundOwnerFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if goBeforeReqFns.beforeUnlinkAppleFunction != nil {
		allBeforeReqFunctions.beforeUnlinkAppleFunction = goBeforeReqFns.beforeUnlinkAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkapple"))
	}
	if goBeforeReqFns.beforeUnlinkCustomFunction != nil {
		allBeforeReqFunctions.beforeUnlinkCustomFunction = goBeforeReqFns.beforeUnlinkCustomFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkcustom"))
	}
	if goBeforeReqFns.beforeUnlinkDeviceFunction != nil {
		allBeforeReqFunctions.beforeUnlinkDeviceFunction = goBeforeReqFns.beforeUnlinkDeviceFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkdevice"))
	}
	if goBeforeReqFns.beforeUnlinkEmailFunction != nil {
		allBeforeReqFunctions.beforeUnlinkEmailFunction = goBeforeReqFns.beforeUnlinkEmailFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkemail"))
	}
	if goBeforeReqFns.beforeUnlinkFacebookFunction != nil {
		allBeforeReqFunctions.beforeUnlinkFacebookFunction = goBeforeReqFns.beforeUnlinkFacebookFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkfacebook"))
	}
	if goBeforeReqFns.beforeUnlinkFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction = goBeforeReqFns.beforeUnlinkFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if goBeforeReqFns.beforeUnlinkGameCenterFunction != nil {
		allBeforeReqFunctions.beforeUnlinkGameCenterFunction = goBeforeReqFns.beforeUnlinkGameCenterFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if goBeforeReqFns.beforeUnlinkGoogleFunction != nil {
		allBeforeReqFunctions.beforeUnlinkGoogleFunction = goBeforeReqFns.beforeUnlinkGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkgoogle"))
	}
	if goBeforeReqFns.beforeUnlinkSteamFunction != nil {
		allBeforeReqFunctions.beforeUnlinkSteamFunction = goBeforeReqFns.beforeUnlinkSteamFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinksteam"))
	}
	if goBeforeReqFns.beforeGetUsersFunction != nil {
		allBeforeReqFunctions.beforeGetUsersFunction = goBeforeReqFns.beforeGetUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "getusers"))
	}
	if goBeforeReqFns.beforeValidatePurchaseAppleFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseAppleFunction = goBeforeReqFns.beforeValidatePurchaseAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validateapple"))
	}
	if goBeforeReqFns.beforeValidatePurchaseGoogleFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseGoogleFunction = goBeforeReqFns.beforeValidatePurchaseGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if goBeforeReqFns.beforeValidatePurchaseHuaweiFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction = goBeforeReqFns.beforeValidatePurchaseHuaweiFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if goBeforeReqFns.beforeValidatePurchaseFacebookInstantFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseFacebookInstantFunction = goBeforeReqFns.beforeValidatePurchaseFacebookInstantFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatepurchasefacebookinstant"))
	}
	if goBeforeReqFns.beforeValidateSubscriptionAppleFunction != nil {
		allBeforeReqFunctions.beforeValidateSubscriptionAppleFunction = goBeforeReqFns.beforeValidateSubscriptionAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatesubscriptionapple"))
	}
	if goBeforeReqFns.beforeValidateSubscriptionGoogleFunction != nil {
		allBeforeReqFunctions.beforeValidateSubscriptionGoogleFunction = goBeforeReqFns.beforeValidateSubscriptionGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatesubscriptiongoogle"))
	}
	if goBeforeReqFns.beforeGetSubscriptionFunction != nil {
		allBeforeReqFunctions.beforeGetSubscriptionFunction = goBeforeReqFns.beforeGetSubscriptionFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "getsubscription"))
	}
	if goBeforeReqFns.beforeListSubscriptionsFunction != nil {
		allBeforeReqFunctions.beforeListSubscriptionsFunction = goBeforeReqFns.beforeListSubscriptionsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listsubscriptions"))
	}
	if goBeforeReqFns.beforeEventFunction != nil {
		allBeforeReqFunctions.beforeEventFunction = goBeforeReqFns.beforeEventFunction
		startupLogger.Info("Registered Go runtime Before custom events function invocation")
	}

	allAfterReqFunctions := jsAfterReqFns
	// Register JavaScript After req functions
	if allAfterReqFunctions.afterGetAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "getaccount"))
	}
	if allAfterReqFunctions.afterGetMatchmakerStatsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "getmatchmakerstats"))
	}
	if allAfterReqFunctions.afterUpdateAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "updateaccount"))
	}
	if allAfterReqFunctions.afterDeleteAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "deleteaccount"))
	}
	if allAfterReqFunctions.afterSessionRefreshFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "sessionrefresh"))
	}
	if allAfterReqFunctions.afterSessionLogoutFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "sessionlogout"))
	}
	if allAfterReqFunctions.afterAuthenticateAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticateapple"))
	}
	if allAfterReqFunctions.afterAuthenticateCustomFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticatecustom"))
	}
	if allAfterReqFunctions.afterAuthenticateDeviceFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticatedevice"))
	}
	if allAfterReqFunctions.afterAuthenticateEmailFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticateemail"))
	}
	if allAfterReqFunctions.afterAuthenticateFacebookFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticatefacebook"))
	}
	if allAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if allAfterReqFunctions.afterAuthenticateGameCenterFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticategamecenter"))
	}
	if allAfterReqFunctions.afterAuthenticateGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticategoogle"))
	}
	if allAfterReqFunctions.afterAuthenticateSteamFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "authenticatesteam"))
	}
	if allAfterReqFunctions.afterListChannelMessagesFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listchannelmessages"))
	}
	if allAfterReqFunctions.afterListFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listfriends"))
	}
	if allAfterReqFunctions.afterAddFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "addfriends"))
	}
	if allAfterReqFunctions.afterDeleteFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "deletefriends"))
	}
	if allAfterReqFunctions.afterBlockFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "blockfriends"))
	}
	if allAfterReqFunctions.afterImportFacebookFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "importfacebookfriends"))
	}
	if allAfterReqFunctions.afterImportSteamFriendsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "importsteamfriends"))
	}
	if allAfterReqFunctions.afterCreateGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "creategroup"))
	}
	if allAfterReqFunctions.afterUpdateGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "updategroup"))
	}
	if allAfterReqFunctions.afterDeleteGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "deletegroup"))
	}
	if allAfterReqFunctions.afterJoinGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "joingroup"))
	}
	if allAfterReqFunctions.afterLeaveGroupFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "leavegroup"))
	}
	if allAfterReqFunctions.afterAddGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "addgroupusers"))
	}
	if allAfterReqFunctions.afterBanGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "bangroupusers"))
	}
	if allAfterReqFunctions.afterKickGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "kickgroupusers"))
	}
	if allAfterReqFunctions.afterPromoteGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "promotegroupusers"))
	}
	if allAfterReqFunctions.afterDemoteGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "demotegroupusers"))
	}
	if allAfterReqFunctions.afterListGroupUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listgroupusers"))
	}
	if allAfterReqFunctions.afterListUserGroupsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listusergroups"))
	}
	if allAfterReqFunctions.afterListGroupsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listgroups"))
	}
	if allAfterReqFunctions.afterDeleteLeaderboardRecordFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if allAfterReqFunctions.afterDeleteTournamentRecordFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "deletetournamentrecord"))
	}
	if allAfterReqFunctions.afterListLeaderboardRecordsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if allAfterReqFunctions.afterWriteLeaderboardRecordFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if allAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if allAfterReqFunctions.afterLinkAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linkapple"))
	}
	if allAfterReqFunctions.afterLinkCustomFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linkcustom"))
	}
	if allAfterReqFunctions.afterLinkDeviceFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linkdevice"))
	}
	if allAfterReqFunctions.afterLinkEmailFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linkemail"))
	}
	if allAfterReqFunctions.afterLinkFacebookFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linkfacebook"))
	}
	if allAfterReqFunctions.afterLinkFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if allAfterReqFunctions.afterLinkGameCenterFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linkgamecenter"))
	}
	if allAfterReqFunctions.afterLinkGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linkgoogle"))
	}
	if allAfterReqFunctions.afterLinkSteamFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "linksteam"))
	}
	if allAfterReqFunctions.afterListMatchesFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listmatches"))
	}
	if allAfterReqFunctions.afterListNotificationsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listnotifications"))
	}
	if allAfterReqFunctions.afterDeleteNotificationsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "deletenotifications"))
	}
	if allAfterReqFunctions.afterListStorageObjectsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "liststorageobjects"))
	}
	if allAfterReqFunctions.afterReadStorageObjectsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "readstorageobjects"))
	}
	if allAfterReqFunctions.afterWriteStorageObjectsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "writestorageobjects"))
	}
	if allAfterReqFunctions.afterDeleteStorageObjectsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "deletestorageobjects"))
	}
	if allAfterReqFunctions.afterJoinTournamentFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "jointournament"))
	}
	if allAfterReqFunctions.afterListTournamentRecordsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listtournamentrecords"))
	}
	if allAfterReqFunctions.afterListTournamentsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listtournaments"))
	}
	if allAfterReqFunctions.afterWriteTournamentRecordFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "writetournamentrecord"))
	}
	if allAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if allAfterReqFunctions.afterUnlinkAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinkapple"))
	}
	if allAfterReqFunctions.afterUnlinkCustomFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinkcustom"))
	}
	if allAfterReqFunctions.afterUnlinkDeviceFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinkdevice"))
	}
	if allAfterReqFunctions.afterUnlinkEmailFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinkemail"))
	}
	if allAfterReqFunctions.afterUnlinkFacebookFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinkfacebook"))
	}
	if allAfterReqFunctions.afterUnlinkFacebookInstantGameFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if allAfterReqFunctions.afterUnlinkGameCenterFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if allAfterReqFunctions.afterUnlinkGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinkgoogle"))
	}
	if allAfterReqFunctions.afterUnlinkSteamFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "unlinksteam"))
	}
	if allAfterReqFunctions.afterGetUsersFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "getusers"))
	}
	if allAfterReqFunctions.afterValidatePurchaseAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if allAfterReqFunctions.afterValidatePurchaseGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if allAfterReqFunctions.afterValidatePurchaseHuaweiFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if allAfterReqFunctions.afterValidatePurchaseFacebookInstantFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "validatepurchasefacebookinstant"))
	}
	if allAfterReqFunctions.afterValidateSubscriptionAppleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatesubscriptionapple"))
	}
	if allAfterReqFunctions.afterValidateSubscriptionGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatesubscriptiongoogle"))
	}
	if allAfterReqFunctions.afterGetSubscriptionFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "getsubscription"))
	}
	if allAfterReqFunctions.afterListSubscriptionsFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "listsubscriptions"))
	}
	if allAfterReqFunctions.afterEventFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After custom events function invocation")
	}

	// Register Lua After req Functions
	if luaAfterReqFns.afterGetAccountFunction != nil {
		allAfterReqFunctions.afterGetAccountFunction = luaAfterReqFns.afterGetAccountFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "getaccount"))
	}
	if luaAfterReqFns.afterGetMatchmakerStatsFunction != nil {
		allAfterReqFunctions.afterGetMatchmakerStatsFunction = luaAfterReqFns.afterGetMatchmakerStatsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "getmatchmakerstats"))
	}
	if luaAfterReqFns.afterUpdateAccountFunction != nil {
		allAfterReqFunctions.afterUpdateAccountFunction = luaAfterReqFns.afterUpdateAccountFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "updateaccount"))
	}
	if luaAfterReqFns.afterDeleteAccountFunction != nil {
		allAfterReqFunctions.afterDeleteAccountFunction = luaAfterReqFns.afterDeleteAccountFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deleteaccount"))
	}
	if luaAfterReqFns.afterSessionRefreshFunction != nil {
		allAfterReqFunctions.afterSessionRefreshFunction = luaAfterReqFns.afterSessionRefreshFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "sessionrefresh"))
	}
	if luaAfterReqFns.afterSessionLogoutFunction != nil {
		allAfterReqFunctions.afterSessionLogoutFunction = luaAfterReqFns.afterSessionLogoutFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "sessionlogout"))
	}
	if luaAfterReqFns.afterAuthenticateAppleFunction != nil {
		allAfterReqFunctions.afterAuthenticateAppleFunction = luaAfterReqFns.afterAuthenticateAppleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticateapple"))
	}
	if luaAfterReqFns.afterAuthenticateCustomFunction != nil {
		allAfterReqFunctions.afterAuthenticateCustomFunction = luaAfterReqFns.afterAuthenticateCustomFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatecustom"))
	}
	if luaAfterReqFns.afterAuthenticateDeviceFunction != nil {
		allAfterReqFunctions.afterAuthenticateDeviceFunction = luaAfterReqFns.afterAuthenticateDeviceFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatedevice"))
	}
	if luaAfterReqFns.afterAuthenticateEmailFunction != nil {
		allAfterReqFunctions.afterAuthenticateEmailFunction = luaAfterReqFns.afterAuthenticateEmailFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticateemail"))
	}
	if luaAfterReqFns.afterAuthenticateFacebookFunction != nil {
		allAfterReqFunctions.afterAuthenticateFacebookFunction = luaAfterReqFns.afterAuthenticateFacebookFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatefacebook"))
	}
	if luaAfterReqFns.afterAuthenticateFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction = luaAfterReqFns.afterAuthenticateFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if luaAfterReqFns.afterAuthenticateGameCenterFunction != nil {
		allAfterReqFunctions.afterAuthenticateGameCenterFunction = luaAfterReqFns.afterAuthenticateGameCenterFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticategamecenter"))
	}
	if luaAfterReqFns.afterAuthenticateGoogleFunction != nil {
		allAfterReqFunctions.afterAuthenticateGoogleFunction = luaAfterReqFns.afterAuthenticateGoogleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticategoogle"))
	}
	if luaAfterReqFns.afterAuthenticateSteamFunction != nil {
		allAfterReqFunctions.afterAuthenticateSteamFunction = luaAfterReqFns.afterAuthenticateSteamFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatesteam"))
	}
	if luaAfterReqFns.afterListChannelMessagesFunction != nil {
		allAfterReqFunctions.afterListChannelMessagesFunction = luaAfterReqFns.afterListChannelMessagesFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listchannelmessages"))
	}
	if luaAfterReqFns.afterListFriendsFunction != nil {
		allAfterReqFunctions.afterListFriendsFunction = luaAfterReqFns.afterListFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listfriends"))
	}
	if luaAfterReqFns.afterAddFriendsFunction != nil {
		allAfterReqFunctions.afterAddFriendsFunction = luaAfterReqFns.afterAddFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "addfriends"))
	}
	if luaAfterReqFns.afterDeleteFriendsFunction != nil {
		allAfterReqFunctions.afterDeleteFriendsFunction = luaAfterReqFns.afterDeleteFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletefriends"))
	}
	if luaAfterReqFns.afterBlockFriendsFunction != nil {
		allAfterReqFunctions.afterBlockFriendsFunction = luaAfterReqFns.afterBlockFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "blockfriends"))
	}
	if luaAfterReqFns.afterImportFacebookFriendsFunction != nil {
		allAfterReqFunctions.afterImportFacebookFriendsFunction = luaAfterReqFns.afterImportFacebookFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "importfacebookfriends"))
	}
	if luaAfterReqFns.afterImportSteamFriendsFunction != nil {
		allAfterReqFunctions.afterImportSteamFriendsFunction = luaAfterReqFns.afterImportSteamFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "importsteamfriends"))
	}
	if luaAfterReqFns.afterCreateGroupFunction != nil {
		allAfterReqFunctions.afterCreateGroupFunction = luaAfterReqFns.afterCreateGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "creategroup"))
	}
	if luaAfterReqFns.afterUpdateGroupFunction != nil {
		allAfterReqFunctions.afterUpdateGroupFunction = luaAfterReqFns.afterUpdateGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "updategroup"))
	}
	if luaAfterReqFns.afterDeleteGroupFunction != nil {
		allAfterReqFunctions.afterDeleteGroupFunction = luaAfterReqFns.afterDeleteGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletegroup"))
	}
	if luaAfterReqFns.afterJoinGroupFunction != nil {
		allAfterReqFunctions.afterJoinGroupFunction = luaAfterReqFns.afterJoinGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "joingroup"))
	}
	if luaAfterReqFns.afterLeaveGroupFunction != nil {
		allAfterReqFunctions.afterLeaveGroupFunction = luaAfterReqFns.afterLeaveGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "leavegroup"))
	}
	if luaAfterReqFns.afterAddGroupUsersFunction != nil {
		allAfterReqFunctions.afterAddGroupUsersFunction = luaAfterReqFns.afterAddGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "addgroupusers"))
	}
	if luaAfterReqFns.afterBanGroupUsersFunction != nil {
		allAfterReqFunctions.afterBanGroupUsersFunction = luaAfterReqFns.afterBanGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "bangroupusers"))
	}
	if luaAfterReqFns.afterKickGroupUsersFunction != nil {
		allAfterReqFunctions.afterKickGroupUsersFunction = luaAfterReqFns.afterKickGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "kickgroupusers"))
	}
	if luaAfterReqFns.afterPromoteGroupUsersFunction != nil {
		allAfterReqFunctions.afterPromoteGroupUsersFunction = luaAfterReqFns.afterPromoteGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "promotegroupusers"))
	}
	if luaAfterReqFns.afterListGroupUsersFunction != nil {
		allAfterReqFunctions.afterListGroupUsersFunction = luaAfterReqFns.afterListGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listgroupusers"))
	}
	if luaAfterReqFns.afterListUserGroupsFunction != nil {
		allAfterReqFunctions.afterListUserGroupsFunction = luaAfterReqFns.afterListUserGroupsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listusergroups"))
	}
	if luaAfterReqFns.afterListGroupsFunction != nil {
		allAfterReqFunctions.afterListGroupsFunction = luaAfterReqFns.afterListGroupsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listgroups"))
	}
	if luaAfterReqFns.afterDeleteLeaderboardRecordFunction != nil {
		allAfterReqFunctions.afterDeleteLeaderboardRecordFunction = luaAfterReqFns.afterDeleteLeaderboardRecordFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if luaAfterReqFns.afterDeleteTournamentRecordFunction != nil {
		allAfterReqFunctions.afterDeleteTournamentRecordFunction = luaAfterReqFns.afterDeleteTournamentRecordFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletetournamentrecord"))
	}
	if luaAfterReqFns.afterListLeaderboardRecordsFunction != nil {
		allAfterReqFunctions.afterListLeaderboardRecordsFunction = luaAfterReqFns.afterListLeaderboardRecordsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if luaAfterReqFns.afterWriteLeaderboardRecordFunction != nil {
		allAfterReqFunctions.afterWriteLeaderboardRecordFunction = luaAfterReqFns.afterWriteLeaderboardRecordFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if luaAfterReqFns.afterListLeaderboardRecordsAroundOwnerFunction != nil {
		allAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction = luaAfterReqFns.afterListLeaderboardRecordsAroundOwnerFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if luaAfterReqFns.afterLinkAppleFunction != nil {
		allAfterReqFunctions.afterLinkAppleFunction = luaAfterReqFns.afterLinkAppleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkapple"))
	}
	if luaAfterReqFns.afterLinkCustomFunction != nil {
		allAfterReqFunctions.afterLinkCustomFunction = luaAfterReqFns.afterLinkCustomFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkcustom"))
	}
	if luaAfterReqFns.afterLinkDeviceFunction != nil {
		allAfterReqFunctions.afterLinkDeviceFunction = luaAfterReqFns.afterLinkDeviceFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkdevice"))
	}
	if luaAfterReqFns.afterLinkEmailFunction != nil {
		allAfterReqFunctions.afterLinkEmailFunction = luaAfterReqFns.afterLinkEmailFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkemail"))
	}
	if luaAfterReqFns.afterLinkFacebookFunction != nil {
		allAfterReqFunctions.afterLinkFacebookFunction = luaAfterReqFns.afterLinkFacebookFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkfacebook"))
	}
	if luaAfterReqFns.afterLinkFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterLinkFacebookInstantGameFunction = luaAfterReqFns.afterLinkFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if luaAfterReqFns.afterLinkGameCenterFunction != nil {
		allAfterReqFunctions.afterLinkGameCenterFunction = luaAfterReqFns.afterLinkGameCenterFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkgamecenter"))
	}
	if luaAfterReqFns.afterLinkGoogleFunction != nil {
		allAfterReqFunctions.afterLinkGoogleFunction = luaAfterReqFns.afterLinkGoogleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkgoogle"))
	}
	if luaAfterReqFns.afterLinkSteamFunction != nil {
		allAfterReqFunctions.afterLinkSteamFunction = luaAfterReqFns.afterLinkSteamFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linksteam"))
	}
	if luaAfterReqFns.afterListMatchesFunction != nil {
		allAfterReqFunctions.afterListMatchesFunction = luaAfterReqFns.afterListMatchesFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listmatches"))
	}
	if luaAfterReqFns.afterListNotificationsFunction != nil {
		allAfterReqFunctions.afterListNotificationsFunction = luaAfterReqFns.afterListNotificationsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listnotifications"))
	}
	if luaAfterReqFns.afterDeleteNotificationsFunction != nil {
		allAfterReqFunctions.afterDeleteNotificationsFunction = luaAfterReqFns.afterDeleteNotificationsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletenotifications"))
	}
	if luaAfterReqFns.afterListStorageObjectsFunction != nil {
		allAfterReqFunctions.afterListStorageObjectsFunction = luaAfterReqFns.afterListStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "liststorageobjects"))
	}
	if luaAfterReqFns.afterReadStorageObjectsFunction != nil {
		allAfterReqFunctions.afterReadStorageObjectsFunction = luaAfterReqFns.afterReadStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "readstorageobjects"))
	}
	if luaAfterReqFns.afterWriteStorageObjectsFunction != nil {
		allAfterReqFunctions.afterWriteStorageObjectsFunction = luaAfterReqFns.afterWriteStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writestorageobjects"))
	}
	if luaAfterReqFns.afterDeleteStorageObjectsFunction != nil {
		allAfterReqFunctions.afterDeleteStorageObjectsFunction = luaAfterReqFns.afterDeleteStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletestorageobjects"))
	}
	if luaAfterReqFns.afterJoinTournamentFunction != nil {
		allAfterReqFunctions.afterJoinTournamentFunction = luaAfterReqFns.afterJoinTournamentFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "jointournament"))
	}
	if luaAfterReqFns.afterListTournamentRecordsFunction != nil {
		allAfterReqFunctions.afterListTournamentRecordsFunction = luaAfterReqFns.afterListTournamentRecordsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournamentrecords"))
	}
	if luaAfterReqFns.afterListTournamentsFunction != nil {
		allAfterReqFunctions.afterListTournamentsFunction = luaAfterReqFns.afterListTournamentsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournaments"))
	}
	if luaAfterReqFns.afterWriteTournamentRecordFunction != nil {
		allAfterReqFunctions.afterWriteTournamentRecordFunction = luaAfterReqFns.afterWriteTournamentRecordFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writetournamentrecord"))
	}
	if luaAfterReqFns.afterListTournamentRecordsAroundOwnerFunction != nil {
		allAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction = luaAfterReqFns.afterListTournamentRecordsAroundOwnerFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if luaAfterReqFns.afterUnlinkAppleFunction != nil {
		allAfterReqFunctions.afterUnlinkAppleFunction = luaAfterReqFns.afterUnlinkAppleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkapple"))
	}
	if luaAfterReqFns.afterUnlinkCustomFunction != nil {
		allAfterReqFunctions.afterUnlinkCustomFunction = luaAfterReqFns.afterUnlinkCustomFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkcustom"))
	}
	if luaAfterReqFns.afterUnlinkDeviceFunction != nil {
		allAfterReqFunctions.afterUnlinkDeviceFunction = luaAfterReqFns.afterUnlinkDeviceFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkdevice"))
	}
	if luaAfterReqFns.afterUnlinkEmailFunction != nil {
		allAfterReqFunctions.afterUnlinkEmailFunction = luaAfterReqFns.afterUnlinkEmailFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkemail"))
	}
	if luaAfterReqFns.afterUnlinkFacebookFunction != nil {
		allAfterReqFunctions.afterUnlinkFacebookFunction = luaAfterReqFns.afterUnlinkFacebookFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkfacebook"))
	}
	if luaAfterReqFns.afterUnlinkFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterUnlinkFacebookInstantGameFunction = luaAfterReqFns.afterUnlinkFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if luaAfterReqFns.afterUnlinkGameCenterFunction != nil {
		allAfterReqFunctions.afterUnlinkGameCenterFunction = luaAfterReqFns.afterUnlinkGameCenterFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if luaAfterReqFns.afterUnlinkGoogleFunction != nil {
		allAfterReqFunctions.afterUnlinkGoogleFunction = luaAfterReqFns.afterUnlinkGoogleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkgoogle"))
	}
	if luaAfterReqFns.afterUnlinkSteamFunction != nil {
		allAfterReqFunctions.afterUnlinkSteamFunction = luaAfterReqFns.afterUnlinkSteamFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinksteam"))
	}
	if luaAfterReqFns.afterGetUsersFunction != nil {
		allAfterReqFunctions.afterGetUsersFunction = luaAfterReqFns.afterGetUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "getusers"))
	}
	if luaAfterReqFns.afterValidatePurchaseAppleFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseAppleFunction = luaAfterReqFns.afterValidatePurchaseAppleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if luaAfterReqFns.afterValidatePurchaseGoogleFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseGoogleFunction = luaAfterReqFns.afterValidatePurchaseGoogleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if luaAfterReqFns.afterValidatePurchaseHuaweiFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseHuaweiFunction = luaAfterReqFns.afterValidatePurchaseHuaweiFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if luaAfterReqFns.afterValidatePurchaseFacebookInstantFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseFacebookInstantFunction = luaAfterReqFns.afterValidatePurchaseFacebookInstantFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "validatepurchasefacebookinstant"))
	}
	if luaAfterReqFns.afterValidateSubscriptionAppleFunction != nil {
		allAfterReqFunctions.afterValidateSubscriptionAppleFunction = luaAfterReqFns.afterValidateSubscriptionAppleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "validatesubscriptionapple"))
	}
	if luaAfterReqFns.afterValidateSubscriptionGoogleFunction != nil {
		allAfterReqFunctions.afterValidateSubscriptionGoogleFunction = luaAfterReqFns.afterValidateSubscriptionGoogleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "validatesubscriptiongoogle"))
	}
	if luaAfterReqFns.afterGetSubscriptionFunction != nil {
		allAfterReqFunctions.afterGetSubscriptionFunction = luaAfterReqFns.afterGetSubscriptionFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "getsubscription"))
	}
	if luaAfterReqFns.afterListSubscriptionsFunction != nil {
		allAfterReqFunctions.afterListSubscriptionsFunction = luaAfterReqFns.afterListSubscriptionsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listsubscriptions"))
	}
	if luaAfterReqFns.afterEventFunction != nil {
		allAfterReqFunctions.afterEventFunction = luaAfterReqFns.afterEventFunction
		startupLogger.Info("Registered Lua runtime After custom events function invocation")
	}

	// Register Go After req functions
	if goAfterReqFns.afterGetAccountFunction != nil {
		allAfterReqFunctions.afterGetAccountFunction = goAfterReqFns.afterGetAccountFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "getaccount"))
	}
	if goAfterReqFns.afterUpdateAccountFunction != nil {
		allAfterReqFunctions.afterUpdateAccountFunction = goAfterReqFns.afterUpdateAccountFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "updateaccount"))
	}
	if goAfterReqFns.afterDeleteAccountFunction != nil {
		allAfterReqFunctions.afterDeleteAccountFunction = goAfterReqFns.afterDeleteAccountFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deleteaccount"))
	}
	if goAfterReqFns.afterSessionRefreshFunction != nil {
		allAfterReqFunctions.afterSessionRefreshFunction = goAfterReqFns.afterSessionRefreshFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "sessionrefresh"))
	}
	if goAfterReqFns.afterSessionLogoutFunction != nil {
		allAfterReqFunctions.afterSessionLogoutFunction = goAfterReqFns.afterSessionLogoutFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "sessionlogout"))
	}
	if goAfterReqFns.afterAuthenticateAppleFunction != nil {
		allAfterReqFunctions.afterAuthenticateAppleFunction = goAfterReqFns.afterAuthenticateAppleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticateapple"))
	}
	if goAfterReqFns.afterAuthenticateCustomFunction != nil {
		allAfterReqFunctions.afterAuthenticateCustomFunction = goAfterReqFns.afterAuthenticateCustomFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatecustom"))
	}
	if goAfterReqFns.afterAuthenticateDeviceFunction != nil {
		allAfterReqFunctions.afterAuthenticateDeviceFunction = goAfterReqFns.afterAuthenticateDeviceFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatedevice"))
	}
	if goAfterReqFns.afterAuthenticateEmailFunction != nil {
		allAfterReqFunctions.afterAuthenticateEmailFunction = goAfterReqFns.afterAuthenticateEmailFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticateemail"))
	}
	if goAfterReqFns.afterAuthenticateFacebookFunction != nil {
		allAfterReqFunctions.afterAuthenticateFacebookFunction = goAfterReqFns.afterAuthenticateFacebookFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatefacebook"))
	}
	if goAfterReqFns.afterAuthenticateFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction = goAfterReqFns.afterAuthenticateFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if goAfterReqFns.afterAuthenticateGameCenterFunction != nil {
		allAfterReqFunctions.afterAuthenticateGameCenterFunction = goAfterReqFns.afterAuthenticateGameCenterFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticategamecenter"))
	}
	if goAfterReqFns.afterAuthenticateGoogleFunction != nil {
		allAfterReqFunctions.afterAuthenticateGoogleFunction = goAfterReqFns.afterAuthenticateGoogleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticategoogle"))
	}
	if goAfterReqFns.afterAuthenticateSteamFunction != nil {
		allAfterReqFunctions.afterAuthenticateSteamFunction = goAfterReqFns.afterAuthenticateSteamFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticatesteam"))
	}
	if goAfterReqFns.afterListChannelMessagesFunction != nil {
		allAfterReqFunctions.afterListChannelMessagesFunction = goAfterReqFns.afterListChannelMessagesFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listchannelmessages"))
	}
	if goAfterReqFns.afterListFriendsFunction != nil {
		allAfterReqFunctions.afterListFriendsFunction = goAfterReqFns.afterListFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listfriends"))
	}
	if goAfterReqFns.afterListFriendsOfFriendsFunction != nil {
		allAfterReqFunctions.afterListFriendsOfFriendsFunction = goAfterReqFns.afterListFriendsOfFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listfriendsoffriends"))
	}
	if goAfterReqFns.afterAddFriendsFunction != nil {
		allAfterReqFunctions.afterAddFriendsFunction = goAfterReqFns.afterAddFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "addfriends"))
	}
	if goAfterReqFns.afterDeleteFriendsFunction != nil {
		allAfterReqFunctions.afterDeleteFriendsFunction = goAfterReqFns.afterDeleteFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletefriends"))
	}
	if goAfterReqFns.afterBlockFriendsFunction != nil {
		allAfterReqFunctions.afterBlockFriendsFunction = goAfterReqFns.afterBlockFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "blockfriends"))
	}
	if goAfterReqFns.afterImportFacebookFriendsFunction != nil {
		allAfterReqFunctions.afterImportFacebookFriendsFunction = goAfterReqFns.afterImportFacebookFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "importfacebookfriends"))
	}
	if goAfterReqFns.afterImportSteamFriendsFunction != nil {
		allAfterReqFunctions.afterImportSteamFriendsFunction = goAfterReqFns.afterImportSteamFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "importsteamfriends"))
	}
	if goAfterReqFns.afterCreateGroupFunction != nil {
		allAfterReqFunctions.afterCreateGroupFunction = goAfterReqFns.afterCreateGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "creategroup"))
	}
	if goAfterReqFns.afterUpdateGroupFunction != nil {
		allAfterReqFunctions.afterUpdateGroupFunction = goAfterReqFns.afterUpdateGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "updategroup"))
	}
	if goAfterReqFns.afterDeleteGroupFunction != nil {
		allAfterReqFunctions.afterDeleteGroupFunction = goAfterReqFns.afterDeleteGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletegroup"))
	}
	if goAfterReqFns.afterJoinGroupFunction != nil {
		allAfterReqFunctions.afterJoinGroupFunction = goAfterReqFns.afterJoinGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "joingroup"))
	}
	if goAfterReqFns.afterLeaveGroupFunction != nil {
		allAfterReqFunctions.afterLeaveGroupFunction = goAfterReqFns.afterLeaveGroupFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "leavegroup"))
	}
	if goAfterReqFns.afterAddGroupUsersFunction != nil {
		allAfterReqFunctions.afterAddGroupUsersFunction = goAfterReqFns.afterAddGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "addgroupusers"))
	}
	if goAfterReqFns.afterBanGroupUsersFunction != nil {
		allAfterReqFunctions.afterBanGroupUsersFunction = goAfterReqFns.afterBanGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "bangroupusers"))
	}
	if goAfterReqFns.afterKickGroupUsersFunction != nil {
		allAfterReqFunctions.afterKickGroupUsersFunction = goAfterReqFns.afterKickGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "kickgroupusers"))
	}
	if goAfterReqFns.afterPromoteGroupUsersFunction != nil {
		allAfterReqFunctions.afterPromoteGroupUsersFunction = goAfterReqFns.afterPromoteGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "promotegroupusers"))
	}
	if goAfterReqFns.afterDemoteGroupUsersFunction != nil {
		allAfterReqFunctions.afterDemoteGroupUsersFunction = goAfterReqFns.afterDemoteGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "demotegroupusers"))
	}
	if goAfterReqFns.afterListGroupUsersFunction != nil {
		allAfterReqFunctions.afterListGroupUsersFunction = goAfterReqFns.afterListGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listgroupusers"))
	}
	if goAfterReqFns.afterListUserGroupsFunction != nil {
		allAfterReqFunctions.afterListUserGroupsFunction = goAfterReqFns.afterListUserGroupsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listusergroups"))
	}
	if goAfterReqFns.afterListGroupsFunction != nil {
		allAfterReqFunctions.afterListGroupsFunction = goAfterReqFns.afterListGroupsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listgroups"))
	}
	if goAfterReqFns.afterDeleteLeaderboardRecordFunction != nil {
		allAfterReqFunctions.afterDeleteLeaderboardRecordFunction = goAfterReqFns.afterDeleteLeaderboardRecordFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if goAfterReqFns.afterDeleteTournamentRecordFunction != nil {
		allAfterReqFunctions.afterDeleteTournamentRecordFunction = goAfterReqFns.afterDeleteTournamentRecordFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletetournamentrecord"))
	}
	if goAfterReqFns.afterListLeaderboardRecordsFunction != nil {
		allAfterReqFunctions.afterListLeaderboardRecordsFunction = goAfterReqFns.afterListLeaderboardRecordsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if goAfterReqFns.afterWriteLeaderboardRecordFunction != nil {
		allAfterReqFunctions.afterWriteLeaderboardRecordFunction = goAfterReqFns.afterWriteLeaderboardRecordFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if goAfterReqFns.afterListLeaderboardRecordsAroundOwnerFunction != nil {
		allAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction = goAfterReqFns.afterListLeaderboardRecordsAroundOwnerFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if goAfterReqFns.afterLinkAppleFunction != nil {
		allAfterReqFunctions.afterLinkAppleFunction = goAfterReqFns.afterLinkAppleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkapple"))
	}
	if goAfterReqFns.afterLinkCustomFunction != nil {
		allAfterReqFunctions.afterLinkCustomFunction = goAfterReqFns.afterLinkCustomFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkcustom"))
	}
	if goAfterReqFns.afterLinkDeviceFunction != nil {
		allAfterReqFunctions.afterLinkDeviceFunction = goAfterReqFns.afterLinkDeviceFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkdevice"))
	}
	if goAfterReqFns.afterLinkEmailFunction != nil {
		allAfterReqFunctions.afterLinkEmailFunction = goAfterReqFns.afterLinkEmailFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkemail"))
	}
	if goAfterReqFns.afterLinkFacebookFunction != nil {
		allAfterReqFunctions.afterLinkFacebookFunction = goAfterReqFns.afterLinkFacebookFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkfacebook"))
	}
	if goAfterReqFns.afterLinkFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterLinkFacebookInstantGameFunction = goAfterReqFns.afterLinkFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if goAfterReqFns.afterLinkGameCenterFunction != nil {
		allAfterReqFunctions.afterLinkGameCenterFunction = goAfterReqFns.afterLinkGameCenterFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkgamecenter"))
	}
	if goAfterReqFns.afterLinkGoogleFunction != nil {
		allAfterReqFunctions.afterLinkGoogleFunction = goAfterReqFns.afterLinkGoogleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkgoogle"))
	}
	if goAfterReqFns.afterLinkSteamFunction != nil {
		allAfterReqFunctions.afterLinkSteamFunction = goAfterReqFns.afterLinkSteamFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linksteam"))
	}
	if goAfterReqFns.afterListMatchesFunction != nil {
		allAfterReqFunctions.afterListMatchesFunction = goAfterReqFns.afterListMatchesFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listmatches"))
	}
	if goAfterReqFns.afterListNotificationsFunction != nil {
		allAfterReqFunctions.afterListNotificationsFunction = goAfterReqFns.afterListNotificationsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listnotifications"))
	}
	if goAfterReqFns.afterDeleteNotificationsFunction != nil {
		allAfterReqFunctions.afterDeleteNotificationsFunction = goAfterReqFns.afterDeleteNotificationsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletenotifications"))
	}
	if goAfterReqFns.afterListStorageObjectsFunction != nil {
		allAfterReqFunctions.afterListStorageObjectsFunction = goAfterReqFns.afterListStorageObjectsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "liststorageobjects"))
	}
	if goAfterReqFns.afterReadStorageObjectsFunction != nil {
		allAfterReqFunctions.afterReadStorageObjectsFunction = goAfterReqFns.afterReadStorageObjectsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "readstorageobjects"))
	}
	if goAfterReqFns.afterWriteStorageObjectsFunction != nil {
		allAfterReqFunctions.afterWriteStorageObjectsFunction = goAfterReqFns.afterWriteStorageObjectsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "writestorageobjects"))
	}
	if goAfterReqFns.afterDeleteStorageObjectsFunction != nil {
		allAfterReqFunctions.afterDeleteStorageObjectsFunction = goAfterReqFns.afterDeleteStorageObjectsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "deletestorageobjects"))
	}
	if goAfterReqFns.afterJoinTournamentFunction != nil {
		allAfterReqFunctions.afterJoinTournamentFunction = goAfterReqFns.afterJoinTournamentFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "jointournament"))
	}
	if goAfterReqFns.afterListTournamentRecordsFunction != nil {
		allAfterReqFunctions.afterListTournamentRecordsFunction = goAfterReqFns.afterListTournamentRecordsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listtournamentrecords"))
	}
	if goAfterReqFns.afterListTournamentsFunction != nil {
		allAfterReqFunctions.afterListTournamentsFunction = goAfterReqFns.afterListTournamentsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listtournaments"))
	}
	if goAfterReqFns.afterWriteTournamentRecordFunction != nil {
		allAfterReqFunctions.afterWriteTournamentRecordFunction = goAfterReqFns.afterWriteTournamentRecordFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "writetournamentrecord"))
	}
	if goAfterReqFns.afterListTournamentRecordsAroundOwnerFunction != nil {
		allAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction = goAfterReqFns.afterListTournamentRecordsAroundOwnerFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if goAfterReqFns.afterUnlinkAppleFunction != nil {
		allAfterReqFunctions.afterUnlinkAppleFunction = goAfterReqFns.afterUnlinkAppleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkapple"))
	}
	if goAfterReqFns.afterUnlinkCustomFunction != nil {
		allAfterReqFunctions.afterUnlinkCustomFunction = goAfterReqFns.afterUnlinkCustomFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkcustom"))
	}
	if goAfterReqFns.afterUnlinkDeviceFunction != nil {
		allAfterReqFunctions.afterUnlinkDeviceFunction = goAfterReqFns.afterUnlinkDeviceFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkdevice"))
	}
	if goAfterReqFns.afterUnlinkEmailFunction != nil {
		allAfterReqFunctions.afterUnlinkEmailFunction = goAfterReqFns.afterUnlinkEmailFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkemail"))
	}
	if goAfterReqFns.afterUnlinkFacebookFunction != nil {
		allAfterReqFunctions.afterUnlinkFacebookFunction = goAfterReqFns.afterUnlinkFacebookFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkfacebook"))
	}
	if goAfterReqFns.afterUnlinkFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterUnlinkFacebookInstantGameFunction = goAfterReqFns.afterUnlinkFacebookInstantGameFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if goAfterReqFns.afterUnlinkGameCenterFunction != nil {
		allAfterReqFunctions.afterUnlinkGameCenterFunction = goAfterReqFns.afterUnlinkGameCenterFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if goAfterReqFns.afterUnlinkGoogleFunction != nil {
		allAfterReqFunctions.afterUnlinkGoogleFunction = goAfterReqFns.afterUnlinkGoogleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkgoogle"))
	}
	if goAfterReqFns.afterUnlinkSteamFunction != nil {
		allAfterReqFunctions.afterUnlinkSteamFunction = goAfterReqFns.afterUnlinkSteamFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinksteam"))
	}
	if goAfterReqFns.afterGetUsersFunction != nil {
		allAfterReqFunctions.afterGetUsersFunction = goAfterReqFns.afterGetUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "getusers"))
	}
	if goAfterReqFns.afterValidatePurchaseAppleFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseAppleFunction = goAfterReqFns.afterValidatePurchaseAppleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if goAfterReqFns.afterValidatePurchaseGoogleFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseGoogleFunction = goAfterReqFns.afterValidatePurchaseGoogleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if goAfterReqFns.afterValidatePurchaseHuaweiFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseHuaweiFunction = goAfterReqFns.afterValidatePurchaseHuaweiFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if goAfterReqFns.afterValidatePurchaseFacebookInstantFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseFacebookInstantFunction = goAfterReqFns.afterValidatePurchaseFacebookInstantFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "validatepurchasefacebookinstant"))
	}
	if goAfterReqFns.afterValidateSubscriptionAppleFunction != nil {
		allAfterReqFunctions.afterValidateSubscriptionAppleFunction = goAfterReqFns.afterValidateSubscriptionAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatesubscriptionapple"))
	}
	if goAfterReqFns.afterValidateSubscriptionGoogleFunction != nil {
		allAfterReqFunctions.afterValidateSubscriptionGoogleFunction = goAfterReqFns.afterValidateSubscriptionGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatesubscriptiongoogle"))
	}
	if goAfterReqFns.afterGetSubscriptionFunction != nil {
		allAfterReqFunctions.afterGetSubscriptionFunction = goAfterReqFns.afterGetSubscriptionFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "getsubscription"))
	}
	if goAfterReqFns.afterListSubscriptionsFunction != nil {
		allAfterReqFunctions.afterListSubscriptionsFunction = goAfterReqFns.afterListSubscriptionsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "listsubscriptions"))
	}
	if goAfterReqFns.afterEventFunction != nil {
		allAfterReqFunctions.afterEventFunction = goAfterReqFns.afterEventFunction
		startupLogger.Info("Registered Go runtime After custom events function invocation")
	}

	var allMatchmakerMatchedFunction RuntimeMatchmakerMatchedFunction
	switch {
	case goMatchmakerMatchedFn != nil:
		allMatchmakerMatchedFunction = goMatchmakerMatchedFn
		startupLogger.Info("Registered Go runtime Matchmaker Matched function invocation")
	case luaMatchmakerMatchedFn != nil:
		allMatchmakerMatchedFunction = luaMatchmakerMatchedFn
		startupLogger.Info("Registered Lua runtime Matchmaker Matched function invocation")
	case jsMatchmakerMatchedFn != nil:
		allMatchmakerMatchedFunction = jsMatchmakerMatchedFn
		startupLogger.Info("Registered JavaScript runtime Matchmaker Matched function invocation")
	}

	var allMatchmakerOverrideFunction RuntimeMatchmakerOverrideFunction
	switch {
	case goMatchmakerCustomMatchingFn != nil:
		allMatchmakerOverrideFunction = goMatchmakerCustomMatchingFn
		startupLogger.Info("Registered Go runtime Matchmaker Override function invocation")
	}

	var allTournamentEndFunction RuntimeTournamentEndFunction
	switch {
	case goTournamentEndFn != nil:
		allTournamentEndFunction = goTournamentEndFn
		startupLogger.Info("Registered Go runtime Tournament End function invocation")
	case luaTournamentEndFn != nil:
		allTournamentEndFunction = luaTournamentEndFn
		startupLogger.Info("Registered Lua runtime Tournament End function invocation")
	case jsTournamentEndFn != nil:
		allTournamentEndFunction = jsTournamentEndFn
		startupLogger.Info("Registered JavaScript runtime Tournament End function invocation")
	}

	var allTournamentResetFunction RuntimeTournamentResetFunction
	switch {
	case goTournamentResetFn != nil:
		allTournamentResetFunction = goTournamentResetFn
		startupLogger.Info("Registered Go runtime Tournament Reset function invocation")
	case luaTournamentResetFn != nil:
		allTournamentResetFunction = luaTournamentResetFn
		startupLogger.Info("Registered Lua runtime Tournament Reset function invocation")
	case jsTournamentResetFn != nil:
		allTournamentResetFunction = jsTournamentResetFn
		startupLogger.Info("Registered JavaScript runtime Tournament Reset function invocation")
	}

	var allLeaderboardResetFunction RuntimeLeaderboardResetFunction
	switch {
	case goLeaderboardResetFn != nil:
		allLeaderboardResetFunction = goLeaderboardResetFn
		startupLogger.Info("Registered Go runtime Leaderboard Reset function invocation")
	case luaLeaderboardResetFn != nil:
		allLeaderboardResetFunction = luaLeaderboardResetFn
		startupLogger.Info("Registered Lua runtime Leaderboard Reset function invocation")
	case jsLeaderboardResetFn != nil:
		allLeaderboardResetFunction = jsLeaderboardResetFn
		startupLogger.Info("Registered JavaScript runtime Leaderboard Reset function invocation")
	}

	var allPurchaseNotificationAppleFunction RuntimePurchaseNotificationAppleFunction
	switch {
	case goPurchaseNotificationAppleFn != nil:
		allPurchaseNotificationAppleFunction = goPurchaseNotificationAppleFn
		startupLogger.Info("Registered Go runtime Purchase Notification Apple function invocation")
	case luaPurchaseNotificationAppleFn != nil:
		allPurchaseNotificationAppleFunction = luaPurchaseNotificationAppleFn
		startupLogger.Info("Registered Lua runtime Purchase Notification Apple function invocation")
	case jsPurchaseNotificationAppleFn != nil:
		allPurchaseNotificationAppleFunction = jsPurchaseNotificationAppleFn
		startupLogger.Info("Registered JavaScript runtime Purchase Notification Apple function invocation")
	}

	var allSubscriptionNotificationAppleFunction RuntimeSubscriptionNotificationAppleFunction
	switch {
	case goSubscriptionNotificationAppleFn != nil:
		allSubscriptionNotificationAppleFunction = goSubscriptionNotificationAppleFn
		startupLogger.Info("Registered Go runtime Subscription Notification Apple function invocation")
	case luaSubscriptionNotificationAppleFn != nil:
		allSubscriptionNotificationAppleFunction = luaSubscriptionNotificationAppleFn
		startupLogger.Info("Registered Lua runtime Subscription Notification Apple function invocation")
	case jsSubscriptionNotificationAppleFn != nil:
		allSubscriptionNotificationAppleFunction = jsSubscriptionNotificationAppleFn
		startupLogger.Info("Registered JavaScript runtime Subscription Notification Apple function invocation")
	}

	var allPurchaseNotificationGoogleFunction RuntimePurchaseNotificationGoogleFunction
	switch {
	case goPurchaseNotificationGoogleFn != nil:
		allPurchaseNotificationGoogleFunction = goPurchaseNotificationGoogleFn
		startupLogger.Info("Registered Go runtime Purchase Notification Google function invocation")
	case luaPurchaseNotificationGoogleFn != nil:
		allPurchaseNotificationGoogleFunction = luaPurchaseNotificationGoogleFn
		startupLogger.Info("Registered Lua runtime Purchase Notification Google function invocation")
	case jsPurchaseNotificationGoogleFn != nil:
		allPurchaseNotificationGoogleFunction = jsPurchaseNotificationGoogleFn
		startupLogger.Info("Registered JavaScript runtime Purchase Notification Google function invocation")
	}

	var allSubscriptionNotificationGoogleFunction RuntimeSubscriptionNotificationGoogleFunction
	switch {
	case goSubscriptionNotificationGoogleFn != nil:
		allSubscriptionNotificationGoogleFunction = goSubscriptionNotificationGoogleFn
		startupLogger.Info("Registered Go runtime Subscription Notification Google function invocation")
	case luaSubscriptionNotificationGoogleFn != nil:
		allSubscriptionNotificationGoogleFunction = luaSubscriptionNotificationGoogleFn
		startupLogger.Info("Registered Lua runtime Subscription Notification Google function invocation")
	case jsSubscriptionNotificationGoogleFn != nil:
		allSubscriptionNotificationGoogleFunction = jsSubscriptionNotificationGoogleFn
		startupLogger.Info("Registered JavaScript runtime Subscription Notification Google function invocation")
	}

	var allShutdownFunction RuntimeShutdownFunction
	switch {
	case goShutdownFn != nil:
		allShutdownFunction = goShutdownFn
		startupLogger.Info("Registered Go runtime Shutdown function invocation")
	case luaShutdownFn != nil:
		allShutdownFunction = luaShutdownFn
		startupLogger.Info("Registered Lua runtime Shutdown function invocation")
	case jsShutdownFn != nil:
		allShutdownFunction = jsShutdownFn
		startupLogger.Info("Registered JavaScript runtime Shutdown function invocation")
	}

	allStorageIndexFilterFunctions := make(map[string]RuntimeStorageIndexFilterFunction, len(goIndexFilterFns)+len(luaIndexFilterFns)+len(jsIndexFilterFns))
	jsIndexNames := make(map[string]bool, len(jsIndexFilterFns))
	for id, fn := range jsIndexFilterFns {
		allStorageIndexFilterFunctions[id] = fn
		jsIndexNames[id] = true
		startupLogger.Info("Registered JavaScript runtime storage index filter function invocation", zap.String("index_name", id))
	}
	luaIndexNames := make(map[string]bool, len(luaIndexFilterFns))
	for id, fn := range luaIndexFilterFns {
		allStorageIndexFilterFunctions[id] = fn
		delete(jsIndexNames, id)
		luaIndexNames[id] = true
		startupLogger.Info("Registered Lua runtime storage index filter function invocation", zap.String("index_name", id))
	}
	goIndexNames := make(map[string]bool, len(goIndexFilterFns))
	for id, fn := range goIndexFilterFns {
		allStorageIndexFilterFunctions[id] = fn
		delete(luaIndexNames, id)
		goIndexNames[id] = true
		startupLogger.Info("Registered Go runtime storage index filter function invocation", zap.String("index_name", id))
	}

	// Lua matches are not registered the same, list only Go ones.
	goMatchNames := goMatchNamesListFn()
	for _, name := range goMatchNames {
		startupLogger.Info("Registered Go runtime Match creation function invocation", zap.String("name", name))
	}

	rInfo, err := runtimeInfo(paths, jsRpcIDs, luaRpcIDs, goRpcIDs, jsModules, luaModules, goModules)
	if err != nil {
		logger.Error("Error getting runtime info data.", zap.Error(err))
		return nil, nil, err
	}

	return &Runtime{
		matchCreateFunction:                    matchProvider.CreateMatch,
		rpcFunctions:                           allRPCFunctions,
		beforeRtFunctions:                      allBeforeRtFunctions,
		afterRtFunctions:                       allAfterRtFunctions,
		beforeReqFunctions:                     allBeforeReqFunctions,
		afterReqFunctions:                      allAfterReqFunctions,
		matchmakerMatchedFunction:              allMatchmakerMatchedFunction,
		matchmakerOverrideFunction:             allMatchmakerOverrideFunction,
		tournamentEndFunction:                  allTournamentEndFunction,
		tournamentResetFunction:                allTournamentResetFunction,
		leaderboardResetFunction:               allLeaderboardResetFunction,
		purchaseNotificationAppleFunction:      allPurchaseNotificationAppleFunction,
		subscriptionNotificationAppleFunction:  allSubscriptionNotificationAppleFunction,
		purchaseNotificationGoogleFunction:     allPurchaseNotificationGoogleFunction,
		subscriptionNotificationGoogleFunction: allSubscriptionNotificationGoogleFunction,
		storageIndexFilterFunctions:            allStorageIndexFilterFunctions,

		shutdownFunction: allShutdownFunction,

		fleetManager: fleetManager,

		eventFunctions: allEventFns,
	}, rInfo, nil
}

func runtimeInfo(paths []string, jsRpcIDs, luaRpcIDs, goRpcIDs map[string]bool, jsModules, luaModules, goModules []string) (*RuntimeInfo, error) {
	jsRpcs := make([]string, 0, len(jsRpcIDs))
	for id := range jsRpcIDs {
		jsRpcs = append(jsRpcs, id)
	}
	luaRpcs := make([]string, 0, len(luaRpcIDs))
	for id := range luaRpcIDs {
		luaRpcs = append(luaRpcs, id)
	}
	goRpcs := make([]string, 0, len(goRpcIDs))
	for id := range goRpcIDs {
		goRpcs = append(goRpcs, id)
	}

	jsModulePaths := make([]*moduleInfo, 0, len(jsModules))
	luaModulePaths := make([]*moduleInfo, 0, len(luaModules))
	goModulePaths := make([]*moduleInfo, 0, len(goModules))
	for _, p := range paths {
		for _, m := range jsModules {
			if strings.HasSuffix(p, m) {
				fileInfo, err := os.Stat(p)
				if err != nil {
					return nil, err
				}
				jsModulePaths = append(jsModulePaths, &moduleInfo{
					path:    p,
					modTime: fileInfo.ModTime(),
				})
			}
		}
		for _, m := range luaModules {
			if strings.HasSuffix(p, m) {
				fileInfo, err := os.Stat(p)
				if err != nil {
					return nil, err
				}
				luaModulePaths = append(luaModulePaths, &moduleInfo{
					path:    p,
					modTime: fileInfo.ModTime(),
				})
			}
		}
		for _, m := range goModules {
			if strings.HasSuffix(p, m) {
				fileInfo, err := os.Stat(p)
				if err != nil {
					return nil, err
				}
				goModulePaths = append(goModulePaths, &moduleInfo{
					path:    p,
					modTime: fileInfo.ModTime(),
				})
			}
		}
	}

	return &RuntimeInfo{
		LuaRpcFunctions:        luaRpcs,
		GoRpcFunctions:         goRpcs,
		JavaScriptRpcFunctions: jsRpcs,
		GoModules:              goModulePaths,
		LuaModules:             luaModulePaths,
		JavaScriptModules:      jsModulePaths,
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

func (r *Runtime) BeforeGetMatchmakerStats() RuntimeBeforeGetMatchmakerStatsFunction {
	return r.beforeReqFunctions.beforeGetMatchmakerStatsFunction
}

func (r *Runtime) AfterGetMatchmakerStats() RuntimeAfterGetMatchmakerStatsFunction {
	return r.afterReqFunctions.afterGetMatchmakerStatsFunction
}

func (r *Runtime) BeforeUpdateAccount() RuntimeBeforeUpdateAccountFunction {
	return r.beforeReqFunctions.beforeUpdateAccountFunction
}

func (r *Runtime) AfterUpdateAccount() RuntimeAfterUpdateAccountFunction {
	return r.afterReqFunctions.afterUpdateAccountFunction
}

func (r *Runtime) BeforeDeleteAccount() RuntimeBeforeDeleteAccountFunction {
	return r.beforeReqFunctions.beforeDeleteAccountFunction
}

func (r *Runtime) AfterDeleteAccount() RuntimeAfterDeleteAccountFunction {
	return r.afterReqFunctions.afterDeleteAccountFunction
}

func (r *Runtime) BeforeSessionRefresh() RuntimeBeforeSessionRefreshFunction {
	return r.beforeReqFunctions.beforeSessionRefreshFunction
}

func (r *Runtime) AfterSessionRefresh() RuntimeAfterSessionRefreshFunction {
	return r.afterReqFunctions.afterSessionRefreshFunction
}

func (r *Runtime) BeforeSessionLogout() RuntimeBeforeSessionLogoutFunction {
	return r.beforeReqFunctions.beforeSessionLogoutFunction
}

func (r *Runtime) AfterSessionLogout() RuntimeAfterSessionLogoutFunction {
	return r.afterReqFunctions.afterSessionLogoutFunction
}

func (r *Runtime) BeforeAuthenticateApple() RuntimeBeforeAuthenticateAppleFunction {
	return r.beforeReqFunctions.beforeAuthenticateAppleFunction
}

func (r *Runtime) AfterAuthenticateApple() RuntimeAfterAuthenticateAppleFunction {
	return r.afterReqFunctions.afterAuthenticateAppleFunction
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

func (r *Runtime) BeforeListFriendsOfFriends() RuntimeBeforeListFriendsOfFriendsFunction {
	return r.beforeReqFunctions.beforeListFriendsOfFriendsFunction
}

func (r *Runtime) AfterListFriendsOfFriends() RuntimeAfterListFriendsOfFriendsFunction {
	return r.afterReqFunctions.afterListFriendsOfFriendsFunction
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

func (r *Runtime) BeforeImportSteamFriends() RuntimeBeforeImportSteamFriendsFunction {
	return r.beforeReqFunctions.beforeImportSteamFriendsFunction
}

func (r *Runtime) AfterImportSteamFriends() RuntimeAfterImportSteamFriendsFunction {
	return r.afterReqFunctions.afterImportSteamFriendsFunction
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

func (r *Runtime) BeforeDemoteGroupUsers() RuntimeBeforeDemoteGroupUsersFunction {
	return r.beforeReqFunctions.beforeDemoteGroupUsersFunction
}

func (r *Runtime) AfterDemoteGroupUsers() RuntimeAfterDemoteGroupUsersFunction {
	return r.afterReqFunctions.afterDemoteGroupUsersFunction
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

func (r *Runtime) BeforeDeleteTournamentRecord() RuntimeBeforeDeleteTournamentRecordFunction {
	return r.beforeReqFunctions.beforeDeleteTournamentRecordFunction
}

func (r *Runtime) AfterDeleteTournamentRecord() RuntimeAfterDeleteTournamentRecordFunction {
	return r.afterReqFunctions.afterDeleteTournamentRecordFunction
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

func (r *Runtime) BeforeLinkApple() RuntimeBeforeLinkAppleFunction {
	return r.beforeReqFunctions.beforeLinkAppleFunction
}

func (r *Runtime) AfterLinkApple() RuntimeAfterLinkAppleFunction {
	return r.afterReqFunctions.afterLinkAppleFunction
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

func (r *Runtime) BeforeDeleteNotifications() RuntimeBeforeDeleteNotificationsFunction {
	return r.beforeReqFunctions.beforeDeleteNotificationsFunction
}

func (r *Runtime) AfterDeleteNotifications() RuntimeAfterDeleteNotificationsFunction {
	return r.afterReqFunctions.afterDeleteNotificationsFunction
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

func (r *Runtime) BeforeUnlinkApple() RuntimeBeforeUnlinkAppleFunction {
	return r.beforeReqFunctions.beforeUnlinkAppleFunction
}

func (r *Runtime) AfterUnlinkApple() RuntimeAfterUnlinkAppleFunction {
	return r.afterReqFunctions.afterUnlinkAppleFunction
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

func (r *Runtime) BeforeValidatePurchaseApple() RuntimeBeforeValidatePurchaseAppleFunction {
	return r.beforeReqFunctions.beforeValidatePurchaseAppleFunction
}

func (r *Runtime) AfterValidatePurchaseApple() RuntimeAfterValidatePurchaseAppleFunction {
	return r.afterReqFunctions.afterValidatePurchaseAppleFunction
}

func (r *Runtime) BeforeValidateSubscriptionApple() RuntimeBeforeValidateSubscriptionAppleFunction {
	return r.beforeReqFunctions.beforeValidateSubscriptionAppleFunction
}

func (r *Runtime) AfterValidateSubscriptionApple() RuntimeAfterValidateSubscriptionAppleFunction {
	return r.afterReqFunctions.afterValidateSubscriptionAppleFunction
}

func (r *Runtime) BeforeValidatePurchaseGoogle() RuntimeBeforeValidatePurchaseGoogleFunction {
	return r.beforeReqFunctions.beforeValidatePurchaseGoogleFunction
}

func (r *Runtime) AfterValidatePurchaseGoogle() RuntimeAfterValidatePurchaseGoogleFunction {
	return r.afterReqFunctions.afterValidatePurchaseGoogleFunction
}

func (r *Runtime) BeforeValidateSubscriptionGoogle() RuntimeBeforeValidateSubscriptionGoogleFunction {
	return r.beforeReqFunctions.beforeValidateSubscriptionGoogleFunction
}

func (r *Runtime) AfterValidateSubscriptionGoogle() RuntimeAfterValidateSubscriptionGoogleFunction {
	return r.afterReqFunctions.afterValidateSubscriptionGoogleFunction
}

func (r *Runtime) BeforeListSubscriptions() RuntimeBeforeListSubscriptionsFunction {
	return r.beforeReqFunctions.beforeListSubscriptionsFunction
}

func (r *Runtime) AfterListSubscriptions() RuntimeAfterListSubscriptionsFunction {
	return r.afterReqFunctions.afterListSubscriptionsFunction
}

func (r *Runtime) BeforeGetSubscription() RuntimeBeforeGetSubscriptionFunction {
	return r.beforeReqFunctions.beforeGetSubscriptionFunction
}

func (r *Runtime) AfterGetSubscription() RuntimeAfterGetSubscriptionFunction {
	return r.afterReqFunctions.afterGetSubscriptionFunction
}

func (r *Runtime) BeforeValidatePurchaseHuawei() RuntimeBeforeValidatePurchaseHuaweiFunction {
	return r.beforeReqFunctions.beforeValidatePurchaseHuaweiFunction
}

func (r *Runtime) AfterValidatePurchaseHuawei() RuntimeAfterValidatePurchaseHuaweiFunction {
	return r.afterReqFunctions.afterValidatePurchaseHuaweiFunction
}

func (r *Runtime) BeforeValidatePurchaseFacebookInstant() RuntimeBeforeValidatePurchaseFacebookInstantFunction {
	return r.beforeReqFunctions.beforeValidatePurchaseFacebookInstantFunction
}

func (r *Runtime) AfterValidatePurchaseFacebookInstant() RuntimeAfterValidatePurchaseFacebookInstantFunction {
	return r.afterReqFunctions.afterValidatePurchaseFacebookInstantFunction
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

func (r *Runtime) Shutdown() RuntimeShutdownFunction {
	return r.shutdownFunction
}

func (r *Runtime) PurchaseNotificationApple() RuntimePurchaseNotificationAppleFunction {
	return r.purchaseNotificationAppleFunction
}

func (r *Runtime) SubscriptionNotificationApple() RuntimeSubscriptionNotificationAppleFunction {
	return r.subscriptionNotificationAppleFunction
}

func (r *Runtime) PurchaseNotificationGoogle() RuntimePurchaseNotificationGoogleFunction {
	return r.purchaseNotificationGoogleFunction
}

func (r *Runtime) StorageIndexFilterFunction(indexName string) RuntimeStorageIndexFilterFunction {
	return r.storageIndexFilterFunctions[indexName]
}

func (r *Runtime) SubscriptionNotificationGoogle() RuntimeSubscriptionNotificationGoogleFunction {
	return r.subscriptionNotificationGoogleFunction
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
