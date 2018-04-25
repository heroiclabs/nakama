// Copyright © 2016 Couchbase, Inc.
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

// +build ignore

package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func main() {

	modeline := ""
	blocks := map[string]int{}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "mode:") {
			lastSpace := strings.LastIndex(line, " ")
			prefix := line[0:lastSpace]
			suffix := line[lastSpace+1:]
			count, err := strconv.Atoi(suffix)
			if err != nil {
				fmt.Printf("error parsing count: %v", err)
				continue
			}
			existingCount, exists := blocks[prefix]
			if exists {
				blocks[prefix] = existingCount + count
			} else {
				blocks[prefix] = count
			}
		} else if modeline == "" {
			modeline = line
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "reading standard input:", err)
	}

	fmt.Println(modeline)
	for k, v := range blocks {
		fmt.Printf("%s %d\n", k, v)
	}
}
