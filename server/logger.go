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
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	lumberjack "gopkg.in/natefinch/lumberjack.v2"
)

type LoggingFormat int8

const (
	JSONFormat LoggingFormat = iota - 1
	StackdriverFormat
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

	format := JSONFormat
	switch strings.ToLower(config.GetLogger().Format) {
	case "":
		fallthrough
	case "json":
		format = JSONFormat
	case "stackdriver":
		format = StackdriverFormat
	default:
		tmpLogger.Fatal("Logger mode invalid, must be one of: '', 'json', or 'stackdriver")
	}

	consoleLogger := NewJSONLogger(os.Stdout, zapLevel, format)
	var fileLogger *zap.Logger
	if config.GetLogger().Rotation {
		fileLogger = NewRotatingJSONFileLogger(consoleLogger, config, zapLevel, format)
	} else {
		fileLogger = NewJSONFileLogger(consoleLogger, config.GetLogger().File, zapLevel, format)
	}

	if fileLogger != nil {
		multiLogger := NewMultiLogger(consoleLogger, fileLogger)

		if config.GetLogger().Stdout {
			RedirectStdLog(multiLogger)
			return multiLogger, multiLogger
		}
		RedirectStdLog(fileLogger)
		return fileLogger, multiLogger
	}

	RedirectStdLog(consoleLogger)
	return consoleLogger, consoleLogger
}

func NewJSONFileLogger(consoleLogger *zap.Logger, fileName string, level zapcore.Level, format LoggingFormat) *zap.Logger {
	if len(fileName) == 0 {
		return nil
	}

	output, err := os.OpenFile(fileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0666)
	if err != nil {
		consoleLogger.Fatal("Could not create log file", zap.Error(err))
		return nil
	}

	return NewJSONLogger(output, level, format)
}

func NewRotatingJSONFileLogger(consoleLogger *zap.Logger, config Config, level zapcore.Level, format LoggingFormat) *zap.Logger {
	fileName := config.GetLogger().File
	if len(fileName) == 0 {
		consoleLogger.Fatal("Rotating log file is enabled but log file name is empty")
		return nil
	}

	logDir := filepath.Dir(fileName)
	if _, err := os.Stat(logDir); os.IsNotExist(err) {
		if err := os.MkdirAll(logDir, 0755); err != nil {
			consoleLogger.Fatal("Could not create log directory", zap.Error(err))
			return nil
		}
	}

	jsonEncoder := newJSONEncoder(format)

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
	options := []zap.Option{zap.AddCaller()}
	return zap.New(core, options...)
}

func NewMultiLogger(loggers ...*zap.Logger) *zap.Logger {
	cores := make([]zapcore.Core, 0, len(loggers))
	for _, logger := range loggers {
		cores = append(cores, logger.Core())
	}

	teeCore := zapcore.NewTee(cores...)
	options := []zap.Option{zap.AddCaller()}
	return zap.New(teeCore, options...)
}

func NewJSONLogger(output *os.File, level zapcore.Level, format LoggingFormat) *zap.Logger {
	jsonEncoder := newJSONEncoder(format)

	core := zapcore.NewCore(jsonEncoder, zapcore.Lock(output), level)
	options := []zap.Option{zap.AddCaller()}
	return zap.New(core, options...)
}

// Create a new JSON log encoder with the correct settings.
func newJSONEncoder(format LoggingFormat) zapcore.Encoder {
	if format == StackdriverFormat {
		return zapcore.NewJSONEncoder(zapcore.EncoderConfig{
			TimeKey:        "time",
			LevelKey:       "severity",
			NameKey:        "logger",
			CallerKey:      "caller",
			MessageKey:     "message",
			StacktraceKey:  "stacktrace",
			EncodeLevel:    StackdriverLevelEncoder,
			EncodeTime:     zapcore.RFC3339NanoTimeEncoder,
			EncodeDuration: zapcore.StringDurationEncoder,
			EncodeCaller:   zapcore.ShortCallerEncoder,
		})
	}

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

func StackdriverLevelEncoder(l zapcore.Level, enc zapcore.PrimitiveArrayEncoder) {
	switch l {
	case zapcore.DebugLevel:
		enc.AppendString("DEBUG")
	case zapcore.InfoLevel:
		enc.AppendString("INFO")
	case zapcore.WarnLevel:
		enc.AppendString("WARNING")
	case zapcore.ErrorLevel:
		enc.AppendString("ERROR")
	case zapcore.DPanicLevel:
		enc.AppendString("CRITICAL")
	case zapcore.PanicLevel:
		enc.AppendString("CRITICAL")
	case zapcore.FatalLevel:
		enc.AppendString("CRITICAL")
	default:
		enc.AppendString("DEFAULT")
	}
}

type RedirectStdLogWriter struct {
	logger *zap.Logger
}

func (r *RedirectStdLogWriter) Write(p []byte) (int, error) {
	s := string(bytes.TrimSpace(p))
	if strings.HasPrefix(s, "http: panic serving") {
		r.logger.Error(s)
	} else {
		r.logger.Info(s)
	}
	return len(s), nil
}

func RedirectStdLog(logger *zap.Logger) {
	log.SetFlags(0)
	log.SetPrefix("")
	skipLogger := logger.WithOptions(zap.AddCallerSkip(3))
	log.SetOutput(&RedirectStdLogWriter{skipLogger})
}

type grpcCustomLogger struct {
	*zap.SugaredLogger
}

// GRPC custom logger defaults to Error level, unless the logger level is higher.
// https://github.com/grpc/grpc-go/blob/master/grpclog/loggerv2.go
func NewGrpcCustomLogger(logger *zap.Logger) (grpcCustomLogger, error) {
	level := zap.NewAtomicLevelAt(logger.Level())
	if logger.Level() <= zap.ErrorLevel {
		level = zap.NewAtomicLevelAt(zap.ErrorLevel)
	}
	errLogger, err := zapcore.NewIncreaseLevelCore(logger.Core(), level)
	if err != nil {
		logger.Error("failed to set grpc error level logger", zap.Error(err))
		return grpcCustomLogger{}, err
	}

	newLevelLoggerOption := zap.WrapCore(func(zapcore.Core) zapcore.Core {
		return errLogger
	})

	sLogger := logger.WithOptions(newLevelLoggerOption)
	grpcLogger := sLogger.Sugar()

	return grpcCustomLogger{
		grpcLogger,
	}, nil
}

func (g grpcCustomLogger) Warning(args ...any) {
	g.Warn(args...)
}

func (g grpcCustomLogger) Warningln(args ...any) {
	g.Warnln(args...)
}

func (g grpcCustomLogger) Warningf(format string, args ...any) {
	g.Warnf(format, args...)
}

func (g grpcCustomLogger) V(l int) bool {
	return int(g.Level()) <= l
}
