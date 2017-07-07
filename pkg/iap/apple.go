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
	"encoding/json"
	"io/ioutil"
	"net/http"
	"strings"
	"time"

	"errors"
)

const (
	APPLE_ENV_PRODUCTION = "https://buy.itunes.apple.com/verifyReceipt"
	APPLE_ENV_SANDBOX    = "https://sandbox.itunes.apple.com/verifyReceipt"
)

const (
	APPLE_VALID                   = 0
	APPLE_UNREADABLE_JSON         = 21000
	APPLE_MALFORMED_DATA          = 21002
	APPLE_AUTHENTICATION_ERROR    = 21003
	APPLE_UNMATCHED_SECRET        = 21004
	APPLE_SERVER_UNAVAILABLE      = 21005
	APPLE_SUBSCRIPTION_EXPIRED    = 21006
	APPLE_SANDBOX_RECEIPT_ON_PROD = 21007
	APPLE_PROD_RECEIPT_ON_SANDBOX = 21008
)

type AppleClient struct {
	client   *http.Client
	password string
	env      string
}

func NewAppleClient(password string, production bool, timeout int) (*AppleClient, error) {
	ac := &AppleClient{
		password: password,
	}
	err := ac.init(production, timeout)
	if err != nil {
		return nil, err
	}

	return ac, nil
}

func (ac *AppleClient) init(production bool, timeout int) error {
	if ac.password == "" {
		return errors.New("Apple in-app purchase configuration is inactive. Reason: Missing password")
	}

	if production {
		ac.env = APPLE_ENV_PRODUCTION
	} else {
		ac.env = APPLE_ENV_SANDBOX
	}

	ac.client = &http.Client{Timeout: 1500 * time.Millisecond}
	return nil
}

func (ac *AppleClient) Verify(p *ApplePurchase) (r *PurchaseVerifyResponse) {
	payload, _ := json.Marshal(&appleRequest{
		ReceiptData: p.ReceiptData,
		Password:    ac.password,
	})

	resp, err := ac.client.Post(ac.env, CONTENT_TYPE_APP_JSON, strings.NewReader(string(payload)))
	if err != nil {
		r.Message = "Could not connect to Apple verification service."
		return
	}

	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		r.Message = "Could not read response from Apple verification service."
		return
	}

	appleResp := &appleResponse{}
	if err = json.Unmarshal(body, &appleResp); err != nil {
		r.Message = "Could not parse response from Apple verification service."
		return
	}

	r.PurchaseProviderReachable = true
	r.Data = string(body)
	if valid, reason := ac.checkStatus(appleResp); !valid {
		r.Message = reason
		return
	}

	if valid, reason := ac.checkReceipt(appleResp.Receipt); !valid {
		r.Message = reason
		return
	}

	r.Success = true
	return
}

func (ac *AppleClient) checkStatus(a *appleResponse) (valid bool, reason string) {
	switch a.Status {
	case APPLE_VALID:
		return true, ""
	case APPLE_UNREADABLE_JSON:
		return false, "Apple could not read the receipt."
	case APPLE_MALFORMED_DATA:
		return false, "Receipt was malformed."
	case APPLE_AUTHENTICATION_ERROR:
		return false, "The receipt could not be authenticated."
	case APPLE_UNMATCHED_SECRET:
		return false, "Apple Purchase password is invalid."
	case APPLE_SERVER_UNAVAILABLE:
		return false, "Apple purchase verification servers are not currently available."
	case APPLE_SUBSCRIPTION_EXPIRED:
		return false, "This receipt is valid but the subscription has expired."
	case APPLE_SANDBOX_RECEIPT_ON_PROD:
		return false, "This receipt is a sandbox receipt, but it was sent to the production service for verification."
	case APPLE_PROD_RECEIPT_ON_SANDBOX:
		return false, "This receipt is a production receipt, but it was sent to the sandbox service for verification."
	default:
		return false, "An unknown error occurred"
	}
}

func (ac *AppleClient) checkReceipt(a *AppleReceipt) (valid bool, reason string) {
	// TODO complete this
	return false, ""
}
