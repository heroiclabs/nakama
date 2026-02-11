// Copyright 2025 Heroic Labs.
// All rights reserved.
//
// NOTICE: All information contained herein is, and remains the property of Heroic
// Labs. and its suppliers, if any. The intellectual and technical concepts
// contained herein are proprietary to Heroic Labs. and its suppliers and may be
// covered by U.S. and Foreign Patents, patents in process, and are protected by
// trade secret or copyright law. Dissemination of this information or reproduction
// of this material is strictly forbidden unless prior written permission is
// obtained from Heroic Labs.

package acl

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"

	"github.com/heroiclabs/nakama/v3/console"
)

// ATTENTION: These values cannot be changed as they represent the bit positions in the ACL bitmap.
const (
	PermissionRead   = PermissionLevel(0)
	PermissionWrite  = PermissionLevel(1)
	PermissionDelete = PermissionLevel(2)
)

type PermissionLevel int
type ConsoleResource = console.AclResources

var (
	byteCount = int(math.Ceil(float64(len(console.AclResources_value)*3) / 8.0))
	None      = func() Permission { return Permission{Bitmap: make([]byte, byteCount)} }
	Admin     = func() Permission { return Permission{Bitmap: bytes.Repeat([]byte{0xFF}, byteCount)} }
)

type Permission struct {
	Bitmap []byte
}

func (p Permission) Compose(permission Permission) Permission {
	for i := range p.Bitmap {
		p.Bitmap[i] = p.Bitmap[i] | permission.Bitmap[i]
	}
	return p
}

func (p Permission) String() string {
	resourceBitCount := len(console.AclResources_value) * 3
	bitCount := 0
	for _, b := range p.Bitmap {
		for j := 0; j < 8; j++ {
			if (b & (1 << (7 - j))) == 1 {
				bitCount++
			}
		}
	}

	if bitCount == resourceBitCount {
		// Admin equivalent. Return all bits set to 1 including padding.
		p.Bitmap = Admin().Bitmap
	}

	return base64.RawURLEncoding.EncodeToString(p.Bitmap)
}

func (p Permission) IsNone() bool {
	for _, b := range p.Bitmap {
		if b != 0x00 {
			return false
		}
	}
	return true
}

func (p Permission) IsAdmin() bool {
	for _, b := range p.Bitmap {
		if b != 0xFF {
			return false
		}
	}

	return true
}

func (p Permission) HasAccess(permission Permission) bool {
	if permission.IsNone() || p.IsAdmin() {
		return true
	}

	for i := range p.Bitmap {
		if (p.Bitmap[i] & permission.Bitmap[i]) != permission.Bitmap[i] {
			return false
		}
	}

	return true
}

// For debug, returns a human-readable string representation of the permissions bitmap.
func (p Permission) bitmapString() string {
	sb := strings.Builder{}

	for i, b := range p.Bitmap {
		if i == len(p.Bitmap)-1 {
			sb.WriteString(fmt.Sprintf("%08b", b))
		} else {
			sb.WriteString(fmt.Sprintf("%08b ", b))
		}
	}
	return sb.String()
}

func NewPermission(resource ConsoleResource, level PermissionLevel) Permission {
	bytes := make([]byte, byteCount)

	targetBitIdx := int(resource*3) + int(level)
	bitIdx := 0
	for i, b := range bytes {
		for j := 0; j < 8; j++ {
			if bitIdx == targetBitIdx {
				bytes[i] = b | (1 << (7 - j))
			}
			bitIdx++
		}
	}

	return Permission{Bitmap: bytes}
}

func NewPermissionFromString(resource string, level PermissionLevel) Permission {
	if i, ok := console.AclResources_value[resource]; ok {
		return NewPermission(ConsoleResource(i), level)
	}

	return None()
}

func CheckACLHttp(method, path string, userPermissions Permission) bool {
	var requiredPermissions Permission

	switch {
	case method == http.MethodGet && path == "/v2/console/hiro/inventory/{user_id}/codex": // HiroListInventoryItems
		requiredPermissions = NewPermission(console.AclResources_HIRO_INVENTORY, PermissionRead)
	case method == http.MethodGet && path == "/v2/console/hiro/inventory/{user_id}": // HiroListUserInventoryItems
		requiredPermissions = NewPermission(console.AclResources_HIRO_INVENTORY, PermissionRead)
	case method == http.MethodPost && path == "/v2/console/hiro/inventory/{user_id}": // HiroAddUserInventoryItems
		requiredPermissions = NewPermission(console.AclResources_HIRO_INVENTORY, PermissionWrite)
	case method == http.MethodPut && path == "/v2/console/hiro/inventory/{user_id}": // HiroDeleteUserInventoryItems
		requiredPermissions = NewPermission(console.AclResources_HIRO_INVENTORY, PermissionDelete)
	case method == http.MethodPatch && path == "/v2/console/hiro/inventory/{user_id}": // HiroUpdateUserInventoryItems
		requiredPermissions = NewPermission(console.AclResources_HIRO_INVENTORY, PermissionWrite)
	case method == http.MethodGet && path == "/v2/console/hiro/progression/{user_id}": // HiroListProgressions
		requiredPermissions = NewPermission(console.AclResources_HIRO_PROGRESSION, PermissionRead)
	case method == http.MethodDelete && path == "/v2/console/hiro/progression/{user_id}": // HiroResetProgressions
		requiredPermissions = NewPermission(console.AclResources_HIRO_PROGRESSION, PermissionWrite)
	case method == http.MethodPut && path == "/v2/console/hiro/progression/{user_id}": // HiroUnlockProgressions
		requiredPermissions = NewPermission(console.AclResources_HIRO_PROGRESSION, PermissionWrite)
	case method == http.MethodPatch && path == "/v2/console/hiro/progression/{user_id}": // HiroUpdateProgressions
		requiredPermissions = NewPermission(console.AclResources_HIRO_PROGRESSION, PermissionWrite)
	case method == http.MethodPost && path == "/v2/console/hiro/progression/{user_id}": // HiroPurchaseProgressions
		requiredPermissions = NewPermission(console.AclResources_HIRO_PROGRESSION, PermissionWrite)
	case method == http.MethodPost && path == "/v2/console/hiro/economy/{user_id}": // HiroEconomyGrant
		requiredPermissions = NewPermission(console.AclResources_HIRO_ECONOMY, PermissionWrite)
	case method == http.MethodGet && path == "/v2/console/hiro/stats/{user_id}": // HiroStatsList
		requiredPermissions = NewPermission(console.AclResources_HIRO_STATS, PermissionRead)
	case method == http.MethodPost && path == "/v2/console/hiro/stats/{user_id}": // HiroStatsUpdate
		requiredPermissions = NewPermission(console.AclResources_HIRO_STATS, PermissionWrite)
	case method == http.MethodPost && path == "/v2/console/hiro/energy/{user_id}": // HiroEnergyGrant
		requiredPermissions = NewPermission(console.AclResources_HIRO_ENERGY, PermissionWrite)
	default:
		requiredPermissions = Admin()
	}

	return userPermissions.HasAccess(requiredPermissions)
}

func CheckACL(path string, userPermissions Permission) bool {
	var requiredPermissions Permission

	switch path {
	case "/nakama.console.Console/GetUser":
		requiredPermissions = None()
	case "/nakama.console.Console/ListAuditLogs":
		requiredPermissions = NewPermission(console.AclResources_AUDIT_LOG, PermissionRead)
	case "/nakama.console.Console/ListAuditLogUsers":
		requiredPermissions = None()
	case "/nakama.console.Console/AddAclTemplate":
		requiredPermissions = NewPermission(console.AclResources_ACL_TEMPLATE, PermissionWrite)
	case "/nakama.console.Console/AddUser":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/BanAccount":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/AddAccountNote":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_NOTES, PermissionWrite)
	case "/nakama.console.Console/AddGroupUsers":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_GROUPS, PermissionWrite)
	case "/nakama.console.Console/ListAccountNotes":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_NOTES, PermissionRead)
	case "/nakama.console.Console/DeleteAccountNote":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_NOTES, PermissionDelete)
	case "/nakama.console.Console/CallApiEndpoint":
		requiredPermissions = NewPermission(console.AclResources_API_EXPLORER, PermissionWrite)
	case "/nakama.console.Console/CallRpcEndpoint":
		requiredPermissions = NewPermission(console.AclResources_API_EXPLORER, PermissionWrite)
	case "/nakama.console.Console/DeleteAccount":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionDelete)
	case "/nakama.console.Console/DeleteAccounts":
		requiredPermissions = NewPermission(console.AclResources_ALL_ACCOUNTS, PermissionDelete)
	case "/nakama.console.Console/DeleteAclTemplate":
		requiredPermissions = NewPermission(console.AclResources_ACL_TEMPLATE, PermissionDelete)
	case "/nakama.console.Console/DeleteAllData":
		requiredPermissions = NewPermission(console.AclResources_ALL_DATA, PermissionDelete)
	case "/nakama.console.Console/DeleteChannelMessages":
		requiredPermissions = NewPermission(console.AclResources_CHANNEL_MESSAGE, PermissionDelete)
	case "/nakama.console.Console/DeleteFriend":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_FRIENDS, PermissionDelete)
	case "/nakama.console.Console/DeleteGroup":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionDelete)
	case "/nakama.console.Console/DeleteGroupUser":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionDelete)
	case "/nakama.console.Console/DeleteLeaderboard":
		requiredPermissions = NewPermission(console.AclResources_LEADERBOARD, PermissionDelete)
	case "/nakama.console.Console/DeleteLeaderboardRecord":
		requiredPermissions = NewPermission(console.AclResources_LEADERBOARD_RECORD, PermissionDelete)
	case "/nakama.console.Console/DeleteNotification":
		requiredPermissions = NewPermission(console.AclResources_NOTIFICATION, PermissionDelete)
	case "/nakama.console.Console/DeleteStorage": // Delete all storage data.
		requiredPermissions = NewPermission(console.AclResources_ALL_STORAGE, PermissionDelete)
	case "/nakama.console.Console/DeleteStorageObject":
		requiredPermissions = NewPermission(console.AclResources_STORAGE_DATA, PermissionDelete)
	case "/nakama.console.Console/DeleteUser":
		requiredPermissions = NewPermission(console.AclResources_USER, PermissionDelete)
	case "/nakama.console.Console/DeleteWalletLedger":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_WALLET, PermissionDelete)
	case "/nakama.console.Console/DemoteGroupMember":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionWrite)
	case "/nakama.console.Console/ExportAccount":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_EXPORT, PermissionRead)
	case "/nakama.console.Console/ImportAccount":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_EXPORT, PermissionWrite)
	case "/nakama.console.Console/ImportAccountFull":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_EXPORT, PermissionWrite)
	case "/nakama.console.Console/ExportGroup":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionRead)
	case "/nakama.console.Console/GetAccount":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionRead)
	case "/nakama.console.Console/GetConfig":
		requiredPermissions = NewPermission(console.AclResources_CONFIGURATION, PermissionRead)
	case "/nakama.console.Console/GetFriends":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_FRIENDS, PermissionRead)
	case "/nakama.console.Console/GetGroup":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionRead)
	case "/nakama.console.Console/GetGroups":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_GROUPS, PermissionRead)
	case "/nakama.console.Console/GetLeaderboard":
		requiredPermissions = NewPermission(console.AclResources_LEADERBOARD, PermissionRead)
	case "/nakama.console.Console/GetMatchState":
		requiredPermissions = NewPermission(console.AclResources_MATCH, PermissionRead)
	case "/nakama.console.Console/GetMembers":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionRead)
	case "/nakama.console.Console/GetNotification":
		requiredPermissions = NewPermission(console.AclResources_NOTIFICATION, PermissionRead)
	case "/nakama.console.Console/GetPurchase":
		requiredPermissions = NewPermission(console.AclResources_IN_APP_PURCHASE, PermissionRead)
	case "/nakama.console.Console/GetRuntime":
		requiredPermissions = NewPermission(console.AclResources_CONFIGURATION, PermissionRead)
	case "/nakama.console.Console/GetSetting":
		requiredPermissions = NewPermission(console.AclResources_SETTINGS, PermissionRead)
	case "/nakama.console.Console/GetStatus":
		requiredPermissions = None()
	case "/nakama.console.Console/GetStorage":
		requiredPermissions = NewPermission(console.AclResources_STORAGE_DATA, PermissionRead)
	case "/nakama.console.Console/GetSubscription":
		requiredPermissions = NewPermission(console.AclResources_IN_APP_PURCHASE, PermissionRead)
	case "/nakama.console.Console/GetWalletLedger":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT_WALLET, PermissionRead)
	case "/nakama.console.Console/ListAccounts":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionRead)
	case "/nakama.console.Console/ListAccounts/ListAclTemplates":
		requiredPermissions = None()
	case "/nakama.console.Console/ListAccounts/ListAuditLogs":
		requiredPermissions = NewPermission(console.AclResources_AUDIT_LOG, PermissionRead)
	case "/nakama.console.Console/ListApiEndpoints":
		requiredPermissions = NewPermission(console.AclResources_API_EXPLORER, PermissionRead)
	case "/nakama.console.Console/ListChannelMessages":
		requiredPermissions = NewPermission(console.AclResources_CHANNEL_MESSAGE, PermissionRead)
	case "/nakama.console.Console/ListGroups":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionRead)
	case "/nakama.console.Console/ListLeaderboardRecords":
		requiredPermissions = NewPermission(console.AclResources_LEADERBOARD_RECORD, PermissionRead)
	case "/nakama.console.Console/ListLeaderboards":
		requiredPermissions = NewPermission(console.AclResources_LEADERBOARD, PermissionRead)
	case "/nakama.console.Console/ListMatches":
		requiredPermissions = NewPermission(console.AclResources_MATCH, PermissionRead)
	case "/nakama.console.Console/ListNotifications":
		requiredPermissions = NewPermission(console.AclResources_NOTIFICATION, PermissionRead)
	case "/nakama.console.Console/ListPurchases":
		requiredPermissions = NewPermission(console.AclResources_IN_APP_PURCHASE, PermissionRead)
	case "/nakama.console.Console/ListSettings":
		requiredPermissions = None()
	case "/nakama.console.Console/ListStorage":
		requiredPermissions = NewPermission(console.AclResources_STORAGE_DATA, PermissionRead)
	case "/nakama.console.Console/ListStorageCollections":
		requiredPermissions = NewPermission(console.AclResources_STORAGE_DATA, PermissionRead)
	case "/nakama.console.Console/ListSubscriptions":
		requiredPermissions = NewPermission(console.AclResources_IN_APP_PURCHASE, PermissionRead)
	case "/nakama.console.Console/ListUsers":
		requiredPermissions = NewPermission(console.AclResources_USER, PermissionRead)
	case "/nakama.console.Console/PromoteGroupMember":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionWrite)
	case "/nakama.console.Console/RegisteredExtensions":
		requiredPermissions = None()
	case "/nakama.console.Console/RequireUserMfa":
		requiredPermissions = NewPermission(console.AclResources_USER, PermissionWrite)
	case "/nakama.console.Console/ResetUserMfa":
		requiredPermissions = NewPermission(console.AclResources_USER, PermissionWrite)
	case "/nakama.console.Console/ResetUserPassword":
		requiredPermissions = NewPermission(console.AclResources_USER, PermissionWrite)
	case "/nakama.console.Console/UnbanAccount":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkApple":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkCustom":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkDevice":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkEmail":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkFacebook":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkFacebookInstantGame":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkGameCenter":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkGoogle":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UnlinkSteam":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UpdateAccount":
		requiredPermissions = NewPermission(console.AclResources_ACCOUNT, PermissionWrite)
	case "/nakama.console.Console/UpdateAclTemplate":
		requiredPermissions = NewPermission(console.AclResources_ACL_TEMPLATE, PermissionWrite)
	case "/nakama.console.Console/UpdateGroup":
		requiredPermissions = NewPermission(console.AclResources_GROUP, PermissionWrite)
	case "/nakama.console.Console/UpdateUser":
		requiredPermissions = NewPermission(console.AclResources_USER, PermissionWrite)
	case "/nakama.console.Console/UpdateSetting":
		requiredPermissions = NewPermission(console.AclResources_SETTINGS, PermissionWrite)
	case "/nakama.console.Console/WriteStorageObject":
		requiredPermissions = NewPermission(console.AclResources_STORAGE_DATA, PermissionWrite)
	case "/nakama.console.Console/SatoriListTemplates":
		requiredPermissions = NewPermission(console.AclResources_SATORI_MESSAGE, PermissionRead)
	case "/nakama.console.Console/SatoriSendDirectMessage":
		requiredPermissions = NewPermission(console.AclResources_SATORI_MESSAGE, PermissionWrite)
	case "/nakama.console.Console/SendNotificationRequest":
		requiredPermissions = NewPermission(console.AclResources_NOTIFICATION, PermissionWrite)
	case "/v2/console/storage/import":
		// Special case for non-grpc gateway endpoint.
		requiredPermissions = NewPermission(console.AclResources_STORAGE_DATA_IMPORT, PermissionWrite)
	default:
		requiredPermissions = Admin()
	}

	return userPermissions.HasAccess(requiredPermissions)
}

func New(acl map[string]*console.Permissions) Permission {
	acc := None()

	resourceBitCount := len(console.AclResources_value) * 3
	setBitCount := 0
	for resource, permissions := range acl {
		if permissions == nil {
			continue
		}

		if _, ok := console.AclResources_value[resource]; !ok {
			// Unknown resource value, skip.
			continue
		}

		if permissions.Read {
			acc = acc.Compose(NewPermissionFromString(resource, PermissionRead))
			setBitCount++
		}

		if permissions.Write {
			acc = acc.Compose(NewPermissionFromString(resource, PermissionWrite))
			setBitCount++
		}

		if permissions.Delete {
			acc = acc.Compose(NewPermissionFromString(resource, PermissionDelete))
			setBitCount++
		}
	}

	if setBitCount == resourceBitCount {
		return Admin()
	}

	return acc
}

// Create Permission from raw bitmap bytes.
// Do not use for JSON deserialization. Use NewFromJson instead.
func NewFromBytes(b []byte) Permission {
	if len(b) != byteCount {
		return None()
	}
	return Permission{Bitmap: b}
}

func (p Permission) ACL() map[string]*console.Permissions {
	acl := map[string]*console.Permissions{}
	curr := p

	for i, resource := range console.AclResources_name {
		p := &console.Permissions{}
		if curr.HasAccess(NewPermission(ConsoleResource(i), PermissionRead)) {
			p.Read = true
		}
		if curr.HasAccess(NewPermission(ConsoleResource(i), PermissionWrite)) {
			p.Write = true
		}
		if curr.HasAccess(NewPermission(ConsoleResource(i), PermissionDelete)) {
			p.Delete = true
		}

		acl[resource] = p
	}

	return acl
}

// Create new type to ensure json output contains all keys
type dbAclEntry struct {
	Read   bool `json:"read"`
	Write  bool `json:"write"`
	Delete bool `json:"delete"`
}
type dbPermission struct {
	Admin bool                  `json:"admin"`
	Acl   map[string]dbAclEntry `json:"acl,omitempty"`
}

func NewFromJson(s string) (Permission, error) {
	var dbAcl dbPermission
	if err := json.Unmarshal([]byte(s), &dbAcl); err != nil {
		return Permission{}, err
	}

	if dbAcl.Admin {
		return Admin(), nil
	}

	out := make(map[string]*console.Permissions, len(console.AclResources_value))
	for resource := range console.AclResources_value {
		p := dbAcl.Acl[resource]
		out[resource] = &console.Permissions{
			Read:   p.Read,
			Write:  p.Write,
			Delete: p.Delete,
		}
	}
	return New(out), nil
}

func newDbPermission() dbPermission {
	acl := make(map[string]dbAclEntry, len(console.AclResources_value))
	return dbPermission{Acl: acl}
}

func (p Permission) ToJson() (string, error) {
	acl := p.ACL()

	out := newDbPermission()

	allPermissionsKeyCount := 0
	for k, v := range acl {
		out.Acl[k] = dbAclEntry{Read: v.Read, Write: v.Write, Delete: v.Delete}
		if v.Read && v.Write && v.Delete {
			allPermissionsKeyCount++
		}
	}

	if allPermissionsKeyCount == len(console.AclResources_value) {
		out = dbPermission{Admin: true, Acl: nil}
	}

	j, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(j), nil
}
