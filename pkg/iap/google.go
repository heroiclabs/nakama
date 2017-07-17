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
	"context"
	"io/ioutil"
	"net/http"

	"errors"

	"encoding/json"

	"fmt"

	"time"

	"golang.org/x/oauth2/google"
)

const (
	GOOGLE_IAP_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
	GOOGLE_IAP_URL   = "https://www.googleapis.com/androidpublisher/v2/applications/%s/purchases/%s/%s/tokens/%s"
)

type GoogleClient struct {
	client             *http.Client
	packageName        string
	serviceKeyFilePath string
}

func NewGoogleClient(packageName string, serviceKeyFilePath string, timeout int) (*GoogleClient, error) {
	gc := &GoogleClient{
		packageName:        packageName,
		serviceKeyFilePath: serviceKeyFilePath,
	}

	if gc.packageName == "" {
		return nil, errors.New("Missing package name")
	}
	if gc.serviceKeyFilePath == "" {
		return nil, errors.New("Missing service account key")
	}

	jsonContent, err := ioutil.ReadFile(gc.serviceKeyFilePath)
	if err != nil {
		return nil, errors.New("Failed to read Google service account key")
	}

	config, err := google.JWTConfigFromJSON(jsonContent, GOOGLE_IAP_SCOPE)
	if err != nil {
		return nil, errors.New("Failed to parse Google service account key")
	}

	gc.client = config.Client(context.Background())
	gc.client.Timeout = time.Duration(int64(timeout)) * time.Millisecond
	return gc, nil
}

func NewGoogleClientWithHTTP(packageName string, httpClient *http.Client) (*GoogleClient, error) {
	if packageName == "" {
		return nil, errors.New("Missing package name")
	}

	gc := &GoogleClient{
		packageName: packageName,
		client:      httpClient,
	}
	return gc, nil
}

func (gc *GoogleClient) VerifyProduct(p *GooglePurchase) (*PurchaseVerifyResponse, *GoogleProductReceipt) {
	r := &PurchaseVerifyResponse{}

	body, err := gc.sendGoogleRequest(p)
	if err != nil {
		r.Message = err
		return r, nil
	}

	googleProductResp := &GoogleProductReceipt{}
	if err = json.Unmarshal(body, &googleProductResp); err != nil {
		r.Message = errors.New("Could not parse product response from Google verification service.")
		return r, nil
	}

	r.PurchaseProviderReachable = true
	r.Data = string(body)

	// 0=Purchased, 1=Cancelled
	if googleProductResp.PurchaseState != 0 {
		r.Message = errors.New("Purchase has been voided or cancelled.")
		return r, nil
	}

	// 0=Yet to be consumed, 1=Consumed
	if googleProductResp.ConsumptionState != 0 {
		r.Message = errors.New("Purchase has already been consumed.")
		return r, nil
	}

	r.Success = true
	r.Message = nil
	return r, googleProductResp
}

func (gc *GoogleClient) VerifySubscription(p *GooglePurchase) (*PurchaseVerifyResponse, *GoogleSubscriptionReceipt) {
	r := &PurchaseVerifyResponse{}

	body, err := gc.sendGoogleRequest(p)
	if err != nil {
		r.Message = err
		return r, nil
	}

	googleSubscriptionResp := &GoogleSubscriptionReceipt{}
	if err = json.Unmarshal(body, &googleSubscriptionResp); err != nil {
		r.Message = errors.New("Could not parse subscription response from Google verification service.")
		return r, nil
	}

	r.PurchaseProviderReachable = true
	r.Data = string(body)

	nowEpoch := time.Now().UnixNano() / 1000000

	if googleSubscriptionResp.ExpiryTimeMillis < nowEpoch {
		r.Message = errors.New("Purchase is a subscription that expired.")
		return r, nil
	}

	r.Success = true
	r.Message = nil
	return r, googleSubscriptionResp
}

func (gc *GoogleClient) sendGoogleRequest(p *GooglePurchase) ([]byte, error) {
	url := fmt.Sprintf(GOOGLE_IAP_URL, gc.packageName, p.ProductType, p.ProductId, p.PurchaseToken)
	resp, err := gc.client.Post(url, CONTENT_TYPE_APP_JSON, nil)
	if err != nil {
		return nil, errors.New("Could not connect to Google verification service.")
	}

	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, errors.New("Could not read response from Google verification service.")
	}
	return body, nil
}
