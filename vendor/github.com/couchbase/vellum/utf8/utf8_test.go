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

package utf8

import (
	"fmt"
	"reflect"
	"testing"
	"unicode/utf8"
)

func TestUtf8Sequences(t *testing.T) {

	want := Sequences{
		Sequence{
			Range{0x0, 0x7f},
		},
		Sequence{
			Range{0xc2, 0xdf},
			Range{0x80, 0xbf},
		},
		Sequence{
			Range{0xe0, 0xe0},
			Range{0xa0, 0xbf},
			Range{0x80, 0xbf},
		},
		Sequence{
			Range{0xe1, 0xec},
			Range{0x80, 0xbf},
			Range{0x80, 0xbf},
		},
		Sequence{
			Range{0xed, 0xed},
			Range{0x80, 0x9f},
			Range{0x80, 0xbf},
		},
		Sequence{
			Range{0xee, 0xef},
			Range{0x80, 0xbf},
			Range{0x80, 0xbf},
		},
	}

	got, err := NewSequences(0, 0xffff)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(want, got) {
		t.Errorf("wanted: %v, got %v", want, got)
	}
}

func TestCodepointsNoSurrogates(t *testing.T) {
	neverAcceptsSurrogateCodepoints(0x0, 0xFFFF)
	neverAcceptsSurrogateCodepoints(0x0, 0x10FFFF)
	neverAcceptsSurrogateCodepoints(0x0, 0x10FFFE)
	neverAcceptsSurrogateCodepoints(0x80, 0x10FFFF)
	neverAcceptsSurrogateCodepoints(0xD7FF, 0xE000)
}

func neverAcceptsSurrogateCodepoints(start, end rune) error {
	var buf = make([]byte, utf8.UTFMax)
	sequences, err := NewSequences(start, end)
	if err != nil {
		return err
	}
	for i := start; i < end; i++ {
		n := utf8.EncodeRune(buf, i)
		for _, seq := range sequences {
			if seq.Matches(buf[:n]) {
				return fmt.Errorf("utf8 seq: %v matches surrogate %d", seq, i)
			}
		}
	}
	return nil
}
