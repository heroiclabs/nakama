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

package collector

import (
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/search"
)

type stubSearcher struct {
	index   int
	matches []*search.DocumentMatch
}

func (ss *stubSearcher) Next(ctx *search.SearchContext) (*search.DocumentMatch, error) {
	if ss.index < len(ss.matches) {
		rv := ctx.DocumentMatchPool.Get()
		rv.IndexInternalID = ss.matches[ss.index].IndexInternalID
		rv.Score = ss.matches[ss.index].Score
		ss.index++
		return rv, nil
	}
	return nil, nil
}

func (ss *stubSearcher) Advance(ctx *search.SearchContext, ID index.IndexInternalID) (*search.DocumentMatch, error) {

	for ss.index < len(ss.matches) && ss.matches[ss.index].IndexInternalID.Compare(ID) < 0 {
		ss.index++
	}
	if ss.index < len(ss.matches) {
		rv := ctx.DocumentMatchPool.Get()
		rv.IndexInternalID = ss.matches[ss.index].IndexInternalID
		rv.Score = ss.matches[ss.index].Score
		ss.index++
		return rv, nil
	}
	return nil, nil
}

func (ss *stubSearcher) Close() error {
	return nil
}

func (ss *stubSearcher) Weight() float64 {
	return 0.0
}

func (ss *stubSearcher) SetQueryNorm(float64) {
}

func (ss *stubSearcher) Count() uint64 {
	return uint64(len(ss.matches))
}

func (ss *stubSearcher) Min() int {
	return 0
}

func (ss *stubSearcher) DocumentMatchPoolSize() int {
	return 0
}

type stubReader struct{}

func (sr *stubReader) TermFieldReader(term []byte, field string, includeFreq, includeNorm, includeTermVectors bool) (index.TermFieldReader, error) {
	return nil, nil
}

func (sr *stubReader) DocIDReaderAll() (index.DocIDReader, error) {
	return nil, nil
}

func (sr *stubReader) DocIDReaderOnly(ids []string) (index.DocIDReader, error) {
	return nil, nil
}

func (sr *stubReader) FieldDict(field string) (index.FieldDict, error) {
	return nil, nil
}

func (sr *stubReader) FieldDictRange(field string, startTerm []byte, endTerm []byte) (index.FieldDict, error) {
	return nil, nil
}

func (sr *stubReader) FieldDictPrefix(field string, termPrefix []byte) (index.FieldDict, error) {
	return nil, nil
}

func (sr *stubReader) Document(id string) (*document.Document, error) {
	return nil, nil
}

func (sr *stubReader) DocumentVisitFieldTerms(id index.IndexInternalID, fields []string, visitor index.DocumentFieldTermVisitor) error {
	return nil
}

func (sr *stubReader) Fields() ([]string, error) {
	return nil, nil
}

func (sr *stubReader) GetInternal(key []byte) ([]byte, error) {
	return nil, nil
}

func (sr *stubReader) DocCount() (uint64, error) {
	return 0, nil
}

func (sr *stubReader) ExternalID(id index.IndexInternalID) (string, error) {
	return string(id), nil
}

func (sr *stubReader) InternalID(id string) (index.IndexInternalID, error) {
	return []byte(id), nil
}

func (sr *stubReader) DumpAll() chan interface{} {
	return nil
}

func (sr *stubReader) DumpDoc(id string) chan interface{} {
	return nil
}

func (sr *stubReader) DumpFields() chan interface{} {
	return nil
}

func (sr *stubReader) Close() error {
	return nil
}
