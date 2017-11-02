// Copyright 2017 The Nakama Authors
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

package tests

import (
	"nakama/server"
	"testing"

	"github.com/satori/go.uuid"
)

func TestGroupCreateEmpty(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	_, err = server.GroupsCreate(logger, db, nil)
	if err == nil {
		t.Error("Expected error but was nil")
	}
}

func TestGroupCreateMissingName(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()

	_, err = server.GroupsCreate(logger, db, []*server.GroupCreateParam{{
		Creator:     uuid.NewV4().String(),
		Private:     true,
		Lang:        "en",
		Description: "desc",
	}})
	if err == nil {
		t.Error("Expected error but was nil")
	}
}

func TestGroupCreateMissingCreator(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()

	_, err = server.GroupsCreate(logger, db, []*server.GroupCreateParam{{
		Name:        "name1",
		Private:     true,
		Lang:        "en",
		Description: "desc",
	}})
	if err == nil {
		t.Error("Expected error but was nil")
	}
}

func TestGroupCreate(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()

	_, err = server.GroupsCreate(logger, db, []*server.GroupCreateParam{{
		Name:        generateString(),
		Creator:     uuid.NewV4().String(),
		Private:     true,
		Lang:        "en",
		Description: "desc",
		Metadata:    []byte("{\"key\":\"value\"}"),
	}})
	if err != nil {
		t.Error(err)
	}
}

func TestGroupCreateMultipleSameName(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()

	name := generateString()

	_, err = server.GroupsCreate(logger, db, []*server.GroupCreateParam{
		{
			Name:        name,
			Creator:     uuid.NewV4().String(),
			Private:     true,
			Lang:        "en",
			Description: "desc",
		},
		{
			Name:        name,
			Creator:     uuid.NewV4().String(),
			Private:     true,
			Lang:        "en",
			Description: "desc",
		},
	})
	if err == nil {
		t.Error("Expected error but was nil")
	}
}

func TestGroupCreateMultiple(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()

	_, err = server.GroupsCreate(logger, db, []*server.GroupCreateParam{
		{
			Name:        generateString(),
			Creator:     uuid.NewV4().String(),
			Private:     true,
			Lang:        "en",
			Description: "desc",
			Metadata:    []byte("{\"key\":\"value\"}"),
		},
		{
			Name:        generateString(),
			Creator:     uuid.NewV4().String(),
			Private:     true,
			Lang:        "en",
			Description: "desc",
			Metadata:    []byte("{\"key\":\"value\"}"),
		},
	})
	if err != nil {
		t.Error(err)
	}
}
