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

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	"github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/heroiclabs/nakama/console"
	"go.opencensus.io/plugin/ocgrpc"
	"go.opencensus.io/zpages"
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

func StartConsoleServer(logger *zap.Logger, startupLogger *zap.Logger, config Config, db *sql.DB) *ConsoleServer {
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
	startupLogger.Info("Starting Console server for gRPC requests", zap.Int("port", config.GetConsole().Port-3))
	go func() {
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", config.GetConsole().Port-3))
		if err != nil {
			startupLogger.Fatal("Console server listener failed to start", zap.Error(err))
		}

		if err := grpcServer.Serve(listener); err != nil {
			startupLogger.Fatal("Console server listener failed", zap.Error(err))
		}
	}()

	ctx := context.Background()
	grpcGateway := runtime.NewServeMux()
	dialAddr := fmt.Sprintf("127.0.0.1:%d", config.GetConsole().Port-3)
	dialOpts := []grpc.DialOption{
		//TODO (mo, zyro): Do we need to pass the statsHandler here as well?
		grpc.WithDefaultCallOptions(grpc.MaxCallSendMsgSize(int(config.GetSocket().MaxMessageSizeBytes))),
		grpc.WithInsecure(),
	}

	if err := console.RegisterConsoleHandlerFromEndpoint(ctx, grpcGateway, dialAddr, dialOpts); err != nil {
		startupLogger.Fatal("Console server gateway registration failed", zap.Error(err))
	}

	grpcGatewayRouter := mux.NewRouter()
	//TODO server HTML content here.
	grpcGatewayRouter.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }).Methods("GET")
	grpcGatewayRouter.HandleFunc("/rpcz", func(w http.ResponseWriter, r *http.Request) {
		zpages.Handler.ServeHTTP(w, r)
	})
	grpcGatewayRouter.HandleFunc("/tracez", func(w http.ResponseWriter, r *http.Request) {
		zpages.Handler.ServeHTTP(w, r)
	})
	grpcGatewayRouter.HandleFunc("/public/", func(w http.ResponseWriter, r *http.Request) {
		zpages.Handler.ServeHTTP(w, r)
	})
	// Enable compression on gateway responses.
	handlerWithGzip := handlers.CompressHandler(grpcGateway)
	grpcGatewayRouter.NewRoute().Handler(handlerWithGzip)

	// Enable CORS on all requests.
	CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})
	CORSMethods := handlers.AllowedMethods([]string{"GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"})
	handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins, CORSMethods)(grpcGatewayRouter)

	// Set up and start GRPC Gateway server.
	s.grpcGatewayServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", config.GetConsole().Port),
		ReadTimeout:  time.Millisecond * time.Duration(int64(config.GetSocket().ReadTimeoutMs)),
		WriteTimeout: time.Millisecond * time.Duration(int64(config.GetSocket().WriteTimeoutMs)),
		IdleTimeout:  time.Millisecond * time.Duration(int64(config.GetSocket().IdleTimeoutMs)),
		Handler:      handlerWithCORS,
	}

	startupLogger.Info("Starting Console server gateway for HTTP requests", zap.Int("port", config.GetConsole().Port))
	go func() {
		if err := s.grpcGatewayServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			startupLogger.Fatal("Console server gateway listener failed", zap.Error(err))
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

		switch info.FullMethod {
		// skip authentication check for Login endpoint
		case "/nakama.console.Console/Login":
			return handler(ctx, req)
		}

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

func (s *ConsoleServer) Login(ctx context.Context, in *console.AuthenticateRequest) (*empty.Empty, error) {
	username := s.config.GetConsole().Username
	password := s.config.GetConsole().Password
	if in.Username == username && in.Password == password {
		return &empty.Empty{}, nil
	}
	return nil, status.Error(codes.Unauthenticated, "Console authentication invalid.")
}
