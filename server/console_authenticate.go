// Copyright 2019 The Nakama Authors
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
	"github.com/dgrijalva/jwt-go"
	"github.com/heroiclabs/nakama/v2/console"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"time"
)

func (s *ConsoleServer) Authenticate(ctx context.Context, in *console.AuthenticateRequest) (*console.ConsoleSession, error) {
	username := s.config.GetConsole().Username
	password := s.config.GetConsole().Password
	if in.Username == username && in.Password == password {
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"exp": time.Now().UTC().Add(time.Duration(s.config.GetConsole().TokenExpirySec) * time.Second).Unix(),
		})
		signedToken, _ := token.SignedString([]byte(s.config.GetConsole().SigningKey))
		return &console.ConsoleSession{Token: signedToken}, nil
	}
	return nil, status.Error(codes.Unauthenticated, "Console authentication invalid.")
}
