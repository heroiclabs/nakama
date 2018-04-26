//  Copyright (c) 2016 Couchbase, Inc.
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the
//  License. You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//  Unless required by applicable law or agreed to in writing,
//  software distributed under the License is distributed on an "AS
//  IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
//  express or implied. See the License for the specific language
//  governing permissions and limitations under the License.

// +build gofuzz

package roaring

import (
	"log"
	"testing"

	"github.com/mschoch/smat"
)

// Crashers reported by smat, captured as pairs of strings.  A pair is
// a short descrption of the crash then the corresponding crash-input.
var smatHits = []string{
	"0001:\n" +
		"in a bitset, not b bitmap, pos: 0\n" +
		"  a bitset: {0,1}\n" +
		"  b bitmap: {1,0}\n" +
		"panic: bitset mismatch\n" +
		"  SETUP\n" +
		"   pushPair\n" +
		"   setBit\n" +
		"  y++\n" +
		"   flip\n",
	"]5S\xa5",
}

// Test the previous issues found by smat.
func TestSmatHits(t *testing.T) {
	smatDebugPrev := smatDebug
	smatDebug = true // Use true when diagnosing a crash.

	for i := 0; i < len(smatHits); i += 2 {
		desc := smatHits[i]
		hit := []byte(smatHits[i+1])

		log.Printf("testing smat hit: (%d) %s\n", i/2, desc)

		// fuzz the hit input
		smat.Fuzz(&smatContext{}, smat.ActionID('S'), smat.ActionID('T'),
			smatActionMap, hit)
	}

	smatDebug = smatDebugPrev
}
