// Copyright 2024 The Nakama Authors
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
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const samsungPurchaseDateLayout = "2006-01-02 15:04:05"

func ParseSamsungPurchaseDate(date string) time.Time {
	if date == "" {
		return time.Time{}
	}
	t, err := time.ParseInLocation(samsungPurchaseDateLayout, date, time.UTC)
	if err != nil {
		return time.Time{}
	}
	return t
}

const (
	samsungReceiptApiBase = "https://iap.samsungapps.com"
)

const (
	SamsungPurchaseStatusSuccess = "success"
	SamsungModeTest              = "TEST"
)

// SamsungPurchaseResponse is the response from the Samsung IAP receipt API.
// https://developer.samsung.com/iap/programming-guide/samsung-iap-server-api.html
type SamsungPurchaseResponse struct {
	Status        string `json:"status"`
	Mode          string `json:"mode"`
	OrderId       string `json:"orderId"`
	PaymentId     string `json:"paymentId"`
	PackageName   string `json:"packageName"`
	ItemId        string `json:"itemId"`
	ItemName      string `json:"itemName"`
	ItemDesc      string `json:"itemDesc"`
	ItemType      string `json:"itemType"`
	PaymentAmount string `json:"paymentAmount"`
	PaymentMethod string `json:"paymentMethod"`
	PurchaseDate  string `json:"purchaseDate"`
	ErrorCode     int    `json:"errorCode"`
	ErrorMessage  string `json:"errorMessage"`
}

func (r *SamsungPurchaseResponse) IsSandbox() bool {
	return r.Mode == SamsungModeTest
}

// ValidateReceiptSamsung validates a Samsung Galaxy Store IAP purchase against the
// Samsung IAP receipt API (GET /iap/v6/receipt?purchaseID=...).
//
// No service account credentials are required. Sandbox purchases are identified when
// the receipt response mode is TEST.
//
// packageName is optional; when set, the receipt packageName must match.
// purchaseId comes from the Samsung IAP SDK PurchaseVo.
//
// Returns the parsed receipt response, the raw response body, and any error.
func ValidateReceiptSamsung(ctx context.Context, httpc *http.Client, packageName, purchaseId string) (*SamsungPurchaseResponse, []byte, error) {
	if purchaseId == "" {
		return nil, nil, &ValidationError{Err: fmt.Errorf("Samsung IAP: purchaseId is required")}
	}

	receiptURL, err := url.Parse(samsungReceiptApiBase + "/iap/v6/receipt")
	if err != nil {
		return nil, nil, &ValidationError{Err: fmt.Errorf("failed to build Samsung IAP receipt URL: %w", err)}
	}
	query := receiptURL.Query()
	query.Set("purchaseID", purchaseId)
	receiptURL.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, receiptURL.String(), nil)
	if err != nil {
		return nil, nil, &ValidationError{Err: fmt.Errorf("failed to build Samsung IAP request: %w", err)}
	}

	resp, err := httpc.Do(req)
	if err != nil {
		return nil, nil, &ValidationError{Err: fmt.Errorf("Samsung IAP request failed: %w", err)}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, &ValidationError{Err: err, StatusCode: resp.StatusCode}
	}

	if resp.StatusCode != http.StatusOK {
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Samsung IAP returned HTTP %d", resp.StatusCode),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	var receiptResp SamsungPurchaseResponse
	if err := json.Unmarshal(raw, &receiptResp); err != nil {
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("failed to parse Samsung IAP response: %w", err),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	if receiptResp.Status != SamsungPurchaseStatusSuccess {
		errMsg := receiptResp.ErrorMessage
		if errMsg == "" {
			errMsg = receiptResp.Status
		}
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Samsung IAP: purchase validation failed: %s", errMsg),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	if packageName != "" && receiptResp.PackageName != "" && receiptResp.PackageName != packageName {
		return nil, raw, &ValidationError{
			Err: fmt.Errorf("Samsung IAP: package name mismatch (expected %s, got %s)", packageName, receiptResp.PackageName),
		}
	}

	if receiptResp.ItemId == "" {
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Samsung IAP response missing itemId"),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	return &receiptResp, raw, nil
}
