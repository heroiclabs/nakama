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

import (
	"reflect"
	"regexp/syntax"
	"testing"
)

func TestCompiler(t *testing.T) {

	tests := []struct {
		query     string
		wantInsts prog
		wantErr   error
	}{
		{
			query: "",
			wantInsts: []*inst{
				&inst{op: OpMatch},
			},
			wantErr: nil,
		},
		{
			query:   "^",
			wantErr: ErrNoEmpty,
		},
		{
			query:   `\b`,
			wantErr: ErrNoWordBoundary,
		},
		{
			query:   `.*?`,
			wantErr: ErrNoLazy,
		},
		{
			query: `a`,
			wantInsts: []*inst{
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpMatch},
			},
		},
		{
			query: `[a-c]`,
			wantInsts: []*inst{
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'c'},
				&inst{op: OpMatch},
			},
		},
		{
			query: `(a)`,
			wantInsts: []*inst{
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpMatch},
			},
		},
		{
			query: `a?`,
			wantInsts: []*inst{
				&inst{op: OpSplit, splitA: 1, splitB: 2},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpMatch},
			},
		},
		{
			query: `a*`,
			wantInsts: []*inst{
				&inst{op: OpSplit, splitA: 1, splitB: 3},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpJmp, to: 0},
				&inst{op: OpMatch},
			},
		},
		{
			query: `a+`,
			wantInsts: []*inst{
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpSplit, splitA: 0, splitB: 2},
				&inst{op: OpMatch},
			},
		},
		{
			query: `a{2,4}`,
			wantInsts: []*inst{
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpSplit, splitA: 3, splitB: 6},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpSplit, splitA: 5, splitB: 6},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpMatch},
			},
		},
		{
			query: `a{3,}`,
			wantInsts: []*inst{
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpSplit, splitA: 4, splitB: 6},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpJmp, to: 3},
				&inst{op: OpMatch},
			},
		},
		{
			query: `a+|b+`,
			wantInsts: []*inst{
				&inst{op: OpSplit, splitA: 1, splitB: 4},
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpSplit, splitA: 1, splitB: 3},
				&inst{op: OpJmp, to: 6},
				&inst{op: OpRange, rangeStart: 'b', rangeEnd: 'b'},
				&inst{op: OpSplit, splitA: 4, splitB: 6},
				&inst{op: OpMatch},
			},
		},
		{
			query: `a+b+`,
			wantInsts: []*inst{
				&inst{op: OpRange, rangeStart: 'a', rangeEnd: 'a'},
				&inst{op: OpSplit, splitA: 0, splitB: 2},
				&inst{op: OpRange, rangeStart: 'b', rangeEnd: 'b'},
				&inst{op: OpSplit, splitA: 2, splitB: 4},
				&inst{op: OpMatch},
			},
		},
		{
			query: `.`,
			wantInsts: []*inst{
				&inst{op: OpSplit, splitA: 1, splitB: 3},
				&inst{op: OpRange, rangeStart: 0, rangeEnd: 0x09},
				&inst{op: OpJmp, to: 46}, // match ascii, less than 0x0a
				&inst{op: OpSplit, splitA: 4, splitB: 6},
				&inst{op: OpRange, rangeStart: 0x0b, rangeEnd: 0x7f},
				&inst{op: OpJmp, to: 46}, // match rest ascii
				&inst{op: OpSplit, splitA: 7, splitB: 10},
				&inst{op: OpRange, rangeStart: 0xc2, rangeEnd: 0xdf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpJmp, to: 46}, // match
				&inst{op: OpSplit, splitA: 11, splitB: 15},
				&inst{op: OpRange, rangeStart: 0xe0, rangeEnd: 0xe0},
				&inst{op: OpRange, rangeStart: 0xa0, rangeEnd: 0xbf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpJmp, to: 46}, // match
				&inst{op: OpSplit, splitA: 16, splitB: 20},
				&inst{op: OpRange, rangeStart: 0xe1, rangeEnd: 0xec},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpJmp, to: 46}, // match
				&inst{op: OpSplit, splitA: 21, splitB: 25},
				&inst{op: OpRange, rangeStart: 0xed, rangeEnd: 0xed},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0x9f},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpJmp, to: 46}, // match
				&inst{op: OpSplit, splitA: 26, splitB: 30},
				&inst{op: OpRange, rangeStart: 0xee, rangeEnd: 0xef},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpJmp, to: 46}, // match
				&inst{op: OpSplit, splitA: 31, splitB: 36},
				&inst{op: OpRange, rangeStart: 0xf0, rangeEnd: 0xf0},
				&inst{op: OpRange, rangeStart: 0x90, rangeEnd: 0xbf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpJmp, to: 46}, // match
				&inst{op: OpSplit, splitA: 37, splitB: 42},
				&inst{op: OpRange, rangeStart: 0xf1, rangeEnd: 0xf3},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpJmp, to: 46}, // match
				&inst{op: OpRange, rangeStart: 0xf4, rangeEnd: 0xf4},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0x8f},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpRange, rangeStart: 0x80, rangeEnd: 0xbf},
				&inst{op: OpMatch},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.query, func(t *testing.T) {
			p, err := syntax.Parse(test.query, syntax.Perl)
			if err != nil {
				t.Fatalf("error parsing regexp: %v", err)
			}
			c := newCompiler(10000)
			gotInsts, gotErr := c.compile(p)
			if !reflect.DeepEqual(test.wantErr, gotErr) {
				t.Errorf("expected error: %v, got error: %v", test.wantErr, gotErr)
			}
			if !reflect.DeepEqual(test.wantInsts, gotInsts) {
				t.Errorf("expected insts: %v, got insts:%v", test.wantInsts, gotInsts)
			}
		})
	}
}
