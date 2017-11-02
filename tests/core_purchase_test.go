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

package tests

import (
	"bytes"
	"encoding/json"
	"io/ioutil"
	"nakama/pkg/iap"
	"nakama/server"
	"net/http"

	"testing"

	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

var (
	purchaseService   *server.PurchaseService
	purchaseUserID    = uuid.NewV4().String()
	purchaseBadUserID = uuid.NewV4().String()
	purchaseProductID = "com.heroiclabs.iap"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func setupAppleClient() *iap.AppleClient {
	a, _ := json.Marshal(&iap.AppleResponse{
		Status: iap.APPLE_VALID,
		Receipt: &iap.AppleReceipt{
			InApp: []*iap.AppleInAppReceipt{
				&iap.AppleInAppReceipt{
					ProductID: purchaseProductID,
				},
			},
		},
	})

	httpClient := &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		resp := &http.Response{
			StatusCode: 200,
			Body:       ioutil.NopCloser(bytes.NewReader(a)),
		}
		return resp, nil
	})}

	ac, _ := iap.NewAppleClientWithHTTP("password", true, httpClient)
	return ac
}

func setupGoogleClient() *iap.GoogleClient {
	g, _ := json.Marshal(&iap.GoogleProductReceipt{
		PurchaseState:    0,
		ConsumptionState: 0,
	})

	httpClient := &http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		resp := &http.Response{
			StatusCode: 200,
			Body:       ioutil.NopCloser(bytes.NewReader(g)),
		}
		return resp, nil
	})}

	gc, _ := iap.NewGoogleClientWithHTTP("com.heroiclabs.iap.google.packagename", httpClient)
	return gc
}

func setupPurchaseService() (*server.PurchaseService, error) {
	db, err := setupDB()
	if err != nil {
		return nil, err
	}

	ac := setupAppleClient()
	gc := setupGoogleClient()

	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))
	ps := server.NewPurchaseService(logger, logger, db, server.NewPurchaseConfig())
	ps.AppleClient = ac
	ps.GoogleClient = gc
	return ps, nil
}

func TestPurchases(t *testing.T) {
	ps, err := setupPurchaseService()
	if err != nil {
		t.Fatal(err)
	}
	purchaseService = ps

	if v := t.Run("apple-valid-unseen-purchase", testAppleUnseenPurchase); !v {
		t.Fatal("'apple-valid-unseen-purchase' test failed.")
	}
	if v := t.Run("apple-restore-purchase", testAppleRestorePurchase); !v {
		t.Error("'apple-restore-purchase' test failed.")
	}
	if v := t.Run("apple-valid-purchase-wrong-user", testApplePurchaseWrongUser); !v {
		t.Error("'apple-valid-purchase-wrong-user' test failed.")
	}

	if v := t.Run("google-valid-unseen-purchase", testGoogleUnseenPurchase); !v {
		t.Fatal("'google-valid-unseen-purchase' test failed.")
	}
	if v := t.Run("google-restore-purchase", testGoogleRestorePurchase); !v {
		t.Error("'google-restore-purchase' test failed.")
	}
	if v := t.Run("google-valid-purchase-wrong-user", testGooglePurchaseWrongUser); !v {
		t.Error("'google-valid-purchase-wrong-user' test failed.")
	}

}

func testAppleUnseenPurchase(t *testing.T) {
	r := purchaseService.ValidateApplePurchase(purchaseUserID, &iap.ApplePurchase{
		ProductId: purchaseProductID,
	})

	if r.Message != nil {
		t.Error(r.Message)
		t.FailNow()
	}

	if !r.Success {
		t.Error("Purchase was not successful")
		t.FailNow()
	}

	if !r.PurchaseProviderReachable {
		t.Error("Purchase provider was not available")
		t.FailNow()
	}

	if r.SeenBefore {
		t.Error("Purchase was seen before")
		t.FailNow()
	}

	if r.Data == "" {
		t.Error("Purchase did not have provider data")
		t.FailNow()
	}
}

func testAppleRestorePurchase(t *testing.T) {
	r := purchaseService.ValidateApplePurchase(purchaseUserID, &iap.ApplePurchase{
		ProductId: purchaseProductID,
	})

	if !r.SeenBefore {
		t.Error("Purchase was not seen before")
		t.FailNow()
	}

	if r.Message != nil {
		t.Error(r.Message)
		t.FailNow()
	}

	if !r.Success {
		t.Error("Purchase was not successful")
		t.FailNow()
	}

	if !r.PurchaseProviderReachable {
		t.Error("Purchase provider was not available")
		t.FailNow()
	}

	if r.Data == "" {
		t.Error("Purchase did not have provider data")
		t.FailNow()
	}
}

func testApplePurchaseWrongUser(t *testing.T) {
	r := purchaseService.ValidateApplePurchase(purchaseBadUserID, &iap.ApplePurchase{
		ProductId: purchaseProductID,
	})

	if r.Success {
		t.Error("Purchase was successful")
		t.FailNow()
	}

	if !r.SeenBefore {
		t.Error("Purchase was not seen before")
		t.FailNow()
	}

	if r.Message == nil {
		t.Error("Error was empty")
		t.FailNow()
	}

	if !r.PurchaseProviderReachable {
		t.Error("Purchase provider was not available")
		t.FailNow()
	}

	if r.Data == "" {
		t.Error("Purchase did not have provider data")
		t.FailNow()
	}
}

func testGoogleUnseenPurchase(t *testing.T) {
	r := purchaseService.ValidateGooglePurchaseProduct(purchaseUserID, &iap.GooglePurchase{
		ProductId:     purchaseProductID,
		ProductType:   "product",
		PurchaseToken: "google-purchase-token",
	})

	if r.Message != nil {
		t.Error(r.Message)
		t.FailNow()
	}

	if !r.Success {
		t.Error("Purchase was not successful")
		t.FailNow()
	}

	if !r.PurchaseProviderReachable {
		t.Error("Purchase provider was not available")
		t.FailNow()
	}

	if r.SeenBefore {
		t.Error("Purchase was seen before")
		t.FailNow()
	}

	if r.Data == "" {
		t.Error("Purchase did not have provider data")
		t.FailNow()
	}
}

func testGoogleRestorePurchase(t *testing.T) {
	r := purchaseService.ValidateGooglePurchaseProduct(purchaseUserID, &iap.GooglePurchase{
		ProductId:     purchaseProductID,
		ProductType:   "product",
		PurchaseToken: "google-purchase-token",
	})

	if !r.SeenBefore {
		t.Error("Purchase was not seen before")
		t.FailNow()
	}

	if r.Message != nil {
		t.Error(r.Message)
		t.FailNow()
	}

	if !r.Success {
		t.Error("Purchase was not successful")
		t.FailNow()
	}

	if !r.PurchaseProviderReachable {
		t.Error("Purchase provider was not available")
		t.FailNow()
	}

	if r.Data == "" {
		t.Error("Purchase did not have provider data")
		t.FailNow()
	}
}

func testGooglePurchaseWrongUser(t *testing.T) {
	r := purchaseService.ValidateGooglePurchaseProduct(purchaseBadUserID, &iap.GooglePurchase{
		ProductId:     purchaseProductID,
		ProductType:   "product",
		PurchaseToken: "google-purchase-token",
	})

	if r.Success {
		t.Error("Purchase was successful")
		t.FailNow()
	}

	if !r.SeenBefore {
		t.Error("Purchase was not seen before")
		t.FailNow()
	}

	if r.Message == nil {
		t.Error("Error was empty")
		t.FailNow()
	}

	if !r.PurchaseProviderReachable {
		t.Error("Purchase provider was not available")
		t.FailNow()
	}

	if r.Data == "" {
		t.Error("Purchase did not have provider data")
		t.FailNow()
	}
}
