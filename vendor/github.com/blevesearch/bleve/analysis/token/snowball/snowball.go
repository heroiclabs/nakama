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

package snowball

import (
	"fmt"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"

	"github.com/kljensen/snowball"
)

const Name = "stemmer_snowball"

type SnowballStemmer struct {
	language string
}

func NewSnowballStemmer(language string) *SnowballStemmer {
	return &SnowballStemmer{
		language: language,
	}
}

func (s *SnowballStemmer) Filter(input analysis.TokenStream) analysis.TokenStream {
	for _, token := range input {
		// if it is not a protected keyword, stem it
		if !token.KeyWord {
			stemmed, _ := snowball.Stem(string(token.Term), s.language, true)
			token.Term = []byte(stemmed)
		}
	}
	return input
}

func SnowballStemmerConstructor(config map[string]interface{}, cache *registry.Cache) (analysis.TokenFilter, error) {
	language, ok := config["language"].(string)
	if !ok {
		return nil, fmt.Errorf("must specify language")
	}
	return NewSnowballStemmer(language), nil
}

func init() {
	registry.RegisterTokenFilter(Name, SnowballStemmerConstructor)
}
