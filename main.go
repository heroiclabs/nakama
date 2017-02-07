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
	"flag"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/armon/go-metrics"
	"github.com/go-yaml/yaml"
	_ "github.com/lib/pq"
	uuid "github.com/satori/go.uuid"
	"github.com/uber-go/zap"
	"nakama/cmd"
	"nakama/pkg/ga"
	"nakama/server"
)

const (
	cookieFilename = ".cookie"
)

var (
	version  string
	commitID string
	verboseLogging bool = true
)

func main() {
	semver := fmt.Sprintf("%s+%s", version, commitID)

	options := []zap.Option{zap.Output(os.Stdout), zap.LevelEnablerFunc(zapLevelEnabler)}
	if verboseLogging {
		options = append(options, zap.AddStacks(zap.ErrorLevel))
	}
	clogger := zap.New(zap.NewTextEncoder(zap.TextNoTime()), options...)


	if len(os.Args) > 1 {
		// TODO requires Zap to be set to Info level.
		switch os.Args[1] {
		case "--version":
			fmt.Println(semver)
			return
		case "doctor":
			cmd.DoctorParse(os.Args[2:])
		case "migrate":
			cmd.MigrateParse(os.Args[2:], clogger)
		}
	}

	config := parseArgs(clogger)

	memoryMetricSink := metrics.NewInmemSink(10*time.Second, time.Minute)
	metric := &metrics.FanoutSink{memoryMetricSink}
	metrics.NewGlobal(&metrics.Config{EnableRuntimeMetrics: true, ProfileInterval: 5 * time.Second}, metric)

	logger, mlogger := configureLogger(clogger, config)
	if verboseLogging {
		logger = mlogger
	}

	// Print startup information
	mlogger.Info("Nakama starting", zap.String("at", time.Now().UTC().Format("2006-01-02 15:04:05.000 -0700 MST")))
	mlogger.Info("Node", zap.String("name", config.GetName()), zap.String("version", semver))
	mlogger.Info("Data directory", zap.String("path", config.GetDataDir()))

	db := dbConnect(mlogger, config.GetDSNS())

	// Check migration status and log if the schema has diverged.
	cmd.MigrationStartupCheck(mlogger, db)

	trackerService := server.NewTrackerService(config.GetName())
	statsService := server.NewStatsService(logger, config, semver, trackerService)
	sessionRegistry := server.NewSessionRegistry(logger, config, trackerService)
	messageRouter := server.NewMessageRouterService(sessionRegistry)
	presenceNotifier := server.NewPresenceNotifier(logger, config.GetName(), trackerService, messageRouter)
	trackerService.AddDiffListener(presenceNotifier.HandleDiff)
	authService := server.NewAuthenticationService(logger, config, db, sessionRegistry, trackerService, messageRouter)
	opsService := server.NewOpsService(logger, mlogger, semver, config, statsService)

	// Always set default timeout on HTTP client
	http.DefaultClient.Timeout = 1500 * time.Millisecond

	gaenabled := len(os.Getenv("NAKAMA_TELEMETRY")) < 1

	cookie := newOrLoadCookie(config.GetDataDir())
	gacode := "UA-89792135-1"

	if gaenabled {
		runTelemetry(logger, http.DefaultClient, gacode, cookie)
	}

	// Respect OS stop signals
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-c
		mlogger.Info("Shutting down")

		trackerService.Stop()
		authService.Stop()
		opsService.Stop()

		if gaenabled {
			ga.SendSessionStop(http.DefaultClient, gacode, cookie)
		}

		os.Exit(0)
	}()

	authService.StartServer(mlogger)

	mlogger.Info("Startup done")
	select {}
}

func parseArgs(clogger zap.Logger) server.Config {
	config := server.NewConfig()

	flags := flag.NewFlagSet("main", flag.ExitOnError)
	flags.BoolVar(&verboseLogging, "verbose", false, "Turn verbose logging on.")
	var filepath string
	flags.StringVar(&filepath, "config", "", "The absolute file path to configuration YAML file.")
	var name string
	flags.StringVar(&name, "name", "", "The virtual name of this server.")
	var datadir string
	flags.StringVar(&datadir, "data-dir", "", "The data directory to store server logs.")
	var dsn string
	flags.StringVar(&dsn, "db", "", "The database connection DSN. (default root@127.0.0.1:26257)")
	var port int
	flags.IntVar(&port, "port", -1, "Set port for client connections; all other ports will also be set sequentially.")
	var opsPort int
	flags.IntVar(&opsPort, "ops-port", -1, "Set port for ops dashboard.")

	if len(filepath) > 0 {
		data, err := ioutil.ReadFile(filepath)
		if err != nil {
			clogger.Error("Could not read config file, using defaults", zap.Error(err))
		} else {
			err = yaml.Unmarshal([]byte(data), config)
			if err != nil {
				clogger.Error("Could not parse config file, using defaults", zap.Error(err))
			}
		}
	}

	if err := flags.Parse(os.Args[1:]); err != nil {
		clogger.Error("Could not parse command line arguments - ignoring command-line overrides", zap.Error(err))
	} else {
		if len(name) > 0 {
			config.Name = name
		}
		if len(datadir) > 0 {
			config.Datadir = datadir
		}
		if len(dsn) > 0 {
			config.Dsns = []string{dsn}
		}
		if port != -1 {
			config.Port = port
			config.OpsPort = port + 1
		}
		if opsPort != -1 {
			config.OpsPort = opsPort
		}
	}

	return config
}

func zapLevelEnabler(level zap.Level) bool {
	return verboseLogging || level > zap.DebugLevel
}

func configureLogger(clogger zap.Logger, config server.Config) (zap.Logger, zap.Logger) {
	err := os.MkdirAll(filepath.FromSlash(config.GetDataDir()+"/log"), 0755)
	if err != nil {
		clogger.Fatal("Could not create log directory", zap.Error(err))
		return nil, nil
	}

	file, err := os.Create(filepath.FromSlash(fmt.Sprintf("%v/log/%v.log", config.GetDataDir(), config.GetName())))
	if err != nil {
		clogger.Fatal("Could not create log file", zap.Error(err))
		return nil, nil
	}

	logger := zap.New(
		zap.NewJSONEncoder(zap.RFC3339Formatter("timestamp")),
		zap.Output(zap.AddSync(file)),
		zap.AddStacks(zap.ErrorLevel),
		zap.LevelEnablerFunc(zapLevelEnabler),
	)
	logger = logger.With(zap.String("server", config.GetName()))

	mlogger := zap.Tee(logger, clogger)

	return logger, mlogger
}

func dbConnect(multiLogger zap.Logger, dsns []string) *sql.DB {
	// TODO config database pooling
	db, err := sql.Open("postgres", "postgresql://"+dsns[0]+"/nakama?sslmode=disable")
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
func runTelemetry(logger zap.Logger, httpc *http.Client, gacode string, cookie string) {
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
