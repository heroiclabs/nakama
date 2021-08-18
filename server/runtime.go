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

	"github.com/gofrs/uuid"
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
	RuntimeRpcFunction func(ctx context.Context, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang, payload string) (string, error, codes.Code)

	RuntimeBeforeRtFunction func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, envelope *rtapi.Envelope) (*rtapi.Envelope, error)
	RuntimeAfterRtFunction  func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, envelope *rtapi.Envelope) error

	RuntimeBeforeGetAccountFunction                        func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code)
	RuntimeAfterGetAccountFunction                         func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Account) error
	RuntimeBeforeUpdateAccountFunction                     func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, codes.Code)
	RuntimeAfterUpdateAccountFunction                      func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) error
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
	RuntimeBeforeValidatePurchaseGoogleFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseGoogleRequest) (*api.ValidatePurchaseGoogleRequest, error, codes.Code)
	RuntimeAfterValidatePurchaseGoogleFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseGoogleRequest) error
	RuntimeBeforeValidatePurchaseHuaweiFunction            func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseHuaweiRequest) (*api.ValidatePurchaseHuaweiRequest, error, codes.Code)
	RuntimeAfterValidatePurchaseHuaweiFunction             func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseHuaweiRequest) error

	RuntimeMatchmakerMatchedFunction func(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error)

	RuntimeMatchCreateFunction       func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error)
	RuntimeMatchDeferMessageFunction func(msg *DeferredMessage) error

	RuntimeTournamentEndFunction   func(ctx context.Context, tournament *api.Tournament, end, reset int64) error
	RuntimeTournamentResetFunction func(ctx context.Context, tournament *api.Tournament, end, reset int64) error

	RuntimeLeaderboardResetFunction func(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error

	RuntimeEventFunction func(ctx context.Context, logger runtime.Logger, evt *api.Event)

	RuntimeEventCustomFunction       func(ctx context.Context, evt *api.Event)
	RuntimeEventSessionStartFunction func(userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, evtTimeSec int64)
	RuntimeEventSessionEndFunction   func(userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, evtTimeSec int64, reason string)
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
	MatchJoinAttempt(tick int64, state interface{}, userID, sessionID uuid.UUID, username string, sessionExpiry int64, vars map[string]string, clientIP, clientPort, node string, metadata map[string]string) (interface{}, bool, string, error)
	MatchJoin(tick int64, state interface{}, joins []*MatchPresence) (interface{}, error)
	MatchLeave(tick int64, state interface{}, leaves []*MatchPresence) (interface{}, error)
	MatchLoop(tick int64, state interface{}, inputCh <-chan *MatchDataMessage) (interface{}, error)
	MatchTerminate(tick int64, state interface{}, graceSeconds int) (interface{}, error)
	GetState(state interface{}) (string, error)
	Label() string
	TickRate() int
	HandlerName() string
	CreateTime() int64
	Cancel()
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
	beforeValidatePurchaseGoogleFunction            RuntimeBeforeValidatePurchaseGoogleFunction
	beforeValidatePurchaseHuaweiFunction            RuntimeBeforeValidatePurchaseHuaweiFunction
}

type RuntimeAfterReqFunctions struct {
	afterGetAccountFunction                        RuntimeAfterGetAccountFunction
	afterUpdateAccountFunction                     RuntimeAfterUpdateAccountFunction
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
	afterValidatePurchaseGoogleFunction            RuntimeAfterValidatePurchaseGoogleFunction
	afterValidatePurchaseHuaweiFunction            RuntimeAfterValidatePurchaseHuaweiFunction
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

	consoleInfo *RuntimeInfo
}

type MatchNamesListFunction func() []string

type MatchProvider struct {
	sync.RWMutex
	providers     []RuntimeMatchCreateFunction
	providerNames []string
}

func (mp *MatchProvider) RegisterCreateFn(name string, fn RuntimeMatchCreateFunction) {
	mp.Lock()
	newProviders := make([]RuntimeMatchCreateFunction, len(mp.providers)+1, len(mp.providers)+1)
	copy(newProviders, mp.providers)
	newProviders[len(mp.providers)] = fn
	mp.providers = newProviders

	newProviderNames := make([]string, len(mp.providerNames)+1, len(mp.providerNames)+1)
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

	// Check any JavaScript runtime modules.
	err = CheckRuntimeProviderJavascript(logger, config)
	if err != nil {
		return err
	}

	return nil
}

func NewRuntime(ctx context.Context, logger, startupLogger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, matchRegistry MatchRegistry, tracker Tracker, metrics *Metrics, streamManager StreamManager, router MessageRouter) (*Runtime, *RuntimeInfo, error) {
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

	goModules, goRPCFunctions, goBeforeRtFunctions, goAfterRtFunctions, goBeforeReqFunctions, goAfterReqFunctions, goMatchmakerMatchedFunction, goTournamentEndFunction, goTournamentResetFunction, goLeaderboardResetFunction, allEventFunctions, goMatchNamesListFn, err := NewRuntimeProviderGo(ctx, logger, startupLogger, db, protojsonMarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, matchRegistry, tracker, metrics, streamManager, router, runtimeConfig.Path, paths, eventQueue, matchProvider)
	if err != nil {
		startupLogger.Error("Error initialising Go runtime provider", zap.Error(err))
		return nil, nil, err
	}

	luaModules, luaRPCFunctions, luaBeforeRtFunctions, luaAfterRtFunctions, luaBeforeReqFunctions, luaAfterReqFunctions, luaMatchmakerMatchedFunction, luaTournamentEndFunction, luaTournamentResetFunction, luaLeaderboardResetFunction, err := NewRuntimeProviderLua(logger, startupLogger, db, protojsonMarshaler, protojsonUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, matchRegistry, tracker, metrics, streamManager, router, allEventFunctions.eventFunction, runtimeConfig.Path, paths, matchProvider)
	if err != nil {
		startupLogger.Error("Error initialising Lua runtime provider", zap.Error(err))
		return nil, nil, err
	}

	jsModules, jsRPCFunctions, jsBeforeRtFunctions, jsAfterRtFunctions, jsBeforeReqFunctions, jsAfterReqFunctions, jsMatchmakerMatchedFunction, jsTournamentEndFunction, jsTournamentResetFunction, jsLeaderboardResetFunction, err := NewRuntimeProviderJS(logger, startupLogger, db, protojsonMarshaler, protojsonUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, matchRegistry, tracker, metrics, streamManager, router, allEventFunctions.eventFunction, runtimeConfig.Path, runtimeConfig.JsEntrypoint, matchProvider)
	if err != nil {
		startupLogger.Error("Error initialising JavaScript runtime provider", zap.Error(err))
		return nil, nil, err
	}

	allModules := make([]string, 0, len(jsModules)+len(luaModules)+len(goModules))
	for _, module := range jsModules {
		allModules = append(allModules, module)
	}
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

	allRPCFunctions := make(map[string]RuntimeRpcFunction, len(goRPCFunctions)+len(luaRPCFunctions)+len(jsRPCFunctions))
	jsRpcIDs := make(map[string]bool, len(jsRPCFunctions))
	for id, fn := range jsRPCFunctions {
		allRPCFunctions[id] = fn
		jsRpcIDs[id] = true
		startupLogger.Info("Registered JavaScript runtime RPC function invocation", zap.String("id", id))
	}
	luaRpcIDs := make(map[string]bool, len(luaRPCFunctions))
	for id, fn := range luaRPCFunctions {
		allRPCFunctions[id] = fn
		delete(jsRpcIDs, id)
		luaRpcIDs[id] = true
		startupLogger.Info("Registered Lua runtime RPC function invocation", zap.String("id", id))
	}
	goRpcIDs := make(map[string]bool, len(goRPCFunctions))
	for id, fn := range goRPCFunctions {
		allRPCFunctions[id] = fn
		delete(luaRpcIDs, id)
		goRpcIDs[id] = true
		startupLogger.Info("Registered Go runtime RPC function invocation", zap.String("id", id))
	}

	allBeforeRtFunctions := make(map[string]RuntimeBeforeRtFunction, len(jsBeforeRtFunctions)+len(luaBeforeRtFunctions)+len(goBeforeRtFunctions))
	for id, fn := range jsBeforeRtFunctions {
		allBeforeRtFunctions[id] = fn
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range luaBeforeRtFunctions {
		allBeforeRtFunctions[id] = fn
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range goBeforeRtFunctions {
		allBeforeRtFunctions[id] = fn
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}

	allAfterRtFunctions := make(map[string]RuntimeAfterRtFunction, len(jsAfterRtFunctions)+len(luaAfterRtFunctions)+len(goAfterRtFunctions))
	for id, fn := range jsAfterRtFunctions {
		allAfterRtFunctions[id] = fn
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range luaAfterRtFunctions {
		allAfterRtFunctions[id] = fn
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}
	for id, fn := range goAfterRtFunctions {
		allAfterRtFunctions[id] = fn
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", strings.TrimPrefix(strings.TrimPrefix(id, API_PREFIX), RTAPI_PREFIX)))
	}

	allBeforeReqFunctions := jsBeforeReqFunctions
	// Register JavaScript Before Req functions
	if allBeforeReqFunctions.beforeGetAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "getaccount"))
	}
	if allBeforeReqFunctions.beforeUpdateAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "updateaccount"))
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
	if allBeforeReqFunctions.beforeDeleteNotificationFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "deletenotification"))
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
	if allBeforeReqFunctions.beforeEventFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before custom events function invocation")
	}

	// Register Lua Before Req functions
	if luaBeforeReqFunctions.beforeGetAccountFunction != nil {
		allBeforeReqFunctions.beforeGetAccountFunction = luaBeforeReqFunctions.beforeGetAccountFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "getaccount"))
	}
	if luaBeforeReqFunctions.beforeUpdateAccountFunction != nil {
		allBeforeReqFunctions.beforeUpdateAccountFunction = luaBeforeReqFunctions.beforeUpdateAccountFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "updateaccount"))
	}
	if luaBeforeReqFunctions.beforeSessionRefreshFunction != nil {
		allBeforeReqFunctions.beforeSessionRefreshFunction = luaBeforeReqFunctions.beforeSessionRefreshFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "sessionrefresh"))
	}
	if luaBeforeReqFunctions.beforeSessionLogoutFunction != nil {
		allBeforeReqFunctions.beforeSessionLogoutFunction = luaBeforeReqFunctions.beforeSessionLogoutFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "sessionlogout"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateAppleFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateAppleFunction = luaBeforeReqFunctions.beforeAuthenticateAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticateapple"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateCustomFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateCustomFunction = luaBeforeReqFunctions.beforeAuthenticateCustomFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatecustom"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateDeviceFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateDeviceFunction = luaBeforeReqFunctions.beforeAuthenticateDeviceFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatedevice"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateEmailFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateEmailFunction = luaBeforeReqFunctions.beforeAuthenticateEmailFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticateemail"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateFacebookFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateFacebookFunction = luaBeforeReqFunctions.beforeAuthenticateFacebookFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatefacebook"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction = luaBeforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateGameCenterFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateGameCenterFunction = luaBeforeReqFunctions.beforeAuthenticateGameCenterFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticategamecenter"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateGoogleFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateGoogleFunction = luaBeforeReqFunctions.beforeAuthenticateGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticategoogle"))
	}
	if luaBeforeReqFunctions.beforeAuthenticateSteamFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateSteamFunction = luaBeforeReqFunctions.beforeAuthenticateSteamFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "authenticatesteam"))
	}
	if luaBeforeReqFunctions.beforeListChannelMessagesFunction != nil {
		allBeforeReqFunctions.beforeListChannelMessagesFunction = luaBeforeReqFunctions.beforeListChannelMessagesFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listchannelmessages"))
	}
	if luaBeforeReqFunctions.beforeListFriendsFunction != nil {
		allBeforeReqFunctions.beforeListFriendsFunction = luaBeforeReqFunctions.beforeListFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listfriends"))
	}
	if luaBeforeReqFunctions.beforeAddFriendsFunction != nil {
		allBeforeReqFunctions.beforeAddFriendsFunction = luaBeforeReqFunctions.beforeAddFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "addfriends"))
	}
	if luaBeforeReqFunctions.beforeDeleteFriendsFunction != nil {
		allBeforeReqFunctions.beforeDeleteFriendsFunction = luaBeforeReqFunctions.beforeDeleteFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletefriends"))
	}
	if luaBeforeReqFunctions.beforeBlockFriendsFunction != nil {
		allBeforeReqFunctions.beforeBlockFriendsFunction = luaBeforeReqFunctions.beforeBlockFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "blockfriends"))
	}
	if luaBeforeReqFunctions.beforeImportFacebookFriendsFunction != nil {
		allBeforeReqFunctions.beforeImportFacebookFriendsFunction = luaBeforeReqFunctions.beforeImportFacebookFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "importfacebookfriends"))
	}
	if luaBeforeReqFunctions.beforeImportSteamFriendsFunction != nil {
		allBeforeReqFunctions.beforeImportSteamFriendsFunction = luaBeforeReqFunctions.beforeImportSteamFriendsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "importsteamfriends"))
	}
	if luaBeforeReqFunctions.beforeCreateGroupFunction != nil {
		allBeforeReqFunctions.beforeCreateGroupFunction = luaBeforeReqFunctions.beforeCreateGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "creategroup"))
	}
	if luaBeforeReqFunctions.beforeUpdateGroupFunction != nil {
		allBeforeReqFunctions.beforeUpdateGroupFunction = luaBeforeReqFunctions.beforeUpdateGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "updategroup"))
	}
	if luaBeforeReqFunctions.beforeDeleteGroupFunction != nil {
		allBeforeReqFunctions.beforeDeleteGroupFunction = luaBeforeReqFunctions.beforeDeleteGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletegroup"))
	}
	if luaBeforeReqFunctions.beforeJoinGroupFunction != nil {
		allBeforeReqFunctions.beforeJoinGroupFunction = luaBeforeReqFunctions.beforeJoinGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "joingroup"))
	}
	if luaBeforeReqFunctions.beforeLeaveGroupFunction != nil {
		allBeforeReqFunctions.beforeLeaveGroupFunction = luaBeforeReqFunctions.beforeLeaveGroupFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "leavegroup"))
	}
	if luaBeforeReqFunctions.beforeAddGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeAddGroupUsersFunction = luaBeforeReqFunctions.beforeAddGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "addgroupusers"))
	}
	if luaBeforeReqFunctions.beforeBanGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeBanGroupUsersFunction = luaBeforeReqFunctions.beforeBanGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "bangroupusers"))
	}
	if luaBeforeReqFunctions.beforeKickGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeKickGroupUsersFunction = luaBeforeReqFunctions.beforeKickGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "kickgroupusers"))
	}
	if luaBeforeReqFunctions.beforePromoteGroupUsersFunction != nil {
		allBeforeReqFunctions.beforePromoteGroupUsersFunction = luaBeforeReqFunctions.beforePromoteGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "promotegroupusers"))
	}
	if luaBeforeReqFunctions.beforeListGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeListGroupUsersFunction = luaBeforeReqFunctions.beforeListGroupUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listgroupusers"))
	}
	if luaBeforeReqFunctions.beforeListUserGroupsFunction != nil {
		allBeforeReqFunctions.beforeListUserGroupsFunction = luaBeforeReqFunctions.beforeListUserGroupsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listusergroups"))
	}
	if luaBeforeReqFunctions.beforeListGroupsFunction != nil {
		allBeforeReqFunctions.beforeListGroupsFunction = luaBeforeReqFunctions.beforeListGroupsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listgroups"))
	}
	if luaBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction != nil {
		allBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction = luaBeforeReqFunctions.beforeDeleteLeaderboardRecordFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if luaBeforeReqFunctions.beforeListLeaderboardRecordsFunction != nil {
		allBeforeReqFunctions.beforeListLeaderboardRecordsFunction = luaBeforeReqFunctions.beforeListLeaderboardRecordsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if luaBeforeReqFunctions.beforeWriteLeaderboardRecordFunction != nil {
		allBeforeReqFunctions.beforeWriteLeaderboardRecordFunction = luaBeforeReqFunctions.beforeWriteLeaderboardRecordFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if luaBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction != nil {
		allBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction = luaBeforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if luaBeforeReqFunctions.beforeLinkAppleFunction != nil {
		allBeforeReqFunctions.beforeLinkAppleFunction = luaBeforeReqFunctions.beforeLinkAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkapple"))
	}
	if luaBeforeReqFunctions.beforeLinkCustomFunction != nil {
		allBeforeReqFunctions.beforeLinkCustomFunction = luaBeforeReqFunctions.beforeLinkCustomFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkcustom"))
	}
	if luaBeforeReqFunctions.beforeLinkDeviceFunction != nil {
		allBeforeReqFunctions.beforeLinkDeviceFunction = luaBeforeReqFunctions.beforeLinkDeviceFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkdevice"))
	}
	if luaBeforeReqFunctions.beforeLinkEmailFunction != nil {
		allBeforeReqFunctions.beforeLinkEmailFunction = luaBeforeReqFunctions.beforeLinkEmailFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkemail"))
	}
	if luaBeforeReqFunctions.beforeLinkFacebookFunction != nil {
		allBeforeReqFunctions.beforeLinkFacebookFunction = luaBeforeReqFunctions.beforeLinkFacebookFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkfacebook"))
	}
	if luaBeforeReqFunctions.beforeLinkFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeLinkFacebookInstantGameFunction = luaBeforeReqFunctions.beforeLinkFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if luaBeforeReqFunctions.beforeLinkGameCenterFunction != nil {
		allBeforeReqFunctions.beforeLinkGameCenterFunction = luaBeforeReqFunctions.beforeLinkGameCenterFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkgamecenter"))
	}
	if luaBeforeReqFunctions.beforeLinkGoogleFunction != nil {
		allBeforeReqFunctions.beforeLinkGoogleFunction = luaBeforeReqFunctions.beforeLinkGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linkgoogle"))
	}
	if luaBeforeReqFunctions.beforeLinkSteamFunction != nil {
		allBeforeReqFunctions.beforeLinkSteamFunction = luaBeforeReqFunctions.beforeLinkSteamFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "linksteam"))
	}
	if luaBeforeReqFunctions.beforeListMatchesFunction != nil {
		allBeforeReqFunctions.beforeListMatchesFunction = luaBeforeReqFunctions.beforeListMatchesFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listmatches"))
	}
	if luaBeforeReqFunctions.beforeListNotificationsFunction != nil {
		allBeforeReqFunctions.beforeListNotificationsFunction = luaBeforeReqFunctions.beforeListNotificationsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listnotifications"))
	}
	if luaBeforeReqFunctions.beforeDeleteNotificationFunction != nil {
		allBeforeReqFunctions.beforeDeleteNotificationFunction = luaBeforeReqFunctions.beforeDeleteNotificationFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletenotification"))
	}
	if luaBeforeReqFunctions.beforeListStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeListStorageObjectsFunction = luaBeforeReqFunctions.beforeListStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "liststorageobjects"))
	}
	if luaBeforeReqFunctions.beforeReadStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeReadStorageObjectsFunction = luaBeforeReqFunctions.beforeReadStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "readstorageobjects"))
	}
	if luaBeforeReqFunctions.beforeWriteStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeWriteStorageObjectsFunction = luaBeforeReqFunctions.beforeWriteStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writestorageobjects"))
	}
	if luaBeforeReqFunctions.beforeDeleteStorageObjectsFunction != nil {
		allBeforeReqFunctions.beforeDeleteStorageObjectsFunction = luaBeforeReqFunctions.beforeDeleteStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "deletestorageobjects"))
	}
	if luaBeforeReqFunctions.beforeJoinTournamentFunction != nil {
		allBeforeReqFunctions.beforeJoinTournamentFunction = luaBeforeReqFunctions.beforeJoinTournamentFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "jointournament"))
	}
	if luaBeforeReqFunctions.beforeListTournamentRecordsFunction != nil {
		allBeforeReqFunctions.beforeListTournamentRecordsFunction = luaBeforeReqFunctions.beforeListTournamentRecordsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournamentrecords"))
	}
	if luaBeforeReqFunctions.beforeListTournamentsFunction != nil {
		allBeforeReqFunctions.beforeListTournamentsFunction = luaBeforeReqFunctions.beforeListTournamentsFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournaments"))
	}
	if luaBeforeReqFunctions.beforeWriteTournamentRecordFunction != nil {
		allBeforeReqFunctions.beforeWriteTournamentRecordFunction = luaBeforeReqFunctions.beforeWriteTournamentRecordFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "writetournamentrecord"))
	}
	if luaBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction != nil {
		allBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction = luaBeforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if luaBeforeReqFunctions.beforeUnlinkAppleFunction != nil {
		allBeforeReqFunctions.beforeUnlinkAppleFunction = luaBeforeReqFunctions.beforeUnlinkAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkapple"))
	}
	if luaBeforeReqFunctions.beforeUnlinkCustomFunction != nil {
		allBeforeReqFunctions.beforeUnlinkCustomFunction = luaBeforeReqFunctions.beforeUnlinkCustomFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkcustom"))
	}
	if luaBeforeReqFunctions.beforeUnlinkDeviceFunction != nil {
		allBeforeReqFunctions.beforeUnlinkDeviceFunction = luaBeforeReqFunctions.beforeUnlinkDeviceFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkdevice"))
	}
	if luaBeforeReqFunctions.beforeUnlinkEmailFunction != nil {
		allBeforeReqFunctions.beforeUnlinkEmailFunction = luaBeforeReqFunctions.beforeUnlinkEmailFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkemail"))
	}
	if luaBeforeReqFunctions.beforeUnlinkFacebookFunction != nil {
		allBeforeReqFunctions.beforeUnlinkFacebookFunction = luaBeforeReqFunctions.beforeUnlinkFacebookFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkfacebook"))
	}
	if luaBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction != nil {
		allBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction = luaBeforeReqFunctions.beforeUnlinkFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if luaBeforeReqFunctions.beforeUnlinkGameCenterFunction != nil {
		allBeforeReqFunctions.beforeUnlinkGameCenterFunction = luaBeforeReqFunctions.beforeUnlinkGameCenterFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if luaBeforeReqFunctions.beforeUnlinkGoogleFunction != nil {
		allBeforeReqFunctions.beforeUnlinkGoogleFunction = luaBeforeReqFunctions.beforeUnlinkGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinkgoogle"))
	}
	if luaBeforeReqFunctions.beforeUnlinkSteamFunction != nil {
		allBeforeReqFunctions.beforeUnlinkSteamFunction = luaBeforeReqFunctions.beforeUnlinkSteamFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "unlinksteam"))
	}
	if luaBeforeReqFunctions.beforeGetUsersFunction != nil {
		allBeforeReqFunctions.beforeGetUsersFunction = luaBeforeReqFunctions.beforeGetUsersFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "getusers"))
	}
	if luaBeforeReqFunctions.beforeValidatePurchaseAppleFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseAppleFunction = luaBeforeReqFunctions.beforeValidatePurchaseAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if luaBeforeReqFunctions.beforeValidatePurchaseGoogleFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseGoogleFunction = luaBeforeReqFunctions.beforeValidatePurchaseGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if luaBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction = luaBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if luaBeforeReqFunctions.beforeEventFunction != nil {
		allBeforeReqFunctions.beforeEventFunction = luaBeforeReqFunctions.beforeEventFunction
		startupLogger.Info("Registered Lua runtime Before custom events function invocation")
	}

	// Register Go Before Req functions
	if goBeforeReqFunctions.beforeGetAccountFunction != nil {
		allBeforeReqFunctions.beforeGetAccountFunction = goBeforeReqFunctions.beforeGetAccountFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "getaccount"))
	}
	if goBeforeReqFunctions.beforeUpdateAccountFunction != nil {
		allBeforeReqFunctions.beforeUpdateAccountFunction = goBeforeReqFunctions.beforeUpdateAccountFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "updateaccount"))
	}
	if goBeforeReqFunctions.beforeSessionRefreshFunction != nil {
		allBeforeReqFunctions.beforeSessionRefreshFunction = goBeforeReqFunctions.beforeSessionRefreshFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "sessionrefresh"))
	}
	if goBeforeReqFunctions.beforeSessionLogoutFunction != nil {
		allBeforeReqFunctions.beforeSessionLogoutFunction = goBeforeReqFunctions.beforeSessionLogoutFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "sessionlogout"))
	}
	if goBeforeReqFunctions.beforeAuthenticateAppleFunction != nil {
		allBeforeReqFunctions.beforeAuthenticateAppleFunction = goBeforeReqFunctions.beforeAuthenticateAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "authenticateapple"))
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
	if goBeforeReqFunctions.beforeImportSteamFriendsFunction != nil {
		allBeforeReqFunctions.beforeImportSteamFriendsFunction = goBeforeReqFunctions.beforeImportSteamFriendsFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "importsteamfriends"))
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
	if goBeforeReqFunctions.beforeDemoteGroupUsersFunction != nil {
		allBeforeReqFunctions.beforeDemoteGroupUsersFunction = goBeforeReqFunctions.beforeDemoteGroupUsersFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "demotegroupusers"))
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
	if goBeforeReqFunctions.beforeLinkAppleFunction != nil {
		allBeforeReqFunctions.beforeLinkAppleFunction = goBeforeReqFunctions.beforeLinkAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "linkapple"))
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
	if goBeforeReqFunctions.beforeUnlinkAppleFunction != nil {
		allBeforeReqFunctions.beforeUnlinkAppleFunction = goBeforeReqFunctions.beforeUnlinkAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "unlinkapple"))
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
	if goBeforeReqFunctions.beforeValidatePurchaseAppleFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseAppleFunction = goBeforeReqFunctions.beforeValidatePurchaseAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validateapple"))
	}
	if goBeforeReqFunctions.beforeValidatePurchaseGoogleFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseGoogleFunction = goBeforeReqFunctions.beforeValidatePurchaseGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if goBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction != nil {
		allBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction = goBeforeReqFunctions.beforeValidatePurchaseHuaweiFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if goBeforeReqFunctions.beforeEventFunction != nil {
		allBeforeReqFunctions.beforeEventFunction = goBeforeReqFunctions.beforeEventFunction
		startupLogger.Info("Registered Go runtime Before custom events function invocation")
	}

	allAfterReqFunctions := jsAfterReqFunctions
	// Register JavaScript After req functions
	if allAfterReqFunctions.afterGetAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "getaccount"))
	}
	if allAfterReqFunctions.afterUpdateAccountFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "updateaccount"))
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
	if allAfterReqFunctions.afterDeleteNotificationFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After function invocation", zap.String("id", "deletenotification"))
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
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if allAfterReqFunctions.afterValidatePurchaseGoogleFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if allAfterReqFunctions.afterValidatePurchaseHuaweiFunction != nil {
		startupLogger.Info("Registered JavaScript runtime Before function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if allAfterReqFunctions.afterEventFunction != nil {
		startupLogger.Info("Registered JavaScript runtime After custom events function invocation")
	}

	// Register Lua After req Functions
	if luaAfterReqFunctions.afterGetAccountFunction != nil {
		allAfterReqFunctions.afterGetAccountFunction = luaAfterReqFunctions.afterGetAccountFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "getaccount"))
	}
	if luaAfterReqFunctions.afterUpdateAccountFunction != nil {
		allAfterReqFunctions.afterUpdateAccountFunction = luaAfterReqFunctions.afterUpdateAccountFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "updateaccount"))
	}
	if luaAfterReqFunctions.afterSessionRefreshFunction != nil {
		allAfterReqFunctions.afterSessionRefreshFunction = luaAfterReqFunctions.afterSessionRefreshFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "sessionrefresh"))
	}
	if luaAfterReqFunctions.afterSessionLogoutFunction != nil {
		allAfterReqFunctions.afterSessionLogoutFunction = luaAfterReqFunctions.afterSessionLogoutFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "sessionlogout"))
	}
	if luaAfterReqFunctions.afterAuthenticateAppleFunction != nil {
		allAfterReqFunctions.afterAuthenticateAppleFunction = luaAfterReqFunctions.afterAuthenticateAppleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticateapple"))
	}
	if luaAfterReqFunctions.afterAuthenticateCustomFunction != nil {
		allAfterReqFunctions.afterAuthenticateCustomFunction = luaAfterReqFunctions.afterAuthenticateCustomFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatecustom"))
	}
	if luaAfterReqFunctions.afterAuthenticateDeviceFunction != nil {
		allAfterReqFunctions.afterAuthenticateDeviceFunction = luaAfterReqFunctions.afterAuthenticateDeviceFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatedevice"))
	}
	if luaAfterReqFunctions.afterAuthenticateEmailFunction != nil {
		allAfterReqFunctions.afterAuthenticateEmailFunction = luaAfterReqFunctions.afterAuthenticateEmailFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticateemail"))
	}
	if luaAfterReqFunctions.afterAuthenticateFacebookFunction != nil {
		allAfterReqFunctions.afterAuthenticateFacebookFunction = luaAfterReqFunctions.afterAuthenticateFacebookFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatefacebook"))
	}
	if luaAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction = luaAfterReqFunctions.afterAuthenticateFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatefacebookinstantgame"))
	}
	if luaAfterReqFunctions.afterAuthenticateGameCenterFunction != nil {
		allAfterReqFunctions.afterAuthenticateGameCenterFunction = luaAfterReqFunctions.afterAuthenticateGameCenterFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticategamecenter"))
	}
	if luaAfterReqFunctions.afterAuthenticateGoogleFunction != nil {
		allAfterReqFunctions.afterAuthenticateGoogleFunction = luaAfterReqFunctions.afterAuthenticateGoogleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticategoogle"))
	}
	if luaAfterReqFunctions.afterAuthenticateSteamFunction != nil {
		allAfterReqFunctions.afterAuthenticateSteamFunction = luaAfterReqFunctions.afterAuthenticateSteamFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "authenticatesteam"))
	}
	if luaAfterReqFunctions.afterListChannelMessagesFunction != nil {
		allAfterReqFunctions.afterListChannelMessagesFunction = luaAfterReqFunctions.afterListChannelMessagesFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listchannelmessages"))
	}
	if luaAfterReqFunctions.afterListFriendsFunction != nil {
		allAfterReqFunctions.afterListFriendsFunction = luaAfterReqFunctions.afterListFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listfriends"))
	}
	if luaAfterReqFunctions.afterAddFriendsFunction != nil {
		allAfterReqFunctions.afterAddFriendsFunction = luaAfterReqFunctions.afterAddFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "addfriends"))
	}
	if luaAfterReqFunctions.afterDeleteFriendsFunction != nil {
		allAfterReqFunctions.afterDeleteFriendsFunction = luaAfterReqFunctions.afterDeleteFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletefriends"))
	}
	if luaAfterReqFunctions.afterBlockFriendsFunction != nil {
		allAfterReqFunctions.afterBlockFriendsFunction = luaAfterReqFunctions.afterBlockFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "blockfriends"))
	}
	if luaAfterReqFunctions.afterImportFacebookFriendsFunction != nil {
		allAfterReqFunctions.afterImportFacebookFriendsFunction = luaAfterReqFunctions.afterImportFacebookFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "importfacebookfriends"))
	}
	if luaAfterReqFunctions.afterImportSteamFriendsFunction != nil {
		allAfterReqFunctions.afterImportSteamFriendsFunction = luaAfterReqFunctions.afterImportSteamFriendsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "importsteamfriends"))
	}
	if luaAfterReqFunctions.afterCreateGroupFunction != nil {
		allAfterReqFunctions.afterCreateGroupFunction = luaAfterReqFunctions.afterCreateGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "creategroup"))
	}
	if luaAfterReqFunctions.afterUpdateGroupFunction != nil {
		allAfterReqFunctions.afterUpdateGroupFunction = luaAfterReqFunctions.afterUpdateGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "updategroup"))
	}
	if luaAfterReqFunctions.afterDeleteGroupFunction != nil {
		allAfterReqFunctions.afterDeleteGroupFunction = luaAfterReqFunctions.afterDeleteGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletegroup"))
	}
	if luaAfterReqFunctions.afterJoinGroupFunction != nil {
		allAfterReqFunctions.afterJoinGroupFunction = luaAfterReqFunctions.afterJoinGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "joingroup"))
	}
	if luaAfterReqFunctions.afterLeaveGroupFunction != nil {
		allAfterReqFunctions.afterLeaveGroupFunction = luaAfterReqFunctions.afterLeaveGroupFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "leavegroup"))
	}
	if luaAfterReqFunctions.afterAddGroupUsersFunction != nil {
		allAfterReqFunctions.afterAddGroupUsersFunction = luaAfterReqFunctions.afterAddGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "addgroupusers"))
	}
	if luaAfterReqFunctions.afterBanGroupUsersFunction != nil {
		allAfterReqFunctions.afterBanGroupUsersFunction = luaAfterReqFunctions.afterBanGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "bangroupusers"))
	}
	if luaAfterReqFunctions.afterKickGroupUsersFunction != nil {
		allAfterReqFunctions.afterKickGroupUsersFunction = luaAfterReqFunctions.afterKickGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "kickgroupusers"))
	}
	if luaAfterReqFunctions.afterPromoteGroupUsersFunction != nil {
		allAfterReqFunctions.afterPromoteGroupUsersFunction = luaAfterReqFunctions.afterPromoteGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "promotegroupusers"))
	}
	if luaAfterReqFunctions.afterListGroupUsersFunction != nil {
		allAfterReqFunctions.afterListGroupUsersFunction = luaAfterReqFunctions.afterListGroupUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listgroupusers"))
	}
	if luaAfterReqFunctions.afterListUserGroupsFunction != nil {
		allAfterReqFunctions.afterListUserGroupsFunction = luaAfterReqFunctions.afterListUserGroupsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listusergroups"))
	}
	if luaAfterReqFunctions.afterListGroupsFunction != nil {
		allAfterReqFunctions.afterListGroupsFunction = luaAfterReqFunctions.afterListGroupsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listgroups"))
	}
	if luaAfterReqFunctions.afterDeleteLeaderboardRecordFunction != nil {
		allAfterReqFunctions.afterDeleteLeaderboardRecordFunction = luaAfterReqFunctions.afterDeleteLeaderboardRecordFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deleteleaderboardrecord"))
	}
	if luaAfterReqFunctions.afterListLeaderboardRecordsFunction != nil {
		allAfterReqFunctions.afterListLeaderboardRecordsFunction = luaAfterReqFunctions.afterListLeaderboardRecordsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listleaderboardrecords"))
	}
	if luaAfterReqFunctions.afterWriteLeaderboardRecordFunction != nil {
		allAfterReqFunctions.afterWriteLeaderboardRecordFunction = luaAfterReqFunctions.afterWriteLeaderboardRecordFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writeleaderboardrecord"))
	}
	if luaAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction != nil {
		allAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction = luaAfterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listleaderboardrecordsaroundowner"))
	}
	if luaAfterReqFunctions.afterLinkAppleFunction != nil {
		allAfterReqFunctions.afterLinkAppleFunction = luaAfterReqFunctions.afterLinkAppleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkapple"))
	}
	if luaAfterReqFunctions.afterLinkCustomFunction != nil {
		allAfterReqFunctions.afterLinkCustomFunction = luaAfterReqFunctions.afterLinkCustomFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkcustom"))
	}
	if luaAfterReqFunctions.afterLinkDeviceFunction != nil {
		allAfterReqFunctions.afterLinkDeviceFunction = luaAfterReqFunctions.afterLinkDeviceFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkdevice"))
	}
	if luaAfterReqFunctions.afterLinkEmailFunction != nil {
		allAfterReqFunctions.afterLinkEmailFunction = luaAfterReqFunctions.afterLinkEmailFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkemail"))
	}
	if luaAfterReqFunctions.afterLinkFacebookFunction != nil {
		allAfterReqFunctions.afterLinkFacebookFunction = luaAfterReqFunctions.afterLinkFacebookFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkfacebook"))
	}
	if luaAfterReqFunctions.afterLinkFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterLinkFacebookInstantGameFunction = luaAfterReqFunctions.afterLinkFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkfacebookinstantgame"))
	}
	if luaAfterReqFunctions.afterLinkGameCenterFunction != nil {
		allAfterReqFunctions.afterLinkGameCenterFunction = luaAfterReqFunctions.afterLinkGameCenterFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkgamecenter"))
	}
	if luaAfterReqFunctions.afterLinkGoogleFunction != nil {
		allAfterReqFunctions.afterLinkGoogleFunction = luaAfterReqFunctions.afterLinkGoogleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linkgoogle"))
	}
	if luaAfterReqFunctions.afterLinkSteamFunction != nil {
		allAfterReqFunctions.afterLinkSteamFunction = luaAfterReqFunctions.afterLinkSteamFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "linksteam"))
	}
	if luaAfterReqFunctions.afterListMatchesFunction != nil {
		allAfterReqFunctions.afterListMatchesFunction = luaAfterReqFunctions.afterListMatchesFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listmatches"))
	}
	if luaAfterReqFunctions.afterListNotificationsFunction != nil {
		allAfterReqFunctions.afterListNotificationsFunction = luaAfterReqFunctions.afterListNotificationsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listnotifications"))
	}
	if luaAfterReqFunctions.afterDeleteNotificationFunction != nil {
		allAfterReqFunctions.afterDeleteNotificationFunction = luaAfterReqFunctions.afterDeleteNotificationFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletenotification"))
	}
	if luaAfterReqFunctions.afterListStorageObjectsFunction != nil {
		allAfterReqFunctions.afterListStorageObjectsFunction = luaAfterReqFunctions.afterListStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "liststorageobjects"))
	}
	if luaAfterReqFunctions.afterReadStorageObjectsFunction != nil {
		allAfterReqFunctions.afterReadStorageObjectsFunction = luaAfterReqFunctions.afterReadStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "readstorageobjects"))
	}
	if luaAfterReqFunctions.afterWriteStorageObjectsFunction != nil {
		allAfterReqFunctions.afterWriteStorageObjectsFunction = luaAfterReqFunctions.afterWriteStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writestorageobjects"))
	}
	if luaAfterReqFunctions.afterDeleteStorageObjectsFunction != nil {
		allAfterReqFunctions.afterDeleteStorageObjectsFunction = luaAfterReqFunctions.afterDeleteStorageObjectsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "deletestorageobjects"))
	}
	if luaAfterReqFunctions.afterJoinTournamentFunction != nil {
		allAfterReqFunctions.afterJoinTournamentFunction = luaAfterReqFunctions.afterJoinTournamentFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "jointournament"))
	}
	if luaAfterReqFunctions.afterListTournamentRecordsFunction != nil {
		allAfterReqFunctions.afterListTournamentRecordsFunction = luaAfterReqFunctions.afterListTournamentRecordsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournamentrecords"))
	}
	if luaAfterReqFunctions.afterListTournamentsFunction != nil {
		allAfterReqFunctions.afterListTournamentsFunction = luaAfterReqFunctions.afterListTournamentsFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournaments"))
	}
	if luaAfterReqFunctions.afterWriteTournamentRecordFunction != nil {
		allAfterReqFunctions.afterWriteTournamentRecordFunction = luaAfterReqFunctions.afterWriteTournamentRecordFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "writetournamentrecord"))
	}
	if luaAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction != nil {
		allAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction = luaAfterReqFunctions.afterListTournamentRecordsAroundOwnerFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "listtournamentrecordsaroundowner"))
	}
	if luaAfterReqFunctions.afterUnlinkAppleFunction != nil {
		allAfterReqFunctions.afterUnlinkAppleFunction = luaAfterReqFunctions.afterUnlinkAppleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkapple"))
	}
	if luaAfterReqFunctions.afterUnlinkCustomFunction != nil {
		allAfterReqFunctions.afterUnlinkCustomFunction = luaAfterReqFunctions.afterUnlinkCustomFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkcustom"))
	}
	if luaAfterReqFunctions.afterUnlinkDeviceFunction != nil {
		allAfterReqFunctions.afterUnlinkDeviceFunction = luaAfterReqFunctions.afterUnlinkDeviceFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkdevice"))
	}
	if luaAfterReqFunctions.afterUnlinkEmailFunction != nil {
		allAfterReqFunctions.afterUnlinkEmailFunction = luaAfterReqFunctions.afterUnlinkEmailFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkemail"))
	}
	if luaAfterReqFunctions.afterUnlinkFacebookFunction != nil {
		allAfterReqFunctions.afterUnlinkFacebookFunction = luaAfterReqFunctions.afterUnlinkFacebookFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkfacebook"))
	}
	if luaAfterReqFunctions.afterUnlinkFacebookInstantGameFunction != nil {
		allAfterReqFunctions.afterUnlinkFacebookInstantGameFunction = luaAfterReqFunctions.afterUnlinkFacebookInstantGameFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkfacebookinstantgame"))
	}
	if luaAfterReqFunctions.afterUnlinkGameCenterFunction != nil {
		allAfterReqFunctions.afterUnlinkGameCenterFunction = luaAfterReqFunctions.afterUnlinkGameCenterFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkgamecenter"))
	}
	if luaAfterReqFunctions.afterUnlinkGoogleFunction != nil {
		allAfterReqFunctions.afterUnlinkGoogleFunction = luaAfterReqFunctions.afterUnlinkGoogleFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinkgoogle"))
	}
	if luaAfterReqFunctions.afterUnlinkSteamFunction != nil {
		allAfterReqFunctions.afterUnlinkSteamFunction = luaAfterReqFunctions.afterUnlinkSteamFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "unlinksteam"))
	}
	if luaAfterReqFunctions.afterGetUsersFunction != nil {
		allAfterReqFunctions.afterGetUsersFunction = luaAfterReqFunctions.afterGetUsersFunction
		startupLogger.Info("Registered Lua runtime After function invocation", zap.String("id", "getusers"))
	}
	if luaAfterReqFunctions.afterValidatePurchaseAppleFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseAppleFunction = luaAfterReqFunctions.afterValidatePurchaseAppleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if luaAfterReqFunctions.afterValidatePurchaseGoogleFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseGoogleFunction = luaAfterReqFunctions.afterValidatePurchaseGoogleFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if luaAfterReqFunctions.afterValidatePurchaseHuaweiFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseHuaweiFunction = luaAfterReqFunctions.afterValidatePurchaseHuaweiFunction
		startupLogger.Info("Registered Lua runtime Before function invocation", zap.String("id", "validatepurchasehuawei"))
	}
	if luaAfterReqFunctions.afterEventFunction != nil {
		allAfterReqFunctions.afterEventFunction = luaAfterReqFunctions.afterEventFunction
		startupLogger.Info("Registered Lua runtime After custom events function invocation")
	}

	// Register Go After req functions
	if goAfterReqFunctions.afterGetAccountFunction != nil {
		allAfterReqFunctions.afterGetAccountFunction = goAfterReqFunctions.afterGetAccountFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "getaccount"))
	}
	if goAfterReqFunctions.afterUpdateAccountFunction != nil {
		allAfterReqFunctions.afterUpdateAccountFunction = goAfterReqFunctions.afterUpdateAccountFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "updateaccount"))
	}
	if goAfterReqFunctions.afterSessionRefreshFunction != nil {
		allAfterReqFunctions.afterSessionRefreshFunction = goAfterReqFunctions.afterSessionRefreshFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "sessionrefresh"))
	}
	if goAfterReqFunctions.afterSessionLogoutFunction != nil {
		allAfterReqFunctions.afterSessionLogoutFunction = goAfterReqFunctions.afterSessionLogoutFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "sessionlogout"))
	}
	if goAfterReqFunctions.afterAuthenticateAppleFunction != nil {
		allAfterReqFunctions.afterAuthenticateAppleFunction = goAfterReqFunctions.afterAuthenticateAppleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "authenticateapple"))
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
	if goAfterReqFunctions.afterImportSteamFriendsFunction != nil {
		allAfterReqFunctions.afterImportSteamFriendsFunction = goAfterReqFunctions.afterImportSteamFriendsFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "importsteamfriends"))
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
	if goAfterReqFunctions.afterDemoteGroupUsersFunction != nil {
		allAfterReqFunctions.afterDemoteGroupUsersFunction = goAfterReqFunctions.afterDemoteGroupUsersFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "demotegroupusers"))
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
	if goAfterReqFunctions.afterLinkAppleFunction != nil {
		allAfterReqFunctions.afterLinkAppleFunction = goAfterReqFunctions.afterLinkAppleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "linkapple"))
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
	if goAfterReqFunctions.afterUnlinkAppleFunction != nil {
		allAfterReqFunctions.afterUnlinkAppleFunction = goAfterReqFunctions.afterUnlinkAppleFunction
		startupLogger.Info("Registered Go runtime After function invocation", zap.String("id", "unlinkapple"))
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
	if goAfterReqFunctions.afterValidatePurchaseAppleFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseAppleFunction = goAfterReqFunctions.afterValidatePurchaseAppleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatepurchaseapple"))
	}
	if goAfterReqFunctions.afterValidatePurchaseGoogleFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseGoogleFunction = goAfterReqFunctions.afterValidatePurchaseGoogleFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatepurchasegoogle"))
	}
	if goAfterReqFunctions.afterValidatePurchaseHuaweiFunction != nil {
		allAfterReqFunctions.afterValidatePurchaseHuaweiFunction = goAfterReqFunctions.afterValidatePurchaseHuaweiFunction
		startupLogger.Info("Registered Go runtime Before function invocation", zap.String("id", "validatepurchasehuawei"))
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
	case jsMatchmakerMatchedFunction != nil:
		allMatchmakerMatchedFunction = jsMatchmakerMatchedFunction
		startupLogger.Info("Registered JavaScript runtime Matchmaker Matched function invocation")
	}

	var allTournamentEndFunction RuntimeTournamentEndFunction
	switch {
	case goTournamentEndFunction != nil:
		allTournamentEndFunction = goTournamentEndFunction
		startupLogger.Info("Registered Go runtime Tournament End function invocation")
	case luaTournamentEndFunction != nil:
		allTournamentEndFunction = luaTournamentEndFunction
		startupLogger.Info("Registered Lua runtime Tournament End function invocation")
	case jsTournamentEndFunction != nil:
		allTournamentEndFunction = jsTournamentEndFunction
		startupLogger.Info("Registered JavaScript runtime Tournament End function invocation")
	}

	var allTournamentResetFunction RuntimeTournamentResetFunction
	switch {
	case goTournamentResetFunction != nil:
		allTournamentResetFunction = goTournamentResetFunction
		startupLogger.Info("Registered Go runtime Tournament Reset function invocation")
	case luaTournamentResetFunction != nil:
		allTournamentResetFunction = luaTournamentResetFunction
		startupLogger.Info("Registered Lua runtime Tournament Reset function invocation")
	case jsTournamentResetFunction != nil:
		allTournamentResetFunction = jsTournamentResetFunction
		startupLogger.Info("Registered JavaScript runtime Tournament Reset function invocation")
	}

	var allLeaderboardResetFunction RuntimeLeaderboardResetFunction
	switch {
	case goLeaderboardResetFunction != nil:
		allLeaderboardResetFunction = goLeaderboardResetFunction
		startupLogger.Info("Registered Go runtime Leaderboard Reset function invocation")
	case luaLeaderboardResetFunction != nil:
		allLeaderboardResetFunction = luaLeaderboardResetFunction
		startupLogger.Info("Registered Lua runtime Leaderboard Reset function invocation")
	case jsLeaderboardResetFunction != nil:
		allLeaderboardResetFunction = jsLeaderboardResetFunction
		startupLogger.Info("Registered JavaScript runtime Leaderboard Reset function invocation")
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
		matchCreateFunction:       matchProvider.CreateMatch,
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
	}, rInfo, nil
}

func runtimeInfo(paths []string, jsRpcIDs, luaRpcIDs, goRpcIDs map[string]bool, jsModules, luaModules, goModules []string) (*RuntimeInfo, error) {
	jsRpcs := make([]string, 0, len(jsRpcIDs))
	for id, _ := range jsRpcIDs {
		jsRpcs = append(jsRpcs, id)
	}
	luaRpcs := make([]string, 0, len(luaRpcIDs))
	for id, _ := range luaRpcIDs {
		luaRpcs = append(luaRpcs, id)
	}
	goRpcs := make([]string, 0, len(goRpcIDs))
	for id, _ := range goRpcIDs {
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

func (r *Runtime) BeforeUpdateAccount() RuntimeBeforeUpdateAccountFunction {
	return r.beforeReqFunctions.beforeUpdateAccountFunction
}

func (r *Runtime) AfterUpdateAccount() RuntimeAfterUpdateAccountFunction {
	return r.afterReqFunctions.afterUpdateAccountFunction
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

func (r *Runtime) BeforeValidatePurchaseGoogle() RuntimeBeforeValidatePurchaseGoogleFunction {
	return r.beforeReqFunctions.beforeValidatePurchaseGoogleFunction
}

func (r *Runtime) AfterValidatePurchaseGoogle() RuntimeAfterValidatePurchaseGoogleFunction {
	return r.afterReqFunctions.afterValidatePurchaseGoogleFunction
}

func (r *Runtime) BeforeValidatePurchaseHuawei() RuntimeBeforeValidatePurchaseHuaweiFunction {
	return r.beforeReqFunctions.beforeValidatePurchaseHuaweiFunction
}

func (r *Runtime) AfterValidatePurchaseHuawei() RuntimeAfterValidatePurchaseHuaweiFunction {
	return r.afterReqFunctions.afterValidatePurchaseHuaweiFunction
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
