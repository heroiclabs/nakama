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

package query

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/blevesearch/bleve/mapping"
)

func TestQuerySyntaxParserValid(t *testing.T) {
	thirtyThreePointOh := 33.0
	twoPointOh := 2.0
	fivePointOh := 5.0
	minusFivePointOh := -5.0
	theTruth := true
	theFalsehood := false
	theDate, err := time.Parse(time.RFC3339, "2006-01-02T15:04:05Z")
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		input   string
		result  Query
		mapping mapping.IndexMapping
	}{
		{
			input:   "test",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery("test"),
				},
				nil),
		},
		{
			input:   `"test phrase 1"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchPhraseQuery("test phrase 1"),
				},
				nil),
		},
		{
			input:   "field:test",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("test")
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		// - is allowed inside a term, just not the start
		{
			input:   "field:t-est",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("t-est")
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		// + is allowed inside a term, just not the start
		{
			input:   "field:t+est",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("t+est")
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		// > is allowed inside a term, just not the start
		{
			input:   "field:t>est",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("t>est")
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		// < is allowed inside a term, just not the start
		{
			input:   "field:t<est",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("t<est")
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		// = is allowed inside a term, just not the start
		{
			input:   "field:t=est",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("t=est")
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   "+field1:test1",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				[]Query{
					func() Query {
						q := NewMatchQuery("test1")
						q.SetField("field1")
						return q
					}(),
				},
				nil,
				nil),
		},
		{
			input:   "-field2:test2",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("test2")
						q.SetField("field2")
						return q
					}(),
				}),
		},
		{
			input:   `field3:"test phrase 2"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchPhraseQuery("test phrase 2")
						q.SetField("field3")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `+field4:"test phrase 1"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				[]Query{
					func() Query {
						q := NewMatchPhraseQuery("test phrase 1")
						q.SetField("field4")
						return q
					}(),
				},
				nil,
				nil),
		},
		{
			input:   `-field5:"test phrase 2"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				nil,
				[]Query{
					func() Query {
						q := NewMatchPhraseQuery("test phrase 2")
						q.SetField("field5")
						return q
					}(),
				}),
		},
		{
			input:   `+field6:test3 -field7:test4 field8:test5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				[]Query{
					func() Query {
						q := NewMatchQuery("test3")
						q.SetField("field6")
						return q
					}(),
				},
				[]Query{
					func() Query {
						q := NewMatchQuery("test5")
						q.SetField("field8")
						return q
					}(),
				},
				[]Query{
					func() Query {
						q := NewMatchQuery("test4")
						q.SetField("field7")
						return q
					}(),
				}),
		},
		{
			input:   "test^3",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("test")
						q.SetBoost(3.0)
						return q
					}(),
				},
				nil),
		},
		{
			input:   "test^3 other^6",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("test")
						q.SetBoost(3.0)
						return q
					}(),
					func() Query {
						q := NewMatchQuery("other")
						q.SetBoost(6.0)
						return q
					}(),
				},
				nil),
		},
		{
			input:   "33",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						qo := NewDisjunctionQuery(
							[]Query{
								NewMatchQuery("33"),
								NewNumericRangeInclusiveQuery(&thirtyThreePointOh, &thirtyThreePointOh, &theTruth, &theTruth),
							})
						qo.queryStringMode = true
						return qo
					}(),
				},
				nil),
		},
		{
			input:   "field:33",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						qo := NewDisjunctionQuery(
							[]Query{
								func() Query {
									q := NewMatchQuery("33")
									q.SetField("field")
									return q
								}(),
								func() Query {
									q := NewNumericRangeInclusiveQuery(&thirtyThreePointOh, &thirtyThreePointOh, &theTruth, &theTruth)
									q.SetField("field")
									return q
								}(),
							})
						qo.queryStringMode = true
						return qo
					}(),
				},
				nil),
		},
		{
			input:   "cat-dog",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery("cat-dog"),
				},
				nil),
		},
		{
			input:   "watex~",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("watex")
						q.SetFuzziness(1)
						return q
					}(),
				},
				nil),
		},
		{
			input:   "watex~2",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("watex")
						q.SetFuzziness(2)
						return q
					}(),
				},
				nil),
		},
		{
			input:   "watex~ 2",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("watex")
						q.SetFuzziness(1)
						return q
					}(),
					func() Query {
						qo := NewDisjunctionQuery(
							[]Query{
								NewMatchQuery("2"),
								NewNumericRangeInclusiveQuery(&twoPointOh, &twoPointOh, &theTruth, &theTruth),
							})
						qo.queryStringMode = true
						return qo
					}(),
				},
				nil),
		},
		{
			input:   "field:watex~",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("watex")
						q.SetFuzziness(1)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   "field:watex~2",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("watex")
						q.SetFuzziness(2)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:555c3bb06f7a127cda000005`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("555c3bb06f7a127cda000005")
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:>5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewNumericRangeInclusiveQuery(&fivePointOh, nil, &theFalsehood, nil)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:>=5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewNumericRangeInclusiveQuery(&fivePointOh, nil, &theTruth, nil)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:<5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewNumericRangeInclusiveQuery(nil, &fivePointOh, nil, &theFalsehood)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:<=5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewNumericRangeInclusiveQuery(nil, &fivePointOh, nil, &theTruth)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		// new range tests with negative number
		{
			input:   "field:-5",
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						qo := NewDisjunctionQuery(
							[]Query{
								func() Query {
									q := NewMatchQuery("-5")
									q.SetField("field")
									return q
								}(),
								func() Query {
									q := NewNumericRangeInclusiveQuery(&minusFivePointOh, &minusFivePointOh, &theTruth, &theTruth)
									q.SetField("field")
									return q
								}(),
							})
						qo.queryStringMode = true
						return qo
					}(),
				},
				nil),
		},
		{
			input:   `field:>-5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewNumericRangeInclusiveQuery(&minusFivePointOh, nil, &theFalsehood, nil)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:>=-5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewNumericRangeInclusiveQuery(&minusFivePointOh, nil, &theTruth, nil)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:<-5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewNumericRangeInclusiveQuery(nil, &minusFivePointOh, nil, &theFalsehood)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:<=-5`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewNumericRangeInclusiveQuery(nil, &minusFivePointOh, nil, &theTruth)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:>"2006-01-02T15:04:05Z"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewDateRangeInclusiveQuery(theDate, time.Time{}, &theFalsehood, nil)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:>="2006-01-02T15:04:05Z"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewDateRangeInclusiveQuery(theDate, time.Time{}, &theTruth, nil)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:<"2006-01-02T15:04:05Z"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewDateRangeInclusiveQuery(time.Time{}, theDate, nil, &theFalsehood)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `field:<="2006-01-02T15:04:05Z"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewDateRangeInclusiveQuery(time.Time{}, theDate, nil, &theTruth)
						q.SetField("field")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `/mar.*ty/`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewRegexpQuery("mar.*ty"),
				},
				nil),
		},
		{
			input:   `name:/mar.*ty/`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewRegexpQuery("mar.*ty")
						q.SetField("name")
						return q
					}(),
				},
				nil),
		},
		{
			input:   `mart*`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewWildcardQuery("mart*"),
				},
				nil),
		},
		{
			input:   `name:mart*`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewWildcardQuery("mart*")
						q.SetField("name")
						return q
					}(),
				},
				nil),
		},

		// tests for escaping

		// escape : as field delimeter
		{
			input:   `name\:marty`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery("name:marty"),
				},
				nil),
		},
		// first colon delimiter, second escaped
		{
			input:   `name:marty\:couchbase`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery("marty:couchbase")
						q.SetField("name")
						return q
					}(),
				},
				nil),
		},
		// escape space, single arguemnt to match query
		{
			input:   `marty\ couchbase`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery("marty couchbase"),
				},
				nil),
		},
		// escape leading plus, not a must clause
		{
			input:   `\+marty`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery("+marty"),
				},
				nil),
		},
		// escape leading minus, not a must not clause
		{
			input:   `\-marty`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery("-marty"),
				},
				nil),
		},
		// escape quote inside of phrase
		{
			input:   `"what does \"quote\" mean"`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchPhraseQuery(`what does "quote" mean`),
				},
				nil),
		},
		// escaping an unsupported character retains backslash
		{
			input:   `can\ i\ escap\e`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery(`can i escap\e`),
				},
				nil),
		},
		// leading spaces
		{
			input:   `   what`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery(`what`),
				},
				nil),
		},
		// no boost value defaults to 1
		{
			input:   `term^`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					func() Query {
						q := NewMatchQuery(`term`)
						q.SetBoost(1.0)
						return q
					}(),
				},
				nil),
		},
		// weird lexer cases, something that starts like a number
		// but contains escape and ends up as string
		{
			input:   `3.0\:`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery(`3.0:`),
				},
				nil),
		},
		{
			input:   `3.0\a`,
			mapping: mapping.NewIndexMapping(),
			result: NewBooleanQueryForQueryString(
				nil,
				[]Query{
					NewMatchQuery(`3.0\a`),
				},
				nil),
		},
	}

	// turn on lexer debugging
	// debugLexer = true
	// debugParser = true
	// logger = log.New(os.Stderr, "bleve ", log.LstdFlags)

	for _, test := range tests {

		q, err := parseQuerySyntax(test.input)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(q, test.result) {
			t.Errorf("Expected %#v, got %#v: for %s", test.result, q, test.input)
		}
	}
}

func TestQuerySyntaxParserInvalid(t *testing.T) {
	tests := []struct {
		input string
	}{
		{"^"},
		{"^5"},
		{"field:-text"},
		{"field:+text"},
		{"field:>text"},
		{"field:>=text"},
		{"field:<text"},
		{"field:<=text"},
		{"field:~text"},
		{"field:^text"},
		{"field::text"},
		{`"this is the time`},
		{`cat^3\:`},
		{`cat^3\0`},
		{`cat~3\:`},
		{`cat~3\0`},
		{`99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999`},
		{`field:99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999`},
		{`field:>99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999`},
		{`field:>=99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999`},
		{`field:<99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999`},
		{`field:<=99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999`},
	}

	// turn on lexer debugging
	// debugLexer = true
	// logger = log.New(os.Stderr, "bleve", log.LstdFlags)

	for _, test := range tests {
		_, err := parseQuerySyntax(test.input)
		if err == nil {
			t.Errorf("expected error, got nil for `%s`", test.input)
		}
	}
}

func BenchmarkLexer(b *testing.B) {

	for n := 0; n < b.N; n++ {
		var tokenTypes []int
		var tokens []yySymType
		r := strings.NewReader(`+field4:"test phrase 1"`)
		l := newQueryStringLex(r)
		var lval yySymType
		rv := l.Lex(&lval)
		for rv > 0 {
			tokenTypes = append(tokenTypes, rv)
			tokens = append(tokens, lval)
			lval.s = ""
			lval.n = 0
			rv = l.Lex(&lval)
		}
	}

}
