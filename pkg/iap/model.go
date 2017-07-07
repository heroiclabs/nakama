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

const (
	CONTENT_TYPE_APP_JSON = "application/json"
)

type PurchaseVerifyResponse struct {
	// Whether or not the transaction is valid and all the information matches.
	Success bool
	// If this is a new transaction or if Nakama has a log of it.
	SeenBefore bool
	// Indicates whether or not Nakama was able to reach the remote purchase service.
	PurchaseProviderReachable bool
	// A string indicating why the purchase verification failed, if appropriate.
	Message string
	// The complete response Nakama received from the remote service.
	Data string
}

type ApplePurchase struct {
	// The receipt data returned by the purchase operation itself.
	ProductId string
	// The product, item, or subscription package ID the purchase relates to.
	ReceiptData string
}

type GooglePurchase struct {
	// The identifier of the product or subscription being purchased.
	ProductId string
	// Whether the purchase is for a single product or a subscription.
	ProductType string
	// The token returned in the purchase operation response, acts as a transaction identifier.
	PurchaseToken string
}

// Unexported structs

type appleRequest struct {
	ReceiptData string `json:"receipt-data"`
	Password    string `json:"password"`
}

type appleResponse struct {
	//Either 0 if the receipt is valid, or one of the error codes
	Status int `json:"status"`
	// A JSON representation of the receipt that was sent for verification
	Receipt *AppleReceipt `json:"receipt"`
	// Only returned for iOS 6 style transaction receipts for auto-renewable subscriptions. The base-64 encoded transaction receipt for the most recent renewal.
	LatestReceipt string `json:"latest_receipt"`
	// Only returned for iOS 6 style transaction receipts for auto-renewable subscriptions. The JSON representation of the receipt for the most recent renewal.
	LatestReceiptInfo map[string]interface{} `json:"latest_receipt_info"`
}

type AppleReceipt struct {
	BundleId                   string                  `json:"bundle_id"`
	ApplicationVersion         string                  `json:"application_version"`
	InApp                      []*ApplePurchaseReceipt `json:"in_app"`
	OriginalApplicationVersion string                  `json:"original_application_version"`
	CreationDate               string                  `json:"creation_date"`
	ExpirationDate             string                  `json:"expiration_date"`
}

type ApplePurchaseReceipt struct {
	Quantity                  string `json:"quantity"`
	ProductId                 string `json:"product_id"`
	TransactionId             string `json:"transaction_id"`
	OriginalTransactionId     string `json:"original_transaction_id"`
	PurchaseDate              string `json:"purchase_date"`
	OriginalPurchaseDate      string `json:"original_purchase_date"`
	ExpiresDate               string `json:"expires_date"`
	AppItemId                 string `json:"app_item_id"`
	VersionExternalIdentifier string `json:"version_external_identifier"`
	WebOrderLineItemId        string `json:"web_order_line_item_id"`
}
