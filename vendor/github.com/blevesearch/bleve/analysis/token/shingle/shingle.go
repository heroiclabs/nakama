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

package shingle

import (
	"container/ring"
	"fmt"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

const Name = "shingle"

type ShingleFilter struct {
	min            int
	max            int
	outputOriginal bool
	tokenSeparator string
	fill           string
}

func NewShingleFilter(min, max int, outputOriginal bool, sep, fill string) *ShingleFilter {
	return &ShingleFilter{
		min:            min,
		max:            max,
		outputOriginal: outputOriginal,
		tokenSeparator: sep,
		fill:           fill,
	}
}

func (s *ShingleFilter) Filter(input analysis.TokenStream) analysis.TokenStream {
	rv := make(analysis.TokenStream, 0, len(input))

	ring := ring.New(s.max)
	itemsInRing := 0
	currentPosition := 0
	for _, token := range input {
		if s.outputOriginal {
			rv = append(rv, token)
		}

		// if there are gaps, insert filler tokens
		offset := token.Position - currentPosition
		for offset > 1 {
			fillerToken := analysis.Token{
				Position: 0,
				Start:    -1,
				End:      -1,
				Type:     analysis.AlphaNumeric,
				Term:     []byte(s.fill),
			}
			ring.Value = &fillerToken
			if itemsInRing < s.max {
				itemsInRing++
			}
			rv = append(rv, s.shingleCurrentRingState(ring, itemsInRing)...)
			ring = ring.Next()
			offset--
		}
		currentPosition = token.Position

		ring.Value = token
		if itemsInRing < s.max {
			itemsInRing++
		}
		rv = append(rv, s.shingleCurrentRingState(ring, itemsInRing)...)
		ring = ring.Next()
	}

	return rv
}

func (s *ShingleFilter) shingleCurrentRingState(ring *ring.Ring, itemsInRing int) analysis.TokenStream {
	rv := make(analysis.TokenStream, 0)
	for shingleN := s.min; shingleN <= s.max; shingleN++ {
		// if there are enough items in the ring
		// to produce a shingle of this size
		if itemsInRing >= shingleN {
			thisShingleRing := ring.Move(-(shingleN - 1))
			shingledBytes := make([]byte, 0)
			pos := 0
			start := -1
			end := 0
			for i := 0; i < shingleN; i++ {
				if i != 0 {
					shingledBytes = append(shingledBytes, []byte(s.tokenSeparator)...)
				}
				curr := thisShingleRing.Value.(*analysis.Token)
				if pos == 0 && curr.Position != 0 {
					pos = curr.Position
				}
				if start == -1 && curr.Start != -1 {
					start = curr.Start
				}
				if curr.End != -1 {
					end = curr.End
				}
				shingledBytes = append(shingledBytes, curr.Term...)
				thisShingleRing = thisShingleRing.Next()
			}
			token := analysis.Token{
				Type: analysis.Shingle,
				Term: shingledBytes,
			}
			if pos != 0 {
				token.Position = pos
			}
			if start != -1 {
				token.Start = start
			}
			if end != -1 {
				token.End = end
			}
			rv = append(rv, &token)
		}
	}
	return rv
}

func ShingleFilterConstructor(config map[string]interface{}, cache *registry.Cache) (analysis.TokenFilter, error) {
	minVal, ok := config["min"].(float64)
	if !ok {
		return nil, fmt.Errorf("must specify min")
	}
	min := int(minVal)
	maxVal, ok := config["max"].(float64)
	if !ok {
		return nil, fmt.Errorf("must specify max")
	}
	max := int(maxVal)

	outputOriginal := false
	outVal, ok := config["output_original"].(bool)
	if ok {
		outputOriginal = outVal
	}

	sep := " "
	sepVal, ok := config["separator"].(string)
	if ok {
		sep = sepVal
	}

	fill := "_"
	fillVal, ok := config["filler"].(string)
	if ok {
		fill = fillVal
	}

	return NewShingleFilter(min, max, outputOriginal, sep, fill), nil
}

func init() {
	registry.RegisterTokenFilter(Name, ShingleFilterConstructor)
}
