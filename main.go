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

package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"io/ioutil"
	"path/filepath"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/heroiclabs/nakama/v2/ga"
	"github.com/heroiclabs/nakama/v2/migrate"
	"github.com/heroiclabs/nakama/v2/server"
	"github.com/heroiclabs/nakama/v2/social"
	_ "github.com/jackc/pgx/stdlib"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const cookieFilename = ".cookie"

var (
	version  string = "2.0.0"
	commitID string = "dev"

	// Shared utility components.
	jsonpbMarshaler = &jsonpb.Marshaler{
		EnumsAsInts:  true,
		EmitDefaults: false,
		Indent:       "",
		OrigName:     true,
	}
	jsonpbUnmarshaler = &jsonpb.Unmarshaler{
		AllowUnknownFields: false,
	}
)

func main() {
	semver := fmt.Sprintf("%s+%s", version, commitID)
	// Always set default timeout on HTTP client.
	http.DefaultClient.Timeout = 1500 * time.Millisecond
	// Initialize the global random obj with customs seed.
	rand.Seed(time.Now().UnixNano())

	tmpLogger := server.NewJSONLogger(os.Stdout, zapcore.InfoLevel, server.JSONFormat)

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version":
			fmt.Println(semver)
			return
		case "migrate":
			migrate.Parse(os.Args[2:], tmpLogger)
		case "check":
			// Parse any command line args to look up runtime path.
			// Use full config structure even if not all of its options are available in this command.
			config := server.NewConfig(tmpLogger)
			var runtimePath string
			flags := flag.NewFlagSet("check", flag.ExitOnError)
			flags.StringVar(&runtimePath, "runtime.path", filepath.Join(config.GetDataDir(), "modules"), "Path for the server to scan for Lua and Go library files.")
			if err := flags.Parse(os.Args[2:]); err != nil {
				tmpLogger.Fatal("Could not parse check flags.")
			}
			config.GetRuntime().Path = runtimePath

			if err := server.CheckRuntime(tmpLogger, config); err != nil {
				// Errors are already logged in the function above.
				os.Exit(1)
			}
			return
		}
	}

	config := server.ParseArgs(tmpLogger, os.Args)
	logger, startupLogger := server.SetupLogging(tmpLogger, config)
	configWarnings := server.CheckConfig(logger, config)

	startupLogger.Info("Nakama starting")
	startupLogger.Info("Node", zap.String("name", config.GetName()), zap.String("version", semver), zap.String("runtime", runtime.Version()), zap.Int("cpu", runtime.NumCPU()), zap.Int("proc", runtime.GOMAXPROCS(0)))
	startupLogger.Info("Data directory", zap.String("path", config.GetDataDir()))
	startupLogger.Info("Database connections", zap.Strings("dsns", config.GetDatabase().Addresses))

	db, dbVersion := dbConnect(startupLogger, config)
	startupLogger.Info("Database information", zap.String("version", dbVersion))

	// Check migration status and fail fast if the schema has diverged.
	migrate.StartupCheck(startupLogger, db)

	// Access to social provider integrations.
	socialClient := social.NewClient(5 * time.Second)

	// Start up server components.
	matchmaker := server.NewLocalMatchmaker(startupLogger, config.GetName())
	sessionRegistry := server.NewLocalSessionRegistry()
	tracker := server.StartLocalTracker(logger, config, sessionRegistry, jsonpbMarshaler)
	router := server.NewLocalMessageRouter(sessionRegistry, tracker, jsonpbMarshaler)
	leaderboardCache := server.NewLocalLeaderboardCache(logger, startupLogger, db)
	leaderboardRankCache := server.NewLocalLeaderboardRankCache(startupLogger, db, config.GetLeaderboard(), leaderboardCache)
	leaderboardScheduler := server.NewLocalLeaderboardScheduler(logger, db, config, leaderboardCache, leaderboardRankCache)
	matchRegistry := server.NewLocalMatchRegistry(logger, startupLogger, config, tracker, router, config.GetName())
	tracker.SetMatchJoinListener(matchRegistry.Join)
	tracker.SetMatchLeaveListener(matchRegistry.Leave)
	streamManager := server.NewLocalStreamManager(config, sessionRegistry, tracker)
	runtime, err := server.NewRuntime(logger, startupLogger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, streamManager, router)
	if err != nil {
		startupLogger.Fatal("Failed initializing runtime modules", zap.Error(err))
	}

	leaderboardScheduler.Start(runtime)

	pipeline := server.NewPipeline(logger, config, db, jsonpbMarshaler, jsonpbUnmarshaler, sessionRegistry, matchRegistry, matchmaker, tracker, router, runtime)
	metricsExporter := server.NewMetricsExporter(logger)
	metrics := server.NewMetrics(logger, startupLogger, config, metricsExporter)
	statusHandler := server.NewLocalStatusHandler(logger, sessionRegistry, matchRegistry, tracker, metricsExporter, config.GetName())

	consoleServer := server.StartConsoleServer(logger, startupLogger, db, config, tracker, router, statusHandler, configWarnings, semver)
	apiServer := server.StartApiServer(logger, startupLogger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, sessionRegistry, matchRegistry, matchmaker, tracker, router, pipeline, runtime)

	gaenabled := len(os.Getenv("NAKAMA_TELEMETRY")) < 1
	cookie := newOrLoadCookie(config)
	const gacode = "UA-89792135-1"
	var telemetryClient *http.Client
	if gaenabled {
		telemetryClient = &http.Client{
			Timeout: 1500 * time.Millisecond,
		}
		runTelemetry(telemetryClient, gacode, cookie)
	}

	// Respect OS stop signals.
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	startupLogger.Info("Startup done")

	// Wait for a termination signal.
	<-c

	graceSeconds := config.GetShutdownGraceSec()

	// If a shutdown grace period is allowed, prepare a timer.
	var timer *time.Timer
	timerCh := make(<-chan time.Time, 1)
	if graceSeconds != 0 {
		timer = time.NewTimer(time.Duration(graceSeconds) * time.Second)
		timerCh = timer.C
		startupLogger.Info("Shutdown started - use CTRL^C to force stop server", zap.Int("grace_period_sec", graceSeconds))
	} else {
		// No grace period.
		startupLogger.Info("Shutdown started")
	}

	// Stop any running authoritative matches and do not accept any new ones.
	select {
	case <-matchRegistry.Stop(graceSeconds):
		// Graceful shutdown has completed.
	case <-timerCh:
		// Timer has expired, terminate matches immediately.
		startupLogger.Info("Shutdown grace period expired")
		<-matchRegistry.Stop(0)
	case <-c:
		// A second interrupt has been received.
		startupLogger.Info("Skipping graceful shutdown")
		<-matchRegistry.Stop(0)
	}
	if timer != nil {
		timer.Stop()
	}

	// Gracefully stop remaining server components.
	apiServer.Stop()
	consoleServer.Stop()
	metrics.Stop(logger)
	leaderboardScheduler.Stop()
	tracker.Stop()
	sessionRegistry.Stop()

	if gaenabled {
		_ = ga.SendSessionStop(telemetryClient, gacode, cookie)
	}

	startupLogger.Info("Shutdown complete")

	os.Exit(0)
}

func dbConnect(multiLogger *zap.Logger, config server.Config) (*sql.DB, string) {
	rawURL := fmt.Sprintf("postgresql://%s", config.GetDatabase().Addresses[0])
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		multiLogger.Fatal("Bad database connection URL", zap.Error(err))
	}
	query := parsedURL.Query()
	if len(query.Get("sslmode")) == 0 {
		query.Set("sslmode", "disable")
		parsedURL.RawQuery = query.Encode()
	}

	if len(parsedURL.User.Username()) < 1 {
		parsedURL.User = url.User("root")
	}
	if len(parsedURL.Path) < 1 {
		parsedURL.Path = "/nakama"
	}

	multiLogger.Debug("Complete database connection URL", zap.String("raw_url", parsedURL.String()))
	db, err := sql.Open("pgx", parsedURL.String())
	if err != nil {
		multiLogger.Fatal("Error connecting to database", zap.Error(err))
	}
	// Limit the time allowed to ping database and get version to 15 seconds total.
	ctx, _ := context.WithTimeout(context.Background(), 15*time.Second)
	if err = db.PingContext(ctx); err != nil {
		if strings.HasSuffix(err.Error(), "does not exist (SQLSTATE 3D000)") {
			multiLogger.Fatal("Database schema not found, run `nakama migrate up`", zap.Error(err))
		}
		multiLogger.Fatal("Error pinging database", zap.Error(err))
	}

	db.SetConnMaxLifetime(time.Millisecond * time.Duration(config.GetDatabase().ConnMaxLifetimeMs))
	db.SetMaxOpenConns(config.GetDatabase().MaxOpenConns)
	db.SetMaxIdleConns(config.GetDatabase().MaxIdleConns)

	var dbVersion string
	if err = db.QueryRowContext(ctx, "SELECT version()").Scan(&dbVersion); err != nil {
		multiLogger.Fatal("Error querying database version", zap.Error(err))
	}

	return db, dbVersion
}

// Help improve Nakama by sending anonymous usage statistics.
//
// You can disable the telemetry completely before server start by setting the
// environment variable "NAKAMA_TELEMETRY" - i.e. NAKAMA_TELEMETRY=0 nakama
//
// These properties are collected:
// * A unique UUID v4 random identifier which is generated.
// * Version of Nakama being used which includes build metadata.
// * Amount of time the server ran for.
//
// This information is sent via Google Analytics which allows the Nakama team to
// analyze usage patterns and errors in order to help improve the server.
func runTelemetry(httpc *http.Client, gacode string, cookie string) {
	if ga.SendSessionStart(httpc, gacode, cookie) != nil {
		return
	}
	if ga.SendEvent(httpc, gacode, cookie, &ga.Event{Ec: "version", Ea: fmt.Sprintf("%s+%s", version, commitID)}) != nil {
		return
	}
	_ = ga.SendEvent(httpc, gacode, cookie, &ga.Event{Ec: "variant", Ea: "nakama"})
}

func newOrLoadCookie(config server.Config) string {
	filePath := filepath.FromSlash(config.GetDataDir() + "/" + cookieFilename)
	b, err := ioutil.ReadFile(filePath)
	cookie := uuid.FromBytesOrNil(b)
	if err != nil || cookie == uuid.Nil {
		cookie = uuid.Must(uuid.NewV4())
		_ = ioutil.WriteFile(filePath, cookie.Bytes(), 0644)
	}
	return cookie.String()
}
