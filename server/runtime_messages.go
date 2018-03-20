// Copyright 2017 The Nakama Authors
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

var RUNTIME_MESSAGES = map[string]string{
	"*server.AuthenticateRequest_Device":       "authenticaterequest_device",
	"*server.AuthenticateRequest_Custom":       "authenticaterequest_custom",
	"*server.AuthenticateRequest_Email_":       "authenticaterequest_email",
	"*server.AuthenticateRequest_Facebook":     "authenticaterequest_facebook",
	"*server.AuthenticateRequest_Google":       "authenticaterequest_google",
	"*server.AuthenticateRequest_Steam":        "authenticaterequest_steam",
	"*server.AuthenticateRequest_GameCenter_":  "authenticaterequest_gamecenter",
	"*server.Envelope_Logout":                  "logout",
	"*server.Envelope_Link":                    "tlink",
	"*server.Envelope_Unlink":                  "tunlink",
	"*server.Envelope_SelfFetch":               "tselffetch",
	"*server.Envelope_SelfUpdate":              "tselfupdate",
	"*server.Envelope_UsersFetch":              "tusersfetch",
	"*server.Envelope_FriendsAdd":              "tfriendsadd",
	"*server.Envelope_FriendsRemove":           "tfriendsremove",
	"*server.Envelope_FriendsBlock":            "tfriendsblock",
	"*server.Envelope_FriendsList":             "tfriendslist",
	"*server.Envelope_GroupsCreate":            "tgroupscreate",
	"*server.Envelope_GroupsUpdate":            "tgroupsupdate",
	"*server.Envelope_GroupsRemove":            "tgroupsremove",
	"*server.Envelope_GroupsSelfList":          "tgroupsselflist",
	"*server.Envelope_GroupsFetch":             "tgroupsfetch",
	"*server.Envelope_GroupsList":              "tgroupslist",
	"*server.Envelope_GroupUsersList":          "tgroupuserslist",
	"*server.Envelope_GroupsJoin":              "tgroupsjoin",
	"*server.Envelope_GroupsLeave":             "tgroupsleave",
	"*server.Envelope_GroupUsersAdd":           "tgroupusersadd",
	"*server.Envelope_GroupUsersKick":          "tgroupuserskick",
	"*server.Envelope_GroupUsersPromote":       "tgroupuserspromote",
	"*server.Envelope_TopicsJoin":              "ttopicsjoin",
	"*server.Envelope_TopicsLeave":             "ttopicsleave",
	"*server.Envelope_TopicMessageSend":        "ttopicmessagesend",
	"*server.Envelope_TopicMessageAck":         "ttopicmessageack",
	"*server.Envelope_TopicMessagesList":       "ttopicmessageslist",
	"*server.Envelope_MatchmakeAdd":            "tmatchmakeadd",
	"*server.Envelope_MatchmakeTicket":         "tmatchmaketicket",
	"*server.Envelope_MatchmakeRemove":         "tmatchmakeremove",
	"*server.Envelope_MatchCreate":             "tmatchcreate",
	"*server.Envelope_MatchesJoin":             "tmatchesjoin",
	"*server.Envelope_MatchDataSend":           "matchdatasend",
	"*server.Envelope_MatchesLeave":            "tmatchesleave",
	"*server.Envelope_StorageList":             "tstoragelist",
	"*server.Envelope_StorageFetch":            "tstoragefetch",
	"*server.Envelope_StorageWrite":            "tstoragewrite",
	"*server.Envelope_StorageRemove":           "tstorageremove",
	"*server.Envelope_LeaderboardsList":        "tleaderboardslist",
	"*server.Envelope_LeaderboardRecordsWrite": "tleaderboardrecordswrite",
	"*server.Envelope_LeaderboardRecordsFetch": "tleaderboardrecordsfetch",
	"*server.Envelope_LeaderboardRecordsList":  "tleaderboardrecordslist",
	"*server.Envelope_Rpc":                     "trpc",
	"*server.Envelope_NotificationsList":       "tnotificationslist",
	"*server.Envelope_NotificationsRemove":     "tnotificationsremove",
	"*server.Envelope_Purchase":     						"tpurchase",
}
