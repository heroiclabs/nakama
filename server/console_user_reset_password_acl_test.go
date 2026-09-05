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
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/heroiclabs/nakama/v3/console/acl"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestValidateConsoleUserTargetACL(t *testing.T) {
	limited := acl.NewPermission(console.AclResources_USER, acl.PermissionRead).
		Compose(acl.NewPermission(console.AclResources_USER, acl.PermissionWrite))

	for _, tc := range []struct {
		name     string
		target   acl.Permission
		wantCode codes.Code
	}{
		{name: "equal permissions", target: limited, wantCode: codes.OK},
		{name: "lower permissions", target: acl.NewPermission(console.AclResources_USER, acl.PermissionRead), wantCode: codes.OK},
		{name: "admin permissions", target: acl.Admin(), wantCode: codes.PermissionDenied},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateConsoleUserTargetACL(limited, tc.target)
			if got := status.Code(err); got != tc.wantCode {
				t.Fatalf("status code = %s, want %s (err=%v)", got, tc.wantCode, err)
			}
		})
	}
}

func TestResetUserPasswordAuthorizesTargetACLBeforeUpdate(t *testing.T) {
	callerRole := acl.NewPermission(console.AclResources_USER, acl.PermissionRead).
		Compose(acl.NewPermission(console.AclResources_USER, acl.PermissionWrite))

	for _, tc := range []struct {
		name        string
		targetRole  acl.Permission
		targetACL   string
		selectFails int
		wantSelects int
		wantCode    codes.Code
		wantUpdates int
	}{
		{name: "equal permissions issue reset code", targetRole: callerRole, wantCode: codes.OK, wantUpdates: 1},
		{name: "lower permissions issue reset code", targetRole: acl.NewPermission(console.AclResources_USER, acl.PermissionRead), wantCode: codes.OK, wantUpdates: 1},
		{name: "serialization failure is retried", targetRole: callerRole, selectFails: 1, wantSelects: 2, wantCode: codes.OK, wantUpdates: 1},
		{name: "admin permissions are rejected", targetRole: acl.Admin(), wantCode: codes.PermissionDenied, wantUpdates: 0},
		{name: "malformed target ACL fails closed", targetACL: "{", wantCode: codes.Internal, wantUpdates: 0},
		{name: "missing target preserves not found", targetACL: "missing", wantCode: codes.NotFound, wantUpdates: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			targetACLJSON := tc.targetACL
			if targetACLJSON == "" {
				var err error
				targetACLJSON, err = tc.targetRole.ToJson()
				if err != nil {
					t.Fatalf("serialize target ACL: %v", err)
				}
			}

			state := &resetPasswordACLTestState{targetACLJSON: targetACLJSON, selectFailures: tc.selectFails}
			db := sql.OpenDB(&resetPasswordACLTestConnector{state: state})
			t.Cleanup(func() { _ = db.Close() })
			logger := zap.NewNop()
			config := NewConfig(logger)
			config.GetConsole().SigningKey = "synthetic-console-signing-key"
			server := &ConsoleServer{logger: logger, db: db, config: config}
			ctx := context.WithValue(context.Background(), ctxConsoleUserAclKey{}, callerRole)

			response, err := server.ResetUserPassword(ctx, &console.Username{Username: "target"})
			if got := status.Code(err); got != tc.wantCode {
				t.Fatalf("status code = %s, want %s (err=%v)", got, tc.wantCode, err)
			}
			if state.updateCount != tc.wantUpdates {
				t.Fatalf("password update count = %d, want %d", state.updateCount, tc.wantUpdates)
			}
			wantSelects := tc.wantSelects
			if wantSelects == 0 {
				wantSelects = 1
			}
			if state.selectCount != wantSelects {
				t.Fatalf("target ACL select count = %d, want %d", state.selectCount, wantSelects)
			}
			if tc.wantCode == codes.OK && (response == nil || response.Code == "") {
				t.Fatal("successful reset did not issue a password-change code")
			}
		})
	}
}

type resetPasswordACLTestState struct {
	targetACLJSON  string
	selectFailures int
	selectCount    int
	updateCount    int
}

type resetPasswordACLTestConnector struct {
	state *resetPasswordACLTestState
}

func (c *resetPasswordACLTestConnector) Connect(context.Context) (driver.Conn, error) {
	return &resetPasswordACLTestConn{state: c.state}, nil
}

func (*resetPasswordACLTestConnector) Driver() driver.Driver { return resetPasswordACLTestDriver{} }

type resetPasswordACLTestDriver struct{}

func (resetPasswordACLTestDriver) Open(string) (driver.Conn, error) {
	return nil, fmt.Errorf("use connector")
}

type resetPasswordACLTestConn struct {
	state *resetPasswordACLTestState
}

func (*resetPasswordACLTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare is not supported")
}

func (*resetPasswordACLTestConn) Close() error { return nil }

func (c *resetPasswordACLTestConn) Begin() (driver.Tx, error) {
	return resetPasswordACLTestTx{}, nil
}

func (*resetPasswordACLTestConn) CheckNamedValue(*driver.NamedValue) error { return nil }

func (c *resetPasswordACLTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	normalized := strings.Join(strings.Fields(query), " ")
	switch {
	case normalized == "SELECT acl FROM console_user WHERE username = $1 FOR UPDATE":
		c.state.selectCount++
		if len(args) != 1 || args[0].Value != "target" {
			return nil, fmt.Errorf("unexpected target ACL arguments: %v", args)
		}
		if c.state.selectFailures > 0 {
			c.state.selectFailures--
			return nil, &pgconn.PgError{Code: pgerrcode.SerializationFailure}
		}
		if c.state.targetACLJSON == "missing" {
			return nil, sql.ErrNoRows
		}
		return &resetPasswordACLTestRows{columns: []string{"acl"}, values: []driver.Value{[]byte(c.state.targetACLJSON)}}, nil
	case strings.Contains(normalized, "UPDATE console_user SET password = $1, update_time = NOW() WHERE username = $2 RETURNING id, username, email, update_time"):
		if len(args) != 2 || args[1].Value != "target" {
			return nil, fmt.Errorf("unexpected password update arguments: %v", args)
		}
		if password, ok := args[0].Value.([]byte); !ok || len(password) == 0 {
			return nil, fmt.Errorf("unexpected password hash: %T", args[0].Value)
		}
		c.state.updateCount++
		return &resetPasswordACLTestRows{
			columns: []string{"id", "username", "email", "update_time"},
			values:  []driver.Value{uuid.Must(uuid.NewV4()).String(), "target", "target@example.invalid", time.Now().UTC()},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s (args=%v)", normalized, args)
	}
}

type resetPasswordACLTestTx struct{}

func (resetPasswordACLTestTx) Commit() error   { return nil }
func (resetPasswordACLTestTx) Rollback() error { return nil }

type resetPasswordACLTestRows struct {
	columns []string
	values  []driver.Value
	done    bool
}

func (r *resetPasswordACLTestRows) Columns() []string { return r.columns }
func (*resetPasswordACLTestRows) Close() error        { return nil }

func (r *resetPasswordACLTestRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	copy(dest, r.values)
	r.done = true
	return nil
}
