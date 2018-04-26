//  Copyright (c) 2016 Couchbase, Inc.
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

package mapping

import "fmt"

// Examples for Mapping related functions

func ExampleDocumentMapping_AddSubDocumentMapping() {
	// adds a document mapping for a property in a document
	// useful for mapping nested documents
	documentMapping := NewDocumentMapping()
	subDocumentMapping := NewDocumentMapping()
	documentMapping.AddSubDocumentMapping("Property", subDocumentMapping)

	fmt.Println(len(documentMapping.Properties))
	// Output:
	// 1
}

func ExampleDocumentMapping_AddFieldMapping() {
	// you can only add field mapping to those properties which already have a document mapping
	documentMapping := NewDocumentMapping()
	subDocumentMapping := NewDocumentMapping()
	documentMapping.AddSubDocumentMapping("Property", subDocumentMapping)

	fieldMapping := NewTextFieldMapping()
	fieldMapping.Analyzer = "en"
	subDocumentMapping.AddFieldMapping(fieldMapping)

	fmt.Println(len(documentMapping.Properties["Property"].Fields))
	// Output:
	// 1
}

func ExampleDocumentMapping_AddFieldMappingsAt() {
	// you can only add field mapping to those properties which already have a document mapping
	documentMapping := NewDocumentMapping()
	subDocumentMapping := NewDocumentMapping()
	documentMapping.AddSubDocumentMapping("NestedProperty", subDocumentMapping)

	fieldMapping := NewTextFieldMapping()
	fieldMapping.Analyzer = "en"
	documentMapping.AddFieldMappingsAt("NestedProperty", fieldMapping)

	fmt.Println(len(documentMapping.Properties["NestedProperty"].Fields))
	// Output:
	// 1
}
