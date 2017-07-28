// Copyright 2017 The Nakama Authors
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
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"nakama/cmd"
	"nakama/pkg/ga"
	"nakama/server"

	"nakama/pkg/social"

	"github.com/armon/go-metrics"
	_ "github.com/lib/pq"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

const (
	cookieFilename = ".cookie"
)

var (
	version  string
	commitID string
)

func main() {
	startedAt := int64(time.Nanosecond) * time.Now().UTC().UnixNano() / int64(time.Millisecond)
	semver := fmt.Sprintf("%s+%s", version, commitID)
	http.DefaultClient.Timeout = 1500 * time.Millisecond // Always set default timeout on HTTP client

	cmdLogger := server.NewJSONLogger(os.Stdout, true) // or NewConsoleLogger
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version":
			fmt.Println(semver)
			return
		case "doctor":
			cmd.DoctorParse(os.Args[2:])
		case "migrate":
			cmd.MigrateParse(os.Args[2:], cmdLogger)
		}
	}

	config := server.ParseArgs(cmdLogger, os.Args)
	jsonLogger, multiLogger := server.SetupLogging(config)

	memoryMetricSink := metrics.NewInmemSink(10*time.Second, time.Minute)
	metric := &metrics.FanoutSink{memoryMetricSink}
	metrics.NewGlobal(&metrics.Config{EnableRuntimeMetrics: true, ProfileInterval: 5 * time.Second}, metric)

	// Print startup information
	multiLogger.Info("Nakama starting")
	multiLogger.Info("Node", zap.String("name", config.GetName()), zap.String("version", semver))
	multiLogger.Info("Data directory", zap.String("path", config.GetDataDir()))
	multiLogger.Info("Database connections", zap.Strings("dsns", config.GetDatabase().Addresses))

	db := dbConnect(multiLogger, config.GetDatabase().Addresses)

	// Check migration status and log if the schema has diverged.
	cmd.MigrationStartupCheck(multiLogger, db)

	trackerService := server.NewTrackerService(config.GetName())
	statsService := server.NewStatsService(jsonLogger, config, semver, trackerService, startedAt)
	matchmakerService := server.NewMatchmakerService(config.GetName())
	sessionRegistry := server.NewSessionRegistry(jsonLogger, config, trackerService, matchmakerService)
	messageRouter := server.NewMessageRouterService(sessionRegistry)
	presenceNotifier := server.NewPresenceNotifier(jsonLogger, config.GetName(), trackerService, messageRouter)
	trackerService.AddDiffListener(presenceNotifier.HandleDiff)
	notificationService := server.NewNotificationService(jsonLogger, db, trackerService, messageRouter, config.GetSocial().Notification)

	runtime, err := server.NewRuntime(jsonLogger, multiLogger, db, config.GetRuntime(), notificationService)
	if err != nil {
		multiLogger.Fatal("Failed initializing runtime modules.", zap.Error(err))
	}

	socialClient := social.NewClient(5 * time.Second)
	purchaseService := server.NewPurchaseService(jsonLogger, multiLogger, db, config.GetPurchase())
	pipeline := server.NewPipeline(config, db, trackerService, matchmakerService, messageRouter, sessionRegistry, socialClient, runtime, purchaseService, notificationService)
	authService := server.NewAuthenticationService(jsonLogger, config, db, statsService, sessionRegistry, socialClient, pipeline, runtime)
	dashboardService := server.NewDashboardService(jsonLogger, multiLogger, semver, config, statsService)

	gaenabled := len(os.Getenv("NAKAMA_TELEMETRY")) < 1
	cookie := newOrLoadCookie(config.GetDataDir())
	gacode := "UA-89792135-1"
	if gaenabled {
		runTelemetry(jsonLogger, http.DefaultClient, gacode, cookie)
	}

	// Respect OS stop signals
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-c
		multiLogger.Info("Shutting down")

		authService.Stop()
		dashboardService.Stop()
		trackerService.Stop()
		runtime.Stop()

		if gaenabled {
			ga.SendSessionStop(http.DefaultClient, gacode, cookie)
		}

		os.Exit(0)
	}()

	authService.StartServer(multiLogger)

	multiLogger.Info("Startup done")
	select {}
}

func dbConnect(multiLogger *zap.Logger, dsns []string) *sql.DB {
	// TODO config database pooling
	rawurl := fmt.Sprintf("postgresql://%s?sslmode=disable", dsns[0])
	url, err := url.Parse(rawurl)
	if err != nil {
		multiLogger.Fatal("Bad connection URL", zap.Error(err))
	}

	if len(url.Path) < 1 {
		url.Path = "/nakama"
	}

	db, err := sql.Open("postgres", url.String())
	if err != nil {
		multiLogger.Fatal("Error connecting to database", zap.Error(err))
	}
	err = db.Ping()
	if err != nil {
		multiLogger.Fatal("Error pinging database", zap.Error(err))
	}

	return db
}

// Help improve Nakama by sending anonymous usage statistics.
//
// You can disable the telemetry completely before server start by setting the
// environment variable "NAKAMA_TELEMETRY" - i.e. NAKAMA_TELEMETRY=0 nakama
//
// These properties are collected:
// * A unique UUID v4 random identifier which is generated
// * Version of Nakama being used which includes build metadata
// * Amount of time the server ran for
//
// This information is sent via Google Analytics which allows the Nakama team to
// analyze usage patterns and errors in order to help improve the server.
func runTelemetry(logger *zap.Logger, httpc *http.Client, gacode string, cookie string) {
	err := ga.SendSessionStart(httpc, gacode, cookie)
	if err != nil {
		logger.Debug("Send start session event failed.", zap.Error(err))
		return
	}

	// Send version info
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

func newOrLoadCookie(datadir string) string {
	filePath := filepath.FromSlash(datadir + "/" + cookieFilename)
	b, err := ioutil.ReadFile(filePath)
	cookie := uuid.FromBytesOrNil(b)
	if err != nil || cookie == uuid.Nil {
		cookie = uuid.NewV4()
		ioutil.WriteFile(filePath, cookie.Bytes(), 0644)
	}
	return cookie.String()
}
