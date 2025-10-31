// Copyright 2024 Heroic Labs.
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
	"testing"

	"github.com/heroiclabs/nakama/v3/console"
	"github.com/stretchr/testify/assert"
)

func Test_Permission(t *testing.T) {
	p := NewPermission(console.AclResources_ACCOUNT, PermissionRead).
		Compose(NewPermission(console.AclResources_ACCOUNT, PermissionWrite)).
		Compose(NewPermission(console.AclResources_ACCOUNT_WALLET, PermissionRead)).
		Compose(NewPermission(console.AclResources_ACCOUNT_EXPORT, PermissionDelete))

	t.Logf("Permission bits: %s", p.bitmapString())

	acl := p.ACL()

	assert.True(t, p.HasAccess(NewPermission(console.AclResources_ACCOUNT, PermissionRead)))
	assert.True(t, p.HasAccess(NewPermission(console.AclResources_ACCOUNT, PermissionRead)))
	assert.True(t, p.HasAccess(NewPermission(console.AclResources_ACCOUNT, PermissionWrite)))
	assert.True(t, p.HasAccess(NewPermission(console.AclResources_ACCOUNT_EXPORT, PermissionDelete)))
	assert.False(t, p.HasAccess(NewPermission(console.AclResources_ACCOUNT, PermissionDelete)))
	assert.True(t, acl[console.AclResources_ACCOUNT.String()].Read)
	assert.True(t, acl[console.AclResources_ACCOUNT.String()].Write)
	assert.False(t, acl[console.AclResources_ACCOUNT.String()].Delete)
	assert.True(t, acl[console.AclResources_ACCOUNT_WALLET.String()].Read)
	assert.False(t, acl[console.AclResources_ACCOUNT_WALLET.String()].Write)
	assert.False(t, acl[console.AclResources_ACCOUNT_WALLET.String()].Delete)
	assert.False(t, acl[console.AclResources_ACCOUNT_EXPORT.String()].Read)
	assert.False(t, acl[console.AclResources_ACCOUNT_EXPORT.String()].Write)
	assert.True(t, acl[console.AclResources_ACCOUNT_EXPORT.String()].Delete)
}
