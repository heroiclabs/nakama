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

package regexp

import (
	"reflect"
	"regexp"
	"testing"
)

func TestRegexpCharFilter(t *testing.T) {

	htmlTagPattern := `</?[!\w]+((\s+\w+(\s*=\s*(?:".*?"|'.*?'|[^'">\s]+))?)+\s*|\s*)/?>`
	htmlRegex := regexp.MustCompile(htmlTagPattern)

	tests := []struct {
		input  []byte
		output []byte
	}{
		{
			input:  []byte(`<html>test</html>`),
			output: []byte(`      test       `),
		},
	}

	for _, test := range tests {
		filter := New(htmlRegex, []byte{' '})
		output := filter.Filter(test.input)
		if !reflect.DeepEqual(output, test.output) {
			t.Errorf("Expected:\n`%s`\ngot:\n`%s`\nfor:\n`%s`\n", string(test.output), string(output), string(test.input))
		}
	}
}

func TestZeroWidthNonJoinerCharFilter(t *testing.T) {

	zeroWidthNonJoinerPattern := `\x{200C}`
	zeroWidthNonJoinerRegex := regexp.MustCompile(zeroWidthNonJoinerPattern)

	tests := []struct {
		input  []byte
		output []byte
	}{
		{
			input:  []byte("water\u200Cunder\u200Cthe\u200Cbridge"),
			output: []byte("water   under   the   bridge"),
		},
	}

	for _, test := range tests {
		filter := New(zeroWidthNonJoinerRegex, []byte{' '})
		output := filter.Filter(test.input)
		if !reflect.DeepEqual(output, test.output) {
			t.Errorf("Expected:\n`%s`\ngot:\n`%s`\nfor:\n`%s`\n", string(test.output), string(output), string(test.input))
		}
	}
}
