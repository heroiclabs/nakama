package hiro

import (
	"context"

	"github.com/heroiclabs/nakama-common/runtime"
)

const NotificationCodeChallengeInvite = -1000

type ChallengesConfig struct {
	Challenges map[string]*ChallengesConfigChallenge `json:"challenges,omitempty"`
}

type ChallengesConfigChallenge struct {
	RewardTiers          []*ChallengesConfigChallengeRewardTier `json:"reward_tiers,omitempty"`
	AdditionalProperties map[string]string                      `json:"additional_properties,omitempty"`
	MaxNumScore          int64                                  `json:"max_num_score,omitempty"`
	StartDelayMaxSec     int64                                  `json:"start_delay_max_sec,omitempty"`
	Ascending            bool                                   `json:"ascending,omitempty"`
	Operator             string                                 `json:"operator,omitempty"`
	Duration             *ChallengesConfigDuration              `json:"duration,omitempty"`
	Players              *ChallengesConfigPlayers               `json:"players,omitempty"`
}

type ChallengesConfigChallengeRewardTier struct {
	RankMax int64                `json:"rank_max,omitempty"`
	RankMin int64                `json:"rank_min,omitempty"`
	Reward  *EconomyConfigReward `json:"reward,omitempty"`
}

type ChallengesConfigDuration struct {
	MinSec int64 `json:"min_sec,omitempty"`
	MaxSec int64 `json:"max_sec,omitempty"`
}

type ChallengesConfigPlayers struct {
	Min int64 `json:"min,omitempty"`
	Max int64 `json:"max,omitempty"`
}

type ChallengesSystem interface {
	System

	// GetTemplates lists all available challenge configurations that can be used to create new challenges.
	GetTemplates(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string) (*ChallengeTemplates, error)

	// Get returns a challenge the user has been invited to or which is participating in.
	Get(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, challengeId, userId string, withScores bool) (*Challenge, error)

	// List Lists all the user's pending or joined challenges.
	List(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userId string, categories []string, withScores bool) ([]*Challenge, error)

	// Create a new challenge for a list of users.
	Create(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userId, templateId, name, description, category string, open bool, startDelaySec, durationSec int64, invitees []string, maxPlayers int64, metadata map[string]string) (*Challenge, error)

	// Invite allows the creator of a challenge to invite more players to it.
	Invite(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userId, challengeId string, invitees []string) (challenge *Challenge, err error)

	// Join Joins a challenge the user's been invited to.
	Join(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userId, challengeId string) (*Challenge, error)

	// Leave rejects a challenge invitation or abandons a joined challenge.
	Leave(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userId, challengeId string) (*Challenge, error)

	// SubmitScore submits a new score to the challenge.
	SubmitScore(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userId, challengeId string, score, subscore int64, metadata map[string]any, conditionalMetadataUpdate bool) (challenge *Challenge, err error)

	// Search allows to find open challenges that are not full.
	Search(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, name, category string, limit int) ([]*Challenge, error)

	// Claim claims a reward of a challenge, if any.
	Claim(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userId, challengeId string) (*Challenge, error)

	// SetOnReward sets a custom reward function which will run after a challenge reward has been claimed.
	SetOnReward(fn OnReward[*Challenge])
}
