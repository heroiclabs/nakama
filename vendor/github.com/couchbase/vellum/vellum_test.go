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

package vellum

import (
	"bytes"
	"io/ioutil"
	"os"
	"reflect"
	"testing"
)

func TestRoundTripSimple(t *testing.T) {
	f, err := ioutil.TempFile("", "vellum")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err = f.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	defer func() {
		err = os.Remove(f.Name())
		if err != nil {
			t.Fatal(err)
		}
	}()

	b, err := New(f, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	err = insertStringMap(b, smallSample)
	if err != nil {
		t.Fatalf("error building: %v", err)
	}

	err = b.Close()
	if err != nil {
		t.Fatalf("err closing: %v", err)
	}

	fst, err := Open(f.Name())
	if err != nil {
		t.Fatalf("error loading set: %v", err)
	}
	defer func() {
		err = fst.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// first check all the expected values
	got := map[string]uint64{}
	itr, err := fst.Iterator(nil, nil)
	for err == nil {
		key, val := itr.Current()
		got[string(key)] = val
		err = itr.Next()
	}
	if err != ErrIteratorDone {
		t.Errorf("iterator error: %v", err)
	}
	if !reflect.DeepEqual(smallSample, got) {
		t.Errorf("expected %v, got: %v", smallSample, got)
	}

	// some additional tests for items that should not exist
	if ok, _ := fst.Contains([]byte("mo")); ok {
		t.Errorf("expected to not contain mo, but did")
	}

	if ok, _ := fst.Contains([]byte("monr")); ok {
		t.Errorf("expected to not contain monr, but did")
	}

	if ok, _ := fst.Contains([]byte("thur")); ok {
		t.Errorf("expected to not contain thur, but did")
	}

	if ok, _ := fst.Contains([]byte("thurp")); ok {
		t.Errorf("expected to not contain thurp, but did")
	}

	if ok, _ := fst.Contains([]byte("tue")); ok {
		t.Errorf("expected to not contain tue, but did")
	}

	if ok, _ := fst.Contains([]byte("tuesd")); ok {
		t.Errorf("expected to not contain tuesd, but did")
	}

	// a few more misc non-existent values to increase coverage
	if ok, _ := fst.Contains([]byte("x")); ok {
		t.Errorf("expected to not contain x, but did")
	}

	// now try accessing it through the Automaton interface
	exists := AutomatonContains(fst, []byte("mon"))
	if !exists {
		t.Errorf("expected key 'mon' to exist, doesn't")
	}

	exists = AutomatonContains(fst, []byte("mons"))
	if exists {
		t.Errorf("expected key 'mo' to not exist, does")
	}

	// now try accessing it through the Transducer interface
	var val uint64
	exists, val = TransducerGet(fst, []byte("mon"))
	if !exists {
		t.Errorf("expected key 'mon' to exist, doesn't")
	}
	if val != 2 {
		t.Errorf("expected val 2, got %d", val)
	}

	// now try accessing it through the Transducer interface
	// for key that doesn't exist
	exists, _ = TransducerGet(fst, []byte("mons"))
	if exists {
		t.Errorf("expected key 'mo' to not exist, does")
	}

	minKey, _ := fst.GetMinKey()
	if string(minKey) != "mon" {
		t.Errorf("expected minKey 'mon', got %v", string(minKey))
	}

	maxKey, _ := fst.GetMaxKey()
	if string(maxKey) != "tye" {
		t.Errorf("expected maxKey 'tye', got %v", string(maxKey))
	}
}

func TestRoundTripThousand(t *testing.T) {
	dataset := thousandTestWords
	randomThousandVals := randomValues(dataset)

	f, err := ioutil.TempFile("", "vellum")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err = f.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	defer func() {
		err = os.Remove(f.Name())
		if err != nil {
			t.Fatal(err)
		}
	}()

	b, err := New(f, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	err = insertStrings(b, dataset, randomThousandVals)
	if err != nil {
		t.Fatalf("error inserting thousand words: %v", err)
	}
	err = b.Close()
	if err != nil {
		t.Fatalf("error closing builder: %v", err)
	}

	fst, err := Open(f.Name())
	if err != nil {
		t.Fatalf("error loading set: %v", err)
	}
	defer func() {
		err = fst.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// first check all the expected values
	got := map[string]uint64{}
	itr, err := fst.Iterator(nil, nil)
	for err == nil {
		key, val := itr.Current()
		got[string(key)] = val
		err = itr.Next()
	}
	if err != ErrIteratorDone {
		t.Errorf("iterator error: %v", err)
	}

	for i := 0; i < len(dataset); i++ {
		foundVal, ok := got[dataset[i]]
		if !ok {
			t.Fatalf("expected to find key, but didn't: %s", dataset[i])
		}

		if foundVal != randomThousandVals[i] {
			t.Fatalf("expected value %d for key %s, but got %d", randomThousandVals[i], dataset[i], foundVal)
		}

		// now remove it
		delete(got, dataset[i])
	}

	if len(got) != 0 {
		t.Fatalf("expected got map to be empty after checking, still has %v", got)
	}
}

func TestRoundTripEmpty(t *testing.T) {
	f, err := ioutil.TempFile("", "vellum")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err = f.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	defer func() {
		err = os.Remove(f.Name())
		if err != nil {
			t.Fatal(err)
		}
	}()

	b, err := New(f, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	err = b.Close()
	if err != nil {
		t.Fatalf("error closing: %v", err)
	}

	fst, err := Open(f.Name())
	if err != nil {
		t.Fatalf("error loading set: %v", err)
	}
	defer func() {
		err = fst.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	if fst.Len() != 0 {
		t.Fatalf("expected length 0, got %d", fst.Len())
	}

	// first check all the expected values
	got := map[string]uint64{}
	itr, err := fst.Iterator(nil, nil)
	for err == nil {
		key, val := itr.Current()
		got[string(key)] = val
		err = itr.Next()
	}
	if err != ErrIteratorDone {
		t.Errorf("iterator error: %v", err)
	}
	if len(got) > 0 {
		t.Errorf("expected not to see anything, got %v", got)
	}
}

func TestRoundTripEmptyString(t *testing.T) {
	f, err := ioutil.TempFile("", "vellum")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err = f.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	defer func() {
		err = os.Remove(f.Name())
		if err != nil {
			t.Fatal(err)
		}
	}()

	b, err := New(f, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	err = b.Insert([]byte(""), 1)
	if err != nil {
		t.Fatalf("error inserting empty string")
	}

	err = b.Close()
	if err != nil {
		t.Fatalf("error closing: %v", err)
	}

	fst, err := Open(f.Name())
	if err != nil {
		t.Fatalf("error loading set: %v", err)
	}
	defer func() {
		err = fst.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	if fst.Len() != 1 {
		t.Fatalf("expected length 1, got %d", fst.Len())
	}

	// first check all the expected values
	want := map[string]uint64{
		"": 1,
	}
	got := map[string]uint64{}
	itr, err := fst.Iterator(nil, nil)
	for err == nil {
		key, val := itr.Current()
		got[string(key)] = val
		err = itr.Next()
	}
	if err != ErrIteratorDone {
		t.Errorf("iterator error: %v", err)
	}
	if !reflect.DeepEqual(want, got) {
		t.Errorf("expected %v, got: %v", want, got)
	}
}

func TestRoundTripEmptyStringAndOthers(t *testing.T) {
	f, err := ioutil.TempFile("", "vellum")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err = f.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	defer func() {
		err = os.Remove(f.Name())
		if err != nil {
			t.Fatal(err)
		}
	}()

	b, err := New(f, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	err = b.Insert([]byte(""), 0)
	if err != nil {
		t.Fatalf("error inserting empty string")
	}
	err = b.Insert([]byte("a"), 0)
	if err != nil {
		t.Fatalf("error inserting empty string")
	}

	err = b.Close()
	if err != nil {
		t.Fatalf("error closing: %v", err)
	}

	fst, err := Open(f.Name())
	if err != nil {
		t.Fatalf("error loading set: %v", err)
	}
	defer func() {
		err = fst.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	if fst.Len() != 2 {
		t.Fatalf("expected length 2, got %d", fst.Len())
	}

	// first check all the expected values
	want := map[string]uint64{
		"":  0,
		"a": 0,
	}
	got := map[string]uint64{}
	itr, err := fst.Iterator(nil, nil)
	for err == nil {
		key, val := itr.Current()
		got[string(key)] = val
		err = itr.Next()
	}
	if err != ErrIteratorDone {
		t.Errorf("iterator error: %v", err)
	}
	if !reflect.DeepEqual(want, got) {
		t.Errorf("expected %v, got: %v", want, got)
	}
}

func TestMerge(t *testing.T) {

	// first create a file with the smallSample data
	f, err := ioutil.TempFile("", "vellum1")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err = f.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	defer func() {
		err = os.Remove(f.Name())
		if err != nil {
			t.Fatal(err)
		}
	}()

	b, err := New(f, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	err = insertStringMap(b, smallSample)
	if err != nil {
		t.Fatalf("error building: %v", err)
	}

	err = b.Close()
	if err != nil {
		t.Fatalf("err closing: %v", err)
	}

	smallSample2 := map[string]uint64{
		"bold": 25,
		"last": 1,
		"next": 500,
		"tank": 0,
	}

	// next create a file with the smallSample2 data
	f2, err := ioutil.TempFile("", "vellum1")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err = f2.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	defer func() {
		err = os.Remove(f2.Name())
		if err != nil {
			t.Fatal(err)
		}
	}()

	b, err = New(f2, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	err = insertStringMap(b, smallSample2)
	if err != nil {
		t.Fatalf("error building: %v", err)
	}

	err = b.Close()
	if err != nil {
		t.Fatalf("err closing: %v", err)
	}

	// now open them both up
	fst, err := Open(f.Name())
	if err != nil {
		t.Fatalf("error loading set: %v", err)
	}
	defer func() {
		err = fst.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	fst2, err := Open(f2.Name())
	if err != nil {
		t.Fatalf("error loading set: %v", err)
	}
	defer func() {
		err = fst2.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// create full range iterators on both
	itr, err := fst.Iterator(nil, nil)
	if err != nil {
		t.Fatalf("error opening iterator: %v", err)
	}
	itr2, err := fst2.Iterator(nil, nil)
	if err != nil {
		t.Fatalf("error opening iterator: %v", err)
	}

	f3, err := ioutil.TempFile("", "vellum1")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err = f3.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	defer func() {
		err = os.Remove(f3.Name())
		if err != nil {
			t.Fatal(err)
		}
	}()

	err = Merge(f3, nil, []Iterator{itr, itr2}, MergeSum)
	if err != nil {
		t.Fatalf("error merging iterators: %v", err)
	}

	// now check it
	fstc, err := Open(f3.Name())
	if err != nil {
		t.Fatalf("error loading set: %v", err)
	}
	defer func() {
		err = fstc.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	if fstc.Len() != 8 {
		t.Fatalf("expected length 8, got %d", fst.Len())
	}

	// now check all the expected values
	want := map[string]uint64{
		"mon":   2,
		"tues":  3,
		"thurs": 5,
		"tye":   99,
		"bold":  25,
		"last":  1,
		"next":  500,
		"tank":  0,
	}
	got := map[string]uint64{}
	itrc, err := fstc.Iterator(nil, nil)
	for err == nil {
		key, val := itrc.Current()
		got[string(key)] = val
		err = itrc.Next()
	}
	if err != ErrIteratorDone {
		t.Errorf("iterator error: %v", err)
	}
	if !reflect.DeepEqual(want, got) {
		t.Errorf("expected %v, got: %v", want, got)
	}
}

func BenchmarkKey4000K(b *testing.B) {
	benchmarkBigKey(b, 4000000)
}

func BenchmarkKey1000K(b *testing.B) {
	benchmarkBigKey(b, 1000000)
}

func BenchmarkKey100K(b *testing.B) {
	benchmarkBigKey(b, 100000)
}

func BenchmarkKey10K(b *testing.B) {
	benchmarkBigKey(b, 10000)
}

func BenchmarkKey1K(b *testing.B) {
	benchmarkBigKey(b, 1000)
}

func benchmarkBigKey(b *testing.B, n int) {
	big := bytes.Repeat([]byte("a"), n)

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		b, err := New(ioutil.Discard, nil)
		if err != nil {
			break
		}

		err = b.Insert(big, 0)
		if err != nil {
			break
		}

		err = b.Close()
		if err != nil {
			break
		}
	}
}
