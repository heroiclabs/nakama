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
	"fmt"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
)

type RuntimeGoLogger struct {
	logger *zap.Logger
}

func NewRuntimeGoLogger(logger *zap.Logger) runtime.Logger {
	return &RuntimeGoLogger{
		logger: logger,
	}
}

func (l *RuntimeGoLogger) Debug(format string, v ...interface{}) {
	if l.logger.Core().Enabled(zap.DebugLevel) {
		msg := fmt.Sprintf(format, v...)
		l.logger.Debug(msg)
	}
}

func (l *RuntimeGoLogger) Info(format string, v ...interface{}) {
	if l.logger.Core().Enabled(zap.InfoLevel) {
		msg := fmt.Sprintf(format, v...)
		l.logger.Info(msg)
	}
}

func (l *RuntimeGoLogger) Warn(format string, v ...interface{}) {
	if l.logger.Core().Enabled(zap.WarnLevel) {
		msg := fmt.Sprintf(format, v...)
		l.logger.Warn(msg)
	}
}

func (l *RuntimeGoLogger) Error(format string, v ...interface{}) {
	if l.logger.Core().Enabled(zap.ErrorLevel) {
		msg := fmt.Sprintf(format, v...)
		l.logger.Error(msg)
	}
}

func (l *RuntimeGoLogger) Print(v ...interface{}) {
	if l.logger.Core().Enabled(zap.InfoLevel) {
		msg := fmt.Sprint(v...)
		l.logger.Info(msg)
	}
}

func (l *RuntimeGoLogger) Println(v ...interface{}) {
	if l.logger.Core().Enabled(zap.InfoLevel) {
		msg := fmt.Sprintln(v...)
		l.logger.Info(msg)
	}
}

func (l *RuntimeGoLogger) Printf(format string, v ...interface{}) {
	if l.logger.Core().Enabled(zap.InfoLevel) {
		msg := fmt.Sprintf(format, v...)
		l.logger.Info(msg)
	}
}

func (l *RuntimeGoLogger) Fatal(v ...interface{}) {
	if l.logger.Core().Enabled(zap.FatalLevel) {
		msg := fmt.Sprint(v...)
		l.logger.Fatal(msg)
	}
}

func (l *RuntimeGoLogger) Fatalln(v ...interface{}) {
	if l.logger.Core().Enabled(zap.FatalLevel) {
		msg := fmt.Sprintln(v...)
		l.logger.Fatal(msg)
	}
}

func (l *RuntimeGoLogger) Fatalf(format string, v ...interface{}) {
	if l.logger.Core().Enabled(zap.FatalLevel) {
		msg := fmt.Sprintf(format, v...)
		l.logger.Fatal(msg)
	}
}

func (l *RuntimeGoLogger) Panic(v ...interface{}) {
	if l.logger.Core().Enabled(zap.PanicLevel) {
		msg := fmt.Sprint(v...)
		l.logger.Panic(msg)
	}
}

func (l *RuntimeGoLogger) Panicln(v ...interface{}) {
	if l.logger.Core().Enabled(zap.PanicLevel) {
		msg := fmt.Sprintln(v...)
		l.logger.Panic(msg)
	}
}

func (l *RuntimeGoLogger) Panicf(format string, v ...interface{}) {
	if l.logger.Core().Enabled(zap.PanicLevel) {
		msg := fmt.Sprintf(format, v...)
		l.logger.Panic(msg)
	}
}
