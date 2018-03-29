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

package cmd

import (
	"database/sql"
	"flag"
	"fmt"
	"math"
	"net/url"
	"os"
	"time"

	"nakama/build/generated/migration"

	"github.com/rubenv/sql-migrate"
	"go.uber.org/zap"
	"github.com/lib/pq"
)

const (
	dbErrorDuplicateDatabase = "42P04"
	migrationTable = "migration_info"
	dialect        = "postgres"
	defaultLimit   = -1
)

type statusRow struct {
	ID        string
	Migrated  bool
	AppliedAt time.Time
}

type migrationService struct {
	dbAddress  string
	limit      int
	logger     *zap.Logger
	migrations *migrate.AssetMigrationSource
	db         *sql.DB
}

func MigrationStartupCheck(logger *zap.Logger, db *sql.DB) {
	migrate.SetTable(migrationTable)
	ms := &migrate.AssetMigrationSource{
		Asset:    migration.Asset,
		AssetDir: migration.AssetDir,
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

func MigrateParse(args []string, logger *zap.Logger) {
	if len(args) == 0 {
		logger.Fatal("Migrate requires a subcommand. Available commands are: 'up', 'down', 'redo', 'status'.")
	}

	migrate.SetTable(migrationTable)
	ms := &migrationService{
		logger: logger,
		migrations: &migrate.AssetMigrationSource{
			Asset:    migration.Asset,
			AssetDir: migration.AssetDir,
		},
	}

	var exec func()
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
		logger.Fatal("Unrecognized migrate subcommand. Available commands are: 'up', 'down', 'redo', 'status'.")
	}

	ms.parseSubcommand(args[1:])

	rawUrl := fmt.Sprintf("postgresql://%s", ms.dbAddress)
	parsedUrl, err := url.Parse(rawUrl)
	if err != nil {
		logger.Fatal("Bad connection URL", zap.Error(err))
	}

	query := parsedUrl.Query()
	if len(query.Get("sslmode")) == 0 {
		query.Set("sslmode", "disable")
		parsedUrl.RawQuery = query.Encode()
	}

	dbname := "nakama"
	if len(parsedUrl.Path) > 1 {
		dbname = parsedUrl.Path[1:]
	}

	logger.Info("Database connection", zap.String("db", ms.dbAddress))

	parsedUrl.Path = ""
	db, err := sql.Open(dialect, parsedUrl.String())
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

	if _, err = db.Exec(fmt.Sprintf("CREATE DATABASE %s", dbname)); err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorDuplicateDatabase {
			logger.Info("Using existing database", zap.String("name", dbname))
		} else {
			logger.Fatal("Database query failed", zap.Error(err))
		}
	} else {
		logger.Info("Creating new database", zap.String("name", dbname))
	}
	db.Close()

	// Append dbname to data source name.
	parsedUrl.Path = fmt.Sprintf("/%s", dbname)
	db, err = sql.Open(dialect, parsedUrl.String())
	if err != nil {
		logger.Fatal("Failed to open database", zap.Error(err))
	}
	if err = db.Ping(); err != nil {
		logger.Fatal("Error pinging database", zap.Error(err))
	}
	ms.db = db

	exec()
	os.Exit(0)
}

func (ms *migrationService) up() {
	if ms.limit < defaultLimit {
		ms.limit = 0
	}

	appliedMigrations, err := migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Up, ms.limit)
	if err != nil {
		ms.logger.Fatal("Failed to apply migrations", zap.Int("count", appliedMigrations), zap.Error(err))
	}

	ms.logger.Info("Successfully applied migration", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) down() {
	if ms.limit < defaultLimit {
		ms.limit = 1
	}

	appliedMigrations, err := migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Down, ms.limit)
	if err != nil {
		ms.logger.Fatal("Failed to migrate back", zap.Int("count", appliedMigrations), zap.Error(err))
	}

	ms.logger.Info("Successfully migrated back", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) redo() {
	if ms.limit > defaultLimit {
		ms.logger.Warn("Limit is ignored when redo is invoked")
	}

	appliedMigrations, err := migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Down, 1)
	if err != nil {
		ms.logger.Fatal("Failed to migrate back", zap.Int("count", appliedMigrations), zap.Error(err))
	}
	ms.logger.Info("Successfully migrated back", zap.Int("count", appliedMigrations))

	appliedMigrations, err = migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Up, 1)
	if err != nil {
		ms.logger.Fatal("Failed to apply migrations", zap.Int("count", appliedMigrations), zap.Error(err))
	}
	ms.logger.Info("Successfully applied migration", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) status() {
	if ms.limit > defaultLimit {
		ms.logger.Warn("Limit is ignored when status is invoked")
	}

	migrations, err := ms.migrations.FindMigrations()
	if err != nil {
		ms.logger.Fatal("Could not find migrations", zap.Error(err))
	}

	records, err := migrate.GetMigrationRecords(ms.db, dialect)
	if err != nil {
		ms.logger.Fatal("Could not get migration records", zap.Error(err))
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
			ms.logger.Info(m.Id, zap.String("applied", rows[m.Id].AppliedAt.Format(time.RFC822Z)))
		} else {
			ms.logger.Info(m.Id, zap.String("applied", ""))
		}
	}
}

func (ms *migrationService) parseSubcommand(args []string) {
	flags := flag.NewFlagSet("migrate", flag.ExitOnError)
	flags.StringVar(&ms.dbAddress, "database.address", "root@localhost:26257", "Address of CockroachDB server (username:password@address:port/dbname)")
	flags.IntVar(&ms.limit, "limit", defaultLimit, "Number of migrations to apply forwards or backwards.")

	if err := flags.Parse(args); err != nil {
		ms.logger.Fatal("Could not parse migration flags.")
	}

	if ms.dbAddress == "" {
		ms.logger.Fatal("Database connection details are required.")
	}
}
