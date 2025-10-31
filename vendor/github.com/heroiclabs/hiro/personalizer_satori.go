// Copyright 2023 Heroic Labs & Contributors
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

package hiro

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unique"

	"github.com/heroiclabs/nakama-common/runtime"
)

var _ Publisher = (*SatoriPersonalizer)(nil)

var _ Personalizer = (*SatoriPersonalizer)(nil)

type SatoriPersonalizerOption interface {
	apply(*SatoriPersonalizer)
}

type satoriPersonalizerOptionFunc struct {
	f func(*SatoriPersonalizer)
}

func (s *satoriPersonalizerOptionFunc) apply(personalizer *SatoriPersonalizer) {
	s.f(personalizer)
}

func SatoriPersonalizerPublishAuthenticateEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishAuthenticateRequest = true
		},
	}
}

func SatoriPersonalizerPublishAuthenticateEventsWithSession() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishAuthenticateRequest = true
			personalizer.publishAuthenticateRequestWithSession = true
		},
	}
}

func SatoriPersonalizerPublishAchievementsEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishAchievementsEvents = true
		},
	}
}

func SatoriPersonalizerPublishBaseEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishBaseEvents = true
		},
	}
}

func SatoriPersonalizerPublishEconomyEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishEconomyEvents = true
		},
	}
}

func SatoriPersonalizerPublishEnergyEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishEnergyEvents = true
		},
	}
}

func SatoriPersonalizerPublishEventLeaderboardsEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishEventLeaderboardsEvents = true
		},
	}
}

func SatoriPersonalizerPublishIncentivesEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishIncentivesEvents = true
		},
	}
}

func SatoriPersonalizerPublishInventoryEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishInventoryEvents = true
		},
	}
}

func SatoriPersonalizerPublishLeaderboardsEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishLeaderboardsEvents = true
		},
	}
}

func SatoriPersonalizerPublishProgressionEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishProgressionEvents = true
		},
	}
}

func SatoriPersonalizerPublishStatsEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishStatsEvents = true
		},
	}
}

func SatoriPersonalizerPublishTeamsEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishTeamsEvents = true
		},
	}
}

func SatoriPersonalizerPublishTutorialsEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishTutorialsEvents = true
		},
	}
}

func SatoriPersonalizerPublishUnlockablesEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishUnlockablesEvents = true
		},
	}
}

func SatoriPersonalizerPublishAuctionsEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishAuctionsEvents = true
		},
	}
}

func SatoriPersonalizerPublishStreaksEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishStreaksEvents = true
		},
	}
}

func SatoriPersonalizerPublishChallengeEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishChallengeEvents = true
		},
	}
}

func SatoriPersonalizerPublishAllEvents() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.publishAll = true
		},
	}
}

func SatoriPersonalizerNoCache() SatoriPersonalizerOption {
	return &satoriPersonalizerOptionFunc{
		f: func(personalizer *SatoriPersonalizer) {
			personalizer.noCache = true
		},
	}
}

type SatoriPersonalizerCache struct {
	flags      map[string]unique.Handle[string]
	liveEvents *atomic.Pointer[runtime.LiveEventList]
}

type SatoriPersonalizer struct {
	publishAll bool

	publishAuthenticateRequest            bool
	publishAuthenticateRequestWithSession bool

	publishAchievementsEvents      bool
	publishBaseEvents              bool
	publishEconomyEvents           bool
	publishEnergyEvents            bool
	publishEventLeaderboardsEvents bool
	publishIncentivesEvents        bool
	publishInventoryEvents         bool
	publishLeaderboardsEvents      bool
	publishProgressionEvents       bool
	publishStatsEvents             bool
	publishTeamsEvents             bool
	publishTutorialsEvents         bool
	publishUnlockablesEvents       bool
	publishAuctionsEvents          bool
	publishStreaksEvents           bool
	publishChallengeEvents         bool

	noCache bool

	cacheMutex sync.RWMutex
	cache      map[context.Context]*SatoriPersonalizerCache
}

func (p *SatoriPersonalizer) Authenticate(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, created bool) {
	if !p.IsPublishAuthenticateRequest() && !p.IsPublishAuthenticateRequestWithSession() {
		return
	}
	if _, err := nk.GetSatori().Authenticate(ctx, userID, nil, nil, p.IsPublishAuthenticateRequestWithSession()); err != nil && !errors.Is(err, runtime.ErrSatoriConfigurationInvalid) {
		logger.WithField("error", err.Error()).Error("failed to authenticate with Satori")
	}
}

func (p *SatoriPersonalizer) Send(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, events []*PublisherEvent) {
	if len(events) == 0 {
		return
	}

	satoriEvents := make([]*runtime.Event, 0, len(events))
	for _, event := range events {
		switch event.System.GetType() {
		case SystemTypeAchievements:
			if !p.IsPublishAchievementsEvents() {
				continue
			}
		case SystemTypeBase:
			if !p.IsPublishBaseEvents() {
				continue
			}
		case SystemTypeEconomy:
			if !p.IsPublishEconomyEvents() {
				continue
			}
		case SystemTypeEnergy:
			if !p.IsPublishEnergyEvents() {
				continue
			}
		case SystemTypeInventory:
			if !p.IsPublishInventoryEvents() {
				continue
			}
		case SystemTypeLeaderboards:
			if !p.IsPublishLeaderboardsEvents() {
				continue
			}
		case SystemTypeTeams:
			if !p.IsPublishTeamsEvents() {
				continue
			}
		case SystemTypeTutorials:
			if !p.IsPublishTutorialsEvents() {
				continue
			}
		case SystemTypeUnlockables:
			if !p.IsPublishUnlockablesEvents() {
				continue
			}
		case SystemTypeStats:
			if !p.IsPublishStatsEvents() {
				continue
			}
		case SystemTypeEventLeaderboards:
			if !p.IsPublishEventLeaderboardsEvents() {
				continue
			}
		case SystemTypeProgression:
			if !p.IsPublishProgressionEvents() {
				continue
			}
		case SystemTypeIncentives:
			if !p.IsPublishIncentivesEvents() {
				continue
			}
		case SystemTypeAuctions:
			if !p.IsPublishAuctionsEvents() {
				continue
			}
		case SystemTypeStreaks:
			if !p.IsPublishStreaksEvents() {
				continue
			}
		case SystemTypeChallenges:
			if !p.IsPublishChallengeEvents() {
				continue
			}
		default:
		}

		satoriEvent := &runtime.Event{
			Name:      event.Name,
			Id:        event.Id,
			Metadata:  event.Metadata,
			Value:     event.Value,
			Timestamp: event.Timestamp,
		}
		satoriEvents = append(satoriEvents, satoriEvent)
	}
	if len(satoriEvents) == 0 {
		return
	}
	if err := nk.GetSatori().EventsPublish(ctx, userID, satoriEvents); err != nil {
		logger.WithField("error", err.Error()).Error("failed to publish Satori events")
	}
}

func NewSatoriPersonalizer(ctx context.Context, opts ...SatoriPersonalizerOption) *SatoriPersonalizer {
	s := &SatoriPersonalizer{
		cacheMutex: sync.RWMutex{},
		cache:      make(map[context.Context]*SatoriPersonalizerCache),
	}

	// Apply options, if any supplied.
	for _, opt := range opts {
		opt.apply(s)
	}

	if !s.noCache {
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					s.cacheMutex.Lock()
					for cacheCtx := range s.cache {
						if cacheCtx.Err() != nil {
							delete(s.cache, cacheCtx)
						}
					}
					s.cacheMutex.Unlock()
				}
			}
		}()
	}

	return s
}

var allFlagNames = []string{"Hiro-Achievements", "Hiro-Base", "Hiro-Economy", "Hiro-Energy", "Hiro-Inventory", "Hiro-Leaderboards", "Hiro-Teams", "Hiro-Tutorials", "Hiro-Unlockables", "Hiro-Stats", "Hiro-Event-Leaderboards", "Hiro-Progression", "Hiro-Incentives", "Hiro-Auctions", "Hiro-Streaks", "Hiro-Challenges", "Hiro-Reward-Mailbox"}

func (p *SatoriPersonalizer) GetValue(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, system System, userID string) (any, error) {
	var flagName string
	switch system.GetType() {
	case SystemTypeAchievements:
		flagName = "Hiro-Achievements"
	case SystemTypeBase:
		flagName = "Hiro-Base"
	case SystemTypeEconomy:
		flagName = "Hiro-Economy"
	case SystemTypeEnergy:
		flagName = "Hiro-Energy"
	case SystemTypeInventory:
		flagName = "Hiro-Inventory"
	case SystemTypeLeaderboards:
		flagName = "Hiro-Leaderboards"
	case SystemTypeTeams:
		flagName = "Hiro-Teams"
	case SystemTypeTutorials:
		flagName = "Hiro-Tutorials"
	case SystemTypeUnlockables:
		flagName = "Hiro-Unlockables"
	case SystemTypeStats:
		flagName = "Hiro-Stats"
	case SystemTypeEventLeaderboards:
		flagName = "Hiro-Event-Leaderboards"
	case SystemTypeProgression:
		flagName = "Hiro-Progression"
	case SystemTypeIncentives:
		flagName = "Hiro-Incentives"
	case SystemTypeAuctions:
		flagName = "Hiro-Auctions"
	case SystemTypeStreaks:
		flagName = "Hiro-Streaks"
	case SystemTypeChallenges:
		flagName = "Hiro-Challenges"
	case SystemTypeRewardMailbox:
		flagName = "Hiro-Reward-Mailbox"
	default:
		return nil, runtime.NewError("hiro system type unknown", 3)
	}

	var config any
	var found bool

	if p.noCache {
		flagList, err := nk.GetSatori().FlagsList(ctx, userID, flagName)
		if err != nil {
			if strings.Contains(err.Error(), "404 status code") {
				logger.WithField("userID", userID).WithField("error", err.Error()).Warn("error requesting Satori flag list, user not found")
				return nil, nil
			}
			logger.WithField("userID", userID).WithField("error", err.Error()).Error("error requesting Satori flag list")
			return nil, err
		}

		if len(flagList.Flags) >= 1 {
			config = system.GetConfig()
			decoder := json.NewDecoder(strings.NewReader(flagList.Flags[0].Value))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(config); err != nil {
				logger.WithField("userID", userID).WithField("error", err.Error()).Error("error merging Satori flag value")
				return nil, err
			}
			found = true
		}

		if s := system.GetType(); s == SystemTypeEventLeaderboards || s == SystemTypeAchievements {
			// If looking at event leaderboards, also load live events.
			liveEventsList, err := nk.GetSatori().LiveEventsList(ctx, userID)
			if err != nil {
				if strings.Contains(err.Error(), "404 status code") {
					logger.WithField("userID", userID).WithField("error", err.Error()).Warn("error requesting Satori live events list, user not found")
					return nil, nil
				}
				logger.WithField("userID", userID).WithField("error", err.Error()).Error("error requesting Satori live events list")
				return nil, err
			}
			if len(liveEventsList.LiveEvents) > 0 {
				if config == nil {
					config = system.GetConfig()
				}
				for _, liveEvent := range liveEventsList.LiveEvents {
					decoder := json.NewDecoder(strings.NewReader(liveEvent.Value))
					decoder.DisallowUnknownFields()
					if err := decoder.Decode(config); err != nil {
						// The live event may be intended for a different purpose, do not log or return an error here.
						continue
					}
					found = true
				}
			}
		}
	} else {
		var cacheEntry *SatoriPersonalizerCache
		p.cacheMutex.RLock()
		cacheEntry, found = p.cache[ctx]
		p.cacheMutex.RUnlock()

		if !found {
			flagList, err := nk.GetSatori().FlagsList(ctx, userID, allFlagNames...)
			if err != nil {
				if strings.Contains(err.Error(), "404 status code") {
					logger.WithField("userID", userID).WithField("error", err.Error()).Warn("error requesting Satori flag list, user not found")
					return nil, nil
				}
				logger.WithField("userID", userID).WithField("error", err.Error()).Error("error requesting Satori flag list")
				return nil, err
			}

			var liveEventsList *runtime.LiveEventList
			if s := system.GetType(); s == SystemTypeEventLeaderboards || s == SystemTypeAchievements {
				liveEventsList, err = nk.GetSatori().LiveEventsList(ctx, userID)
				if err != nil {
					if strings.Contains(err.Error(), "404 status code") {
						logger.WithField("userID", userID).WithField("error", err.Error()).Warn("error requesting Satori live events list, user not found")
						return nil, nil
					}
					logger.WithField("userID", userID).WithField("error", err.Error()).Error("error requesting Satori live events list")
					return nil, err
				}
			}

			cacheEntry = &SatoriPersonalizerCache{
				// flags set below.
				liveEvents: &atomic.Pointer[runtime.LiveEventList]{},
			}
			if flagList != nil {
				cacheEntry.flags = make(map[string]unique.Handle[string], len(flagList.Flags))
				for _, flag := range flagList.Flags {
					cacheEntry.flags[flag.Name] = unique.Make[string](flag.Value)
				}
			}
			if liveEventsList != nil {
				cacheEntry.liveEvents.Store(liveEventsList)
			}
			p.cacheMutex.Lock()
			p.cache[ctx] = cacheEntry
			p.cacheMutex.Unlock()
		}

		if s := system.GetType(); (s == SystemTypeEventLeaderboards || s == SystemTypeAchievements) && cacheEntry.liveEvents.Load() == nil {
			liveEventsList, err := nk.GetSatori().LiveEventsList(ctx, userID)
			if err != nil {
				if strings.Contains(err.Error(), "404 status code") {
					logger.WithField("userID", userID).WithField("error", err.Error()).Warn("error requesting Satori live events list, user not found")
					return nil, nil
				}
				logger.WithField("userID", userID).WithField("error", err.Error()).Error("error requesting Satori live events list")
				return nil, err
			}
			cacheEntry.liveEvents.Store(liveEventsList)
		}

		found = false

		for flName, flHandle := range cacheEntry.flags {
			if flName != flagName {
				continue
			}

			config = system.GetConfig()
			decoder := json.NewDecoder(strings.NewReader(flHandle.Value()))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(config); err != nil {
				logger.WithField("userID", userID).WithField("error", err.Error()).Error("error merging Satori flag value")
				return nil, err
			}
			found = true
		}

		if liveEventsList := cacheEntry.liveEvents.Load(); liveEventsList != nil && len(liveEventsList.LiveEvents) > 0 {
			if config == nil {
				config = system.GetConfig()
			}
			for _, liveEvent := range liveEventsList.LiveEvents {
				decoder := json.NewDecoder(strings.NewReader(liveEvent.Value))
				decoder.DisallowUnknownFields()
				if err := decoder.Decode(config); err != nil {
					// The live event may be intended for a different purpose, do not log or return an error here.
					continue
				}
				found = true
			}
		}
	}

	// If this caller doesn't have the given flag (or live events) return the nil to indicate no change to the config.
	if !found {
		return nil, nil
	}

	return config, nil
}

func (p *SatoriPersonalizer) IsPublishAuthenticateRequest() bool {
	return p.publishAll || p.publishAuthenticateRequest
}

func (p *SatoriPersonalizer) IsPublishAuthenticateRequestWithSession() bool {
	return p.publishAuthenticateRequestWithSession
}

func (p *SatoriPersonalizer) IsPublishAchievementsEvents() bool {
	return p.publishAll || p.publishAchievementsEvents
}

func (p *SatoriPersonalizer) IsPublishBaseEvents() bool {
	return p.publishAll || p.publishBaseEvents
}

func (p *SatoriPersonalizer) IsPublishEconomyEvents() bool {
	return p.publishAll || p.publishEconomyEvents
}

func (p *SatoriPersonalizer) IsPublishEnergyEvents() bool {
	return p.publishAll || p.publishEnergyEvents
}

func (p *SatoriPersonalizer) IsPublishEventLeaderboardsEvents() bool {
	return p.publishAll || p.publishEventLeaderboardsEvents
}

func (p *SatoriPersonalizer) IsPublishIncentivesEvents() bool {
	return p.publishAll || p.publishIncentivesEvents
}

func (p *SatoriPersonalizer) IsPublishInventoryEvents() bool {
	return p.publishAll || p.publishInventoryEvents
}

func (p *SatoriPersonalizer) IsPublishLeaderboardsEvents() bool {
	return p.publishAll || p.publishLeaderboardsEvents
}

func (p *SatoriPersonalizer) IsPublishProgressionEvents() bool {
	return p.publishAll || p.publishProgressionEvents
}

func (p *SatoriPersonalizer) IsPublishStatsEvents() bool {
	return p.publishAll || p.publishStatsEvents
}

func (p *SatoriPersonalizer) IsPublishTeamsEvents() bool {
	return p.publishAll || p.publishTeamsEvents
}

func (p *SatoriPersonalizer) IsPublishTutorialsEvents() bool {
	return p.publishAll || p.publishTutorialsEvents
}

func (p *SatoriPersonalizer) IsPublishUnlockablesEvents() bool {
	return p.publishAll || p.publishUnlockablesEvents
}

func (p *SatoriPersonalizer) IsPublishAuctionsEvents() bool {
	return p.publishAll || p.publishAuctionsEvents
}

func (p *SatoriPersonalizer) IsPublishStreaksEvents() bool {
	return p.publishAll || p.publishStreaksEvents
}

func (p *SatoriPersonalizer) IsPublishChallengeEvents() bool {
	return p.publishAll || p.publishChallengeEvents
}
