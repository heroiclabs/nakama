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
	"os"

	"fmt"
	"path/filepath"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// By default, log all messages with Warn and Error messages to a log file inside Data/Log/<name>.log file. The content will be in JSON.
// if --verbose is passed, log messages with Debug and higher levels.
// if --logtostdout is passed, logs are only printed to stdout.
// In all cases, Error messages trigger the stacktrace to be dumped as well.
var (
	VerboseLogging = true
	StdoutLogging  = false
)

type loggerEnabler struct{}

func (l *loggerEnabler) Enabled(level zapcore.Level) bool {
	return VerboseLogging || level > zapcore.DebugLevel
}

func NewLogger(consoleLogger *zap.Logger, config Config) *zap.Logger {
	output := os.Stdout
	if !StdoutLogging {
		err := os.MkdirAll(filepath.FromSlash(config.GetDataDir()+"/log"), 0755)
		if err != nil {
			consoleLogger.Fatal("Could not create log directory", zap.Error(err))
			return nil
		}

		output, err = os.Create(filepath.FromSlash(fmt.Sprintf("%v/log/%v.log", config.GetDataDir(), config.GetName())))
		if err != nil {
			consoleLogger.Fatal("Could not create log file", zap.Error(err))
			return nil
		}
	}

	logger := NewJSONLogger(output)
	logger = logger.With(zap.String("server", config.GetName()))

	return logger
}

func NewConsoleLogger(output *os.File) *zap.Logger {
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

func NewJSONLogger(output *os.File) *zap.Logger {
	jsonEncoder := zapcore.NewJSONEncoder(zapcore.EncoderConfig{
		TimeKey:        "ts",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		MessageKey:     "msg",
		StacktraceKey:  "stacktrace",
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.StringDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	})

	core := zapcore.NewCore(jsonEncoder, output, &loggerEnabler{})
	options := []zap.Option{zap.AddStacktrace(zap.ErrorLevel)}

	return zap.New(core, options...)
}

func NewMultiLogger(loggers ...*zap.Logger) *zap.Logger {
	cores := []zapcore.Core{}
	for _, logger := range loggers {
		cores = append(cores, logger.Core())
	}

	teeCore := zapcore.NewTee(cores...)
	options := []zap.Option{zap.AddStacktrace(zap.ErrorLevel)}
	return zap.New(teeCore, options...)
}
