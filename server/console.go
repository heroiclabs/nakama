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
	"bytes"
	"context"
	"crypto"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/pprof"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	grpcgw "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/heroiclabs/nakama/v3/console/acl"
	"github.com/heroiclabs/nakama/v3/internal/satori"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

var _ http.ResponseWriter = (*statusCheckResponseWriter)(nil)

type statusCheckResponseWriter struct {
	w          http.ResponseWriter
	statusCode int
}

func (s *statusCheckResponseWriter) Header() http.Header {
	return s.w.Header()
}

func (s *statusCheckResponseWriter) Write(bytes []byte) (int, error) {
	return s.w.Write(bytes)
}

func (s *statusCheckResponseWriter) WriteHeader(statusCode int) {
	s.statusCode = statusCode
	s.w.WriteHeader(statusCode)
}

type ctxConsoleUserIdKey struct{}
type ctxConsoleUsernameKey struct{}
type ctxConsoleEmailKey struct{}
type ctxConsoleUserAclKey struct{}

type ConsoleServer struct {
	console.UnimplementedConsoleServer
	logger               *zap.Logger
	db                   *sql.DB
	config               Config
	tracker              Tracker
	router               MessageRouter
	streamManager        StreamManager
	metrics              Metrics
	sessionCache         SessionCache
	sessionRegistry      SessionRegistry
	consoleSessionCache  SessionCache
	loginAttemptCache    LoginAttemptCache
	statusRegistry       StatusRegistry
	matchRegistry        MatchRegistry
	statusHandler        StatusHandler
	storageIndex         StorageIndex
	runtimeInfo          *RuntimeInfo
	configWarnings       map[string]string
	serverVersion        string
	ctxCancelFn          context.CancelFunc
	runtime              *Runtime
	grpcServer           *grpc.Server
	grpcGatewayServer    *http.Server
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	leaderboardScheduler LeaderboardScheduler
	api                  *ApiServer
	rpcMethodCache       *rpcReflectCache
	cookie               string
	httpClient           *http.Client
	satori               *satori.SatoriClient
}

func StartConsoleServer(logger *zap.Logger, startupLogger *zap.Logger, db *sql.DB, config Config, tracker Tracker, router MessageRouter, streamManager StreamManager, metrics Metrics, sessionRegistry SessionRegistry, sessionCache SessionCache, consoleSessionCache SessionCache, loginAttemptCache LoginAttemptCache, statusRegistry StatusRegistry, statusHandler StatusHandler, runtimeInfo *RuntimeInfo, matchRegistry MatchRegistry, configWarnings map[string]string, serverVersion string, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, storageIndex StorageIndex, api *ApiServer, runtime *Runtime, cookie string) *ConsoleServer {
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
		grpc.ChainUnaryInterceptor(
			func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
				ctx = context.WithValue(ctx, ctxTraceId{}, uuid.Must(uuid.NewV4()).String())
				return handler(ctx, req)
			},
			consoleAuthInterceptor(logger, config, consoleSessionCache, loginAttemptCache),
			consoleAuditLogInterceptor(logger, db),
		),
	}
	grpcServer := grpc.NewServer(serverOpts...)

	ctx, ctxCancelFn := context.WithCancel(context.Background())

	var satoriClient *satori.SatoriClient
	if config.GetSatori().ServerKey != "" {
		satoriClient = satori.NewSatoriClient(
			ctx,
			logger,
			config.GetSatori().Url,
			config.GetSatori().ApiKeyName,
			config.GetSatori().ApiKey,
			config.GetSatori().ServerKey,
			config.GetSatori().SigningKey,
			config.GetSession().TokenExpirySec,
			int64(config.GetSatori().HttpTimeoutMs),
			false,
			config.GetSatori().CacheMode,
			int64(config.GetSatori().CacheTTLSec),
		)
	}

	s := &ConsoleServer{
		logger:               logger,
		db:                   db,
		config:               config,
		tracker:              tracker,
		router:               router,
		streamManager:        streamManager,
		metrics:              metrics,
		sessionRegistry:      sessionRegistry,
		sessionCache:         sessionCache,
		consoleSessionCache:  consoleSessionCache,
		loginAttemptCache:    loginAttemptCache,
		statusRegistry:       statusRegistry,
		matchRegistry:        matchRegistry,
		statusHandler:        statusHandler,
		configWarnings:       configWarnings,
		serverVersion:        serverVersion,
		ctxCancelFn:          ctxCancelFn,
		runtime:              runtime,
		grpcServer:           grpcServer,
		runtimeInfo:          runtimeInfo,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		leaderboardScheduler: leaderboardScheduler,
		storageIndex:         storageIndex,
		api:                  api,
		cookie:               cookie,
		httpClient:           &http.Client{Timeout: 5 * time.Second},
		satori:               satoriClient,
	}

	if err := s.initRpcMethodCache(); err != nil {
		startupLogger.Fatal("Console server failed to initialize rpc method reflection cache", zap.Error(err))
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

	grpcGateway := grpcgw.NewServeMux(
		grpcgw.WithUnescapingMode(grpcgw.UnescapingModeAllExceptReserved),
		grpcgw.WithMarshalerOption(grpcgw.MIMEWildcard, &grpcgw.HTTPBodyMarshaler{
			Marshaler: &grpcgw.JSONPb{
				MarshalOptions: protojson.MarshalOptions{
					UseProtoNames:   true,
					UseEnumNumbers:  true,
					EmitUnpopulated: true,
				},
				UnmarshalOptions: protojson.UnmarshalOptions{
					DiscardUnknown: true,
				},
			},
		}),
	)

	dialAddr := fmt.Sprintf("127.0.0.1:%d", config.GetConsole().Port-3)
	if config.GetConsole().Address != "" {
		dialAddr = fmt.Sprintf("%v:%d", config.GetConsole().Address, config.GetConsole().Port-3)
	}
	dialOpts := []grpc.DialOption{
		grpc.WithDefaultCallOptions(
			grpc.MaxCallSendMsgSize(int(config.GetConsole().MaxMessageSizeBytes)),
			grpc.MaxCallRecvMsgSize(math.MaxInt32),
		),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	}
	if err := console.RegisterConsoleHandlerFromEndpoint(ctx, grpcGateway, dialAddr, dialOpts); err != nil {
		startupLogger.Fatal("Console server gateway registration failed", zap.Error(err))
	}

	grpcGatewayRouter := mux.NewRouter()
	grpcGatewayRouter.HandleFunc("/v2/console/storage/import", s.importStorage)

	// Register public subscription callback endpoints
	if config.GetIAP().Apple.NotificationsEndpointId != "" {
		handler := appleNotificationHandler(logger, db, runtime.PurchaseNotificationApple(), runtime.SubscriptionNotificationApple())
		endpoint := fmt.Sprintf("/v2/console/apple/subscriptions/%s", config.GetIAP().Apple.NotificationsEndpointId) // For backwards compatibility.
		grpcGatewayRouter.HandleFunc(endpoint, handler)
		logger.Info("Registered endpoint for Apple subscription notifications callback", zap.String("endpoint", endpoint))
		endpoint = fmt.Sprintf("/v2/console/apple/notifications/%s", config.GetIAP().Apple.NotificationsEndpointId)
		grpcGatewayRouter.HandleFunc(endpoint, handler)
		logger.Info("Registered endpoint for Apple subscription notifications callback", zap.String("endpoint", endpoint))
	}

	if config.GetIAP().Google.NotificationsEndpointId != "" {
		handler := googleNotificationHandler(logger, db, config.GetIAP().Google, runtime.PurchaseNotificationGoogle(), runtime.SubscriptionNotificationGoogle())
		endpoint := fmt.Sprintf("/v2/console/google/subscriptions/%s", config.GetIAP().Google.NotificationsEndpointId) // For backwards compatibility.
		grpcGatewayRouter.HandleFunc(endpoint, handler)
		logger.Info("Registered endpoint for Google subscription notifications callback", zap.String("endpoint", endpoint))
		endpoint = fmt.Sprintf("/v2/console/google/notifications/%s", config.GetIAP().Google.NotificationsEndpointId)
		grpcGatewayRouter.HandleFunc(endpoint, handler)
		logger.Info("Registered endpoint for Google subscription notifications callback", zap.String("endpoint", endpoint))
	}

	// pprof routes
	grpcGatewayRouter.Handle("/debug/pprof/", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Index)))
	grpcGatewayRouter.Handle("/debug/pprof/cmdline", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Cmdline)))
	grpcGatewayRouter.Handle("/debug/pprof/profile", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Profile)))
	grpcGatewayRouter.Handle("/debug/pprof/profile_js", adminBasicAuth(config.GetConsole())(http.HandlerFunc(ProfileGoja)))
	grpcGatewayRouter.Handle("/debug/pprof/symbol", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Symbol)))
	grpcGatewayRouter.Handle("/debug/pprof/trace", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Trace)))
	grpcGatewayRouter.Handle("/debug/pprof/{profile}", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Index)))

	customHttpAuthFunc := func(path string, methods []string, handler func(http.ResponseWriter, *http.Request)) func(http.ResponseWriter, *http.Request) {
		var method string
		if len(methods) == 1 {
			method = methods[0]
		}
		return func(w http.ResponseWriter, r *http.Request) {
			r, success, code, message := checkAuthCustom(r, logger, config, r.Header.Get("Authorization"), method, path, sessionCache, loginAttemptCache)
			if !success {
				w.Header().Set("content-type", "application/json")
				w.WriteHeader(code)
				_, err := w.Write([]byte(message))
				if err != nil {
					s.logger.Debug("Error writing response to client", zap.Error(err))
				}
				return
			}

			handler(w, r)
		}
	}

	customHttpAuditLogFunc := func(path string, methods []string, handler func(http.ResponseWriter, *http.Request)) func(http.ResponseWriter, *http.Request) {
		var method string
		if len(methods) == 1 {
			method = methods[0]
		}
		return func(w http.ResponseWriter, r *http.Request) {
			// Read the body so we can later write it to the audit log.
			originalBody, err := io.ReadAll(r.Body)
			if err != nil {
				s.logger.Error("Error reading request body", zap.Error(err))

				w.Header().Set("content-type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				if _, err = w.Write(internalServerErrorBytes); err != nil {
					s.logger.Debug("Error writing response to client", zap.Error(err))
				}
				return
			}
			_ = r.Body.Close()
			r.Body = io.NopCloser(bytes.NewReader(originalBody))

			sw := &statusCheckResponseWriter{w: w}

			handler(sw, r)

			// If operation was successful, note it in the audit log.
			if sw.statusCode >= 200 && sw.statusCode < 300 {
				consoleHttpAuditLogInterceptor(r.Context(), logger, db, method, path, originalBody)
			}
		}
	}

	customHttpMuxParamsFunc := func(handler func(http.ResponseWriter, *http.Request)) func(http.ResponseWriter, *http.Request) {
		return func(w http.ResponseWriter, r *http.Request) {
			for k, v := range mux.Vars(r) {
				r.SetPathValue(k, v)
			}
			handler(w, r)
		}
	}

	// Custom routes.
	for _, handler := range runtime.consoleHttpHandlers {
		if handler == nil {
			continue
		}
		if !strings.HasPrefix(handler.PathPattern, "/") {
			logger.Fatal("Failed to register custom console HTTP handler, path pattern must start with '/'", zap.String("path_pattern", handler.PathPattern))
		}
		handlerFunc := handler.Handler
		if strings.HasPrefix(handler.PathPattern, "/v2/console/hiro/") {
			// Handlers in reverse order of priority.
			handlerFunc = customHttpMuxParamsFunc(handlerFunc)
			handlerFunc = customHttpAuditLogFunc(handler.PathPattern, handler.Methods, handlerFunc)
			handlerFunc = customHttpAuthFunc(handler.PathPattern, handler.Methods, handlerFunc)
		}
		route := grpcGatewayRouter.HandleFunc(handler.PathPattern, handlerFunc)
		if len(handler.Methods) > 0 {
			route.Methods(handler.Methods...)
		}
		logger.Info("Registered custom console HTTP handler", zap.String("path_pattern", handler.PathPattern))
	}

	// Enable max size check on requests coming arriving the gateway.
	// Enable compression on responses sent by the gateway.
	handlerWithCompressResponse := handlers.CompressHandler(grpcGateway)
	maxMessageSizeBytes := config.GetConsole().MaxMessageSizeBytes
	handlerWithMaxBody := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check max body size before decompressing incoming request body.
		r.Body = http.MaxBytesReader(w, r.Body, maxMessageSizeBytes)
		handlerWithCompressResponse.ServeHTTP(w, r)
	})
	grpcGatewayRouter.NewRoute().PathPrefix("/v2").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Ensure some headers have required values.
		// Override any value set by the client if needed.
		r.Header.Set("Grpc-Timeout", gatewayContextTimeoutMs)

		// Allow GRPC Gateway to handle the request.
		handlerWithMaxBody.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxTraceId{}, uuid.Must(uuid.NewV4()).String())))
	})
	if err := registerDashboardHandlers(logger, grpcGatewayRouter); err != nil {
		startupLogger.Fatal("Console dashboard registration failed", zap.Error(err))
	}

	// Enable CORS on all requests.
	CORSHeaders := handlers.AllowedHeaders([]string{"Authorization", "Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})
	CORSMethods := handlers.AllowedMethods([]string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch})
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
		if err := s.grpcGatewayServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			startupLogger.Fatal("Console server gateway listener failed", zap.Error(err))
		}
	}()

	// Run a background process to periodically refresh storage collection names.
	go func() {
		// Refresh function to update cache and return a delay until the next refresh should run.
		refreshFn := func() *time.Timer {
			startAt := time.Now()

			// Load all distinct collections from database.
			collections := make([]string, 0, 10)

			query := `
WITH RECURSIVE t AS (
   (SELECT collection FROM storage ORDER BY collection LIMIT 1)  -- Parentheses required, do not remove.
   UNION ALL
   SELECT (SELECT collection FROM storage WHERE collection > t.collection ORDER BY collection LIMIT 1)
   FROM t
   WHERE t.collection IS NOT NULL
   )
SELECT collection FROM t WHERE collection IS NOT NULL`
			rows, err := s.db.QueryContext(ctx, query)
			if err != nil {
				s.logger.Error("Error querying storage collections.", zap.Error(err))
				return time.NewTimer(time.Minute)
			}
			for rows.Next() {
				var dbCollection string
				if err := rows.Scan(&dbCollection); err != nil {
					_ = rows.Close()
					s.logger.Error("Error scanning storage collections.", zap.Error(err))
					return time.NewTimer(time.Minute)
				}
				collections = append(collections, dbCollection)
			}
			_ = rows.Close()

			sort.Strings(collections)
			collectionSetCache.Store(collections)

			elapsed := time.Since(startAt)
			elapsed *= 20
			if elapsed < time.Minute {
				elapsed = time.Minute
			}
			return time.NewTimer(elapsed)
		}

		// Run one refresh as soon as the server starts.
		timer := refreshFn()

		// Then refresh on the chosen timer.
		for {
			select {
			case <-ctx.Done():
				if timer != nil {
					timer.Stop()
				}
				return
			case <-timer.C:
				timer = refreshFn()
			}
		}
	}()

	return s
}

func registerDashboardHandlers(logger *zap.Logger, router *mux.Router) error {
	indexFile, err := console.UIFS.Open("index.html")
	if err != nil {
		logger.Error("Failed to open index file.", zap.Error(err))
		return err
	}
	// inject variables into the index.html file
	indexBytes, err := io.ReadAll(indexFile)
	if err != nil {
		logger.Error("Failed to read index file.", zap.Error(err))
		return err
	}
	_ = indexFile.Close()
	indexHTMLStr := string(indexBytes)
	indexHTMLStr = strings.ReplaceAll(indexHTMLStr, "{{nt}}", strconv.FormatBool(console.UIFS.Nt))
	indexBytes = []byte(indexHTMLStr)

	indexFn := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Cache-Control", "no-cache")
		w.Header().Set("X-Frame-Options", "deny")
		_, _ = w.Write(indexBytes)
	}

	router.Path("/").HandlerFunc(indexFn)
	router.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// get the absolute path to prevent directory traversal
		path := r.URL.Path
		isAsset := false

		if strings.HasPrefix(path, "/static/") {
			isAsset = true

			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")

			if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
				if strings.HasSuffix(path, ".css") || strings.HasSuffix(path, ".js") {
					w.Header().Set("Content-Encoding", "gzip")

					if strings.HasSuffix(path, ".css") {
						w.Header().Set("Content-Type", "text/css")
					} else {
						w.Header().Set("Content-Type", "application/javascript")
					}

					path = path + ".gz"
				}
			}
		}

		// check whether a file exists at the given path
		if _, err := console.UIFS.Open(path); err == nil {
			// otherwise, use http.FileServer to serve the static dir
			r.URL.Path = path // override the path with the prefixed path
			console.UI.ServeHTTP(w, r)

			return
		} else {
			if isAsset {
				w.WriteHeader(http.StatusNotFound)
				return
			}

			indexFn(w, r)
		}
	})

	return nil
}

func (s *ConsoleServer) Stop() {
	s.ctxCancelFn()
	// 1. Stop GRPC Gateway server first as it sits above GRPC server.
	if err := s.grpcGatewayServer.Shutdown(context.Background()); err != nil {
		s.logger.Error("Console server gateway listener shutdown failed", zap.Error(err))
	}
	// 2. Stop GRPC server.
	s.grpcServer.GracefulStop()
}

func consoleAuthInterceptor(logger *zap.Logger, config Config, sessionCache SessionCache, loginAttmeptCache LoginAttemptCache) func(context.Context, interface{}, *grpc.UnaryServerInfo, grpc.UnaryHandler) (interface{}, error) {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if info.FullMethod == "/nakama.console.Console/Authenticate" {
			// Skip authentication check for Login endpoint.
			return handler(ctx, req)
		}
		if info.FullMethod == "/nakama.console.Console/AuthenticateMFASetup" {
			return handler(ctx, req)
		}
		if info.FullMethod == "/nakama.console.Console/AuthenticateLogout" {
			return handler(ctx, req)
		}
		if info.FullMethod == "/nakama.console.Console/AuthenticatePasswordChange" {
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

		ctx, err := checkAuth(ctx, logger, config, auth[0], info.FullMethod, sessionCache, loginAttmeptCache)
		if err != nil {
			return nil, err
		}

		return handler(ctx, req)
	}
}

func checkAuth(ctx context.Context, logger *zap.Logger, config Config, auth, path string, sessionCache SessionCache, loginAttemptCache LoginAttemptCache) (context.Context, error) {
	const basicPrefix = "Basic "
	const bearerPrefix = "Bearer "

	if strings.HasPrefix(auth, basicPrefix) {
		// Basic authentication.
		username, password, ok := parseBasicAuth(auth)
		if !ok {
			return ctx, status.Error(codes.Unauthenticated, "Console authentication invalid.")
		}
		ip, _ := extractClientAddressFromContext(logger, ctx)
		if !loginAttemptCache.Allow(username, ip) {
			return ctx, status.Error(codes.Unauthenticated, "Console authentication invalid.")
		}
		if username == config.GetConsole().Username {
			if password != config.GetConsole().Password {
				// Admin password does not match.
				lockout, until := loginAttemptCache.Add(config.GetConsole().Username, ip)
				switch lockout {
				case LockoutTypeAccount:
					logger.Info(fmt.Sprintf("Console admin account locked until %v.", until))
				case LockoutTypeIp:
					logger.Info(fmt.Sprintf("Console admin IP locked until %v.", until))
				case LockoutTypeNone:
					fallthrough
				default:
					// No lockout.
				}
				return ctx, status.Error(codes.Unauthenticated, "Console authentication invalid.")
			}
		} else {
			return ctx, status.Error(codes.Unauthenticated, "Console authentication invalid.")
		}

		ctx = context.WithValue(ctx, ctxConsoleUserAclKey{}, acl.Admin())
		ctx = context.WithValue(ctx, ctxConsoleUsernameKey{}, username)
		ctx = context.WithValue(ctx, ctxConsoleEmailKey{}, "")
		// Basic authentication successful.
		return ctx, nil
	} else if strings.HasPrefix(auth, bearerPrefix) {
		// Bearer token authentication.
		tokenStr := auth[len(bearerPrefix):]
		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
			if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(config.GetConsole().SigningKey), nil
		})
		if err != nil {
			// Token verification failed.
			return ctx, status.Error(codes.Unauthenticated, "Token invalid.")
		}
		id, uname, email, userAcl, exp, ok, err := parseConsoleToken([]byte(config.GetConsole().SigningKey), tokenStr)
		if err != nil {
			logger.Error("Failed to parse token console jwt token.", zap.Error(err))
			return ctx, status.Error(codes.Unauthenticated, "Token invalid.")
		}
		if !ok || !token.Valid {
			// The token or its claims are invalid.
			return ctx, status.Error(codes.Unauthenticated, "Token invalid.")
		}
		if exp <= time.Now().UTC().Unix() {
			// Token expired.
			return ctx, status.Error(codes.Unauthenticated, "Token invalid.")
		}
		userId, err := uuid.FromString(id)
		if err != nil {
			// Malformed id
			return ctx, status.Error(codes.Unauthenticated, "Token invalid.")
		}
		if !sessionCache.IsValidSession(userId, exp, tokenStr) {
			return ctx, status.Error(codes.Unauthenticated, "Token invalid.")
		}

		ctx = context.WithValue(ctx, ctxConsoleUserIdKey{}, userId)
		ctx = context.WithValue(ctx, ctxConsoleUsernameKey{}, uname)
		ctx = context.WithValue(ctx, ctxConsoleEmailKey{}, email)
		ctx = context.WithValue(ctx, ctxConsoleUserAclKey{}, userAcl)

		if !(acl.CheckACL(path, userAcl)) {
			return ctx, status.Error(codes.PermissionDenied, "Unauthorized: you do not have permissions to access this resource.")
		}

		return ctx, nil
	}

	return ctx, status.Error(codes.Unauthenticated, "Console authentication required.")
}

func checkAuthCustom(r *http.Request, logger *zap.Logger, config Config, auth, method, path string, sessionCache SessionCache, loginAttemptCache LoginAttemptCache) (*http.Request, bool, int, string) {
	const basicPrefix = "Basic "
	const bearerPrefix = "Bearer "

	if strings.HasPrefix(auth, basicPrefix) {
		// Basic authentication.
		username, password, ok := parseBasicAuth(auth)
		if !ok {
			return r, false, http.StatusUnauthorized, `{"error":"Console authentication invalid.","message":"Console authentication invalid.","code":16}`
		}
		ip, _ := extractClientAddressFromRequest(logger, r)
		if !loginAttemptCache.Allow(username, ip) {
			return r, false, http.StatusUnauthorized, `{"error":"Console authentication invalid.","message":"Console authentication invalid.","code":16}`
		}
		if username == config.GetConsole().Username {
			if password != config.GetConsole().Password {
				// Admin password does not match.
				lockout, until := loginAttemptCache.Add(config.GetConsole().Username, ip)
				switch lockout {
				case LockoutTypeAccount:
					logger.Info(fmt.Sprintf("Console admin account locked until %v.", until))
				case LockoutTypeIp:
					logger.Info(fmt.Sprintf("Console admin IP locked until %v.", until))
				case LockoutTypeNone:
					fallthrough
				default:
					// No lockout.
				}
				return r, false, http.StatusUnauthorized, `{"error":"Console authentication invalid.","message":"Console authentication invalid.","code":16}`
			}
		} else {
			return r, false, http.StatusUnauthorized, `{"error":"Console authentication invalid.","message":"Console authentication invalid.","code":16}`
		}

		ctx := context.WithValue(r.Context(), ctxConsoleUserAclKey{}, acl.Admin())
		ctx = context.WithValue(ctx, ctxConsoleUsernameKey{}, username)
		ctx = context.WithValue(ctx, ctxConsoleEmailKey{}, "")
		// Basic authentication successful.
		return r.WithContext(ctx), true, 0, ""
	} else if strings.HasPrefix(auth, bearerPrefix) {
		// Bearer token authentication.
		tokenStr := auth[len(bearerPrefix):]
		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
			if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(config.GetConsole().SigningKey), nil
		})
		if err != nil {
			// Token verification failed.
			return r, false, http.StatusUnauthorized, `{"error":"Token invalid.","message":"Token invalid.","code":16}`
		}
		id, uname, email, userAcl, exp, ok, err := parseConsoleToken([]byte(config.GetConsole().SigningKey), tokenStr)
		if err != nil {
			logger.Error("Failed to parse token console jwt token.", zap.Error(err))
			return r, false, http.StatusUnauthorized, `{"error":"Token invalid.","message":"Token invalid.","code":16}`
		}
		if !ok || !token.Valid {
			// The token or its claims are invalid.
			return r, false, http.StatusUnauthorized, `{"error":"Token invalid.","message":"Token invalid.","code":16}`
		}
		if exp <= time.Now().UTC().Unix() {
			// Token expired.
			return r, false, http.StatusUnauthorized, `{"error":"Token invalid.","message":"Token invalid.","code":16}`
		}
		userId, err := uuid.FromString(id)
		if err != nil {
			// Malformed id
			return r, false, http.StatusUnauthorized, `{"error":"Token invalid.","message":"Token invalid.","code":16}`
		}
		if !sessionCache.IsValidSession(userId, exp, tokenStr) {
			return r, false, http.StatusUnauthorized, `{"error":"Token invalid.","message":"Token invalid.","code":16}`
		}

		ctx := context.WithValue(r.Context(), ctxConsoleUserIdKey{}, userId)
		ctx = context.WithValue(ctx, ctxConsoleUsernameKey{}, uname)
		ctx = context.WithValue(ctx, ctxConsoleEmailKey{}, email)
		ctx = context.WithValue(ctx, ctxConsoleUserAclKey{}, userAcl)

		if !(acl.CheckACLHttp(method, path, userAcl)) {
			return r, false, http.StatusForbidden, `{"error":"Unauthorized: you do not have permissions to access this resource.","message":"Unauthorized: you do not have permissions to access this resource.","code":7}`
		}

		return r.WithContext(ctx), true, 0, ""
	}

	return r, false, http.StatusUnauthorized, `{"error":"Console authentication required.","message":"Console authentication required.","code":16}`
}

func adminBasicAuth(config *ConsoleConfig) func(h http.Handler) http.Handler {
	return func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("authorization")
			if auth == "" {
				w.WriteHeader(401)
				return
			}

			username, password, ok := parseBasicAuth(auth)
			if !ok {
				w.WriteHeader(401)
				return
			}

			if username != config.Username || password != config.Password {
				w.WriteHeader(403)
				return
			}

			h.ServeHTTP(w, r)
		})
	}
}
