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
	"fmt"
	"go.uber.org/zap"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"database/sql"
	"github.com/heroiclabs/nakama/cmd"
	"github.com/heroiclabs/nakama/server"
	"net/url"

	_ "github.com/lib/pq"
	"github.com/golang/protobuf/jsonpb"
)

var (
	version  string = "2.0.0"
	commitID string = "test"
)

func main() {
	//startedAt := int64(time.Nanosecond) * time.Now().UTC().UnixNano() / int64(time.Millisecond)
	semver := fmt.Sprintf("%s+%s", version, commitID)
	// Always set default timeout on HTTP client.
	http.DefaultClient.Timeout = 1500 * time.Millisecond

	cmdLogger := server.NewJSONLogger(os.Stdout, true)

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version":
			fmt.Println(semver)
			return
		case "migrate":
			cmd.MigrateParse(os.Args[2:], cmdLogger)
		}
	}

	config := server.ParseArgs(cmdLogger, os.Args)
	jsonLogger, multiLogger := server.SetupLogging(config)

	multiLogger.Info("Nakama starting")
	multiLogger.Info("Node", zap.String("name", config.GetName()), zap.String("version", semver), zap.String("runtime", runtime.Version()))
	multiLogger.Info("Data directory", zap.String("path", config.GetDataDir()))
	multiLogger.Info("Database connections", zap.Strings("dsns", config.GetDatabase().Addresses))

	db, dbVersion := dbConnect(multiLogger, config.GetDatabase().Addresses)
	multiLogger.Info("Database information", zap.String("version", dbVersion))

	// Check migration status and log if the schema has diverged.
	cmd.MigrationStartupCheck(multiLogger, db)

	// Shared utility components.
	jsonpbMarshaler := &jsonpb.Marshaler{
		EnumsAsInts:  true,
		EmitDefaults: false,
		Indent:       "",
		OrigName:     false,
	}
	jsonpbUnmarshaler := &jsonpb.Unmarshaler{
		AllowUnknownFields: false,
	}

	// Start up server components.
	registry := server.NewSessionRegistry()
	tracker := server.StartLocalTracker(jsonLogger, registry, jsonpbMarshaler, config.GetName())
	router := server.NewLocalMessageRouter(registry, tracker, jsonpbMarshaler)
	runtimePool, err := server.NewRuntimePool(jsonLogger, multiLogger, db, config.GetRuntime(), registry, tracker, router)
	if err != nil {
		multiLogger.Fatal("Failed initializing runtime modules", zap.Error(err))
	}
	pipeline := server.NewPipeline(config, db, registry, tracker, router, runtimePool)
	apiServer := server.StartApiServer(jsonLogger, db, config, registry, tracker, pipeline, runtimePool, jsonpbMarshaler, jsonpbUnmarshaler)

	// Respect OS stop signals.
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	multiLogger.Info("Startup done")

	// Wait for a termination signal.
	<-c
	multiLogger.Info("Shutting down")

	// Gracefully stop server components.
	apiServer.Stop()
	tracker.Stop()
	registry.Stop()

	os.Exit(0)
}

func dbConnect(multiLogger *zap.Logger, dsns []string) (*sql.DB, string) {
	rawUrl := fmt.Sprintf("postgresql://%s?sslmode=disable", dsns[0])
	parsedUrl, err := url.Parse(rawUrl)
	if err != nil {
		multiLogger.Fatal("Bad database connection URL", zap.Error(err))
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

	var dbVersion string
	if err := db.QueryRow("SELECT version()").Scan(&dbVersion); err != nil {
		multiLogger.Fatal("Error querying database version", zap.Error(err))
	}

	return db, dbVersion
}
