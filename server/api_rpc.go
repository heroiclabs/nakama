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
	"strings"

	"github.com/heroiclabs/nakama/api"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) RpcFunc(ctx context.Context, in *api.Rpc) (*api.Rpc, error) {
	if in.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "RPC ID must be set")
	}

	id := strings.ToLower(in.Id)

	if !s.runtimePool.HasCallback(ExecutionModeRPC, id) {
		return nil, status.Error(codes.NotFound, "RPC function not found")
	}

	uid := ""
	username := ""
	expiry := int64(0)
	if u := ctx.Value(ctxUserIDKey{}); u != nil {
		uid = u.(uuid.UUID).String()
	}
	if u := ctx.Value(ctxUsernameKey{}); u != nil {
		username = u.(string)
	}
	if e := ctx.Value(ctxExpiryKey{}); e != nil {
		expiry = e.(int64)
	}

	runtime := s.runtimePool.Get()
	lf := runtime.GetCallback(ExecutionModeRPC, id)
	if lf == nil {
		s.runtimePool.Put(runtime)
		return nil, status.Error(codes.NotFound, "RPC function not found")
	}

	result, fnErr, code := runtime.InvokeFunction(ExecutionModeRPC, lf, uid, username, expiry, "", in.Payload)
	s.runtimePool.Put(runtime)

	if fnErr != nil {
		s.logger.Error("Runtime RPC function caused an error", zap.String("id", in.Id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !s.config.GetLog().Verbose {
			msg := apiErr.Object.String()
			if strings.HasPrefix(msg, lf.Proto.SourceName) {
				msg = msg[len(lf.Proto.SourceName):]
				msgParts := strings.SplitN(msg, ": ", 2)
				if len(msgParts) == 2 {
					msg = msgParts[1]
				} else {
					msg = msgParts[0]
				}
			}
			return nil, status.Error(code, msg)
		} else {
			return nil, status.Error(code, fnErr.Error())
		}
	}

	if result == nil {
		return &api.Rpc{}, nil
	}

	if payload, ok := result.(string); !ok {
		s.logger.Warn("Runtime function returned invalid data", zap.Any("result", result))
		return nil, status.Error(codes.Internal, "Runtime function returned invalid data - only allowed one return value of type String/Byte.")
	} else {
		return &api.Rpc{Payload: payload}, nil
	}
}
