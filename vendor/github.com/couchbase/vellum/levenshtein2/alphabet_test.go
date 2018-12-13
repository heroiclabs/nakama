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

package levenshtein2

import "testing"

func TestAlphabet(t *testing.T) {
	chars := "happy"
	alphabet := queryChars(chars)

	c, chi, _ := alphabet.next()
	if c != 'a' {
		t.Errorf("expecting 'a', got: %v", c)
	}

	if chi[0] != 2 {
		t.Errorf("expecting 2, got: %v", chi[0])
	}

	c, chi, _ = alphabet.next()
	if c != 'h' {
		t.Errorf("expecting 'h', got: %v", c)
	}

	if chi[0] != 1 {
		t.Errorf("expecting 1, got: %v", chi[0])
	}

	c, chi, _ = alphabet.next()
	if c != 'p' {
		t.Errorf("expecting 'p', got: %v", c)
	}

	if chi[0] != 12 {
		t.Errorf("expecting 12, got: %v", chi[0])
	}

	c, chi, _ = alphabet.next()
	if c != 'y' {
		t.Errorf("expecting 'y', got: %v", c)
	}

	if chi[0] != 16 {
		t.Errorf("expecting 16, got: %v", chi[0])
	}
}

func TestFullCharacteristic(t *testing.T) {
	fcv := FullCharacteristicVector([]uint32{2, 0})
	if fcv.shiftAndMask(1, 1) != 1 {
		t.Errorf("expected 1, got: %v", fcv.shiftAndMask(1, 1))
	}

	fcv = FullCharacteristicVector([]uint32{1<<5 + 1<<10, 0})
	if fcv.shiftAndMask(3, 63) != 4 {
		t.Errorf("expected 4, got: %v", fcv.shiftAndMask(3, 63))
	}
}

func TestLongCharacteristic(t *testing.T) {
	qChars := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabcabewa"
	alphabet := queryChars(qChars)

	c, chi, _ := alphabet.next()
	if c != 'a' {
		t.Errorf("expecting 'a', got: %v", c)
	}
	if chi.shiftAndMask(0, 7) != 7 {
		t.Errorf("expecting 7 , got: %v", chi.shiftAndMask(0, 7))
	}

	if chi.shiftAndMask(28, 7) != 3 {
		t.Errorf("expecting 3 , got: %v", chi.shiftAndMask(28, 7))
	}

	if chi.shiftAndMask(28, 127) != 1+2+16 {
		t.Errorf("expecting 19 , got: %v", chi.shiftAndMask(28, 127))
	}

	if chi.shiftAndMask(28, 4095) != 1+2+16+256 {
		t.Errorf("expecting 275 , got: %v", chi.shiftAndMask(28, 4095))
	}

	c, chi, _ = alphabet.next()
	if c != 'b' {
		t.Errorf("expecting 'b', got: %v", c)
	}
	if chi.shiftAndMask(0, 7) != 0 {
		t.Errorf("expecting 0 , got: %v", chi.shiftAndMask(0, 7))
	}

	if chi.shiftAndMask(28, 15) != 4 {
		t.Errorf("expecting 4 , got: %v", chi.shiftAndMask(28, 15))
	}

	if chi.shiftAndMask(28, 63) != 4+32 {
		t.Errorf("expecting 36 , got: %v", chi.shiftAndMask(28, 63))
	}

}
