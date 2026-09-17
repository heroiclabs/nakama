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
	"fmt"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
)

type RuntimeAuthenticateProviderFunction func(context.Context, string, map[string]any) (runtime.AuthenticateProviderResult, error, codes.Code)
type RuntimeAuthenticateProviderGetFriendsFunction func(context.Context, string, map[string]any, runtime.AuthenticateProviderResult) ([]string, bool, error, codes.Code)

type RuntimeAuthenticateProviderFunctions struct {
	auth       RuntimeAuthenticateProviderFunction
	getFriends RuntimeAuthenticateProviderGetFriendsFunction
}

type RuntimeAuthenticateProviderRegistry struct {
	providers MapOf[string, *RuntimeAuthenticateProviderFunctions]
}

func (r *RuntimeAuthenticateProviderRegistry) Register(name string, auth RuntimeAuthenticateProviderFunction, getFriends RuntimeAuthenticateProviderGetFriendsFunction) error {
	if _, dup := r.providers.LoadOrStore(strings.ToLower(name), &RuntimeAuthenticateProviderFunctions{auth: auth, getFriends: getFriends}); dup {
		return fmt.Errorf("authenticate provider already registered: %s", name)
	}
	return nil
}

func (r *RuntimeAuthenticateProviderRegistry) Get(name string) *RuntimeAuthenticateProviderFunctions {
	provider, found := r.providers.Load(strings.ToLower(name))
	if !found {
		return nil
	}
	return provider
}
