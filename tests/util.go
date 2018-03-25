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

package tests

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/golang/protobuf/jsonpb"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/server"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

var (
	config          = server.NewConfig()
	logger          = server.NewConsoleLogger(os.Stdout, true)
	jsonpbMarshaler = &jsonpb.Marshaler{
		EnumsAsInts:  true,
		EmitDefaults: false,
		Indent:       "",
		OrigName:     true,
	}
	jsonpbUnmarshaler = &jsonpb.Unmarshaler{
		AllowUnknownFields: false,
	}
)

type DummyMessageRouter struct{}

func (d *DummyMessageRouter) SendToPresenceIDs(*zap.Logger, []*server.PresenceID, *rtapi.Envelope) {}
func (d *DummyMessageRouter) SendToStream(*zap.Logger, server.PresenceStream, *rtapi.Envelope)     {}

type DummySession struct {
	messages []*rtapi.Envelope
	uid      uuid.UUID
}

func (d *DummySession) Logger() *zap.Logger {
	return logger
}
func (d *DummySession) ID() uuid.UUID {
	return uuid.NewV4()
}
func (d *DummySession) UserID() uuid.UUID {
	return d.uid
}
func (d *DummySession) Username() string {
	return ""
}
func (d *DummySession) SetUsername(string) {}
func (d *DummySession) Expiry() int64 {
	return int64(0)
}
func (d *DummySession) Consume(func(logger *zap.Logger, session server.Session, envelope *rtapi.Envelope) bool) {
}
func (d *DummySession) Format() server.SessionFormat {
	return server.SessionFormatJson
}
func (d *DummySession) Send(envelope *rtapi.Envelope) error {
	d.messages = append(d.messages, envelope)
	return nil
}
func (d *DummySession) SendBytes(payload []byte) error {
	envelope := &rtapi.Envelope{}
	jsonpbUnmarshaler.Unmarshal(bytes.NewReader(payload), envelope)
	d.messages = append(d.messages, envelope)
	return nil
}

func (d *DummySession) Close() {}

func NewDB(t *testing.T) *sql.DB {
	db, err := sql.Open("postgres", "postgresql://root@127.0.0.1:26257/nakama?sslmode=disable")
	if err != nil {
		t.Fatal("Error connecting to database", err)
	}
	err = db.Ping()
	if err != nil {
		t.Fatal("Error pinging database", err)
	}
	return db
}

func GenerateString() string {
	return strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
}

func InsertUser(t *testing.T, db *sql.DB, uid uuid.UUID) {
	if _, err := db.Exec(`
INSERT INTO users (id, username)
VALUES ($1, $2)
ON CONFLICT(id) DO NOTHING`, uid, uid.String()); err != nil {
		t.Fatal("Could not insert new user.", err)
	}
}

func NewAPIServer(t *testing.T, runtimePool *server.RuntimePool) (*server.ApiServer, *server.Pipeline) {
	db := NewDB(t)
	router := &DummyMessageRouter{}
	tracker := &server.LocalTracker{}
	pipeline := server.NewPipeline(config, db, jsonpbMarshaler, jsonpbUnmarshaler, nil, nil, tracker, router, runtimePool)
	apiServer := server.StartApiServer(logger, logger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, nil, nil, nil, tracker, router, pipeline, runtimePool)
	return apiServer, pipeline
}

func NewSession(t *testing.T, customID string) (*grpc.ClientConn, api.NakamaClient, *api.Session, context.Context) {
	ctx := context.Background()
	outgoingCtx := metadata.NewOutgoingContext(ctx, metadata.New(map[string]string{
		"authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("defaultkey:")),
	}))
	conn, err := grpc.DialContext(outgoingCtx, "localhost:7350", grpc.WithInsecure())
	if err != nil {
		t.Fatal(err)
	}

	client := api.NewNakamaClient(conn)
	session, err := client.AuthenticateCustom(outgoingCtx, &api.AuthenticateCustomRequest{
		Account: &api.AccountCustom{
			Id: customID,
		},
		Username: GenerateString(),
	})
	if err != nil {
		t.Fatal(err)
	}

	return conn, client, session, outgoingCtx
}

func NewAuthenticatedAPIClient(t *testing.T, customID string) (*grpc.ClientConn, api.NakamaClient, *api.Session, context.Context) {
	conn, _, session, _ := NewSession(t, customID)
	conn.Close()

	ctx := context.Background()
	outgoingCtx := metadata.NewOutgoingContext(ctx, metadata.New(map[string]string{
		"authorization": "Bearer " + session.Token,
	}))
	conn, err := grpc.DialContext(outgoingCtx, "localhost:7350", grpc.WithInsecure())
	if err != nil {
		t.Fatal(err)
	}

	client := api.NewNakamaClient(conn)
	return conn, client, session, outgoingCtx
}

func UserIDFromSession(session *api.Session) (uuid.UUID, error) {
	parts := strings.Split(session.Token, ".")
	content, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return uuid.Nil, err
	}

	data := make(map[string]interface{}, 0)
	err = json.Unmarshal(content, &data)
	if err != nil {
		return uuid.Nil, err
	}

	return uuid.FromString(data["uid"].(string))
}
