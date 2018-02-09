// Copyright 2017, OpenCensus Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package stats

import "fmt"

const (
	maxNameLength = 255
)

func checkViewName(name string) error {
	if len(name) > maxNameLength {
		return fmt.Errorf("view name cannot be larger than %v", maxNameLength)
	}
	if !isPrintable(name) {
		return fmt.Errorf("view name needs to be an ASCII string")
	}
	return nil
}

func checkMeasureName(name string) error {
	if len(name) > maxNameLength {
		return fmt.Errorf("measure name cannot be larger than %v", maxNameLength)
	}
	if !isPrintable(name) {
		return fmt.Errorf("measure name needs to be an ASCII string")
	}
	return nil
}

func isPrintable(str string) bool {
	for _, r := range str {
		if !(r >= ' ' && r <= '~') {
			return false
		}
	}
	return true
}
