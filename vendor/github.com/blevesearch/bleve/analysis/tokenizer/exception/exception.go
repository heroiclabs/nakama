//  Copyright (c) 2015 Couchbase, Inc.
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

// package exception implements a Tokenizer which extracts pieces matched by a
// regular expression from the input data, delegates the rest to another
// tokenizer, then insert back extracted parts in the token stream. Use it to
// preserve sequences which a regular tokenizer would alter or remove.
//
// Its constructor takes the following arguments:
//
// "exceptions" ([]string): one or more Go regular expressions matching the
// sequence to preserve. Multiple expressions are combined with "|".
//
// "tokenizer" (string): the name of the tokenizer processing the data not
// matched by "exceptions".
package exception

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

const Name = "exception"

type ExceptionsTokenizer struct {
	exception *regexp.Regexp
	remaining analysis.Tokenizer
}

func NewExceptionsTokenizer(exception *regexp.Regexp, remaining analysis.Tokenizer) *ExceptionsTokenizer {
	return &ExceptionsTokenizer{
		exception: exception,
		remaining: remaining,
	}
}

func (t *ExceptionsTokenizer) Tokenize(input []byte) analysis.TokenStream {
	rv := make(analysis.TokenStream, 0)
	matches := t.exception.FindAllIndex(input, -1)
	currInput := 0
	lastPos := 0
	for _, match := range matches {
		start := match[0]
		end := match[1]
		if start > currInput {
			// need to defer to remaining for unprocessed section
			intermediate := t.remaining.Tokenize(input[currInput:start])
			// add intermediate tokens to our result stream
			for _, token := range intermediate {
				// adjust token offsets
				token.Position += lastPos
				token.Start += currInput
				token.End += currInput
				rv = append(rv, token)
			}
			lastPos += len(intermediate)
			currInput = start
		}

		// create single token with this regexp match
		token := &analysis.Token{
			Term:     input[start:end],
			Start:    start,
			End:      end,
			Position: lastPos + 1,
		}
		rv = append(rv, token)
		lastPos++
		currInput = end

	}

	if currInput < len(input) {
		// need to defer to remaining for unprocessed section
		intermediate := t.remaining.Tokenize(input[currInput:])
		// add intermediate tokens to our result stream
		for _, token := range intermediate {
			// adjust token offsets
			token.Position += lastPos
			token.Start += currInput
			token.End += currInput
			rv = append(rv, token)
		}
	}

	return rv
}

func ExceptionsTokenizerConstructor(config map[string]interface{}, cache *registry.Cache) (analysis.Tokenizer, error) {
	exceptions := []string{}
	iexceptions, ok := config["exceptions"].([]interface{})
	if ok {
		for _, exception := range iexceptions {
			exception, ok := exception.(string)
			if ok {
				exceptions = append(exceptions, exception)
			}
		}
	}
	aexceptions, ok := config["exceptions"].([]string)
	if ok {
		exceptions = append(exceptions, aexceptions...)
	}
	if len(exceptions) == 0 {
		return nil, fmt.Errorf("no pattern found in 'exception' property")
	}
	exceptionPattern := strings.Join(exceptions, "|")
	r, err := regexp.Compile(exceptionPattern)
	if err != nil {
		return nil, fmt.Errorf("unable to build regexp tokenizer: %v", err)
	}

	remainingName, ok := config["tokenizer"].(string)
	if !ok {
		return nil, fmt.Errorf("must specify tokenizer for remaining input")
	}
	remaining, err := cache.TokenizerNamed(remainingName)
	if err != nil {
		return nil, err
	}
	return NewExceptionsTokenizer(r, remaining), nil
}

func init() {
	registry.RegisterTokenizer(Name, ExceptionsTokenizerConstructor)
}
