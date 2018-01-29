// Copyright 2018 The Nakama Authors
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
	"golang.org/x/net/context"
	"github.com/heroiclabs/nakama/api"
	"github.com/golang/protobuf/ptypes/empty"
)

func (s *ApiServer) UnlinkCustomFunc(ctx context.Context, in *api.AccountCustom) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkDeviceFunc(ctx context.Context, in *api.AccountDevice) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkEmailFunc(ctx context.Context, in *api.AccountEmail) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkFacebookFunc(ctx context.Context, in *api.AccountFacebook) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkGameCenterFunc(ctx context.Context, in *api.AccountGameCenter) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkGoogleFunc(ctx context.Context, in *api.AccountGoogle) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkSteamFunc(ctx context.Context, in *api.AccountSteam) (*empty.Empty, error) {
	return nil, nil
}
