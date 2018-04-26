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

package document

import (
	"testing"
)

func TestIndexingOptions(t *testing.T) {
	tests := []struct {
		options            IndexingOptions
		isIndexed          bool
		isStored           bool
		includeTermVectors bool
		docValues          bool
	}{
		{
			options:            IndexField | StoreField | IncludeTermVectors,
			isIndexed:          true,
			isStored:           true,
			includeTermVectors: true,
			docValues:          false,
		},
		{
			options:            IndexField | IncludeTermVectors,
			isIndexed:          true,
			isStored:           false,
			includeTermVectors: true,
			docValues:          false,
		},
		{
			options:            StoreField | IncludeTermVectors,
			isIndexed:          false,
			isStored:           true,
			includeTermVectors: true,
			docValues:          false,
		},
		{
			options:            IndexField,
			isIndexed:          true,
			isStored:           false,
			includeTermVectors: false,
			docValues:          false,
		},
		{
			options:            StoreField,
			isIndexed:          false,
			isStored:           true,
			includeTermVectors: false,
			docValues:          false,
		},
		{
			options:            DocValues,
			isIndexed:          false,
			isStored:           false,
			includeTermVectors: false,
			docValues:          true,
		},
		{
			options:            IndexField | StoreField | IncludeTermVectors | DocValues,
			isIndexed:          true,
			isStored:           true,
			includeTermVectors: true,
			docValues:          true,
		},
	}

	for _, test := range tests {
		actuallyIndexed := test.options.IsIndexed()
		if actuallyIndexed != test.isIndexed {
			t.Errorf("expected indexed to be %v, got %v for %d", test.isIndexed, actuallyIndexed, test.options)
		}
		actuallyStored := test.options.IsStored()
		if actuallyStored != test.isStored {
			t.Errorf("expected stored to be %v, got %v for %d", test.isStored, actuallyStored, test.options)
		}
		actuallyIncludeTermVectors := test.options.IncludeTermVectors()
		if actuallyIncludeTermVectors != test.includeTermVectors {
			t.Errorf("expected includeTermVectors to be %v, got %v for %d", test.includeTermVectors, actuallyIncludeTermVectors, test.options)
		}
		actuallyDocValues := test.options.IncludeDocValues()
		if actuallyDocValues != test.docValues {
			t.Errorf("expected docValue to be %v, got %v for %d", test.docValues, actuallyDocValues, test.options)
		}
	}
}
