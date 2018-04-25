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
	"fmt"
	"regexp"
	"strconv"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

const Name = "regexp"

var IdeographRegexp = regexp.MustCompile(`\p{Han}|\p{Hangul}|\p{Hiragana}|\p{Katakana}`)

type RegexpTokenizer struct {
	r *regexp.Regexp
}

func NewRegexpTokenizer(r *regexp.Regexp) *RegexpTokenizer {
	return &RegexpTokenizer{
		r: r,
	}
}

func (rt *RegexpTokenizer) Tokenize(input []byte) analysis.TokenStream {
	matches := rt.r.FindAllIndex(input, -1)
	rv := make(analysis.TokenStream, 0, len(matches))
	for i, match := range matches {
		matchBytes := input[match[0]:match[1]]
		if match[1]-match[0] > 0 {
			token := analysis.Token{
				Term:     matchBytes,
				Start:    match[0],
				End:      match[1],
				Position: i + 1,
				Type:     detectTokenType(matchBytes),
			}
			rv = append(rv, &token)
		}
	}
	return rv
}

func RegexpTokenizerConstructor(config map[string]interface{}, cache *registry.Cache) (analysis.Tokenizer, error) {
	rval, ok := config["regexp"].(string)
	if !ok {
		return nil, fmt.Errorf("must specify regexp")
	}
	r, err := regexp.Compile(rval)
	if err != nil {
		return nil, fmt.Errorf("unable to build regexp tokenizer: %v", err)
	}
	return NewRegexpTokenizer(r), nil
}

func init() {
	registry.RegisterTokenizer(Name, RegexpTokenizerConstructor)
}

func detectTokenType(termBytes []byte) analysis.TokenType {
	if IdeographRegexp.Match(termBytes) {
		return analysis.Ideographic
	}
	_, err := strconv.ParseFloat(string(termBytes), 64)
	if err == nil {
		return analysis.Numeric
	}
	return analysis.AlphaNumeric
}
