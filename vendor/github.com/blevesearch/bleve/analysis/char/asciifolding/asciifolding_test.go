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

package asciifolding

import (
	"reflect"
	"testing"
)

func TestAsciiFoldingFilter(t *testing.T) {

	tests := []struct {
		input  []byte
		output []byte
	}{
		{
			// empty input passes
			input:  []byte(``),
			output: []byte(``),
		},
		{
			// no modification for plain ASCII
			input:  []byte(`The quick brown fox jumps over the lazy dog`),
			output: []byte(`The quick brown fox jumps over the lazy dog`),
		},
		{
			// Umlauts are folded to plain ASCII
			input:  []byte(`The quick bröwn fox jümps over the läzy dog`),
			output: []byte(`The quick brown fox jumps over the lazy dog`),
		}, {
			// composite unicode runes are folded to more than one ASCII rune
			input:  []byte(`ÆꜴ`),
			output: []byte(`AEAO`),
		},
	}

	for _, test := range tests {
		filter := New()
		output := filter.Filter(test.input)
		if !reflect.DeepEqual(output, test.output) {
			t.Errorf("Expected:\n`%s`\ngot:\n`%s`\nfor:\n`%s`\n", string(test.output), string(output), string(test.input))
		}
	}
}
