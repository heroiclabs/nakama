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
	"errors"
	"fmt"

	"github.com/dop251/goja"
	"go.uber.org/zap"
)

type jsLogger struct {
	logger *zap.Logger
}

func NewJsLogger(r *goja.Runtime, logger *zap.Logger, fields ...zap.Field) (goja.Value, error) {
	l := &jsLogger{logger: logger.With(fields...)}
	jsl, err := l.Constructor(r)
	if err != nil {
		return nil, err
	}
	return jsl, nil
}

func (l *jsLogger) Constructor(r *goja.Runtime) (*goja.Object, error) {
	getArgs := func(values []goja.Value) (string, []interface{}, error) {
		format, ok := values[0].Export().(string)
		if !ok {
			return "", nil, errors.New("invalid format argument: must be a string")
		}
		args := make([]interface{}, 0, len(values)-1)
		for _, v := range values[1:] {
			args = append(args, v.Export())
		}
		return format, args, nil
	}

	toLoggerFields := func(m map[string]interface{}) []zap.Field {
		zFields := make([]zap.Field, 0, len(m))
		for k, v := range m {
			zFields = append(zFields, zap.Any(k, v))
		}
		return zFields
	}

	constructor := func(call goja.ConstructorCall) *goja.Object {
		var argFields goja.Value
		if len(call.Arguments) > 0 {
			argFields = call.Arguments[0]
		} else {
			argFields = r.NewObject()
		}
		_ = call.This.Set("fields", argFields)

		_ = call.This.Set("info", func(f goja.FunctionCall) goja.Value {
			format, a, err := getArgs(f.Arguments)
			if err != nil {
				panic(r.NewTypeError(err.Error()))
			}
			fields := call.This.Get("fields").Export().(map[string]interface{})
			l.logger.Info(fmt.Sprintf(format, a...), toLoggerFields(fields)...)
			return nil
		})

		_ = call.This.Set("warn", func(f goja.FunctionCall) goja.Value {
			format, a, err := getArgs(f.Arguments)
			if err != nil {
				panic(r.NewTypeError(err.Error()))
			}
			fields := call.This.Get("fields").Export().(map[string]interface{})
			l.logger.Warn(fmt.Sprintf(format, a...), toLoggerFields(fields)...)
			return nil
		})

		_ = call.This.Set("error", func(f goja.FunctionCall) goja.Value {
			format, a, err := getArgs(f.Arguments)
			if err != nil {
				panic(r.NewTypeError(err.Error()))
			}
			fields := call.This.Get("fields").Export().(map[string]interface{})
			l.logger.Error(fmt.Sprintf(format, a...), toLoggerFields(fields)...)
			return nil
		})

		_ = call.This.Set("debug", func(f goja.FunctionCall) goja.Value {
			format, a, err := getArgs(f.Arguments)
			if err != nil {
				panic(r.NewTypeError(err.Error()))
			}
			fields := call.This.Get("fields").Export().(map[string]interface{})
			l.logger.Debug(fmt.Sprintf(format, a...), toLoggerFields(fields)...)
			return nil
		})

		_ = call.This.Set("withField", func(f goja.FunctionCall) goja.Value {
			key, ok := f.Arguments[0].Export().(string)
			if !ok {
				panic(r.NewTypeError("key argument must be a string"))
			}
			value, ok := f.Arguments[1].Export().(string)
			if !ok {
				panic(r.NewTypeError("value argument must be a string"))
			}

			fields := call.This.Get("fields").Export().(map[string]interface{})
			fields[key] = value

			c := r.ToValue(call.This.Get("constructor"))
			objInst, err := r.New(c, r.ToValue(fields))
			if err != nil {
				panic(r.NewGoError(err))
			}

			return objInst
		})

		_ = call.This.Set("withFields", func(f goja.FunctionCall) goja.Value {
			argMap, ok := f.Arguments[0].Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("argument must be a map"))
			}

			fields := call.This.Get("fields").Export().(map[string]interface{})
			for k, v := range argMap {
				fields[k] = v
			}

			c := r.ToValue(call.This.Get("constructor"))
			objInst, err := r.New(c, r.ToValue(fields))
			if err != nil {
				panic(r.NewGoError(err))
			}

			return objInst
		})
		_ = call.This.Set("getFields", func(f goja.FunctionCall) goja.Value {
			return call.This.Get("fields")
		})

		freeze(call.This)

		return nil
	}

	return r.New(r.ToValue(constructor))
}

// Disallows resetting or changing the properties of the object
func freeze(o *goja.Object) {
	for _, key := range o.Keys() {
		_ = o.DefineDataProperty(key, o.Get(key), goja.FLAG_FALSE, goja.FLAG_FALSE, goja.FLAG_TRUE)
	}
}
