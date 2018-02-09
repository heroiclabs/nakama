// Copyright 2017, OpenCensus Authors
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
//

package tag_test

import (
	"context"
	"log"

	"go.opencensus.io/tag"
)

var (
	tagMap *tag.Map
	ctx    context.Context
	key    tag.Key
)

func ExampleNewKey() {
	// Get a key to represent user OS.
	key, err := tag.NewKey("my.org/keys/user-os")
	if err != nil {
		log.Fatal(err)
	}
	_ = key // use key
}

func ExampleNewMap() {
	osKey, err := tag.NewKey("my.org/keys/user-os")
	if err != nil {
		log.Fatal(err)
	}
	userIDKey, err := tag.NewKey("my.org/keys/user-id")
	if err != nil {
		log.Fatal(err)
	}

	tagMap, err := tag.NewMap(ctx,
		tag.Insert(osKey, "macOS-10.12.5"),
		tag.Upsert(userIDKey, "cde36753ed"),
	)
	if err != nil {
		log.Fatal(err)
	}
	_ = tagMap // use the tag map
}

func ExampleNewMap_replace() {
	tagMap, err := tag.NewMap(ctx,
		tag.Insert(key, "macOS-10.12.5"),
		tag.Upsert(key, "macOS-10.12.7"),
	)
	if err != nil {
		log.Fatal(err)
	}
	ctx = tag.NewContext(ctx, tagMap)

	_ = ctx // use context
}

func ExampleNewContext() {
	// Propagate the tag map in the current context.
	ctx := tag.NewContext(context.Background(), tagMap)

	_ = ctx // use context
}

func ExampleFromContext() {
	tagMap := tag.FromContext(ctx)

	_ = tagMap // use the tag map
}

func ExampleDo() {
	tagMap, err := tag.NewMap(ctx,
		tag.Insert(key, "macOS-10.12.5"),
		tag.Upsert(key, "macOS-10.12.7"),
	)
	if err != nil {
		log.Fatal(err)
	}
	ctx = tag.NewContext(ctx, tagMap)
	tag.Do(ctx, func(ctx context.Context) {
		_ = ctx // use context
	})
}
