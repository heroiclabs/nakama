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

package scorch

import (
	"testing"

	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
)

func TestEventBatchIntroductionStart(t *testing.T) {
	testConfig := CreateConfig("TestEventBatchIntroductionStart")
	err := InitTest(testConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(testConfig)
		if err != nil {
			t.Fatal(err)
		}
	}()

	var count int
	RegistryEventCallbacks["test"] = func(e Event) {
		if e.Kind == EventKindBatchIntroductionStart {
			count++
		}
	}

	ourConfig := make(map[string]interface{}, len(testConfig))
	for k, v := range testConfig {
		ourConfig[k] = v
	}
	ourConfig["eventCallbackName"] = "test"

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, ourConfig, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}

	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	if count != 1 {
		t.Fatalf("expected to see 1 batch introduction event event, saw %d", count)
	}
}
