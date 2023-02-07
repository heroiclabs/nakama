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

package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"
	"go.uber.org/zap"
)

const dbErrorDatabaseDoesNotExist = pgerrcode.InvalidCatalogName

var ErrDatabaseDriverMismatch = errors.New("database driver mismatch")

func DbConnect(ctx context.Context, logger *zap.Logger, config Config, create bool) *sql.DB {
	rawURL := config.GetDatabase().Addresses[0]
	if !(strings.HasPrefix(rawURL, "postgresql://") || strings.HasPrefix(rawURL, "postgres://")) {
		rawURL = fmt.Sprintf("postgres://%s", rawURL)
	}
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		logger.Fatal("Bad database connection URL", zap.Error(err))
	}
	query := parsedURL.Query()
	var queryUpdated bool
	if len(query.Get("sslmode")) == 0 {
		query.Set("sslmode", "prefer")
		queryUpdated = true
	}
	if queryUpdated {
		parsedURL.RawQuery = query.Encode()
	}

	if len(parsedURL.User.Username()) < 1 {
		parsedURL.User = url.User("root")
	}
	dbName := "nakama"
	if len(parsedURL.Path) > 0 {
		dbName = parsedURL.Path[1:]
	} else {
		parsedURL.Path = "/" + dbName
	}

	// Resolve initial database address based on host before connecting.
	dbHostname := parsedURL.Hostname()
	resolvedAddr, resolvedAddrMap := dbResolveAddress(ctx, logger, dbHostname)

	db, err := sql.Open("pgx", parsedURL.String())
	if err != nil {
		logger.Fatal("Failed to open database", zap.Error(err))
	}

	if create {
		var nakamaDBExists bool
		if err = db.QueryRow("SELECT EXISTS (SELECT 1 from pg_database WHERE datname = $1)", dbName).Scan(&nakamaDBExists); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == dbErrorDatabaseDoesNotExist {
				nakamaDBExists = false
			} else {
				db.Close()
				logger.Fatal("Failed to check if db exists", zap.String("db", dbName), zap.Error(err))
			}
		}

		if !nakamaDBExists {
			// Database does not exist, create it
			logger.Info("Creating new database", zap.String("name", dbName))
			db.Close()
			// Connect to anonymous db
			parsedURL.Path = ""
			db, err = sql.Open("pgx", parsedURL.String())
			if err != nil {
				logger.Fatal("Failed to open database", zap.Error(err))
			}
			if _, err = db.Exec(fmt.Sprintf("CREATE DATABASE %q", dbName)); err != nil {
				db.Close()
				logger.Fatal("Failed to create database", zap.Error(err))
			}
			db.Close()
			parsedURL.Path = fmt.Sprintf("/%s", dbName)
			db, err = sql.Open("pgx", parsedURL.String())
			if err != nil {
				db.Close()
				logger.Fatal("Failed to open database", zap.Error(err))
			}
		}
	}

	logger.Debug("Complete database connection URL", zap.String("raw_url", parsedURL.String()))
	db, err = sql.Open("pgx", parsedURL.String())
	if err != nil {
		logger.Fatal("Error connecting to database", zap.Error(err))
	}
	// Limit max time allowed across database ping and version fetch to 15 seconds total.
	pingCtx, pingCtxCancelFn := context.WithTimeout(ctx, 15*time.Second)
	defer pingCtxCancelFn()
	if err = db.PingContext(pingCtx); err != nil {
		if strings.HasSuffix(err.Error(), "does not exist (SQLSTATE 3D000)") {
			logger.Fatal("Database schema not found, run `nakama migrate up`", zap.Error(err))
		}
		logger.Fatal("Error pinging database", zap.Error(err))
	}

	db.SetConnMaxLifetime(time.Millisecond * time.Duration(config.GetDatabase().ConnMaxLifetimeMs))
	db.SetMaxOpenConns(config.GetDatabase().MaxOpenConns)
	db.SetMaxIdleConns(config.GetDatabase().MaxIdleConns)

	var dbVersion string
	if err = db.QueryRowContext(pingCtx, "SELECT version()").Scan(&dbVersion); err != nil {
		logger.Fatal("Error querying database version", zap.Error(err))
	}

	logger.Info("Database information", zap.String("version", dbVersion))

	// Periodically check database hostname for underlying address changes.
	go func() {
		ticker := time.NewTicker(time.Duration(config.GetDatabase().DnsScanIntervalSec) * time.Second)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				newResolvedAddr, newResolvedAddrMap := dbResolveAddress(ctx, logger, dbHostname)
				if len(resolvedAddr) == 0 {
					// Could only happen when initial resolve above failed, and all resolves since have also failed.
					// Trust the database driver in this case.
					resolvedAddr = newResolvedAddr
					resolvedAddrMap = newResolvedAddrMap
					break
				}
				if len(newResolvedAddr) == 0 {
					// New addresses failed to resolve, but had previous ones. Trust the database driver in this case.
					break
				}

				// Check for any changes in the resolved addresses.
				drain := len(resolvedAddrMap) != len(newResolvedAddrMap)
				if !drain {
					for addr := range newResolvedAddrMap {
						if _, found := resolvedAddrMap[addr]; !found {
							drain = true
							break
						}
					}
				}
				if !drain {
					// No changes.
					break
				}

				startTime := time.Now().UTC()
				logger.Warn("Database starting rotation of all connections due to address change",
					zap.Int("count", config.GetDatabase().MaxOpenConns),
					zap.Strings("previous", resolvedAddr),
					zap.Strings("updated", newResolvedAddr))

				// Changes found. Drain the pool and allow the database driver to open fresh connections.
				// Rely on the database driver to re-do its own hostname to address resolution.
				var acquired int
				conns := make([]*sql.Conn, 0, config.GetDatabase().MaxOpenConns)
				for acquired < config.GetDatabase().MaxOpenConns {
					acquired++
					conn, err := db.Conn(ctx)
					if err != nil {
						if err == context.Canceled {
							// Server shutting down.
							return
						}
						// Log errors acquiring connections, but proceed without the failed connection anyway.
						logger.Error("Error acquiring database connection", zap.Error(err))
						continue
					}
					conns = append(conns, conn)
				}

				resolvedAddr = newResolvedAddr
				resolvedAddrMap = newResolvedAddrMap
				for _, conn := range conns {
					if err := conn.Raw(func(driverConn interface{}) error {
						pgc, ok := driverConn.(*stdlib.Conn)
						if !ok {
							return ErrDatabaseDriverMismatch
						}
						if err := pgc.Close(); err != nil {
							return err
						}
						return nil
					}); err != nil {
						logger.Error("Error closing database connection", zap.Error(err))
					}
					if err := conn.Close(); err != nil {
						logger.Error("Error releasing database connection", zap.Error(err))
					}
				}

				logger.Warn("Database finished rotation of all connections due to address change",
					zap.Int("count", len(conns)),
					zap.Strings("previous", resolvedAddr),
					zap.Strings("updated", newResolvedAddr),
					zap.Duration("elapsed_duration", time.Now().UTC().Sub(startTime)))
			}
		}
	}()

	return db
}

func dbResolveAddress(ctx context.Context, logger *zap.Logger, host string) ([]string, map[string]struct{}) {
	resolveCtx, resolveCtxCancelFn := context.WithTimeout(ctx, 15*time.Second)
	defer resolveCtxCancelFn()
	addr, err := net.DefaultResolver.LookupHost(resolveCtx, host)
	if err != nil {
		logger.Debug("Error resolving database address, using previously resolved address", zap.String("host", host), zap.Error(err))
		return nil, nil
	}
	addrMap := make(map[string]struct{}, len(addr))
	for _, a := range addr {
		addrMap[a] = struct{}{}
	}
	return addr, addrMap
}

// Tx is used to permit clients to implement custom transaction logic.
type Tx interface {
	ExecContext(context.Context, string, ...interface{}) (sql.Result, error)
	Commit() error
	Rollback() error
}

// Scannable Interface to help utility functions accept either *sql.Row or *sql.Rows for scanning one row at a time.
type Scannable interface {
	Scan(dest ...interface{}) error
}

// ExecuteRetryable Retry functions that perform non-transactional database operations.
func ExecuteRetryable(fn func() error) error {
	if err := fn(); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.SerializationFailure {
			// A recognised error type that can be retried.
			return ExecuteRetryable(fn)
		}
		return err
	}
	return nil
}

// ExecuteInTx runs fn inside tx which should already have begun.
// *WARNING*: Do not execute any statements on the supplied tx before calling this function.
// ExecuteInTx will only retry statements that are performed within the supplied
// closure (fn). Any statements performed on the tx before ExecuteInTx is invoked will *not*
// be re-run if the transaction needs to be retried.
//
// fn is subject to the same restrictions as the fn passed to ExecuteTx.
func ExecuteInTx(ctx context.Context, tx Tx, fn func() error) (err error) {
	defer func() {
		if err == nil {
			// Ignore commit errors. The tx has already been committed by RELEASE.
			_ = tx.Commit()
		} else {
			// We always need to execute a Rollback() so sql.DB releases the
			// connection.
			_ = tx.Rollback()
		}
	}()
	// Specify that we intend to retry this txn in case of database retryable errors.
	if _, err = tx.ExecContext(ctx, "SAVEPOINT cockroach_restart"); err != nil {
		return err
	}

	for {
		released := false
		err = fn()
		if err == nil {
			// RELEASE acts like COMMIT in CockroachDB. We use it since it gives us an
			// opportunity to react to retryable errors, whereas tx.Commit() doesn't.
			released = true
			if _, err = tx.ExecContext(ctx, "RELEASE SAVEPOINT cockroach_restart"); err == nil {
				return nil
			}
		}
		// We got an error; let's see if it's a retryable one and, if so, restart. We look
		// for either the standard PG errcode SerializationFailureError:40001 or the Cockroach extension
		// errcode RetriableError:CR000. The Cockroach extension has been removed server-side, but support
		// for it has been left here for now to maintain backwards compatibility.
		var pgErr *pgconn.PgError
		if retryable := errors.As(errorCause(err), &pgErr) && (pgErr.Code == "CR000" || pgErr.Code == pgerrcode.SerializationFailure); !retryable {
			if released {
				err = newAmbiguousCommitError(err)
			}
			return err
		}
		if _, retryErr := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT cockroach_restart"); retryErr != nil {
			return newTxnRestartError(retryErr, err)
		}
	}
}
