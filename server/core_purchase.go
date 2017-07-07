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

package server

import (
	"database/sql"
	"nakama/pkg/iap"

	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

type PurchaseService struct {
	logger       *zap.Logger
	db           *sql.DB
	AppleClient  *iap.AppleClient
	GoogleClient *iap.GoogleClient
}

func NewPurchaseService(jsonLogger *zap.Logger, multiLogger *zap.Logger, db *sql.DB, config *PurchaseConfig) *PurchaseService {
	ac, err := iap.NewAppleClient(config.Apple.Password, config.Apple.Production, config.Apple.TimeoutMs)
	if err != nil {
		multiLogger.Warn("Skip initialising Apple in-app purchase provider.", zap.Error(err))
	} else {
		if config.Apple.Production {
			multiLogger.Info("Apple in-app purchase environment is set to Production priority.")
		} else {
			multiLogger.Info("Apple in-app purchase environment is set to Sandbox priority.")
		}
		multiLogger.Info("Successfully initiated Apple in-app purchase provider.")
	}

	gc, err := iap.NewGoogleClient(config.Google.PackageName, config.Google.ServiceKeyFilePath)
	if err != nil {
		multiLogger.Warn("Skip initialising Google in-app purchase provider.", zap.Error(err))
	}

	return &PurchaseService{
		logger:       jsonLogger,
		db:           db,
		AppleClient:  ac,
		GoogleClient: gc,
	}
}

func (p *PurchaseService) validateApplePurchase(userID uuid.UUID, purchase *iap.ApplePurchase) *iap.PurchaseVerifyResponse {
	r := p.AppleClient.Verify(purchase)
	if !r.Success {
		return r
	}

	//TODO check against ledger and store

	return r
}

func (p *PurchaseService) validateGooglePurchase(userID uuid.UUID, purchase *iap.GooglePurchase) *iap.PurchaseVerifyResponse {
	r := p.GoogleClient.Verify(purchase)
	if !r.Success {
		return r
	}

	//TODO check against ledger and store

	return r
}
