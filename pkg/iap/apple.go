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
	client     *http.Client
	password   string
	production bool
}

func NewAppleClient(password string, production bool, timeout int) (*AppleClient, error) {
	ac := &AppleClient{
		password:   password,
		production: production,
	}
	err := ac.init(production)
	if err != nil {
		return nil, err
	}

	ac.client = &http.Client{Timeout: time.Duration(int64(timeout)) * time.Millisecond}
	return ac, nil
}

func NewAppleClientWithHTTP(password string, production bool, httpClient *http.Client) (*AppleClient, error) {
	ac := &AppleClient{
		password:   password,
		production: production,
	}
	err := ac.init(production)
	if err != nil {
		return nil, err
	}

	ac.client = httpClient

	return ac, nil
}

func (ac *AppleClient) init(production bool) error {
	if ac.password == "" {
		return errors.New("Missing password")
	}

	return nil
}

func (ac *AppleClient) Verify(p *ApplePurchase) (*PurchaseVerifyResponse, *AppleReceipt) {
	payload, _ := json.Marshal(&AppleRequest{
		ReceiptData: p.ReceiptData,
		Password:    ac.password,
	})
	return ac.verify(payload, p, ac.production, false)
}

func (ac *AppleClient) verify(payload []byte, p *ApplePurchase, production bool, retrying bool) (*PurchaseVerifyResponse, *AppleReceipt) {
	r := &PurchaseVerifyResponse{}

	env := APPLE_ENV_SANDBOX
	if production {
		env = APPLE_ENV_PRODUCTION
	}

	resp, err := ac.client.Post(env, CONTENT_TYPE_APP_JSON, strings.NewReader(string(payload)))
	if err != nil {
		r.Message = errors.New("Could not connect to Apple verification service.")
		return r, nil
	}

	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		r.Message = errors.New("Could not read response from Apple verification service.")
		return r, nil
	}

	appleResp := &AppleResponse{}
	if err = json.Unmarshal(body, &appleResp); err != nil {
		r.Message = errors.New("Could not parse response from Apple verification service.")
		return r, nil
	}

	r.PurchaseProviderReachable = true
	r.Data = string(body)

	if reason := ac.checkStatus(appleResp); reason != "" {
		if appleResp.Status == APPLE_SANDBOX_RECEIPT_ON_PROD && !retrying {
			return ac.verify(payload, p, false, true)
		} else if appleResp.Status == APPLE_PROD_RECEIPT_ON_SANDBOX && !retrying {
			return ac.verify(payload, p, true, true)
		}

		r.Message = errors.New(reason)
		return r, nil
	}

	if reason := ac.checkReceipt(p.ProductId, appleResp.Receipt); reason != "" {
		r.Message = errors.New(reason)
		return r, nil
	}

	r.Success = true
	r.Message = nil
	return r, appleResp.Receipt
}

func (ac *AppleClient) checkStatus(a *AppleResponse) string {
	switch a.Status {
	case APPLE_VALID:
		return ""
	case APPLE_UNREADABLE_JSON:
		return "Apple could not read the receipt."
	case APPLE_MALFORMED_DATA:
		return "Receipt was malformed."
	case APPLE_AUTHENTICATION_ERROR:
		return "The receipt could not be validated."
	case APPLE_UNMATCHED_SECRET:
		return "Apple Purchase password is invalid."
	case APPLE_SERVER_UNAVAILABLE:
		return "Apple purchase verification servers are not currently available."
	case APPLE_SUBSCRIPTION_EXPIRED:
		return "This receipt is valid but the subscription has expired."
	case APPLE_SANDBOX_RECEIPT_ON_PROD:
		return "This receipt is a sandbox receipt, but it was sent to the production service for verification."
	case APPLE_PROD_RECEIPT_ON_SANDBOX:
		return "This receipt is a production receipt, but it was sent to the sandbox service for verification."
	default:
		return "An unknown error occurred"
	}
}

func (ac *AppleClient) checkReceipt(productId string, receipt *AppleReceipt) string {
	// This only support receipts in iOS 7+

	if len(receipt.InApp) < 1 {
		return "No in-app purchase receipts were found"
	}

	//TODO: Improvement - Process more than one in-app receipts
	a := receipt.InApp[0]
	if productId != a.ProductID {
		return "Product ID does not match receipt"
	}

	// Treat a canceled receipt the same as if no purchase had ever been made.
	if len(a.CancellationDate) > 0 {
		return "Purchase has been cancelled: " + a.CancellationDate
	}

	if len(a.ExpiresDate) > 0 {
		return "Purchase is a subscription that expired: " + a.ExpiresDate
	}

	return "" // valid
}
