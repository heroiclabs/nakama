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

type RuntimeAuthenticateProviderFunction func(ctx context.Context, traceID, payload string) (*runtime.AuthenticateProviderResult, error, codes.Code)

type RuntimeAuthenticateProviderRegistry struct {
	providers MapOf[string, RuntimeAuthenticateProviderFunction]
}

func (r *RuntimeAuthenticateProviderRegistry) Register(name string, provider RuntimeAuthenticateProviderFunction) error {
	if _, dup := r.providers.LoadOrStore(strings.ToLower(name), provider); dup {
		return fmt.Errorf("authenticate provider already registered: %s", name)
	}
	return nil
}

func (r *RuntimeAuthenticateProviderRegistry) Get(name string) RuntimeAuthenticateProviderFunction {
	provider, found := r.providers.Load(strings.ToLower(name))
	if !found {
		return nil
	}
	return provider
}
