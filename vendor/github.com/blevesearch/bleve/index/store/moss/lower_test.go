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

package moss

import (
	"io/ioutil"
	"os"
	"testing"

	"github.com/blevesearch/bleve/index/store"
	"github.com/blevesearch/bleve/index/store/test"
)

func openWithLower(t *testing.T, mo store.MergeOperator) (string, store.KVStore) {
	tmpDir, _ := ioutil.TempDir("", "mossStore")

	config := map[string]interface{}{
		"path": tmpDir,
		"mossLowerLevelStoreName": "mossStore",
	}

	rv, err := New(mo, config)
	if err != nil {
		t.Fatal(err)
	}
	return tmpDir, rv
}

func cleanupWithLower(t *testing.T, s store.KVStore, tmpDir string) {
	err := s.Close()
	if err != nil {
		t.Fatal(err)
	}
	err = os.RemoveAll(tmpDir)
	if err != nil {
		t.Fatal(err)
	}
}

func TestMossWithLowerKVCrud(t *testing.T) {
	tmpDir, s := openWithLower(t, nil)
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestKVCrud(t, s)
}

func TestMossWithLowerReaderIsolation(t *testing.T) {
	tmpDir, s := openWithLower(t, nil)
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestReaderIsolation(t, s)
}

func TestMossWithLowerReaderOwnsGetBytes(t *testing.T) {
	tmpDir, s := openWithLower(t, nil)
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestReaderOwnsGetBytes(t, s)
}

func TestMossWithLowerWriterOwnsBytes(t *testing.T) {
	tmpDir, s := openWithLower(t, nil)
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestWriterOwnsBytes(t, s)
}

func TestMossWithLowerPrefixIterator(t *testing.T) {
	tmpDir, s := openWithLower(t, nil)
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestPrefixIterator(t, s)
}

func TestMossWithLowerPrefixIteratorSeek(t *testing.T) {
	tmpDir, s := openWithLower(t, nil)
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestPrefixIteratorSeek(t, s)
}

func TestMossWithLowerRangeIterator(t *testing.T) {
	tmpDir, s := openWithLower(t, nil)
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestRangeIterator(t, s)
}

func TestMossWithLowerRangeIteratorSeek(t *testing.T) {
	tmpDir, s := openWithLower(t, nil)
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestRangeIteratorSeek(t, s)
}

func TestMossWithLowerMerge(t *testing.T) {
	tmpDir, s := openWithLower(t, &test.TestMergeCounter{})
	defer cleanupWithLower(t, s, tmpDir)
	test.CommonTestMerge(t, s)
}
