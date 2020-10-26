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
	"bytes"
	"context"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/analysis/analyzer/keyword"
	"github.com/blevesearch/bleve/search/query"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/pkg/errors"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

func init() {
	// Ensure gob can deal with typical types that might be used in match parameters.
	gob.Register(map[string]interface{}(nil))
	gob.Register([]interface{}(nil))
	gob.Register([]runtime.MatchmakerEntry(nil))
	gob.Register(MatchmakerEntry{})
	gob.Register([]*api.User(nil))
	gob.Register([]*api.Account(nil))
	gob.Register([]*api.Friend(nil))
}

var (
	MatchFilterValue   = uint8(0)
	MatchFilterPtr     = &MatchFilterValue
	MatchFilterRelayed = map[uint8]*uint8{StreamModeMatchRelayed: MatchFilterPtr}

	MatchLabelMaxBytes = 2048

	ErrCannotEncodeParams    = errors.New("error creating match: cannot encode params")
	ErrMatchIdInvalid        = errors.New("match id invalid")
	ErrMatchLabelTooLong     = errors.New("match label too long, must be 0-2048 bytes")
	ErrDeferredBroadcastFull = errors.New("too many deferred message broadcasts per tick")
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
	NewMatch(logger *zap.Logger, id uuid.UUID, core RuntimeMatchCore, stopped *atomic.Bool, params map[string]interface{}) (*MatchHandler, error)
	// Return a match by ID.
	GetMatch(ctx context.Context, id string) (*api.Match, error)
	// Remove a tracked match and ensure all its presences are cleaned up.
	// Does not ensure the match process itself is no longer running, that must be handled separately.
	RemoveMatch(id uuid.UUID, stream PresenceStream)
	// Update the label entry for a given match.
	UpdateMatchLabel(id uuid.UUID, label string) error
	// List (and optionally filter) currently running matches.
	// This can list across both authoritative and relayed matches.
	ListMatches(ctx context.Context, limit int, authoritative *wrappers.BoolValue, label *wrappers.StringValue, minSize *wrappers.Int32Value, maxSize *wrappers.Int32Value, query *wrappers.StringValue) ([]*api.Match, error)
	// Stop the match registry and close all matches it's tracking.
	Stop(graceSeconds int) chan struct{}
	// Returns the total number of currently active authoritative matches.
	Count() int

	// Pass a user join attempt to a match handler. Returns if the match was found, if the join was accepted, if it's a new user for this match, a reason for any rejection, the match label, and the list of existing match participants.
	JoinAttempt(ctx context.Context, id uuid.UUID, node string, userID, sessionID uuid.UUID, username string, sessionExpiry int64, vars map[string]string, clientIP, clientPort, fromNode string, metadata map[string]string) (bool, bool, bool, string, string, []*MatchPresence)
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
	SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte, reliable bool, receiveTime int64)
}

type LocalMatchRegistry struct {
	logger          *zap.Logger
	config          Config
	sessionRegistry SessionRegistry
	tracker         Tracker
	router          MessageRouter
	metrics         *Metrics
	node            string

	matches    *sync.Map
	matchCount *atomic.Int64
	index      bleve.Index

	stopped   *atomic.Bool
	stoppedCh chan struct{}
}

func NewLocalMatchRegistry(logger, startupLogger *zap.Logger, config Config, sessionRegistry SessionRegistry, tracker Tracker, router MessageRouter, metrics *Metrics, node string) MatchRegistry {
	mapping := bleve.NewIndexMapping()
	mapping.DefaultAnalyzer = keyword.Name

	index, err := bleve.NewMemOnly(mapping)
	if err != nil {
		startupLogger.Fatal("Failed to create match registry index", zap.Error(err))
	}

	return &LocalMatchRegistry{
		logger:          logger,
		config:          config,
		sessionRegistry: sessionRegistry,
		tracker:         tracker,
		router:          router,
		metrics:         metrics,
		node:            node,

		matches:    &sync.Map{},
		matchCount: atomic.NewInt64(0),
		index:      index,

		stopped:   atomic.NewBool(false),
		stoppedCh: make(chan struct{}, 2),
	}
}

func (r *LocalMatchRegistry) CreateMatch(ctx context.Context, logger *zap.Logger, createFn RuntimeMatchCreateFunction, module string, params map[string]interface{}) (string, error) {
	if err := gob.NewEncoder(&bytes.Buffer{}).Encode(params); err != nil {
		return "", ErrCannotEncodeParams
	}

	id := uuid.Must(uuid.NewV4())
	matchLogger := logger.With(zap.String("mid", id.String()))
	stopped := atomic.NewBool(false)

	core, err := createFn(ctx, matchLogger, id, r.node, stopped, module)
	if err != nil {
		return "", err
	}
	if core == nil {
		return "", errors.New("error creating match: not found")
	}

	// Start the match.
	mh, err := r.NewMatch(matchLogger, id, core, stopped, params)
	if err != nil {
		return "", fmt.Errorf("error creating match: %v", err.Error())
	}

	return mh.IDStr, nil
}

func (r *LocalMatchRegistry) NewMatch(logger *zap.Logger, id uuid.UUID, core RuntimeMatchCore, stopped *atomic.Bool, params map[string]interface{}) (*MatchHandler, error) {
	if r.stopped.Load() {
		// Server is shutting down, reject new matches.
		return nil, errors.New("shutdown in progress")
	}

	match, err := NewMatchHandler(logger, r.config, r.sessionRegistry, r, r.router, core, id, r.node, stopped, params)
	if err != nil {
		return nil, err
	}

	r.matches.Store(id, match)
	count := r.matchCount.Inc()
	r.metrics.GaugeAuthoritativeMatches(float64(count))

	return match, nil
}

func (r *LocalMatchRegistry) GetMatch(ctx context.Context, id string) (*api.Match, error) {
	// Validate the match ID.
	idComponents := strings.SplitN(id, ".", 2)
	if len(idComponents) != 2 {
		return nil, ErrMatchIdInvalid
	}
	matchID, err := uuid.FromString(idComponents[0])
	if err != nil {
		return nil, ErrMatchIdInvalid
	}

	// Relayed match.
	if idComponents[1] == "" {
		size := r.tracker.CountByStream(PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID})
		if size == 0 {
			return nil, nil
		}

		return &api.Match{
			MatchId: id,
			Size:    int32(size),
		}, nil
	}

	// Authoritative match.
	if idComponents[1] != r.node {
		return nil, nil
	}

	mh, ok := r.matches.Load(matchID)
	if !ok {
		return nil, nil
	}
	handler := mh.(*MatchHandler)

	return &api.Match{
		MatchId:       handler.IDStr,
		Authoritative: true,
		Label:         &wrappers.StringValue{Value: handler.Label()},
		Size:          int32(handler.PresenceList.Size()),
	}, nil
}

func (r *LocalMatchRegistry) RemoveMatch(id uuid.UUID, stream PresenceStream) {
	r.matches.Delete(id)
	matchesRemaining := r.matchCount.Dec()
	r.metrics.GaugeAuthoritativeMatches(float64(matchesRemaining))

	r.tracker.UntrackByStream(stream)
	if err := r.index.Delete(fmt.Sprintf("%v.%v", id.String(), r.node)); err != nil {
		r.logger.Warn("Error removing match list index", zap.String("id", fmt.Sprintf("%v.%v", id.String(), r.node)), zap.Error(err))
	}

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

func (r *LocalMatchRegistry) UpdateMatchLabel(id uuid.UUID, label string) error {
	if len(label) > MatchLabelMaxBytes {
		return ErrMatchLabelTooLong
	}

	var labelJSON map[string]interface{}
	// Doesn't matter if this is not JSON.
	_ = json.Unmarshal([]byte(label), &labelJSON)
	return r.index.Index(fmt.Sprintf("%v.%v", id.String(), r.node), &MatchIndexEntry{
		Node:        r.node,
		Label:       labelJSON,
		LabelString: label,
	})
}

func (r *LocalMatchRegistry) ListMatches(ctx context.Context, limit int, authoritative *wrappers.BoolValue, label *wrappers.StringValue, minSize *wrappers.Int32Value, maxSize *wrappers.Int32Value, queryString *wrappers.StringValue) ([]*api.Match, error) {
	if limit == 0 {
		return make([]*api.Match, 0), nil
	}

	var allowRelayed bool
	var labelResults *bleve.SearchResult
	if queryString != nil {
		if authoritative != nil && !authoritative.Value {
			// A filter on query is requested but authoritative matches are not allowed.
			return make([]*api.Match, 0), nil
		}

		// If there are filters other than query, we don't know which matches will work so get more than the limit.
		count := limit
		if minSize != nil || maxSize != nil {
			count = int(r.matchCount.Load())
		}
		if count == 0 {
			return make([]*api.Match, 0), nil
		}

		// Apply the query filter to the set of known match labels.
		var q query.Query
		if queryString := queryString.Value; queryString == "" {
			q = bleve.NewMatchAllQuery()
		} else {
			q = bleve.NewQueryStringQuery(queryString)
		}
		searchReq := bleve.NewSearchRequestOptions(q, count, 0, false)
		searchReq.Fields = []string{"label_string"}
		var err error
		labelResults, err = r.index.SearchInContext(ctx, searchReq)
		if err != nil {
			return nil, fmt.Errorf("error listing matches by query: %v", err.Error())
		}
	} else if label != nil {
		if authoritative != nil && !authoritative.Value {
			// A filter on label is requested but authoritative matches are not allowed.
			return make([]*api.Match, 0), nil
		}

		// If there are filters other than label, we don't know which matches will work so get more than the limit.
		count := limit
		if minSize != nil || maxSize != nil {
			count = int(r.matchCount.Load())
		}
		if count == 0 {
			return make([]*api.Match, 0), nil
		}

		// Apply the label filter to the set of known match labels.
		indexQuery := bleve.NewMatchQuery(label.Value)
		indexQuery.SetField("label_string")
		searchReq := bleve.NewSearchRequestOptions(indexQuery, count, 0, false)
		searchReq.Fields = []string{"label_string"}
		var err error
		labelResults, err = r.index.SearchInContext(ctx, searchReq)
		if err != nil {
			return nil, fmt.Errorf("error listing matches by label: %v", err.Error())
		}
	} else if authoritative == nil || authoritative.Value {
		// Not using label/query filter but we still need access to the indexed labels to return them
		// if authoritative matches may be included in the results.
		count := limit
		if minSize != nil || maxSize != nil {
			count = int(r.matchCount.Load())
		}
		if count == 0 && authoritative != nil && authoritative.Value {
			return make([]*api.Match, 0), nil
		}

		indexQuery := bleve.NewMatchAllQuery()
		searchReq := bleve.NewSearchRequestOptions(indexQuery, count, 0, false)
		searchReq.Fields = []string{"label_string"}
		var err error
		labelResults, err = r.index.SearchInContext(ctx, searchReq)
		if err != nil {
			return nil, fmt.Errorf("error listing matches by label: %v", err.Error())
		}

		if authoritative == nil {
			// Expect a possible mix of authoritative and relayed matches.
			allowRelayed = true
		}
	} else {
		// Authoritative was strictly false, and there was no label/query filter.
		allowRelayed = true
	}

	if labelResults != nil && labelResults.Hits.Len() == 0 && authoritative != nil && !authoritative.Value {
		// No results based on label/query, no point in further filtering by size.
		return make([]*api.Match, 0), nil
	}

	// Results.
	results := make([]*api.Match, 0, limit)

	// Use any eligible authoritative matches first.
	if labelResults != nil {
		for _, hit := range labelResults.Hits {
			matchIDComponents := strings.SplitN(hit.ID, ".", 2)
			id := uuid.FromStringOrNil(matchIDComponents[0])

			mh, ok := r.matches.Load(id)
			if !ok {
				continue
			}
			size := int32(mh.(*MatchHandler).PresenceList.Size())

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
	}

	// If relayed matches are not allowed still return any available results.
	if !allowRelayed {
		return results, nil
	}

	matches := r.tracker.CountByStreamModeFilter(MatchFilterRelayed)
	for stream, size := range matches {
		if stream.Mode != StreamModeMatchRelayed {
			// Only relayed matches are expected at this point.
			r.logger.Warn("Ignoring unknown stream mode in match listing operation", zap.Uint8("mode", stream.Mode))
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
			MatchId:       fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label),
			Authoritative: false,
			Label:         label,
			Size:          size,
		})
		if len(results) == limit {
			return results, nil
		}
	}

	return results, nil
}

func (r *LocalMatchRegistry) Stop(graceSeconds int) chan struct{} {
	// Mark the match registry as stopped, but allow further calls here to signal periodic termination to any matches still running.
	r.stopped.Store(true)

	// Graceful shutdown not allowed/required, or grace period has expired.
	if graceSeconds == 0 {
		r.matches.Range(func(id, mh interface{}) bool {
			mh.(*MatchHandler).Stop()
			return true
		})
		// Termination was triggered and there are no active matches.
		select {
		case r.stoppedCh <- struct{}{}:
		default:
			// Ignore if the signal has already been sent.
		}
		return r.stoppedCh
	}

	var anyRunning bool
	r.matches.Range(func(id, mh interface{}) bool {
		anyRunning = true
		// Don't care if the call queue is full, match is supposed to end anyway.
		mh.(*MatchHandler).QueueTerminate(graceSeconds)
		return true
	})

	if !anyRunning {
		// Termination was triggered and there are no active matches.
		select {
		case r.stoppedCh <- struct{}{}:
		default:
			// Ignore if the signal has already been sent.
		}
		return r.stoppedCh
	}

	return r.stoppedCh
}

func (r *LocalMatchRegistry) Count() int {
	return int(r.matchCount.Load())
}

func (r *LocalMatchRegistry) JoinAttempt(ctx context.Context, id uuid.UUID, node string, userID, sessionID uuid.UUID, username string, sessionExpiry int64, vars map[string]string, clientIP, clientPort, fromNode string, metadata map[string]string) (bool, bool, bool, string, string, []*MatchPresence) {
	if node != r.node {
		return false, false, false, "", "", nil
	}

	m, ok := r.matches.Load(id)
	if !ok {
		return false, false, false, "", "", nil
	}
	mh := m.(*MatchHandler)

	if mh.PresenceList.Contains(&PresenceID{Node: fromNode, SessionID: sessionID}) {
		// The user is already part of this match.
		return true, true, false, "", mh.Label(), mh.PresenceList.ListPresences()
	}

	resultCh := make(chan *MatchJoinResult, 1)
	if !mh.QueueJoinAttempt(ctx, resultCh, userID, sessionID, username, sessionExpiry, vars, clientIP, clientPort, fromNode, metadata) {
		// The match call queue was full, so will be closed and therefore can't be joined.
		return true, false, false, "Match is not currently accepting join requests", "", nil
	}

	// Set up a limit to how long the call will wait, default is 10 seconds.
	timer := time.NewTimer(time.Second * 10)
	select {
	case <-timer.C:
		// The join attempt has timed out, join is assumed to be rejected.
		return true, false, false, "", "", nil
	case r := <-resultCh:
		// Doesn't matter if the timer has fired concurrently, we're in the desired case anyway.
		timer.Stop()
		// The join attempt has returned a result.
		return true, r.Allow, true, r.Reason, r.Label, mh.PresenceList.ListPresences()
	}
}

func (r *LocalMatchRegistry) Join(id uuid.UUID, presences []*MatchPresence) {
	mh, ok := r.matches.Load(id)
	if !ok {
		return
	}

	// Doesn't matter if the call queue was full here. If the match is being closed then joins don't matter anyway.
	mh.(*MatchHandler).QueueJoin(presences, true)
}

func (r *LocalMatchRegistry) Leave(id uuid.UUID, presences []*MatchPresence) {
	mh, ok := r.matches.Load(id)
	if !ok {
		return
	}

	// Doesn't matter if the call queue was full here. If the match is being closed then leaves don't matter anyway.
	mh.(*MatchHandler).QueueLeave(presences)
}

func (r *LocalMatchRegistry) Kick(stream PresenceStream, presences []*MatchPresence) {
	for _, presence := range presences {
		if presence.Node != r.node {
			continue
		}
		r.tracker.Untrack(presence.SessionID, stream, presence.UserID)
	}
}

func (r *LocalMatchRegistry) SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte, reliable bool, receiveTime int64) {
	if node != r.node {
		return
	}

	mh, ok := r.matches.Load(id)
	if !ok {
		return
	}

	mh.(*MatchHandler).QueueData(&MatchDataMessage{
		UserID:      userID,
		SessionID:   sessionID,
		Username:    username,
		Node:        node,
		OpCode:      opCode,
		Data:        data,
		Reliable:    reliable,
		ReceiveTime: receiveTime,
	})
}
