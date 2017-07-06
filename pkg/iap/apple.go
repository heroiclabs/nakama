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

package iap

import (
	"net/http"

	"time"

	"database/sql"

	"encoding/json"

	"strings"

	"go.uber.org/zap"
)

const (
	APPLE_ENV_PRODUCTION  = "https://buy.itunes.apple.com/verifyReceipt"
	APPLE_ENV_SANDBOX     = "https://sandbox.itunes.apple.com/verifyReceipt"
	CONTENT_TYPE_APP_JSON = "application/json"
)

type ApplePurchase struct {
	// The receipt data returned by the purchase operation itself.
	ProductId string
	// The product, item, or subscription package ID the purchase relates to.
	ReceiptData string
}

type AppleClient struct {
	client   *http.Client
	logger   *zap.Logger
	db       *sql.DB
	password string
	env      string
	enabled  bool
}

func NewAppleClient(logger *zap.Logger, db *sql.DB, password string, production bool, timeout int) *AppleClient {
	ac := &AppleClient{
		logger:   logger,
		db:       db,
		password: password,
	}
	ac.init(production, timeout)
	return ac
}

func (ac *AppleClient) init(production bool, timeout int) {
	if ac.password == "" {
		ac.logger.Warn("Apple Purchase configuration is inactive.", zap.String("reason", "Missing password"))
		return
	}

	if production {
		ac.env = APPLE_ENV_PRODUCTION
		ac.logger.Info("Apple Purchase environment is set to Production priority.")
	} else {
		ac.env = APPLE_ENV_SANDBOX
		ac.logger.Info("Apple Purchase environment is set to Sandbox priority.")
	}

	ac.client = &http.Client{Timeout: 1500 * time.Millisecond}
	ac.enabled = true
}

func (ac *AppleClient) Verify(ps []*ApplePurchase) []*PurchaseVerify {
	pr := make([]*PurchaseVerify, 0)
	for _, p := range ps {
		r := ac.singleVerify(p)
		pr = append(pr, r)
	}

	return pr
}

func (ac *AppleClient) singleVerify(p *ApplePurchase) *PurchaseVerify {
	r := &PurchaseVerify{}
	payload, _ := json.Marshal(map[string]string{
		"receipt_data": p.ReceiptData,
		"password":     ac.password,
	})

	resp, err := ac.client.Post(ac.env, CONTENT_TYPE_APP_JSON, strings.NewReader(string(payload)))
	if err != nil {
		ac.logger.Warn("Could not connect to Apple verification service.", zap.Error(err))
		return r
	}

	//TODO deal with resp

	return r
}
