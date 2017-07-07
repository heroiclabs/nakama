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

	"go.uber.org/zap"
	"golang.org/x/oauth2/google"
)

const (
	GOOGLE_IAP_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
)

type GoogleClient struct {
	client             *http.Client
	logger             *zap.Logger
	packageName        string
	serviceKeyFilePath string
}

func NewGoogleClient(packageName string, serviceKeyFilePath string) (*GoogleClient, error) {
	gc := &GoogleClient{
		packageName:        packageName,
		serviceKeyFilePath: serviceKeyFilePath,
	}
	err := gc.init()
	if err != nil {
		return nil, err
	}
	return gc, nil
}

func (gc *GoogleClient) init() error {
	if gc.packageName == "" {
		return errors.New("Google in-app purchase configuration is inactive. Reason: Missing package name")
	}
	if gc.serviceKeyFilePath == "" {
		return errors.New("Google in-app purchase configuration is inactive. Reason: Missing service account key")
	}

	jsonContent, err := ioutil.ReadFile(gc.serviceKeyFilePath)
	if err != nil {
		return errors.New("Google in-app purchase configuration is inactive. Reason: Failed to read Google service account key")
	}

	config, err := google.JWTConfigFromJSON(jsonContent, GOOGLE_IAP_SCOPE)
	if err != nil {
		return errors.New("Google in-app purchase configuration is inactive. Reason: Failed to parse Google service account key")
	}

	gc.client = config.Client(context.Background())
	return nil
}

func (gc *GoogleClient) Verify(p *GooglePurchase) *PurchaseVerifyResponse {
	//TODO send data
}
