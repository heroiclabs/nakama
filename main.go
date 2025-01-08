package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/heroiclabs/nakama/v3/migrate"
	"github.com/heroiclabs/nakama/v3/se"
	"github.com/heroiclabs/nakama/v3/server"
	"github.com/heroiclabs/nakama/v3/social"
	"github.com/jackc/pgx/v5/stdlib"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/protobuf/encoding/protojson"

	_ "github.com/klauspost/compress"
	_ "github.com/prometheus/client_golang/prometheus"
	_ "github.com/prometheus/common/model"
)

const cookieFilename = ".cookie"

var (
	version  string = "3.0.0"
	commitID string = "dev"

	jsonpbMarshaler = &protojson.MarshalOptions{
		UseEnumNumbers:  true,
		EmitUnpopulated: false,
		Indent:          "",
		UseProtoNames:   true,
	}
	jsonpbUnmarshaler = &protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}
)

func main() {
	defer os.Exit(0)

	semver := fmt.Sprintf("%s+%s", version, commitID)
	http.DefaultClient.Timeout = 1500 * time.Millisecond

	// Use updated zap logger configuration
	tmpLogger, _ := zap.NewProduction()
	defer tmpLogger.Sync()

	ctx, ctxCancelFn := context.WithCancel(context.Background())

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version":
			fmt.Println(semver)
			return
		case "migrate":
			config := server.ParseArgs(tmpLogger.Sugar(), os.Args[2:])
			server.ValidateConfigDatabase(tmpLogger.Sugar(), config)
			db := server.DbConnect(ctx, tmpLogger.Sugar(), config, true)
			defer db.Close()

			conn, err := db.Conn(ctx)
			if err != nil {
				tmpLogger.Fatal("Failed to acquire db conn for migration", zap.Error(err))
			}

			if err = conn.Raw(func(driverConn any) error {
				pgxConn := driverConn.(*stdlib.Conn).Conn()
				migrate.RunCmd(ctx, tmpLogger.Sugar(), pgxConn, os.Args[2], config.GetLimit(), config.GetLogger().Format)

				return nil
			}); err != nil {
				conn.Close()
				tmpLogger.Fatal("Failed to acquire pgx conn for migration", zap.Error(err))
			}
			conn.Close()
			return
		case "healthcheck":
			port := "7350"
			if len(os.Args) > 2 {
				port = os.Args[2]
			}

			resp, err := http.Get("http://localhost:" + port)
			if err != nil || resp.StatusCode != http.StatusOK {
				tmpLogger.Fatal("Healthcheck failed")
			}
			tmpLogger.Info("Healthcheck ok")
			return
		}
	}

	config := server.ParseArgs(tmpLogger.Sugar(), os.Args)
	logger, startupLogger := server.SetupLogging(tmpLogger.Sugar(), config)
	configWarnings := server.ValidateConfig(logger, config)

	startupLogger.Info("Nakama starting", zap.String("version", semver))

	// Updated database redaction
	redactedAddresses := redactDatabaseAddresses(config)
	startupLogger.Info("Database connections", zap.Strings("dsns", redactedAddresses))

	db := server.DbConnect(ctx, startupLogger, config, false)

	// Check migration status and fail fast if the schema has diverged.
	checkMigrationStatus(ctx, logger, startupLogger, db)

	// Social client updated timeout
	socialClient := social.NewClient(logger, 10*time.Second, config.GetGoogleAuth().OAuthConfig)

	// More updates and initialization as per new APIs...
	// For brevity, this section remains unchanged in this snippet.

	startupLogger.Info("Startup done")

	// Wait for a termination signal.
	waitForShutdown(ctx, logger, startupLogger, ctxCancelFn)
}

// Function to redact database addresses
func redactDatabaseAddresses(config server.Config) []string {
	redactedAddresses := make([]string, len(config.GetDatabase().Addresses))
	for i, address := range config.GetDatabase().Addresses {
		rawURL := fmt.Sprintf("postgres://%s", address)
		parsedURL, err := url.Parse(rawURL)
		if err != nil {
			panic(fmt.Sprintf("Invalid database address: %s", err))
		}
		redactedAddresses[i] = strings.TrimPrefix(parsedURL.Redacted(), "postgres://")
	}
	return redactedAddresses
}

// Function to check migration status
func checkMigrationStatus(ctx context.Context, logger, startupLogger *zap.Logger, db server.Db) {
	conn, err := db.Conn(ctx)
	if err != nil {
		logger.Fatal("Failed to acquire db conn for migration check", zap.Error(err))
	}
	defer conn.Close()

	if err = conn.Raw(func(driverConn any) error {
		pgxConn := driverConn.(*stdlib.Conn).Conn()
		migrate.Check(ctx, startupLogger, pgxConn)
		return nil
	}); err != nil {
		logger.Fatal("Migration check failed", zap.Error(err))
	}
}

// Wait for graceful shutdown
func waitForShutdown(ctx context.Context, logger, startupLogger *zap.Logger, ctxCancelFn context.CancelFunc) {
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	<-c
	logger.Info("Shutting down...")
	ctxCancelFn()
	logger.Info("Shutdown complete")
}
