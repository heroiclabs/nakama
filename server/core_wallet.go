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
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
)

type walletLedgerListCursor struct {
	UserId     string
	CreateTime time.Time
	Id         string
	IsNext     bool
}

// Not an API entity, only used to receive data from runtime environment.
type walletUpdate struct {
	UserID    uuid.UUID
	Changeset map[string]int64
	// Metadata is expected to be a valid JSON string already.
	Metadata string
}

// Not an API entity, only used to send data to runtime environment.
type walletLedger struct {
	ID         string
	UserID     string
	Changeset  map[string]int64
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

func (w *walletLedger) GetChangeset() map[string]int64 {
	return w.Changeset
}

func (w *walletLedger) GetMetadata() map[string]interface{} {
	return w.Metadata
}

func UpdateWallets(ctx context.Context, logger *zap.Logger, db *sql.DB, updates []*walletUpdate, updateLedger bool) ([]*runtime.WalletUpdateResult, error) {
	if len(updates) == 0 {
		return nil, nil
	}

	var results []*runtime.WalletUpdateResult

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, err
	}

	if err = ExecuteInTx(ctx, tx, func() error {
		var updateErr error
		results, updateErr = updateWallets(ctx, logger, tx, updates, updateLedger)
		if updateErr != nil {
			return updateErr
		}
		return nil
	}); err != nil {
		if _, ok := err.(*runtime.WalletNegativeError); !ok {
			logger.Error("Error updating wallets.", zap.Error(err))
		}
		// Ensure there are no partially updated wallets returned as results, they would not be reflected in database anyway.
		for _, result := range results {
			result.Updated = nil
		}
		return results, err
	}

	return results, nil
}

func updateWallets(ctx context.Context, logger *zap.Logger, tx *sql.Tx, updates []*walletUpdate, updateLedger bool) ([]*runtime.WalletUpdateResult, error) {
	if len(updates) == 0 {
		return nil, nil
	}

	initialParams := make([]interface{}, 0, len(updates))
	initialStatements := make([]string, 0, len(updates))
	for _, update := range updates {
		initialParams = append(initialParams, update.UserID)
		initialStatements = append(initialStatements, "$"+strconv.Itoa(len(initialParams))+"::UUID")
	}

	initialQuery := "SELECT id, wallet FROM users WHERE id IN (" + strings.Join(initialStatements, ",") + ")"

	// Select the wallets from the DB and decode them.
	wallets := make(map[string]map[string]int64, len(updates))
	rows, err := tx.QueryContext(ctx, initialQuery, initialParams...)
	if err != nil {
		logger.Debug("Error retrieving user wallets.", zap.Error(err))
		return nil, err
	}
	for rows.Next() {
		var id string
		var wallet sql.NullString
		err = rows.Scan(&id, &wallet)
		if err != nil {
			_ = rows.Close()
			logger.Debug("Error reading user wallets.", zap.Error(err))
			return nil, err
		}

		var walletMap map[string]int64
		err = json.Unmarshal([]byte(wallet.String), &walletMap)
		if err != nil {
			_ = rows.Close()
			logger.Debug("Error converting user wallet.", zap.String("user_id", id), zap.Error(err))
			return nil, err
		}

		wallets[id] = walletMap
	}
	_ = rows.Close()

	results := make([]*runtime.WalletUpdateResult, 0, len(updates))

	// Prepare the set of wallet updates and ledger updates.
	updatedWallets := make(map[string][]byte, len(updates))
	updateOrder := make([]string, 0, len(updates))
	var statements []string
	var params []interface{}
	if updateLedger {
		statements = make([]string, 0, len(updates))
		params = make([]interface{}, 0, len(updates)*4)
	}

	// Go through the changesets and attempt to calculate the new state for each wallet.
	for _, update := range updates {
		userID := update.UserID.String()
		walletMap, ok := wallets[userID]
		if !ok {
			// Wallet update for a user that does not exist. Skip it.
			continue
		}

		// Deep copy the previous state of the wallet.
		previousMap := make(map[string]int64, len(walletMap))
		for k, v := range walletMap {
			previousMap[k] = v
		}
		result := &runtime.WalletUpdateResult{UserID: userID, Previous: previousMap}

		for k, v := range update.Changeset {
			// Existing value may be 0 or missing.
			newValue := walletMap[k] + v
			if newValue < 0 {
				// Insufficient funds
				return nil, &runtime.WalletNegativeError{
					UserID:  userID,
					Path:    k,
					Current: walletMap[k],
					Amount:  v,
				}
			}
			walletMap[k] = newValue
		}

		result.Updated = walletMap
		results = append(results, result)

		walletData, err := json.Marshal(walletMap)
		if err != nil {
			logger.Debug("Error converting new user wallet.", zap.String("user_id", userID), zap.Error(err))
			return nil, err
		}
		updatedWallets[userID] = walletData
		updateOrder = append(updateOrder, userID)

		// Prepare ledger updates if needed.
		if updateLedger {
			changesetData, err := json.Marshal(update.Changeset)
			if err != nil {
				logger.Debug("Error converting new user wallet changeset.", zap.String("user_id", update.UserID.String()), zap.Error(err))
				return nil, err
			}

			params = append(params, uuid.Must(uuid.NewV4()), userID, changesetData, update.Metadata)
			statements = append(statements, fmt.Sprintf("($%v::UUID, $%v, $%v, $%v)", strconv.Itoa(len(params)-3), strconv.Itoa(len(params)-2), strconv.Itoa(len(params)-1), strconv.Itoa(len(params))))
		}
	}

	if len(updatedWallets) > 0 {
		// Ensure updates are done in natural order of user ID.
		sort.Strings(updateOrder)

		// Write the updated wallets.
		for _, userID := range updateOrder {
			updatedWallet, ok := updatedWallets[userID]
			if !ok {
				// Should not happen.
				logger.Warn("Missing wallet update for user.", zap.String("user_id", userID))
				continue
			}
			_, err = tx.ExecContext(ctx, "UPDATE users SET update_time = now(), wallet = $2 WHERE id = $1", userID, updatedWallet)
			if err != nil {
				logger.Debug("Error writing user wallet.", zap.String("user_id", userID), zap.Error(err))
				return nil, err
			}
		}

		// Write the ledger updates, if any.
		if updateLedger && (len(statements) > 0) {
			_, err = tx.ExecContext(ctx, "INSERT INTO wallet_ledger (id, user_id, changeset, metadata) VALUES "+strings.Join(statements, ", "), params...)
			if err != nil {
				logger.Debug("Error writing user wallet ledgers.", zap.Error(err))
				return nil, err
			}
		}
	}

	return results, nil
}

func UpdateWalletLedger(ctx context.Context, logger *zap.Logger, db *sql.DB, id uuid.UUID, metadata string) (*walletLedger, error) {
	// Metadata is expected to already be a valid JSON string.
	var userID string
	var changeset sql.NullString
	var createTime pgtype.Timestamptz
	var updateTime pgtype.Timestamptz
	query := "UPDATE wallet_ledger SET update_time = now(), metadata = metadata || $2 WHERE id = $1::UUID RETURNING user_id, changeset, create_time, update_time"
	err := db.QueryRowContext(ctx, query, id, metadata).Scan(&userID, &changeset, &createTime, &updateTime)
	if err != nil {
		logger.Error("Error updating user wallet ledger.", zap.String("id", id.String()), zap.Error(err))
		return nil, err
	}

	var changesetMap map[string]int64
	err = json.Unmarshal([]byte(changeset.String), &changesetMap)
	if err != nil {
		logger.Error("Error converting user wallet ledger changeset after update.", zap.String("id", id.String()), zap.Error(err))
		return nil, err
	}

	return &walletLedger{
		UserID:     userID,
		Changeset:  changesetMap,
		CreateTime: createTime.Time.Unix(),
		UpdateTime: updateTime.Time.Unix(),
	}, nil
}

func ListWalletLedger(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, limit *int, cursor string) ([]*walletLedger, string, string, error) {
	var incomingCursor *walletLedgerListCursor
	if cursor != "" {
		cb, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			return nil, "", "", runtime.ErrWalletLedgerInvalidCursor
		}
		incomingCursor = &walletLedgerListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, "", "", runtime.ErrWalletLedgerInvalidCursor
		}

		// Cursor and filter mismatch. Perhaps the caller has sent an old cursor with a changed filter.
		if userID.String() != incomingCursor.UserId {
			return nil, "", "", runtime.ErrWalletLedgerInvalidCursor
		}
	}

	params := []interface{}{userID, time.Now().UTC(), uuid.UUID{}}
	if incomingCursor != nil {
		params[1] = incomingCursor.CreateTime
		params[2] = incomingCursor.Id
	}

	query := `SELECT id, changeset, metadata, create_time, update_time FROM wallet_ledger WHERE user_id = $1::UUID AND (user_id, create_time, id) < ($1::UUID, $2, $3::UUID) ORDER BY create_time DESC`
	if incomingCursor != nil && !incomingCursor.IsNext {
		query = `SELECT id, changeset, metadata, create_time, update_time FROM wallet_ledger WHERE user_id = $1::UUID AND (user_id, create_time, id) > ($1::UUID, $2, $3::UUID) ORDER BY create_time ASC`
	}

	if limit != nil {
		query = fmt.Sprintf(`%s LIMIT %v`, query, *limit+1)
	}

	results := make([]*walletLedger, 0, 10)
	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving user wallet ledger.", zap.String("user_id", userID.String()), zap.Error(err))
		return nil, "", "", err
	}
	defer rows.Close()

	var id string
	var changeset sql.NullString
	var metadata sql.NullString
	var createTime pgtype.Timestamptz
	var updateTime pgtype.Timestamptz
	var nextCursor *walletLedgerListCursor
	var prevCursor *walletLedgerListCursor
	for rows.Next() {
		if limit != nil && len(results) >= *limit {
			nextCursor = &walletLedgerListCursor{
				UserId:     userID.String(),
				Id:         id,
				CreateTime: createTime.Time,
				IsNext:     true,
			}
			break
		}

		err = rows.Scan(&id, &changeset, &metadata, &createTime, &updateTime)
		if err != nil {
			logger.Error("Error converting user wallet ledger.", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, "", "", err
		}

		var changesetMap map[string]int64
		err = json.Unmarshal([]byte(changeset.String), &changesetMap)
		if err != nil {
			logger.Error("Error converting user wallet ledger changeset.", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, "", "", err
		}

		var metadataMap map[string]interface{}
		err = json.Unmarshal([]byte(metadata.String), &metadataMap)
		if err != nil {
			logger.Error("Error converting user wallet ledger metadata.", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, "", "", err
		}

		results = append(results, &walletLedger{
			ID:         id,
			Changeset:  changesetMap,
			Metadata:   metadataMap,
			CreateTime: createTime.Time.Unix(),
			UpdateTime: updateTime.Time.Unix(),
		})

		if incomingCursor != nil && prevCursor == nil {
			prevCursor = &walletLedgerListCursor{
				UserId:     userID.String(),
				Id:         id,
				CreateTime: createTime.Time,
				IsNext:     false,
			}
		}
	}

	if incomingCursor != nil && !incomingCursor.IsNext {
		if nextCursor != nil && prevCursor != nil {
			nextCursor, nextCursor.IsNext, prevCursor, prevCursor.IsNext = prevCursor, prevCursor.IsNext, nextCursor, nextCursor.IsNext
		} else if nextCursor != nil {
			nextCursor, prevCursor = nil, nextCursor
			prevCursor.IsNext = !prevCursor.IsNext
		} else if prevCursor != nil {
			nextCursor, prevCursor = prevCursor, nil
			nextCursor.IsNext = !nextCursor.IsNext
		}

		for i, j := 0, len(results)-1; i < j; i, j = i+1, j-1 {
			results[i], results[j] = results[j], results[i]
		}
	}

	var nextCursorStr string
	if nextCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			logger.Error("Error creating wallet ledger list cursor", zap.Error(err))
			return nil, "", "", err
		}
		nextCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	var prevCursorStr string
	if prevCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
			logger.Error("Error creating wallet ledger list cursor", zap.Error(err))
			return nil, "", "", err
		}
		prevCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return results, nextCursorStr, prevCursorStr, nil
}
