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
	"crypto"
	"database/sql"
	"encoding/base64"
	"fmt"
	"google.golang.org/protobuf/encoding/protojson"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/dgrijalva/jwt-go"

	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	grpcgw "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/heroiclabs/nakama/v2/console"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

var (
	consoleAuthRequired = []byte(`{"error":"Console authentication required.","message":"Console authentication required.","code":16}`)
)

type ConsoleServer struct {
	console.UnimplementedConsoleServer
	logger            *zap.Logger
	db                *sql.DB
	config            Config
	tracker           Tracker
	router            MessageRouter
	statusHandler     StatusHandler
	configWarnings    map[string]string
	serverVersion     string
	grpcServer        *grpc.Server
	grpcGatewayServer *http.Server
}

func StartConsoleServer(logger *zap.Logger, startupLogger *zap.Logger, db *sql.DB, config Config, tracker Tracker, router MessageRouter, statusHandler StatusHandler, configWarnings map[string]string, serverVersion string) *ConsoleServer {
	var gatewayContextTimeoutMs string
	if config.GetConsole().IdleTimeoutMs > 500 {
		// Ensure the GRPC Gateway timeout is just under the idle timeout (if possible) to ensure it has priority.
		gatewayContextTimeoutMs = fmt.Sprintf("%vm", config.GetConsole().IdleTimeoutMs-500)
	} else {
		gatewayContextTimeoutMs = fmt.Sprintf("%vm", config.GetConsole().IdleTimeoutMs)
	}

	serverOpts := []grpc.ServerOption{
		//grpc.StatsHandler(&ocgrpc.ServerHandler{IsPublicEndpoint: true}),
		grpc.MaxRecvMsgSize(int(config.GetConsole().MaxMessageSizeBytes)),
		grpc.UnaryInterceptor(consoleInterceptorFunc(logger, config)),
	}
	grpcServer := grpc.NewServer(serverOpts...)

	s := &ConsoleServer{
		logger:         logger,
		db:             db,
		config:         config,
		tracker:        tracker,
		router:         router,
		statusHandler:  statusHandler,
		configWarnings: configWarnings,
		serverVersion:  serverVersion,
		grpcServer:     grpcServer,
	}

	console.RegisterConsoleServer(grpcServer, s)
	startupLogger.Info("Starting Console server for gRPC requests", zap.Int("port", config.GetConsole().Port-3))
	go func() {
		listener, err := net.Listen("tcp", fmt.Sprintf("%v:%d", config.GetConsole().Address, config.GetConsole().Port-3))
		if err != nil {
			startupLogger.Fatal("Console server listener failed to start", zap.Error(err))
		}

		if err := grpcServer.Serve(listener); err != nil {
			startupLogger.Fatal("Console server listener failed", zap.Error(err))
		}
	}()

	ctx := context.Background()
	grpcGateway := grpcgw.NewServeMux(
		grpcgw.WithMarshalerOption(grpcgw.MIMEWildcard, &grpcgw.HTTPBodyMarshaler{
			Marshaler: &grpcgw.JSONPb{
				MarshalOptions: protojson.MarshalOptions{
					UseProtoNames:  true,
					UseEnumNumbers: true,
				},
				UnmarshalOptions: protojson.UnmarshalOptions{
					DiscardUnknown: true,
				},
			},
		}),
	)
	if err := console.RegisterConsoleHandlerServer(ctx, grpcGateway, s); err != nil {
		startupLogger.Fatal("Console server gateway registration failed", zap.Error(err))
	}

	grpcGatewayRouter := mux.NewRouter()

	grpcGatewayRouter.Handle("/", console.UI).Methods("GET")
	grpcGatewayRouter.Handle("/manifest.json", console.UI).Methods("GET")
	grpcGatewayRouter.Handle("/favicon.ico", console.UI).Methods("GET")
	grpcGatewayRouter.PathPrefix("/static/").Handler(console.UI).Methods("GET")

	//zpagesMux := http.NewServeMux()
	//zpages.Handle(zpagesMux, "/metrics/")
	//grpcGatewayRouter.NewRoute().PathPrefix("/metrics").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	//	zpagesMux.ServeHTTP(w, r)
	//})

	grpcGatewayRouter.HandleFunc("/v2/console/storage/import", s.importStorage)

	grpcGatewaySecure := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/console/authenticate":
			// Authentication endpoint doesn't require security.
			grpcGateway.ServeHTTP(w, r)
		default:
			// 404 non console endpoints
			if !strings.HasPrefix(r.URL.Path, "/v2/console") {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			// All other endpoints are secured.
			auth, ok := r.Header["Authorization"]
			if !ok || len(auth) != 1 || !checkAuth(config, auth[0]) {
				// Auth token not valid or expired.
				w.WriteHeader(http.StatusUnauthorized)
				w.Header().Set("content-type", "application/json")
				_, err := w.Write(consoleAuthRequired)
				if err != nil {
					s.logger.Debug("Error writing response to client", zap.Error(err))
				}
				return
			}
			grpcGateway.ServeHTTP(w, r)
		}
	})

	// Enable max size check on requests coming arriving the gateway.
	// Enable compression on responses sent by the gateway.
	handlerWithCompressResponse := handlers.CompressHandler(grpcGatewaySecure)
	maxMessageSizeBytes := config.GetConsole().MaxMessageSizeBytes
	handlerWithMaxBody := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check max body size before decompressing incoming request body.
		r.Body = http.MaxBytesReader(w, r.Body, maxMessageSizeBytes)
		handlerWithCompressResponse.ServeHTTP(w, r)
	})
	grpcGatewayRouter.NewRoute().HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Ensure some headers have required values.
		// Override any value set by the client if needed.
		r.Header.Set("Grpc-Timeout", gatewayContextTimeoutMs)

		// Allow GRPC Gateway to handle the request.
		handlerWithMaxBody.ServeHTTP(w, r)
	})

	// Enable CORS on all requests.
	CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})
	CORSMethods := handlers.AllowedMethods([]string{"GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"})
	handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins, CORSMethods)(grpcGatewayRouter)

	// Set up and start GRPC Gateway server.
	s.grpcGatewayServer = &http.Server{
		Addr:         fmt.Sprintf("%v:%d", config.GetConsole().Address, config.GetConsole().Port),
		ReadTimeout:  time.Millisecond * time.Duration(int64(config.GetConsole().ReadTimeoutMs)),
		WriteTimeout: time.Millisecond * time.Duration(int64(config.GetConsole().WriteTimeoutMs)),
		IdleTimeout:  time.Millisecond * time.Duration(int64(config.GetConsole().IdleTimeoutMs)),
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
		case "/nakama.console.Console/Authenticate":
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

		if !checkAuth(config, auth[0]) {
			return nil, status.Error(codes.Unauthenticated, "Console authentication invalid.")
		}

		return handler(ctx, req)
	}
}

func checkAuth(config Config, auth string) bool {
	const basicPrefix = "Basic "
	const bearerPrefix = "Bearer "

	if strings.HasPrefix(auth, basicPrefix) {
		// Basic authentication.
		c, err := base64.StdEncoding.DecodeString(auth[len(basicPrefix):])
		if err != nil {
			// Not valid Base64.
			return false
		}
		cs := string(c)
		s := strings.IndexByte(cs, ':')
		if s < 0 {
			// Format is not "username:password".
			return false
		}

		if cs[:s] != config.GetConsole().Username || cs[s+1:] != config.GetConsole().Password {
			// Username and/or password do not match.
			return false
		}

		// Basic authentication successful.
		return true
	} else if strings.HasPrefix(auth, bearerPrefix) {
		// Bearer token authentication.
		token, err := jwt.Parse(auth[len(bearerPrefix):], func(token *jwt.Token) (interface{}, error) {
			if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(config.GetConsole().SigningKey), nil
		})
		if err != nil {
			// Token verification failed.
			return false
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok || !token.Valid {
			// The token or its claims are invalid.
			return false
		}

		exp, ok := claims["exp"].(float64)
		if !ok {
			// Expiry time claim is invalid.
			return false
		}
		if int64(exp) <= time.Now().UTC().Unix() {
			// Token expired.
			return false
		}

		// Bearer token authentication successful.
		return true
	}

	return false
}
