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
	"bufio"
	"errors"
	"fmt"
	"testing"
)

func TestPackedSize(t *testing.T) {
	tests := []struct {
		input uint64
		want  int
	}{
		{0, 1},
		{1<<8 - 1, 1},
		{1 << 8, 2},
		{1<<16 - 1, 2},
		{1 << 16, 3},
		{1<<24 - 1, 3},
		{1 << 24, 4},
		{1<<32 - 1, 4},
		{1 << 32, 5},
		{1<<40 - 1, 5},
		{1 << 40, 6},
		{1<<48 - 1, 6},
		{1 << 48, 7},
		{1<<56 - 1, 7},
		{1 << 56, 8},
		{1<<64 - 1, 8},
	}

	for _, test := range tests {
		t.Run(fmt.Sprintf("input %d", test.input), func(t *testing.T) {
			got := packedSize(test.input)
			if got != test.want {
				t.Errorf("wanted: %d, got: %d", test.want, got)
			}
		})
	}
}

var errStub = errors.New("stub error")

type stubWriter struct {
	err error
}

func (s *stubWriter) Write(p []byte) (n int, err error) {
	err = s.err
	return
}

func TestWriteByteErr(t *testing.T) {
	// create writer, force underlying buffered writer to size 1
	w := &writer{
		w: bufio.NewWriterSize(&stubWriter{errStub}, 1),
	}

	// then write 2 bytes, which should force error
	_ = w.WriteByte('a')
	err := w.WriteByte('a')
	if err != errStub {
		t.Errorf("expected %v, got %v", errStub, err)
	}
}

func TestWritePackedUintErr(t *testing.T) {
	// create writer, force underlying buffered writer to size 1
	w := &writer{
		w: bufio.NewWriterSize(&stubWriter{errStub}, 1),
	}

	err := w.WritePackedUint(36592)
	if err != errStub {
		t.Errorf("expected %v, got %v", errStub, err)
	}
}
