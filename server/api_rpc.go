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
	"net"
	"strings"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama/api"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
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

	queryParams := make(map[string][]string, 0)
	if md, ok := metadata.FromIncomingContext(ctx); !ok {
		return nil, status.Error(codes.Internal, "RPC function could not get incoming context")
	} else {
		for k, vs := range md {
			// Only process the keys representing custom query parameters.
			if strings.HasPrefix(k, "q_") {
				queryParams[k[2:]] = vs
			}
		}
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

	clientAddr := ""
	clientIP := ""
	clientPort := ""
	md, _ := metadata.FromIncomingContext(ctx)
	if ips := md.Get("x-forwarded-for"); len(ips) > 0 {
		// look for gRPC-Gateway / LB header
		clientAddr = strings.Split(ips[0], ",")[0]
	} else if peerInfo, ok := peer.FromContext(ctx); ok {
		// if missing, try to look up gRPC peer info
		clientAddr = peerInfo.Addr.String()
	}

	clientAddr = strings.TrimSpace(clientAddr)
	if host, port, err := net.SplitHostPort(clientAddr); err == nil {
		clientIP = host
		clientPort = port
	} else if addrErr, ok := err.(*net.AddrError); ok && addrErr.Err == "missing port in address" {
		clientIP = clientAddr
	} else {
		s.logger.Debug("Could not extract client address from request.", zap.Error(err))
	}

	result, fnErr, code := runtime.InvokeFunction(ExecutionModeRPC, lf, queryParams, uid, username, expiry, "", clientIP, clientPort, in.Payload)
	s.runtimePool.Put(runtime)

	if fnErr != nil {
		s.logger.Error("Runtime RPC function caused an error", zap.String("id", in.Id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !s.logger.Core().Enabled(zapcore.InfoLevel) {
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
