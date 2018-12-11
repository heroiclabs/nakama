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
	"reflect"
	"testing"
)

// FIXME add tests for longjmp (wider delta address)
// FIXME add tests for wider values
// FIXME add tests for mixed value sizes in same edge (fixed size, but padded)
// FIXME add test for final state (must include final val even if 0)

func TestEncoderVersionError(t *testing.T) {
	_, err := loadEncoder(629, nil)
	if err == nil {
		t.Errorf("expected error loading encoder version 629, got nil")
	}
}

func TestEncoderStart(t *testing.T) {

	var headerV1 = []byte{
		1, 0, 0, 0, 0, 0, 0, 0,
		0, 0, 0, 0, 0, 0, 0, 0,
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)
	err := e.start()
	if err != nil {
		t.Fatal(err)
	}
	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, headerV1) {
		t.Errorf("expected header: %v, got %v", headerV1, got)
	}
}

func TestEncoderStateOneNextWithCommonInput(t *testing.T) {

	curr := &builderNode{
		trans: []transition{
			{
				in:   'a',
				addr: 27,
			},
		},
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// now encode the curr state
	_, err := e.encodeState(curr, 27)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want = []byte{
		oneTransition | transitionNext | encodeCommon('a'),
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}

func TestEncoderStateOneNextWithUncommonInput(t *testing.T) {

	curr := &builderNode{
		trans: []transition{
			{
				in:   0xff,
				addr: 27,
			},
		},
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// now encode the curr state
	_, err := e.encodeState(curr, 27)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want = []byte{
		0xff,
		oneTransition | transitionNext,
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}

func TestEncoderStateOneNotNextWithCommonInputNoValue(t *testing.T) {

	curr := &builderNode{
		trans: []transition{
			{
				in:   'a',
				addr: 32,
			},
		},
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// pretend we're at a position in the file
	e.bw.counter = 64

	// now encode the curr state
	_, err := e.encodeState(curr, 64)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want = []byte{
		32,       // delta address packed
		1<<4 | 0, // pack sizes
		oneTransition | encodeCommon('a'),
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}

func TestEncoderStateOneNotNextWithUncommonInputNoValue(t *testing.T) {

	curr := &builderNode{
		trans: []transition{
			{
				in:   0xff,
				addr: 32,
			},
		},
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// pretend we're at a position in the file
	e.bw.counter = 64

	// now encode the curr state
	_, err := e.encodeState(curr, 64)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want = []byte{
		32,       // delta address packed
		1<<4 | 0, // pack sizes
		0xff,
		oneTransition,
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}

func TestEncoderStateOneNotNextWithCommonInputWithValue(t *testing.T) {

	curr := &builderNode{
		trans: []transition{
			{
				in:   'a',
				addr: 32,
				out:  27,
			},
		},
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// pretend we're at a position in the file
	e.bw.counter = 64

	// now encode the curr state
	_, err := e.encodeState(curr, 64)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want = []byte{
		27,       // trans value
		32,       // delta address packed
		1<<4 | 1, // pack sizes
		oneTransition | encodeCommon('a'),
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}

func TestEncoderStateOneNotNextWithUncommonInputWithValue(t *testing.T) {

	curr := &builderNode{
		trans: []transition{
			{
				in:   0xff,
				addr: 32,
				out:  39,
			},
		},
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// pretend we're at a position in the file
	e.bw.counter = 64

	// now encode the curr state
	_, err := e.encodeState(curr, 64)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want = []byte{
		39,       // trans val
		32,       // delta address packed
		1<<4 | 1, // pack sizes
		0xff,
		oneTransition,
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}

func TestEncoderStateManyWithNoValues(t *testing.T) {

	curr := &builderNode{
		trans: []transition{
			{
				in:   'a',
				addr: 32,
			},
			{
				in:   'b',
				addr: 45,
			},
			{
				in:   'c',
				addr: 52,
			},
		},
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// pretend we're at a position in the file
	e.bw.counter = 64

	// now encode the curr state
	_, err := e.encodeState(curr, 64)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want = []byte{
		12, // delta addresses packed
		19,
		32,
		'c', // encoded keys reversed
		'b',
		'a',
		1<<4 | 0, // pack sizes
		encodeNumTrans(3),
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}

func TestEncoderStateManyWithValues(t *testing.T) {

	curr := &builderNode{
		trans: []transition{
			{
				in:   'a',
				addr: 32,
				out:  3,
			},
			{
				in:   'b',
				addr: 45,
				out:  0,
			},
			{
				in:   'c',
				addr: 52,
				out:  7,
			},
		},
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// pretend we're at a position in the file
	e.bw.counter = 64

	// now encode the curr state
	_, err := e.encodeState(curr, 64)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want = []byte{
		7, // values reversed
		0,
		3,
		12, // delta addresses reversed
		19,
		32,
		'c', // encoded keys reversed
		'b',
		'a',
		1<<4 | 1, // pack sizes
		encodeNumTrans(3),
	}
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}

func TestEncoderStateMaxTransitions(t *testing.T) {
	testEncoderStateNTransitions(t, 256)
}

func TestEncoderStateMoreTransitionsThanFitInHeader(t *testing.T) {
	testEncoderStateNTransitions(t, 1<<6)
}

func testEncoderStateNTransitions(t *testing.T, n int) {

	curr := &builderNode{
		trans: make([]transition, n),
	}
	for i := 0; i < n; i++ {
		curr.trans[i] = transition{
			in:   byte(i),
			addr: 32,
		}
	}

	var buf bytes.Buffer
	e := newEncoderV1(&buf)

	// pretend we're at a position in the file
	e.bw.counter = 64

	// now encode the curr state
	_, err := e.encodeState(curr, 64)
	if err != nil {
		t.Fatal(err)
	}

	// manually flush
	err = e.bw.Flush()
	if err != nil {
		t.Fatal(err)
	}

	// now look at the bytes produced
	var want []byte
	// append 256 delta addresses
	for i := 0; i < n; i++ {
		want = append(want, 32)
	}
	// append transition keys (reversed)
	for i := n - 1; i >= 0; i-- {
		want = append(want, byte(i))
	}
	// append pack sizes
	want = append(want, 1<<4|0)

	if n > 1<<6-1 {
		// append separate byte of pack sizes
		if n == 256 { // 256 is specially encoded as 1
			want = append(want, 1)
		} else {
			want = append(want, byte(n))
		}

	}
	// append header byte, which is all 0 in this case
	want = append(want, 0)
	got := buf.Bytes()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected bytes: %v, got %v", want, got)
	}
}
