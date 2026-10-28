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
	"sort"
	"strings"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
)

type RuntimeIAPProviderPurchaseFunction func(ctx context.Context, traceID string, payload, overrides map[string]any) ([]*runtime.IAPProviderPurchase, error, codes.Code)

type RuntimeIAPProviderSubscriptionFunction func(ctx context.Context, traceID string, payload, overrides map[string]any) ([]*runtime.IAPProviderSubscription, error, codes.Code)

type RuntimeIAPProviderNotificationFunction func(ctx context.Context, body []byte, headers, query map[string][]string) ([]*runtime.IAPProviderNotification, error)

type RuntimeIAPProviderFunctions struct {
	name                 string
	storeCode            int
	validate             RuntimeIAPProviderPurchaseFunction
	validateSubscription RuntimeIAPProviderSubscriptionFunction
	notificationHandler  RuntimeIAPProviderNotificationFunction
}

type RuntimeIAPProviderRegistry struct {
	providersByName MapOf[string, *RuntimeIAPProviderFunctions]
	providersByCode MapOf[int, *RuntimeIAPProviderFunctions]
}

func (r *RuntimeIAPProviderRegistry) Register(name string, code int, validate RuntimeIAPProviderPurchaseFunction, validateSubscription RuntimeIAPProviderSubscriptionFunction, notificationHandler RuntimeIAPProviderNotificationFunction) error {
	if !authenticationProviderNameRegex.MatchString(name) {
		return errors.New("expects provider name to be valid, must be 1-128 bytes and contain only [a-zA-Z0-9_-]")
	}
	switch name {
	case "apple", "google", "huawei", "facebookinstant", "samsung":
		return fmt.Errorf("IAP provider name is reserved: %s", name)
	}
	if code < math.MinInt16 || code > math.MaxInt16 {
		return fmt.Errorf("IAP provider code must fit in 16 bits: %s has %d", name, code)
	}
	if _, builtIn := api.StoreProvider_name[int32(code)]; builtIn {
		return fmt.Errorf("IAP provider code %d is used by a built-in store: %s", code, name)
	}
	provider := &RuntimeIAPProviderFunctions{name: name, storeCode: code, validate: validate, validateSubscription: validateSubscription, notificationHandler: notificationHandler}
	if _, dup := r.providersByName.LoadOrStore(name, provider); dup {
		return fmt.Errorf("IAP provider already registered: %s", name)
	}
	if owner, dup := r.providersByCode.LoadOrStore(code, provider); dup {
		r.providersByName.Delete(name)
		return fmt.Errorf("IAP provider code %d is already used by %s", code, owner.name)
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
