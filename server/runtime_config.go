// Copyright 2024 The Nakama Authors
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

import "github.com/heroiclabs/nakama-common/runtime"

type RuntimeConfigClone struct {
	Name          string
	ShutdownGrace int
	Logger        runtime.LoggerConfig
	Session       runtime.SessionConfig
	Socket        runtime.SocketConfig
	Social        runtime.SocialConfig
	Runtime       runtime.RuntimeConfig
	Iap           runtime.IAPConfig
	GoogleAuth    runtime.GoogleAuthConfig
	Satori        runtime.SatoriConfig
}

func (c *RuntimeConfigClone) GetName() string {
	return c.Name
}

func (c *RuntimeConfigClone) GetShutdownGraceSec() int {
	return c.ShutdownGrace
}

func (c *RuntimeConfigClone) GetLogger() runtime.LoggerConfig {
	return c.Logger
}

func (c *RuntimeConfigClone) GetSession() runtime.SessionConfig {
	return c.Session
}

func (c *RuntimeConfigClone) GetSocket() runtime.SocketConfig {
	return c.Socket
}

func (c *RuntimeConfigClone) GetSocial() runtime.SocialConfig {
	return c.Social
}

func (c *RuntimeConfigClone) GetRuntime() runtime.RuntimeConfig {
	return c.Runtime
}

func (c *RuntimeConfigClone) GetIAP() runtime.IAPConfig {
	return c.Iap
}

func (c *RuntimeConfigClone) GetGoogleAuth() runtime.GoogleAuthConfig {
	return c.GoogleAuth
}

func (c *RuntimeConfigClone) GetSatori() runtime.SatoriConfig {
	return c.Satori
}
