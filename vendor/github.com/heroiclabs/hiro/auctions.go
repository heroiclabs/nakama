// Copyright 2024 Heroic Labs & Contributors
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

	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/protobuf/encoding/protojson"
)

var (
	ErrAuctionTemplateNotFound  = runtime.NewError("auction template not found", 3)     // INVALID_ARGUMENT
	ErrAuctionConditionNotFound = runtime.NewError("auction condition not found", 3)    // INVALID_ARGUMENT
	ErrAuctionItemsInvalid      = runtime.NewError("auction items invalid", 3)          // INVALID_ARGUMENT
	ErrAuctionNotFound          = runtime.NewError("auction not found", 3)              // INVALID_ARGUMENT
	ErrAuctionVersionMismatch   = runtime.NewError("auction version mismatch", 3)       // INVALID_ARGUMENT
	ErrAuctionOwnBid            = runtime.NewError("cannot bid on own auction", 3)      // INVALID_ARGUMENT
	ErrAuctionAlreadyBid        = runtime.NewError("already high bidder on auction", 3) // INVALID_ARGUMENT
	ErrAuctionNotStarted        = runtime.NewError("auction not started", 3)            // INVALID_ARGUMENT
	ErrAuctionEnded             = runtime.NewError("auction ended", 3)                  // INVALID_ARGUMENT
	ErrAuctionBidInsufficient   = runtime.NewError("auction bid insufficient", 3)       // INVALID_ARGUMENT
	ErrAuctionBidInvalid        = runtime.NewError("auction bid invalid", 3)            // INVALID_ARGUMENT
	ErrAuctionCannotClaim       = runtime.NewError("auction cannot be claimed", 3)      // INVALID_ARGUMENT
	ErrAuctionCannotCancel      = runtime.NewError("auction cannot be cancelled", 3)    // INVALID_ARGUMENT
)

// AuctionsConfig is the data definition for the AuctionsSystem type.
type AuctionsConfig struct {
	Auctions map[string]*AuctionsConfigAuction `json:"auctions,omitempty"`
}

type AuctionsConfigAuction struct {
	Items           []string                                   `json:"items,omitempty"`
	ItemSets        []string                                   `json:"item_sets,omitempty"`
	Conditions      map[string]*AuctionsConfigAuctionCondition `json:"conditions,omitempty"`
	BidHistoryCount int                                        `json:"bid_history_count,omitempty"`
}

type AuctionsConfigAuctionCondition struct {
	DurationSec           int64                                       `json:"duration_sec,omitempty"`
	ListingCost           *AuctionsConfigAuctionConditionCost         `json:"listing_cost,omitempty"`
	BidStart              *AuctionsConfigAuctionConditionBid          `json:"bid_start,omitempty"`
	BidIncrement          *AuctionsConfigAuctionConditionBidIncrement `json:"bid_increment,omitempty"`
	ExtensionThresholdSec int64                                       `json:"extension_threshold_sec,omitempty"`
	ExtensionSec          int64                                       `json:"extension_sec,omitempty"`
	ExtensionMaxSec       int64                                       `json:"extension_max_sec,omitempty"`
	Fee                   *AuctionsConfigAuctionConditionFee          `json:"fee,omitempty"`
}

type AuctionsConfigAuctionConditionCost struct {
	Currencies map[string]int64 `json:"currencies,omitempty"`
	Energies   map[string]int64 `json:"energies,omitempty"`
	Items      map[string]int64 `json:"items,omitempty"`
}

type AuctionsConfigAuctionConditionBid struct {
	Currencies map[string]int64 `json:"currencies,omitempty"`
}

type AuctionsConfigAuctionConditionBidIncrement struct {
	Percentage float64                            `json:"percentage,omitempty"`
	Fixed      *AuctionsConfigAuctionConditionBid `json:"fixed,omitempty"`
}

type AuctionsConfigAuctionConditionFee struct {
	Percentage float64                            `json:"percentage,omitempty"`
	Fixed      *AuctionsConfigAuctionConditionBid `json:"fixed,omitempty"`
}

type OnAuctionReward[T any] func(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, sourceID string, source *Auction, reward T) (T, error)

// The AuctionsSystem provides a gameplay system for Auctions and their listing, bidding, and timers.
//
// Players list items for auctioning, bid on other auctions, and collect their rewards when appropriate.
type AuctionsSystem interface {
	System

	// GetTemplates lists all available auction configurations that can be used to create auction listings.
	GetTemplates(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string) (*AuctionTemplates, error)

	// List auctions based on provided criteria.
	List(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, query string, sort []string, limit int, cursor string) (*AuctionList, error)

	// Bid on an active auction.
	Bid(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, sessionID, auctionID, version string, bid *AuctionBidAmount, marshaler *protojson.MarshalOptions) (*Auction, error)

	// ClaimBid claims a completed auction as the successful bidder.
	ClaimBid(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, auctionID string) (*AuctionClaimBid, error)

	// ClaimCreated claims a completed auction as the auction creator.
	ClaimCreated(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, auctionID string) (*AuctionClaimCreated, error)

	// Cancel an active auction before it reaches its scheduled end time.
	Cancel(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, auctionID string) (*AuctionCancel, error)

	// Create a new auction based on supplied parameters and available configuration.
	Create(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, templateID, conditionID string, instanceIDs []string, startTimeSec int64, items []*InventoryItem, overrideConfig *AuctionsConfigAuction) (*Auction, error)

	// ListBids returns auctions the user has successfully bid on.
	ListBids(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, limit int, cursor string) (*AuctionList, error)

	// ListCreated returns auctions the user has created.
	ListCreated(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, limit int, cursor string) (*AuctionList, error)

	// Follow ensures users receive real-time updates for auctions they have an interest in.
	Follow(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, sessionID string, auctionIDs []string) (*AuctionList, error)

	// SetOnClaimBid sets a custom reward function which will run after an auction's reward is claimed by the winning bidder.
	SetOnClaimBid(fn OnAuctionReward[*AuctionReward])

	// SetOnClaimCreated sets a custom reward function which will run after an auction's winning bid is claimed by the auction creator.
	SetOnClaimCreated(fn OnAuctionReward[*AuctionBidAmount])

	// SetOnClaimCreatedFailed sets a custom reward function which will run after a failed auction is claimed by the auction creator.
	SetOnClaimCreatedFailed(fn OnAuctionReward[*AuctionReward])

	// SetOnCancel sets a custom reward function which will run after an auction is cancelled by the auction creator.
	SetOnCancel(fn OnAuctionReward[*AuctionReward])
}
