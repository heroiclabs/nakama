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

package length

import (
	"fmt"
	"unicode/utf8"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

const Name = "length"

type LengthFilter struct {
	min int
	max int
}

func NewLengthFilter(min, max int) *LengthFilter {
	return &LengthFilter{
		min: min,
		max: max,
	}
}

func (f *LengthFilter) Filter(input analysis.TokenStream) analysis.TokenStream {
	rv := make(analysis.TokenStream, 0, len(input))

	for _, token := range input {
		wordLen := utf8.RuneCount(token.Term)
		if f.min > 0 && f.min > wordLen {
			continue
		}
		if f.max > 0 && f.max < wordLen {
			continue
		}
		rv = append(rv, token)
	}

	return rv
}

func LengthFilterConstructor(config map[string]interface{}, cache *registry.Cache) (analysis.TokenFilter, error) {
	min := 0
	max := 0

	minVal, ok := config["min"].(float64)
	if ok {
		min = int(minVal)
	}
	maxVal, ok := config["max"].(float64)
	if ok {
		max = int(maxVal)
	}
	if min == max && max == 0 {
		return nil, fmt.Errorf("either min or max must be non-zero")
	}

	return NewLengthFilter(min, max), nil
}

func init() {
	registry.RegisterTokenFilter(Name, LengthFilterConstructor)
}
