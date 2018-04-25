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

package http

import (
	"fmt"
	"sync"

	"github.com/blevesearch/bleve"
)

var indexNameMapping map[string]bleve.Index
var indexNameMappingLock sync.RWMutex

func RegisterIndexName(name string, idx bleve.Index) {
	indexNameMappingLock.Lock()
	defer indexNameMappingLock.Unlock()

	if indexNameMapping == nil {
		indexNameMapping = make(map[string]bleve.Index)
	}
	indexNameMapping[name] = idx
}

func UnregisterIndexByName(name string) bleve.Index {
	indexNameMappingLock.Lock()
	defer indexNameMappingLock.Unlock()

	if indexNameMapping == nil {
		return nil
	}
	rv := indexNameMapping[name]
	if rv != nil {
		delete(indexNameMapping, name)
	}
	return rv
}

func IndexByName(name string) bleve.Index {
	indexNameMappingLock.RLock()
	defer indexNameMappingLock.RUnlock()

	return indexNameMapping[name]
}

func IndexNames() []string {
	indexNameMappingLock.RLock()
	defer indexNameMappingLock.RUnlock()

	rv := make([]string, len(indexNameMapping))
	count := 0
	for k := range indexNameMapping {
		rv[count] = k
		count++
	}
	return rv
}

func UpdateAlias(alias string, add, remove []string) error {
	indexNameMappingLock.Lock()
	defer indexNameMappingLock.Unlock()

	index, exists := indexNameMapping[alias]
	if !exists {
		// new alias
		if len(remove) > 0 {
			return fmt.Errorf("cannot remove indexes from a new alias")
		}
		indexes := make([]bleve.Index, len(add))
		for i, addIndexName := range add {
			addIndex, indexExists := indexNameMapping[addIndexName]
			if !indexExists {
				return fmt.Errorf("index named '%s' does not exist", addIndexName)
			}
			indexes[i] = addIndex
		}
		indexAlias := bleve.NewIndexAlias(indexes...)
		indexNameMapping[alias] = indexAlias
	} else {
		// something with this name already exists
		indexAlias, isAlias := index.(bleve.IndexAlias)
		if !isAlias {
			return fmt.Errorf("'%s' is not an alias", alias)
		}
		// build list of add indexes
		addIndexes := make([]bleve.Index, len(add))
		for i, addIndexName := range add {
			addIndex, indexExists := indexNameMapping[addIndexName]
			if !indexExists {
				return fmt.Errorf("index named '%s' does not exist", addIndexName)
			}
			addIndexes[i] = addIndex
		}
		// build list of remove indexes
		removeIndexes := make([]bleve.Index, len(remove))
		for i, removeIndexName := range remove {
			removeIndex, indexExists := indexNameMapping[removeIndexName]
			if !indexExists {
				return fmt.Errorf("index named '%s' does not exist", removeIndexName)
			}
			removeIndexes[i] = removeIndex
		}
		indexAlias.Swap(addIndexes, removeIndexes)
	}
	return nil
}
