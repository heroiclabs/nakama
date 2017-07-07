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

	"io/ioutil"

	"go.uber.org/zap"
)

const (
	APPLE_ENV_PRODUCTION  = "https://buy.itunes.apple.com/verifyReceipt"
	APPLE_ENV_SANDBOX     = "https://sandbox.itunes.apple.com/verifyReceipt"
	CONTENT_TYPE_APP_JSON = "application/json"
)

const (
	VALID                   = 0
	UNREADABLE_JSON         = 21000
	MALFORMED_DATA          = 21002
	AUTHENTICATION_ERROR    = 21003
	UNMATCHED_SECRET        = 21004
	SERVER_UNAVAILABLE      = 21005
	SUBSCRIPTION_EXPIRED    = 21006
	SANDBOX_RECEIPT_ON_PROD = 21007
	PROD_RECEIPT_ON_SANDBOX = 21008
)

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

func (ac *AppleClient) Verify(ps []*ApplePurchase) []*PurchaseVerifyResponse {
	pr := make([]*PurchaseVerifyResponse, 0)
	for _, p := range ps {
		r := ac.singleVerify(p)
		pr = append(pr, r)
	}

	return pr
}

func (ac *AppleClient) singleVerify(p *ApplePurchase) (r *PurchaseVerifyResponse) {
	payload, _ := json.Marshal(&appleRequest{
		ReceiptData: p.ReceiptData,
		Password:    ac.password,
	})

	resp, err := ac.client.Post(ac.env, CONTENT_TYPE_APP_JSON, strings.NewReader(string(payload)))
	if err != nil {
		r.Message = "Could not connect to Apple verification service."
		ac.logger.Warn(r.Message, zap.Error(err))
		return
	}

	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		r.Message = "Could not read response from Apple verification service."
		ac.logger.Warn(r.Message, zap.Error(err))
		return
	}

	appleResp := &appleResponse{}
	if err = json.Unmarshal(body, &appleResp); err != nil {
		r.Message = "Could not parse response from Apple verification service."
		ac.logger.Warn(r.Message, zap.Error(err))
		return
	}

	if valid, reason := ac.checkStatus(appleResp); !valid {
		r.Message = reason
		ac.logger.Warn("Apple purchase status failed", zap.String("reason", reason))
		return
	}

	if valid, reason := ac.checkReceipt(appleResp); !valid {
		r.Message = reason
		ac.logger.Warn("Apple receipt verification failed", zap.String("reason", reason))
		return
	}

	ac.saveReceipt(appleResp)
	return
}

func (ac *AppleClient) checkStatus(a *appleResponse) (valid bool, reason string) {
	switch a.Status {
	case VALID:
		return true, ""
	case UNREADABLE_JSON:
		return false, "Apple could not read the receipt."
	case MALFORMED_DATA:
		return false, "Receipt was malformed."
	case AUTHENTICATION_ERROR:
		return false, "The receipt could not be authenticated."
	case UNMATCHED_SECRET:
		return false, "Apple Purchase password is invalid."
	case SERVER_UNAVAILABLE:
		return false, "Apple purchase verification servers are not currently available."
	case SUBSCRIPTION_EXPIRED:
		return false, "This receipt is valid but the subscription has expired."
	case SANDBOX_RECEIPT_ON_PROD:
		return false, "This receipt is a sandbox receipt, but it was sent to the production service for verification."
	case PROD_RECEIPT_ON_SANDBOX:
		return false, "This receipt is a production receipt, but it was sent to the sandbox service for verification."
	default:
		return false, "An unknown error occurred"
	}
}

func (ac *AppleClient) checkReceipt(a *appleResponse) (valid bool, reason string) {

}

func (ac *AppleClient) saveReceipt(a *appleResponse) {

}
