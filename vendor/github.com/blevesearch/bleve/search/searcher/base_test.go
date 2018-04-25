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

package searcher

import (
	"math"
	"regexp"

	"github.com/blevesearch/bleve/analysis"
	regexpTokenizer "github.com/blevesearch/bleve/analysis/tokenizer/regexp"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/index/store/gtreap"
	"github.com/blevesearch/bleve/index/upsidedown"
)

var twoDocIndex index.Index //= upside_down.NewUpsideDownCouch(inmem.MustOpen())

func init() {
	analysisQueue := index.NewAnalysisQueue(1)
	var err error
	twoDocIndex, err = upsidedown.NewUpsideDownCouch(
		gtreap.Name,
		map[string]interface{}{
			"path": "",
		}, analysisQueue)
	if err != nil {
		panic(err)
	}
	err = twoDocIndex.Open()
	if err != nil {
		panic(err)
	}
	for _, doc := range twoDocIndexDocs {
		err := twoDocIndex.Update(doc)
		if err != nil {
			panic(err)
		}
	}
}

// create a simpler analyzer which will support these tests
var testAnalyzer = &analysis.Analyzer{
	Tokenizer: regexpTokenizer.NewRegexpTokenizer(regexp.MustCompile(`\w+`)),
}

// sets up some mock data used in many tests in this package
var twoDocIndexDescIndexingOptions = document.DefaultTextIndexingOptions | document.IncludeTermVectors

var twoDocIndexDocs = []*document.Document{
	// must have 4/4 beer
	document.NewDocument("1").
		AddField(document.NewTextField("name", []uint64{}, []byte("marty"))).
		AddField(document.NewTextFieldCustom("desc", []uint64{}, []byte("beer beer beer beer"), twoDocIndexDescIndexingOptions, testAnalyzer)).
		AddField(document.NewTextFieldWithAnalyzer("street", []uint64{}, []byte("couchbase way"), testAnalyzer)),
	// must have 1/4 beer
	document.NewDocument("2").
		AddField(document.NewTextField("name", []uint64{}, []byte("steve"))).
		AddField(document.NewTextFieldCustom("desc", []uint64{}, []byte("angst beer couch database"), twoDocIndexDescIndexingOptions, testAnalyzer)).
		AddField(document.NewTextFieldWithAnalyzer("street", []uint64{}, []byte("couchbase way"), testAnalyzer)).
		AddField(document.NewTextFieldWithAnalyzer("title", []uint64{}, []byte("mister"), testAnalyzer)),
	// must have 1/4 beer
	document.NewDocument("3").
		AddField(document.NewTextField("name", []uint64{}, []byte("dustin"))).
		AddField(document.NewTextFieldCustom("desc", []uint64{}, []byte("apple beer column dank"), twoDocIndexDescIndexingOptions, testAnalyzer)).
		AddField(document.NewTextFieldWithAnalyzer("title", []uint64{}, []byte("mister"), testAnalyzer)),
	// must have 65/65 beer
	document.NewDocument("4").
		AddField(document.NewTextField("name", []uint64{}, []byte("ravi"))).
		AddField(document.NewTextFieldCustom("desc", []uint64{}, []byte("beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer beer"), twoDocIndexDescIndexingOptions, testAnalyzer)),
	// must have 0/x beer
	document.NewDocument("5").
		AddField(document.NewTextField("name", []uint64{}, []byte("bobert"))).
		AddField(document.NewTextFieldCustom("desc", []uint64{}, []byte("water"), twoDocIndexDescIndexingOptions, testAnalyzer)).
		AddField(document.NewTextFieldWithAnalyzer("title", []uint64{}, []byte("mister"), testAnalyzer)),
}

func scoresCloseEnough(a, b float64) bool {
	return math.Abs(a-b) < 0.001
}
