//  Copyright (c) 2017 Couchbase, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 		http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package vellum

import "testing"

// FIXME add tests for MRU

func TestRegistry(t *testing.T) {
	p := &builderNodePool{}
	r := newRegistry(p, 10, 1)

	n1 := &builderNode{
		trans: []transition{
			{
				in:   'a',
				addr: 1,
			},
			{
				in:   'b',
				addr: 2,
			},
			{
				in:   'c',
				addr: 3,
			},
		},
	}

	// first look, doesn't exist
	found, _, cell := r.entry(n1)
	if found {
		t.Errorf("expected empty registry to not have equivalent")
	}

	cell.addr = 276

	// second look, does
	var nowAddr int
	found, nowAddr, _ = r.entry(n1)
	if !found {
		t.Errorf("expected to find equivalent after registering it")
	}
	if nowAddr != 276 {
		t.Errorf("expected to get addr 276, got %d", nowAddr)
	}
}
