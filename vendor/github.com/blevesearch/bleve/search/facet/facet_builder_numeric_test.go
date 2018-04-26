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
	"strconv"
	"testing"

	"github.com/blevesearch/bleve/numeric"
)

var pcodedvalues []numeric.PrefixCoded

func init() {
	pcodedvalues = []numeric.PrefixCoded{{0x20, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x1}, {0x20, 0x0, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f}, {0x20, 0x0, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7a, 0x1d, 0xa}, {0x20, 0x1, 0x0, 0x0, 0x0, 0x0, 0x1, 0x16, 0x9, 0x4a, 0x7b}}
}

func BenchmarkNumericFacet10(b *testing.B) {
	numericFacetN(b, 10)
}

func BenchmarkNumericFacet100(b *testing.B) {
	numericFacetN(b, 100)
}

func BenchmarkNumericFacet1000(b *testing.B) {
	numericFacetN(b, 1000)
}

func numericFacetN(b *testing.B, numTerms int) {
	field := "test"
	nfb := NewNumericFacetBuilder(field, numTerms)
	min, max := 0.0, 9999999998.0

	for i := 0; i <= numTerms; i++ {
		max++
		min--

		nfb.AddRange("rangename"+strconv.Itoa(i), &min, &max)

		for _, pv := range pcodedvalues {
			nfb.StartDoc()
			nfb.UpdateVisitor(field, pv)
			nfb.EndDoc()
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		nfb.Result()
	}
}
