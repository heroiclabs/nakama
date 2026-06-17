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

import "github.com/gorilla/mux"

// ConsoleRouterAuth configures authentication middleware for registered console router paths.
type ConsoleRouterAuth int

const (
	// ConsoleRouterAuthNone registers console routes without additional authentication middleware.
	ConsoleRouterAuthNone ConsoleRouterAuth = iota
	// ConsoleRouterAuthAdminBasic registers console routes with console admin basic authentication.
	ConsoleRouterAuthAdminBasic
)

type consoleRouterRegistration struct {
	auth     ConsoleRouterAuth
	register func(*mux.Router)
}

var consoleRouterRegistrations []consoleRouterRegistration

// RegisterConsoleRouter registers additional handlers on the console HTTP router.
// It should be called before the console server starts.
func RegisterConsoleRouter(auth ConsoleRouterAuth, register func(*mux.Router)) {
	if register == nil {
		panic("server.RegisterConsoleRouter: register must not be nil")
	}
	if !auth.valid() {
		panic("server.RegisterConsoleRouter: invalid auth")
	}

	consoleRouterRegistrations = append(consoleRouterRegistrations, consoleRouterRegistration{
		auth:     auth,
		register: register,
	})
}

func (a ConsoleRouterAuth) valid() bool {
	switch a {
	case ConsoleRouterAuthNone, ConsoleRouterAuthAdminBasic:
		return true
	default:
		return false
	}
}

func registerConsoleRouters(router *mux.Router, consoleConfig *ConsoleConfig) {
	for _, registration := range consoleRouterRegistrations {
		subrouter := router.NewRoute().Subrouter()
		if registration.auth == ConsoleRouterAuthAdminBasic {
			subrouter.Use(adminBasicAuth(consoleConfig))
		}
		registration.register(subrouter)
	}
}
