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

package stats_test

import (
	"context"
	"log"

	"go.opencensus.io/stats"
)

func ExampleRecord() {
	ctx := context.Background()
	openConns, err := stats.Int64("my.org/measure/openconns", "open connections", stats.UnitNone)
	if err != nil {
		log.Fatal(err)
	}
	stats.Record(ctx, openConns.M(124)) // Record 124 open connections.
}
