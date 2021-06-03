// Copyright 2020 The Nakama Authors
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
	"testing"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/stretchr/testify/assert"
)

func TestLocalLeaderboardRankCache_Insert_Ascending(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 0, LeaderboardSortOrderAscending, u3, 33, 34)
	cache.Insert("lid", 0, LeaderboardSortOrderAscending, u2, 22, 23)
	cache.Insert("lid", 0, LeaderboardSortOrderAscending, u4, 44, 45)
	cache.Insert("lid", 0, LeaderboardSortOrderAscending, u1, 11, 12)
	cache.Insert("lid", 0, LeaderboardSortOrderAscending, u5, 55, 56)

	assert.EqualValues(t, 1, cache.Get("lid", 0, u1))
	assert.EqualValues(t, 2, cache.Get("lid", 0, u2))
	assert.EqualValues(t, 3, cache.Get("lid", 0, u3))
	assert.EqualValues(t, 4, cache.Get("lid", 0, u4))
	assert.EqualValues(t, 5, cache.Get("lid", 0, u5))
}

func TestLocalLeaderboardRankCache_Insert_Descending(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u3, 33, 34)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u2, 22, 23)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u4, 44, 45)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u1, 11, 12)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u5, 55, 56)

	assert.EqualValues(t, 1, cache.Get("lid", 0, u5))
	assert.EqualValues(t, 2, cache.Get("lid", 0, u4))
	assert.EqualValues(t, 3, cache.Get("lid", 0, u3))
	assert.EqualValues(t, 4, cache.Get("lid", 0, u2))
	assert.EqualValues(t, 5, cache.Get("lid", 0, u1))
}

func TestLocalLeaderboardRankCache_Insert_Existing(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u3, 33, 34)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u2, 22, 23)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u4, 44, 45)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u1, 11, 12)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u5, 55, 56)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u2, 55, 57)

	assert.EqualValues(t, 1, cache.Get("lid", 0, u2))
	assert.EqualValues(t, 2, cache.Get("lid", 0, u5))
	assert.EqualValues(t, 3, cache.Get("lid", 0, u4))
	assert.EqualValues(t, 4, cache.Get("lid", 0, u3))
	assert.EqualValues(t, 5, cache.Get("lid", 0, u1))
}

func TestLocalLeaderboardRankCache_TrimExpired(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u3, 33, 34)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u2, 22, 23)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u4, 44, 45)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u1, 11, 12)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u5, 55, 56)

	assert.EqualValues(t, 1, cache.Get("lid", 1, u5))
	assert.EqualValues(t, 2, cache.Get("lid", 1, u4))
	assert.EqualValues(t, 3, cache.Get("lid", 1, u3))
	assert.EqualValues(t, 4, cache.Get("lid", 1, u2))
	assert.EqualValues(t, 5, cache.Get("lid", 1, u1))

	cache.TrimExpired(1)

	assert.EqualValues(t, 0, cache.Get("lid", 1, u5))
	assert.EqualValues(t, 0, cache.Get("lid", 1, u4))
	assert.EqualValues(t, 0, cache.Get("lid", 1, u3))
	assert.EqualValues(t, 0, cache.Get("lid", 1, u2))
	assert.EqualValues(t, 0, cache.Get("lid", 1, u1))
}

func TestLocalLeaderboardRankCache_ExpirySeparation(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u3, 33, 34)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u2, 22, 23)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u4, 44, 45)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u1, 11, 12)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u5, 55, 56)

	assert.EqualValues(t, 1, cache.Get("lid", 1, u5))
	assert.EqualValues(t, 2, cache.Get("lid", 1, u4))
	assert.EqualValues(t, 3, cache.Get("lid", 1, u3))
	assert.EqualValues(t, 4, cache.Get("lid", 1, u2))
	assert.EqualValues(t, 5, cache.Get("lid", 1, u1))

	assert.EqualValues(t, 0, cache.Get("lid", 2, u5))
	assert.EqualValues(t, 0, cache.Get("lid", 2, u4))
	assert.EqualValues(t, 0, cache.Get("lid", 2, u3))
	assert.EqualValues(t, 0, cache.Get("lid", 2, u2))
	assert.EqualValues(t, 0, cache.Get("lid", 2, u1))
}

func TestLocalLeaderboardRankCache_LeaderboardSeparation(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u3, 33, 34)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u2, 22, 23)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u4, 44, 45)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u1, 11, 12)
	cache.Insert("lid", 1, LeaderboardSortOrderDescending, u5, 55, 56)

	assert.EqualValues(t, 1, cache.Get("lid", 1, u5))
	assert.EqualValues(t, 2, cache.Get("lid", 1, u4))
	assert.EqualValues(t, 3, cache.Get("lid", 1, u3))
	assert.EqualValues(t, 4, cache.Get("lid", 1, u2))
	assert.EqualValues(t, 5, cache.Get("lid", 1, u1))

	assert.EqualValues(t, 0, cache.Get("foo", 1, u5))
	assert.EqualValues(t, 0, cache.Get("foo", 1, u4))
	assert.EqualValues(t, 0, cache.Get("foo", 1, u3))
	assert.EqualValues(t, 0, cache.Get("foo", 1, u2))
	assert.EqualValues(t, 0, cache.Get("foo", 1, u1))
}

func TestLocalLeaderboardRankCache_Delete(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u3, 33, 34)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u2, 22, 23)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u4, 44, 45)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u1, 11, 12)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u5, 55, 56)

	assert.EqualValues(t, 1, cache.Get("lid", 0, u5))
	assert.EqualValues(t, 2, cache.Get("lid", 0, u4))
	assert.EqualValues(t, 3, cache.Get("lid", 0, u3))
	assert.EqualValues(t, 4, cache.Get("lid", 0, u2))
	assert.EqualValues(t, 5, cache.Get("lid", 0, u1))

	cache.Delete("lid", 0, u4)

	assert.EqualValues(t, 1, cache.Get("lid", 0, u5))
	assert.EqualValues(t, 0, cache.Get("lid", 0, u4))
	assert.EqualValues(t, 2, cache.Get("lid", 0, u3))
	assert.EqualValues(t, 3, cache.Get("lid", 0, u2))
	assert.EqualValues(t, 4, cache.Get("lid", 0, u1))
}

func TestLocalLeaderboardRankCache_DeleteLeaderboard(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u3, 33, 34)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u2, 22, 23)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u4, 44, 45)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u1, 11, 12)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u5, 55, 56)

	assert.EqualValues(t, 1, cache.Get("lid", 0, u5))
	assert.EqualValues(t, 2, cache.Get("lid", 0, u4))
	assert.EqualValues(t, 3, cache.Get("lid", 0, u3))
	assert.EqualValues(t, 4, cache.Get("lid", 0, u2))
	assert.EqualValues(t, 5, cache.Get("lid", 0, u1))

	cache.DeleteLeaderboard("lid", 0)

	assert.EqualValues(t, 0, cache.Get("lid", 0, u5))
	assert.EqualValues(t, 0, cache.Get("lid", 0, u4))
	assert.EqualValues(t, 0, cache.Get("lid", 0, u3))
	assert.EqualValues(t, 0, cache.Get("lid", 0, u2))
	assert.EqualValues(t, 0, cache.Get("lid", 0, u1))
}

func TestLocalLeaderboardRankCache_Fill(t *testing.T) {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, 0),
		blacklistAll: false,
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
	}

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u3, 33, 34)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u2, 22, 23)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u4, 44, 45)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u1, 11, 12)
	cache.Insert("lid", 0, LeaderboardSortOrderDescending, u5, 55, 56)

	assert.EqualValues(t, 1, cache.Get("lid", 0, u5))
	assert.EqualValues(t, 2, cache.Get("lid", 0, u4))
	assert.EqualValues(t, 3, cache.Get("lid", 0, u3))
	assert.EqualValues(t, 4, cache.Get("lid", 0, u2))
	assert.EqualValues(t, 5, cache.Get("lid", 0, u1))

	records := []*api.LeaderboardRecord{
		{OwnerId: u3.String()},
		{OwnerId: u1.String()},
		{OwnerId: u5.String()},
		{OwnerId: u2.String()},
		{OwnerId: u4.String()},
	}

	cache.Fill("lid", 0, records)

	assert.EqualValues(t, 3, records[0].Rank)
	assert.EqualValues(t, 5, records[1].Rank)
	assert.EqualValues(t, 1, records[2].Rank)
	assert.EqualValues(t, 4, records[3].Rank)
	assert.EqualValues(t, 2, records[4].Rank)
}
