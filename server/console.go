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
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	"github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/heroiclabs/nakama/console"
	"go.opencensus.io/plugin/ocgrpc"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type ConsoleServer struct {
	logger            *zap.Logger
	db                *sql.DB
	config            Config
	grpcServer        *grpc.Server
	grpcGatewayServer *http.Server
}

func StartConsoleServer(logger *zap.Logger, multiLogger *zap.Logger, config Config, db *sql.DB) *ConsoleServer {
	serverOpts := []grpc.ServerOption{
		grpc.StatsHandler(&ocgrpc.ServerHandler{IsPublicEndpoint: true}),
		grpc.MaxRecvMsgSize(int(config.GetSocket().MaxMessageSizeBytes)),
		grpc.UnaryInterceptor(consoleInterceptorFunc(logger, config)),
	}
	grpcServer := grpc.NewServer(serverOpts...)

	s := &ConsoleServer{
		logger:     logger,
		db:         db,
		config:     config,
		grpcServer: grpcServer,
	}

	console.RegisterConsoleServer(grpcServer, s)
	multiLogger.Info("Starting Console server for gRPC requests", zap.Int("port", config.GetSocket().Port-2))
	go func() {
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", config.GetSocket().Port-2))
		if err != nil {
			multiLogger.Fatal("Console server listener failed to start", zap.Error(err))
		}

		if err := grpcServer.Serve(listener); err != nil {
			multiLogger.Fatal("Console server listener failed", zap.Error(err))
		}
	}()

	ctx := context.Background()
	grpcGateway := runtime.NewServeMux()
	dialAddr := fmt.Sprintf("127.0.0.1:%d", config.GetSocket().Port-2)
	dialOpts := []grpc.DialOption{
		//TODO (mo, zyro): Do we need to pass the statsHandler here as well?
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(int(config.GetSocket().MaxMessageSizeBytes))),
		grpc.WithInsecure(),
	}

	if err := console.RegisterConsoleHandlerFromEndpoint(ctx, grpcGateway, dialAddr, dialOpts); err != nil {
		multiLogger.Fatal("Console server gateway registration failed", zap.Error(err))
	}

	grpcGatewayRouter := mux.NewRouter()
	grpcGatewayRouter.NewRoute().Handler(grpcGateway)
	//TODO server HTML content here.
	grpcGatewayRouter.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }).Methods("GET")
	// Enable compression on gateway responses.
	handlerWithGzip := handlers.CompressHandler(grpcGatewayRouter)

	// Enable CORS on all requests.
	CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})
	CORSMethods := handlers.AllowedMethods([]string{"GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"})
	handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins, CORSMethods)(handlerWithGzip)

	// Set up and start GRPC Gateway server.
	s.grpcGatewayServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", config.GetConsole().Port),
		ReadTimeout:  time.Millisecond * time.Duration(int64(config.GetSocket().ReadTimeoutMs)),
		WriteTimeout: time.Millisecond * time.Duration(int64(config.GetSocket().WriteTimeoutMs)),
		IdleTimeout:  time.Millisecond * time.Duration(int64(config.GetSocket().IdleTimeoutMs)),
		Handler:      handlerWithCORS,
	}

	multiLogger.Info("Starting Console server gateway for HTTP requests", zap.Int("port", config.GetConsole().Port))
	go func() {
		if err := s.grpcGatewayServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			multiLogger.Fatal("Console server gateway listener failed", zap.Error(err))
		}
	}()

	return s
}

func (s *ConsoleServer) Stop() {
	// 1. Stop GRPC Gateway server first as it sits above GRPC server.
	if err := s.grpcGatewayServer.Shutdown(context.Background()); err != nil {
		s.logger.Error("API server gateway listener shutdown failed", zap.Error(err))
	}
	// 2. Stop GRPC server.
	s.grpcServer.GracefulStop()
}

func consoleInterceptorFunc(logger *zap.Logger, config Config) func(context.Context, interface{}, *grpc.UnaryServerInfo, grpc.UnaryHandler) (interface{}, error) {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {

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
			return nil, status.Error(codes.Unauthenticated, "Console authentication required.")
		}
		if len(auth) != 1 {
			return nil, status.Error(codes.Unauthenticated, "Console authentication required.")
		}
		username, password, ok := parseBasicAuth(auth[0])
		if !ok {
			return nil, status.Error(codes.Unauthenticated, "Console authentication invalid.")
		}
		if username != config.GetConsole().Username || password != config.GetConsole().Password {
			return nil, status.Error(codes.Unauthenticated, "Console authentication invalid.")
		}

		return handler(ctx, req)
	}
}

func (s *ConsoleServer) Login(context.Context, *console.AuthenticateRequest) (*console.Session, error) {
	return nil, nil
}
