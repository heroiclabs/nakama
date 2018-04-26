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

package keyword

import (
	"fmt"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

const Name = "keyword_marker"

type KeyWordMarkerFilter struct {
	keyWords analysis.TokenMap
}

func NewKeyWordMarkerFilter(keyWords analysis.TokenMap) *KeyWordMarkerFilter {
	return &KeyWordMarkerFilter{
		keyWords: keyWords,
	}
}

func (f *KeyWordMarkerFilter) Filter(input analysis.TokenStream) analysis.TokenStream {
	for _, token := range input {
		word := string(token.Term)
		_, isKeyWord := f.keyWords[word]
		if isKeyWord {
			token.KeyWord = true
		}
	}
	return input
}

func KeyWordMarkerFilterConstructor(config map[string]interface{}, cache *registry.Cache) (analysis.TokenFilter, error) {
	keywordsTokenMapName, ok := config["keywords_token_map"].(string)
	if !ok {
		return nil, fmt.Errorf("must specify keywords_token_map")
	}
	keywordsTokenMap, err := cache.TokenMapNamed(keywordsTokenMapName)
	if err != nil {
		return nil, fmt.Errorf("error building keyword marker filter: %v", err)
	}
	return NewKeyWordMarkerFilter(keywordsTokenMap), nil
}

func init() {
	registry.RegisterTokenFilter(Name, KeyWordMarkerFilterConstructor)
}
