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

package test

import (
	"bytes"
	"reflect"
	"strings"
	"testing"

	"github.com/blevesearch/bleve/index/store"
)

// tests around the correct behavior of iterators

type testRow struct {
	key []byte
	val []byte
}

func batchWriteRows(s store.KVStore, rows []testRow) error {
	// open a writer
	writer, err := s.Writer()
	if err != nil {
		return err
	}

	// write the data
	batch := writer.NewBatch()
	for _, row := range rows {
		batch.Set(row.key, row.val)
	}
	err = writer.ExecuteBatch(batch)
	if err != nil {
		return err
	}

	// close the writer
	err = writer.Close()
	if err != nil {
		return err
	}
	return nil
}

func CommonTestPrefixIterator(t *testing.T, s store.KVStore) {

	data := []testRow{
		{[]byte("apple"), []byte("val")},
		{[]byte("cat1"), []byte("val")},
		{[]byte("cat2"), []byte("val")},
		{[]byte("cat3"), []byte("val")},
		{[]byte("dog1"), []byte("val")},
		{[]byte("dog2"), []byte("val")},
		{[]byte("dog4"), []byte("val")},
		{[]byte("elephant"), []byte("val")},
	}

	expectedCats := [][]byte{
		[]byte("cat1"),
		[]byte("cat2"),
		[]byte("cat3"),
	}

	expectedDogs := [][]byte{
		[]byte("dog1"),
		// we seek to "dog3" and ensure it skips over "dog2"
		// but still finds "dog4" even though there was no "dog3"
		[]byte("dog4"),
	}

	err := batchWriteRows(s, data)
	if err != nil {
		t.Fatal(err)
	}

	// open a reader
	reader, err := s.Reader()
	if err != nil {
		t.Fatal(err)
	}

	// get a prefix reader
	cats := make([][]byte, 0)
	iter := reader.PrefixIterator([]byte("cat"))
	for iter.Valid() {
		// if we want to keep bytes from iteration we must copy
		k := iter.Key()
		copyk := make([]byte, len(k))
		copy(copyk, k)
		cats = append(cats, copyk)
		iter.Next()
	}
	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	// check that we found all the cats
	if !reflect.DeepEqual(cats, expectedCats) {
		t.Fatalf("expected cats %v, got %v", expectedCats, cats)
	}

	// get a prefix reader
	dogs := make([][]byte, 0)
	iter = reader.PrefixIterator([]byte("dog"))
	for iter.Valid() {
		// if we want to keep bytes from iteration we must copy
		k := iter.Key()
		copyk := make([]byte, len(k))
		copy(copyk, k)
		dogs = append(dogs, copyk)
		if len(dogs) < 2 {
			iter.Seek([]byte("dog3"))
		} else {
			iter.Next()
		}
	}
	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	// check that we found the expected dogs
	if !reflect.DeepEqual(dogs, expectedDogs) {
		t.Fatalf("expected dogs %v, got %v", expectedDogs, dogs)
	}

	// close the reader
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func CommonTestPrefixIteratorSeek(t *testing.T, s store.KVStore) {

	data := []testRow{
		{[]byte("a"), []byte("val")},
		{[]byte("b1"), []byte("val")},
		{[]byte("b2"), []byte("val")},
		{[]byte("b3"), []byte("val")},
		{[]byte("c"), []byte("val")},
	}

	err := batchWriteRows(s, data)
	if err != nil {
		t.Fatal(err)
	}

	// open a reader
	reader, err := s.Reader()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := reader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// get an iterator on a central subset of the data
	iter := reader.PrefixIterator([]byte("b"))
	defer func() {
		err := iter.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// check that all keys have prefix
	found := []string{}
	for ; iter.Valid(); iter.Next() {
		found = append(found, string(iter.Key()))
	}
	for _, f := range found {
		if !strings.HasPrefix(f, "b") {
			t.Errorf("got key '%s' that doesn't have correct prefix", f)
		}
	}
	if len(found) != 3 {
		t.Errorf("expected 3 keys with prefix, got %d", len(found))
	}

	// now try to seek before the prefix and repeat
	found = []string{}
	for iter.Seek([]byte("a")); iter.Valid(); iter.Next() {
		found = append(found, string(iter.Key()))
	}
	for _, f := range found {
		if !strings.HasPrefix(f, "b") {
			t.Errorf("got key '%s' that doesn't have correct prefix", f)
		}
	}
	if len(found) != 3 {
		t.Errorf("expected 3 keys with prefix, got %d", len(found))
	}

	// now try to seek after the prefix and repeat
	found = []string{}
	for iter.Seek([]byte("c")); iter.Valid(); iter.Next() {
		found = append(found, string(iter.Key()))
	}
	for _, f := range found {
		if !strings.HasPrefix(f, "b") {
			t.Errorf("got key '%s' that doesn't have correct prefix", f)
		}
	}
	if len(found) != 0 {
		t.Errorf("expected 0 keys with prefix, got %d", len(found))
	}

}

func CommonTestRangeIterator(t *testing.T, s store.KVStore) {

	data := []testRow{
		{[]byte("a1"), []byte("val")},
		{[]byte("b1"), []byte("val")},
		{[]byte("b2"), []byte("val")},
		{[]byte("b3"), []byte("val")},
		{[]byte("c1"), []byte("val")},
		{[]byte("c2"), []byte("val")},
		{[]byte("c4"), []byte("val")},
		{[]byte("d1"), []byte("val")},
	}

	expectedAll := make([][]byte, 0)
	expectedBToC := make([][]byte, 0)
	expectedCToDSeek3 := make([][]byte, 0)
	expectedCToEnd := make([][]byte, 0)
	for _, row := range data {
		expectedAll = append(expectedAll, row.key)
		if bytes.HasPrefix(row.key, []byte("b")) {
			expectedBToC = append(expectedBToC, row.key)
		}
		if bytes.HasPrefix(row.key, []byte("c")) && !bytes.HasSuffix(row.key, []byte("2")) {
			expectedCToDSeek3 = append(expectedCToDSeek3, row.key)
		}
		if bytes.Compare(row.key, []byte("c")) > 0 {
			expectedCToEnd = append(expectedCToEnd, row.key)
		}
	}

	err := batchWriteRows(s, data)
	if err != nil {
		t.Fatal(err)
	}

	// open a reader
	reader, err := s.Reader()
	if err != nil {
		t.Fatal(err)
	}

	// get a range iterator (all)
	all := make([][]byte, 0)
	iter := reader.RangeIterator(nil, nil)
	for iter.Valid() {
		// if we want to keep bytes from iteration we must copy
		k := iter.Key()
		copyk := make([]byte, len(k))
		copy(copyk, k)
		all = append(all, copyk)
		iter.Next()
	}
	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	// check that we found all
	if !reflect.DeepEqual(all, expectedAll) {
		t.Fatalf("expected all %v, got %v", expectedAll, all)
	}

	// get range iterator from b - c
	bToC := make([][]byte, 0)
	iter = reader.RangeIterator([]byte("b"), []byte("c"))
	for iter.Valid() {
		// if we want to keep bytes from iteration we must copy
		k := iter.Key()
		copyk := make([]byte, len(k))
		copy(copyk, k)
		bToC = append(bToC, copyk)
		iter.Next()
	}
	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	// check that we found b-c
	if !reflect.DeepEqual(bToC, expectedBToC) {
		t.Fatalf("expected b-c %v, got %v", expectedBToC, bToC)
	}

	// get range iterator from c - d, but seek to 'c3'
	cToDSeek3 := make([][]byte, 0)
	iter = reader.RangeIterator([]byte("c"), []byte("d"))
	for iter.Valid() {
		// if we want to keep bytes from iteration we must copy
		k := iter.Key()
		copyk := make([]byte, len(k))
		copy(copyk, k)
		cToDSeek3 = append(cToDSeek3, copyk)
		if len(cToDSeek3) < 2 {
			iter.Seek([]byte("c3"))
		} else {
			iter.Next()
		}
	}
	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	// check that we found c-d with seek to c3
	if !reflect.DeepEqual(cToDSeek3, expectedCToDSeek3) {
		t.Fatalf("expected b-c %v, got %v", expectedCToDSeek3, cToDSeek3)
	}

	// get range iterator from c to the end
	cToEnd := make([][]byte, 0)
	iter = reader.RangeIterator([]byte("c"), nil)
	for iter.Valid() {
		// if we want to keep bytes from iteration we must copy
		k := iter.Key()
		copyk := make([]byte, len(k))
		copy(copyk, k)
		cToEnd = append(cToEnd, copyk)
		iter.Next()
	}
	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	// check that we found c to end
	if !reflect.DeepEqual(cToEnd, expectedCToEnd) {
		t.Fatalf("expected b-c %v, got %v", expectedCToEnd, cToEnd)
	}

	// close the reader
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func CommonTestRangeIteratorSeek(t *testing.T, s store.KVStore) {

	data := []testRow{
		{[]byte("a1"), []byte("val")},
		{[]byte("b1"), []byte("val")},
		{[]byte("c1"), []byte("val")},
		{[]byte("d1"), []byte("val")},
		{[]byte("e1"), []byte("val")},
	}

	err := batchWriteRows(s, data)
	if err != nil {
		t.Fatal(err)
	}

	// open a reader
	reader, err := s.Reader()
	if err != nil {
		t.Fatal(err)
	}

	// get an iterator on a central subset of the data
	start := []byte("b1")
	end := []byte("d1")
	iter := reader.RangeIterator(start, end)

	// seek before, at and after every possible key
	targets := [][]byte{}
	for _, row := range data {
		prefix := string(row.key[:1])
		targets = append(targets, []byte(prefix+"0"))
		targets = append(targets, []byte(prefix+"1"))
		targets = append(targets, []byte(prefix+"2"))
	}
	for _, target := range targets {
		found := []string{}
		for iter.Seek(target); iter.Valid(); iter.Next() {
			found = append(found, string(iter.Key()))
			if len(found) > len(data) {
				t.Fatalf("enumerated more than data keys after seeking to %s",
					string(target))
			}
		}
		wanted := []string{}
		for _, row := range data {
			if bytes.Compare(row.key, start) < 0 ||
				bytes.Compare(row.key, target) < 0 ||
				bytes.Compare(row.key, end) >= 0 {
				continue
			}
			wanted = append(wanted, string(row.key))
		}
		fs := strings.Join(found, ", ")
		ws := strings.Join(wanted, ", ")
		if fs != ws {
			t.Fatalf("iterating from %s returned [%s] instead of [%s]",
				string(target), fs, ws)
		}
	}

	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	if err != nil {
		t.Fatal(err)
	}

	// close the reader
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}
