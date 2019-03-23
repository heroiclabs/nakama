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

/*
Package runtime is an API to interact with the embedded Runtime environment in Nakama.

The game server includes support to develop native code in Go with the plugin package from the Go stdlib.
It's used to enable compiled shared objects to be loaded by the game server at startup.

The Go runtime support can be used to develop authoritative multiplayer match handlers,
RPC functions, hook into messages processed by the server, and extend the server withany other custom logic.
It offers the same capabilities as the Lua runtime support but has the advantage that any package from the Go ecosystem can be used.

Here's the smallest example of a Go module written with the server runtime.

	package main

	import (
		"context"
		"database/sql"
		"log"

		"github.com/heroiclabs/nakama/runtime"
	)

	func InitModule(ctx context.Context, logger Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
		if err := initializer.RegisterRpc("get_time", getServerTime); err != nil {
			return err
		}
		logger.Println("module loaded")
		return nil
	}

	func getServerTime(ctx context.Context, logger Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		serverTime := map[string]int64 {
			"time": time.Now().UTC().Unix(),
		}

		response, err := json.Marshal(serverTime)
		if err != nil {
			logger.Printf("failed to marshal response: %v", response)
			return "", errors.New("internal error; see logs")
		}
		return string(response), nil
	}

On server start, Nakama scans the module directory folder (https://heroiclabs.com/docs/runtime-code-basics/#load-modules).
If it finds a shared object file (*.so), it attempts to open the file as a plugin and initialize it by running the InitModule function.
This function is guaranteed to ever be invoked once during the uptime of the server.

To setup your own project to build modules for the game server you can follow these steps.

1. Build Nakama from source:
	go get -d github.com/heroiclabs/nakama
	cd $GOPATH/src/github.com/heroiclabs/nakama
	env CGO_ENABLED=1 go build

2. Setup a folder for your own server code:
	mkdir -p $GOPATH/src/some_project
	cd $GOPATH/src/some_project

3. Build your plugin as a shared object:
	go build --buildmode=plugin -o ./modules/some_project.so

NOTE: It is not possible to build plugins on Windows with the native compiler toolchain but they can be cross-compiled and run with Docker.

4. Start Nakama with your module:
	$GOPATH/src/github.com/heroiclabs/nakama/nakama --runtime.path $GOPATH/src/plugin_project/modules

TIP: You don't have to install Nakama from source but you still need to have the `api`, `rtapi` and `runtime` packages from Nakama on your `GOPATH`. Heroic Labs also offers a docker plugin-builder image that streamlines the plugin workflow.

For more information about the Go runtime have a look at the docs:
https://heroiclabs.com/docs/runtime-code-basics
*/
package runtime

import (
	"context"
	"database/sql"

	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
)

const (
	// All available environmental variables made available to the runtime environment.
	// This is useful to store API keys and other secrets which may be different between servers run in production and in development.
	//   envs := ctx.Value(runtime.RUNTIME_CTX_ENV).(map[string]string)
	// This can always be safely cast into a `map[string]string`.
	RUNTIME_CTX_ENV = "env"

	// The mode associated with the execution context. It's one of these values:
	//  "event", "run_once", "rpc", "before", "after", "match", "matchmaker", "leaderboard_reset", "tournament_reset", "tournament_end".
	RUNTIME_CTX_MODE = "execution_mode"

	// Query params that was passed through from HTTP request.
	RUNTIME_CTX_QUERY_PARAMS = "query_params"

	// The user ID associated with the execution context.
	RUNTIME_CTX_USER_ID = "user_id"

	// The username associated with the execution context.
	RUNTIME_CTX_USERNAME = "username"

	// The user session expiry in seconds associated with the execution context.
	RUNTIME_CTX_USER_SESSION_EXP = "user_session_exp"

	// The user session associated with the execution context.
	RUNTIME_CTX_SESSION_ID = "session_id"

	// The IP address of the client making the request.
	RUNTIME_CTX_CLIENT_IP = "client_ip"

	// The port number of the client making the request.
	RUNTIME_CTX_CLIENT_PORT = "client_port"

	// The match ID that is currently being executed. Only applicable to server authoritative multiplayer.
	RUNTIME_CTX_MATCH_ID = "match_id"

	// The node ID that the match is being executed on. Only applicable to server authoritative multiplayer.
	RUNTIME_CTX_MATCH_NODE = "match_node"

	// Labels associated with the match. Only applicable to server authoritative multiplayer.
	RUNTIME_CTX_MATCH_LABEL = "match_label"

	// Tick rate defined for this match. Only applicable to server authoritative multiplayer.
	RUNTIME_CTX_MATCH_TICK_RATE = "match_tick_rate"
)

const (
	// Storage permission for public read, any user can read the object.
	STORAGE_PERMISSION_PUBLIC_READ = 2

	// Storage permission for owner read, only the user who owns it may access.
	STORAGE_PERMISSION_OWNER_READ = 1

	// Storage permission for no read. The object is only readable by server runtime.
	STORAGE_PERMISSION_NO_READ = 0

	// Storage permission for owner write, only the user who owns it may write.
	STORAGE_PERMISSION_OWNER_WRITE = 1

	// Storage permission for no write. The object is only writable by server runtime.
	STORAGE_PERMISSION_NO_WRITE = 0
)

/*
Error is used to indicate a failure in code. The message and code are returned to the client.
If an Error is used as response for a HTTP/gRPC request, then the server tries to use the error value as the gRPC error code. This will in turn translate to HTTP status codes.

For more information, please have a look at the following:
	https://github.com/grpc/grpc-go/blob/master/codes/codes.go
	https://github.com/grpc-ecosystem/grpc-gateway/blob/master/runtime/errors.go
	https://golang.org/pkg/net/http/
*/
type Error struct {
	Message string
	Code    int
}

// Error returns the encapsulated error message.
func (e *Error) Error() string {
	return e.Message
}

/*
NewError returns a new error. The message and code are sent directly to the client. The code field is also optionally translated to gRPC/HTTP code.
	runtime.NewError("Server unavailable", 14) // 14 = Unavailable = 503 HTTP status code
*/
func NewError(message string, code int) *Error {
	return &Error{Message: message, Code: code}
}

/*
Logger exposes a logging framework to use in modules. It exposes level-specific logging functions and a set of common functions for compatibility.
*/
type Logger interface {
	/*
		Log a message with optional arguments at DEBUG level. Arguments are handled in the manner of fmt.Printf.
	*/
	Debug(format string, v ...interface{})
	/*
		Log a message with optional arguments at INFO level. Arguments are handled in the manner of fmt.Printf.
	*/
	Info(format string, v ...interface{})
	/*
		Log a message with optional arguments at WARN level. Arguments are handled in the manner of fmt.Printf.
	*/
	Warn(format string, v ...interface{})
	/*
		Log a message with optional arguments at ERROR level. Arguments are handled in the manner of fmt.Printf.
	*/
	Error(format string, v ...interface{})

	// *log.Logger compatibility functions below here.

	/*
	  Log a message at info level. Arguments are handled in the manner of fmt.Print. Provided for compatibility with log.Logger.
	*/
	Print(v ...interface{})
	/*
	  Log a message at info level. Arguments are handled in the manner of fmt.Println. Provided for compatibility with log.Logger.
	*/
	Println(v ...interface{})
	/*
	  Log a message at info level. Arguments are handled in the manner of fmt.Printf. Provided for compatibility with log.Logger.
	*/
	Printf(format string, v ...interface{})
	/*
		  Log a message at fatal level and stop the server with a non-0 exit code. Arguments are handled in the manner of fmt.Print.

			Provided for compatibility with log.Logger.
	*/
	Fatal(v ...interface{})
	/*
	  Log a message at fatal level and stop the server with a non-0 exit code. Arguments are handled in the manner of fmt.Println.

	  Provided for compatibility with log.Logger.
	*/
	Fatalln(v ...interface{})
	/*
	  Log a message at fatal level and stop the server with a non-0 exit code. Arguments are handled in the manner of fmt.Printf.

	  Provided for compatibility with log.Logger.
	*/
	Fatalf(format string, v ...interface{})
	/*
	  Log a message at fatal level and panic the server. Arguments are handled in the manner of fmt.Print.

	  Provided for compatibility with log.Logger.
	*/
	Panic(v ...interface{})
	/*
	  Log a message at fatal level and panic the server. Arguments are handled in the manner of fmt.Println.

	  Provided for compatibility with log.Logger.
	*/
	Panicln(v ...interface{})
	/*
	  Log a message at fatal level and panic the server. Arguments are handled in the manner of fmt.Printf.

	  Provided for compatibility with log.Logger.
	*/
	Panicf(format string, v ...interface{})
}

/*
Initializer is used to register various callback functions with the server.
It is made available to the InitModule function as an input parameter when the function is invoked by the server when loading the module on server start.

NOTE: You must not cache the reference to this and reuse it as a later point as this could have unintended side effects.
*/
type Initializer interface {

	/*
		RegisterRpc registers a function with the given ID. This ID can be used within client code to send an RPC message to
		execute the function and return the result. Results are always returned as a JSON string (or optionally empty string).

		If there is an issue with the RPC call, return an empty string and the associated error which will be returned to the client.
	*/
	RegisterRpc(id string, fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, payload string) (string, error)) error

	/*
		RegisterBeforeRt registers a function for a message. The registered function will be called after the message has been processed in the pipeline.
		The custom code will be executed asynchronously after the response message has been sent to a client

		Message names can be found here: https://heroiclabs.com/docs/runtime-code-basics/#message-names
	*/
	RegisterBeforeRt(id string, fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, envelope *rtapi.Envelope) (*rtapi.Envelope, error)) error

	/*
		RegisterAfterRt registers a function with for a message. Any function may be registered to intercept a message received from a client and operate on it (or reject it) based on custom logic.
		This is useful to enforce specific rules on top of the standard features in the server.

		You can return `nil` instead of the `rtapi.Envelope` and this will disable disable that particular server functionality.

		Message names can be found here: https://heroiclabs.com/docs/runtime-code-basics/#message-names
	*/
	RegisterAfterRt(id string, fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, envelope *rtapi.Envelope) error) error

	// RegisterMatchmakerMatched
	RegisterMatchmakerMatched(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, entries []MatchmakerEntry) (string, error)) error

	// RegisterMatch
	RegisterMatch(name string, fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule) (Match, error)) error

	// RegisterTournamentEnd
	RegisterTournamentEnd(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, tournament *api.Tournament, end, reset int64) error) error

	// RegisterTournamentReset
	RegisterTournamentReset(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, tournament *api.Tournament, end, reset int64) error) error

	// RegisterLeaderboardReset
	RegisterLeaderboardReset(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, leaderboard Leaderboard, reset int64) error) error

	// RegisterBeforeGetAccount is used to register a function invoked when the server receives the relevant request.
	RegisterBeforeGetAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule) error) error

	// RegisterAfterGetAccount is used to register a function invoked after the server processes the relevant request.
	RegisterAfterGetAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Account) error) error

	// RegisterBeforeUpdateAccount is used to register a function invoked when the server receives the relevant request.
	RegisterBeforeUpdateAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error)) error

	// RegisterAfterUpdateAccount is used to register a function invoked after the server processes the relevant request.
	RegisterAfterUpdateAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.UpdateAccountRequest) error) error

	// RegisterBeforeAuthenticateCustom can be used to perform pre-authentication checks.
	// You can use this to process the input (such as decoding custom tokens) and ensure inter-compatibility between Nakama and your own custom system.
	RegisterBeforeAuthenticateCustom(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error)) error

	// RegisterAfterAuthenticateCustom can be used to perform after successful authentication checks.
	// For instance, you can run special logic if the account was just created like adding them to newcomers leaderboard.
	RegisterAfterAuthenticateCustom(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateCustomRequest) error) error

	// RegisterBeforeAuthenticateDevice can be used to perform pre-authentication checks.
	RegisterBeforeAuthenticateDevice(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error)) error

	// RegisterAfterAuthenticateDevice can be used to perform after successful authentication checks.
	RegisterAfterAuthenticateDevice(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateDeviceRequest) error) error

	// RegisterBeforeAuthenticateEmail can be used to perform pre-authentication checks.
	RegisterBeforeAuthenticateEmail(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error)) error

	// RegisterAfterAuthenticateEmail can be used to perform after successful authentication checks.
	RegisterAfterAuthenticateEmail(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateEmailRequest) error) error

	// RegisterBeforeAuthenticateFacebook can be used to perform pre-authentication checks.
	RegisterBeforeAuthenticateFacebook(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error)) error

	// RegisterAfterAuthenticateFacebook can be used to perform after successful authentication checks.
	RegisterAfterAuthenticateFacebook(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateFacebookRequest) error) error

	// RegisterBeforeAuthenticateGameCenter can be used to perform pre-authentication checks.
	RegisterBeforeAuthenticateGameCenter(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error)) error

	// RegisterAfterAuthenticateGameCenter can be used to perform after successful authentication checks.
	RegisterAfterAuthenticateGameCenter(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateGameCenterRequest) error) error

	// RegisterBeforeAuthenticateGoogle can be used to perform pre-authentication checks.
	RegisterBeforeAuthenticateGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error)) error

	// RegisterAfterAuthenticateGoogle can be used to perform after successful authentication checks.
	RegisterAfterAuthenticateGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateGoogleRequest) error) error

	// RegisterBeforeAuthenticateSteam can be used to perform pre-authentication checks.
	RegisterBeforeAuthenticateSteam(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error)) error

	// RegisterAfterAuthenticateSteam can be used to perform after successful authentication checks.
	RegisterAfterAuthenticateSteam(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateSteamRequest) error) error

	// RegisterBeforeListChannelMessages can be used to perform additional logic before listing messages on a channel.
	RegisterBeforeListChannelMessages(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error)) error

	// RegisterAfterListChannelMessages can be used to perform additional logic after messages for a channel is listed.
	RegisterAfterListChannelMessages(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.ChannelMessageList, in *api.ListChannelMessagesRequest) error) error

	// RegisterBeforeListChannelMessages can be used to perform additional logic before listing friends.
	RegisterBeforeListFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule) error) error

	// RegisterAfterListFriends can be used to perform additional logic after friends are listed.
	RegisterAfterListFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Friends) error) error

	// RegisterBeforeAddFriends can be used to perform additional logic before friends are added.
	RegisterBeforeAddFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error)) error

	// RegisterAfterAddFriends can be used to perform additional logic after friends are added.
	RegisterAfterAddFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AddFriendsRequest) error) error

	// RegisterBeforeDeleteFriends can be used to perform additional logic before friends are deleted.
	RegisterBeforeDeleteFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error)) error

	// RegisterAfterDeleteFriends can be used to perform additional logic after friends are deleted.
	RegisterAfterDeleteFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteFriendsRequest) error) error

	// RegisterBeforeBlockFriends can be used to perform additional logic before friends are blocked.
	RegisterBeforeBlockFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error)) error

	// RegisterAfterBlockFriends can be used to perform additional logic after friends are blocked.
	RegisterAfterBlockFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.BlockFriendsRequest) error) error

	// RegisterBeforeImportFacebookFriends can be used to perform additional logic before Facebook friends are imported.
	RegisterBeforeImportFacebookFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error)) error

	// RegisterAfterImportFacebookFriends can be used to perform additional logic after Facebook friends are imported.
	RegisterAfterImportFacebookFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ImportFacebookFriendsRequest) error) error

	// RegisterBeforeCreateGroup can be used to perform additional logic before a group is created.
	RegisterBeforeCreateGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error)) error

	// RegisterAfterCreateGroup can be used to perform additional logic after a group is created.
	RegisterAfterCreateGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Group, in *api.CreateGroupRequest) error) error

	// RegisterBeforeUpdateGroup can be used to perform additional logic before a group is updated.
	RegisterBeforeUpdateGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error)) error

	// RegisterAfterUpdateGroup can be used to perform additional logic after a group is updated.
	RegisterAfterUpdateGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.UpdateGroupRequest) error) error

	// RegisterBeforeDeleteGroup can be used to perform additional logic before a group is deleted.
	RegisterBeforeDeleteGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error)) error

	// RegisterAfterDeleteGroup can be used to perform additional logic after a group is deleted.
	RegisterAfterDeleteGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteGroupRequest) error) error

	// RegisterBeforeJoinGroup can be used to perform additional logic before user joins a group.
	RegisterBeforeJoinGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error)) error

	// RegisterAfterJoinGroup can be used to perform additional logic after user joins a group.
	RegisterAfterJoinGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.JoinGroupRequest) error) error

	// RegisterBeforeLeaveGroup can be used to perform additional logic before user leaves a group.
	RegisterBeforeLeaveGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error)) error

	// RegisterAfterLeaveGroup can be used to perform additional logic after user leaves a group.
	RegisterAfterLeaveGroup(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.LeaveGroupRequest) error) error

	// RegisterBeforeAddGroupUsers can be used to perform additional logic before user is added to a group.
	RegisterBeforeAddGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error)) error

	// RegisterAfterAddGroupUsers can be used to perform additional logic after user is added to a group.
	RegisterAfterAddGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AddGroupUsersRequest) error) error

	// RegisterBeforeKickGroupUsers can be used to perform additional logic before user is kicked to a group.
	RegisterBeforeKickGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error)) error

	// RegisterAfterKickGroupUsers can be used to perform additional logic after user is kicked from a group.
	RegisterAfterKickGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.KickGroupUsersRequest) error) error

	// RegisterBeforePromoteGroupUsers can be used to perform additional logic before user is promoted.
	RegisterBeforePromoteGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error)) error

	// RegisterAfterPromoteGroupUsers can be used to perform additional logic after user is promoted.
	RegisterAfterPromoteGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.PromoteGroupUsersRequest) error) error

	// RegisterBeforeListGroupUsers can be used to perform additional logic before users in a group is listed.
	RegisterBeforeListGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error)) error

	// RegisterAfterListGroupUsers can be used to perform additional logic after users in a group is listed.
	RegisterAfterListGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.GroupUserList, in *api.ListGroupUsersRequest) error) error

	// RegisterBeforeListUserGroups can be used to perform additional logic before groups for a user is listed.
	RegisterBeforeListUserGroups(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error)) error

	// RegisterAfterListUserGroups can be used to perform additional logic after groups for a user is listed.
	RegisterAfterListUserGroups(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.UserGroupList, in *api.ListUserGroupsRequest) error) error

	// RegisterBeforeListGroups can be used to perform additional logic before groups are listed.
	RegisterBeforeListGroups(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error)) error

	// RegisterAfterListGroups can be used to perform additional logic after groups are listed.
	RegisterAfterListGroups(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.GroupList, in *api.ListGroupsRequest) error) error

	// RegisterBeforeDeleteLeaderboardRecord can be used to perform additional logic before deleting record from a leaderboard.
	RegisterBeforeDeleteLeaderboardRecord(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error)) error

	// RegisterAfterDeleteLeaderboardRecord can be used to perform additional logic after deleting record from a leaderboard.
	RegisterAfterDeleteLeaderboardRecord(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteLeaderboardRecordRequest) error) error

	// RegisterBeforeListLeaderboardRecords can be used to perform additional logic before listing records from a leaderboard.
	RegisterBeforeListLeaderboardRecords(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error)) error

	// RegisterAfterListLeaderboardRecords  can be used to perform additional logic after listing records from a leaderboard.
	RegisterAfterListLeaderboardRecords(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsRequest) error) error

	// RegisterBeforeWriteLeaderboardRecord can be used to perform additional logic before submitting new record to a leaderboard.
	RegisterBeforeWriteLeaderboardRecord(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error)) error

	// RegisterAfterWriteLeaderboardRecord can be used to perform additional logic after submitting new record to a leaderboard.
	RegisterAfterWriteLeaderboardRecord(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.LeaderboardRecord, in *api.WriteLeaderboardRecordRequest) error) error

	// RegisterBeforeListLeaderboardRecordsAroundOwner can be used to perform additional logic before listing records from a leaderboard.
	RegisterBeforeListLeaderboardRecordsAroundOwner(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error)) error

	// RegisterAfterListLeaderboardRecordsAroundOwner can be used to perform additional logic after listing records from a leaderboard.
	RegisterAfterListLeaderboardRecordsAroundOwner(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsAroundOwnerRequest) error) error

	// RegisterBeforeLinkCustom can be used to perform additional logic before linking custom ID to an account.
	RegisterBeforeLinkCustom(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountCustom) (*api.AccountCustom, error)) error

	// RegisterAfterLinkCustom can be used to perform additional logic after linking custom ID to an account.
	RegisterAfterLinkCustom(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountCustom) error) error

	// RegisterBeforeLinkDevice can be used to perform additional logic before linking device ID to an account.
	RegisterBeforeLinkDevice(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountDevice) (*api.AccountDevice, error)) error

	// RegisterAfterLinkDevice can be used to perform additional logic after linking device ID to an account.
	RegisterAfterLinkDevice(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountDevice) error) error

	// RegisterBeforeLinkEmail can be used to perform additional logic before linking email to an account.
	RegisterBeforeLinkEmail(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountEmail) (*api.AccountEmail, error)) error

	// RegisterAfterLinkEmail can be used to perform additional logic after linking email to an account.
	RegisterAfterLinkEmail(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountEmail) error) error

	// RegisterBeforeLinkFacebook can be used to perform additional logic before linking Facebook to an account.
	RegisterBeforeLinkFacebook(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error)) error

	// RegisterAfterLinkFacebook can be used to perform additional logic after linking Facebook to an account.
	RegisterAfterLinkFacebook(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.LinkFacebookRequest) error) error

	// RegisterBeforeLinkGameCenter can be used to perform additional logic before linking GameCenter to an account.
	RegisterBeforeLinkGameCenter(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error)) error

	// RegisterAfterLinkGameCenter can be used to perform additional logic after linking GameCenter to an account.
	RegisterAfterLinkGameCenter(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGameCenter) error) error

	// RegisterBeforeLinkGoogle can be used to perform additional logic before linking Google to an account.
	RegisterBeforeLinkGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error)) error

	// RegisterAfterLinkGoogle can be used to perform additional logic after linking Google to an account.
	RegisterAfterLinkGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGoogle) error) error

	// RegisterBeforeLinkSteam can be used to perform additional logic before linking Steam to an account.
	RegisterBeforeLinkSteam(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountSteam) (*api.AccountSteam, error)) error

	// RegisterAfterLinkSteam can be used to perform additional logic after linking Steam to an account.
	RegisterAfterLinkSteam(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountSteam) error) error

	// RegisterBeforeListMatches can be used to perform additional logic before listing matches.
	RegisterBeforeListMatches(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error)) error

	// RegisterAfterListMatches can be used to perform additional logic after listing matches.
	RegisterAfterListMatches(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.MatchList, in *api.ListMatchesRequest) error) error

	// RegisterBeforeListNotifications can be used to perform additional logic before listing notifications for a user.
	RegisterBeforeListNotifications(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error)) error

	// RegisterAfterListNotifications can be used to perform additional logic after listing notifications for a user.
	RegisterAfterListNotifications(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.NotificationList, in *api.ListNotificationsRequest) error) error

	// RegisterBeforeDeleteNotification can be used to perform additional logic before deleting notifications.
	RegisterBeforeDeleteNotification(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error)) error

	// RegisterAfterDeleteNotification can be used to perform additional logic after deleting notifications.
	RegisterAfterDeleteNotification(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteNotificationsRequest) error) error

	// RegisterBeforeListStorageObjects can be used to perform additional logic before listing storage objects.
	RegisterBeforeListStorageObjects(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error)) error

	// RegisterAfterListStorageObjects can be used to perform additional logic after listing storage objects.
	RegisterAfterListStorageObjects(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.StorageObjectList, in *api.ListStorageObjectsRequest) error) error

	// RegisterBeforeReadStorageObjects can be used to perform additional logic before reading storage objects.
	RegisterBeforeReadStorageObjects(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error)) error

	// RegisterAfterReadStorageObjects can be used to perform additional logic after reading storage objects.
	RegisterAfterReadStorageObjects(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.StorageObjects, in *api.ReadStorageObjectsRequest) error) error

	// RegisterBeforeWriteStorageObjects can be used to perform additional logic before writing storage objects.
	RegisterBeforeWriteStorageObjects(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error)) error

	// RegisterAfterWriteStorageObjects can be used to perform additional logic after writing storage objects.
	RegisterAfterWriteStorageObjects(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.StorageObjectAcks, in *api.WriteStorageObjectsRequest) error) error

	// RegisterBeforeDeleteStorageObjects can be used to perform additional logic before deleting storage objects.
	RegisterBeforeDeleteStorageObjects(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error)) error

	// RegisterAfterDeleteStorageObjects can be used to perform additional logic after deleting storage objects.
	RegisterAfterDeleteStorageObjects(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteStorageObjectsRequest) error) error

	// RegisterBeforeJoinTournament can be used to perform additional logic before user joins a tournament.
	RegisterBeforeJoinTournament(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error)) error

	// RegisterAfterJoinTournament can be used to perform additional logic after user joins a tournament.
	RegisterAfterJoinTournament(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.JoinTournamentRequest) error) error

	// RegisterBeforeListTournamentRecords can be used to perform additional logic before listing tournament records.
	RegisterBeforeListTournamentRecords(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error)) error

	// RegisterAfterListTournamentRecords can be used to perform additional logic after listing tournament records.
	RegisterAfterListTournamentRecords(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.TournamentRecordList, in *api.ListTournamentRecordsRequest) error) error

	// RegisterBeforeListTournaments can be used to perform additional logic before listing tournaments.
	RegisterBeforeListTournaments(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error)) error

	// RegisterAfterListTournaments can be used to perform additional logic after listing tournaments.
	RegisterAfterListTournaments(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.TournamentList, in *api.ListTournamentsRequest) error) error

	// RegisterBeforeWriteTournamentRecord can be used to perform additional logic before writing tournament records.
	RegisterBeforeWriteTournamentRecord(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error)) error

	// RegisterAfterWriteTournamentRecord can be used to perform additional logic after writing tournament records.
	RegisterAfterWriteTournamentRecord(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.LeaderboardRecord, in *api.WriteTournamentRecordRequest) error) error

	// RegisterBeforeListTournamentRecordsAroundOwner can be used to perform additional logic before listing tournament records.
	RegisterBeforeListTournamentRecordsAroundOwner(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error)) error

	// RegisterAfterListTournamentRecordsAroundOwner can be used to perform additional logic after listing tournament records.
	RegisterAfterListTournamentRecordsAroundOwner(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.TournamentRecordList, in *api.ListTournamentRecordsAroundOwnerRequest) error) error

	// RegisterBeforeUnlinkCustom can be used to perform additional logic before custom ID is unlinked from an account.
	RegisterBeforeUnlinkCustom(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountCustom) (*api.AccountCustom, error)) error

	// RegisterAfterUnlinkCustom can be used to perform additional logic after custom ID is unlinked from an account.
	RegisterAfterUnlinkCustom(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountCustom) error) error

	// RegisterBeforeUnlinkDevice can be used to perform additional logic before device ID is unlinked from an account.
	RegisterBeforeUnlinkDevice(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountDevice) (*api.AccountDevice, error)) error

	// RegisterAfterUnlinkDevice can be used to perform additional logic after device ID is unlinked from an account.
	RegisterAfterUnlinkDevice(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountDevice) error) error

	// RegisterBeforeUnlinkEmail can be used to perform additional logic before email is unlinked from an account.
	RegisterBeforeUnlinkEmail(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountEmail) (*api.AccountEmail, error)) error

	// RegisterAfterUnlinkEmail can be used to perform additional logic after email is unlinked from an account.
	RegisterAfterUnlinkEmail(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountEmail) error) error

	// RegisterBeforeUnlinkFacebook can be used to perform additional logic before Facebook is unlinked from an account.
	RegisterBeforeUnlinkFacebook(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountFacebook) (*api.AccountFacebook, error)) error

	// RegisterAfterUnlinkFacebook can be used to perform additional logic after Facebook is unlinked from an account.
	RegisterAfterUnlinkFacebook(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountFacebook) error) error

	// RegisterBeforeUnlinkGameCenter can be used to perform additional logic before GameCenter is unlinked from an account.
	RegisterBeforeUnlinkGameCenter(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error)) error

	// RegisterAfterUnlinkGameCenter can be used to perform additional logic after GameCenter is unlinked from an account.
	RegisterAfterUnlinkGameCenter(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGameCenter) error) error

	// RegisterBeforeUnlinkGoogle can be used to perform additional logic before Google is unlinked from an account.
	RegisterBeforeUnlinkGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error)) error

	// RegisterAfterUnlinkGoogle can be used to perform additional logic after Google is unlinked from an account.
	RegisterAfterUnlinkGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGoogle) error) error

	// RegisterBeforeUnlinkSteam can be used to perform additional logic before Steam is unlinked from an account.
	RegisterBeforeUnlinkSteam(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountSteam) (*api.AccountSteam, error)) error

	// RegisterAfterUnlinkSteam can be used to perform additional logic after Steam is unlinked from an account.
	RegisterAfterUnlinkSteam(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountSteam) error) error

	// RegisterBeforeGetUsers can be used to perform additional logic before retrieving users.
	RegisterBeforeGetUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.GetUsersRequest) (*api.GetUsersRequest, error)) error

	// RegisterAfterGetUsers can be used to perform additional logic after retrieving users.
	RegisterAfterGetUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Users, in *api.GetUsersRequest) error) error

	// RegisterEventSessionStart can be used to define functions triggered when client sessions start.
	RegisterEventSessionStart(fn func(ctx context.Context, logger Logger, evt *api.Event)) error

	// RegisterEventSessionStart can be used to define functions triggered when client sessions end.
	RegisterEventSessionEnd(fn func(ctx context.Context, logger Logger, evt *api.Event)) error
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
	BroadcastMessageDeferred(opCode int64, data []byte, presences []Presence, sender Presence) error
	MatchKick(presences []Presence) error
	MatchLabelUpdate(label string) error
}

type Match interface {
	MatchInit(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, params map[string]interface{}) (interface{}, int, string)
	MatchJoinAttempt(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, presence Presence, metadata map[string]string) (interface{}, bool, string)
	MatchJoin(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, presences []Presence) interface{}
	MatchLeave(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, presences []Presence) interface{}
	MatchLoop(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, messages []MatchData) interface{}
	MatchTerminate(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, graceSeconds int) interface{}
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
	AuthenticateCustom(ctx context.Context, id, username string, create bool) (string, string, bool, error)
	AuthenticateDevice(ctx context.Context, id, username string, create bool) (string, string, bool, error)
	AuthenticateEmail(ctx context.Context, email, password, username string, create bool) (string, string, bool, error)
	AuthenticateFacebook(ctx context.Context, token string, importFriends bool, username string, create bool) (string, string, bool, error)
	AuthenticateGameCenter(ctx context.Context, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl, username string, create bool) (string, string, bool, error)
	AuthenticateGoogle(ctx context.Context, token, username string, create bool) (string, string, bool, error)
	AuthenticateSteam(ctx context.Context, token, username string, create bool) (string, string, bool, error)

	AuthenticateTokenGenerate(userID, username string, exp int64) (string, int64, error)

	AccountGetId(ctx context.Context, userID string) (*api.Account, error)
	AccountsGetId(ctx context.Context, userIDs []string) ([]*api.Account, error)
	AccountUpdateId(ctx context.Context, userID, username string, metadata map[string]interface{}, displayName, timezone, location, langTag, avatarUrl string) error

	AccountDeleteId(ctx context.Context, userID string, recorded bool) error

	UsersGetId(ctx context.Context, userIDs []string) ([]*api.User, error)
	UsersGetUsername(ctx context.Context, usernames []string) ([]*api.User, error)
	UsersBanId(ctx context.Context, userIDs []string) error
	UsersUnbanId(ctx context.Context, userIDs []string) error

	StreamUserList(mode uint8, subject, subcontext, label string, includeHidden, includeNotHidden bool) ([]Presence, error)
	StreamUserGet(mode uint8, subject, subcontext, label, userID, sessionID string) (PresenceMeta, error)
	StreamUserJoin(mode uint8, subject, subcontext, label, userID, sessionID string, hidden, persistence bool, status string) (bool, error)
	StreamUserUpdate(mode uint8, subject, subcontext, label, userID, sessionID string, hidden, persistence bool, status string) error
	StreamUserLeave(mode uint8, subject, subcontext, label, userID, sessionID string) error
	StreamUserKick(mode uint8, subject, subcontext, label string, presence Presence) error
	StreamCount(mode uint8, subject, subcontext, label string) (int, error)
	StreamClose(mode uint8, subject, subcontext, label string) error
	StreamSend(mode uint8, subject, subcontext, label, data string, presences []Presence) error
	StreamSendRaw(mode uint8, subject, subcontext, label string, msg *rtapi.Envelope, presences []Presence) error

	SessionDisconnect(ctx context.Context, sessionID, node string) error

	MatchCreate(ctx context.Context, module string, params map[string]interface{}) (string, error)
	MatchList(ctx context.Context, limit int, authoritative bool, label string, minSize, maxSize int, query string) ([]*api.Match, error)

	NotificationSend(ctx context.Context, userID, subject string, content map[string]interface{}, code int, sender string, persistent bool) error
	NotificationsSend(ctx context.Context, notifications []*NotificationSend) error

	WalletUpdate(ctx context.Context, userID string, changeset, metadata map[string]interface{}, updateLedger bool) error
	WalletsUpdate(ctx context.Context, updates []*WalletUpdate, updateLedger bool) error
	WalletLedgerUpdate(ctx context.Context, itemID string, metadata map[string]interface{}) (WalletLedgerItem, error)
	WalletLedgerList(ctx context.Context, userID string) ([]WalletLedgerItem, error)

	StorageList(ctx context.Context, userID, collection string, limit int, cursor string) ([]*api.StorageObject, string, error)
	StorageRead(ctx context.Context, reads []*StorageRead) ([]*api.StorageObject, error)
	StorageWrite(ctx context.Context, writes []*StorageWrite) ([]*api.StorageObjectAck, error)
	StorageDelete(ctx context.Context, deletes []*StorageDelete) error

	LeaderboardCreate(ctx context.Context, id string, authoritative bool, sortOrder, operator, resetSchedule string, metadata map[string]interface{}) error
	LeaderboardDelete(ctx context.Context, id string) error
	LeaderboardRecordsList(ctx context.Context, id string, ownerIDs []string, limit int, cursor string, expiry int64) ([]*api.LeaderboardRecord, []*api.LeaderboardRecord, string, string, error)
	LeaderboardRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}) (*api.LeaderboardRecord, error)
	LeaderboardRecordDelete(ctx context.Context, id, ownerID string) error

	TournamentCreate(ctx context.Context, id string, sortOrder, operator, resetSchedule string, metadata map[string]interface{}, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error
	TournamentDelete(ctx context.Context, id string) error
	TournamentAddAttempt(ctx context.Context, id, ownerID string, count int) error
	TournamentJoin(ctx context.Context, id, ownerID, username string) error
	TournamentList(ctx context.Context, categoryStart, categoryEnd, startTime, endTime, limit int, cursor string) (*api.TournamentList, error)
	TournamentRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}) (*api.LeaderboardRecord, error)
	TournamentRecordsHaystack(ctx context.Context, id, ownerID string, limit int) ([]*api.LeaderboardRecord, error)

	GroupsGetId(ctx context.Context, groupIDs []string) ([]*api.Group, error)
	GroupCreate(ctx context.Context, userID, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) (*api.Group, error)
	GroupUpdate(ctx context.Context, id, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) error
	GroupDelete(ctx context.Context, id string) error
	GroupUsersKick(ctx context.Context, groupID string, userIDs []string) error
	GroupUsersList(ctx context.Context, id string) ([]*api.GroupUserList_GroupUser, error)
	UserGroupsList(ctx context.Context, userID string) ([]*api.UserGroupList_UserGroup, error)
}
