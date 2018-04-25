//  Copyright (c) 2016 Couchbase, Inc.
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

package facet

import (
	"io/ioutil"
	"regexp"
	"testing"
)

var terms []string

func init() {
	wsRegexp := regexp.MustCompile(`\W+`)
	input, err := ioutil.ReadFile("benchmark_data.txt")
	if err != nil {
		panic(err)
	}
	terms = wsRegexp.Split(string(input), -1)
}

func BenchmarkTermsFacet10(b *testing.B) {
	termsFacetN(b, 10)
}

func BenchmarkTermsFacet100(b *testing.B) {
	termsFacetN(b, 100)
}

func BenchmarkTermsFacet1000(b *testing.B) {
	termsFacetN(b, 1000)
}

func BenchmarkTermsFacet10000(b *testing.B) {
	termsFacetN(b, 10000)
}

// func BenchmarkTermsFacet100000(b *testing.B) {
// 	termsFacetN(b, 100000)
// }

func termsFacetN(b *testing.B, numTerms int) {
	field := "test"
	termsLen := len(terms)
	tfb := NewTermsFacetBuilder(field, 3)
	i := 0
	for len(tfb.termsCount) < numTerms && i <= termsLen {
		j := i % termsLen
		term := terms[j]
		tfb.StartDoc()
		tfb.UpdateVisitor(field, []byte(term))
		tfb.EndDoc()
		i++
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tfb.Result()
	}
}
