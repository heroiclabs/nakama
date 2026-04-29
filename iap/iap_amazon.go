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
)

const (
	amazonRvsProductionBase = "https://appstore-sdk.amazon.com"
	amazonRvsSandboxBase    = "https://appstore-sdk.amazon.com/sandbox"
)

// AmazonRvsResponse is the response from the Amazon Receipt Validation Service.
// https://developer.amazon.com/docs/in-app-purchasing/iap-rvs-for-android-apps.html
type AmazonRvsResponse struct {
	ReceiptId       string `json:"receiptId"`
	UserId          string `json:"userId"`
	ProductType     string `json:"productType"`
	ProductId       string `json:"productId"`
	ItemType        string `json:"itemType"`
	PurchaseDate    int64  `json:"purchaseDate"`
	CancelDate      *int64 `json:"cancelDate"`
	CancelReason    int    `json:"cancelReason"`
	TestTransaction bool   `json:"testTransaction"`
}

// ValidateReceiptAmazon validates an Amazon IAP receipt against the Amazon
// Receipt Validation Service (RVS).
//
// developerSecret is the secret from the Amazon Developer Console under
// Apps & Services > In-App Purchasing.
// receiptId and amazonUserId come from the Amazon Appstore SDK PurchaseResponse.
// sandbox enables the Amazon RVS sandbox endpoint for test purchases.
//
// Returns the parsed RVS response, the raw response body, and any error.
func ValidateReceiptAmazon(ctx context.Context, httpc *http.Client, developerSecret, receiptId, amazonUserId string, sandbox bool) (*AmazonRvsResponse, []byte, error) {
	base := amazonRvsProductionBase
	if sandbox {
		base = amazonRvsSandboxBase
	}

	url := fmt.Sprintf(
		"%s/version/1.0/verifyReceiptId/developer/%s/user/%s/receiptId/%s",
		base, developerSecret, amazonUserId, receiptId,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, nil, &ValidationError{Err: fmt.Errorf("failed to build Amazon RVS request: %w", err)}
	}

	resp, err := httpc.Do(req)
	if err != nil {
		return nil, nil, &ValidationError{Err: fmt.Errorf("Amazon RVS request failed: %w", err)}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, &ValidationError{Err: err, StatusCode: resp.StatusCode}
	}

	switch resp.StatusCode {
	case http.StatusOK:
		// Valid receipt — parse response below.
	case http.StatusBadRequest:
		// 400: the receiptId is not valid.
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Amazon RVS: invalid receipt"),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	case 496:
		// 496: the developer secret is wrong (Amazon-specific status code).
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Amazon RVS: invalid developer secret"),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	default:
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Amazon RVS returned HTTP %d", resp.StatusCode),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	var rvsResp AmazonRvsResponse
	if err := json.Unmarshal(raw, &rvsResp); err != nil {
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("failed to parse Amazon RVS response: %w", err),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	if rvsResp.ReceiptId == "" {
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Amazon RVS response missing receiptId"),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	return &rvsResp, raw, nil
}
