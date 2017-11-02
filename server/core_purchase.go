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

	"errors"

	"encoding/json"

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
		multiLogger.Warn("Skip initialising Apple in-app purchase provider", zap.String("reason", err.Error()))
	} else {
		if config.Apple.Production {
			multiLogger.Info("Apple in-app purchase environment is set to Production priority.")
		} else {
			multiLogger.Info("Apple in-app purchase environment is set to Sandbox priority.")
		}
		multiLogger.Info("Successfully initiated Apple in-app purchase provider.")
	}

	gc, err := iap.NewGoogleClient(config.Google.PackageName, config.Google.ServiceKeyFilePath, config.Google.TimeoutMs)
	if err != nil {
		multiLogger.Warn("Skip initialising Google in-app purchase provider", zap.String("reason", err.Error()))
	}

	return &PurchaseService{
		logger:       jsonLogger,
		db:           db,
		AppleClient:  ac,
		GoogleClient: gc,
	}
}

func (p *PurchaseService) ValidateApplePurchase(userID string, purchase *iap.ApplePurchase) *iap.PurchaseVerifyResponse {
	r, appleReceipt := p.AppleClient.Verify(purchase)
	if !r.Success {
		return r
	}

	//TODO: Improvement - Process more than one in-app receipts
	inAppReceipt := appleReceipt.InApp[0]
	p.checkUser(userID, r, 1, inAppReceipt.TransactionID)

	if r.Success && !r.SeenBefore {
		err := p.savePurchase(userID, 1, inAppReceipt.ProductID, inAppReceipt.TransactionID, purchase.ReceiptData, r.Data)
		if err != nil {
			r.Success = false
			r.Message = errors.New("Failed to validate purchase against ledger.")
			jsonPurchase, _ := json.Marshal(purchase)
			p.logger.Error("Could not save Apple purchase", zap.String("receipt", string(jsonPurchase)), zap.String("provider_resp", r.Data), zap.Error(err))
		}
	}
	return r
}

func (p *PurchaseService) ValidateGooglePurchaseProduct(userID string, purchase *iap.GooglePurchase) *iap.PurchaseVerifyResponse {
	r, _ := p.GoogleClient.VerifyProduct(purchase)
	if !r.Success {
		return r
	}

	p.checkUser(userID, r, 0, purchase.PurchaseToken)
	if r.Success && !r.SeenBefore {
		jsonPurchase, _ := json.Marshal(purchase)
		err := p.savePurchase(userID, 0, purchase.ProductId, purchase.PurchaseToken, string(jsonPurchase), r.Data)
		if err != nil {
			r.Success = false
			r.Message = errors.New("Failed to validate purchase against ledger.")
			p.logger.Error("Could not save Google product purchase", zap.String("receipt", string(jsonPurchase)), zap.String("provider_resp", r.Data), zap.Error(err))
		}
	}
	return r
}

func (p *PurchaseService) ValidateGooglePurchaseSubscription(userID string, purchase *iap.GooglePurchase) *iap.PurchaseVerifyResponse {
	r, _ := p.GoogleClient.VerifySubscription(purchase)
	if !r.Success {
		return r
	}

	p.checkUser(userID, r, 0, purchase.PurchaseToken)
	if r.Success && !r.SeenBefore {
		jsonPurchase, _ := json.Marshal(purchase)
		err := p.savePurchase(userID, 0, purchase.ProductId, purchase.PurchaseToken, string(jsonPurchase), r.Data)
		if err != nil {
			r.Success = false
			r.Message = errors.New("Failed to validate purchase against ledger.")
			p.logger.Error("Could not save Google subscription purchase", zap.String("receipt", string(jsonPurchase)), zap.String("provider_resp", r.Data), zap.Error(err))
		}
	}
	return r
}

func (p *PurchaseService) checkUser(userID string, r *iap.PurchaseVerifyResponse, provider int, receiptID string) {
	var purchaseUserID string
	err := p.db.QueryRow("SELECT user_id FROM purchase WHERE provider = $1 AND receipt_id = $2", provider, receiptID).Scan(&purchaseUserID)
	if err != nil {
		if err != sql.ErrNoRows {
			r.Success = false
			r.Message = errors.New("Failed to validate purchase against ledger.")
			p.logger.Error(r.Message.Error(), zap.Error(err))
		}
	}

	// We've not seen this transaction
	if len(purchaseUserID) == 0 {
		r.Success = true
		r.SeenBefore = false
		r.Message = nil
	} else { // We've seen this transaction
		if userID == purchaseUserID {
			r.Success = true
			r.SeenBefore = true
			r.Message = nil
		} else {
			r.Success = false
			r.SeenBefore = true
			r.Message = errors.New("Transaction already registered to a different user")
		}
	}
}

func (p *PurchaseService) savePurchase(userID string, provider int, productID string, receiptID string, rawPurchase string, rawReceipt string) error {
	createdAt := nowMs()
	_, err := p.db.Exec(`
INSERT INTO purchase (user_id, provider, product_id, receipt_id, receipt, provider_resp, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		userID, provider, productID, receiptID, rawPurchase, rawReceipt, createdAt)

	return err
}
