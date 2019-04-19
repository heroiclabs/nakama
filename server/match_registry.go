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
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/analysis/analyzer/keyword"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/pkg/errors"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

var (
	MatchFilterValue = uint8(0)
	MatchFilterPtr   = &MatchFilterValue

	MatchFilterAny           = map[uint8]*uint8{StreamModeMatchRelayed: MatchFilterPtr, StreamModeMatchAuthoritative: MatchFilterPtr}
	MatchFilterRelayed       = map[uint8]*uint8{StreamModeMatchRelayed: MatchFilterPtr}
	MatchFilterAuthoritative = map[uint8]*uint8{StreamModeMatchAuthoritative: MatchFilterPtr}

	MaxLabelSize = 2048

	ErrMatchLabelTooLong     = errors.New("match label too long, must be 0-2048 bytes")
	ErrDeferredBroadcastFull = errors.New("too many deferred message broadcasts per tick")
	ErrNoJoinMarker          = errors.New("no join marker received")
)

type MatchIndexEntry struct {
	Node        string                 `json:"node"`
	Label       map[string]interface{} `json:"label"`
	LabelString string                 `json:"label_string"`
}

type MatchJoinResult struct {
	Allow  bool
	Reason string
	Label  string
}

type MatchRegistry interface {
	// Create and start a new match, given a Lua module name or registered Go match function.
	CreateMatch(ctx context.Context, logger *zap.Logger, createFn RuntimeMatchCreateFunction, module string, params map[string]interface{}) (string, error)
	// Register and initialise a match that's ready to run.
	NewMatch(logger *zap.Logger, id uuid.UUID, core RuntimeMatchCore, params map[string]interface{}) (*MatchHandler, error)
	// Return a match handler by ID, only from the local node.
	GetMatch(id uuid.UUID) *MatchHandler
	// Remove a tracked match and ensure all its presences are cleaned up.
	// Does not ensure the match process itself is no longer running, that must be handled separately.
	RemoveMatch(id uuid.UUID, stream PresenceStream)
	// Get the label for a match.
	GetMatchLabel(ctx context.Context, id uuid.UUID, node string) (string, error)
	// Update the label entry for a given match.
	UpdateMatchLabel(id uuid.UUID, label string) error
	// List (and optionally filter) currently running matches.
	// This can list across both authoritative and relayed matches.
	ListMatches(ctx context.Context, limit int, authoritative *wrappers.BoolValue, label *wrappers.StringValue, minSize *wrappers.Int32Value, maxSize *wrappers.Int32Value, query *wrappers.StringValue) ([]*api.Match, error)
	// Stop the match registry and close all matches it's tracking.
	Stop(graceSeconds int) chan struct{}
	// Returns the total number of currently active authoritative matches.
	Count() int

	// Pass a user join attempt to a match handler. Returns if the match was found, if the join was accepted, a reason for any rejection, and the match label.
	JoinAttempt(ctx context.Context, id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, metadata map[string]string) (bool, bool, string, string)
	// Notify a match handler that one or more users have successfully joined the match.
	// Expects that the caller has already determined the match is hosted on the current node.
	Join(id uuid.UUID, presences []*MatchPresence)
	// Notify a match handler that one or more users have left or disconnected.
	// Expects that the caller has already determined the match is hosted on the current node.
	Leave(id uuid.UUID, presences []*MatchPresence)
	// Called by match handlers to request the removal fo a match participant.
	Kick(stream PresenceStream, presences []*MatchPresence)
	// Pass a data payload (usually from a user) to the appropriate match handler.
	// Assumes that the data sender has already been validated as a match participant before this call.
	SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte, receiveTime int64)
}

type LocalMatchRegistry struct {
	sync.RWMutex
	logger  *zap.Logger
	config  Config
	tracker Tracker
	router  MessageRouter
	node    string
	matches map[uuid.UUID]*MatchHandler
	index   bleve.Index

	stopped   *atomic.Bool
	stoppedCh chan struct{}
}

func NewLocalMatchRegistry(logger, startupLogger *zap.Logger, config Config, tracker Tracker, router MessageRouter, node string) MatchRegistry {
	mapping := bleve.NewIndexMapping()
	mapping.DefaultAnalyzer = keyword.Name

	index, err := bleve.NewMemOnly(mapping)
	if err != nil {
		startupLogger.Fatal("Failed to create match registry index", zap.Error(err))
	}

	return &LocalMatchRegistry{
		logger:  logger,
		config:  config,
		tracker: tracker,
		router:  router,
		node:    node,
		matches: make(map[uuid.UUID]*MatchHandler),
		index:   index,

		stopped:   atomic.NewBool(false),
		stoppedCh: make(chan struct{}, 2),
	}
}

func (r *LocalMatchRegistry) CreateMatch(ctx context.Context, logger *zap.Logger, createFn RuntimeMatchCreateFunction, module string, params map[string]interface{}) (string, error) {
	id := uuid.Must(uuid.NewV4())
	matchLogger := logger.With(zap.String("mid", id.String()))

	core, err := createFn(ctx, matchLogger, id, r.node, module)
	if err != nil {
		return "", err
	}
	if core == nil {
		return "", errors.New("error creating match: not found")
	}

	// Start the match.
	mh, err := r.NewMatch(matchLogger, id, core, params)
	if err != nil {
		return "", fmt.Errorf("error creating match: %v", err.Error())
	}

	return mh.IDStr, nil
}

func (r *LocalMatchRegistry) NewMatch(logger *zap.Logger, id uuid.UUID, core RuntimeMatchCore, params map[string]interface{}) (*MatchHandler, error) {
	if r.stopped.Load() {
		// Server is shutting down, reject new matches.
		return nil, errors.New("shutdown in progress")
	}

	match, err := NewMatchHandler(logger, r.config, r, r.router, core, id, r.node, params)
	if err != nil {
		return nil, err
	}

	r.Lock()
	r.matches[id] = match
	r.Unlock()
	return match, nil
}

func (r *LocalMatchRegistry) GetMatch(id uuid.UUID) *MatchHandler {
	var mh *MatchHandler
	r.RLock()
	mh = r.matches[id]
	r.RUnlock()
	return mh
}

func (r *LocalMatchRegistry) RemoveMatch(id uuid.UUID, stream PresenceStream) {
	r.Lock()
	delete(r.matches, id)
	matchesRemaining := len(r.matches)
	r.Unlock()
	r.tracker.UntrackByStream(stream)
	r.index.Delete(fmt.Sprintf("%v.%v", id.String(), r.node))

	// If there are no more matches in this registry and a shutdown was initiated then signal
	// that the process is complete.
	if matchesRemaining == 0 && r.stopped.Load() {
		select {
		case r.stoppedCh <- struct{}{}:
		default:
			// Ignore if the signal has already been sent.
		}
	}
}

func (r *LocalMatchRegistry) GetMatchLabel(ctx context.Context, id uuid.UUID, node string) (string, error) {
	query := bleve.NewDocIDQuery([]string{fmt.Sprintf("%v.%v", id.String(), node)})
	search := bleve.NewSearchRequestOptions(query, 1, 0, false)
	search.Fields = []string{"label_string"}
	results, err := r.index.SearchInContext(ctx, search)
	if err != nil {
		return "", fmt.Errorf("error getting match label: %v", err.Error())
	}
	if results.Hits.Len() == 0 {
		// No such match or label is not available yet.
		return "", nil
	}
	label, ok := results.Hits[0].Fields["label_string"].(string)
	if !ok {
		// Label was not a string, should not happen.
		return "", errors.New("error getting match label: not a valid label string")
	}
	return label, nil
}

func (r *LocalMatchRegistry) UpdateMatchLabel(id uuid.UUID, label string) error {
	if len(label) > MaxLabelSize {
		return ErrMatchLabelTooLong
	}

	var labelJSON map[string]interface{}
	// Doesn't matter if this is not JSON.
	json.Unmarshal([]byte(label), &labelJSON)
	return r.index.Index(fmt.Sprintf("%v.%v", id.String(), r.node), &MatchIndexEntry{
		Node:        r.node,
		Label:       labelJSON,
		LabelString: label,
	})
}

func (r *LocalMatchRegistry) ListMatches(ctx context.Context, limit int, authoritative *wrappers.BoolValue, label *wrappers.StringValue, minSize *wrappers.Int32Value, maxSize *wrappers.Int32Value, query *wrappers.StringValue) ([]*api.Match, error) {
	if limit == 0 {
		return make([]*api.Match, 0), nil
	}

	var modes map[uint8]*uint8
	var labelResults *bleve.SearchResult
	var orderRequired bool
	if query != nil {
		if authoritative != nil && !authoritative.Value {
			// A filter on query is requested but authoritative matches are not allowed.
			return make([]*api.Match, 0), nil
		}

		// If there are filters other than query, we don't know which matches will work so get more than the limit.
		count := limit
		if minSize != nil || maxSize != nil {
			c, err := r.index.DocCount()
			if err != nil {
				return nil, fmt.Errorf("error listing matches count: %v", err.Error())
			}
			count = int(c)
		}

		// Apply the query filter to the set of known match labels.
		queryString := query.Value
		if queryString == "" {
			queryString = "*"
		}
		indexQuery := bleve.NewQueryStringQuery(queryString)
		search := bleve.NewSearchRequestOptions(indexQuery, count, 0, false)
		search.Fields = []string{"label_string"}
		var err error
		labelResults, err = r.index.SearchInContext(ctx, search)
		if err != nil {
			return nil, fmt.Errorf("error listing matches by query: %v", err.Error())
		}

		// Because we have a query filter only authoritative matches are eligible.
		modes = MatchFilterAuthoritative
		// The query may contain boosting, in which case the order of results matters.
		orderRequired = true
	} else if label != nil {
		if authoritative != nil && !authoritative.Value {
			// A filter on label is requested but authoritative matches are not allowed.
			return make([]*api.Match, 0), nil
		}

		// If there are filters other than label, we don't know which matches will work so get more than the limit.
		count := limit
		if minSize != nil || maxSize != nil {
			c, err := r.index.DocCount()
			if err != nil {
				return nil, fmt.Errorf("error listing matches count: %v", err.Error())
			}
			count = int(c)
		}

		// Apply the label filter to the set of known match labels.
		indexQuery := bleve.NewMatchQuery(label.Value)
		indexQuery.SetField("label_string")
		search := bleve.NewSearchRequestOptions(indexQuery, int(count), 0, false)
		search.Fields = []string{"label_string"}
		var err error
		labelResults, err = r.index.SearchInContext(ctx, search)
		if err != nil {
			return nil, fmt.Errorf("error listing matches by label: %v", err.Error())
		}

		// Because we have a query filter only authoritative matches are eligible.
		modes = MatchFilterAuthoritative
	} else if authoritative == nil || authoritative.Value {
		// Not using label/query filter but we still need access to the indexed labels to return them
		// if authoritative matches may be included in the results.
		count, err := r.index.DocCount()
		if err != nil {
			return nil, fmt.Errorf("error listing matches count: %v", err.Error())
		}
		indexQuery := bleve.NewMatchAllQuery()
		search := bleve.NewSearchRequestOptions(indexQuery, int(count), 0, false)
		search.Fields = []string{"label_string"}
		labelResults, err = r.index.SearchInContext(ctx, search)
		if err != nil {
			return nil, fmt.Errorf("error listing matches by label: %v", err.Error())
		}

		if authoritative == nil {
			// Expect a possible mix of authoritative and relayed matches.
			modes = MatchFilterAny
		} else {
			// Authoritative was strictly true even if there was no label/query filter.
			modes = MatchFilterAuthoritative
		}
	} else {
		// Authoritative was strictly false, and there was no label/query filter.
		modes = MatchFilterRelayed
	}

	if labelResults != nil && labelResults.Hits.Len() == 0 && authoritative != nil && !authoritative.Value {
		// No results based on label/query, no point in further filtering by size.
		return make([]*api.Match, 0), nil
	}

	// There is a query which may contain boosted search terms, which means order of results matters.
	if orderRequired {
		// Look up tracker info to determine match sizes.
		// This info is needed even if there is no min/max size filter because it's returned in results.
		matches := r.tracker.CountByStreamModeFilter(modes)
		matchSizes := make(map[string]int32, len(matches))
		for stream, size := range matches {
			matchSizes[fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label)] = size
		}

		// Results.
		results := make([]*api.Match, 0, limit)

		for _, hit := range labelResults.Hits {
			// Size may be 0.
			size := matchSizes[hit.ID]

			if minSize != nil && minSize.Value > size {
				// Not eligible based on minimum size.
				continue
			}

			if maxSize != nil && maxSize.Value < size {
				// Not eligible based on maximum size.
				continue
			}

			var labelString string
			if l, ok := hit.Fields["label_string"]; ok {
				if labelString, ok = l.(string); !ok {
					r.logger.Warn("Field not a string in match registry label cache: label_string")
					continue
				}
			} else {
				r.logger.Warn("Field not found in match registry label cache: label_string")
				continue
			}

			results = append(results, &api.Match{
				MatchId:       hit.ID,
				Authoritative: true,
				Label:         &wrappers.StringValue{Value: labelString},
				Size:          size,
			})
			if len(results) == limit {
				return results, nil
			}
		}

		// We're in the query case, non-authoritative matches are not eligible so return what we can.
		return results, nil
	}

	// It was not a query so ordering does not matter, move on to process the minimal set possible in any order.

	// Match labels will only be nil if there is no label filter, no query filter, and authoritative is strictly false.
	// Therefore authoritative matches will never be part of this listing at all.
	var matchLabels map[string]*wrappers.StringValue
	if labelResults != nil {
		matchLabels = make(map[string]*wrappers.StringValue, labelResults.Hits.Len())
		for _, hit := range labelResults.Hits {
			if l, ok := hit.Fields["label_string"]; ok {
				if ls, ok := l.(string); ok {
					matchLabels[hit.ID] = &wrappers.StringValue{Value: ls}
				}
			}
		}
	}

	// Look up tracker info to determine match sizes.
	// This info is needed even if there is no min/max size filter because it's returned in results.
	matches := r.tracker.CountByStreamModeFilter(modes)

	// Results.
	results := make([]*api.Match, 0, limit)

	// Intersection of matches listed from stream and matches listed from label index, if any.
	for stream, size := range matches {
		if stream.Mode != StreamModeMatchRelayed && stream.Mode != StreamModeMatchAuthoritative {
			r.logger.Warn("Ignoring unknown stream mode in match listing operation", zap.Uint8("mode", stream.Mode))
			continue
		}

		id := fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label)

		label, ok := matchLabels[id]
		if ok {
			delete(matchLabels, id)
		} else if matchLabels != nil && stream.Mode == StreamModeMatchAuthoritative {
			// Not eligible based on the label/query.
			continue
		}

		if minSize != nil && minSize.Value > size {
			// Not eligible based on minimum size.
			continue
		}

		if maxSize != nil && maxSize.Value < size {
			// Not eligible based on maximum size.
			continue
		}

		results = append(results, &api.Match{
			MatchId:       id,
			Authoritative: stream.Mode == StreamModeMatchAuthoritative,
			Label:         label,
			Size:          size,
		})
		if len(results) == limit {
			return results, nil
		}
	}

	// Return incomplete results here if we're not allowed to return potentially empty authoritative matches.
	if (authoritative != nil && !authoritative.Value) || (minSize != nil && minSize.Value > 0) {
		return results, nil
	}

	// All we have left now are empty authoritative matches that we already know matched label/query filter if any.
	for id, label := range matchLabels {
		results = append(results, &api.Match{
			MatchId:       id,
			Authoritative: true,
			Label:         label,
			Size:          0,
		})
		if len(results) == limit {
			break
		}
	}

	return results, nil
}

func (r *LocalMatchRegistry) Stop(graceSeconds int) chan struct{} {
	// Mark the match registry as stopped, but allow further calls here to signal periodic termination to any matches still running.
	r.stopped.Store(true)

	// Graceful shutdown not allowed/required, or grace period has expired.
	if graceSeconds == 0 {
		r.RLock()
		for id, mh := range r.matches {
			mh.Close()
			delete(r.matches, id)
			// No need to clean up label index.
		}
		r.RUnlock()
		// Termination was triggered and there are no active matches.
		select {
		case r.stoppedCh <- struct{}{}:
		default:
			// Ignore if the signal has already been sent.
		}
		return r.stoppedCh
	}

	r.RLock()
	if len(r.matches) == 0 {
		// Termination was triggered and there are no active matches.
		select {
		case r.stoppedCh <- struct{}{}:
		default:
			// Ignore if the signal has already been sent.
		}
		r.RUnlock()
		return r.stoppedCh
	}

	for _, mh := range r.matches {
		// Don't care if the call queue is full, match is supposed to end anyway.
		mh.QueueTerminate(graceSeconds)
	}
	r.RUnlock()
	return r.stoppedCh
}

func (r *LocalMatchRegistry) Count() int {
	var count int
	r.RLock()
	count = len(r.matches)
	r.RUnlock()
	return count
}

func (r *LocalMatchRegistry) JoinAttempt(ctx context.Context, id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, metadata map[string]string) (bool, bool, string, string) {
	if node != r.node {
		return false, false, "", ""
	}

	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return false, false, "", ""
	}

	resultCh := make(chan *MatchJoinResult, 1)
	if !mh.QueueJoinAttempt(ctx, resultCh, userID, sessionID, username, fromNode, metadata) {
		// The match call queue was full, so will be closed and therefore can't be joined.
		return true, false, "Match is not currently accepting join requests", ""
	}

	// Set up a limit to how long the call will wait, default is 10 seconds.
	timer := time.NewTimer(time.Second * 10)
	select {
	case <-timer.C:
		// The join attempt has timed out, join is assumed to be rejected.
		return true, false, "", ""
	case r := <-resultCh:
		// Doesn't matter if the timer has fired concurrently, we're in the desired case anyway.
		timer.Stop()
		// The join attempt has returned a result.
		return true, r.Allow, r.Reason, r.Label
	}
}

func (r *LocalMatchRegistry) Join(id uuid.UUID, presences []*MatchPresence) {
	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return
	}

	// Doesn't matter if the call queue was full here. If the match is being closed then joins don't matter anyway.
	mh.QueueJoin(presences, true)
}

func (r *LocalMatchRegistry) Leave(id uuid.UUID, presences []*MatchPresence) {
	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return
	}

	// Doesn't matter if the call queue was full here. If the match is being closed then leaves don't matter anyway.
	mh.QueueLeave(presences)
}

func (r *LocalMatchRegistry) Kick(stream PresenceStream, presences []*MatchPresence) {
	for _, presence := range presences {
		if presence.Node != r.node {
			continue
		}
		r.tracker.Untrack(presence.SessionID, stream, presence.UserID)
	}
}

func (r *LocalMatchRegistry) SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte, receiveTime int64) {
	if node != r.node {
		return
	}

	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return
	}

	mh.QueueData(&MatchDataMessage{
		UserID:      userID,
		SessionID:   sessionID,
		Username:    username,
		Node:        node,
		OpCode:      opCode,
		Data:        data,
		ReceiveTime: receiveTime,
	})
}
