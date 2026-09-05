// Copyright 2026 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"context"
	"testing"

	"github.com/heroiclabs/nakama/v3/console"
	"github.com/heroiclabs/nakama/v3/console/acl"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestValidateConsoleUserACLGrant(t *testing.T) {
	limited := acl.NewPermission(console.AclResources_ACCOUNT, acl.PermissionRead).
		Compose(acl.NewPermission(console.AclResources_ACCOUNT, acl.PermissionWrite))

	for _, tc := range []struct {
		name      string
		requested acl.Permission
		wantCode  codes.Code
	}{
		{name: "same permissions", requested: limited, wantCode: codes.OK},
		{name: "fewer permissions", requested: acl.NewPermission(console.AclResources_ACCOUNT, acl.PermissionRead), wantCode: codes.OK},
		{name: "no permissions", requested: acl.None(), wantCode: codes.InvalidArgument},
		{name: "admin permissions", requested: acl.Admin(), wantCode: codes.InvalidArgument},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateConsoleUserACLGrant(limited, tc.requested)
			if got := status.Code(err); got != tc.wantCode {
				t.Fatalf("status code = %s, want %s (err=%v)", got, tc.wantCode, err)
			}
		})
	}
}

func TestAddUserRejectsInvalidACLBeforeSideEffects(t *testing.T) {
	logger := zap.NewNop()
	config := NewConfig(logger)
	config.GetConsole().Username = "configuredadmin"
	server := &ConsoleServer{logger: logger, config: config}
	limited := acl.NewPermission(console.AclResources_ACCOUNT, acl.PermissionWrite)
	ctx := context.WithValue(context.Background(), ctxConsoleUsernameKey{}, "limitedoperator")
	ctx = context.WithValue(ctx, ctxConsoleEmailKey{}, "limitedoperator@example.invalid")
	ctx = context.WithValue(ctx, ctxConsoleUserAclKey{}, limited)

	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("AddUser reached a side effect before rejecting the ACL grant: %v", recovered)
		}
	}()
	for _, tc := range []struct {
		name string
		acl  map[string]*console.Permissions
	}{
		{name: "more privileged ACL", acl: acl.Admin().ACL()},
		{name: "empty ACL", acl: nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := server.AddUser(ctx, &console.AddUserRequest{
				Username: "invaliduser",
				Email:    "invaliduser@example.invalid",
				Acl:      tc.acl,
			})
			if got := status.Code(err); got != codes.InvalidArgument {
				t.Fatalf("status code = %s, want %s (err=%v)", got, codes.InvalidArgument, err)
			}
		})
	}
}
