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

package vellum_test

import (
	"bytes"
	"fmt"
	"log"

	"github.com/couchbase/vellum"
)

func Example() {

	var buf bytes.Buffer
	builder, err := vellum.New(&buf, nil)
	if err != nil {
		log.Fatal(err)
	}

	err = builder.Insert([]byte("cat"), 1)
	if err != nil {
		log.Fatal(err)
	}

	err = builder.Insert([]byte("dog"), 2)
	if err != nil {
		log.Fatal(err)
	}

	err = builder.Insert([]byte("fish"), 3)
	if err != nil {
		log.Fatal(err)
	}

	err = builder.Close()
	if err != nil {
		log.Fatal(err)
	}

	fst, err := vellum.Load(buf.Bytes())
	if err != nil {
		log.Fatal(err)
	}

	val, exists, err := fst.Get([]byte("cat"))
	if err != nil {
		log.Fatal(err)
	}
	if exists {
		fmt.Println(val)
	}

	val, exists, err = fst.Get([]byte("dog"))
	if err != nil {
		log.Fatal(err)
	}
	if exists {
		fmt.Println(val)
	}

	val, exists, err = fst.Get([]byte("fish"))
	if err != nil {
		log.Fatal(err)
	}
	if exists {
		fmt.Println(val)
	}

	// Output: 1
	// 2
	// 3
}
