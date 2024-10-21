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

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/apigrpc"
	_ "github.com/jackc/pgx/v5/stdlib"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/encoding/protojson"
)

var (
	logger             = NewConsoleLogger(os.Stdout, true)
	cfg                = NewConfig(logger)
	protojsonMarshaler = &protojson.MarshalOptions{
		UseProtoNames:   true,
		UseEnumNumbers:  true,
		EmitUnpopulated: false,
	}
	protojsonUnmarshaler = &protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}
	metrics       = NewLocalMetrics(logger, logger, nil, cfg)
	storageIdx, _ = NewLocalStorageIndex(logger, nil, &StorageConfig{DisableIndexOnly: false}, metrics)
	_             = ValidateConfig(logger, cfg)
)

type DummyMessageRouter struct{}

func (d *DummyMessageRouter) SendDeferred(*zap.Logger, []*DeferredMessage) {
	panic("unused")
}

func (d *DummyMessageRouter) SendToPresenceIDs(*zap.Logger, []*PresenceID, *rtapi.Envelope, bool) {
}
func (d *DummyMessageRouter) SendToStream(*zap.Logger, PresenceStream, *rtapi.Envelope, bool) {}
func (d *DummyMessageRouter) SendToAll(*zap.Logger, *rtapi.Envelope, bool)                    {}

type DummySession struct {
	messages []*rtapi.Envelope
	uid      uuid.UUID
	mu       sync.Mutex
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
func (d *DummySession) Format() SessionFormat {
	return SessionFormatJson
}

func (d *DummySession) ClientIP() string {
	return ""
}

func (d *DummySession) ClientPort() string {
	return ""
}

func (d *DummySession) Lang() string {
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
	if err := protojsonUnmarshaler.Unmarshal(payload, envelope); err != nil {
		return err
	}
	d.messages = append(d.messages, envelope)
	return nil
}

func (d *DummySession) Close(msg string, reason runtime.PresenceReason, envelopes ...*rtapi.Envelope) {
}

func (d *DummySession) CloseLock() {
	d.mu.Lock()
}

func (d *DummySession) CloseUnlock() {
	d.mu.Unlock()
}

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
	//dbUrl := "postgresql://postgres@127.0.0.1:5432/nakama?sslmode=disable"
	dbUrl := "postgresql://root@127.0.0.1:26257/nakama?sslmode=disable"
	if dbUrlEnv := os.Getenv("TEST_DB_URL"); len(dbUrlEnv) > 0 {
		dbUrl = dbUrlEnv
	}

	db, err := sql.Open("pgx", dbUrl)
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

func WaitForSocket(expected error, cfg *config) {
	ports := []int{cfg.GetSocket().Port - 1, cfg.GetSocket().Port}

	for _, port := range ports {
		for {
			conn, err := net.Dial("tcp", fmt.Sprintf(":%d", port))
			if conn != nil {
				_ = conn.Close()
			}

			if errors.Is(err, expected) {
				break
			}

			time.Sleep(300 * time.Millisecond)
		}
	}
}

func NewAPIServer(t *testing.T, runtime *Runtime) (*ApiServer, *Pipeline) {
	db := NewDB(t)
	router := &DummyMessageRouter{}
	sessionCache := NewLocalSessionCache(3_600, 7_200)
	sessionRegistry := NewLocalSessionRegistry(metrics)
	tracker := &LocalTracker{sessionRegistry: sessionRegistry}
	pipeline := NewPipeline(logger, cfg, db, protojsonMarshaler, protojsonUnmarshaler, sessionRegistry, nil, nil, nil, nil, tracker, router, runtime)
	apiServer := StartApiServer(logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, cfg, "3.0.0", nil, storageIdx, nil, nil, sessionRegistry, sessionCache, nil, nil, nil, tracker, router, nil, metrics, pipeline, runtime)

	WaitForSocket(nil, cfg)
	return apiServer, pipeline
}

func NewSession(t *testing.T, customID string) (*grpc.ClientConn, apigrpc.NakamaClient, *api.Session, context.Context) {
	ctx := context.Background()
	outgoingCtx := metadata.NewOutgoingContext(ctx, metadata.New(map[string]string{
		"authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("defaultkey:")),
	}))
	conn, err := grpc.NewClient("localhost:7349", grpc.WithTransportCredentials(insecure.NewCredentials()))
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
	conn, err := grpc.NewClient("localhost:7349", grpc.WithTransportCredentials(insecure.NewCredentials()))
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
