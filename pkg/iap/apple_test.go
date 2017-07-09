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
	"io/ioutil"
	"net/http"
	"testing"
	"errors"
	"fmt"
)

const (
	TEST_APPLE_PRODUCT_ID = "com.heroiclabs.iap.apple"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)
func (fn roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}


func assertEquals(t *testing.T, expected, reality string) {
	if expected != reality {
		t.Fatal(fmt.Sprintf("Assertion failed. \"%s\" is not same as \"%s\"", expected, reality))
	}
}

// ----

func setupAppleClient(ar *AppleResponse) *AppleClient {
	a, _ := json.Marshal(ar)
	return &AppleClient{
		production: true,
		client: &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			resp := &http.Response{
				StatusCode: 200,
				Body:       ioutil.NopCloser(bytes.NewReader(a)),
			}
			return resp, nil
		})},
	}
}

func TestApplePurchaseProviderUnavailable(t *testing.T) {
	ac := &AppleClient{
		production: true,
		client: &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			return nil, errors.New("Could not connect to Apple verification service.")
		})},
	}

	r, _ := ac.Verify(&ApplePurchase{
		ProductId: TEST_APPLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Apple purchase should not have been successful.")
	}

	if r.PurchaseProviderReachable {
		t.Fatal("Apple purchase provider should NOT have been reachable.")
	}

	assertEquals(t, "Could not connect to Apple verification service.", r.Message.Error())
}

func TestApplePurchaseProviderInvalidResponse(t *testing.T) {
	ac := &AppleClient{
		production: true,
		client: &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			resp := &http.Response{
				StatusCode: 400,
				Body:       ioutil.NopCloser(bytes.NewReader([]byte("invalid json response from Apple"))),
			}
			return resp, nil
		})},
	}

	r, _ := ac.Verify(&ApplePurchase{
		ProductId: TEST_APPLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Apple purchase should not have been successful.")
	}

	if r.PurchaseProviderReachable {
		t.Fatal("Apple purchase provider should NOT have been reachable.")
	}

	assertEquals(t, "Could not parse response from Apple verification service.", r.Message.Error())
}

func TestInvalidStatus(t *testing.T) {
	ac := setupAppleClient(&AppleResponse{
		Status: APPLE_AUTHENTICATION_ERROR,
	})

	r, _ := ac.Verify(&ApplePurchase{
		ProductId: TEST_APPLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Apple purchase should not have been successful.")
	}

	if !r.PurchaseProviderReachable {
		t.Fatal("Apple purchase provider should have been reachable.")
	}

	assertEquals(t, "The receipt could not be validated.", r.Message.Error())
}

func TestNoInAppReceipt(t *testing.T) {
	ac := setupAppleClient(&AppleResponse{
		Status:  APPLE_VALID,
		Receipt: &AppleReceipt{},
	})

	r, _ := ac.Verify(&ApplePurchase{
		ProductId: TEST_APPLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Apple purchase should not have been successful.")
	}

	if !r.PurchaseProviderReachable {
		t.Fatal("Apple purchase provider should have been reachable.")
	}

	assertEquals(t, "No in-app purchase receipts were found", r.Message.Error())
}

func TestUnmatchingProductID(t *testing.T) {
	ac := setupAppleClient(&AppleResponse{
		Status: APPLE_VALID,
		Receipt: &AppleReceipt{
			InApp: []*AppleInAppReceipt{
				&AppleInAppReceipt{
					ProductID: "bad-product-id",
				},
			},
		},
	})

	r, _ := ac.Verify(&ApplePurchase{
		ProductId: TEST_APPLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Apple purchase should not have been successful.")
	}

	if !r.PurchaseProviderReachable {
		t.Fatal("Apple purchase provider should have been reachable.")
	}

	assertEquals(t, "Product ID does not match receipt", r.Message.Error())
}

func TestCancelledPurchase(t *testing.T) {
	ac := setupAppleClient(&AppleResponse{
		Status: APPLE_VALID,
		Receipt: &AppleReceipt{
			InApp: []*AppleInAppReceipt{
				&AppleInAppReceipt{
					ProductID:        TEST_APPLE_PRODUCT_ID,
					CancellationDate: "123",
				},
			},
		},
	})

	r, _ := ac.Verify(&ApplePurchase{
		ProductId: TEST_APPLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Apple purchase should not have been successful.")
	}

	if !r.PurchaseProviderReachable {
		t.Fatal("Apple purchase provider should have been reachable.")
	}

	assertEquals(t, "Purchase has been cancelled: 123", r.Message.Error())
}

func TestExpiredPurchase(t *testing.T) {
	ac := setupAppleClient(&AppleResponse{
		Status: APPLE_VALID,
		Receipt: &AppleReceipt{
			InApp: []*AppleInAppReceipt{
				&AppleInAppReceipt{
					ProductID:   TEST_APPLE_PRODUCT_ID,
					ExpiresDate: "123",
				},
			},
		},
	})

	r, _ := ac.Verify(&ApplePurchase{
		ProductId: TEST_APPLE_PRODUCT_ID,
	})

	if r.Success || r.Message == nil {
		t.Fatal("Apple purchase should not have been successful.")
	}

	if !r.PurchaseProviderReachable {
		t.Fatal("Apple purchase provider should have been reachable.")
	}

	assertEquals(t, "Purchase is a subscription that expired: 123", r.Message.Error())
}

func TestValidPurchase(t *testing.T) {
	ac := setupAppleClient(&AppleResponse{
		Status: APPLE_VALID,
		Receipt: &AppleReceipt{
			InApp: []*AppleInAppReceipt{
				&AppleInAppReceipt{
					ProductID: TEST_APPLE_PRODUCT_ID,
				},
			},
		},
	})

	r, _ := ac.Verify(&ApplePurchase{
		ProductId: TEST_APPLE_PRODUCT_ID,
	})

	if !r.PurchaseProviderReachable {
		t.Fatal("Apple purchase provider should have been reachable.")
	}

	if !r.Success || r.Message != nil {
		t.Fatal("Apple purchase should have been successful.")
	}
}
