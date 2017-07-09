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
	"bytes"
	"encoding/json"
	"errors"
	"io/ioutil"
	"net/http"
	"testing"
	"time"
)

const (
	TEST_GOOGLE_PRODUCT_ID = "com.heroiclabs.iap.google"
)

func setupGoogleClient(googleReceipt interface{}) *GoogleClient {
	g, _ := json.Marshal(googleReceipt)
	return &GoogleClient{
		packageName: "com.heroiclabs.iap.google.packagename",
		client: &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			resp := &http.Response{
				StatusCode: 200,
				Body:       ioutil.NopCloser(bytes.NewReader(g)),
			}
			return resp, nil
		})},
	}
}

func TestGooglePurchaseProviderUnavailable(t *testing.T) {
	gc := &GoogleClient{
		packageName: "com.heroiclabs.iap.google.packagename",
		client: &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			return nil, errors.New("Could not connect to Google verification service.")
		})},
	}

	r, _ := gc.VerifyProduct(&GooglePurchase{
		ProductType: "product",
		ProductId:   TEST_GOOGLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Google purchase should not have been successful.")
	}

	if r.PurchaseProviderReachable {
		t.Fatal("Google purchase provider should NOT have been reachable.")
	}

	assertEquals(t, "Could not connect to Google verification service.", r.Message.Error())
}

func TestGooglePurchaseProviderInvalidResponse(t *testing.T) {
	gc := &GoogleClient{
		packageName: "com.heroiclabs.iap.google.packagename",
		client: &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			resp := &http.Response{
				StatusCode: 400,
				Body:       ioutil.NopCloser(bytes.NewReader([]byte("invalid json response from Google"))),
			}
			return resp, nil
		})},
	}

	r, _ := gc.VerifyProduct(&GooglePurchase{
		ProductType: "product",
		ProductId:   TEST_GOOGLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Google purchase should not have been successful.")
	}

	if r.PurchaseProviderReachable {
		t.Fatal("Google purchase provider should NOT have been reachable.")
	}

	assertEquals(t, "Could not parse product response from Google verification service.", r.Message.Error())
}

func TestGoogleProductCancelled(t *testing.T) {
	gc := setupGoogleClient(&GoogleProductReceipt{
		PurchaseState:    1,
		ConsumptionState: 0,
	})

	r, _ := gc.VerifyProduct(&GooglePurchase{
		ProductType: "product",
		ProductId:   TEST_GOOGLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Google purchase should not have been successful.")
	}

	if !r.PurchaseProviderReachable {
		t.Fatal("Google purchase provider should have been reachable.")
	}

	assertEquals(t, "Purchase has been voided or cancelled.", r.Message.Error())
}

func TestGoogleProductConsumed(t *testing.T) {
	gc := setupGoogleClient(&GoogleProductReceipt{
		PurchaseState:    0,
		ConsumptionState: 1,
	})

	r, _ := gc.VerifyProduct(&GooglePurchase{
		ProductType: "product",
		ProductId:   TEST_GOOGLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Google purchase should not have been successful.")
	}

	if !r.PurchaseProviderReachable {
		t.Fatal("Google purchase provider should have been reachable.")
	}

	assertEquals(t, "Purchase has already been consumed.", r.Message.Error())
}

func TestGoogleSubscriptionExpired(t *testing.T) {
	gc := setupGoogleClient(&GoogleSubscriptionReceipt{
		ExpiryTimeMillis: (time.Now().UnixNano() / 1000000) - 10,
	})

	r, _ := gc.VerifySubscription(&GooglePurchase{
		ProductType: "subscription",
		ProductId:   TEST_GOOGLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Google purchase should not have been successful.")
	}

	if !r.PurchaseProviderReachable {
		t.Fatal("Google purchase provider should have been reachable.")
	}

	assertEquals(t, "Purchase is a subscription that expired.", r.Message.Error())
}

func TestGoogleProductValid(t *testing.T) {
	gc := setupGoogleClient(&GoogleProductReceipt{
		PurchaseState:    0,
		ConsumptionState: 0,
	})

	r, _ := gc.VerifyProduct(&GooglePurchase{
		ProductType: "product",
		ProductId:   TEST_GOOGLE_PRODUCT_ID,
	})

	if !r.PurchaseProviderReachable {
		t.Fatal("Google purchase provider should have been reachable.")
	}

	if !r.Success || r.Message != nil {
		t.Fatal("Google purchase should have been successful.")
	}
}

func TestGoogleSubscriptionValid(t *testing.T) {
	gc := setupGoogleClient(&GoogleSubscriptionReceipt{
		ExpiryTimeMillis: (time.Now().UnixNano() / 1000000) + 30,
	})

	r, _ := gc.VerifySubscription(&GooglePurchase{
		ProductType: "subscription",
		ProductId:   TEST_GOOGLE_PRODUCT_ID,
	})

	if !r.PurchaseProviderReachable {
		t.Fatal("Google purchase provider should have been reachable.")
	}

	if !r.Success || r.Message != nil {
		t.Fatal("Google purchase should have been successful.")
	}
}
