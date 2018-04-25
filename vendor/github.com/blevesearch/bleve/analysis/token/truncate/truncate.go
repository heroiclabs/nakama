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

package truncate

import (
	"fmt"
	"unicode/utf8"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

const Name = "truncate_token"

type TruncateTokenFilter struct {
	length int
}

func NewTruncateTokenFilter(length int) *TruncateTokenFilter {
	return &TruncateTokenFilter{
		length: length,
	}
}

func (s *TruncateTokenFilter) Filter(input analysis.TokenStream) analysis.TokenStream {
	for _, token := range input {
		wordLen := utf8.RuneCount(token.Term)
		if wordLen > s.length {
			token.Term = analysis.TruncateRunes(token.Term, wordLen-s.length)
		}
	}
	return input
}

func TruncateTokenFilterConstructor(config map[string]interface{}, cache *registry.Cache) (analysis.TokenFilter, error) {
	lenVal, ok := config["length"].(float64)
	if !ok {
		return nil, fmt.Errorf("must specify length")
	}
	length := int(lenVal)

	return NewTruncateTokenFilter(length), nil
}

func init() {
	registry.RegisterTokenFilter(Name, TruncateTokenFilterConstructor)
}
