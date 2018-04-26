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

package levenshtein

import "fmt"

type statesStack []*state

func (s statesStack) String() string {
	rv := ""
	for i := 0; i < len(s); i++ {
		matchStr := ""
		if s[i].match {
			matchStr = " (MATCH) "
		}
		rv += fmt.Sprintf("state %d%s:\n%v\n", i, matchStr, s[i])
	}
	return rv
}

func (s statesStack) Push(v *state) statesStack {
	return append(s, v)
}

type intsStack [][]int

func (s intsStack) Push(v []int) intsStack {
	return append(s, v)
}

func (s intsStack) Pop() (intsStack, []int) {
	l := len(s)
	if l < 1 {
		return s, nil
	}
	return s[:l-1], s[l-1]
}
