//  Copyright (c) 2018 Couchbase, Inc.
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

package segment

import (
	"regexp/syntax"
	"testing"
)

func TestLiteralPrefix(t *testing.T) {
	tests := []struct {
		input, expected string
	}{
		{"", ""},
		{"hello", "hello"},
		{"hello.?", "hello"},
		{"hello$", "hello"},
		{`[h][e][l][l][o].*world`, "hello"},
		{`[h-h][e-e][l-l][l-l][o-o].*world`, "hello"},
		{".*", ""},
		{"h.*", "h"},
		{"h.?", "h"},
		{"h[a-z]", "h"},
		{`h\s`, "h"},
		{`(hello)world`, ""},
		{`日本語`, "日本語"},
		{`日本語\w`, "日本語"},
		{`^hello`, ""},
		{`^`, ""},
		{`$`, ""},
	}

	for i, test := range tests {
		s, err := syntax.Parse(test.input, syntax.Perl)
		if err != nil {
			t.Fatalf("expected no syntax.Parse error, got: %v", err)
		}

		got := LiteralPrefix(s)
		if test.expected != got {
			t.Fatalf("test: %d, %+v, got: %s", i, test, got)
		}
	}
}
