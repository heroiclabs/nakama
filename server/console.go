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
	"fmt"
	"io/ioutil"
	"math"
	"net"
	"net/http"
	"net/http/pprof"
	"sort"
	"strings"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	grpcgw "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

var restrictedMethods = map[string]console.UserRole{
	"/nakama.console.Console/AddUser":           console.UserRole_USER_ROLE_ADMIN, // only admin can call this method
	"/nakama.console.Console/CreateUser":        console.UserRole_USER_ROLE_ADMIN,
	"/nakama.console.Console/DeleteUser":        console.UserRole_USER_ROLE_ADMIN,
	"/nakama.console.Console/DeleteAccounts":    console.UserRole_USER_ROLE_DEVELOPER, // only developer or admin can call this method
	"/nakama.console.Console/CallApiEndpoint":   console.UserRole_USER_ROLE_DEVELOPER, // only developer or admin can call this method
	"/nakama.console.Console/ListApiEndpoints":  console.UserRole_USER_ROLE_DEVELOPER, // only developer or admin can call this method
	"/nakama.console.Console/GetRuntime":        console.UserRole_USER_ROLE_DEVELOPER,
	"/nakama.console.Console/GetConfig":         console.UserRole_USER_ROLE_DEVELOPER,
	"/nakama.console.Console/DeleteLeaderboard": console.UserRole_USER_ROLE_DEVELOPER,
}

type ctxConsoleUsernameKey struct{}
type ctxConsoleEmailKey struct{}
type ctxConsoleRoleKey struct{}

type ConsoleServer struct {
	console.UnimplementedConsoleServer
	logger               *zap.Logger
	db                   *sql.DB
	config               Config
	tracker              Tracker
	router               MessageRouter
	sessionCache         SessionCache
	matchRegistry        MatchRegistry
	statusHandler        StatusHandler
	runtimeInfo          *RuntimeInfo
	configWarnings       map[string]string
	serverVersion        string
	ctxCancelFn          context.CancelFunc
	grpcServer           *grpc.Server
	grpcGatewayServer    *http.Server
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	api                  *ApiServer
	rpcMethodCache       *rpcReflectCache
	cookie               string
	httpClient           *http.Client
}

func StartConsoleServer(logger *zap.Logger, startupLogger *zap.Logger, db *sql.DB, config Config, tracker Tracker, router MessageRouter, sessionCache SessionCache, statusHandler StatusHandler, runtimeInfo *RuntimeInfo, matchRegistry MatchRegistry, configWarnings map[string]string, serverVersion string, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, api *ApiServer, cookie string) *ConsoleServer {
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

	ctx, ctxCancelFn := context.WithCancel(context.Background())

	s := &ConsoleServer{
		logger:               logger,
		db:                   db,
		config:               config,
		tracker:              tracker,
		router:               router,
		sessionCache:         sessionCache,
		matchRegistry:        matchRegistry,
		statusHandler:        statusHandler,
		configWarnings:       configWarnings,
		serverVersion:        serverVersion,
		ctxCancelFn:          ctxCancelFn,
		grpcServer:           grpcServer,
		runtimeInfo:          runtimeInfo,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		api:                  api,
		cookie:               cookie,
		httpClient:           &http.Client{Timeout: 5 * time.Second},
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
		grpc.WithInsecure(),
	}
	if err := console.RegisterConsoleHandlerFromEndpoint(ctx, grpcGateway, dialAddr, dialOpts); err != nil {
		startupLogger.Fatal("Console server gateway registration failed", zap.Error(err))
	}

	grpcGatewayRouter := mux.NewRouter()
	//zpagesMux := http.NewServeMux()
	//zpages.Handle(zpagesMux, "/metrics/")
	//grpcGatewayRouter.NewRoute().PathPrefix("/metrics").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	//	zpagesMux.ServeHTTP(w, r)
	//})

	grpcGatewayRouter.HandleFunc("/v2/console/storage/import", s.importStorage)

	// pprof routes
	grpcGatewayRouter.Handle("/debug/pprof/", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Index)))
	grpcGatewayRouter.Handle("/debug/pprof/cmdline", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Cmdline)))
	grpcGatewayRouter.Handle("/debug/pprof/profile", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Profile)))
	grpcGatewayRouter.Handle("/debug/pprof/symbol", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Symbol)))
	grpcGatewayRouter.Handle("/debug/pprof/trace", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Trace)))
	grpcGatewayRouter.Handle("/debug/pprof/{profile}", adminBasicAuth(config.GetConsole())(http.HandlerFunc(pprof.Index)))

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
		handlerWithMaxBody.ServeHTTP(w, r)
	})
	registerDashboardHandlers(logger, grpcGatewayRouter)

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

	// Run a background process to periodically refresh storage collection names.
	go func() {
		// Refresh function to update cache and return a delay until the next refresh should run.
		refreshFn := func() *time.Timer {
			startAt := time.Now()

			// Load all distinct collections from database.
			collections := make([]string, 0, 10)
			query := "SELECT DISTINCT collection FROM storage"
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

			elapsed := time.Now().Sub(startAt)
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

func registerDashboardHandlers(logger *zap.Logger, router *mux.Router) {
	indexFn := func(w http.ResponseWriter, r *http.Request) {
		indexFile, err := console.UIFS.Open("index.html")
		if err != nil {
			logger.Error("Failed to open index file.", zap.Error(err))
			w.WriteHeader(http.StatusNotFound)
			return
		}

		indexBytes, err := ioutil.ReadAll(indexFile)
		if err != nil {
			logger.Error("Failed to read index file.", zap.Error(err))
			w.WriteHeader(http.StatusNotFound)
			return
		}

		w.Header().Add("Cache-Control", "no-cache")
		w.Write(indexBytes)
		return
	}

	router.Path("/").HandlerFunc(indexFn)
	router.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// get the absolute path to prevent directory traversal
		path := r.URL.Path
		logger = logger.With(zap.String("path", path))

		// check whether a file exists at the given path
		if _, err := console.UIFS.Open(path); err == nil {
			// otherwise, use http.FileServer to serve the static dir
			r.URL.Path = path // override the path with the prefixed path
			console.UI.ServeHTTP(w, r)
			return
		} else {
			indexFn(w, r)
		}
	})
}

func (s *ConsoleServer) Stop() {
	s.ctxCancelFn()
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

		if ctx, ok = checkAuth(ctx, config, auth[0]); !ok {
			return nil, status.Error(codes.Unauthenticated, "Console authentication invalid.")
		}
		role := ctx.Value(ctxConsoleRoleKey{}).(console.UserRole)

		if restrictedRole, restrictionFound := restrictedMethods[info.FullMethod]; restrictionFound && role > restrictedRole {
			// if restriction was defined, and user role is higher (in number) than the restriction, block access
			return nil, status.Error(codes.PermissionDenied, "You don't have the necessary permissions to complete the operation.")
		}

		return handler(ctx, req)
	}
}

func checkAuth(ctx context.Context, config Config, auth string) (context.Context, bool) {
	const basicPrefix = "Basic "
	const bearerPrefix = "Bearer "

	if strings.HasPrefix(auth, basicPrefix) {
		// Basic authentication.
		username, password, ok := parseBasicAuth(auth)
		if !ok {
			return ctx, false
		}

		if username != config.GetConsole().Username || password != config.GetConsole().Password {
			// Username and/or password do not match.
			return ctx, false
		}

		ctx = context.WithValue(context.WithValue(context.WithValue(ctx, ctxConsoleRoleKey{}, console.UserRole_USER_ROLE_ADMIN), ctxConsoleUsernameKey{}, username), ctxConsoleEmailKey{}, "")
		// Basic authentication successful.
		return ctx, true
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
			return ctx, false
		}
		uname, email, role, exp, ok := parseConsoleToken([]byte(config.GetConsole().SigningKey), auth[len(bearerPrefix):])
		if !ok || !token.Valid {
			// The token or its claims are invalid.
			return ctx, false
		}
		if !ok {
			// Expiry time claim is invalid.
			return ctx, false
		}
		if exp <= time.Now().UTC().Unix() {
			// Token expired.
			return ctx, false
		}

		ctx = context.WithValue(context.WithValue(context.WithValue(ctx, ctxConsoleRoleKey{}, role), ctxConsoleUsernameKey{}, uname), ctxConsoleEmailKey{}, email)

		return ctx, true
	}

	return ctx, false
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
