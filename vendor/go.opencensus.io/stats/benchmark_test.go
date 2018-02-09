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
//

package stats

import (
	"testing"
	"log"
	"context"
)


func BenchmarkRecord(b *testing.B) {
	restart()
	var m = makeMeasure()
	var ctx = context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		Record(ctx, m.M(1), m.M(1), m.M(1), m.M(1), m.M(1), m.M(1), m.M(1), m.M(1), m.M(1), m.M(1))
	}
}

func makeMeasure() *MeasureInt64 {
	m, err := NewMeasureInt64("m", "test measure", "")
	if err != nil {
		log.Fatal(err)
	}
	return m
}
