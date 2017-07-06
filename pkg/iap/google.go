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

	"database/sql"

	"go.uber.org/zap"
	"golang.org/x/oauth2/google"
)

const (
	GOOGLE_IAP_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
)

type GooglePurchase struct {
	// The identifier of the product or subscription being purchased.
	ProductId string
	// Whether the purchase is for a single product or a subscription.
	ProductType string
	// The token returned in the purchase operation response, acts as a transaction identifier.
	PurchaseToken string
}

type GoogleClient struct {
	client             *http.Client
	logger             *zap.Logger
	db                 *sql.DB
	packageName        string
	serviceKeyFilePath string
	enabled            bool
}

func NewGoogleClient(logger *zap.Logger, db *sql.DB, packageName, serviceKeyFilePath string) *GoogleClient {
	gc := &GoogleClient{
		logger:             logger,
		db:                 db,
		packageName:        packageName,
		serviceKeyFilePath: serviceKeyFilePath,
	}
	gc.init()
	return gc
}

func (gc *GoogleClient) init() {
	if gc.packageName == "" {
		gc.logger.Warn("Google Purchase configuration is inactive.", zap.String("reason", "Missing package name"))
		return
	}
	if gc.serviceKeyFilePath == "" {
		gc.logger.Warn("Google Purchase configuration is inactive.", zap.String("reason", "Missing service account key"))
		return
	}

	jsonContent, err := ioutil.ReadFile(gc.serviceKeyFilePath)
	if err != nil {
		gc.logger.Error("Failed to read Google service account key", zap.Error(err))
		return
	}

	config, err := google.JWTConfigFromJSON(jsonContent, GOOGLE_IAP_SCOPE)
	if err != nil {
		gc.logger.Error("Failed to parse Google service account key", zap.Error(err))
		return
	}

	gc.client = config.Client(context.Background())
	gc.logger.Info("Successfully initiated Google In-App Purchase provider")
	gc.enabled = true
}

func (gc *GoogleClient) Verify(ps []*GooglePurchase) []*PurchaseVerify {
	pr := make([]*PurchaseVerify, 0)
	for _, p := range ps {
		r := gc.singleVerify(p)
		pr = append(pr, r)
	}

	return pr
}

func (gc *GoogleClient) singleVerify(p *GooglePurchase) *PurchaseVerify {
	//TODO send data
}
