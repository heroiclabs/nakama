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
	"sync"
	"syscall"
	"time"

	"io/ioutil"
	"path/filepath"

	"github.com/golang/protobuf/jsonpb"
	"github.com/heroiclabs/nakama/ga"
	"github.com/heroiclabs/nakama/migrate"
	"github.com/heroiclabs/nakama/server"
	"github.com/heroiclabs/nakama/social"
	_ "github.com/lib/pq"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
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

	cmdLogger := server.NewJSONLogger(os.Stdout, true)

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version":
			fmt.Println(semver)
			return
		case "migrate":
			migrate.Parse(os.Args[2:], cmdLogger)
		}
	}

	config := server.ParseArgs(cmdLogger, os.Args)
	jsonLogger, multiLogger := server.SetupLogging(config)

	multiLogger.Info("Nakama starting")
	multiLogger.Info("Node", zap.String("name", config.GetName()), zap.String("version", semver), zap.String("runtime", runtime.Version()), zap.Int("cpu", runtime.NumCPU()))
	multiLogger.Info("Data directory", zap.String("path", config.GetDataDir()))
	multiLogger.Info("Database connections", zap.Strings("dsns", config.GetDatabase().Addresses))

	db, dbVersion := dbConnect(multiLogger, config)
	multiLogger.Info("Database information", zap.String("version", dbVersion))

	// Check migration status and fail fast if the schema has diverged.
	migrate.StartupCheck(multiLogger, db)

	// Access to social provider integrations.
	socialClient := social.NewClient(5 * time.Second)
	// Used to govern once-per-server-start executions in all Lua runtime instances, across both pooled and match VMs.
	once := &sync.Once{}

	// Start up server components.
	matchmaker := server.NewLocalMatchmaker(multiLogger, config.GetName())
	sessionRegistry := server.NewSessionRegistry()
	tracker := server.StartLocalTracker(jsonLogger, sessionRegistry, jsonpbMarshaler, config.GetName())
	router := server.NewLocalMessageRouter(sessionRegistry, tracker, jsonpbMarshaler)
	stdLibs, modules, err := server.LoadRuntimeModules(jsonLogger, multiLogger, config)
	if err != nil {
		multiLogger.Fatal("Failed reading runtime modules", zap.Error(err))
	}
	leaderboardCache := server.NewLocalLeaderboardCache(jsonLogger, multiLogger, db)
	matchRegistry := server.NewLocalMatchRegistry(jsonLogger, db, config, socialClient, leaderboardCache, sessionRegistry, tracker, router, stdLibs, once, config.GetName())
	tracker.SetMatchLeaveListener(matchRegistry.Leave)
	// Separate module evaluation/validation from module loading.
	// We need the match registry to be available to wire all functions exposed to the runtime, which in turn needs the modules at least cached first.
	regCallbacks, err := server.ValidateRuntimeModules(jsonLogger, multiLogger, db, config, socialClient, leaderboardCache, sessionRegistry, matchRegistry, tracker, router, stdLibs, modules, once)
	if err != nil {
		multiLogger.Fatal("Failed initializing runtime modules", zap.Error(err))
	}
	runtimePool := server.NewRuntimePool(jsonLogger, multiLogger, db, config, socialClient, leaderboardCache, sessionRegistry, matchRegistry, tracker, router, stdLibs, modules, regCallbacks, once)
	pipeline := server.NewPipeline(config, db, jsonpbMarshaler, jsonpbUnmarshaler, sessionRegistry, matchRegistry, matchmaker, tracker, router, runtimePool)
	metrics := server.NewMetrics(multiLogger, config)

	consoleServer := server.StartConsoleServer(jsonLogger, multiLogger, config, db)
	apiServer := server.StartApiServer(jsonLogger, multiLogger, db, jsonpbMarshaler, jsonpbUnmarshaler, config, socialClient, leaderboardCache, sessionRegistry, matchRegistry, matchmaker, tracker, router, pipeline, runtimePool)

	gaenabled := len(os.Getenv("NAKAMA_TELEMETRY")) < 1
	cookie := newOrLoadCookie(config)
	gacode := "UA-89792135-1"
	if gaenabled {
		runTelemetry(jsonLogger, http.DefaultClient, gacode, cookie)
	}

	// Respect OS stop signals.
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	multiLogger.Info("Startup done")

	// Wait for a termination signal.
	<-c
	multiLogger.Info("Shutting down")

	// Gracefully stop server components.
	apiServer.Stop()
	consoleServer.Stop()
	metrics.Stop(jsonLogger)
	matchRegistry.Stop()
	tracker.Stop()
	sessionRegistry.Stop()

	if gaenabled {
		ga.SendSessionStop(http.DefaultClient, gacode, cookie)
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

	if len(parsedUrl.Path) < 1 {
		parsedUrl.Path = "/nakama"
	}

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
func runTelemetry(logger *zap.Logger, httpc *http.Client, gacode string, cookie string) {
	err := ga.SendSessionStart(httpc, gacode, cookie)
	if err != nil {
		logger.Debug("Send start session event failed.", zap.Error(err))
		return
	}

	err = ga.SendEvent(httpc, gacode, cookie, &ga.Event{Ec: "version", Ea: fmt.Sprintf("%s+%s", version, commitID)})
	if err != nil {
		logger.Debug("Send event failed.", zap.Error(err))
		return
	}

	err = ga.SendEvent(httpc, gacode, cookie, &ga.Event{Ec: "variant", Ea: "nakama"})
	if err != nil {
		logger.Debug("Send event failed.", zap.Error(err))
		return
	}
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
