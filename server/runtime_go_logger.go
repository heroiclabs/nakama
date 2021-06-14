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
	"runtime"
	"strings"

	nkruntime "github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
)

type RuntimeGoLogger struct {
	logger *zap.Logger
	fields map[string]interface{}
}

func NewRuntimeGoLogger(logger *zap.Logger) nkruntime.Logger {
	return &RuntimeGoLogger{
		fields: make(map[string]interface{}),
		logger: logger.WithOptions(zap.AddCallerSkip(1)).With(zap.String("runtime", "go")),
	}
}

func (l *RuntimeGoLogger) getFileLine() zap.Field {
	_, filename, line, ok := runtime.Caller(2)
	if !ok {
		return zap.Skip()
	}
	filenameSplit := strings.SplitN(filename, "@", 2)
	if len(filenameSplit) >= 2 {
		filename = filenameSplit[1]
	}
	return zap.String("source", fmt.Sprintf("%v:%v", filename, line))
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
		l.logger.Warn(msg, l.getFileLine())
	}
}

func (l *RuntimeGoLogger) Error(format string, v ...interface{}) {
	if l.logger.Core().Enabled(zap.ErrorLevel) {
		msg := fmt.Sprintf(format, v...)
		l.logger.Error(msg, l.getFileLine())
	}
}

func (l *RuntimeGoLogger) WithField(key string, v interface{}) nkruntime.Logger {
	return l.WithFields(map[string]interface{}{key: v})
}

func (l *RuntimeGoLogger) WithFields(fields map[string]interface{}) nkruntime.Logger {
	f := make([]zap.Field, 0, len(fields)+len(l.fields))
	newFields := make(map[string]interface{}, len(fields)+len(l.fields))
	for k, v := range l.fields {
		newFields[k] = v
	}
	for k, v := range fields {
		if k == "runtime" {
			continue
		}
		newFields[k] = v
		f = append(f, zap.Any(k, v))
	}

	return &RuntimeGoLogger{
		logger: l.logger.With(f...),
		fields: newFields,
	}
}

func (l *RuntimeGoLogger) Fields() map[string]interface{} {
	return l.fields
}
