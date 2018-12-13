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
	"fmt"
	"log"
	"strings"

	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"google.golang.org/grpc/codes"
)

// This example shows how to register a new RPC function with the server.
func ExampleInitializer_registerRpc() {
	// this is received from the InitModule function invocation
	var initializer Initializer

	// We are registering 'my_custom_func' as a custom RPC call with the server. Client can use this name to invoke this function remotely.
	err := initializer.RegisterRpc("my_custom_func", func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, payload string) (string, error) {
		return "", NewError("Function not implemented", int(codes.Unimplemented)) // gRPC error 12, HTTP code 501
	})

	if err != nil {
		log.Fatalf("could not instantiate module: %v", err)
	}

	log.Printf("Module loaded.")
}

// This example shows how to register a hook function that is invoked
// when messages with matching names are received from the real-time (rt) socket.
// For list of message names see:
// https://heroiclabs.com/docs/runtime-code-basics/#message-names
func ExampleInitializer_registerBeforeRt() {
	// this is received from the InitModule function invocation
	var initializer Initializer

	err := initializer.RegisterBeforeRt("ChannelJoin", func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
		channelJoinMessage := envelope.GetChannelJoin()

		// make sure all messages are persisted - this overrides whatever client has provided
		channelJoinMessage.Persistence = &wrappers.BoolValue{Value: true}
		return envelope, nil
	})

	if err != nil {
		log.Fatalf("could not instantiate module: %v", err)
	}

	log.Printf("Module loaded.")
}

// This example shows how to register a hook function that is invoked
// after messages with matching names are processed by the server.
//
// In this example, we send a notification to anyone when they have a new follower following their status updates.
//
// For list of message names see:
// https://heroiclabs.com/docs/runtime-code-basics/#message-names
func ExampleInitializer_registerAfterRt() {
	// this is received from the InitModule function invocation
	var initializer Initializer

	err := initializer.RegisterAfterRt("StatusFollow", func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, envelope *rtapi.Envelope) error {
		// This is the user that has sent the status follow messages.
		userID := ctx.Value(RUNTIME_CTX_USER_ID).(string)
		statusFollowMessage := envelope.GetStatusFollow()

		// A user can follow multiple people at once, so lets buffer up a notification list.
		notifications := make([]*NotificationSend, 0, len(statusFollowMessage.UserIds))
		for _, followingUser := range statusFollowMessage.UserIds {
			notification := &NotificationSend{
				UserID:  followingUser,
				Sender:  userID,
				Subject: "New follower!",
				Content: map[string]interface{}{ // content will be converted to JSON
					"user_id": userID,
					"content": fmt.Sprintf("%s is now following you!", userID),
				},
				Code:       1,
				Persistent: false,
			}
			notifications = append(notifications, notification)
		}

		err := nk.NotificationsSend(ctx, notifications)
		if err != nil {
			log.Printf("could not send notifications - %v", err)
		}
		return err
	})

	if err != nil {
		log.Fatalf("could not instantiate module: %v", err)
	}

	log.Printf("Module loaded.")
}

// This example shows how to disable various server features by returning nil in case of an actual result.
// Disabled server resources return 404 to the clients.
// For list of message names see:
// https://heroiclabs.com/docs/runtime-code-basics/#message-names
func ExampleInitializer_disableFeatures() {
	// this is received from the InitModule function invocation
	var initializer Initializer

	err := initializer.RegisterBeforeAuthenticateDevice(func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error) {
		// returning nil as for the result disables the functionality
		return nil, nil
	})

	err = initializer.RegisterBeforeRt("StatusFollow", func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
		// returning nil as for the result disables the functionality
		return nil, nil
	})

	if err != nil {
		log.Fatalf("could not instantiate module: %v", err)
	}

	log.Printf("Module loaded.")
}

// This example shows how to decode custom authentication tokens.
// This is primarily useful for integration between custom third-party user account systems and Nakama.
//
// In this example, we are ensuring that the username passed from the client does not contain certain words.
//
// For list of message names see:
// https://heroiclabs.com/docs/runtime-code-basics/#message-names
func ExampleInitializer_registerBeforeAuthenticateCustom() {
	// this is received from the InitModule function invocation
	var initializer Initializer

	err := initializer.RegisterBeforeAuthenticateCustom(func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error) {
		username := in.GetUsername()
		uncoolNames := []string{"novabyte", "zyro", "shawshank", "anton-chigurh"} // notice no 'mofirouz' or 'bourne' since he's awesome (they are synonyms)!

		for _, badWord := range uncoolNames {
			if strings.Contains(username, badWord) {
				in.Username = "" // reset the username, so that the system can generate one.
				break
			}
		}

		return in, nil
	})

	if err != nil {
		log.Fatalf("could not instantiate module: %v", err)
	}

	log.Printf("Module loaded.")
}

// This example shows how to join a newly created user to a specific tournament.
//
// For list of message names see:
// https://heroiclabs.com/docs/runtime-code-basics/#message-names
func ExampleInitializer_registerAfterAuthenticateCustom() {
	// this is received from the InitModule function invocation
	var initializer Initializer

	err := initializer.RegisterAfterAuthenticateCustom(func(ctx context.Context, logger *log.Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateCustomRequest) error {
		// If user was not newly created, return early
		if !out.Created {
			return nil
		}

		tournamentName := "newcomers"
		userID := ctx.Value(RUNTIME_CTX_USER_ID).(string)
		username := ctx.Value(RUNTIME_CTX_USERNAME).(string)
		err := nk.TournamentJoin(ctx, tournamentName, userID, username)
		if err != nil {
			log.Printf("could not join user %s to tournament %s: %v", userID, tournamentName, err)
		}
		return err
	})

	if err != nil {
		log.Fatalf("could not instantiate module: %v", err)
	}

	log.Printf("Module loaded.")
}
