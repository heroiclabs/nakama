//  Copyright (c) 2018 Couchbase, Inc.
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

package test

import (
	"fmt"
	"os"
	"strconv"
	"testing"

	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index/scorch"
	"github.com/blevesearch/bleve/index/upsidedown"
	"github.com/blevesearch/bleve/mapping"
	"github.com/blevesearch/bleve/search"
)

func TestDisjunctionSearchScoreIndexWithCompositeFields(t *testing.T) {
	upHits := disjunctionQueryiOnIndexWithCompositeFields(upsidedown.Name, t)
	scHits := disjunctionQueryiOnIndexWithCompositeFields(scorch.Name, t)

	if upHits[0].ID != scHits[0].ID || upHits[1].ID != scHits[1].ID {
		t.Errorf("upsidedown, scorch returned different docs;\n"+
			"upsidedown: (%s, %s), scorch: (%s, %s)\n",
			upHits[0].ID, upHits[1].ID, scHits[0].ID, scHits[1].ID)
	}

	if scHits[0].Score != upHits[0].Score || scHits[1].Score != upHits[1].Score {
		t.Errorf("upsidedown, scorch showing different scores;\n"+
			"upsidedown: (%+v, %+v), scorch: (%+v, %+v)\n",
			*upHits[0].Expl, *upHits[1].Expl, *scHits[0].Expl, *scHits[1].Expl)
	}

}

func disjunctionQueryiOnIndexWithCompositeFields(indexName string,
	t *testing.T) []*search.DocumentMatch {
	// create an index
	idxMapping := mapping.NewIndexMapping()
	idx, err := bleve.NewUsing("testidx", idxMapping, indexName,
		bleve.Config.DefaultKVStore, nil)
	if err != nil {
		t.Error(err)
	}

	defer func() {
		err = idx.Close()
		if err != nil {
			t.Error(err)
		}
		err = os.RemoveAll("testidx")
		if err != nil {
			t.Error(err)
		}
	}()

	// create and insert documents as a batch
	batch := idx.NewBatch()
	docs := []struct {
		field1 string
		field2 int
	}{
		{
			field1: "one",
			field2: 1,
		},
		{
			field1: "two",
			field2: 2,
		},
	}

	for i := 0; i < len(docs); i++ {
		doc := document.NewDocument(strconv.Itoa(docs[i].field2))
		doc.Fields = []document.Field{
			document.NewTextField("field1", []uint64{}, []byte(docs[i].field1)),
			document.NewNumericField("field2", []uint64{}, float64(docs[i].field2)),
		}
		doc.CompositeFields = []*document.CompositeField{
			document.NewCompositeFieldWithIndexingOptions(
				"_all", true, []string{"field1"}, []string{},
				document.IndexField|document.IncludeTermVectors),
		}
		if err = batch.IndexAdvanced(doc); err != nil {
			t.Error(err)
		}
	}
	if err = idx.Batch(batch); err != nil {
		t.Error(err)
	}

	/*
		Query:
				 DISJ
			        /    \
			     CONJ    TERM(two)
			     /
		          TERM(one)
	*/

	tq1 := bleve.NewTermQuery("one")
	tq1.SetBoost(2)
	tq2 := bleve.NewTermQuery("two")
	tq2.SetBoost(3)

	cq := bleve.NewConjunctionQuery(tq1)
	cq.SetBoost(4)

	q := bleve.NewDisjunctionQuery(tq1, tq2)
	sr := bleve.NewSearchRequestOptions(q, 2, 0, true)
	res, err := idx.Search(sr)
	if err != nil {
		t.Error(err)
	}

	if len(res.Hits) != 2 {
		t.Errorf(fmt.Sprintf("indexType: %s Expected 2 hits, "+
			"but got: %v", indexName, len(res.Hits)))
	}

	return res.Hits
}
