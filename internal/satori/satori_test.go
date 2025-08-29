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
	"fmt"
	"os"
	goruntime "runtime"
	metrics "runtime/metrics"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func TestSatoriClient_EventsPublish(t *testing.T) {
	t.SkipNow()

	identityID := uuid.Must(uuid.NewV4()).String()

	logger := NewConsoleLogger(os.Stdout, true)
	ctx := context.Background()
	client := NewSatoriClient(ctx, logger, "<URL>", "<API KEY NAME>", "<API KEY>", "<SIGNING KEY>", 0, false, nil)

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
	client := NewSatoriClient(ctx, logger, "<SATORI_URL>", "<SATORI_API_KEY_NAME", "<SATORI_API_KEY>", "<SIGNING_KEY>", 3600, true, nil)

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
		_, err := client.FlagsList(ctx, identityID, "BenchmarkTest")
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
