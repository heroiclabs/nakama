//  Copyright (c) 2017 Couchbase, Inc.
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
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/search"
)

func TestGeoPointDistanceSearcher(t *testing.T) {

	tests := []struct {
		centerLon float64
		centerLat float64
		dist      float64
		field     string
		want      []string
	}{
		// approx 110567m per degree at equator
		{0.0, 0.0, 0, "loc", nil},
		{0.0, 0.0, 110567, "loc", []string{"a"}},
		{0.0, 0.0, 2 * 110567, "loc", []string{"a", "b"}},
		// stretching our approximation here
		{0.0, 0.0, 15 * 110567, "loc", []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}},
	}

	i := setupGeo(t)
	indexReader, err := i.Reader()
	if err != nil {
		t.Error(err)
	}
	defer func() {
		err = indexReader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	for _, test := range tests {
		got, err := testGeoPointDistanceSearch(indexReader, test.centerLon, test.centerLat, test.dist, test.field)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, test.want) {
			t.Errorf("expected %v, got %v for %f %f %f %s", test.want, got, test.centerLon, test.centerLat, test.dist, test.field)
		}

	}
}

func testGeoPointDistanceSearch(i index.IndexReader, centerLon, centerLat, dist float64, field string) ([]string, error) {
	var rv []string
	gds, err := NewGeoPointDistanceSearcher(i, centerLon, centerLat, dist, field, 1.0, search.SearcherOptions{})
	if err != nil {
		return nil, err
	}
	ctx := &search.SearchContext{
		DocumentMatchPool: search.NewDocumentMatchPool(gds.DocumentMatchPoolSize(), 0),
	}
	docMatch, err := gds.Next(ctx)
	for docMatch != nil && err == nil {
		rv = append(rv, string(docMatch.IndexInternalID))
		docMatch, err = gds.Next(ctx)
	}
	if err != nil {
		return nil, err
	}
	return rv, nil
}
