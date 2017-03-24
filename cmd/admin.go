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
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/gorhill/cronexpr"
	"github.com/satori/go.uuid"
	"github.com/uber-go/zap"
	"net/url"
	"os"
)

type adminService struct {
	DSNS   string
	logger zap.Logger
}

func AdminParse(args []string, logger zap.Logger) {
	if len(args) == 0 {
		logger.Fatal("Admin requires a subcommand. Available commands are: 'create-leaderboard'.")
	}

	var exec func([]string, zap.Logger)
	switch args[0] {
	case "create-leaderboard":
		exec = createLeaderboard
	default:
		logger.Fatal("Unrecognized admin subcommand. Available commands are: 'create-leaderboard'.")
	}

	exec(args[1:], logger)
	os.Exit(0)
}

func createLeaderboard(args []string, logger zap.Logger) {
	var dsns string
	var id string
	var authoritative bool
	var sortOrder string
	var resetSchedule string
	var metadata string

	flags := flag.NewFlagSet("admin", flag.ExitOnError)
	flags.StringVar(&dsns, "db", "root@localhost:26257", "CockroachDB JDBC connection details.")
	flags.StringVar(&id, "id", "", "ID to assign to the leaderboard.")
	flags.BoolVar(&authoritative, "authoritative", false, "True if clients may not submit scores directly, false otherwise.")
	flags.StringVar(&sortOrder, "sort", "desc", "Leaderboard sort order, 'asc' or 'desc'.")
	flags.StringVar(&resetSchedule, "reset", "", "Optional reset schedule in CRON format.")
	flags.StringVar(&metadata, "metadata", "{}", "Optional additional metadata as a JSON string.")

	if err := flags.Parse(args); err != nil {
		logger.Fatal("Could not parse admin flags.")
	}

	if dsns == "" {
		logger.Fatal("Database connection details are required.")
	}

	query := `INSERT INTO leaderboard (id, authoritative, sort_order, reset_schedule, metadata)
	VALUES ($1, $2, $3, $4, $5)`
	params := []interface{}{}

	// ID.
	if id == "" {
		params = append(params, uuid.NewV4().Bytes())
	} else {
		params = append(params, []byte(id))
	}

	// Authoritative.
	params = append(params, authoritative)

	// Sort order.
	if sortOrder == "asc" {
		params = append(params, 0)
	} else if sortOrder == "desc" {
		params = append(params, 1)
	} else {
		logger.Fatal("Invalid sort value, must be 'asc' or 'desc'.")
	}

	// Count is hardcoded in the INSERT above.

	// Reset schedule.
	if resetSchedule != "" {
		_, err := cronexpr.Parse(resetSchedule)
		if err != nil {
			logger.Fatal("Reset schedule must be a valid CRON expression.")
		}
		params = append(params, resetSchedule)
	} else {
		params = append(params, nil)
	}

	// Metadata.
	metadataBytes := []byte(metadata)
	var maybeJSON map[string]interface{}
	if json.Unmarshal(metadataBytes, &maybeJSON) != nil {
		logger.Fatal("Metadata must be a valid JSON string.")
	}
	params = append(params, metadataBytes)

	rawurl := fmt.Sprintf("postgresql://%s?sslmode=disable", dsns)
	url, err := url.Parse(rawurl)
	if err != nil {
		logger.Fatal("Bad connection URL", zap.Error(err))
	}

	logger.Info("Database connection", zap.String("dsns", dsns))

	// Default to "nakama" as DB name.
	dbname := "nakama"
	if len(url.Path) > 1 {
		dbname = url.Path[1:]
	}
	url.Path = fmt.Sprintf("/%s", dbname)
	db, err := sql.Open(dialect, url.String())
	if err != nil {
		logger.Fatal("Failed to open database", zap.Error(err))
	}
	if err = db.Ping(); err != nil {
		logger.Fatal("Error pinging database", zap.Error(err))
	}

	res, err := db.Exec(query, params...)
	if err != nil {
		logger.Fatal("Error creating leaderboard", zap.Error(err))
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
		logger.Fatal("Error creating leaderboard, unexpected insert result")
	}

	logger.Info("Leaderboard created", zap.String("base64(id)", base64.StdEncoding.EncodeToString(params[0].([]byte))))
}
