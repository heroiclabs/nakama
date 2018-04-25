//  Copyright (c) 2013 Couchbase, Inc.
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

package search

import "testing"

func TestDocumentMatchPool(t *testing.T) {

	tooManyCalled := false

	// create a pool
	dmp := NewDocumentMatchPool(10, 0)
	dmp.TooSmall = func(inner *DocumentMatchPool) *DocumentMatch {
		tooManyCalled = true
		return &DocumentMatch{}
	}

	// get 10 instances without returning
	returned := make(DocumentMatchCollection, 10)

	for i := 0; i < 10; i++ {
		returned[i] = dmp.Get()
		if tooManyCalled {
			t.Fatal("too many function called before expected")
		}
	}

	// get one more and see if too many function is called
	extra := dmp.Get()
	if !tooManyCalled {
		t.Fatal("expected too many function to be called, but wasn't")
	}

	// return the first 10
	for i := 0; i < 10; i++ {
		dmp.Put(returned[i])
	}

	// check len and cap
	if len(dmp.avail) != 10 {
		t.Fatalf("expected 10 available, got %d", len(dmp.avail))
	}
	if cap(dmp.avail) != 10 {
		t.Fatalf("expected avail cap still 10, got %d", cap(dmp.avail))
	}

	// return the extra
	dmp.Put(extra)

	// check len and cap grown to 11
	if len(dmp.avail) != 11 {
		t.Fatalf("expected 11 available, got %d", len(dmp.avail))
	}
	// cap grows, but not by 1 (append behavior)
	if cap(dmp.avail) <= 10 {
		t.Fatalf("expected avail cap mpore than 10, got %d", cap(dmp.avail))
	}
}
