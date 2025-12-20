// Copyright 2025 The Nakama Authors
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
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var (
	ErrAuditLogInvalidCursor = status.Error(codes.InvalidArgument, "Invalid audit log cursor")
)

var auditLogMarshaller = protojson.MarshalOptions{
	Multiline:         false,
	AllowPartial:      false,
	UseProtoNames:     true,
	UseEnumNumbers:    false,
	EmitUnpopulated:   false,
	EmitDefaultValues: true,
}

// AuditLogEntry represents a console operation for auditing purposes
type AuditLogEntry struct {
	ID        string
	UserID    string
	Username  string
	Email     string
	Resource  string
	Action    string
	Metadata  string
	Message   string
	Timestamp time.Time
}

func (s *ConsoleServer) ListAuditLogs(ctx context.Context, in *console.AuditLogRequest) (*console.AuditLogList, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	if in.Limit == 0 {
		in.Limit = 20
	}

	if in.Limit < 1 || in.Limit > 100 {
		return nil, status.Error(codes.InvalidArgument, "expects a limit value between 1 and 100")
	}

	var resourceFilter *console.AclResources
	if in.Resource != nil {
		resourceFilter = new(console.AclResources)
		*resourceFilter = console.AclResources(in.Resource.Value)
	}

	var after time.Time
	if in.After != nil {
		after = in.After.AsTime()
	}
	var before time.Time
	if in.Before != nil {
		before = in.Before.AsTime()
	}

	auditLogs, err := auditLogEntryList(ctx, logger, s.db, in.Username, in.Action, resourceFilter, after, before, int(in.Limit), in.Cursor)
	if err != nil {
		logger.Error("Failed to list audit logs", zap.Error(err))
		return nil, status.Error(codes.Internal, "Failed to list audit logs")
	}

	return auditLogs, nil
}

func (s *ConsoleServer) ListAuditLogsUsers(ctx context.Context, in *emptypb.Empty) (*console.AuditLogUsersList, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	users, err := s.dbListConsoleUsers(ctx, nil)
	if err != nil {
		logger.Error("failed to list console users", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	}

	usernames := make([]string, len(users))
	for i, u := range users {
		usernames[i] = u.Username
	}

	return &console.AuditLogUsersList{
		Usernames: usernames,
	}, nil
}

func consoleAuditLogInterceptor(logger *zap.Logger, db *sql.DB) func(context.Context, any, *grpc.UnaryServerInfo, grpc.UnaryHandler) (any, error) {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		// Process the request with the actual handler
		resp, err := handler(ctx, req)
		// Only log successful operations
		if err == nil {
			// Extract user information from context
			var userId uuid.UUID
			var username, email string

			if uid, ok := ctx.Value(ctxConsoleUserIdKey{}).(uuid.UUID); ok {
				userId = uid
			}
			if uname, ok := ctx.Value(ctxConsoleUsernameKey{}).(string); ok {
				username = uname
			}
			if em, ok := ctx.Value(ctxConsoleEmailKey{}).(string); ok {
				email = em
			}

			ts := time.Now()

			var action console.AuditLogAction
			var resource console.AclResources
			metadata := []byte("{}")
			var mErr error
			var log string

			msg, ok := req.(proto.Message)
			if !ok {
				// Not a protobuf message - cannot marshal
				return nil, errors.New("request is not a proto.Message")
			}

			switch info.FullMethod {
			case "/nakama.console.Console/AddUser":
				action = console.AuditLogAction_CREATE
				resource = console.AclResources_USER
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "new console user added or updated"
			case "/nakama.console.Console/AuthenticatePasswordChange":
				pwdResetReq, ok := req.(*console.AuthenticatePasswordChangeRequest)
				if ok {
					tokens := strings.Split(pwdResetReq.GetCode(), ".")
					if len(tokens) == 3 {
						decodeString, err := base64.RawURLEncoding.DecodeString(tokens[1])
						if err != nil {
							break
						}
						var claims map[string]any
						if err = json.Unmarshal(decodeString, &claims); err != nil {
							break
						}
						username, ok = claims["usn"].(string)
						if !ok {
							break
						}
						action = console.AuditLogAction_UPDATE
						resource = console.AclResources_USER
						log = "user updated their password"
					}
				}
			case "/nakama.console.Console/BanAccount":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account banned"
			case "/nakama.console.Console/AddAclTemplate":
				action = console.AuditLogAction_CREATE
				resource = console.AclResources_ACL_TEMPLATE
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "access-control-list template added"
			case "/nakama.console.Console/AddAccountNote":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT_NOTES
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account note updated"
			case "/nakama.console.Console/DeleteAccountNote":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ACCOUNT_NOTES
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account note deleted"
			case "/nakama.console.Console/CallApiEndpoint":
				fallthrough
			case "/nakama.console.Console/CallRpcEndpoint":
				action = console.AuditLogAction_INVOKE
				resource = console.AclResources_API_EXPLORER
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "api explorer endpoint invoked"
			case "/nakama.console.Console/DeleteAccount":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account deleted"
			case "/nakama.console.Console/DeleteAccounts":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ALL_ACCOUNTS
				log = "all player accounts deleted"
			case "/nakama.console.Console/DeleteAclTemplate":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ACL_TEMPLATE
				log = "access-control-list template deleted"
			case "/nakama.console.Console/DeleteAllData":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ALL_DATA
				log = "all server data deleted"
			case "/nakama.console.Console/DeleteChannelMessages":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_CHANNEL_MESSAGE
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "channel message deleted"
			case "/nakama.console.Console/DeleteFriend":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ACCOUNT_FRIENDS
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player friend removed"
			case "/nakama.console.Console/DeleteGroup":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_GROUP
				log = "group was deleted"
			case "/nakama.console.Console/DeleteGroupUser":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ACCOUNT_GROUPS
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "group member removed"
			case "/nakama.console.Console/DeleteLeaderboard":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_LEADERBOARD
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "leaderboard deleted"
			case "/nakama.console.Console/DeleteLeaderboardRecord":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_LEADERBOARD_RECORD
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "leaderboard record deleted"
			case "/nakama.console.Console/DeleteNotification":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_NOTIFICATION
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "persisted notification deleted"
			case "/nakama.console.Console/DeleteStorage":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ALL_STORAGE
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "all storage objects deleted"
			case "/nakama.console.Console/DeleteStorageObject":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_STORAGE_DATA
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "storage object deleted"
			case "/nakama.console.Console/DeleteUser":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_USER
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "console user deleted"
			case "/nakama.console.Console/DeleteWalletLedger":
				action = console.AuditLogAction_DELETE
				resource = console.AclResources_ACCOUNT_WALLET
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player wallet ledger entry deleted"
			case "/nakama.console.Console/DemoteGroupMember":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_GROUP
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "group member demoted"
			case "/nakama.console.Console/ExportAccount":
				action = console.AuditLogAction_EXPORT
				resource = console.AclResources_ACCOUNT_WALLET
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "account exported"
			case "/nakama.console.Console/ExportGroup":
				action = console.AuditLogAction_EXPORT
				resource = console.AclResources_GROUP
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "group exported"
			case "/nakama.console.Console/PromoteGroupMember":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_GROUP
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "group member promoted"
			case "/nakama.console.Console/RequireUserMfa":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_USER
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "user multi factor authentication set as required"
			case "/nakama.console.Console/ResetUserMfa":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_USER
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "user multi factor authentication was reset"
			case "/nakama.console.Console/ResetUserPassword":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_USER
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "user password was reset"
			case "/nakama.console.Console/UnbanAccount":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account was unbanned"
			case "/nakama.console.Console/UnlinkApple":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account unlinked from Apple"
			case "/nakama.console.Console/UnlinkCustom":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account custom link removed"
			case "/nakama.console.Console/UnlinkDevice":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account device link removed"
			case "/nakama.console.Console/UnlinkEmail":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account email link removed"
			case "/nakama.console.Console/UnlinkFacebook":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account unlinked from facebook"
			case "/nakama.console.Console/UnlinkFacebookInstantGame":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account unlinked from facebook instant game"
			case "/nakama.console.Console/UnlinkGameCenter":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account unlinked from apple game center"
			case "/nakama.console.Console/UnlinkGoogle":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account unlinked from google"
			case "/nakama.console.Console/UnlinkSteam":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account unlinked from steam"
			case "/nakama.console.Console/UpdateAccount":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "player account data updated"
			case "/nakama.console.Console/UpdateAclTemplate":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACL_TEMPLATE
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "access-control-list template updated"
			case "/nakama.console.Console/UpdateGroup":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_GROUP
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "group data updated"
			case "/nakama.console.Console/UpdateUser":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_USER
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "user access-control-list updated"
			case "/nakama.console.Console/UpdateSetting":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_SETTINGS
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "console settings updated"
			case "/nakama.console.Console/WriteStorageObject":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_STORAGE_DATA
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "storage object was updated"
			case "/nakama.console.Console/SendNotificationRequest":
				action = console.AuditLogAction_CREATE
				resource = console.AclResources_NOTIFICATION
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "notification was sent"
			case "/v2/console/storage/import":
				action = console.AuditLogAction_IMPORT
				resource = console.AclResources_STORAGE_DATA
				metadata, mErr = auditLogMarshaller.Marshal(msg) // Should we marshal the whole request?
				log = "storage objects imported"
			case "/nakama.console.Console/ImportAccount":
				action = console.AuditLogAction_UPDATE
				resource = console.AclResources_ACCOUNT_EXPORT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "account data imported into existing account"
			case "/nakama.console.Console/ImportAccountFull":
				action = console.AuditLogAction_CREATE
				resource = console.AclResources_ACCOUNT_EXPORT
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "account data imported into new account"
			case "/nakama.console.Console/SatoriSendDirectMessage":
				action = console.AuditLogAction_CREATE
				resource = console.AclResources_SATORI_MESSAGE
				metadata, mErr = auditLogMarshaller.Marshal(msg)
				log = "satori message sent"
			}

			if mErr != nil {
				logger.Error("Failed to marshal audit log metadata", zap.Error(mErr))
			}

			if action == console.AuditLogAction_UNKNOWN || mErr != nil {
				// No audit to insert, skip.
				return resp, err
			}

			auditEntry := &AuditLogEntry{
				UserID:    userId.String(),
				Username:  username,
				Email:     email,
				Resource:  resource.String(),
				Action:    action.String(),
				Timestamp: ts,
				Metadata:  string(metadata),
				Message:   log,
			}

			if err = auditLogAdd(logger, db, auditEntry); err != nil {
				logger.Error("Failed to add audit log entry", zap.Error(err))
			}
		}

		return resp, err
	}
}

func consoleHttpAuditLogInterceptor(ctx context.Context, logger *zap.Logger, db *sql.DB, method, path string, body []byte) {
	// Extract user information from context
	var userId uuid.UUID
	var username, email string

	if uid, ok := ctx.Value(ctxConsoleUserIdKey{}).(uuid.UUID); ok {
		userId = uid
	}
	if uname, ok := ctx.Value(ctxConsoleUsernameKey{}).(string); ok {
		username = uname
	}
	if em, ok := ctx.Value(ctxConsoleEmailKey{}).(string); ok {
		email = em
	}

	ts := time.Now()

	var action console.AuditLogAction
	var resource console.AclResources
	metadata := []byte("{}")
	var log string

	switch {
	case method == http.MethodGet && path == "/v2/console/hiro/inventory/{user_id}/codex": // HiroListInventoryItems
		// Read-only operations do not create audit log entries.
	case method == http.MethodGet && path == "/v2/console/hiro/inventory/{user_id}": // HiroListUserInventoryItems
		// Read-only operations do not create audit log entries.
	case method == http.MethodPost && path == "/v2/console/hiro/inventory/{user_id}": // HiroAddUserInventoryItems
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_INVENTORY
		metadata = body
		log = "hiro inventory items added to account"
	case method == http.MethodPut && path == "/v2/console/hiro/inventory/{user_id}": // HiroDeleteUserInventoryItems
		action = console.AuditLogAction_DELETE
		resource = console.AclResources_HIRO_INVENTORY
		metadata = body
		log = "hiro inventory items removed from account"
	case method == http.MethodPatch && path == "/v2/console/hiro/inventory/{user_id}": // HiroUpdateUserInventoryItems
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_INVENTORY
		metadata = body
		log = "hiro inventory items updated"
	case method == http.MethodGet && path == "/v2/console/hiro/progression/{user_id}": // HiroListProgressions
		// Read-only operations do not create audit log entries.
	case method == http.MethodDelete && path == "/v2/console/hiro/progression/{user_id}": // HiroResetProgressions
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_PROGRESSION
		metadata = body
		log = "hiro progression reset"
	case method == http.MethodPut && path == "/v2/console/hiro/progression/{user_id}": // HiroUnlockProgressions
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_PROGRESSION
		metadata = body
		log = "hiro progression unlocked"
	case method == http.MethodPatch && path == "/v2/console/hiro/progression/{user_id}": // HiroUpdateProgressions
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_PROGRESSION
		metadata = body
		log = "hiro progression updated"
	case method == http.MethodPost && path == "/v2/console/hiro/progression/{user_id}": // HiroPurchaseProgressions
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_PROGRESSION
		metadata = body
		log = "hiro progression purchased"
	case method == http.MethodPost && path == "/v2/console/hiro/economy/{user_id}": // HiroEconomyGrant
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_ECONOMY
		metadata = body
		log = "hiro economy grant"
	case method == http.MethodGet && path == "/v2/console/hiro/stats/{user_id}": // HiroStatsList
		// Read-only operations do not create audit log entries.
	case method == http.MethodPost && path == "/v2/console/hiro/stats/{user_id}": // HiroStatsUpdate
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_STATS
		metadata = body
		log = "hiro stats update"
	case method == http.MethodPost && path == "/v2/console/hiro/energy/{user_id}": // HiroEnergyGrant
		action = console.AuditLogAction_UPDATE
		resource = console.AclResources_HIRO_ENERGY
		metadata = body
		log = "hiro energy grant"
	}

	if action == console.AuditLogAction_UNKNOWN {
		// No audit to insert, skip.
		return
	}

	auditEntry := &AuditLogEntry{
		UserID:    userId.String(),
		Username:  username,
		Email:     email,
		Resource:  resource.String(),
		Action:    action.String(),
		Timestamp: ts,
		Metadata:  string(metadata),
		Message:   log,
	}

	if err := auditLogAdd(logger, db, auditEntry); err != nil {
		logger.Error("Failed to add audit log entry", zap.Error(err))
	}
}

func auditLogAdd(logger *zap.Logger, db *sql.DB, entry *AuditLogEntry) error {
	if entry.ID == "" {
		entry.ID = uuid.Must(uuid.NewV4()).String()
	}

	query := `
		INSERT INTO console_audit_log (
			id, console_user_id, console_username, email, resource, action, metadata, message, create_time
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	_, err := db.Exec(
		query,
		entry.ID,
		entry.UserID,
		entry.Username,
		entry.Email,
		entry.Resource,
		entry.Action,
		entry.Metadata,
		entry.Message,
		entry.Timestamp,
	)

	if err != nil {
		logger.Error("Failed to insert audit log entry", zap.Error(err), zap.String("action", entry.Action))
		return err
	}

	return nil
}

type auditLogListCursor struct {
	Timestamp time.Time
	Username  string
	Resource  console.AclResources
	Action    console.AuditLogAction
	ID        string
	IsNext    bool

	// Filter state to ensure consistent pagination
	UsernameFilter string
	ResourceFilter *console.AclResources
	ActionFilter   console.AuditLogAction
	BeforeFilter   time.Time
	AfterFilter    time.Time
}

// auditLogEntryList retrieves audit log entries with bidirectional keyset pagination and filtering
func auditLogEntryList(ctx context.Context, logger *zap.Logger, db *sql.DB, username string, action console.AuditLogAction, resource *console.AclResources, after, before time.Time, limit int, cursor string) (*console.AuditLogList, error) {
	var incomingCursor *auditLogListCursor
	if cursor != "" {
		// Decode the cursor
		cb, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			return nil, ErrAuditLogInvalidCursor
		}
		incomingCursor = &auditLogListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, ErrAuditLogInvalidCursor
		}

		// Validate cursor is compatible with the current request filters
		if username != "" && username != incomingCursor.UsernameFilter {
			return nil, ErrAuditLogInvalidCursor
		}
		if action != 0 && action != incomingCursor.ActionFilter {
			return nil, ErrAuditLogInvalidCursor
		}
		if resource != nil && incomingCursor.ResourceFilter != nil && *resource.Enum() != *incomingCursor.ResourceFilter {
			return nil, ErrAuditLogInvalidCursor
		}
		if !before.Equal(incomingCursor.AfterFilter) {
			return nil, ErrAuditLogInvalidCursor
		}
		if !after.Equal(incomingCursor.BeforeFilter) {
			return nil, ErrAuditLogInvalidCursor
		}
	}

	query := `
SELECT
	id,
	console_user_id,
	console_username,
	email,
	resource,
	action,
	metadata,
	message,
	create_time
FROM
	console_audit_log`

	var order string
	params := make([]interface{}, 0, 10)

	// Build the WHERE clause based on the cursor and filters
	if incomingCursor != nil {
		whereClause := ""

		// Add cursor-based pagination constraints
		if incomingCursor.IsNext {
			// Next page (older entries) - create_time DESC order
			whereClause = "(create_time, console_username, action, resource, id) < ($1, $2, $3, $4, $5)"
			order = " ORDER BY create_time DESC, console_username DESC, action DESC, resource DESC, id DESC"
		} else {
			// Previous page (newer entries) - create_time ASC order
			whereClause = "(create_time, console_username, action, resource, id) > ($1, $2, $3, $4, $5)"
			order = " ORDER BY create_time ASC, console_username ASC, action ASC, resource ASC, id ASC"
		}

		params = append(params,
			incomingCursor.Timestamp,
			incomingCursor.Username,
			incomingCursor.Action,
			incomingCursor.Resource,
			incomingCursor.ID)

		// Apply filters if provided
		filterConditions := []string{whereClause}

		if incomingCursor.UsernameFilter != "" {
			filterConditions = append(filterConditions, "console_username = $"+strconv.Itoa(len(params)+1))
			params = append(params, incomingCursor.UsernameFilter)
		}

		if incomingCursor.ActionFilter != 0 {
			filterConditions = append(filterConditions, "action = $"+strconv.Itoa(len(params)+1))
			params = append(params, incomingCursor.ActionFilter)
		}

		if incomingCursor.ResourceFilter != nil {
			filterConditions = append(filterConditions, "resource = $"+strconv.Itoa(len(params)+1))
			params = append(params, *incomingCursor.ResourceFilter.Enum())
		}

		if !incomingCursor.AfterFilter.IsZero() {
			filterConditions = append(filterConditions, "create_time > $"+strconv.Itoa(len(params)+1))
			params = append(params, incomingCursor.AfterFilter)
		}

		if !incomingCursor.BeforeFilter.IsZero() {
			filterConditions = append(filterConditions, "create_time < $"+strconv.Itoa(len(params)+1))
			params = append(params, incomingCursor.BeforeFilter)
		}

		query += " WHERE " + strings.Join(filterConditions, " AND ")
	} else {
		// No cursor - initial query
		filterConditions := []string{}

		if username != "" {
			filterConditions = append(filterConditions, "console_username = $"+strconv.Itoa(len(params)+1))
			params = append(params, username)
		}

		if action != 0 {
			filterConditions = append(filterConditions, "action = $"+strconv.Itoa(len(params)+1))
			params = append(params, action)
		}

		if resource != nil {
			filterConditions = append(filterConditions, "resource = $"+strconv.Itoa(len(params)+1))
			params = append(params, *resource.Enum())
		}

		if !after.IsZero() {
			filterConditions = append(filterConditions, "create_time > $"+strconv.Itoa(len(params)+1))
			params = append(params, after)
		}

		if !before.IsZero() {
			filterConditions = append(filterConditions, "create_time < $"+strconv.Itoa(len(params)+1))
			params = append(params, before)
		}

		if len(filterConditions) > 0 {
			query += " WHERE " + strings.Join(filterConditions, " AND ")
		}

		// Default order for initial query
		order = " ORDER BY create_time DESC, console_username DESC, action DESC, resource DESC, id DESC"
	}

	// Add order to query
	query += order

	// Add 1 to check if there are more results
	params = append(params, limit+1)
	query += fmt.Sprintf(" LIMIT $%d", len(params))

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving audit logs", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	var nextCursor *auditLogListCursor
	var prevCursor *auditLogListCursor
	auditLogs := make([]*console.AuditLogList_AuditLog, 0, limit)

	var id, dbUserID, dbUsername, email, metadata, message string
	var dbResource, dbAction int32
	var timestamp time.Time

	for rows.Next() {
		if len(auditLogs) >= limit {
			nextCursor = &auditLogListCursor{
				ID:             id,
				Username:       dbUsername,
				Action:         console.AuditLogAction(dbAction),
				Resource:       console.AclResources(dbResource),
				Timestamp:      timestamp,
				IsNext:         true,
				UsernameFilter: username,
				ActionFilter:   action,
				ResourceFilter: resource,
			}
			break
		}

		var dbResourceStr, dbActionStr string
		if err = rows.Scan(&id, &dbUserID, &dbUsername, &email, &dbResourceStr, &dbActionStr, &metadata, &message, &timestamp); err != nil {
			logger.Error("Error scanning audit log entry", zap.Error(err))
			return nil, err
		}

		dbResource = console.AclResources_value[dbResourceStr]
		dbAction = console.AuditLogAction_value[dbActionStr]

		auditLog := &console.AuditLogList_AuditLog{
			Id:        id,
			UserId:    dbUserID,
			Username:  dbUsername,
			Email:     email,
			Resource:  console.AclResources(dbResource),
			Action:    console.AuditLogAction(dbAction),
			Metadata:  metadata,
			Message:   message,
			Timestamp: timestamppb.New(timestamp),
		}

		auditLogs = append(auditLogs, auditLog)

		if incomingCursor != nil && prevCursor == nil {
			// First row becomes the previous cursor
			prevCursor = &auditLogListCursor{
				ID:             id,
				Username:       dbUsername,
				Action:         console.AuditLogAction(dbAction),
				Resource:       console.AclResources(dbResource),
				Timestamp:      timestamp,
				IsNext:         false,
				UsernameFilter: username,
				ActionFilter:   action,
				ResourceFilter: resource,
			}
		}
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error iterating audit log rows", zap.Error(err))
		return nil, err
	}
	_ = rows.Close()

	// If we were paginating backwards (using a prev cursor), we need to reverse the results
	if incomingCursor != nil && !incomingCursor.IsNext {
		if nextCursor != nil && prevCursor != nil {
			nextCursor, nextCursor.IsNext, prevCursor, prevCursor.IsNext = prevCursor, prevCursor.IsNext, nextCursor, nextCursor.IsNext
		} else if nextCursor != nil {
			nextCursor, prevCursor = nil, nextCursor
			prevCursor.IsNext = !prevCursor.IsNext
		} else if prevCursor != nil {
			nextCursor, prevCursor = prevCursor, nil
			nextCursor.IsNext = !nextCursor.IsNext
		}

		slices.Reverse(auditLogs)
	}

	// Encode the cursors
	var nextCursorStr string
	if nextCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			logger.Error("Error creating audit log list cursor", zap.Error(err))
			return nil, err
		}
		nextCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	var prevCursorStr string
	if prevCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
			logger.Error("Error creating audit log list cursor", zap.Error(err))
			return nil, err
		}
		prevCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return &console.AuditLogList{
		Entries:    auditLogs,
		NextCursor: nextCursorStr,
		PrevCursor: prevCursorStr,
	}, nil
}
