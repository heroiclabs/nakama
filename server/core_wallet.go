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
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/gofrs/uuid"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
)

// Not an API entity, only used to receive data from Lua environment.
type walletUpdate struct {
	UserID    uuid.UUID
	Changeset map[string]interface{}
	// Metadata is expected to be a valid JSON string already.
	Metadata string
}

// Not an API entity, only used to send data to Lua environment.
type walletLedger struct {
	ID         string
	UserID     string
	Changeset  map[string]interface{}
	Metadata   map[string]interface{}
	CreateTime int64
	UpdateTime int64
}

func (w *walletLedger) GetID() string {
	return w.ID
}

func (w *walletLedger) GetUserID() string {
	return w.UserID
}

func (w *walletLedger) GetCreateTime() int64 {
	return w.CreateTime
}

func (w *walletLedger) GetUpdateTime() int64 {
	return w.UpdateTime
}

func (w *walletLedger) GetChangeset() map[string]interface{} {
	return w.Changeset
}

func (w *walletLedger) GetMetadata() map[string]interface{} {
	return w.Metadata
}

func UpdateWallets(ctx context.Context, logger *zap.Logger, db *sql.DB, updates []*walletUpdate, updateLedger bool) error {
	if len(updates) == 0 {
		return nil
	}

	params := make([]interface{}, 0, len(updates))
	statements := make([]string, 0, len(updates))
	for _, update := range updates {
		params = append(params, update.UserID)
		statements = append(statements, "$"+strconv.Itoa(len(params))+"::UUID")
	}

	query := "SELECT id, wallet FROM users WHERE id IN (" + strings.Join(statements, ",") + ")"

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err = ExecuteInTx(ctx, tx, func() error {
		// Select the wallets from the DB and decode them.
		wallets := make(map[string]map[string]interface{}, len(updates))
		rows, err := tx.QueryContext(ctx, query, params...)
		if err != nil {
			logger.Debug("Error retrieving user wallets.", zap.Error(err))
			return err
		}
		for rows.Next() {
			var id string
			var wallet sql.NullString
			err = rows.Scan(&id, &wallet)
			if err != nil {
				_ = rows.Close()
				logger.Debug("Error reading user wallets.", zap.Error(err))
				return err
			}

			var walletMap map[string]interface{}
			err = json.Unmarshal([]byte(wallet.String), &walletMap)
			if err != nil {
				_ = rows.Close()
				logger.Debug("Error converting user wallet.", zap.String("user_id", id), zap.Error(err))
				return err
			}

			wallets[id] = walletMap
		}
		_ = rows.Close()

		// Prepare the set of wallet updates and ledger updates.
		updatedWallets := make(map[string][]byte, len(updates))
		updateOrder := make([]string, 0, len(updates))
		if updateLedger {
			statements = make([]string, 0, len(updates))
			params = make([]interface{}, 0, len(updates)*4)
		}
		for _, update := range updates {
			userID := update.UserID.String()
			walletMap, ok := wallets[userID]
			if !ok {
				// Wallet update for a user that does not exist. Skip it.
				continue
			}
			walletMap, err = applyWalletUpdate(walletMap, update.Changeset, "")
			if err != nil {
				// Programmer error, no need to log.
				return err
			}
			walletData, err := json.Marshal(walletMap)
			if err != nil {
				logger.Debug("Error converting new user wallet.", zap.String("user_id", userID), zap.Error(err))
				return err
			}
			updatedWallets[userID] = walletData
			updateOrder = append(updateOrder, userID)

			// Prepare ledger updates if needed.
			if updateLedger {
				changesetData, err := json.Marshal(update.Changeset)
				if err != nil {
					logger.Debug("Error converting new user wallet changeset.", zap.String("user_id", update.UserID.String()), zap.Error(err))
					return err
				}

				params = append(params, uuid.Must(uuid.NewV4()), userID, changesetData, update.Metadata)
				statements = append(statements, fmt.Sprintf("($%v::UUID, $%v, $%v, $%v)", strconv.Itoa(len(params)-3), strconv.Itoa(len(params)-2), strconv.Itoa(len(params)-1), strconv.Itoa(len(params))))
			}
		}

		if len(updatedWallets) > 0 {
			// Ensure updates are done in natural order of user ID.
			sort.Strings(updateOrder)

			// Write the updated wallets.
			query = "UPDATE users SET update_time = now(), wallet = $2 WHERE id = $1"
			for _, userID := range updateOrder {
				updatedWallet, ok := updatedWallets[userID]
				if !ok {
					// Should not happen.
					logger.Warn("Missing wallet update for user.", zap.String("user_id", userID))
					continue
				}
				_, err = tx.ExecContext(ctx, query, userID, updatedWallet)
				if err != nil {
					logger.Debug("Error writing user wallet.", zap.String("user_id", userID), zap.Error(err))
					return err
				}
			}

			// Write the ledger updates, if any.
			if updateLedger && (len(statements) > 0) {
				query = "INSERT INTO wallet_ledger (id, user_id, changeset, metadata) VALUES " + strings.Join(statements, ", ")
				_, err = tx.ExecContext(ctx, query, params...)
				if err != nil {
					logger.Debug("Error writing user wallet ledgers.", zap.Error(err))
					return err
				}
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error updating wallets.", zap.Error(err))
		return err
	}

	return nil
}

func UpdateWalletLedger(ctx context.Context, logger *zap.Logger, db *sql.DB, id uuid.UUID, metadata string) (*walletLedger, error) {
	// Metadata is expected to already be a valid JSON string.
	var userId string
	var changeset sql.NullString
	var createTime pgtype.Timestamptz
	var updateTime pgtype.Timestamptz
	query := "UPDATE wallet_ledger SET update_time = now(), metadata = metadata || $2 WHERE id = $1::UUID RETURNING user_id, changeset, create_time, update_time"
	err := db.QueryRowContext(ctx, query, id, metadata).Scan(&userId, &changeset, &createTime, &updateTime)
	if err != nil {
		logger.Error("Error updating user wallet ledger.", zap.String("id", id.String()), zap.Error(err))
		return nil, err
	}

	var changesetMap map[string]interface{}
	err = json.Unmarshal([]byte(changeset.String), &changesetMap)
	if err != nil {
		logger.Error("Error converting user wallet ledger changeset after update.", zap.String("id", id.String()), zap.Error(err))
		return nil, err
	}

	return &walletLedger{
		UserID:     userId,
		Changeset:  changesetMap,
		CreateTime: createTime.Time.Unix(),
		UpdateTime: updateTime.Time.Unix(),
	}, nil
}

func ListWalletLedger(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID) ([]*walletLedger, error) {
	results := make([]*walletLedger, 0)
	query := "SELECT id, changeset, metadata, create_time, update_time FROM wallet_ledger WHERE user_id = $1::UUID"
	rows, err := db.QueryContext(ctx, query, userID)
	if err != nil {
		logger.Error("Error retrieving user wallet ledger.", zap.String("user_id", userID.String()), zap.Error(err))
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var changeset sql.NullString
		var metadata sql.NullString
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		err = rows.Scan(&id, &changeset, &metadata, &createTime, &updateTime)
		if err != nil {
			logger.Error("Error converting user wallet ledger.", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, err
		}

		var changesetMap map[string]interface{}
		err = json.Unmarshal([]byte(changeset.String), &changesetMap)
		if err != nil {
			logger.Error("Error converting user wallet ledger changeset.", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, err
		}

		var metadataMap map[string]interface{}
		err = json.Unmarshal([]byte(metadata.String), &metadataMap)
		if err != nil {
			logger.Error("Error converting user wallet ledger metadata.", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, err
		}

		results = append(results, &walletLedger{
			ID:         id,
			Changeset:  changesetMap,
			Metadata:   metadataMap,
			CreateTime: createTime.Time.Unix(),
			UpdateTime: updateTime.Time.Unix(),
		})
	}
	return results, nil
}

func applyWalletUpdate(wallet map[string]interface{}, changeset map[string]interface{}, path string) (map[string]interface{}, error) {
	for k, v := range changeset {
		var currentPath string
		if path == "" {
			currentPath = k
		} else {
			currentPath = fmt.Sprintf("%v.%v", path, k)
		}

		if existing, ok := wallet[k]; ok {
			// There is already a value present for this field.
			if existingMap, ok := existing.(map[string]interface{}); ok {
				// Ensure they're both maps of other values.
				if changesetMap, ok := v.(map[string]interface{}); ok {
					// Recurse to apply changes.
					updated, err := applyWalletUpdate(existingMap, changesetMap, currentPath)
					if err != nil {
						return nil, err
					}
					wallet[k] = updated
				} else {
					return nil, fmt.Errorf("update changeset does not match existing wallet value map type at path '%v'", currentPath)
				}
			} else if existingValue, ok := existing.(float64); ok {
				// Ensure they're both numeric values.
				if changesetValue, ok := v.(float64); ok {
					newValue := existingValue + changesetValue
					if newValue < 0 {
						return nil, fmt.Errorf("wallet update rejected negative value at path '%v'", currentPath)
					}
					wallet[k] = newValue
				} else {
					return nil, fmt.Errorf("update changeset does not match existing wallet value number type at path '%v'", currentPath)
				}
			} else {
				// Existing value is not a map or float.
				return nil, fmt.Errorf("unknown existing wallet value type at path '%v', expecting map or float64", currentPath)
			}
		} else {
			// No existing value for this field.
			if changesetMap, ok := v.(map[string]interface{}); ok {
				updated, err := applyWalletUpdate(make(map[string]interface{}, 1), changesetMap, currentPath)
				if err != nil {
					return nil, err
				}
				wallet[k] = updated
			} else if changesetValue, ok := v.(float64); ok {
				if changesetValue < 0 {
					// Do not allow setting negative initial values.
					return nil, fmt.Errorf("wallet update rejected negative value at path '%v'", currentPath)
				}
				wallet[k] = changesetValue
			} else {
				// Incoming value is not a map or float.
				return nil, fmt.Errorf("unknown update changeset value type at path '%v', expecting map or float64", currentPath)
			}
		}
	}
	return wallet, nil
}
