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
	"database/sql"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"io/ioutil"
	"path/filepath"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/heroiclabs/nakama/ga"
	"github.com/heroiclabs/nakama/migrate"
	"github.com/heroiclabs/nakama/server"
	"github.com/heroiclabs/nakama/social"
	_ "github.com/lib/pq"
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
	//startedAt := int64(time.Nanosecond) * time.Now().UTC().UnixNano() / int64(time.Millisecond)
	semver := fmt.Sprintf("%s+%s", version, commitID)
	// Always set default timeout on HTTP client.
	http.DefaultClient.Timeout = 1500 * time.Millisecond
	// Initialize the global random obj with customs seed.
	rand.Seed(time.Now().UnixNano())

	tmpLogger := server.NewJSONLogger(os.Stdout, zapcore.InfoLevel)

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version":
			fmt.Println(semver)
			return
		case "migrate":
			migrate.Parse(os.Args[2:], tmpLogger)
		}
	}

	config := server.ParseArgs(tmpLogger, os.Args)
	logger, startupLogger := server.SetupLogging(tmpLogger, config)

	startupLogger.Info("Nakama starting")
	startupLogger.Info("Node", zap.String("name", config.GetName()), zap.String("version", semver), zap.String("runtime", runtime.Version()), zap.Int("cpu", runtime.NumCPU()))
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
	sessionRegistry := server.NewSessionRegistry()
	tracker := server.StartLocalTracker(logger, sessionRegistry, jsonpbMarshaler, config.GetName())
	router := server.NewLocalMessageRouter(sessionRegistry, tracker, jsonpbMarshaler)
	leaderboardCache := server.NewLocalLeaderboardCache(logger, startupLogger, db)
	leaderboardRankCache := server.NewLocalLeaderboardRankCache(logger, startupLogger, db, config.GetLeaderboard(), leaderboardCache)
	leaderboardScheduler := server.NewLeaderboardScheduler(logger, db, leaderboardCache, leaderboardRankCache)
	matchRegistry := server.NewLocalMatchRegistry(logger, config, tracker, config.GetName())
	tracker.SetMatchJoinListener(matchRegistry.Join)
	tracker.SetMatchLeaveListener(matchRegistry.Leave)
	runtime, err := server.NewRuntime(logger, startupLogger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, router)
	if err != nil {
		startupLogger.Fatal("Failed initializing runtime modules", zap.Error(err))
	}

	leaderboardScheduler.Start(runtime)

	pipeline := server.NewPipeline(logger, config, db, jsonpbMarshaler, jsonpbUnmarshaler, sessionRegistry, matchRegistry, matchmaker, tracker, router, runtime)
	metrics := server.NewMetrics(logger, startupLogger, config)

	consoleServer := server.StartConsoleServer(logger, startupLogger, config, db)
	apiServer := server.StartApiServer(logger, startupLogger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, sessionRegistry, matchRegistry, matchmaker, tracker, router, pipeline, runtime)

	gaenabled := len(os.Getenv("NAKAMA_TELEMETRY")) < 1
	cookie := newOrLoadCookie(config)
	gacode := "UA-89792135-1"
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
	startupLogger.Info("Shutting down")

	// Gracefully stop server components.
	apiServer.Stop()
	consoleServer.Stop()
	metrics.Stop(logger)
	leaderboardScheduler.Stop()
	matchRegistry.Stop()
	tracker.Stop()
	sessionRegistry.Stop()

	if gaenabled {
		ga.SendSessionStop(telemetryClient, gacode, cookie)
	}

	os.Exit(0)
}

func dbConnect(multiLogger *zap.Logger, config server.Config) (*sql.DB, string) {
	rawUrl := fmt.Sprintf("postgresql://%s", config.GetDatabase().Addresses[0])
	parsedUrl, err := url.Parse(rawUrl)
	if err != nil {
		multiLogger.Fatal("Bad database connection URL", zap.Error(err))
	}
	query := parsedUrl.Query()
	if len(query.Get("sslmode")) == 0 {
		query.Set("sslmode", "disable")
		parsedUrl.RawQuery = query.Encode()
	}

	if len(parsedUrl.User.Username()) < 1 {
		parsedUrl.User = url.User("root")
	}
	if len(parsedUrl.Path) < 1 {
		parsedUrl.Path = "/nakama"
	}

	multiLogger.Debug("Complete database connection URL", zap.String("raw_url", parsedUrl.String()))
	db, err := sql.Open("postgres", parsedUrl.String())
	if err != nil {
		multiLogger.Fatal("Error connecting to database", zap.Error(err))
	}
	err = db.Ping()
	if err != nil {
		multiLogger.Fatal("Error pinging database", zap.Error(err))
	}

	db.SetConnMaxLifetime(time.Millisecond * time.Duration(config.GetDatabase().ConnMaxLifetimeMs))
	db.SetMaxOpenConns(config.GetDatabase().MaxOpenConns)
	db.SetMaxIdleConns(config.GetDatabase().MaxIdleConns)

	var dbVersion string
	if err := db.QueryRow("SELECT version()").Scan(&dbVersion); err != nil {
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
	ga.SendEvent(httpc, gacode, cookie, &ga.Event{Ec: "variant", Ea: "nakama"})
}

func newOrLoadCookie(config server.Config) string {
	filePath := filepath.FromSlash(config.GetDataDir() + "/" + cookieFilename)
	b, err := ioutil.ReadFile(filePath)
	cookie := uuid.FromBytesOrNil(b)
	if err != nil || cookie == uuid.Nil {
		cookie = uuid.Must(uuid.NewV4())
		ioutil.WriteFile(filePath, cookie.Bytes(), 0644)
	}
	return cookie.String()
}
