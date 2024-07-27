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
	"compress/flate"
	"compress/gzip"
	"context"
	"crypto"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"fmt"
	"google.golang.org/grpc/grpclog"
	"math"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	jwt "github.com/golang-jwt/jwt/v4"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	grpcgw "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/apigrpc"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	_ "google.golang.org/grpc/encoding/gzip" // enable gzip compression on server for grpc
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/emptypb"
)

var once sync.Once

// Used as part of JSON input validation.
const byteBracket byte = '{'

// Keys used for storing/retrieving user information in the context of a request after authentication.
type ctxUserIDKey struct{}
type ctxUsernameKey struct{}
type ctxVarsKey struct{}
type ctxExpiryKey struct{}

type ctxFullMethodKey struct{}

type ApiServer struct {
	apigrpc.UnimplementedNakamaServer
	logger               *zap.Logger
	db                   *sql.DB
	config               Config
	version              string
	socialClient         *social.Client
	storageIndex         StorageIndex
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	sessionCache         SessionCache
	sessionRegistry      SessionRegistry
	statusRegistry       StatusRegistry
	matchRegistry        MatchRegistry
	tracker              Tracker
	router               MessageRouter
	streamManager        StreamManager
	metrics              Metrics
	matchmaker           Matchmaker
	runtime              *Runtime
	grpcServer           *grpc.Server
	grpcGatewayServer    *http.Server
}

func StartApiServer(logger *zap.Logger, startupLogger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, version string, socialClient *social.Client, storageIndex StorageIndex, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, matchmaker Matchmaker, tracker Tracker, router MessageRouter, streamManager StreamManager, metrics Metrics, pipeline *Pipeline, runtime *Runtime) *ApiServer {
	var gatewayContextTimeoutMs string
	if config.GetSocket().IdleTimeoutMs > 500 {
		// Ensure the GRPC Gateway timeout is just under the idle timeout (if possible) to ensure it has priority.
		grpcgw.DefaultContextTimeout = time.Duration(config.GetSocket().IdleTimeoutMs-500) * time.Millisecond
		gatewayContextTimeoutMs = fmt.Sprintf("%vm", config.GetSocket().IdleTimeoutMs-500)
	} else {
		grpcgw.DefaultContextTimeout = time.Duration(config.GetSocket().IdleTimeoutMs) * time.Millisecond
		gatewayContextTimeoutMs = fmt.Sprintf("%vm", config.GetSocket().IdleTimeoutMs)
	}

	serverOpts := []grpc.ServerOption{
		grpc.StatsHandler(&MetricsGrpcHandler{MetricsFn: metrics.Api, Metrics: metrics}),
		grpc.MaxRecvMsgSize(int(config.GetSocket().MaxRequestSizeBytes)),
		grpc.UnaryInterceptor(func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
			ctx, err := securityInterceptorFunc(logger, config, sessionCache, ctx, req, info)
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

	// Set grpc logger
	grpcLogger, err := NewGrpcCustomLogger(logger)
	if err != nil {
		startupLogger.Fatal("failed to set up grpc logger", zap.Error(err))
	}
	once.Do(func() { grpclog.SetLoggerV2(grpcLogger) })

	s := &ApiServer{
		logger:               logger,
		db:                   db,
		config:               config,
		version:              version,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		storageIndex:         storageIndex,
		sessionCache:         sessionCache,
		sessionRegistry:      sessionRegistry,
		statusRegistry:       statusRegistry,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		router:               router,
		streamManager:        streamManager,
		metrics:              metrics,
		matchmaker:           matchmaker,
		runtime:              runtime,
		grpcServer:           grpcServer,
	}

	// Register and start GRPC server.
	apigrpc.RegisterNakamaServer(grpcServer, s)
	startupLogger.Info("Starting API server for gRPC requests", zap.Int("port", config.GetSocket().Port-1))
	go func() {
		listener, err := net.Listen("tcp", fmt.Sprintf("%v:%d", config.GetSocket().Address, config.GetSocket().Port-1))
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
	grpcGateway := grpcgw.NewServeMux(
		grpcgw.WithRoutingErrorHandler(handleRoutingError),
		grpcgw.WithMetadata(func(ctx context.Context, r *http.Request) metadata.MD {
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
			return p
		}),
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
	dialAddr := fmt.Sprintf("127.0.0.1:%d", config.GetSocket().Port-1)
	if config.GetSocket().Address != "" {
		dialAddr = fmt.Sprintf("%v:%d", config.GetSocket().Address, config.GetSocket().Port-1)
	}
	dialOpts := []grpc.DialOption{
		grpc.WithDefaultCallOptions(
			grpc.MaxCallSendMsgSize(int(config.GetSocket().MaxRequestSizeBytes)),
			grpc.MaxCallRecvMsgSize(math.MaxInt32),
		),
		//grpc.WithStatsHandler(&ocgrpc.ClientHandler{}),
	}
	if config.GetSocket().TLSCert != nil {
		// GRPC-Gateway only ever dials 127.0.0.1 so we can be lenient on server certificate validation.
		certPool := x509.NewCertPool()
		if !certPool.AppendCertsFromPEM(config.GetSocket().CertPEMBlock) {
			startupLogger.Fatal("Failed to load PEM certificate from socket SSL certificate file")
		}
		cert := credentials.NewTLS(&tls.Config{RootCAs: certPool, InsecureSkipVerify: true})
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(cert))
	} else {
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}
	if err := apigrpc.RegisterNakamaHandlerFromEndpoint(ctx, grpcGateway, dialAddr, dialOpts); err != nil {
		startupLogger.Fatal("API server gateway registration failed", zap.Error(err))
	}
	//if err := apigrpc.RegisterNakamaHandlerServer(ctx, grpcGateway, s); err != nil {
	//	startupLogger.Fatal("API server gateway registration failed", zap.Error(err))
	//}

	grpcGatewayRouter := mux.NewRouter()
	// Special case routes. Do NOT enable compression on WebSocket route, it results in "http: response.Write on hijacked connection" errors.
	grpcGatewayRouter.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }).Methods("GET")
	grpcGatewayRouter.HandleFunc("/ws", NewSocketWsAcceptor(logger, config, sessionRegistry, sessionCache, statusRegistry, matchmaker, tracker, metrics, runtime, protojsonMarshaler, protojsonUnmarshaler, pipeline)).Methods("GET")

	// Another nested router to hijack RPC requests bound for GRPC Gateway.
	grpcGatewayMux := mux.NewRouter()
	grpcGatewayMux.HandleFunc("/v2/rpc/{id:.*}", s.RpcFuncHttp).Methods("GET", "POST")
	grpcGatewayMux.NewRoute().Handler(grpcGateway)

	// Enable stats recording on all request paths except:
	// "/" is not tracked at all.
	// "/ws" implements its own separate tracking.
	//handlerWithStats := &ochttp.Handler{
	//	Handler:          grpcGatewayMux,
	//	IsPublicEndpoint: true,
	//}

	// Default to passing request to GRPC Gateway.
	// Enable max size check on requests coming arriving the gateway.
	// Enable compression on responses sent by the gateway.
	// Enable decompression on requests received by the gateway.
	handlerWithDecompressRequest := decompressHandler(logger, grpcGatewayMux)
	handlerWithCompressResponse := handlers.CompressHandler(handlerWithDecompressRequest)
	maxMessageSizeBytes := config.GetSocket().MaxRequestSizeBytes
	handlerWithMaxBody := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check max body size before decompressing incoming request body.
		r.Body = http.MaxBytesReader(w, r.Body, maxMessageSizeBytes)
		handlerWithCompressResponse.ServeHTTP(w, r)
	})
	grpcGatewayRouter.NewRoute().HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Ensure some request headers have required values.
		// Override any value set by the client if needed.
		r.Header.Set("Grpc-Timeout", gatewayContextTimeoutMs)

		// Add constant response headers.
		w.Header().Add("Cache-Control", "no-store, no-cache, must-revalidate")

		// Allow GRPC Gateway to handle the request.
		handlerWithMaxBody.ServeHTTP(w, r)
	})

	// Enable CORS on all requests.
	CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})
	CORSMethods := handlers.AllowedMethods([]string{"GET", "HEAD", "POST", "PUT", "DELETE"})
	handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins, CORSMethods)(grpcGatewayRouter)

	// Enable configured response headers, if any are set. Do not override values that may have been set by server processing.
	optionalResponseHeaderHandler := handlerWithCORS
	if headers := config.GetSocket().Headers; len(headers) > 0 {
		optionalResponseHeaderHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Preemptively set custom response headers. Further processing will override them if needed for proper functionality.
			wHeaders := w.Header()
			for key, value := range headers {
				if wHeaders.Get(key) == "" {
					wHeaders.Set(key, value)
				}
			}

			// Allow core server processing to handle the request.
			handlerWithCORS.ServeHTTP(w, r)
		})
	}

	// Set up and start GRPC Gateway server.
	s.grpcGatewayServer = &http.Server{
		ReadTimeout:    time.Millisecond * time.Duration(int64(config.GetSocket().ReadTimeoutMs)),
		WriteTimeout:   time.Millisecond * time.Duration(int64(config.GetSocket().WriteTimeoutMs)),
		IdleTimeout:    time.Millisecond * time.Duration(int64(config.GetSocket().IdleTimeoutMs)),
		MaxHeaderBytes: 5120,
		Handler:        optionalResponseHeaderHandler,
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

		if config.GetSocket().TLSCert != nil {
			if err := s.grpcGatewayServer.ServeTLS(listener, "", ""); err != nil && err != http.ErrServerClosed {
				startupLogger.Fatal("API server gateway listener failed", zap.Error(err))
			}
		} else {
			if err := s.grpcGatewayServer.Serve(listener); err != nil && err != http.ErrServerClosed {
				startupLogger.Fatal("API server gateway listener failed", zap.Error(err))
			}
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

func (s *ApiServer) Healthcheck(ctx context.Context, in *emptypb.Empty) (*emptypb.Empty, error) {
	return &emptypb.Empty{}, nil
}

func securityInterceptorFunc(logger *zap.Logger, config Config, sessionCache SessionCache, ctx context.Context, req interface{}, info *grpc.UnaryServerInfo) (context.Context, error) {
	switch info.FullMethod {
	case "/nakama.api.Nakama/Healthcheck":
		// Healthcheck has no security.
		return ctx, nil
	case "/nakama.api.Nakama/SessionRefresh":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateApple":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateCustom":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateDevice":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateEmail":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateFacebook":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateFacebookInstantGame":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateGameCenter":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateGoogle":
		fallthrough
	case "/nakama.api.Nakama/AuthenticateSteam":
		// Session refresh and authentication functions only require server key.
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
		userID, username, vars, exp, tokenId, ok := parseBearerAuth([]byte(config.GetSession().EncryptionKey), auth[0])
		if !ok {
			// Value of "authorization" or "grpc-authorization" was malformed or expired.
			return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
		}
		if !sessionCache.IsValidSession(userID, exp, tokenId) {
			return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
		}
		ctx = context.WithValue(context.WithValue(context.WithValue(context.WithValue(ctx, ctxUserIDKey{}, userID), ctxUsernameKey{}, username), ctxVarsKey{}, vars), ctxExpiryKey{}, exp)
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
		userID, username, vars, exp, tokenId, ok := parseBearerAuth([]byte(config.GetSession().EncryptionKey), auth[0])
		if !ok {
			// Value of "authorization" or "grpc-authorization" was malformed or expired.
			return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
		}
		if !sessionCache.IsValidSession(userID, exp, tokenId) {
			return nil, status.Error(codes.Unauthenticated, "Auth token invalid")
		}
		ctx = context.WithValue(context.WithValue(context.WithValue(context.WithValue(ctx, ctxUserIDKey{}, userID), ctxUsernameKey{}, username), ctxVarsKey{}, vars), ctxExpiryKey{}, exp)
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

func parseBearerAuth(hmacSecretByte []byte, auth string) (userID uuid.UUID, username string, vars map[string]string, exp int64, tokenId string, ok bool) {
	if auth == "" {
		return
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return
	}
	return parseToken(hmacSecretByte, auth[len(prefix):])
}

func parseToken(hmacSecretByte []byte, tokenString string) (userID uuid.UUID, username string, vars map[string]string, exp int64, tokenId string, ok bool) {
	jwtToken, err := jwt.ParseWithClaims(tokenString, &SessionTokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return hmacSecretByte, nil
	})
	if err != nil {
		return
	}
	claims, ok := jwtToken.Claims.(*SessionTokenClaims)
	if !ok || !jwtToken.Valid {
		return
	}
	userID, err = uuid.FromString(claims.UserId)
	if err != nil {
		return
	}
	return userID, claims.Username, claims.Vars, claims.ExpiresAt, claims.TokenId, true
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

func extractClientAddressFromContext(logger *zap.Logger, ctx context.Context) (string, string) {
	var clientAddr string
	md, _ := metadata.FromIncomingContext(ctx)
	if ips := md.Get("x-forwarded-for"); len(ips) > 0 {
		// Look for gRPC-Gateway / LB header.
		clientAddr = strings.Split(ips[0], ",")[0]
	} else if peerInfo, ok := peer.FromContext(ctx); ok {
		// If missing, try to look up gRPC peer info.
		clientAddr = peerInfo.Addr.String()
	}

	return extractClientAddress(logger, clientAddr, ctx, "context")
}

func extractClientAddressFromRequest(logger *zap.Logger, r *http.Request) (string, string) {
	var clientAddr string
	if ips := r.Header.Get("x-forwarded-for"); len(ips) > 0 {
		clientAddr = strings.Split(ips, ",")[0]
	} else {
		clientAddr = r.RemoteAddr
	}

	return extractClientAddress(logger, clientAddr, r, "request")
}

func extractClientAddress(logger *zap.Logger, clientAddr string, source interface{}, sourceType string) (string, string) {
	var clientIP, clientPort string

	if clientAddr != "" {
		// It's possible the request metadata had no client address string.

		clientAddr = strings.TrimSpace(clientAddr)
		if host, port, err := net.SplitHostPort(clientAddr); err == nil {
			clientIP = host
			clientPort = port
		} else if addrErr, ok := err.(*net.AddrError); ok {
			switch addrErr.Err {
			case "missing port in address":
				fallthrough
			case "too many colons in address":
				clientIP = clientAddr
			default:
				// Unknown address error, ignore the address.
			}
		}
		// At this point err may still be a non-nil value that's not a *net.AddrError, ignore the address.
	}

	if clientIP == "" {
		if r, isRequest := source.(*http.Request); isRequest {
			source = map[string]interface{}{"headers": r.Header, "remote_addr": r.RemoteAddr}
		}
		logger.Warn("cannot extract client address", zap.String("address_source_type", sourceType), zap.Any("address_source", source))
	}

	return clientIP, clientPort
}

func traceApiBefore(ctx context.Context, logger *zap.Logger, metrics Metrics, fullMethodName string, fn func(clientIP, clientPort string) error) error {
	clientIP, clientPort := extractClientAddressFromContext(logger, ctx)
	start := time.Now()

	// Execute the before hook itself.
	err := fn(clientIP, clientPort)

	metrics.ApiBefore(fullMethodName, time.Since(start), err != nil)

	return err
}

func traceApiAfter(ctx context.Context, logger *zap.Logger, metrics Metrics, fullMethodName string, fn func(clientIP, clientPort string) error) {
	clientIP, clientPort := extractClientAddressFromContext(logger, ctx)
	start := time.Now()

	// Execute the after hook itself.
	err := fn(clientIP, clientPort)

	metrics.ApiAfter(fullMethodName, time.Since(start), err != nil)
}

func handleRoutingError(ctx context.Context, mux *grpcgw.ServeMux, marshaler grpcgw.Marshaler, w http.ResponseWriter, r *http.Request, httpStatus int) {
	sterr := status.Error(codes.Internal, "Unexpected routing error")
	switch httpStatus {
	case http.StatusBadRequest:
		sterr = status.Error(codes.InvalidArgument, http.StatusText(httpStatus))
	case http.StatusMethodNotAllowed:
		sterr = status.Error(codes.Unimplemented, http.StatusText(httpStatus))
	case http.StatusNotFound:
		sterr = status.Error(codes.NotFound, http.StatusText(httpStatus))
	}

	// Set empty ServerMetadata to prevent logging error on nil metadata.
	grpcgw.DefaultHTTPErrorHandler(grpcgw.NewServerMetadataContext(ctx, grpcgw.ServerMetadata{}), mux, marshaler, w, r, sterr)
}
