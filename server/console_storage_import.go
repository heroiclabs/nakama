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
	"net/http"
	"strconv"
	"strings"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type importStorageObject struct {
	Collection      string      `json:"collection" csv:"collection"`
	Key             string      `json:"key" csv:"key"`
	UserID          string      `json:"user_id" csv:"user_id"`
	Value           interface{} `json:"value" csv:"value"`
	PermissionRead  int         `json:"permission_read" csv:"permission_read"`
	PermissionWrite int         `json:"permission_write" csv:"permission_write"`
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
	ctx, ok := checkAuth(r.Context(), s.logger, s.config, auth, s.consoleSessionCache, s.loginAttemptCache)
	if !ok {
		w.WriteHeader(401)
		if _, err := w.Write([]byte("Console authentication invalid.")); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
		return
	}

	// Check user role
	role := ctx.Value(ctxConsoleRoleKey{}).(console.UserRole)
	if role > console.UserRole_USER_ROLE_DEVELOPER {
		w.WriteHeader(403)
		if _, err := w.Write([]byte("Forbidden")); err != nil {
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
	for n := range r.MultipartForm.File {
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
	fileBytes, err := io.ReadAll(file)
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
		err = importStorageJSON(r.Context(), s.logger, s.db, s.metrics, s.storageIndex, fileBytes)
	} else {
		// Assume all other files are CSV.
		err = importStorageCSV(r.Context(), s.logger, s.db, s.metrics, s.storageIndex, fileBytes)
	}

	if err != nil {
		w.WriteHeader(400)
		if _, err := w.Write([]byte(fmt.Sprintf("Error importing uploaded file - %s.", err))); err != nil {
			s.logger.Error("Error writing storage import response", zap.Error(err))
		}
	} else {
		w.WriteHeader(204)
	}
}

func importStorageJSON(ctx context.Context, logger *zap.Logger, db *sql.DB, metrics Metrics, storageIndex StorageIndex, fileBytes []byte) error {
	importedData := make([]*importStorageObject, 0)
	ops := StorageOpWrites{}

	if err := json.Unmarshal(fileBytes, &importedData); err != nil {
		logger.Warn("Could not parse JSON file.", zap.Error(err))
		return errors.New("imported file contains bad data")
	}

	for i, d := range importedData {
		if _, err := uuid.FromString(d.UserID); err != nil {
			return fmt.Errorf("invalid user ID on object #%d", i)
		}

		if d.Collection == "" || d.Key == "" || d.Value == "" {
			return fmt.Errorf("invalid collection, key or value supplied on object #%d", i)
		}

		if d.PermissionRead < 0 || d.PermissionRead > 2 {
			return fmt.Errorf("invalid Read permission supplied on object #%d. It must be either 0, 1 or 2", i)
		}

		if d.PermissionWrite < 0 || d.PermissionWrite > 1 {
			return fmt.Errorf("invalid Write permission supplied on object #%d. It must be either 0 or 1", i)
		}

		switch d.Value.(type) {
		case map[string]interface{}:
			// Valid json object
		default:
			return errors.New("invalid storage object value. It must contain a valid json object")
		}

		value, err := json.Marshal(d.Value)
		if err != nil {
			return errors.New("failed to marshal storage object value to json. Value field must contain valid json")
		}

		ops = append(ops, &StorageOpWrite{
			OwnerID: d.UserID,
			Object: &api.WriteStorageObject{
				Collection:      d.Collection,
				Key:             d.Key,
				Value:           string(value),
				PermissionRead:  &wrapperspb.Int32Value{Value: int32(d.PermissionRead)},
				PermissionWrite: &wrapperspb.Int32Value{Value: int32(d.PermissionWrite)},
			},
		})
	}

	if len(ops) == 0 {
		logger.Info("Found no records to import.")
		return nil
	}

	acks, _, err := StorageWriteObjects(ctx, logger, db, metrics, storageIndex, true, ops)
	if err != nil {
		logger.Warn("Failed to write imported records.", zap.Error(err))
		return errors.New("could not import records due to an internal error - please consult server logs")
	}

	logger.Info("Imported Storage records from JSON file.", zap.Int("count", len(acks.Acks)))
	return nil
}

func importStorageCSV(ctx context.Context, logger *zap.Logger, db *sql.DB, metrics Metrics, storageIndex StorageIndex, fileBytes []byte) error {
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
				return fmt.Errorf("invalid user ID on row #%d", len(ops)+1)
			}
			collection := record[columnIndexes["collection"]]
			key := record[columnIndexes["key"]]
			value := record[columnIndexes["value"]]
			permissionRead := record[columnIndexes["permission_read"]]
			permissionWrite := record[columnIndexes["permission_write"]]

			if collection == "" || key == "" || value == "" {
				return fmt.Errorf("invalid collection, key or value supplied on row #%d", len(ops)+1)
			}

			pr, err := strconv.Atoi(permissionRead)
			if permissionRead == "" || err != nil || pr < 0 || pr > 2 {
				return fmt.Errorf("invalid read permission supplied on row #%d. It must be either 0, 1 or 2", len(ops)+1)
			}

			pw, err := strconv.Atoi(permissionWrite)
			if permissionWrite == "" || err != nil || pw < 0 || pw > 1 {
				return fmt.Errorf("invalid write permission supplied on row #%d. It must be either 0 or 1", len(ops)+1)
			}

			if maybeJSON := []byte(value); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
				return fmt.Errorf("value must be a JSON object on row #%d", len(ops)+1)
			}

			ops = append(ops, &StorageOpWrite{
				OwnerID: user,
				Object: &api.WriteStorageObject{
					Collection:      collection,
					Key:             key,
					Value:           value,
					PermissionRead:  &wrapperspb.Int32Value{Value: int32(pr)},
					PermissionWrite: &wrapperspb.Int32Value{Value: int32(pw)},
				},
			})
		}
	}

	if len(ops) == 0 {
		logger.Info("Found no records to import.")
		return nil
	}

	acks, _, err := StorageWriteObjects(ctx, logger, db, metrics, storageIndex, true, ops)
	if err != nil {
		logger.Warn("Failed to write imported records.", zap.Error(err))
		return errors.New("could not import records due to an internal error - please consult server logs")
	}

	logger.Info("Imported Storage records from CSV file.", zap.Int("count", len(acks.Acks)))
	return nil
}
