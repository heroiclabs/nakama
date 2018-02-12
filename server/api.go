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
	"crypto"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/dgrijalva/jwt-go"
	"github.com/golang/protobuf/jsonpb"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	"github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/heroiclabs/nakama/api"
	"github.com/satori/go.uuid"
	ocgrpc "go.opencensus.io/plugin/grpc"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	_ "google.golang.org/grpc/encoding/gzip" // enable gzip compression on server for grpc
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// Keys used for storing/retrieving user information in the context of a request after authentication.
type ctxUserIDKey struct{}
type ctxUsernameKey struct{}
type ctxExpiryKey struct{}

type ApiServer struct {
	logger            *zap.Logger
	db                *sql.DB
	config            Config
	runtimePool       *RuntimePool
	grpcServer        *grpc.Server
	grpcGatewayServer *http.Server
}

func StartApiServer(logger *zap.Logger, db *sql.DB, config Config, registry *SessionRegistry, tracker Tracker, pipeline *pipeline, runtimePool *RuntimePool, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler) *ApiServer {
	grpcServer := grpc.NewServer(
		grpc.StatsHandler(ocgrpc.NewServerStatsHandler()),
		grpc.UnaryInterceptor(SecurityInterceptorFunc(logger, config)),
	)

	s := &ApiServer{
		logger:      logger,
		db:          db,
		config:      config,
		runtimePool: runtimePool,
		grpcServer:  grpcServer,
	}

	// Register and start GRPC server.
	api.RegisterNakamaServer(grpcServer, s)
	go func() {
		listener, err := net.Listen("tcp", fmt.Sprintf(":%d", config.GetSocket().Port))
		if err != nil {
			logger.Fatal("API Server listener failed to start", zap.Error(err))
		}

		if err := grpcServer.Serve(listener); err != nil {
			logger.Fatal("API Server listener failed", zap.Error(err))
		}
	}()

	// Register and start GRPC Gateway server.
	// Should start after GRPC server itself because RegisterNakamaHandlerFromEndpoint below tries to dial GRPC.
	ctx := context.Background()
	grpcGateway := runtime.NewServeMux()
	dialAddr := fmt.Sprintf("127.0.0.1:%d", config.GetSocket().Port)
	opts := []grpc.DialOption{grpc.WithInsecure()}
	if err := api.RegisterNakamaHandlerFromEndpoint(ctx, grpcGateway, dialAddr, opts); err != nil {
		logger.Fatal("API Server gateway registration failed", zap.Error(err))
	}

	CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})

	grpcGatewayRouter := mux.NewRouter()
	grpcGatewayRouter.HandleFunc("/ws", NewSocketWsAcceptor(logger, config, registry, tracker, jsonpbMarshaler, jsonpbUnmarshaler, pipeline.processRequest))
	// TODO restore when admin endpoints are available.
	// grpcGatewayRouter.HandleFunc("/metrics", zpages.RpczHandler)
	// grpcGatewayRouter.HandleFunc("/trace", zpages.TracezHandler)
	grpcGatewayRouter.NewRoute().Handler(grpcGateway)

	handlerWithGzip := handlers.CompressHandler(grpcGatewayRouter)
	handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins)(handlerWithGzip)
	s.grpcGatewayServer = &http.Server{
		Addr:    fmt.Sprintf(":%d", config.GetSocket().Port+1),
		Handler: handlerWithCORS,
	}
	go func() {
		if err := s.grpcGatewayServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("API Server gateway listener failed", zap.Error(err))
		}
	}()

	return s
}

func (s *ApiServer) Stop() {
	// 1. Stop GRPC Gateway server first as it sits above GRPC server.
	if err := s.grpcGatewayServer.Shutdown(context.Background()); err != nil {
		s.logger.Error("API Server gateway listener shutdown failed", zap.Error(err))
	}
	// 2. Stop GRPC server.
	s.grpcServer.GracefulStop()
}

func (s *ApiServer) Healthcheck(ctx context.Context, in *empty.Empty) (*empty.Empty, error) {
	return &empty.Empty{}, nil
}

func SecurityInterceptorFunc(logger *zap.Logger, config Config) func(context.Context, interface{}, *grpc.UnaryServerInfo, grpc.UnaryHandler) (interface{}, error) {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		logger.Debug("Security interceptor fired", zap.Any("ctx", ctx), zap.Any("req", req), zap.Any("info", info))
		switch info.FullMethod {
		case "/nakama.api.Nakama/Healthcheck":
			// Healthcheck has no security.
			return handler(ctx, req)
		case "/nakama.api.Nakama/AuthenticateCustom":
			fallthrough
		case "/nakama.api.Nakama/AuthenticateDevice":
			fallthrough
		case "/nakama.api.Nakama/AuthenticateEmail":
			fallthrough
		case "/nakama.api.Nakama/AuthenticateFacebook":
			fallthrough
		case "/nakama.api.Nakama/AuthenticateGameCenter":
			fallthrough
		case "/nakama.api.Nakama/AuthenticateGoogle":
			fallthrough
		case "/nakama.api.Nakama/AuthenticateSteam":
			// Authentication functions require Server key.
			md, ok := metadata.FromIncomingContext(ctx)
			if !ok {
				logger.Error("Cannot extract metadata from incoming context")
				return nil, status.Error(codes.FailedPrecondition, "Cannot extract metadata from incoming context")
			}
			auth, ok := md["authorization"]
			if !ok {
				auth, ok = md["grpcgateway-authorization"]
			}
			if !ok {
				// Neither "authorization" nor "grpc-authorization" were supplied.
				return nil, status.Error(codes.Unauthenticated, "Server key required")
			}
			if len(auth) != 1 {
				// Value of "authorization" or "grpc-authorization" was empty or repeated.
				return nil, status.Error(codes.Unauthenticated, "Server key required")
			}
			username, _, ok := ParseBasicAuth(auth[0])
			if !ok {
				// Value of "authorization" or "grpc-authorization" was malformed.
				return nil, status.Error(codes.Unauthenticated, "Server key invalid")
			}
			if username != config.GetSocket().ServerKey {
				// Value of "authorization" or "grpc-authorization" username component did not match server key.
				return nil, status.Error(codes.Unauthenticated, "Server key invalid")
			}
		case "/nakama.api.Nakama/RpcFunc":
			// RPC allows full user authentication or HTTP key authentication.
			md, ok := metadata.FromIncomingContext(ctx)
			if !ok {
				logger.Error("Cannot extract metadata from incoming context")
				return nil, status.Error(codes.FailedPrecondition, "Cannot extract metadata from incoming context")
			}
			auth, ok := md["authorization"]
			if !ok {
				auth, ok = md["grpcgateway-authorization"]
			}
			if !ok {
				// Neither "authorization" nor "grpc-authorization" were supplied. Try to validate HTTP key instead.
				in, ok := req.(*api.Rpc)
				if !ok {
					logger.Error("Cannot extract Rpc from incoming request")
					return nil, status.Error(codes.FailedPrecondition, "Auth token or HTTP key required")
				}
				if in.HttpKey == nil {
					// HTTP key not present.
					return nil, status.Error(codes.Unauthenticated, "Auth token or HTTP key required")
				}
				if in.HttpKey.Value != config.GetRuntime().HTTPKey {
					// Value of HTTP key username component did not match.
					return nil, status.Error(codes.Unauthenticated, "HTTP key invalid")
				}
				return handler(ctx, req)
			}
			if len(auth) != 1 {
				// Value of "authorization" or "grpc-authorization" was empty or repeated.
				return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
			}
			userID, username, exp, ok := ParseBearerAuth([]byte(config.GetSession().EncryptionKey), auth[0])
			if !ok {
				// Value of "authorization" or "grpc-authorization" was malformed or expired.
				return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
			}
			ctx = context.WithValue(context.WithValue(context.WithValue(ctx, ctxUserIDKey{}, userID), ctxUsernameKey{}, username), ctxExpiryKey{}, exp)
		default:
			// Unless explicitly defined above, handlers require full user authentication.
			md, ok := metadata.FromIncomingContext(ctx)
			if !ok {
				logger.Error("Cannot extract metadata from incoming context")
				return nil, status.Error(codes.FailedPrecondition, "Cannot extract metadata from incoming context")
			}
			auth, ok := md["authorization"]
			if !ok {
				auth, ok = md["grpcgateway-authorization"]
			}
			if !ok {
				// Neither "authorization" nor "grpc-authorization" were supplied.
				return nil, status.Error(codes.Unauthenticated, "Auth token required")
			}
			if len(auth) != 1 {
				// Value of "authorization" or "grpc-authorization" was empty or repeated.
				return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
			}
			userID, username, exp, ok := ParseBearerAuth([]byte(config.GetSession().EncryptionKey), auth[0])
			if !ok {
				// Value of "authorization" or "grpc-authorization" was malformed or expired.
				return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
			}
			ctx = context.WithValue(context.WithValue(context.WithValue(ctx, ctxUserIDKey{}, userID), ctxUsernameKey{}, username), ctxExpiryKey{}, exp)
		}
		return handler(ctx, req)
	}
}

func ParseBasicAuth(auth string) (username, password string, ok bool) {
	if auth == "" {
		return
	}
	const prefix = "Basic "
	if !strings.HasPrefix(auth, prefix) {
		return
	}
	c, err := base64.StdEncoding.DecodeString(auth[len(prefix):])
	if err != nil {
		return
	}
	cs := string(c)
	s := strings.IndexByte(cs, ':')
	if s < 0 {
		return
	}
	return cs[:s], cs[s+1:], true
}

func ParseBearerAuth(hmacSecretByte []byte, auth string) (userID uuid.UUID, username string, exp int64, ok bool) {
	if auth == "" {
		return
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return
	}
	return ParseToken(hmacSecretByte, string(auth[len(prefix):]))
}

func ParseToken(hmacSecretByte []byte, tokenString string) (userID uuid.UUID, username string, exp int64, ok bool) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return hmacSecretByte, nil
	})
	if err != nil {
		return
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return
	}
	userID, err = uuid.FromString(claims["uid"].(string))
	if err != nil {
		return
	}
	return userID, claims["usn"].(string), int64(claims["exp"].(float64)), true
}
