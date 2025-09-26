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
	"fmt"
	"math"
	"strings"

	"github.com/heroiclabs/nakama/v3/console"
)

type PermissionLevel uint64

const (
	PermissionRead   = PermissionLevel(0)
	PermissionWrite  = PermissionLevel(1)
	PermissionDelete = PermissionLevel(2)
)

type ConsoleResource uint64

// ATTENTION: DO NOT REORDER THE ENUM. ANY MODIFICATION SHOULD BE DONE IN AN INCREMENTAL-ONLY FASHION.
const (
	Account ConsoleResource = iota // ATTENTION: Do not modify the expression. The operation priority is important.
	AccountWallet
	AccountExport
	AccountFriends
	AccountGroups
	AllAccounts
	AllData
	AllStorage
	Api
	Configuration
	ChannelMessage
	User
	DatabaseData
	Group
	InAppPurchase
	Leaderboard
	LeaderboardRecord
	Match
	Notification
	Settings
	StorageData
	StorageDataImport
)

// ATTENTION: DO NOT REORDER THE SLICE. ANY MODIFICATION SHOULD BE DONE IN AN INCREMENTAL-ONLY FASHION.
var Resources = []struct {
	Resource ConsoleResource
	Name     string
}{
	{Account, "Account"},
	{AccountWallet, "AccountWallet"},
	{AccountExport, "AccountExport"},
	{AccountFriends, "AccountFriends"},
	{AccountGroups, "AccountGroups"},
	{AllAccounts, "AllAccounts"},
	{AllStorage, "AllStorage"},
	{AllData, "AllData"},
	{Api, "Api"},
	{Configuration, "Configuration"},
	{ChannelMessage, "ChannelMessage"},
	{User, "User"},
	{DatabaseData, "DatabaseData"},
	{Group, "Group"},
	{InAppPurchase, "InAppPurchase"},
	{Leaderboard, "Leaderboard"},
	{LeaderboardRecord, "LeaderboardRecord"},
	{Match, "Match"},
	{Notification, "Notification"},
	{Settings, "Settings"},
	{StorageData, "StorageData"},
	{StorageDataImport, "StorageDataImport"},
}

var (
	byteCount = func() int {
		// Postgres requires hex to be an even number of bytes.
		// This is not a bytea requirement but rather how hex
		// is converted from string to bytea in the migration files.
		b := int(math.Ceil(float64(len(Resources)*3) / 8.0))
		if b%2 != 0 {
			b++
		}
		return b
	}()
	None  = Permission{Bitmap: make([]byte, byteCount)}
	Admin = Permission{Bitmap: bytes.Repeat([]byte{0xFF}, byteCount)}
)

type Permission struct {
	Bitmap []byte
}

func (p Permission) Compose(permission Permission) Permission {
	for i, _ := range p.Bitmap {
		p.Bitmap[i] = p.Bitmap[i] | permission.Bitmap[i]
	}
	return p
}

func (p Permission) String() string {
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

	for i, _ := range p.Bitmap {
		if (p.Bitmap[i] & permission.Bitmap[i]) != permission.Bitmap[i] {
			return false
		}
	}

	return true
}

// For debug, returns a human-readable string representation of the permissions bitmap.
func (p Permission) bitmapString() string {
	sb := strings.Builder{}

	for _, b := range p.Bitmap {
		sb.WriteString(fmt.Sprintf("%08b ", b))
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
	for _, i := range Resources {
		if i.Name == resource {
			return NewPermission(i.Resource, level)
		}
	}
	return None
}

func CheckACL(action string, userPermissions Permission) bool {
	var requiredPermissions Permission

	switch action {
	case "/satori.console.Console/AclList":
		requiredPermissions = None
	case "/nakama.console.Console/AddUser":
		requiredPermissions = NewPermission(User, PermissionWrite)
	case "/nakama.console.Console/BanAccount":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/CallApiEndpoint":
		requiredPermissions = NewPermission(Api, PermissionWrite)
	case "/nakama.console.Console/CallRpcEndpoint":
		requiredPermissions = NewPermission(Api, PermissionWrite)
	case "/nakama.console.Console/DeleteAccount":
		requiredPermissions = NewPermission(Account, PermissionDelete)
	case "/nakama.console.Console/DeleteAccounts":
		requiredPermissions = NewPermission(AllAccounts, PermissionDelete)
	case "/nakama.console.Console/DeleteAllData":
		requiredPermissions = NewPermission(AllData, PermissionDelete)
	case "/nakama.console.Console/DeleteChannelMessages":
		requiredPermissions = NewPermission(ChannelMessage, PermissionDelete)
	case "/nakama.console.Console/DeleteFriend":
		requiredPermissions = NewPermission(AccountFriends, PermissionDelete)
	case "/nakama.console.Console/DeleteGroup":
		requiredPermissions = NewPermission(Group, PermissionDelete)
	case "/nakama.console.Console/DeleteGroupUser":
		requiredPermissions = NewPermission(Group, PermissionDelete)
	case "/nakama.console.Console/DeleteLeaderboard":
		requiredPermissions = NewPermission(Leaderboard, PermissionDelete)
	case "/nakama.console.Console/DeleteLeaderboardRecord":
		requiredPermissions = NewPermission(LeaderboardRecord, PermissionDelete)
	case "/nakama.console.Console/DeleteNotification":
		requiredPermissions = NewPermission(Notification, PermissionDelete)
	case "/nakama.console.Console/DeleteStorage": // Delete all storage data.
		requiredPermissions = NewPermission(AllStorage, PermissionDelete)
	case "/nakama.console.Console/DeleteStorageObject":
		requiredPermissions = NewPermission(StorageData, PermissionDelete)
	case "/nakama.console.Console/DeleteUser":
		requiredPermissions = NewPermission(User, PermissionDelete)
	case "/nakama.console.Console/DeleteWalletLedger":
		requiredPermissions = NewPermission(AccountWallet, PermissionDelete)
	case "/nakama.console.Console/DemoteGroupMember":
		requiredPermissions = NewPermission(Group, PermissionWrite)
	case "/nakama.console.Console/ExportAccount":
		requiredPermissions = NewPermission(AccountExport, PermissionRead)
	case "/nakama.console.Console/ExportGroup":
		requiredPermissions = NewPermission(Group, PermissionRead)
	case "/nakama.console.Console/GetAccount":
		requiredPermissions = NewPermission(Account, PermissionRead)
	case "/nakama.console.Console/GetConfig":
		requiredPermissions = NewPermission(Configuration, PermissionRead)
	case "/nakama.console.Console/GetFriends":
		requiredPermissions = NewPermission(AccountFriends, PermissionRead)
	case "/nakama.console.Console/GetGroup":
		requiredPermissions = NewPermission(Group, PermissionRead)
	case "/nakama.console.Console/GetGroups":
		requiredPermissions = NewPermission(Group, PermissionRead)
	case "/nakama.console.Console/GetLeaderboard":
		requiredPermissions = NewPermission(Leaderboard, PermissionRead)
	case "/nakama.console.Console/GetMatchState":
		requiredPermissions = NewPermission(Match, PermissionRead)
	case "/nakama.console.Console/GetMembers":
		requiredPermissions = NewPermission(Group, PermissionRead)
	case "/nakama.console.Console/GetNotification":
		requiredPermissions = NewPermission(Notification, PermissionRead)
	case "/nakama.console.Console/GetPurchase":
		requiredPermissions = NewPermission(InAppPurchase, PermissionRead)
	case "/nakama.console.Console/GetRuntime":
		requiredPermissions = NewPermission(Configuration, PermissionRead)
	case "/nakama.console.Console/GetSetting":
		requiredPermissions = NewPermission(Settings, PermissionRead)
	case "/nakama.console.Console/GetStatus":
		requiredPermissions = None // Accessible to anyone with console access.
	case "/nakama.console.Console/GetStorage":
		requiredPermissions = NewPermission(StorageData, PermissionRead)
	case "/nakama.console.Console/GetSubscription":
		requiredPermissions = NewPermission(InAppPurchase, PermissionRead)
	case "/nakama.console.Console/GetWalletLedger":
		requiredPermissions = NewPermission(AccountWallet, PermissionRead)
	case "/nakama.console.Console/ListAccounts":
		requiredPermissions = NewPermission(Account, PermissionRead)
	case "/nakama.console.Console/ListApiEndpoints":
		requiredPermissions = NewPermission(Api, PermissionRead)
	case "/nakama.console.Console/ListChannelMessages":
		requiredPermissions = NewPermission(ChannelMessage, PermissionRead)
	case "/nakama.console.Console/ListGroups":
		requiredPermissions = NewPermission(Group, PermissionRead)
	case "/nakama.console.Console/ListLeaderboardRecords":
		requiredPermissions = NewPermission(LeaderboardRecord, PermissionRead)
	case "/nakama.console.Console/ListLeaderboards":
		requiredPermissions = NewPermission(Leaderboard, PermissionRead)
	case "/nakama.console.Console/ListMatches":
		requiredPermissions = NewPermission(Match, PermissionRead)
	case "/nakama.console.Console/ListNotifications":
		requiredPermissions = NewPermission(Notification, PermissionRead)
	case "/nakama.console.Console/ListPurchases":
		requiredPermissions = NewPermission(InAppPurchase, PermissionRead)
	case "/nakama.console.Console/ListSettings":
		requiredPermissions = NewPermission(Settings, PermissionRead)
	case "/nakama.console.Console/ListStorage":
		requiredPermissions = NewPermission(StorageData, PermissionRead)
	case "/nakama.console.Console/ListStorageCollections":
		requiredPermissions = NewPermission(StorageData, PermissionRead)
	case "/nakama.console.Console/ListSubscriptions":
		requiredPermissions = NewPermission(InAppPurchase, PermissionRead)
	case "/nakama.console.Console/ListUsers":
		requiredPermissions = NewPermission(User, PermissionRead)
	case "/nakama.console.Console/PromoteGroupMember":
		requiredPermissions = NewPermission(Group, PermissionWrite)
	case "/nakama.console.Console/RequireUserMfa":
		requiredPermissions = NewPermission(User, PermissionWrite)
	case "/nakama.console.Console/ResetUserMfa":
		requiredPermissions = NewPermission(User, PermissionWrite)
	case "/nakama.console.Console/UnbanAccount":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkApple":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkCustom":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkDevice":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkEmail":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkFacebook":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkFacebookInstantGame":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkGameCenter":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkGoogle":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UnlinkSteam":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UpdateAccount":
		requiredPermissions = NewPermission(Account, PermissionWrite)
	case "/nakama.console.Console/UpdateGroup":
		requiredPermissions = NewPermission(Group, PermissionWrite)
	case "/nakama.console.Console/UpdateSetting":
		requiredPermissions = NewPermission(Settings, PermissionWrite)
	case "/nakama.console.Console/WriteStorageObject":
		requiredPermissions = NewPermission(StorageData, PermissionWrite)
	case "/v2/console/storage/import":
		// Special case for non-grpc gateway endpoint.
		requiredPermissions = NewPermission(StorageDataImport, PermissionWrite)
	default:
		requiredPermissions = Admin
	}

	return userPermissions.HasAccess(requiredPermissions)
}

func New(acl map[string]*console.Permissions) Permission {
	acc := None

	for resource, permissions := range acl {
		if permissions == nil {
			continue
		}

		if permissions.Read {
			acc = acc.Compose(NewPermissionFromString(resource, PermissionRead))
		}

		if permissions.Write {
			acc = acc.Compose(NewPermissionFromString(resource, PermissionWrite))
		}

		if permissions.Delete {
			acc = acc.Compose(NewPermissionFromString(resource, PermissionDelete))
		}
	}

	return acc
}

func NewFromBytes(b []byte) Permission {
	return Permission{Bitmap: b}
}

func (p Permission) ACL() map[string]*console.Permissions {
	acl := map[string]*console.Permissions{}
	curr := p

	for _, resource := range Resources {
		p := &console.Permissions{}
		switch {
		case curr.HasAccess(NewPermission(resource.Resource, PermissionRead)):
			p.Read = true
		case curr.HasAccess(NewPermission(resource.Resource, PermissionWrite)):
			p.Write = true
		case curr.HasAccess(NewPermission(resource.Resource, PermissionDelete)):
			p.Delete = true
		}

		acl[resource.Name] = p
	}

	return acl
}
