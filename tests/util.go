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
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama/v2/apigrpc"
	"github.com/heroiclabs/nakama/v2/server"
	_ "github.com/jackc/pgx/stdlib"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"os"
	"strings"
	"testing"
)

var (
	logger          = NewConsoleLogger(os.Stdout, true)
	config          = server.NewConfig(logger)
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

func init() {
	_ = server.CheckConfig(logger, config)
}

type DummyMessageRouter struct{}

func (d *DummyMessageRouter) SendDeferred(*zap.Logger, []*server.DeferredMessage) {
	panic("unused")
}
func (d *DummyMessageRouter) SendToPresenceIDs(*zap.Logger, []*server.PresenceID, *rtapi.Envelope, bool) {
}
func (d *DummyMessageRouter) SendToStream(*zap.Logger, server.PresenceStream, *rtapi.Envelope, bool) {}

type DummySession struct {
	messages []*rtapi.Envelope
	uid      uuid.UUID
}

func (d *DummySession) Logger() *zap.Logger {
	return logger
}
func (d *DummySession) ID() uuid.UUID {
	return uuid.Must(uuid.NewV4())
}
func (d *DummySession) UserID() uuid.UUID {
	return d.uid
}
func (d *DummySession) Username() string {
	return ""
}
func (d *DummySession) SetUsername(string) {}
func (d *DummySession) Vars() map[string]string {
	return nil
}
func (d *DummySession) Expiry() int64 {
	return int64(0)
}
func (d *DummySession) Consume() {}
func (d *DummySession) Format() server.SessionFormat {
	return server.SessionFormatJson
}
func (d *DummySession) ClientIP() string {
	return ""
}
func (d *DummySession) ClientPort() string {
	return ""
}
func (d *DummySession) Context() context.Context {
	return context.Background()
}
func (d *DummySession) Send(envelope *rtapi.Envelope, reliable bool) error {
	d.messages = append(d.messages, envelope)
	return nil
}
func (d *DummySession) SendBytes(payload []byte, reliable bool) error {
	envelope := &rtapi.Envelope{}
	jsonpbUnmarshaler.Unmarshal(bytes.NewReader(payload), envelope)
	d.messages = append(d.messages, envelope)
	return nil
}

func (d *DummySession) Close(reason string) {}

type loggerEnabler struct{}

func (l *loggerEnabler) Enabled(level zapcore.Level) bool {
	return true
}

func NewConsoleLogger(output *os.File, verbose bool) *zap.Logger {
	consoleEncoder := zapcore.NewConsoleEncoder(zapcore.EncoderConfig{
		TimeKey:        "ts",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		MessageKey:     "msg",
		StacktraceKey:  "stacktrace",
		EncodeLevel:    zapcore.CapitalColorLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.StringDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	})

	core := zapcore.NewCore(consoleEncoder, output, &loggerEnabler{})
	options := []zap.Option{zap.AddStacktrace(zap.ErrorLevel)}

	return zap.New(core, options...)
}

func NewDB(t *testing.T) *sql.DB {
	db, err := sql.Open("pgx", "postgresql://root@127.0.0.1:26257/nakama?sslmode=disable")
	//db, err := sql.Open("pgx", "postgresql://postgres@127.0.0.1:5432/nakama?sslmode=disable")
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
	return uuid.Must(uuid.NewV4()).String()
}

func InsertUser(t *testing.T, db *sql.DB, uid uuid.UUID) {
	if _, err := db.Exec(`
INSERT INTO users (id, username)
VALUES ($1, $2)
ON CONFLICT(id) DO NOTHING`, uid, uid.String()); err != nil {
		t.Fatal("Could not insert new user.", err)
	}
}

func NewAPIServer(t *testing.T, runtime *server.Runtime) (*server.ApiServer, *server.Pipeline) {
	db := NewDB(t)
	router := &DummyMessageRouter{}
	tracker := &server.LocalTracker{}
	pipeline := server.NewPipeline(logger, config, db, jsonpbMarshaler, jsonpbUnmarshaler, nil, nil, nil, tracker, router, runtime)
	apiServer := server.StartApiServer(logger, logger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, nil, nil, nil, nil, nil, nil, tracker, router, pipeline, runtime)
	return apiServer, pipeline
}

func NewSession(t *testing.T, customID string) (*grpc.ClientConn, apigrpc.NakamaClient, *api.Session, context.Context) {
	ctx := context.Background()
	outgoingCtx := metadata.NewOutgoingContext(ctx, metadata.New(map[string]string{
		"authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("defaultkey:")),
	}))
	conn, err := grpc.DialContext(outgoingCtx, "localhost:7349", grpc.WithInsecure())
	if err != nil {
		t.Fatal(err)
	}

	client := apigrpc.NewNakamaClient(conn)
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

func NewAuthenticatedAPIClient(t *testing.T, customID string) (*grpc.ClientConn, apigrpc.NakamaClient, *api.Session, context.Context) {
	conn, _, session, _ := NewSession(t, customID)
	conn.Close()

	ctx := context.Background()
	outgoingCtx := metadata.NewOutgoingContext(ctx, metadata.New(map[string]string{
		"authorization": "Bearer " + session.Token,
	}))
	conn, err := grpc.DialContext(outgoingCtx, "localhost:7349", grpc.WithInsecure())
	if err != nil {
		t.Fatal(err)
	}

	client := apigrpc.NewNakamaClient(conn)
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
