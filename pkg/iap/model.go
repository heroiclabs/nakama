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
	Message error
	// The complete response Nakama received from the remote service.
	Data string
}

type ApplePurchase struct {
	// The receipt data returned by the purchase operation itself.
	ProductId string
	// The product, item, or subscription package ID the purchase relates to.
	ReceiptData string
}

type AppleRequest struct {
	ReceiptData string `json:"receipt-data"`
	Password    string `json:"password"`
}

type AppleResponse struct {
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
	BundleID                   string               `json:"bundle_id"`
	ApplicationVersion         string               `json:"application_version"`
	InApp                      []*AppleInAppReceipt `json:"in_app"`
	OriginalApplicationVersion string               `json:"original_application_version"`
	CreationDate               string               `json:"creation_date"`
	ExpirationDate             string               `json:"expiration_date"`
}

type AppleInAppReceipt struct {
	Quantity                  string `json:"quantity"`
	ProductID                 string `json:"product_id"`
	TransactionID             string `json:"transaction_id"`
	OriginalTransactionID     string `json:"original_transaction_id"`
	PurchaseDate              string `json:"purchase_date"`
	OriginalPurchaseDate      string `json:"original_purchase_date"`
	ExpiresDate               string `json:"expires_date"`
	AppItemID                 string `json:"app_item_id"`
	VersionExternalIdentifier string `json:"version_external_identifier"`
	WebOrderLineItemID        string `json:"web_order_line_item_id"`
	CancellationDate          string `json:"cancellation_date"`
}

type GooglePurchase struct {
	// The identifier of the product or subscription being purchased.
	ProductId string `json:"ProductId"`
	// Whether the purchase is for a single product or a subscription.
	ProductType string `json:"ProductType"`
	// The token returned in the purchase operation response, acts as a transaction identifier.
	PurchaseToken string `json:"PurchaseToken"`
}

type GoogleProductReceipt struct {
	Kind               string `json:"kind"`
	PurchaseTimeMillis int64  `json:"purchaseTimeMillis"`
	PurchaseState      int    `json:"purchaseState"`
	ConsumptionState   int    `json:"consumptionState"`
	DeveloperPayload   string `json:"developerPayload"`
}

type GoogleSubscriptionReceipt struct {
	Kind                       string `json:"kind"`
	StartTimeMillis            int64  `json:"startTimeMillis"`
	ExpiryTimeMillis           int64  `json:"expiryTimeMillis"`
	AutoRenewing               bool   `json:"autoRenewing"`
	PriceCurrencyCode          string `json:"priceCurrencyCode"`
	PriceAmountMicros          int64  `json:"priceAmountMicros"`
	CountryCode                string `json:"countryCode"`
	DeveloperPayload           string `json:"developerPayload"`
	PaymentState               int    `json:"paymentState"`
	CancelReason               int    `json:"cancelReason"`
	UserCancellationTimeMillis int64  `json:"userCancellationTimeMillis"`
}
