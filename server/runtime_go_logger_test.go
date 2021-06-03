// Copyright 2020 The Nakama Authors
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
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestGoLoggerInfo(t *testing.T) {
	observer, logs := observer.New(zap.InfoLevel)

	obs := zap.New(observer)
	logger := NewRuntimeGoLogger(obs)

	logger.Info("%s log", "info")

	assert.Equal(t, 1, logs.Len())
	actualLog := logs.All()[0]
	assert.Equal(t, actualLog.Level, zap.InfoLevel)
	assert.Equal(t, actualLog.Message, "info log")
	assert.Contains(t, actualLog.Context,
		zap.Field{Key: "runtime", String: "go", Type: zapcore.StringType},
	)
}

func TestGoLoggerWarn(t *testing.T) {
	observer, logs := observer.New(zap.WarnLevel)

	obs := zap.New(observer)
	logger := NewRuntimeGoLogger(obs)

	logger.Warn("%s log", "warn")

	assert.Equal(t, 1, logs.Len())
	actualLog := logs.All()[0]
	assert.Equal(t, actualLog.Level, zap.WarnLevel)
	assert.Equal(t, actualLog.Message, "warn log")
	assert.Contains(t, actualLog.Context, zap.Field{Key: "runtime", String: "go", Type: zapcore.StringType})
}

func TestGoLoggerError(t *testing.T) {
	observer, logs := observer.New(zap.ErrorLevel)

	obs := zap.New(observer)
	logger := NewRuntimeGoLogger(obs)

	logger.Error("%s log", "error")

	assert.Equal(t, 1, logs.Len())
	actualLog := logs.All()[0]
	assert.Equal(t, actualLog.Level, zap.ErrorLevel)
	assert.Equal(t, actualLog.Message, "error log")
	assert.Contains(t, actualLog.Context, zap.Field{Key: "runtime", String: "go", Type: zapcore.StringType})
}

func TestGoLoggerDebug(t *testing.T) {
	observer, logs := observer.New(zap.DebugLevel)

	obs := zap.New(observer)
	logger := NewRuntimeGoLogger(obs)

	logger.Debug("%s log", "debug")

	assert.Equal(t, 1, logs.Len())
	actualLog := logs.All()[0]
	assert.Equal(t, actualLog.Level, zap.DebugLevel)
	assert.Equal(t, actualLog.Message, "debug log")
	assert.Contains(t, actualLog.Context, zap.Field{Key: "runtime", String: "go", Type: zapcore.StringType})
}

func TestGoLoggerWithField(t *testing.T) {
	observer, logs := observer.New(zap.InfoLevel)

	obs := zap.New(observer)
	k := "key"
	v := "value"
	logger := NewRuntimeGoLogger(obs).WithField(k, v)

	logger.Info("log with field")

	assert.Equal(t, 1, logs.Len())
	actualLog := logs.All()[0]
	assert.Equal(t, actualLog.Level, zap.InfoLevel)
	assert.Contains(t, actualLog.Context, zap.Field{Key: "runtime", String: "go", Type: zapcore.StringType})
	assert.Contains(t, actualLog.Context, zap.Field{Key: k, String: v, Type: zapcore.StringType})
}

func TestGoLoggerWithFields(t *testing.T) {
	observer, logs := observer.New(zap.InfoLevel)

	obs := zap.New(observer)
	fields := map[string]interface{}{
		"key1":    "value1",
		"key2":    2,
		"runtime": "foo", // Overwriting runtime should yield no effect
	}

	logger := NewRuntimeGoLogger(obs).WithFields(fields)
	logger.Info("log message")

	assert.Equal(t, 1, logs.Len())
	actualLog := logs.All()[0]
	assert.Equal(t, actualLog.Message, "log message")
	assert.Contains(t, actualLog.Context, zap.Field{Key: "runtime", String: "go", Type: zapcore.StringType})
	assert.Contains(t, actualLog.Context, zap.Field{Key: "key1", String: "value1", Type: zapcore.StringType})
	assert.Contains(t, actualLog.Context, zap.Field{Key: "key2", Integer: 2, Type: zapcore.Int64Type})
}

func TestGoLoggerFields(t *testing.T) {
	observer, _ := observer.New(zap.InfoLevel)

	obs := zap.New(observer)
	fields := map[string]interface{}{
		"key2":    "value2",
		"key3":    3,
		"runtime": "foo", // Should not be added to fields
	}

	logger1 := NewRuntimeGoLogger(obs).WithField("key1", "value1")

	assert.Equal(t, "value1", logger1.Fields()["key1"])
	_, contains := logger1.Fields()["runtime"]
	assert.False(t, contains)

	logger2 := logger1.WithFields(fields)

	assert.Equal(t, "value1", logger2.Fields()["key1"])
	assert.Equal(t, "value2", logger2.Fields()["key2"])
	assert.Equal(t, 3, logger2.Fields()["key3"])
	_, contains = logger2.Fields()["runtime"]
	assert.False(t, contains)
}
