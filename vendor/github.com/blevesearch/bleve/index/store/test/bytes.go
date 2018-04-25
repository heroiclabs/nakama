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
	"testing"

	"github.com/blevesearch/bleve/index/store"
)

// tests which focus on the byte ownership

// CommonTestReaderOwnsGetBytes attempts to mutate the returned bytes
// first, while the reader is still open, second after that reader is
// closed, then the original key is read again, to ensure these
// modifications did not cause panic, or mutate the stored value
func CommonTestReaderOwnsGetBytes(t *testing.T, s store.KVStore) {

	originalKey := []byte("key")
	originalVal := []byte("val")

	// open a writer
	writer, err := s.Writer()
	if err != nil {
		t.Fatal(err)
	}

	// write key/val
	batch := writer.NewBatch()
	batch.Set(originalKey, originalVal)
	err = writer.ExecuteBatch(batch)
	if err != nil {
		t.Fatal(err)
	}

	// close the writer
	err = writer.Close()
	if err != nil {
		t.Fatal(err)
	}

	// open a reader
	reader, err := s.Reader()
	if err != nil {
		t.Fatal(err)
	}

	// read key
	returnedVal, err := reader.Get(originalKey)
	if err != nil {
		t.Fatal(err)
	}

	// check that it is the expected value
	if !reflect.DeepEqual(returnedVal, originalVal) {
		t.Fatalf("expected value: %v for '%s', got %v", originalVal, originalKey, returnedVal)
	}

	// mutate the returned value with reader still open
	for i := range returnedVal {
		returnedVal[i] = '1'
	}

	// read the key again
	returnedVal2, err := reader.Get(originalKey)
	if err != nil {
		t.Fatal(err)
	}

	// check that it is the expected value
	if !reflect.DeepEqual(returnedVal2, originalVal) {
		t.Fatalf("expected value: %v for '%s', got %v", originalVal, originalKey, returnedVal2)
	}

	// close the reader
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	// mutate the original returned value again
	for i := range returnedVal {
		returnedVal[i] = '2'
	}

	// open another reader
	reader, err = s.Reader()
	if err != nil {
		t.Fatal(err)
	}

	// read the key again
	returnedVal3, err := reader.Get(originalKey)
	if err != nil {
		t.Fatal(err)
	}

	// check that it is the expected value
	if !reflect.DeepEqual(returnedVal3, originalVal) {
		t.Fatalf("expected value: %v for '%s', got %v", originalVal, originalKey, returnedVal3)
	}

	// close the reader
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	// finally check that the value we mutated still has what we set it to
	for i := range returnedVal {
		if returnedVal[i] != '2' {
			t.Errorf("expected byte to be '2', got %v", returnedVal[i])
		}
	}
}

func CommonTestWriterOwnsBytes(t *testing.T, s store.KVStore) {

	keyBuffer := make([]byte, 5)
	valBuffer := make([]byte, 5)

	// open a writer
	writer, err := s.Writer()
	if err != nil {
		t.Fatal(err)
	}

	// write key/val pairs reusing same buffer
	batch := writer.NewBatch()
	for i := 0; i < 10; i++ {
		keyBuffer[0] = 'k'
		keyBuffer[1] = 'e'
		keyBuffer[2] = 'y'
		keyBuffer[3] = '-'
		keyBuffer[4] = byte('0' + i)
		valBuffer[0] = 'v'
		valBuffer[1] = 'a'
		valBuffer[2] = 'l'
		valBuffer[3] = '-'
		valBuffer[4] = byte('0' + i)
		batch.Set(keyBuffer, valBuffer)
	}
	err = writer.ExecuteBatch(batch)
	if err != nil {
		t.Fatal(err)
	}

	// close the writer
	err = writer.Close()
	if err != nil {
		t.Fatal(err)
	}

	// open a reader
	reader, err := s.Reader()
	if err != nil {
		t.Fatal(err)
	}

	// check that we can read back what we expect
	allks := make([][]byte, 0)
	allvs := make([][]byte, 0)
	iter := reader.RangeIterator(nil, nil)
	for iter.Valid() {
		// if we want to keep bytes from iteration we must copy
		k := iter.Key()
		copyk := make([]byte, len(k))
		copy(copyk, k)
		allks = append(allks, copyk)
		v := iter.Key()
		copyv := make([]byte, len(v))
		copy(copyv, v)
		allvs = append(allvs, copyv)
		iter.Next()
	}
	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	if len(allks) != 10 {
		t.Fatalf("expected 10 k/v pairs, got %d", len(allks))
	}
	for i, key := range allks {
		val := allvs[i]
		if !bytes.HasSuffix(key, []byte{byte('0' + i)}) {
			t.Errorf("expected key %v to end in %d", key, []byte{byte('0' + i)})
		}
		if !bytes.HasSuffix(val, []byte{byte('0' + i)}) {
			t.Errorf("expected val %v to end in %d", val, []byte{byte('0' + i)})
		}
	}

	// close the reader
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	// open a writer
	writer, err = s.Writer()
	if err != nil {
		t.Fatal(err)
	}

	// now delete using same approach
	batch = writer.NewBatch()
	for i := 0; i < 10; i++ {
		keyBuffer[0] = 'k'
		keyBuffer[1] = 'e'
		keyBuffer[2] = 'y'
		keyBuffer[3] = '-'
		keyBuffer[4] = byte('0' + i)
		batch.Delete(keyBuffer)
	}
	err = writer.ExecuteBatch(batch)
	if err != nil {
		t.Fatal(err)
	}

	// close the writer
	err = writer.Close()
	if err != nil {
		t.Fatal(err)
	}

	// open a reader
	reader, err = s.Reader()
	if err != nil {
		t.Fatal(err)
	}

	// check that we can read back what we expect
	allks = make([][]byte, 0)
	iter = reader.RangeIterator(nil, nil)
	for iter.Valid() {
		// if we want to keep bytes from iteration we must copy
		k := iter.Key()
		copyk := make([]byte, len(k))
		copy(copyk, k)
		allks = append(allks, copyk)
		v := iter.Key()
		copyv := make([]byte, len(v))
		copy(copyv, v)
		allvs = append(allvs, copyv)
		iter.Next()
	}
	err = iter.Close()
	if err != nil {
		t.Fatal(err)
	}

	if len(allks) != 0 {
		t.Fatalf("expected 0 k/v pairs remaining, got %d", len(allks))
	}

	// close the reader
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}
