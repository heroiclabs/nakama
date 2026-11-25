// Copyright 2026 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"fmt"
	"math/big"
	"sort"
	"testing"
)

const legacyRemovalBenchmarkGroupLimit = 200_000

var benchmarkRemovalIndexes []*MatchmakerIndex

func BenchmarkMatchmakerRemainderSelection(b *testing.B) {
	for _, partyCount := range []int{10, 50, 100, 200} {
		for _, rem := range []int{2, 3, 5, 10} {
			indexes := benchmarkRemovalIndexesForSoloTickets(partyCount)
			name := fmt.Sprintf("parties=%d/rem=%d", partyCount, rem)

			b.Run("dynamic/"+name, func(b *testing.B) {
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					benchmarkRemovalIndexes = selectIndexesToRemove(indexes, rem)
				}
			})

			b.Run("legacy/"+name, func(b *testing.B) {
				groupCount := benchmarkBinomial(partyCount, rem)
				if groupCount.Cmp(big.NewInt(legacyRemovalBenchmarkGroupLimit)) > 0 {
					b.Skipf("would materialize %s groups; benchmark limit is %d", groupCount, legacyRemovalBenchmarkGroupLimit)
				}

				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					benchmarkRemovalIndexes = legacySelectIndexesToRemove(indexes, rem)
				}
			})
		}
	}
}

func benchmarkRemovalIndexesForSoloTickets(partyCount int) []*MatchmakerIndex {
	indexes := make([]*MatchmakerIndex, partyCount)
	for i := range indexes {
		indexes[i] = &MatchmakerIndex{
			Ticket:    fmt.Sprintf("ticket-%04d", i),
			Count:     1,
			CreatedAt: int64(i),
		}
	}
	return indexes
}

func benchmarkBinomial(n, k int) *big.Int {
	if k < 0 || k > n {
		return new(big.Int)
	}
	if k > n-k {
		k = n - k
	}

	result := big.NewInt(1)
	for i := 1; i <= k; i++ {
		result.Mul(result, big.NewInt(int64(n-k+i)))
		result.Quo(result, big.NewInt(int64(i)))
	}
	return result
}

type legacyMatchmakerIndexGroup struct {
	indexes      []*MatchmakerIndex
	avgCreatedAt int64
}

func legacySelectIndexesToRemove(indexes []*MatchmakerIndex, required int) []*MatchmakerIndex {
	groups := legacyGroupIndexes(indexes, required)
	if len(groups) == 0 {
		return nil
	}

	sort.Slice(groups, func(i, j int) bool {
		return groups[i].avgCreatedAt > groups[j].avgCreatedAt
	})
	return groups[0].indexes
}

func legacyGroupIndexes(indexes []*MatchmakerIndex, required int) []*legacyMatchmakerIndexGroup {
	if len(indexes) == 0 || required <= 0 {
		return nil
	}

	current, others := indexes[0], indexes[1:]
	if current.Count > required {
		return legacyGroupIndexes(others, required)
	}

	var results []*legacyMatchmakerIndexGroup
	if current.Count == required {
		results = append(results, &legacyMatchmakerIndexGroup{
			indexes:      []*MatchmakerIndex{current},
			avgCreatedAt: current.CreatedAt,
		})
	} else {
		fillResults := legacyGroupIndexes(others, required-current.Count)
		for _, fillResult := range fillResults {
			indexesCount := int64(len(fillResult.indexes))
			fillResult.avgCreatedAt = (fillResult.avgCreatedAt*indexesCount + current.CreatedAt) / (indexesCount + 1)
			fillResult.indexes = append(fillResult.indexes, current)
			results = append(results, fillResult)
		}
	}

	return append(results, legacyGroupIndexes(others, required)...)
}
