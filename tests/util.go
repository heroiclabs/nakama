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

package tests

import (
	"database/sql"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"go.uber.org/zap"
)

var (
	logger, _ = zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))
)

func setupDB() (*sql.DB, error) {
	rawurl := fmt.Sprintf("postgresql://%s?sslmode=disable", "root@localhost:26257/nakama")
	url, err := url.Parse(rawurl)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("postgres", url.String())
	if err != nil {
		return nil, err
	}

	return db, nil
}

func generateString() string {
	return strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
}
