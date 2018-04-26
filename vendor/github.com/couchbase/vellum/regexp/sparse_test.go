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

package regexp

import "testing"

func TestSparse(t *testing.T) {

	s := newSparseSet(10)
	if s.Contains(0) {
		t.Errorf("expected not to contain 0")
	}

	s.Add(3)
	if !s.Contains(3) {
		t.Errorf("expected to contains 3, did not")
	}

	if s.Len() != 1 {
		t.Errorf("expected len 1, got %d", s.Len())
	}

	if s.Get(0) != 3 {
		t.Errorf("expected 10, got %d", s.Get(0))
	}

	s.Clear()

	if s.Len() != 0 {
		t.Errorf("expected len 0, got %d", s.Len())
	}
}
