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

package boltdb

import (
	"os"
	"testing"

	"github.com/blevesearch/bleve/index/store"
	"github.com/blevesearch/bleve/index/store/test"
	"github.com/boltdb/bolt"
)

func open(t *testing.T, mo store.MergeOperator) store.KVStore {
	rv, err := New(mo, map[string]interface{}{"path": "test"})
	if err != nil {
		t.Fatal(err)
	}
	return rv
}

func cleanup(t *testing.T, s store.KVStore) {
	err := s.Close()
	if err != nil {
		t.Fatal(err)
	}
	err = os.RemoveAll("test")
	if err != nil {
		t.Fatal(err)
	}
}

func TestBoltDBKVCrud(t *testing.T) {
	s := open(t, nil)
	defer cleanup(t, s)
	test.CommonTestKVCrud(t, s)
}

func TestBoltDBReaderIsolation(t *testing.T) {
	s := open(t, nil)
	defer cleanup(t, s)
	test.CommonTestReaderIsolation(t, s)
}

func TestBoltDBReaderOwnsGetBytes(t *testing.T) {
	s := open(t, nil)
	defer cleanup(t, s)
	test.CommonTestReaderOwnsGetBytes(t, s)
}

func TestBoltDBWriterOwnsBytes(t *testing.T) {
	s := open(t, nil)
	defer cleanup(t, s)
	test.CommonTestWriterOwnsBytes(t, s)
}

func TestBoltDBPrefixIterator(t *testing.T) {
	s := open(t, nil)
	defer cleanup(t, s)
	test.CommonTestPrefixIterator(t, s)
}

func TestBoltDBPrefixIteratorSeek(t *testing.T) {
	s := open(t, nil)
	defer cleanup(t, s)
	test.CommonTestPrefixIteratorSeek(t, s)
}

func TestBoltDBRangeIterator(t *testing.T) {
	s := open(t, nil)
	defer cleanup(t, s)
	test.CommonTestRangeIterator(t, s)
}

func TestBoltDBRangeIteratorSeek(t *testing.T) {
	s := open(t, nil)
	defer cleanup(t, s)
	test.CommonTestRangeIteratorSeek(t, s)
}

func TestBoltDBMerge(t *testing.T) {
	s := open(t, &test.TestMergeCounter{})
	defer cleanup(t, s)
	test.CommonTestMerge(t, s)
}

func TestBoltDBConfig(t *testing.T) {
	var tests = []struct {
		in          map[string]interface{}
		path        string
		bucket      string
		noSync      bool
		fillPercent float64
	}{
		{
			map[string]interface{}{"path": "test", "bucket": "mybucket", "nosync": true, "fillPercent": 0.75},
			"test",
			"mybucket",
			true,
			0.75,
		},
		{
			map[string]interface{}{"path": "test"},
			"test",
			"bleve",
			false,
			bolt.DefaultFillPercent,
		},
	}

	for _, test := range tests {
		kv, err := New(nil, test.in)
		if err != nil {
			t.Fatal(err)
		}
		bs, ok := kv.(*Store)
		if !ok {
			t.Fatal("failed type assertion to *boltdb.Store")
		}
		if bs.path != test.path {
			t.Fatalf("path: expected %q, got %q", test.path, bs.path)
		}
		if bs.bucket != test.bucket {
			t.Fatalf("bucket: expected %q, got %q", test.bucket, bs.bucket)
		}
		if bs.noSync != test.noSync {
			t.Fatalf("noSync: expected %t, got %t", test.noSync, bs.noSync)
		}
		if bs.fillPercent != test.fillPercent {
			t.Fatalf("fillPercent: expected %f, got %f", test.fillPercent, bs.fillPercent)
		}
		cleanup(t, kv)
	}
}
