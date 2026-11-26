// Copyright 2023 The Nakama Authors
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

package satori

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	goruntime "runtime"
	metrics "runtime/metrics"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// newIdentityEchoSatoriServer returns a fake Satori server that echoes the caller's identity and counts
// requests per method, path and identity.
func newIdentityEchoSatoriServer(t *testing.T, signingKey string) (*httptest.Server, func(method, path, id string) int) {
	var requestsMutex sync.Mutex
	requests := make(map[string]int)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := &sessionTokenClaims{}
		if _, err := jwt.ParseWithClaims(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), claims, func(*jwt.Token) (any, error) {
			return []byte(signingKey), nil
		}, jwt.WithValidMethods([]string{"HS256"})); err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		requestsMutex.Lock()
		requests[r.Method+" "+r.URL.Path+" "+claims.IdentityId]++
		requestsMutex.Unlock()

		var body any
		switch r.URL.Path {
		case "/v1/properties":
			if r.Method == http.MethodPut {
				return
			}
			body = &runtime.Properties{Default: map[string]string{"identity": claims.IdentityId}}
		case "/v1/flag":
			body = &runtime.FlagList{Flags: []*runtime.Flag{{Name: "identity", Value: claims.IdentityId}}}
		default:
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(server.Close)
	requestCount := func(method, path, id string) int {
		requestsMutex.Lock()
		defer requestsMutex.Unlock()
		return requests[method+" "+path+" "+id]
	}
	return server, requestCount
}

func TestSatoriClient_PropertiesGetCache(t *testing.T) {
	const signingKey = "signing-key"
	server, requestCount := newIdentityEchoSatoriServer(t, signingKey)

	logger := NewConsoleLogger(os.Stdout, true)
	ctx, ctxCancelFn := context.WithCancel(context.Background())
	defer ctxCancelFn()
	client := NewSatoriClient(ctx, logger, server.URL, "api-key-name", "api-key", "", signingKey, 0, 10_000, 0, true, "context", 0)

	propertiesGet := func(id string) {
		props, err := client.PropertiesGet(ctx, id)
		if err != nil {
			t.Fatalf("error in client.PropertiesGet: %+v", err)
		}
		if props.Default["identity"] != id {
			t.Fatalf("expected properties for %q, got properties for %q", id, props.Default["identity"])
		}
	}

	// Each identity gets its own properties, and repeated lookups within the context are served from the cache.
	for _, id := range []string{"identity-a", "identity-b", "identity-a", "identity-b"} {
		propertiesGet(id)
	}
	for _, id := range []string{"identity-a", "identity-b"} {
		if n := requestCount(http.MethodGet, "/v1/properties", id); n != 1 {
			t.Fatalf("expected 1 request for %q, got %d", id, n)
		}
	}

	// An update clears that identity's cached properties, so the next lookup goes back to Satori.
	if err := client.PropertiesUpdate(ctx, "identity-a", &runtime.PropertiesUpdate{Custom: map[string]string{"key": "value"}}); err != nil {
		t.Fatalf("error in client.PropertiesUpdate: %+v", err)
	}
	propertiesGet("identity-a")
	propertiesGet("identity-b")
	if n := requestCount(http.MethodGet, "/v1/properties", "identity-a"); n != 2 {
		t.Fatalf("expected 2 properties requests for %q, got %d", "identity-a", n)
	}
	if n := requestCount(http.MethodGet, "/v1/properties", "identity-b"); n != 1 {
		t.Fatalf("expected 1 properties request for %q, got %d", "identity-b", n)
	}
}

func TestSatoriClient_FlagsListContextCacheKeyedByIdentity(t *testing.T) {
	const signingKey = "signing-key"
	server, requestCount := newIdentityEchoSatoriServer(t, signingKey)

	logger := NewConsoleLogger(os.Stdout, true)
	ctx, ctxCancelFn := context.WithCancel(context.Background())
	defer ctxCancelFn()
	client := NewSatoriClient(ctx, logger, server.URL, "api-key-name", "api-key", "", signingKey, 0, 10_000, 0, true, "context", 0)

	for _, id := range []string{"identity-a", "identity-b", "identity-a", "identity-b"} {
		flags, err := client.FlagsList(ctx, id, nil, nil)
		if err != nil {
			t.Fatalf("error in client.FlagsList: %+v", err)
		}
		if len(flags.Flags) != 1 || flags.Flags[0].Value != id {
			t.Fatalf("expected flags for %q, got %+v", id, flags.Flags)
		}
	}

	// Repeated lookups for the same identity within the context are served from the cache.
	for _, id := range []string{"identity-a", "identity-b"} {
		if n := requestCount(http.MethodGet, "/v1/flag", id); n != 1 {
			t.Fatalf("expected 1 request for %q, got %d", id, n)
		}
	}
}

func TestSatoriClient_EventsPublish(t *testing.T) {
	t.SkipNow()

	identityID := uuid.Must(uuid.NewV4()).String()

	logger := NewConsoleLogger(os.Stdout, true)
	ctx := context.Background()
	client := NewSatoriClient(ctx, logger, "<URL>", "<API KEY NAME>", "<API KEY>", "<SERVER KEY>", "<SIGNING KEY>", 0, 10_000, 0, false, "", 0)

	ctx, ctxCancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer ctxCancelFn()

	_, err := client.Authenticate(ctx, identityID, nil, nil, true)
	if err != nil {
		t.Fatalf("error in client.Authenticate: %+v", err)
	}

	evt := &runtime.Event{
		Name: "gameStarted",
		// Id:   "optionalEventId",
		Metadata: map[string]string{
			"someKey": "someValue",
		},
		Value:     "someValue",
		Timestamp: time.Now().Unix(),
	}

	if err := client.EventsPublish(ctx, identityID, []*runtime.Event{evt}); err != nil {
		t.Fatalf("error in client.EventsPublish: %+v", err)
	}
}

// To run this test, replace the placeholders with valid Satori credentials and identity ID.
// This test is mostly exploratory to see if there are any memory leaks in the Satori client.
// It helped corroborate a stdlib `unique` package memory leak that was fixed in Go 1.25.0
// go test -vet=off -count=1 -v -run=TestSatoriClientMemory ./... | grep "memory"
func TestSatoriClientMemory(t *testing.T) {
	t.SkipNow()

	identityID := "<identity_id>"

	logger := NewConsoleLogger(os.Stdout, true)
	ctx := context.Background()
	client := NewSatoriClient(ctx, logger, "<SATORI_URL>", "<SATORI_API_KEY_NAME", "<SATORI_API_KEY>", "<SERVER KEY>", "<SIGNING_KEY>", 3600, 10_000, 0, true, "", 0)

	samples := []metrics.Sample{{
		Name: "/memory/classes/heap/objects:bytes",
	}}

	flagCount := 0

	metrics.Read(samples)
	t.Logf("flagCount: %d, %s: %s", flagCount, samples[0].Name, byteCountSI(samples[0].Value.Uint64()))

	timer := time.NewTimer(2 * time.Second)

	ctx, ctxCancelFn := context.WithCancel(context.Background())

loop:
	for {
		select {
		case <-timer.C:
			break loop
		default:
		}

		ctx = context.WithValue(ctx, "", struct{}{})
		_, err := client.FlagsList(ctx, identityID, []string{"BenchmarkTest"}, nil)
		if err != nil {
			t.Fatalf("error in client.FlagsList: %s", err.Error())
		}
		flagCount++
	}

	goruntime.GC()
	metrics.Read(samples)
	t.Logf("flagCount: %d, %s: %s", flagCount, samples[0].Name, byteCountSI(samples[0].Value.Uint64()))

	ctxCancelFn()

	endTimer := time.NewTimer(6 * time.Second)
	<-endTimer.C

	goruntime.GC()
	metrics.Read(samples)
	t.Logf("flagCount: %d, %s: %s", flagCount, samples[0].Name, byteCountSI(samples[0].Value.Uint64()))
}

func byteCountSI(b uint64) string {
	const unit = 1000
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB",
		float64(b)/float64(div), "kMGTPE"[exp])
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

type loggerEnabler struct{}

func (l *loggerEnabler) Enabled(level zapcore.Level) bool {
	return true
}
