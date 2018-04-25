//  Copyright (c) 2014 Couchbase, Inc.
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

package document

import (
	"testing"
)

func TestDocumentNumPlainTextBytes(t *testing.T) {

	tests := []struct {
		doc *Document
		num uint64
	}{
		{
			doc: NewDocument("a"),
			num: 0,
		},
		{
			doc: NewDocument("b").
				AddField(NewTextField("name", nil, []byte("hello"))),
			num: 5,
		},
		{
			doc: NewDocument("c").
				AddField(NewTextField("name", nil, []byte("hello"))).
				AddField(NewTextField("desc", nil, []byte("x"))),
			num: 6,
		},
		{
			doc: NewDocument("d").
				AddField(NewTextField("name", nil, []byte("hello"))).
				AddField(NewTextField("desc", nil, []byte("x"))).
				AddField(NewNumericField("age", nil, 1.0)),
			num: 14,
		},
		{
			doc: NewDocument("e").
				AddField(NewTextField("name", nil, []byte("hello"))).
				AddField(NewTextField("desc", nil, []byte("x"))).
				AddField(NewNumericField("age", nil, 1.0)).
				AddField(NewCompositeField("_all", true, nil, nil)),
			num: 28,
		},
		{
			doc: NewDocument("e").
				AddField(NewTextField("name", nil, []byte("hello"))).
				AddField(NewTextField("desc", nil, []byte("x"))).
				AddField(NewNumericField("age", nil, 1.0)).
				AddField(NewCompositeField("_all", true, nil, []string{"age"})),
			num: 20,
		},
	}

	for _, test := range tests {
		actual := test.doc.NumPlainTextBytes()
		if actual != test.num {
			t.Errorf("expected doc '%s' to have %d plain text bytes, got %d", test.doc.ID, test.num, actual)
		}
	}
}
