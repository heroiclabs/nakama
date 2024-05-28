// Copyright 2020 The Nakama Authors
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

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
)

func MultiUpdate(ctx context.Context, logger *zap.Logger, db *sql.DB, metrics Metrics, accountUpdates []*accountUpdate, storageWrites StorageOpWrites, storageDeletes StorageOpDeletes, storageIndex StorageIndex, walletUpdates []*walletUpdate, updateLedger bool) ([]*api.StorageObjectAck, []*runtime.WalletUpdateResult, error) {
	if len(accountUpdates) == 0 && len(storageWrites) == 0 && len(storageDeletes) == 0 && len(walletUpdates) == 0 {
		return nil, nil, nil
	}

	var storageWriteAcks []*api.StorageObjectAck
	var storageWriteOps StorageOpWrites
	var walletUpdateResults []*runtime.WalletUpdateResult

	if err := ExecuteInTxPgx(ctx, db, func(tx pgx.Tx) error {
		storageWriteAcks = nil
		walletUpdateResults = nil

		// Execute any account updates.
		updateErr := updateAccounts(ctx, logger, tx, accountUpdates)
		if updateErr != nil {
			return updateErr
		}

		// Execute any storage updates.
		storageWriteOps, storageWriteAcks, updateErr = storageWriteObjects(ctx, logger, metrics, tx, true, storageWrites)
		if updateErr != nil {
			return updateErr
		}

		// Execute any storage deletes.
		deleteErr := storageDeleteObjects(ctx, logger, tx, true, storageDeletes)
		if deleteErr != nil {
			return deleteErr
		}

		// Execute any wallet updates.
		walletUpdateResults, updateErr = updateWallets(ctx, logger, tx, walletUpdates, updateLedger)
		if updateErr != nil {
			return updateErr
		}

		return nil
	}); err != nil {
		if e, ok := err.(*statusError); ok {
			return nil, walletUpdateResults, e.Cause()
		}
		logger.Error("Error running multi update.", zap.Error(err))
		return nil, walletUpdateResults, err
	}

	// Update storage index.
	storageIndexWrite(ctx, storageIndex, storageWriteOps, storageWriteAcks)
	storageIndex.Delete(ctx, storageDeletes)

	return storageWriteAcks, walletUpdateResults, nil
}
