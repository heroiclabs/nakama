// Copyright 2019 The Nakama Authors
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
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"strconv"
	"strings"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"go.uber.org/zap"
)

type importStorageObject struct {
	Collection      string `json:"collection" csv:"collection"`
	Key             string `json:"key" csv:"key"`
	UserID          string `json:"user_id" csv:"user_id"`
	Value           string `json:"value" csv:"value"`
	PermissionRead  int    `json:"permission_read" csv:"permission_read"`
	PermissionWrite int    `json:"permission_write" csv:"permission_write"`
}

func (s *ConsoleServer) importStorage(w http.ResponseWriter, r *http.Request) {
	// Check authentication.
	auth := r.Header.Get("authorization")
	if len(auth) == 0 {
		w.WriteHeader(401)
		if _, err := w.Write([]byte("Console authentication required.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}
	if !checkAuth(s.config, auth) {
		w.WriteHeader(401)
		if _, err := w.Write([]byte("Console authentication invalid.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Parse multipart form request data.
	if err := r.ParseMultipartForm(s.config.GetConsole().MaxMessageSizeBytes); err != nil {
		s.logger.Error("Error parsing storage import form", zap.Error(err))

		w.WriteHeader(400)
		if _, err := w.Write([]byte("Error parsing form data.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Find the name of the uploaded file.
	var filename string
	for n, _ := range r.MultipartForm.File {
		// If there are 2 or more files only use the first one.
		filename = n
		break
	}
	if filename == "" {
		s.logger.Warn("Could not find file in storage import multipart form")

		w.WriteHeader(400)
		if _, err := w.Write([]byte("No file was uploaded.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Open the uploaded file.
	file, _, err := r.FormFile(filename)
	if err != nil {
		s.logger.Error("Error opening storage import file", zap.Error(err))

		w.WriteHeader(400)
		if _, err := w.Write([]byte("Error opening uploaded file.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}
	defer file.Close()

	// Fully read the file contents.
	fileBytes, err := ioutil.ReadAll(file)
	if err != nil {
		s.logger.Error("Error opening storage import file", zap.Error(err))

		w.WriteHeader(400)
		if _, err := w.Write([]byte("Error opening uploaded file.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Examine file name to determine if it's a JSON or CSV import.
	if strings.HasSuffix(strings.ToLower(filename), ".json") {
		// File has .json suffix, try to import as JSON.
		err = importStorageJSON(r.Context(), s.logger, s.db, fileBytes)
	} else {
		// Assume all other files are CSV.
		err = importStorageCSV(r.Context(), s.logger, s.db, fileBytes)
	}

	if err != nil {
		w.WriteHeader(400)
		if _, err := w.Write([]byte(fmt.Sprintf("Error importing uploaded file - %s.", err))); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
	}
}

func importStorageJSON(ctx context.Context, logger *zap.Logger, db *sql.DB, fileBytes []byte) error {
	importedData := make([]*importStorageObject, 0)
	ops := StorageOpWrites{}

	if err := json.Unmarshal(fileBytes, &importedData); err != nil {
		logger.Warn("Could not parse JSON file.", zap.Error(err))
		return errors.New("imported file contains bad data")
	}

	for i, d := range importedData {
		if _, err := uuid.FromString(d.UserID); err != nil {
			return errors.New(fmt.Sprintf("invalid user ID on object #%d", i))
		}

		if d.Collection == "" || d.Key == "" || d.Value == "" {
			return errors.New(fmt.Sprintf("invalid collection, key or value supplied on object #%d", i))
		}

		if d.PermissionRead < 0 || d.PermissionRead > 2 {
			return errors.New(fmt.Sprintf("invalid Read permission supplied on object #%d. It must be either 0, 1 or 2", i))
		}

		if d.PermissionWrite < 0 || d.PermissionWrite > 1 {
			return errors.New(fmt.Sprintf("invalid Write permission supplied on object #%d. It must be either 0 or 1", i))
		}

		var maybeJSON map[string]interface{}
		if json.Unmarshal([]byte(d.Value), &maybeJSON) != nil {
			return errors.New(fmt.Sprintf("value must be a JSON object on object #%d", i))
		}

		ops = append(ops, &StorageOpWrite{
			OwnerID: d.UserID,
			Object: &api.WriteStorageObject{
				Collection:      d.Collection,
				Key:             d.Key,
				Value:           d.Value,
				PermissionRead:  &wrappers.Int32Value{Value: int32(d.PermissionRead)},
				PermissionWrite: &wrappers.Int32Value{Value: int32(d.PermissionWrite)},
			},
		})
	}

	if len(ops) == 0 {
		logger.Info("Found no records to import.")
		return nil
	}

	acks, _, err := StorageWriteObjects(ctx, logger, db, true, ops)
	if err != nil {
		logger.Warn("Failed to write imported records.", zap.Error(err))
		return errors.New("could not import records due to an internal error - please consult server logs")
	}

	logger.Info("Imported Storage records from JSON file.", zap.Int("count", len(acks.Acks)))
	return nil
}

func importStorageCSV(ctx context.Context, logger *zap.Logger, db *sql.DB, fileBytes []byte) error {
	r := csv.NewReader(bytes.NewReader(fileBytes))

	columnIndexes := make(map[string]int)
	ops := StorageOpWrites{}

	for {
		record, err := r.Read()
		if err != nil {
			if err == io.EOF {
				break
			} else if err == csv.ErrFieldCount {
				logger.Warn(fmt.Sprintf("Could not parse CSV file as row #%d does not have expected fields.", len(ops)+1), zap.Error(err))
			} else {
				logger.Warn("Could not parse CSV file.", zap.Error(err))
				return errors.New("failed to parse CSV file")
			}
		}

		if len(columnIndexes) == 0 {
			for i, v := range record {
				columnIndexes[v] = i
			}

			if _, ok := columnIndexes["collection"]; !ok {
				logger.Warn("CSV file does not have 'collection' column.", zap.Error(err))
				return errors.New("file does not have 'collection' column")
			} else if _, ok := columnIndexes["key"]; !ok {
				logger.Warn("CSV file does not have 'key' column.", zap.Error(err))
				return errors.New("file does not have 'key' column")
			} else if _, ok := columnIndexes["value"]; !ok {
				logger.Warn("CSV file does not have 'value' column.", zap.Error(err))
				return errors.New("file does not have 'value' column")
			} else if _, ok := columnIndexes["user_id"]; !ok {
				logger.Warn("CSV file does not have 'user_id' column.", zap.Error(err))
				return errors.New("file does not have 'user_id' column")
			} else if _, ok := columnIndexes["permission_read"]; !ok {
				logger.Warn("CSV file does not have 'permission_read' column.", zap.Error(err))
				return errors.New("file does not have 'permission_read' column")
			} else if _, ok := columnIndexes["permission_write"]; !ok {
				logger.Warn("CSV file does not have 'permission_write' column.", zap.Error(err))
				return errors.New("file does not have 'permission_write' column")
			}
		} else {
			user := record[columnIndexes["user_id"]]
			if _, err := uuid.FromString(user); err != nil {
				return errors.New(fmt.Sprintf("invalid user ID on row #%d", len(ops)+1))
			}
			collection := record[columnIndexes["collection"]]
			key := record[columnIndexes["key"]]
			value := record[columnIndexes["value"]]
			permissionRead := record[columnIndexes["permission_read"]]
			permissionWrite := record[columnIndexes["permission_write"]]

			if collection == "" || key == "" || value == "" {
				return errors.New(fmt.Sprintf("invalid collection, key or value supplied on row #%d", len(ops)+1))
			}

			pr, err := strconv.Atoi(permissionRead)
			if permissionRead == "" || err != nil || pr < 0 || pr > 2 {
				return errors.New(fmt.Sprintf("invalid read permission supplied on row #%d. It must be either 0, 1 or 2", len(ops)+1))
			}

			pw, err := strconv.Atoi(permissionWrite)
			if permissionWrite == "" || err != nil || pw < 0 || pw > 1 {
				return errors.New(fmt.Sprintf("invalid write permission supplied on row #%d. It must be either 0 or 1", len(ops)+1))
			}

			var maybeJSON map[string]interface{}
			if json.Unmarshal([]byte(value), &maybeJSON) != nil {
				return errors.New(fmt.Sprintf("value must be a JSON object on row #%d", len(ops)+1))
			}

			ops = append(ops, &StorageOpWrite{
				OwnerID: user,
				Object: &api.WriteStorageObject{
					Collection:      collection,
					Key:             key,
					Value:           value,
					PermissionRead:  &wrappers.Int32Value{Value: int32(pr)},
					PermissionWrite: &wrappers.Int32Value{Value: int32(pw)},
				},
			})
		}
	}

	if len(ops) == 0 {
		logger.Info("Found no records to import.")
		return nil
	}

	acks, _, err := StorageWriteObjects(ctx, logger, db, true, ops)
	if err != nil {
		logger.Warn("Failed to write imported records.", zap.Error(err))
		return errors.New("could not import records due to an internal error - please consult server logs")
	}

	logger.Info("Imported Storage records from CSV file.", zap.Int("count", len(acks.Acks)))
	return nil
}
