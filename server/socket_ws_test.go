// Copyright 2026 The Nakama Authors
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
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/gorilla/websocket"
	"github.com/heroiclabs/nakama-common/api"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// End-to-end: after single-session logout, WebSocket must reject the same JWT using tokenId
// blacklist semantics (see issue #2506). Requires Postgres (TEST_DB_URL or default local nakama DB).
func TestWebSocketRejectsSessionAfterLogout(t *testing.T) {
	runtime, _, err := runtimeWithModules(t, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}

	apiServer, _ := NewAPIServer(t, runtime)
	defer apiServer.Stop()

	conn, client, session, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())
	defer conn.Close()

	wsConn, resp, err := dialGameWebSocket(session.Token, "")
	if err != nil {
		if resp != nil {
			t.Fatalf("expected websocket upgrade before logout, got status %d: %v", resp.StatusCode, err)
		}
		t.Fatalf("expected websocket upgrade before logout: %v", err)
	}
	wsConn.Close()

	_, err = client.SessionLogout(ctx, &api.SessionLogoutRequest{
		Token: session.Token,
	})
	if err != nil {
		t.Fatalf("session logout failed: %v", err)
	}

	_, err = client.GetAccount(ctx, &emptypb.Empty{})
	if err == nil {
		t.Fatal("expected GetAccount to fail after session logout")
	}
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated from GetAccount, got %v", err)
	}

	_, resp, err = dialGameWebSocket(session.Token, "")
	if err == nil {
		t.Fatal("expected websocket dial to fail after session logout")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		if resp != nil {
			t.Fatalf("expected websocket HTTP 401 after logout, got status %d: %v", resp.StatusCode, err)
		}
		t.Fatalf("expected websocket HTTP 401 response after logout: %v", err)
	}

	// Query-string token auth must follow the same session cache rules.
	_, resp, err = dialGameWebSocket("", session.Token)
	if err == nil {
		t.Fatal("expected websocket dial with query token to fail after session logout")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		if resp != nil {
			t.Fatalf("expected query-token websocket HTTP 401, got status %d: %v", resp.StatusCode, err)
		}
		t.Fatalf("expected query-token websocket HTTP 401: %v", err)
	}
}

func dialGameWebSocket(bearerToken, queryToken string) (*websocket.Conn, *http.Response, error) {
	wsURL := fmt.Sprintf("ws://127.0.0.1:%d/ws", cfg.GetSocket().Port)
	if queryToken != "" {
		wsURL = fmt.Sprintf("%s?token=%s", wsURL, url.QueryEscape(queryToken))
	}

	header := http.Header{}
	if bearerToken != "" {
		header.Set("Authorization", "Bearer "+bearerToken)
	}

	return websocket.DefaultDialer.Dial(wsURL, header)
}
