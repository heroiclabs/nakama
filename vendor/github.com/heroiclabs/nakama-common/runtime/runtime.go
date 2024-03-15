// Copyright 2019 The Nakama Authors
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
RPC functions, hook into messages processed by the server, and extend the server with any other custom logic.
It offers the same capabilities as the Lua runtime support but has the advantage that any package from the Go ecosystem can be used.

Here's the smallest example of a Go module written with the server runtime.

	package main

	import (
		"context"
		"database/sql"
		"log"

		"github.com/heroiclabs/nakama-common/runtime"
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
    go get -d github.com/heroiclabs/nakama-common
    cd $GOPATH/src/github.com/heroiclabs/nakama-common
    env CGO_ENABLED=1 go build

 2. Setup a folder for your own server code:
    mkdir -p $GOPATH/src/some_project
    cd $GOPATH/src/some_project

 3. Build your plugin as a shared object:
    go build --buildmode=plugin -o ./modules/some_project.so

NOTE: It is not possible to build plugins on Windows with the native compiler toolchain but they can be cross-compiled and run with Docker.

 4. Start Nakama with your module:
    $GOPATH/src/github.com/heroiclabs/nakama-common/nakama --runtime.path $GOPATH/src/plugin_project/modules

TIP: You don't have to install Nakama from source but you still need to have the `api`, `rtapi` and `runtime` packages from Nakama on your `GOPATH`. Heroic Labs also offers a docker plugin-builder image that streamlines the plugin workflow.

For more information about the Go runtime have a look at the docs:
https://heroiclabs.com/docs/runtime-code-basics
*/
package runtime

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
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

	// The node ID where the current runtime context is executing.
	RUNTIME_CTX_NODE = "node"

	// Server version.
	RUNTIME_CTX_VERSION = "version"

	// Http headers. Only applicable to HTTP RPC requests.
	RUNTIME_CTX_HEADERS = "headers"

	// Query params that was passed through from HTTP request.
	RUNTIME_CTX_QUERY_PARAMS = "query_params"

	// The user ID associated with the execution context.
	RUNTIME_CTX_USER_ID = "user_id"

	// The username associated with the execution context.
	RUNTIME_CTX_USERNAME = "username"

	// Variables stored in the user's session token.
	RUNTIME_CTX_VARS = "vars"

	// The user session expiry in seconds associated with the execution context.
	RUNTIME_CTX_USER_SESSION_EXP = "user_session_exp"

	// The user session associated with the execution context.
	RUNTIME_CTX_SESSION_ID = "session_id"

	// The user session's lang value, if one is set.
	RUNTIME_CTX_LANG = "lang"

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

var (
	ErrStorageRejectedVersion    = errors.New("Storage write rejected - version check failed.")
	ErrStorageRejectedPermission = errors.New("Storage write rejected - permission denied.")

	ErrChannelIDInvalid     = errors.New("invalid channel id")
	ErrChannelCursorInvalid = errors.New("invalid channel cursor")
	ErrChannelGroupNotFound = errors.New("group not found")

	ErrInvalidChannelTarget = errors.New("Invalid channel target")
	ErrInvalidChannelType   = errors.New("Invalid channel type")

	ErrFriendInvalidCursor = errors.New("friend cursor invalid")

	ErrTournamentNotFound                = errors.New("tournament not found")
	ErrTournamentAuthoritative           = errors.New("tournament only allows authoritative submissions")
	ErrTournamentMaxSizeReached          = errors.New("tournament max size reached")
	ErrTournamentOutsideDuration         = errors.New("tournament outside of duration")
	ErrTournamentWriteMaxNumScoreReached = errors.New("max number score count reached")
	ErrTournamentWriteJoinRequired       = errors.New("required to join before writing tournament record")

	ErrMatchmakerQueryInvalid     = errors.New("matchmaker query invalid")
	ErrMatchmakerDuplicateSession = errors.New("matchmaker duplicate session")
	ErrMatchmakerIndex            = errors.New("matchmaker index error")
	ErrMatchmakerDelete           = errors.New("matchmaker delete error")
	ErrMatchmakerNotAvailable     = errors.New("matchmaker not available")
	ErrMatchmakerTooManyTickets   = errors.New("matchmaker too many tickets")
	ErrMatchmakerTicketNotFound   = errors.New("matchmaker ticket not found")

	ErrPartyClosed                   = errors.New("party closed")
	ErrPartyFull                     = errors.New("party full")
	ErrPartyJoinRequestDuplicate     = errors.New("party join request duplicate")
	ErrPartyJoinRequestAlreadyMember = errors.New("party join request already member")
	ErrPartyJoinRequestsFull         = errors.New("party join requests full")
	ErrPartyNotLeader                = errors.New("party leader only")
	ErrPartyNotMember                = errors.New("party member not found")
	ErrPartyNotRequest               = errors.New("party join request not found")
	ErrPartyAcceptRequest            = errors.New("party could not accept request")
	ErrPartyRemove                   = errors.New("party could not remove")
	ErrPartyRemoveSelf               = errors.New("party cannot remove self")

	ErrGroupNameInUse         = errors.New("group name in use")
	ErrGroupPermissionDenied  = errors.New("group permission denied")
	ErrGroupNoUpdateOps       = errors.New("no group updates")
	ErrGroupNotUpdated        = errors.New("group not updated")
	ErrGroupNotFound          = errors.New("group not found")
	ErrGroupFull              = errors.New("group is full")
	ErrGroupUserNotFound      = errors.New("user not found")
	ErrGroupLastSuperadmin    = errors.New("user is last group superadmin")
	ErrGroupUserInvalidCursor = errors.New("group user cursor invalid")
	ErrUserGroupInvalidCursor = errors.New("user group cursor invalid")
	ErrGroupCreatorInvalid    = errors.New("group creator user ID not valid")

	ErrWalletLedgerInvalidCursor = errors.New("wallet ledger cursor invalid")

	ErrCannotEncodeParams    = errors.New("error creating match: cannot encode params")
	ErrCannotDecodeParams    = errors.New("error creating match: cannot decode params")
	ErrMatchIdInvalid        = errors.New("match id invalid")
	ErrMatchNotFound         = errors.New("match not found")
	ErrMatchBusy             = errors.New("match busy")
	ErrMatchStateFailed      = errors.New("match did not return state")
	ErrMatchLabelTooLong     = errors.New("match label too long, must be 0-2048 bytes")
	ErrDeferredBroadcastFull = errors.New("too many deferred message broadcasts per tick")

	ErrSatoriConfigurationInvalid = errors.New("satori configuration is invalid")
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
	/*
		Return a logger with the specified field set so that they are included in subsequent logging calls.
	*/
	WithField(key string, v interface{}) Logger
	/*
		Return a logger with the specified fields set so that they are included in subsequent logging calls.
	*/
	WithFields(fields map[string]interface{}) Logger
	/*
		Returns the fields set in this logger.
	*/
	Fields() map[string]interface{}
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
		RegisterBeforeRt registers a function with for a message. Any function may be registered to intercept a message received from a client and operate on it (or reject it) based on custom logic.
		This is useful to enforce specific rules on top of the standard features in the server.

		You can return `nil` instead of the `rtapi.Envelope` and this will disable that particular server functionality.

		Message names can be found here: https://heroiclabs.com/docs/runtime-code-basics/#message-names
	*/
	RegisterBeforeRt(id string, fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *rtapi.Envelope) (*rtapi.Envelope, error)) error

	/*
		RegisterAfterRt registers a function for a message. The registered function will be called after the message has been processed in the pipeline.
		The custom code will be executed asynchronously after the response message has been sent to a client

		Message names can be found here: https://heroiclabs.com/docs/runtime-code-basics/#message-names
	*/
	RegisterAfterRt(id string, fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out, in *rtapi.Envelope) error) error

	// RegisterMatchmakerMatched
	RegisterMatchmakerMatched(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, entries []MatchmakerEntry) (string, error)) error

	// RegisterMatchmakerOverride
	RegisterMatchmakerOverride(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, candidateMatches [][]MatchmakerEntry) (matches [][]MatchmakerEntry)) error

	// RegisterMatch
	RegisterMatch(name string, fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule) (Match, error)) error

	// RegisterTournamentEnd
	RegisterTournamentEnd(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, tournament *api.Tournament, end, reset int64) error) error

	// RegisterTournamentReset
	RegisterTournamentReset(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, tournament *api.Tournament, end, reset int64) error) error

	// RegisterLeaderboardReset
	RegisterLeaderboardReset(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, leaderboard *api.Leaderboard, reset int64) error) error

	// RegisterPurchaseNotificationApple
	RegisterPurchaseNotificationApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, purchase *api.ValidatedPurchase, providerPayload string) error) error

	// RegisterSubscriptionNotificationApple
	RegisterSubscriptionNotificationApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, subscription *api.ValidatedSubscription, providerPayload string) error) error

	// RegisterPurchaseNotificationGoogle
	RegisterPurchaseNotificationGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, purchase *api.ValidatedPurchase, providerPayload string) error) error

	// RegisterSubscriptionNotificationGoogle
	RegisterSubscriptionNotificationGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, subscription *api.ValidatedSubscription, providerPayload string) error) error

	// RegisterBeforeGetAccount is used to register a function invoked when the server receives the relevant request.
	RegisterBeforeGetAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule) error) error

	// RegisterAfterGetAccount is used to register a function invoked after the server processes the relevant request.
	RegisterAfterGetAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Account) error) error

	// RegisterBeforeUpdateAccount is used to register a function invoked when the server receives the relevant request.
	RegisterBeforeUpdateAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error)) error

	// RegisterAfterUpdateAccount is used to register a function invoked after the server processes the relevant request.
	RegisterAfterUpdateAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.UpdateAccountRequest) error) error

	// RegisterBeforeDeleteAccount is used to register a function invoked when the server receives the relevant request.
	RegisterBeforeDeleteAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule) error) error

	// RegisterAfterDeleteAccount is used to register a function invoked after the server processes the relevant request.
	RegisterAfterDeleteAccount(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule) error) error

	// RegisterBeforeSessionRefresh can be used to perform pre-refresh checks.
	RegisterBeforeSessionRefresh(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.SessionRefreshRequest) (*api.SessionRefreshRequest, error)) error

	// RegisterAfterSessionRefresh can be used to perform after successful refresh checks.
	RegisterAfterSessionRefresh(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.SessionRefreshRequest) error) error

	// RegisterBeforeSessionLogout can be used to perform pre-logout checks.
	RegisterBeforeSessionLogout(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.SessionLogoutRequest) (*api.SessionLogoutRequest, error)) error

	// RegisterAfterSessionLogout can be used to perform after successful logout checks.
	RegisterAfterSessionLogout(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.SessionLogoutRequest) error) error

	// RegisterBeforeAuthenticateApple can be used to perform pre-authentication checks.
	RegisterBeforeAuthenticateApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateAppleRequest) (*api.AuthenticateAppleRequest, error)) error

	// RegisterAfterAuthenticateApple can be used to perform after successful authentication checks.
	RegisterAfterAuthenticateApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateAppleRequest) error) error

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

	// RegisterBeforeAuthenticateFacebookInstantGame can be used to perform pre-authentication checks.
	RegisterBeforeAuthenticateFacebookInstantGame(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateFacebookInstantGameRequest) (*api.AuthenticateFacebookInstantGameRequest, error)) error

	// RegisterAfterAuthenticateFacebookInstantGame can be used to perform after successful authentication checks.
	RegisterAfterAuthenticateFacebookInstantGame(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateFacebookInstantGameRequest) error) error

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
	RegisterBeforeListFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListFriendsRequest) (*api.ListFriendsRequest, error)) error

	// RegisterAfterListFriends can be used to perform additional logic after friends are listed.
	RegisterAfterListFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.FriendList) error) error

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

	// RegisterBeforeImportSteamFriends can be used to perform additional logic before Facebook friends are imported.
	RegisterBeforeImportSteamFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ImportSteamFriendsRequest) (*api.ImportSteamFriendsRequest, error)) error

	// RegisterAfterImportSteamFriends can be used to perform additional logic after Facebook friends are imported.
	RegisterAfterImportSteamFriends(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ImportSteamFriendsRequest) error) error

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

	// RegisterBeforeBanGroupUsers can be used to perform additional logic before user is banned from a group.
	RegisterBeforeBanGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.BanGroupUsersRequest) (*api.BanGroupUsersRequest, error)) error

	// RegisterAfterBanGroupUsers can be used to perform additional logic after user is banned from a group.
	RegisterAfterBanGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.BanGroupUsersRequest) error) error

	// RegisterBeforeKickGroupUsers can be used to perform additional logic before user is kicked to a group.
	RegisterBeforeKickGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error)) error

	// RegisterAfterKickGroupUsers can be used to perform additional logic after user is kicked from a group.
	RegisterAfterKickGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.KickGroupUsersRequest) error) error

	// RegisterBeforePromoteGroupUsers can be used to perform additional logic before user is promoted.
	RegisterBeforePromoteGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error)) error

	// RegisterAfterPromoteGroupUsers can be used to perform additional logic after user is promoted.
	RegisterAfterPromoteGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.PromoteGroupUsersRequest) error) error

	// RegisterBeforeDemoteGroupUsers can be used to perform additional logic before user is demoted.
	RegisterBeforeDemoteGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DemoteGroupUsersRequest) (*api.DemoteGroupUsersRequest, error)) error

	// RegisterAfterDemoteGroupUsers can be used to perform additional logic after user is demoted.
	RegisterAfterDemoteGroupUsers(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DemoteGroupUsersRequest) error) error

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

	// RegisterBeforeDeleteTournamentRecord can be used to perform additional logic before deleting record from a leaderboard.
	RegisterBeforeDeleteTournamentRecord(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteTournamentRecordRequest) (*api.DeleteTournamentRecordRequest, error)) error

	// RegisterAfterDeleteTournamentRecord can be used to perform additional logic after deleting record from a leaderboard.
	RegisterAfterDeleteTournamentRecord(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteTournamentRecordRequest) error) error

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

	// RegisterBeforeLinkApple can be used to perform additional logic before linking Apple ID to an account.
	RegisterBeforeLinkApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountApple) (*api.AccountApple, error)) error

	// RegisterAfterLinkApple can be used to perform additional logic after linking Apple ID to an account.
	RegisterAfterLinkApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountApple) error) error

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

	// RegisterBeforeLinkFacebookInstantGame can be used to perform additional logic before linking Facebook Instant Game profile to an account.
	RegisterBeforeLinkFacebookInstantGame(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error)) error

	// RegisterAfterLinkFacebookInstantGame can be used to perform additional logic after linking Facebook Instant Game profile to an account.
	RegisterAfterLinkFacebookInstantGame(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountFacebookInstantGame) error) error

	// RegisterBeforeLinkGameCenter can be used to perform additional logic before linking GameCenter to an account.
	RegisterBeforeLinkGameCenter(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error)) error

	// RegisterAfterLinkGameCenter can be used to perform additional logic after linking GameCenter to an account.
	RegisterAfterLinkGameCenter(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGameCenter) error) error

	// RegisterBeforeLinkGoogle can be used to perform additional logic before linking Google to an account.
	RegisterBeforeLinkGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error)) error

	// RegisterAfterLinkGoogle can be used to perform additional logic after linking Google to an account.
	RegisterAfterLinkGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountGoogle) error) error

	// RegisterBeforeLinkSteam can be used to perform additional logic before linking Steam to an account.
	RegisterBeforeLinkSteam(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.LinkSteamRequest) (*api.LinkSteamRequest, error)) error

	// RegisterAfterLinkSteam can be used to perform additional logic after linking Steam to an account.
	RegisterAfterLinkSteam(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.LinkSteamRequest) error) error

	// RegisterBeforeListMatches can be used to perform additional logic before listing matches.
	RegisterBeforeListMatches(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error)) error

	// RegisterAfterListMatches can be used to perform additional logic after listing matches.
	RegisterAfterListMatches(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.MatchList, in *api.ListMatchesRequest) error) error

	// RegisterBeforeListNotifications can be used to perform additional logic before listing notifications for a user.
	RegisterBeforeListNotifications(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error)) error

	// RegisterAfterListNotifications can be used to perform additional logic after listing notifications for a user.
	RegisterAfterListNotifications(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.NotificationList, in *api.ListNotificationsRequest) error) error

	// RegisterBeforeDeleteNotifications can be used to perform additional logic before deleting notifications.
	RegisterBeforeDeleteNotifications(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error)) error

	// RegisterAfterDeleteNotifications can be used to perform additional logic after deleting notifications.
	RegisterAfterDeleteNotifications(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.DeleteNotificationsRequest) error) error

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

	// RegisterBeforeValidatePurchaseApple can be used to perform additional logic before validating an Apple Store IAP receipt.
	RegisterBeforeValidatePurchaseApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ValidatePurchaseAppleRequest) (*api.ValidatePurchaseAppleRequest, error)) error

	// RegisterAfterValidatePurchaseApple can be used to perform additional logic after validating an Apple Store IAP receipt.
	RegisterAfterValidatePurchaseApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseAppleRequest) error) error

	// RegisterBeforeValidateSubscriptionApple can be used to perform additional logic before validation an Apple Store Subscription receipt.
	RegisterBeforeValidateSubscriptionApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ValidateSubscriptionAppleRequest) (*api.ValidateSubscriptionAppleRequest, error)) error

	// RegisterAfterValidateSubscriptionApple can be used to perform additional logic after validation an Apple Store Subscription receipt.
	RegisterAfterValidateSubscriptionApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionAppleRequest) error) error

	// RegisterBeforeValidatePurchaseGoogle can be used to perform additional logic before validating a Google Play Store IAP receipt.
	RegisterBeforeValidatePurchaseGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ValidatePurchaseGoogleRequest) (*api.ValidatePurchaseGoogleRequest, error)) error

	// RegisterAfterValidatePurchaseGoogle can be used to perform additional logic after validating a Google Play Store IAP receipt.
	RegisterAfterValidatePurchaseGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseGoogleRequest) error) error

	// RegisterBeforeValidateSubscriptionGoogle can be used to perform additional logic before validation an Google Store Subscription receipt.
	RegisterBeforeValidateSubscriptionGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ValidateSubscriptionGoogleRequest) (*api.ValidateSubscriptionGoogleRequest, error)) error

	// RegisterAfterValidateSubscriptionGoogle can be used to perform additional logic after validation an Google Store Subscription receipt.
	RegisterAfterValidateSubscriptionGoogle(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionGoogleRequest) error) error

	// RegisterBeforeValidatePurchaseHuawei can be used to perform additional logic before validating an Huawei App Gallery IAP receipt.
	RegisterBeforeValidatePurchaseHuawei(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ValidatePurchaseHuaweiRequest) (*api.ValidatePurchaseHuaweiRequest, error)) error

	// RegisterAfterValidatePurchaseHuawei can be used to perform additional logic after validating an Huawei App Gallery IAP receipt.
	RegisterAfterValidatePurchaseHuawei(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseHuaweiRequest) error) error

	// RegisterBeforeValidatePurchaseFacebookInstant can be used to perform additional logic before validating an Facebook Instant IAP receipt.
	RegisterBeforeValidatePurchaseFacebookInstant(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ValidatePurchaseFacebookInstantRequest) (*api.ValidatePurchaseFacebookInstantRequest, error)) error

	// RegisterAfterValidatePurchaseFacebookInstant can be used to perform additional logic after validating an Facebook Instant IAP receipt.
	RegisterAfterValidatePurchaseFacebookInstant(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseFacebookInstantRequest) error) error

	// RegisterBeforeListSubscriptions can be used to perform additional logic before listing subscriptions.
	RegisterBeforeListSubscriptions(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.ListSubscriptionsRequest) (*api.ListSubscriptionsRequest, error)) error

	// RegisterAfterListSubscriptions can be used to perform additional logic after listing subscriptions.
	RegisterAfterListSubscriptions(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.SubscriptionList, in *api.ListSubscriptionsRequest) error) error

	// RegisterBeforeGetSubscription can be used to perform additional logic before listing subscriptions.
	RegisterBeforeGetSubscription(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.GetSubscriptionRequest) (*api.GetSubscriptionRequest, error)) error

	// RegisterAfterGetSubscription can be used to perform additional logic after listing subscriptions.
	RegisterAfterGetSubscription(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.ValidatedSubscription, in *api.GetSubscriptionRequest) error) error

	// RegisterBeforeUnlinkApple can be used to perform additional logic before Apple ID is unlinked from an account.
	RegisterBeforeUnlinkApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountApple) (*api.AccountApple, error)) error

	// RegisterAfterUnlinkApple can be used to perform additional logic after Apple ID is unlinked from an account.
	RegisterAfterUnlinkApple(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountApple) error) error

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

	// RegisterBeforeUnlinkFacebookInstantGame can be used to perform additional logic before Facebook Instant Game profile is unlinked from an account.
	RegisterBeforeUnlinkFacebookInstantGame(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error)) error

	// RegisterAfterUnlinkFacebookInstantGame can be used to perform additional logic after Facebook Instant Game profile is unlinked from an account.
	RegisterAfterUnlinkFacebookInstantGame(fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, in *api.AccountFacebookInstantGame) error) error

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

	// RegisterEvent can be used to define a function handler that triggers when custom events are received or generated.
	RegisterEvent(fn func(ctx context.Context, logger Logger, evt *api.Event)) error

	// RegisterEventSessionStart can be used to define functions triggered when client sessions start.
	RegisterEventSessionStart(fn func(ctx context.Context, logger Logger, evt *api.Event)) error

	// RegisterEventSessionStart can be used to define functions triggered when client sessions end.
	RegisterEventSessionEnd(fn func(ctx context.Context, logger Logger, evt *api.Event)) error

	// Register a new storage index.
	RegisterStorageIndex(name, collection, key string, fields []string, maxEntries int, indexOnly bool) error

	// RegisterStorageIndexFilter can be used to define a filtering function for a given storage index.
	RegisterStorageIndexFilter(indexName string, fn func(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, write *StorageWrite) bool) error

	// RegisterFleetManager can be used to register a FleetManager implementation that can be retrieved from the runtime using GetFleetManager().
	RegisterFleetManager(fleetManagerInit FleetManagerInitializer) error
}

type PresenceReason uint8

const (
	PresenceReasonUnknown PresenceReason = iota
	PresenceReasonJoin
	PresenceReasonUpdate
	PresenceReasonLeave
	PresenceReasonDisconnect
)

type PresenceMeta interface {
	GetHidden() bool
	GetPersistence() bool
	GetUsername() string
	GetStatus() string
	GetReason() PresenceReason
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
	GetPartyId() string
}

type MatchData interface {
	Presence
	GetOpCode() int64
	GetData() []byte
	GetReliable() bool
	GetReceiveTime() int64
}

type MatchDispatcher interface {
	BroadcastMessage(opCode int64, data []byte, presences []Presence, sender Presence, reliable bool) error
	BroadcastMessageDeferred(opCode int64, data []byte, presences []Presence, sender Presence, reliable bool) error
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
	MatchSignal(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, dispatcher MatchDispatcher, tick int64, state interface{}, data string) (interface{}, string)
}

type AccountUpdate struct {
	UserID      string
	Username    string
	Metadata    map[string]interface{}
	DisplayName string
	Timezone    string
	Location    string
	LangTag     string
	AvatarUrl   string
}

type NotificationSend struct {
	UserID     string
	Subject    string
	Content    map[string]interface{}
	Code       int
	Sender     string
	Persistent bool
}

type NotificationDelete struct {
	UserID         string
	NotificationID string
}

type WalletUpdate struct {
	UserID    string
	Changeset map[string]int64
	Metadata  map[string]interface{}
}

type WalletUpdateResult struct {
	UserID   string
	Updated  map[string]int64
	Previous map[string]int64
}

type WalletNegativeError struct {
	UserID  string
	Path    string
	Current int64
	Amount  int64
}

func (e *WalletNegativeError) Error() string {
	return fmt.Sprintf("wallet update rejected negative value at path '%v'", e.Path)
}

type WalletLedgerItem interface {
	GetID() string
	GetUserID() string
	GetCreateTime() int64
	GetUpdateTime() int64
	GetChangeset() map[string]int64
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

type ChannelType int

const (
	Room ChannelType = iota + 1
	DirectMessage
	Group
)

type NakamaModule interface {
	AuthenticateApple(ctx context.Context, token, username string, create bool) (string, string, bool, error)
	AuthenticateCustom(ctx context.Context, id, username string, create bool) (string, string, bool, error)
	AuthenticateDevice(ctx context.Context, id, username string, create bool) (string, string, bool, error)
	AuthenticateEmail(ctx context.Context, email, password, username string, create bool) (string, string, bool, error)
	AuthenticateFacebook(ctx context.Context, token string, importFriends bool, username string, create bool) (string, string, bool, error)
	AuthenticateFacebookInstantGame(ctx context.Context, signedPlayerInfo string, username string, create bool) (string, string, bool, error)
	AuthenticateGameCenter(ctx context.Context, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl, username string, create bool) (string, string, bool, error)
	AuthenticateGoogle(ctx context.Context, token, username string, create bool) (string, string, bool, error)
	AuthenticateSteam(ctx context.Context, token, username string, create bool) (string, string, bool, error)

	AuthenticateTokenGenerate(userID, username string, exp int64, vars map[string]string) (string, int64, error)

	AccountGetId(ctx context.Context, userID string) (*api.Account, error)
	AccountsGetId(ctx context.Context, userIDs []string) ([]*api.Account, error)
	AccountUpdateId(ctx context.Context, userID, username string, metadata map[string]interface{}, displayName, timezone, location, langTag, avatarUrl string) error

	AccountDeleteId(ctx context.Context, userID string, recorded bool) error
	AccountExportId(ctx context.Context, userID string) (string, error)

	UsersGetId(ctx context.Context, userIDs []string, facebookIDs []string) ([]*api.User, error)
	UsersGetUsername(ctx context.Context, usernames []string) ([]*api.User, error)
	UsersGetRandom(ctx context.Context, count int) ([]*api.User, error)
	UsersBanId(ctx context.Context, userIDs []string) error
	UsersUnbanId(ctx context.Context, userIDs []string) error

	LinkApple(ctx context.Context, userID, token string) error
	LinkCustom(ctx context.Context, userID, customID string) error
	LinkDevice(ctx context.Context, userID, deviceID string) error
	LinkEmail(ctx context.Context, userID, email, password string) error
	LinkFacebook(ctx context.Context, userID, username, token string, importFriends bool) error
	LinkFacebookInstantGame(ctx context.Context, userID, signedPlayerInfo string) error
	LinkGameCenter(ctx context.Context, userID, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl string) error
	LinkGoogle(ctx context.Context, userID, token string) error
	LinkSteam(ctx context.Context, userID, username, token string, importFriends bool) error

	CronPrev(expression string, timestamp int64) (int64, error)
	CronNext(expression string, timestamp int64) (int64, error)
	ReadFile(path string) (*os.File, error)

	UnlinkApple(ctx context.Context, userID, token string) error
	UnlinkCustom(ctx context.Context, userID, customID string) error
	UnlinkDevice(ctx context.Context, userID, deviceID string) error
	UnlinkEmail(ctx context.Context, userID, email string) error
	UnlinkFacebook(ctx context.Context, userID, token string) error
	UnlinkFacebookInstantGame(ctx context.Context, userID, signedPlayerInfo string) error
	UnlinkGameCenter(ctx context.Context, userID, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl string) error
	UnlinkGoogle(ctx context.Context, userID, token string) error
	UnlinkSteam(ctx context.Context, userID, token string) error

	StreamUserList(mode uint8, subject, subcontext, label string, includeHidden, includeNotHidden bool) ([]Presence, error)
	StreamUserGet(mode uint8, subject, subcontext, label, userID, sessionID string) (PresenceMeta, error)
	StreamUserJoin(mode uint8, subject, subcontext, label, userID, sessionID string, hidden, persistence bool, status string) (bool, error)
	StreamUserUpdate(mode uint8, subject, subcontext, label, userID, sessionID string, hidden, persistence bool, status string) error
	StreamUserLeave(mode uint8, subject, subcontext, label, userID, sessionID string) error
	StreamUserKick(mode uint8, subject, subcontext, label string, presence Presence) error
	StreamCount(mode uint8, subject, subcontext, label string) (int, error)
	StreamClose(mode uint8, subject, subcontext, label string) error
	StreamSend(mode uint8, subject, subcontext, label, data string, presences []Presence, reliable bool) error
	StreamSendRaw(mode uint8, subject, subcontext, label string, msg *rtapi.Envelope, presences []Presence, reliable bool) error

	SessionDisconnect(ctx context.Context, sessionID string, reason ...PresenceReason) error
	SessionLogout(userID, token, refreshToken string) error

	MatchCreate(ctx context.Context, module string, params map[string]interface{}) (string, error)
	MatchGet(ctx context.Context, id string) (*api.Match, error)
	MatchList(ctx context.Context, limit int, authoritative bool, label string, minSize, maxSize *int, query string) ([]*api.Match, error)
	MatchSignal(ctx context.Context, id string, data string) (string, error)

	NotificationSend(ctx context.Context, userID, subject string, content map[string]interface{}, code int, sender string, persistent bool) error
	NotificationsSend(ctx context.Context, notifications []*NotificationSend) error
	NotificationSendAll(ctx context.Context, subject string, content map[string]interface{}, code int, persistent bool) error
	NotificationsDelete(ctx context.Context, notifications []*NotificationDelete) error

	WalletUpdate(ctx context.Context, userID string, changeset map[string]int64, metadata map[string]interface{}, updateLedger bool) (updated map[string]int64, previous map[string]int64, err error)
	WalletsUpdate(ctx context.Context, updates []*WalletUpdate, updateLedger bool) ([]*WalletUpdateResult, error)
	WalletLedgerUpdate(ctx context.Context, itemID string, metadata map[string]interface{}) (WalletLedgerItem, error)
	WalletLedgerList(ctx context.Context, userID string, limit int, cursor string) ([]WalletLedgerItem, string, error)

	StorageList(ctx context.Context, callerID, userID, collection string, limit int, cursor string) ([]*api.StorageObject, string, error)
	StorageRead(ctx context.Context, reads []*StorageRead) ([]*api.StorageObject, error)
	StorageWrite(ctx context.Context, writes []*StorageWrite) ([]*api.StorageObjectAck, error)
	StorageDelete(ctx context.Context, deletes []*StorageDelete) error
	StorageIndexList(ctx context.Context, callerID, indexName, query string, limit int) (*api.StorageObjects, error)

	MultiUpdate(ctx context.Context, accountUpdates []*AccountUpdate, storageWrites []*StorageWrite, storageDeletes []*StorageDelete, walletUpdates []*WalletUpdate, updateLedger bool) ([]*api.StorageObjectAck, []*WalletUpdateResult, error)

	LeaderboardCreate(ctx context.Context, id string, authoritative bool, sortOrder, operator, resetSchedule string, metadata map[string]interface{}) error
	LeaderboardDelete(ctx context.Context, id string) error
	LeaderboardList(limit int, cursor string) (*api.LeaderboardList, error)
	LeaderboardRecordsList(ctx context.Context, id string, ownerIDs []string, limit int, cursor string, expiry int64) (records []*api.LeaderboardRecord, ownerRecords []*api.LeaderboardRecord, nextCursor string, prevCursor string, err error)
	LeaderboardRecordsListCursorFromRank(id string, rank, overrideExpiry int64) (string, error)
	LeaderboardRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}, overrideOperator *int) (*api.LeaderboardRecord, error)
	LeaderboardRecordDelete(ctx context.Context, id, ownerID string) error
	LeaderboardsGetId(ctx context.Context, ids []string) ([]*api.Leaderboard, error)
	LeaderboardRecordsHaystack(ctx context.Context, id, ownerID string, limit int, cursor string, expiry int64) (*api.LeaderboardRecordList, error)

	PurchaseValidateApple(ctx context.Context, userID, receipt string, persist bool, passwordOverride ...string) (*api.ValidatePurchaseResponse, error)
	PurchaseValidateGoogle(ctx context.Context, userID, receipt string, persist bool, overrides ...struct {
		ClientEmail string
		PrivateKey  string
	}) (*api.ValidatePurchaseResponse, error)
	PurchaseValidateHuawei(ctx context.Context, userID, signature, inAppPurchaseData string, persist bool) (*api.ValidatePurchaseResponse, error)
	PurchaseValidateFacebookInstant(ctx context.Context, userID, signedRequest string, persist bool) (*api.ValidatePurchaseResponse, error)
	PurchasesList(ctx context.Context, userID string, limit int, cursor string) (*api.PurchaseList, error)
	PurchaseGetByTransactionId(ctx context.Context, transactionID string) (*api.ValidatedPurchase, error)

	SubscriptionValidateApple(ctx context.Context, userID, receipt string, persist bool, passwordOverride ...string) (*api.ValidateSubscriptionResponse, error)
	SubscriptionValidateGoogle(ctx context.Context, userID, receipt string, persist bool, overrides ...struct {
		ClientEmail string
		PrivateKey  string
	}) (*api.ValidateSubscriptionResponse, error)
	SubscriptionsList(ctx context.Context, userID string, limit int, cursor string) (*api.SubscriptionList, error)
	SubscriptionGetByProductId(ctx context.Context, userID, productID string) (*api.ValidatedSubscription, error)

	TournamentCreate(ctx context.Context, id string, authoritative bool, sortOrder, operator, resetSchedule string, metadata map[string]interface{}, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error
	TournamentDelete(ctx context.Context, id string) error
	TournamentAddAttempt(ctx context.Context, id, ownerID string, count int) error
	TournamentJoin(ctx context.Context, id, ownerID, username string) error
	TournamentsGetId(ctx context.Context, tournamentIDs []string) ([]*api.Tournament, error)
	TournamentList(ctx context.Context, categoryStart, categoryEnd, startTime, endTime, limit int, cursor string) (*api.TournamentList, error)
	TournamentRecordsList(ctx context.Context, tournamentId string, ownerIDs []string, limit int, cursor string, overrideExpiry int64) (records []*api.LeaderboardRecord, ownerRecords []*api.LeaderboardRecord, prevCursor string, nextCursor string, err error)
	TournamentRecordWrite(ctx context.Context, id, ownerID, username string, score, subscore int64, metadata map[string]interface{}, operatorOverride *int) (*api.LeaderboardRecord, error)
	TournamentRecordDelete(ctx context.Context, id, ownerID string) error
	TournamentRecordsHaystack(ctx context.Context, id, ownerID string, limit int, cursor string, expiry int64) (*api.TournamentRecordList, error)

	GroupsGetId(ctx context.Context, groupIDs []string) ([]*api.Group, error)
	GroupCreate(ctx context.Context, userID, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) (*api.Group, error)
	GroupUpdate(ctx context.Context, id, userID, name, creatorID, langTag, description, avatarUrl string, open bool, metadata map[string]interface{}, maxCount int) error
	GroupDelete(ctx context.Context, id string) error
	GroupUserJoin(ctx context.Context, groupID, userID, username string) error
	GroupUserLeave(ctx context.Context, groupID, userID, username string) error
	GroupUsersAdd(ctx context.Context, callerID, groupID string, userIDs []string) error
	GroupUsersBan(ctx context.Context, callerID, groupID string, userIDs []string) error
	GroupUsersKick(ctx context.Context, callerID, groupID string, userIDs []string) error
	GroupUsersPromote(ctx context.Context, callerID, groupID string, userIDs []string) error
	GroupUsersDemote(ctx context.Context, callerID, groupID string, userIDs []string) error
	GroupUsersList(ctx context.Context, id string, limit int, state *int, cursor string) ([]*api.GroupUserList_GroupUser, string, error)
	GroupsList(ctx context.Context, name, langTag string, members *int, open *bool, limit int, cursor string) ([]*api.Group, string, error)
	GroupsGetRandom(ctx context.Context, count int) ([]*api.Group, error)
	UserGroupsList(ctx context.Context, userID string, limit int, state *int, cursor string) ([]*api.UserGroupList_UserGroup, string, error)

	FriendsList(ctx context.Context, userID string, limit int, state *int, cursor string) ([]*api.Friend, string, error)
	FriendsAdd(ctx context.Context, userID string, username string, ids []string, usernames []string) error
	FriendsDelete(ctx context.Context, userID string, username string, ids []string, usernames []string) error
	FriendsBlock(ctx context.Context, userID string, username string, ids []string, usernames []string) error

	Event(ctx context.Context, evt *api.Event) error

	MetricsCounterAdd(name string, tags map[string]string, delta int64)
	MetricsGaugeSet(name string, tags map[string]string, value float64)
	MetricsTimerRecord(name string, tags map[string]string, value time.Duration)

	ChannelIdBuild(ctx context.Context, sender string, target string, chanType ChannelType) (string, error)
	ChannelMessageSend(ctx context.Context, channelID string, content map[string]interface{}, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error)
	ChannelMessageUpdate(ctx context.Context, channelID, messageID string, content map[string]interface{}, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error)
	ChannelMessageRemove(ctx context.Context, channelId, messageId string, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error)
	ChannelMessagesList(ctx context.Context, channelId string, limit int, forward bool, cursor string) (messages []*api.ChannelMessage, nextCursor string, prevCursor string, err error)

	GetSatori() Satori
	GetFleetManager() FleetManager
}

/*
Nakama fleet manager definitions.
*/
type InstanceInfo struct {
	// A platform-specific unique instance identifier. Identifiers may be recycled for
	// future use, but the underlying Fleet Manager platform is expected to ensure
	// uniqueness at least among concurrently running instances.
	Id string `json:"id"`
	// Connection information in a platform-specific format, usually "address:port"
	ConnectionInfo *ConnectionInfo `json:"connection_info"`
	// When this instance was first created.
	CreateTime time.Time `json:"create_time"`
	// Number of active player sessions on the server
	PlayerCount int `json:"player_count"`
	// Status
	Status string `json:"status"`
	// Application-specific data for use in indexing and listings.
	Metadata map[string]any `json:"metadata"`
}

type ConnectionInfo struct {
	IpAddress string `json:"ip_address"`
	DnsName   string `json:"dns_name"`
	Port      int    `json:"port"`
}

type JoinInfo struct {
	InstanceInfo *InstanceInfo  `json:"instance_info"`
	SessionInfo  []*SessionInfo `json:"session_info"`
}

type SessionInfo struct {
	UserId    string `json:"user_id"`
	SessionId string `json:"session_id"`
}

type FmCreateStatus int

const (
	// Create successfully created a new game instance.
	CreateSuccess FmCreateStatus = iota
	// Create request could not find a suitable instance within the configured timeout.
	CreateTimeout
	// Create failed to create a new game instance.
	CreateError
)

type FmCallbackHandler interface {
	// Generate a new callback id.
	GenerateCallbackId() string
	// Set the callback indexed by the generated id.
	SetCallback(callbackId string, fn FmCreateCallbackFn)
	// Invoke a callback by callback Id.
	InvokeCallback(callbackId string, status FmCreateStatus, instanceInfo *InstanceInfo, sessionInfo []*SessionInfo, metadata map[string]any, err error)
}

type FleetUserLatencies struct {
	// User id
	UserId string
	// Latency experienced by the user contacting a server in a fleet instance region.
	LatencyInMilliseconds float32
	// Region associated to the experienced latency value.
	RegionIdentifier string
}

// FmCreateCallbackFn is the function that is invoked when Create asynchronously succeeds or fails (due to timeout or issues bringing up a new instance).
// The function params include all the information needed to inform a client with a realtime connection to the server of the status of the Create request,
// including the new instance connection information in case of success.
// If status != CreateSuccess, then instanceInfo, sessionInfo and metadata will be nil and err will contain an error message.
// If no userIds were provided to Create, then sessionInfo will be nil regardless of successful instance creation.
type FmCreateCallbackFn func(status FmCreateStatus, instanceInfo *InstanceInfo, sessionInfo []*SessionInfo, metadata map[string]any, err error)

type FleetManager interface {
	// Get retrieves the most up-to-date information about an instance currently running
	// in the Fleet Manager platform. An error is expected if the instance does not exist,
	// either because it never existed or it was otherwise removed at some point.
	Get(ctx context.Context, id string) (instance *InstanceInfo, err error)

	// List retrieves a set of instances, optionally filtered by a platform-specific query.
	// The limit and previous cursor inputs are used as part of pagination, if supported.
	List(ctx context.Context, query string, limit int, previousCursor string) (list []*InstanceInfo, nextCursor string, err error)

	// Create issues a request to the underlying Fleet Manager platform to create a new
	// instance and initialize it with the given metadata. The metadata is expected to be
	// application-specific and only relevant to the application itself, not the platform.
	// The instance creation happens asynchronously - the passed callback is invoked once the
	// creation process was either successful or failed.
	// If a list of userIds is optionally provided, the new instance (on successful creation) will reserve slots
	// for the respective clients to connect, and the callback will contain the required []*SessionInfo.
	// Latencies is optional and its support depends on the Fleet Manager provider.
	Create(ctx context.Context, maxPlayers int, userIds []string, latencies []FleetUserLatencies, metadata map[string]any, callback FmCreateCallbackFn) (err error)

	// Join reserves a number of player slots in the target instance. These slots are reserved for a minute, after which,
	// if clients do not connect to the instance to claim them, the returned SessionInfo will become invalid and the
	// player slots will become available to new player sessions.
	Join(ctx context.Context, id string, userIds []string, metadata map[string]string) (joinInfo *JoinInfo, err error)
}

type FleetManagerInitializer interface {
	FleetManager
	// Init function - it is called internally by RegisterFleetManager to expose NakamaModule and FmCallbackHandler.
	// The implementation should keep references to nk and callbackHandler.
	Init(nk NakamaModule, callbackHandler FmCallbackHandler) error
	Update(ctx context.Context, id string, playerCount int, metadata map[string]any) error
	Delete(ctx context.Context, id string) error
}

/*
Satori runtime integration definitions.
*/
type Satori interface {
	Authenticate(ctx context.Context, id string, ipAddress ...string) error
	PropertiesGet(ctx context.Context, id string) (*Properties, error)
	PropertiesUpdate(ctx context.Context, id string, properties *PropertiesUpdate) error
	EventsPublish(ctx context.Context, id string, events []*Event) error
	ExperimentsList(ctx context.Context, id string, names ...string) (*ExperimentList, error)
	FlagsList(ctx context.Context, id string, names ...string) (*FlagList, error)
	LiveEventsList(ctx context.Context, id string, names ...string) (*LiveEventList, error)
}

type Properties struct {
	Default  map[string]string `json:"default,omitempty"`
	Custom   map[string]string `json:"custom,omitempty"`
	Computed map[string]string `json:"computed,omitempty"`
}

type PropertiesUpdate struct {
	Default   map[string]string `json:"default,omitempty"`
	Custom    map[string]string `json:"custom,omitempty"`
	Recompute *bool             `json:"recompute,omitempty"`
}

type Events struct {
	Events []*Event
}

type Event struct {
	Name      string            `json:"name,omitempty"`
	Id        string            `json:"id,omitempty"`
	Metadata  map[string]string `json:"metadata,omitempty"`
	Value     string            `json:"value,omitempty"`
	Timestamp int64             `json:"-"`
}

type ExperimentList struct {
	Experiments []*Experiment `json:"experiments,omitempty"`
}

type Experiment struct {
	Name  string `json:"name,omitempty"`
	Value string `json:"value,omitempty"`
}

type FlagList struct {
	Flags []*Flag `json:"flags,omitempty"`
}

type Flag struct {
	Name             string `json:"name,omitempty"`
	Value            string `json:"value,omitempty"`
	ConditionChanged bool   `json:"condition_changed,omitempty"`
}

type LiveEventList struct {
	LiveEvents []*LiveEvent `json:"live_events,omitempty"`
}

type LiveEvent struct {
	Name               string `json:"name,omitempty"`
	Description        string `json:"description,omitempty"`
	Value              string `json:"value,omitempty"`
	ActiveStartTimeSec int64  `json:"active_start_time_sec,string,omitempty"`
	ActiveEndTimeSec   int64  `json:"active_end_time_sec,string,omitempty"`
}
