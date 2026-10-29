// Copyright 2026 The Nakama Authors
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

package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
)

var iapProviderNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

type RuntimeIAPProviderPurchaseFunction func(ctx context.Context, traceID string, payload, overrides map[string]any) ([]*runtime.IAPProviderPurchase, error, codes.Code)

type RuntimeIAPProviderSubscriptionFunction func(ctx context.Context, traceID string, payload, overrides map[string]any) ([]*runtime.IAPProviderSubscription, error, codes.Code)

type RuntimeIAPProviderNotificationFunction func(ctx context.Context, body []byte, headers, query map[string][]string) ([]*runtime.IAPProviderNotification, error)

type RuntimeIAPProviderFunctions struct {
	name                 string
	notificationId       string
	storeCode            int
	validate             RuntimeIAPProviderPurchaseFunction
	validateSubscription RuntimeIAPProviderSubscriptionFunction
	notificationHandler  RuntimeIAPProviderNotificationFunction
}

type RuntimeIAPProviderRegistry struct {
	providersByName           MapOf[string, *RuntimeIAPProviderFunctions]
	providersByCode           MapOf[int, *RuntimeIAPProviderFunctions]
	providersByNotificationId MapOf[string, *RuntimeIAPProviderFunctions]
}

func (r *RuntimeIAPProviderRegistry) Register(name, notificationId string, code int, validate RuntimeIAPProviderPurchaseFunction, validateSubscription RuntimeIAPProviderSubscriptionFunction, notificationHandler RuntimeIAPProviderNotificationFunction) error {
	if !iapProviderNameRegex.MatchString(name) {
		return errors.New("expects provider name to be valid, must be 1-128 bytes and contain only [a-zA-Z0-9_-]")
	}
	switch name {
	case "apple", "google", "huawei", "facebookinstant", "samsung":
		return fmt.Errorf("IAP provider name is reserved: %s", name)
	}
	if notificationId == "" {
		notificationId = name
	}
	if !iapProviderNameRegex.MatchString(notificationId) {
		return fmt.Errorf("expects IAP provider notification id to be valid, must be 1-128 bytes and contain only [a-zA-Z0-9_-]: %s", name)
	}
	switch notificationId {
	case "apple", "google", "huawei", "facebookinstant", "samsung":
		return fmt.Errorf("IAP provider notification id is reserved: %s", name)
	}
	if code < math.MinInt16 || code > math.MaxInt16 {
		return fmt.Errorf("IAP provider code must fit in 16 bits: %s has %d", name, code)
	}
	switch api.StoreProvider(code) {
	case api.StoreProvider_APPLE_APP_STORE, api.StoreProvider_GOOGLE_PLAY_STORE, api.StoreProvider_HUAWEI_APP_GALLERY, api.StoreProvider_FACEBOOK_INSTANT_STORE, api.StoreProvider_SAMSUNG_GALAXY_STORE:
		return fmt.Errorf("IAP provider code %d is used by a built-in store: %s", code, name)
	}
	provider := &RuntimeIAPProviderFunctions{name: name, notificationId: notificationId, storeCode: code, validate: validate, validateSubscription: validateSubscription, notificationHandler: notificationHandler}
	if _, found := r.providersByName.LoadOrStore(name, provider); found {
		return fmt.Errorf("IAP provider already registered: %s", name)
	}
	if provider, found := r.providersByCode.LoadOrStore(code, provider); found {
		r.providersByName.Delete(name)
		return fmt.Errorf("IAP provider code %d is already used by %s", code, provider.name)
	}
	if provider, found := r.providersByNotificationId.LoadOrStore(notificationId, provider); found {
		r.providersByName.Delete(name)
		r.providersByCode.Delete(code)
		return fmt.Errorf("IAP provider notification id of %s is already used by %s", name, provider.name)
	}
	return nil
}

func (r *RuntimeIAPProviderRegistry) Get(name string) *RuntimeIAPProviderFunctions {
	provider, found := r.providersByName.Load(strings.ToLower(name))
	if !found {
		return nil
	}
	return provider
}

func (r *RuntimeIAPProviderRegistry) GetName(code int) string {
	if r == nil {
		return ""
	}
	provider, found := r.providersByCode.Load(code)
	if !found {
		return ""
	}
	return provider.name
}

func (r *RuntimeIAPProviderRegistry) Names() []string {
	names := make([]string, 0)
	r.providersByName.Range(func(name string, _ *RuntimeIAPProviderFunctions) bool {
		names = append(names, name)
		return true
	})
	sort.Strings(names)
	return names
}
