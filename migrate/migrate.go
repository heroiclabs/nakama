// Copyright 2021 Heroic Labs.
// All rights reserved.
//
// NOTICE: All information contained herein is, and remains the property of Heroic
// Labs. and its suppliers, if any. The intellectual and technical concepts
// contained herein are proprietary to Heroic Labs. and its suppliers and may be
// covered by U.S. and Foreign Patents, patents in process, and are protected by
// trade secret or copyright law. Dissemination of this information or reproduction
// of this material is strictly forbidden unless prior written permission is
// obtained from Heroic Labs.

package migrate

import (
	"context"
	"embed"
	"math"
	"os"
	"strings"
	"time"

	"github.com/heroiclabs/nakama/v3/server"
	sqlmigrate "github.com/heroiclabs/sql-migrate"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	_ "github.com/jackc/pgx/v5/stdlib" // Blank import to register SQL driver
)

const (
	migrationTable = "migration_info"
	defaultLimit   = -1
)

//go:embed sql/*
var sqlMigrateFS embed.FS

type statusRow struct {
	ID        string
	Migrated  bool
	Unknown   bool
	AppliedAt time.Time
}

type migrationService struct {
	limit        int
	loggerFormat server.LoggingFormat
	migrations   *sqlmigrate.EmbedFileSystemMigrationSource
	execFn       func(ctx context.Context, logger *zap.Logger, db *pgx.Conn)
}

func Check(ctx context.Context, logger *zap.Logger, db *pgx.Conn) {
	sqlmigrate.SetTable(migrationTable)
	sqlmigrate.SetIgnoreUnknown(true)

	ms := &sqlmigrate.EmbedFileSystemMigrationSource{
		FileSystem: sqlMigrateFS,
		Root:       "sql",
	}

	migrations, err := ms.FindMigrations()
	if err != nil {
		logger.Fatal("Could not find migrations", zap.Error(err))
	}

	records, err := sqlmigrate.GetMigrationRecords(ctx, db)
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
	db.Close(ctx)
}

func RunCmd(ctx context.Context, tmpLogger *zap.Logger, db *pgx.Conn, cmd string, limit int, loggerFormat string) {
	if cmd == "" {
		tmpLogger.Fatal("Migrate requires a subcommand. Available commands are: 'up', 'down', 'redo', 'status'.")
	}

	sqlmigrate.SetTable(migrationTable)
	sqlmigrate.SetIgnoreUnknown(true)
	ms := &migrationService{
		migrations: &sqlmigrate.EmbedFileSystemMigrationSource{
			FileSystem: sqlMigrateFS,
			Root:       "sql",
		},
		limit: limit,
	}

	ms.parseParams(tmpLogger, cmd, loggerFormat)
	logger := server.NewJSONLogger(os.Stdout, zapcore.InfoLevel, ms.loggerFormat)

	ms.runMigration(ctx, logger, db)
	db.Close(ctx)
}

func (ms *migrationService) up(ctx context.Context, logger *zap.Logger, db *pgx.Conn) {
	if ms.limit < defaultLimit {
		ms.limit = 0
	}

	logger.Info("Applying database migrations", zap.Int("limit", ms.limit))

	appliedMigrations, err := sqlmigrate.ExecMax(ctx, db, ms.migrations, sqlmigrate.Up, ms.limit)
	if err != nil {
		logger.Fatal("Failed to apply migrations", zap.Int("count", appliedMigrations), zap.Error(err))
	}

	logger.Info("Successfully applied migration", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) down(ctx context.Context, logger *zap.Logger, db *pgx.Conn) {
	if ms.limit < defaultLimit {
		ms.limit = 1
	}

	logger.Info("Reverting database migrations", zap.Int("limit", ms.limit))

	appliedMigrations, err := sqlmigrate.ExecMax(ctx, db, ms.migrations, sqlmigrate.Down, ms.limit)
	if err != nil {
		logger.Fatal("Failed to migrate back", zap.Int("count", appliedMigrations), zap.Error(err))
	}

	logger.Info("Successfully migrated back", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) redo(ctx context.Context, logger *zap.Logger, db *pgx.Conn) {
	if ms.limit > defaultLimit {
		logger.Warn("Limit is ignored when redo is invoked")
	}

	logger.Info("Reapplying database migrations", zap.Int("limit", ms.limit))

	appliedMigrations, err := sqlmigrate.ExecMax(ctx, db, ms.migrations, sqlmigrate.Down, 1)
	if err != nil {
		logger.Fatal("Failed to migrate back", zap.Int("count", appliedMigrations), zap.Error(err))
	}
	logger.Info("Successfully migrated back", zap.Int("count", appliedMigrations))

	appliedMigrations, err = sqlmigrate.ExecMax(ctx, db, ms.migrations, sqlmigrate.Up, 1)
	if err != nil {
		logger.Fatal("Failed to apply migrations", zap.Int("count", appliedMigrations), zap.Error(err))
	}
	logger.Info("Successfully applied migration", zap.Int("count", appliedMigrations))
}

func (ms *migrationService) status(ctx context.Context, logger *zap.Logger, db *pgx.Conn) {
	if ms.limit > defaultLimit {
		logger.Warn("Limit is ignored when status is invoked")
	}

	migrations, err := ms.migrations.FindMigrations()
	if err != nil {
		logger.Fatal("Could not find migrations", zap.Error(err))
	}

	records, err := sqlmigrate.GetMigrationRecords(ctx, db)
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

	unknownMigrations := make([]string, 0)
	for _, r := range records {
		sr, ok := rows[r.Id]
		if !ok {
			// Unknown migration found in database, perhaps from a newer server version.
			unknownMigrations = append(unknownMigrations, r.Id)
			continue
		}
		sr.Migrated = true
		sr.AppliedAt = r.AppliedAt
	}

	for _, m := range migrations {
		if rows[m.Id].Migrated {
			logger.Info(m.Id, zap.String("applied", rows[m.Id].AppliedAt.Format(time.RFC822Z)))
		} else {
			logger.Info(m.Id, zap.String("applied", ""))
		}
	}
	for _, m := range unknownMigrations {
		logger.Warn(m, zap.String("applied", "unknown migration, check if database is set up for a newer server version"))
	}
}

func (ms *migrationService) parseParams(logger *zap.Logger, cmd, loggerFormat string) {
	switch cmd {
	case "up":
		ms.execFn = ms.up
	case "down":
		ms.execFn = ms.down
	case "redo":
		ms.execFn = ms.redo
	case "status":
		ms.execFn = ms.status
	default:
		logger.Fatal("Unrecognized migrate subcommand. Available commands are: 'up', 'down', 'redo', 'status'.")
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

func (ms *migrationService) runMigration(ctx context.Context, logger *zap.Logger, db *pgx.Conn) {
	if ms.execFn == nil {
		logger.Fatal("Cannot run migration without a set command")
	}

	ms.execFn(ctx, logger, db)
}
