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
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func Test_Permission(t *testing.T) {
	p := NewPermission(Account, PermissionRead)
	fmt.Printf("%08b%08b\n", p.Bitmap[0], p.Bitmap[1])
	p = NewPermission(Account, PermissionWrite)
	fmt.Printf("%08b%08b\n", p.Bitmap[0], p.Bitmap[1])
	p = NewPermission(AccountWallet, PermissionRead)
	fmt.Printf("%08b%08b\n", p.Bitmap[0], p.Bitmap[1])
	p = NewPermission(AccountExport, PermissionDelete)
	fmt.Printf("%08b%08b\n", p.Bitmap[0], p.Bitmap[1])

	p = NewPermission(Account, PermissionRead).Compose(NewPermission(Account, PermissionWrite)).Compose(NewPermission(AccountWallet, PermissionRead)).Compose(NewPermission(AccountExport, PermissionDelete))
	fmt.Printf("%08b%08b\n", p.Bitmap[0], p.Bitmap[1])

	assert.True(t, p.HasAccess(NewPermission(Account, PermissionRead)))
	assert.True(t, p.HasAccess(NewPermission(AccountWallet, PermissionRead)))
	assert.True(t, p.HasAccess(NewPermission(Account, PermissionWrite)))
	assert.True(t, p.HasAccess(NewPermission(AccountExport, PermissionDelete)))
	assert.False(t, p.HasAccess(NewPermission(Account, PermissionDelete)))
}
