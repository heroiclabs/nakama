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

type consoleRouterRegistration struct {
	register func(*mux.Router)
}

var consoleRouterRegistrations []consoleRouterRegistration

// RegisterConsoleRouter registers additional handlers on the console HTTP router.
// It should be called before the console server starts.
func RegisterConsoleRouter(register func(*mux.Router)) {
	if register == nil {
		panic("server.RegisterConsoleRouter: register must not be nil")
	}

	consoleRouterRegistrations = append(consoleRouterRegistrations, consoleRouterRegistration{
		register: register,
	})
}

func registerConsoleRouters(router *mux.Router, consoleConfig *ConsoleConfig) {
	for _, registration := range consoleRouterRegistrations {
		subrouter := router.NewRoute().Subrouter()
		subrouter.Use(adminBasicAuth(consoleConfig))
		registration.register(subrouter)
	}
}
