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
	"golang.org/x/net/context"
	"github.com/heroiclabs/nakama/api"
	"go.uber.org/zap"
	"strings"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"github.com/yuin/gopher-lua"
	"github.com/satori/go.uuid"
	"github.com/golang/protobuf/ptypes/wrappers"
)

func (s *ApiServer) RpcFunc(ctx context.Context, in *api.Rpc) (*api.Rpc, error) {
	if in.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "RPC ID must be set")
	}

	id := strings.ToLower(in.Id)

	if !s.runtimePool.HasRPC(id) {
		return nil, status.Error(codes.NotFound, "RPC function not found")
	}

	runtime := s.runtimePool.Get()
	lf := runtime.GetRuntimeCallback(RPC, id)
	if lf == nil {
		s.runtimePool.Put(runtime)
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

	result, fnErr := runtime.InvokeFunctionRPC(lf, uid, username, expiry, "", in.Payload.Value)
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
			return nil, status.Error(codes.Aborted, msg)
		} else {
			return nil, status.Error(codes.Aborted, fnErr.Error())
		}
	}

	return &api.Rpc{Payload: &wrappers.StringValue{Value: result}}, nil
}
