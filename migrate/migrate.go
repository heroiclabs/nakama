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

package migrate

import (
	"database/sql"
	"flag"
	"fmt"
	"math"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gobuffalo/packr"
	"github.com/heroiclabs/nakama/v2/server"
	"github.com/jackc/pgx"
	_ "github.com/jackc/pgx/stdlib" // Blank import to register SQL driver
	"github.com/rubenv/sql-migrate"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const (
	dbErrorDuplicateDatabase = "42P04"
	migrationTable           = "migration_info"
	dialect                  = "postgres"
	defaultLimit             = -1
)

type statusRow struct {
	ID        string
	Migrated  bool
	AppliedAt time.Time
}

type migrationService struct {
	dbAddress    string
	limit        int
	loggerFormat server.LoggingFormat
	migrations   *migrate.AssetMigrationSource
	db           *sql.DB
}

func StartupCheck(logger *zap.Logger, db *sql.DB) {
	migrate.SetTable(migrationTable)

	migrationBox := packr.NewBox("./sql") // path must be string not a variable for packr to understand
	ms := &migrate.AssetMigrationSource{
		Asset: migrationBox.Find,
		AssetDir: func(path string) ([]string, error) {
			return migrationBox.List(), nil
		},
	}

	migrations, err := ms.FindMigrations()
	if err != nil {
		logger.Fatal("Could not find migrations", zap.Error(err))
	}
	records, err := migrate.GetMigrationRecords(db, dialect)
	if err != nil {
		logger.Fatal("Could not get migration records, run `nakama migrate up`", zap.Error(err))
	}

	diff := len(migrations) - len(records)
	if diff > 0 {
		logger.Fatal("DB schema outdated, run `nakama migrate up`", zap.Int("migrations", diff))
	}
	if diff < 0 {
		logger.Warn("DB schema newer, update Nakama", zap.Int64("migrations", int64(math.Abs(float64(diff)))))
	}
}

func Parse(args []string, tmpLogger *zap.Logger) {
	if len(args) == 0 {
		tmpLogger.Fatal("Migrate requires a subcommand. Available commands are: 'up', 'down', 'redo', 'status'.")
	}

	migrate.SetTable(migrationTable)
	migrationBox := packr.NewBox("./sql") // path must be string not a variable for packr to understand
	ms := &migrationService{
		migrations: &migrate.AssetMigrationSource{
			Asset: migrationBox.Find,
			AssetDir: func(path string) ([]string, error) {
				return migrationBox.List(), nil
			},
		},
	}

	var exec func(logger *zap.Logger)
	switch args[0] {
	case "up":
		exec = ms.up
	case "down":
		exec = ms.down
	case "redo":
		exec = ms.redo
	case "status":
		exec = ms.status
	default:
		tmpLogger.Fatal("Unrecognized migrate subcommand. Available commands are: 'up', 'down', 'redo', 'status'.")
		return
	}

	ms.parseSubcommand(args[1:], tmpLogger)
	logger := server.NewJSONLogger(os.Stdout, zapcore.InfoLevel, ms.loggerFormat)

	rawURL := fmt.Sprintf("postgresql://%s", ms.dbAddress)
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		logger.Fatal("Bad connection URL", zap.Error(err))
	}
	query := parsedURL.Query()
	if len(query.Get("sslmode")) == 0 {
		query.Set("sslmode", "disable")
		parsedURL.RawQuery = query.Encode()
	}

	if len(parsedURL.User.Username()) < 1 {
		parsedURL.User = url.User("root")
	}
	dbname := "nakama"
	if len(parsedURL.Path) > 1 {
		dbname = parsedURL.Path[1:]
	}

	logger.Info("Database connection", zap.String("dsn", ms.dbAddress))

	parsedURL.Path = ""
	db, err := sql.Open("pgx", parsedURL.String())
	if err != nil {
		logger.Fatal("Failed to open database", zap.Error(err))
	}
	if err = db.Ping(); err != nil {
		logger.Fatal("Error pinging database", zap.Error(err))
	}

	var dbVersion string
	if err = db.QueryRow("SELECT version()").Scan(&dbVersion); err != nil {
		logger.Fatal("Error querying database version", zap.Error(err))
	}
	logger.Info("Database information", zap.String("version", dbVersion))

	if _, err = db.Exec(fmt.Sprintf("CREATE DATABASE %q", dbname)); err != nil {
		if e, ok := err.(pgx.PgError); ok && e.Code == dbErrorDuplicateDatabase {
			logger.Info("Using existing database", zap.String("name", dbname))
		} else {
			logger.Fatal("Database query failed", zap.Error(err))
		}
	} else {
		logger.Info("Creating new database", zap.String("name", dbname))
	}
	_ = db.Close()

	// Append dbname to data source name.
	parsedURL.Path = fmt.Sprintf("/%s", dbname)
	db, err = sql.Open("pgx", parsedURL.String())
	if err != nil {
		logger.Fatal("Failed to open database", zap.Error(err))
	}
	if err = db.Ping(); err != nil {
		logger.Fatal("Error pinging database", zap.Error(err))
	}
	ms.db = db

	exec(logger)
	os.Exit(0)
}

func (ms *migrationService) up(logger *zap.Logger) {
	if ms.limit < defaultLimit {
		ms.limit = 0
	}

	appliedMigrations, err := migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Up, ms.limit)
	if err != nil {
		logger.Fatal("Failed to apply migrations", zap.Int("count", appliedMigrations), zap.Error(err))
	}

	logger.Info("Successfully applied migration", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) down(logger *zap.Logger) {
	if ms.limit < defaultLimit {
		ms.limit = 1
	}

	appliedMigrations, err := migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Down, ms.limit)
	if err != nil {
		logger.Fatal("Failed to migrate back", zap.Int("count", appliedMigrations), zap.Error(err))
	}

	logger.Info("Successfully migrated back", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) redo(logger *zap.Logger) {
	if ms.limit > defaultLimit {
		logger.Warn("Limit is ignored when redo is invoked")
	}

	appliedMigrations, err := migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Down, 1)
	if err != nil {
		logger.Fatal("Failed to migrate back", zap.Int("count", appliedMigrations), zap.Error(err))
	}
	logger.Info("Successfully migrated back", zap.Int("count", appliedMigrations))

	appliedMigrations, err = migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Up, 1)
	if err != nil {
		logger.Fatal("Failed to apply migrations", zap.Int("count", appliedMigrations), zap.Error(err))
	}
	logger.Info("Successfully applied migration", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) status(logger *zap.Logger) {
	if ms.limit > defaultLimit {
		logger.Warn("Limit is ignored when status is invoked")
	}

	migrations, err := ms.migrations.FindMigrations()
	if err != nil {
		logger.Fatal("Could not find migrations", zap.Error(err))
	}

	records, err := migrate.GetMigrationRecords(ms.db, dialect)
	if err != nil {
		logger.Fatal("Could not get migration records", zap.Error(err))
	}

	rows := make(map[string]*statusRow)

	for _, m := range migrations {
		rows[m.Id] = &statusRow{
			ID:       m.Id,
			Migrated: false,
		}
	}

	for _, r := range records {
		rows[r.Id].Migrated = true
		rows[r.Id].AppliedAt = r.AppliedAt
	}

	for _, m := range migrations {
		if rows[m.Id].Migrated {
			logger.Info(m.Id, zap.String("applied", rows[m.Id].AppliedAt.Format(time.RFC822Z)))
		} else {
			logger.Info(m.Id, zap.String("applied", ""))
		}
	}
}

func (ms *migrationService) parseSubcommand(args []string, logger *zap.Logger) {
	var loggerFormat string
	flags := flag.NewFlagSet("migrate", flag.ExitOnError)
	flags.StringVar(&ms.dbAddress, "database.address", "root@localhost:26257", "Address of CockroachDB server (username:password@address:port/dbname)")
	flags.IntVar(&ms.limit, "limit", defaultLimit, "Number of migrations to apply forwards or backwards.")
	flags.StringVar(&loggerFormat, "logger.format", "json", "Number of migrations to apply forwards or backwards.")

	if err := flags.Parse(args); err != nil {
		logger.Fatal("Could not parse migration flags.")
	}

	if ms.dbAddress == "" {
		logger.Fatal("Database connection details are required.")
	}

	ms.loggerFormat = server.JSONFormat
	switch strings.ToLower(loggerFormat) {
	case "":
		fallthrough
	case "json":
		ms.loggerFormat = server.JSONFormat
	case "stackdriver":
		ms.loggerFormat = server.StackdriverFormat
	default:
		logger.Fatal("Logger mode invalid, must be one of: '', 'json', or 'stackdriver")
	}
}
