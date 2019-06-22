// Copyright 2018 The Nakama Authors
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
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"golang.org/x/net/context"
)

func (s *ApiServer) ListAchievements(ctx context.Context, in *api.ListAchievementsRequest) (*api.AchievementList, error) {
	var testAchievement = api.Achievement{
		Id:          "testID",
		Name:        "TestAchievement",
		Description: "Test Description",
	}

	var testAchievementList = api.AchievementList{
		Achievements: []*api.Achievement{&testAchievement},
	}

	return &testAchievementList, nil
}

func (s *ApiServer) GetAchievement(ctx context.Context, in *api.AchievementRequest) (*api.Achievement, error) {
	var testAchievement = api.Achievement{
		Id:          in.AchievementId,
		Name:        "Test Achievement",
		Description: "Test Description",
	}

	return &testAchievement, nil
}

func (s *ApiServer) SetAchievementProgress(ctx context.Context, in *api.AchievementProgress) (*empty.Empty, error) {

	return &empty.Empty{}, nil
}

func (s *ApiServer) UpdateAchievementProgress(ctx context.Context, in *api.AchievementProgressUpdate) (*empty.Empty, error) {

	return &empty.Empty{}, nil
}
