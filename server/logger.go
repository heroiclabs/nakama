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

package server

import (
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
	"strings"
)

func SetupLogging(tmpLogger *zap.Logger, config Config) (*zap.Logger, *zap.Logger) {
	zapLevel := zapcore.InfoLevel
	switch strings.ToLower(config.GetLogger().Level) {
	case "debug":
		zapLevel = zapcore.DebugLevel
	case "info":
		zapLevel = zapcore.InfoLevel
	case "warn":
		zapLevel = zapcore.WarnLevel
	case "error":
		zapLevel = zapcore.ErrorLevel
	default:
		tmpLogger.Fatal("Logger level invalid, must be one of: DEBUG, INFO, WARN, or ERROR")
	}

	consoleLogger := NewJSONLogger(os.Stdout, zapLevel)
	var fileLogger *zap.Logger
	if config.GetLogger().Rotation {
		fileLogger = NewRotatingJSONFileLogger(consoleLogger, config, zapLevel)
	} else {
		fileLogger = NewJSONFileLogger(consoleLogger, config.GetLogger().File, zapLevel)
	}

	if fileLogger != nil {
		multiLogger := NewMultiLogger(consoleLogger, fileLogger)

		if config.GetLogger().Stdout {
			zap.RedirectStdLog(multiLogger)
			return multiLogger, multiLogger
		} else {
			zap.RedirectStdLog(fileLogger)
			return fileLogger, multiLogger
		}
	}

	zap.RedirectStdLog(consoleLogger)
	return consoleLogger, consoleLogger
}

func NewJSONFileLogger(consoleLogger *zap.Logger, fileName string, level zapcore.Level) *zap.Logger {
	if len(fileName) == 0 {
		return nil
	}

	output, err := os.OpenFile(fileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0666)
	if err != nil {
		consoleLogger.Fatal("Could not create log file", zap.Error(err))
		return nil
	}

	return NewJSONLogger(output, level)
}

func NewRotatingJSONFileLogger(consoleLogger *zap.Logger, config Config, level zapcore.Level) *zap.Logger {
	fileName := config.GetLogger().File
	if len(fileName) == 0 {
		consoleLogger.Fatal("Rotating log file is enabled but log file name is empty")
		return nil
	}
	if err := os.MkdirAll(fileName, 0755); err != nil {
		consoleLogger.Fatal("Could not create log directory", zap.Error(err))
		return nil
	}

	jsonEncoder := newJSONEncoder()

	// lumberjack.Logger is already safe for concurrent use, so we don't need to lock it.
	writeSyncer := zapcore.AddSync(&lumberjack.Logger{
		Filename:   fileName,
		MaxSize:    config.GetLogger().MaxSize,
		MaxAge:     config.GetLogger().MaxAge,
		MaxBackups: config.GetLogger().MaxBackups,
		LocalTime:  config.GetLogger().LocalTime,
		Compress:   config.GetLogger().Compress,
	})
	core := zapcore.NewCore(jsonEncoder, writeSyncer, level)
	options := []zap.Option{zap.AddStacktrace(zap.ErrorLevel)}
	return zap.New(core, options...)
}

func NewMultiLogger(loggers ...*zap.Logger) *zap.Logger {
	cores := make([]zapcore.Core, 0, len(loggers))
	for _, logger := range loggers {
		cores = append(cores, logger.Core())
	}

	teeCore := zapcore.NewTee(cores...)
	options := []zap.Option{zap.AddStacktrace(zap.ErrorLevel)}
	return zap.New(teeCore, options...)
}

func NewJSONLogger(output *os.File, level zapcore.Level) *zap.Logger {
	jsonEncoder := newJSONEncoder()

	core := zapcore.NewCore(jsonEncoder, zapcore.Lock(output), level)
	options := []zap.Option{zap.AddStacktrace(zap.ErrorLevel)}
	return zap.New(core, options...)
}

// Create a new JSON log encoder with the correct settings.
func newJSONEncoder() zapcore.Encoder {
	return zapcore.NewJSONEncoder(zapcore.EncoderConfig{
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
}
