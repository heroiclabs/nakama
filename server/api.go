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
	"time"

	"github.com/heroiclabs/nakama/api"

	"google.golang.org/grpc/peer"

	"crypto/tls"

	"compress/flate"
	"compress/gzip"

	"github.com/dgrijalva/jwt-go"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	grpcRuntime "github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/heroiclabs/nakama/apigrpc"
	"github.com/heroiclabs/nakama/social"
	"go.opencensus.io/plugin/ocgrpc"
	"go.opencensus.io/plugin/ochttp"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	_ "google.golang.org/grpc/encoding/gzip" // enable gzip compression on server for grpc
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// Keys used for storing/retrieving user information in the context of a request after authentication.
type ctxUserIDKey struct{}
type ctxUsernameKey struct{}
type ctxExpiryKey struct{}

type ctxFullMethodKey struct{}

type ApiServer struct {
	logger               *zap.Logger
	db                   *sql.DB
	config               Config
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	matchRegistry        MatchRegistry
	tracker              Tracker
	router               MessageRouter
	runtime              *Runtime
	grpcServer           *grpc.Server
	grpcGatewayServer    *http.Server
}

func StartApiServer(logger *zap.Logger, startupLogger *zap.Logger, db *sql.DB, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, sessionRegistry SessionRegistry, matchRegistry MatchRegistry, matchmaker Matchmaker, tracker Tracker, router MessageRouter, pipeline *Pipeline, runtime *Runtime) *ApiServer {
	if config.GetSocket().IdleTimeoutMs > 500 {
		// Ensure the GRPC Gateway timeout is just under the idle timeout (if possible) to ensure it has priority.
		grpcRuntime.DefaultContextTimeout = time.Duration(config.GetSocket().IdleTimeoutMs-500) * time.Millisecond
	} else {
		grpcRuntime.DefaultContextTimeout = time.Duration(config.GetSocket().IdleTimeoutMs) * time.Millisecond
	}

	serverOpts := []grpc.ServerOption{
		grpc.StatsHandler(&ocgrpc.ServerHandler{IsPublicEndpoint: true}),
		grpc.MaxRecvMsgSize(int(config.GetSocket().MaxMessageSizeBytes)),
		grpc.UnaryInterceptor(func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			ctx, err := securityInterceptorFunc(logger, config, ctx, req, info)
			if err != nil {
				return nil, err
			}
			return handler(ctx, req)
		}),
	}
	if config.GetSocket().TLSCert != nil {
		serverOpts = append(serverOpts, grpc.Creds(credentials.NewServerTLSFromCert(&config.GetSocket().TLSCert[0])))
	}
	grpcServer := grpc.NewServer(serverOpts...)

	s := &ApiServer{
		logger:               logger,
		db:                   db,
		config:               config,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		router:               router,
		runtime:              runtime,
		grpcServer:           grpcServer,
	}

	// Register and start GRPC server.
	apigrpc.RegisterNakamaServer(grpcServer, s)
	startupLogger.Info("Starting API server for gRPC requests", zap.Int("port", config.GetSocket().Port-1))
	go func() {
		listener, err := net.Listen("tcp", fmt.Sprintf(":%d", config.GetSocket().Port-1))
		if err != nil {
			startupLogger.Fatal("API server listener failed to start", zap.Error(err))
		}

		if err := grpcServer.Serve(listener); err != nil {
			startupLogger.Fatal("API server listener failed", zap.Error(err))
		}
	}()

	// Register and start GRPC Gateway server.
	// Should start after GRPC server itself because RegisterNakamaHandlerFromEndpoint below tries to dial GRPC.
	ctx := context.Background()
	grpcGateway := grpcRuntime.NewServeMux(
		grpcRuntime.WithMetadata(func(ctx context.Context, r *http.Request) metadata.MD {
			// For RPC GET operations pass through any custom query parameters.
			if r.Method != "GET" || !strings.HasPrefix(r.URL.Path, "/v2/rpc/") {
				return metadata.MD{}
			}

			q := r.URL.Query()
			p := make(map[string][]string, len(q))
			for k, vs := range q {
				if k == "http_key" {
					// Skip Nakama's own query params, only process custom ones.
					continue
				}
				p["q_"+k] = vs
			}
			return metadata.MD(p)
		}),
	)
	dialAddr := fmt.Sprintf("127.0.0.1:%d", config.GetSocket().Port-1)
	dialOpts := []grpc.DialOption{
		//TODO (mo, zyro): Do we need to pass the statsHandler here as well?
		grpc.WithDefaultCallOptions(grpc.MaxCallSendMsgSize(int(config.GetSocket().MaxMessageSizeBytes))),
		grpc.WithStatsHandler(&ocgrpc.ClientHandler{}),
	}
	if config.GetSocket().TLSCert != nil {
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(credentials.NewServerTLSFromCert(&config.GetSocket().TLSCert[0])))
	} else {
		dialOpts = append(dialOpts, grpc.WithInsecure())
	}
	if err := apigrpc.RegisterNakamaHandlerFromEndpoint(ctx, grpcGateway, dialAddr, dialOpts); err != nil {
		startupLogger.Fatal("API server gateway registration failed", zap.Error(err))
	}

	grpcGatewayRouter := mux.NewRouter()
	// Special case routes. Do NOT enable compression on WebSocket route, it results in "http: response.Write on hijacked connection" errors.
	grpcGatewayRouter.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }).Methods("GET")
	grpcGatewayRouter.HandleFunc("/ws", NewSocketWsAcceptor(logger, config, sessionRegistry, matchmaker, tracker, jsonpbMarshaler, jsonpbUnmarshaler, pipeline)).Methods("GET")

	// Enable stats recording on all request paths except:
	// "/" is not tracked at all.
	// "/ws" implements its own separate tracking.
	handlerWithStats := &ochttp.Handler{
		Handler:          grpcGateway,
		IsPublicEndpoint: true,
	}

	// Default to passing request to GRPC Gateway.
	// Enable max size check on requests coming arriving the gateway.
	// Enable compression on responses sent by the gateway.
	// Enable decompression on requests received by the gateway.
	handlerWithDecompressRequest := decompressHandler(logger, handlerWithStats)
	handlerWithCompressResponse := handlers.CompressHandler(handlerWithDecompressRequest)
	maxMessageSizeBytes := config.GetSocket().MaxMessageSizeBytes
	handlerWithMaxBody := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check max body size before decompressing incoming request body.
		r.Body = http.MaxBytesReader(w, r.Body, maxMessageSizeBytes)
		handlerWithCompressResponse.ServeHTTP(w, r)
	})
	grpcGatewayRouter.NewRoute().HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Do not allow clients to set certain headers.
		// Currently disallowed headers:
		// "Grpc-Timeout"
		r.Header.Del("Grpc-Timeout")

		// Allow GRPC Gateway to handle the request.
		handlerWithMaxBody.ServeHTTP(w, r)
	})

	// Enable CORS on all requests.
	CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})
	CORSMethods := handlers.AllowedMethods([]string{"GET", "HEAD", "POST", "PUT", "DELETE"})
	handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins, CORSMethods)(grpcGatewayRouter)

	// Set up and start GRPC Gateway server.
	s.grpcGatewayServer = &http.Server{
		ReadTimeout:    time.Millisecond * time.Duration(int64(config.GetSocket().ReadTimeoutMs)),
		WriteTimeout:   time.Millisecond * time.Duration(int64(config.GetSocket().WriteTimeoutMs)),
		IdleTimeout:    time.Millisecond * time.Duration(int64(config.GetSocket().IdleTimeoutMs)),
		MaxHeaderBytes: 5120,
		Handler:        handlerWithCORS,
	}
	if config.GetSocket().TLSCert != nil {
		s.grpcGatewayServer.TLSConfig = &tls.Config{Certificates: config.GetSocket().TLSCert}
	}

	startupLogger.Info("Starting API server gateway for HTTP requests", zap.Int("port", config.GetSocket().Port))
	go func() {
		listener, err := net.Listen(config.GetSocket().Protocol, fmt.Sprintf("%v:%d", config.GetSocket().Address, config.GetSocket().Port))
		if err != nil {
			startupLogger.Fatal("API server gateway listener failed to start", zap.Error(err))
		}

		if err := s.grpcGatewayServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			startupLogger.Fatal("API server gateway listener failed", zap.Error(err))
		}
	}()

	return s
}

func (s *ApiServer) Stop() {
	// 1. Stop GRPC Gateway server first as it sits above GRPC server. This also closes the underlying listener.
	if err := s.grpcGatewayServer.Shutdown(context.Background()); err != nil {
		s.logger.Error("API server gateway listener shutdown failed", zap.Error(err))
	}
	// 2. Stop GRPC server. This also closes the underlying listener.
	s.grpcServer.GracefulStop()
}

func (s *ApiServer) Healthcheck(ctx context.Context, in *empty.Empty) (*empty.Empty, error) {
	return &empty.Empty{}, nil
}

func securityInterceptorFunc(logger *zap.Logger, config Config, ctx context.Context, req interface{}, info *grpc.UnaryServerInfo) (context.Context, error) {
	switch info.FullMethod {
	case "/nakama.api.Nakama/Healthcheck":
		// Healthcheck has no security.
		return ctx, nil
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
		username, _, ok := parseBasicAuth(auth[0])
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
			if in.HttpKey == "" {
				// HTTP key not present.
				return nil, status.Error(codes.Unauthenticated, "Auth token or HTTP key required")
			}
			if in.HttpKey != config.GetRuntime().HTTPKey {
				// Value of HTTP key username component did not match.
				return nil, status.Error(codes.Unauthenticated, "HTTP key invalid")
			}
			return ctx, nil
		}
		if len(auth) != 1 {
			// Value of "authorization" or "grpc-authorization" was empty or repeated.
			return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
		}
		userID, username, exp, ok := parseBearerAuth([]byte(config.GetSession().EncryptionKey), auth[0])
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
		userID, username, exp, ok := parseBearerAuth([]byte(config.GetSession().EncryptionKey), auth[0])
		if !ok {
			// Value of "authorization" or "grpc-authorization" was malformed or expired.
			return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
		}
		ctx = context.WithValue(context.WithValue(context.WithValue(ctx, ctxUserIDKey{}, userID), ctxUsernameKey{}, username), ctxExpiryKey{}, exp)
	}
	return context.WithValue(ctx, ctxFullMethodKey{}, info.FullMethod), nil
}

func parseBasicAuth(auth string) (username, password string, ok bool) {
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

func parseBearerAuth(hmacSecretByte []byte, auth string) (userID uuid.UUID, username string, exp int64, ok bool) {
	if auth == "" {
		return
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return
	}
	return parseToken(hmacSecretByte, string(auth[len(prefix):]))
}

func parseToken(hmacSecretByte []byte, tokenString string) (userID uuid.UUID, username string, exp int64, ok bool) {
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

func decompressHandler(logger *zap.Logger, h http.Handler) http.HandlerFunc {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Content-Encoding") {
		case "gzip":
			gr, err := gzip.NewReader(r.Body)
			if err != nil {
				logger.Debug("Error processing gzip request body, attempting to read uncompressed", zap.Error(err))
				break
			}
			r.Body = gr
		case "deflate":
			r.Body = flate.NewReader(r.Body)
		default:
			// No request compression.
		}
		h.ServeHTTP(w, r)
	})
}

func extractClientAddress(logger *zap.Logger, ctx context.Context) (string, string) {
	clientAddr := ""
	clientIP := ""
	clientPort := ""
	md, _ := metadata.FromIncomingContext(ctx)
	if ips := md.Get("x-forwarded-for"); len(ips) > 0 {
		// Look for gRPC-Gateway / LB header.
		clientAddr = strings.Split(ips[0], ",")[0]
	} else if peerInfo, ok := peer.FromContext(ctx); ok {
		// If missing, try to look up gRPC peer info.
		clientAddr = peerInfo.Addr.String()
	}

	clientAddr = strings.TrimSpace(clientAddr)
	if host, port, err := net.SplitHostPort(clientAddr); err == nil {
		clientIP = host
		clientPort = port
	} else if addrErr, ok := err.(*net.AddrError); ok && addrErr.Err == "missing port in address" {
		clientIP = clientAddr
	} else {
		logger.Debug("Could not extract client address from request.", zap.Error(err))
	}

	return clientIP, clientPort
}
