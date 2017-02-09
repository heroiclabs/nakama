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
	"net/url"
	"os"
	"time"

	"math"
	"nakama/build/generated/migration"

	"github.com/rubenv/sql-migrate"
	"github.com/uber-go/zap"
)

const (
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
	DSNS       string
	Limit      int
	logger     zap.Logger
	migrations *migrate.AssetMigrationSource
	db         *sql.DB
}

func MigrationStartupCheck(logger zap.Logger, db *sql.DB) {
	migrate.SetTable(migrationTable)
	ms := &migrate.AssetMigrationSource{
		Asset:    migration.Asset,
		AssetDir: migration.AssetDir,
	}

	migrations, err := ms.FindMigrations()
	if err != nil {
		logger.Error("Could not find migrations", zap.Error(err))
	}
	records, err := migrate.GetMigrationRecords(db, dialect)
	if err != nil {
		logger.Error("Could not get migration records", zap.Error(err))
	}

	diff := len(migrations) - len(records)
	if diff > 0 {
		logger.Warn("DB schema outdated, run `nakama migrate up`", zap.Object("migrations", diff))
	}
	if diff < 0 {
		logger.Warn("DB schema newer, update Nakama", zap.Object("migrations", int64(math.Abs(float64(diff)))))
	}
}

func MigrateParse(args []string, logger zap.Logger) {
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

	rawurl := fmt.Sprintf("postgresql://%s?sslmode=disable", ms.DSNS)
	url, err := url.Parse(rawurl)
	if err != nil {
		logger.Fatal("Bad connection URL", zap.Error(err))
	}

	dbname := "nakama"
	if len(url.Path) > 1 {
		dbname = url.Path[1:]
	}

	url.Path = ""
	db, err := sql.Open(dialect, url.String())
	if err != nil {
		logger.Fatal("Failed to open database", zap.Error(err))
	}
	if err = db.Ping(); err != nil {
		logger.Fatal("Error pinging database", zap.Error(err))
	}

	_, err = db.Exec(fmt.Sprintf("CREATE DATABASE %s", dbname))
	if err != nil {
		logger.Info("Database could not be created", zap.Error(err))
	}
	db.Close()

	// Append dbname to data source name.
	url.Path = fmt.Sprintf("/%s", dbname)
	db, err = sql.Open(dialect, url.String())
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
	if ms.Limit < defaultLimit {
		ms.Limit = 0
	}

	appliedMigrations, err := migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Up, ms.Limit)
	if err != nil {
		ms.logger.Fatal("Failed to apply migrations", zap.Int("count", appliedMigrations), zap.Error(err))
	}

	ms.logger.Info("Successfully applied migration", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) down() {
	if ms.Limit < defaultLimit {
		ms.Limit = 1
	}

	appliedMigrations, err := migrate.ExecMax(ms.db, dialect, ms.migrations, migrate.Down, ms.Limit)
	if err != nil {
		ms.logger.Fatal("Failed to migrate back", zap.Int("count", appliedMigrations), zap.Error(err))
	}

	ms.logger.Info("Successfully migrated back", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) redo() {
	if ms.Limit > defaultLimit {
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
	if ms.Limit > defaultLimit {
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
	flags.StringVar(&ms.DSNS, "db", "root@localhost:26257", "CockroachDB JDBC connection details.")
	flags.IntVar(&ms.Limit, "limit", defaultLimit, "Number of migrations to apply forwards or backwards.")

	if err := flags.Parse(args); err != nil {
		ms.logger.Fatal("Could not parse migration flags.")
	}

	if ms.DSNS == "" {
		ms.logger.Fatal("Database connection details are required.")
	}
}
