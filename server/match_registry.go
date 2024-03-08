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
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/blugelabs/bluge"
	"github.com/blugelabs/bluge/index"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func init() {
	// Ensure gob can deal with typical types that might be used in match parameters.
	gob.Register(map[string]interface{}(nil))
	gob.Register([]interface{}(nil))
	gob.Register([]runtime.Presence(nil))
	gob.Register(&Presence{})
	gob.Register([]runtime.MatchmakerEntry(nil))
	gob.Register(&MatchmakerEntry{})
	gob.Register([]*api.User(nil))
	gob.Register([]*api.Account(nil))
	gob.Register([]*api.Friend(nil))
}

var (
	MatchFilterValue   = uint8(0)
	MatchFilterPtr     = &MatchFilterValue
	MatchFilterRelayed = map[uint8]*uint8{StreamModeMatchRelayed: MatchFilterPtr}

	MatchLabelMaxBytes = 2048
)

type MatchIndexEntry struct {
	Node        string                 `json:"node"`
	Label       map[string]interface{} `json:"label"`
	LabelString string                 `json:"label_string"`
	TickRate    int                    `json:"tick_rate"`
	HandlerName string                 `json:"handler_name"`
	CreateTime  int64                  `json:"create_time"`
}

type MatchJoinAttemptResult struct {
	Allow  bool
	Reason string
	Label  string
}

type MatchSignalResult struct {
	Success bool
	Result  string
}

type MatchGetStateResult struct {
	Error     error
	Presences []*MatchPresence
	Tick      int64
	State     string
}

type MatchRegistry interface {
	// Create and start a new match, given a Lua module name or registered Go or JS match function.
	CreateMatch(ctx context.Context, createFn RuntimeMatchCreateFunction, module string, params map[string]interface{}) (string, error)
	// Register and initialise a match that's ready to run.
	NewMatch(logger *zap.Logger, id uuid.UUID, core RuntimeMatchCore, stopped *atomic.Bool, params map[string]interface{}) (*MatchHandler, error)
	// Return a match by ID.
	GetMatch(ctx context.Context, id string) (*api.Match, string, error)
	// Remove a tracked match and ensure all its presences are cleaned up.
	// Does not ensure the match process itself is no longer running, that must be handled separately.
	RemoveMatch(id uuid.UUID, stream PresenceStream)
	// Update the label entry for a given match.
	UpdateMatchLabel(id uuid.UUID, tickRate int, handlerName, label string, createTime int64) error
	// List (and optionally filter) currently running matches.
	// This can list across both authoritative and relayed matches.
	ListMatches(ctx context.Context, limit int, authoritative *wrapperspb.BoolValue, label *wrapperspb.StringValue, minSize *wrapperspb.Int32Value, maxSize *wrapperspb.Int32Value, query *wrapperspb.StringValue, node *wrapperspb.StringValue) ([]*api.Match, []string, error)
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
	// Signal a match and wait for a response from its arbitrary signal handler function.
	Signal(ctx context.Context, id, data string) (string, error)
	// Get a snapshot of the match state in a string representation.
	GetState(ctx context.Context, id uuid.UUID, node string) ([]*rtapi.UserPresence, int64, string, error)
}

type LocalMatchRegistry struct {
	logger          *zap.Logger
	config          Config
	sessionRegistry SessionRegistry
	tracker         Tracker
	router          MessageRouter
	metrics         Metrics
	node            string

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	matches     *MapOf[uuid.UUID, *MatchHandler]
	matchCount  *atomic.Int64
	indexWriter *bluge.Writer

	pendingUpdatesMutex *sync.Mutex
	pendingUpdates      map[string]*MatchIndexEntry

	stopped   *atomic.Bool
	stoppedCh chan struct{}
}

func NewLocalMatchRegistry(logger, startupLogger *zap.Logger, config Config, sessionRegistry SessionRegistry, tracker Tracker, router MessageRouter, metrics Metrics, node string) MatchRegistry {
	cfg := BlugeInMemoryConfig()
	indexWriter, err := bluge.OpenWriter(cfg)
	if err != nil {
		startupLogger.Fatal("Failed to create match registry index", zap.Error(err))
	}

	ctx, ctxCancelFn := context.WithCancel(context.Background())

	r := &LocalMatchRegistry{
		logger:          logger,
		config:          config,
		sessionRegistry: sessionRegistry,
		tracker:         tracker,
		router:          router,
		metrics:         metrics,
		node:            node,

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		matches:     &MapOf[uuid.UUID, *MatchHandler]{},
		matchCount:  atomic.NewInt64(0),
		indexWriter: indexWriter,

		pendingUpdatesMutex: &sync.Mutex{},
		pendingUpdates:      make(map[string]*MatchIndexEntry, 10),

		stopped:   atomic.NewBool(false),
		stoppedCh: make(chan struct{}, 2),
	}

	go func() {
		ticker := time.NewTicker(time.Duration(config.GetMatch().LabelUpdateIntervalMs) * time.Millisecond)
		batch := bluge.NewBatch()
		for {
			select {
			case <-ctx.Done():
				ticker.Stop()
				return
			case <-ticker.C:
				r.processLabelUpdates(batch)
			}
		}
	}()

	return r
}

func (r *LocalMatchRegistry) processLabelUpdates(batch *index.Batch) {
	r.pendingUpdatesMutex.Lock()
	if len(r.pendingUpdates) == 0 {
		r.pendingUpdatesMutex.Unlock()
		return
	}
	pendingUpdates := r.pendingUpdates
	r.pendingUpdates = make(map[string]*MatchIndexEntry, len(pendingUpdates)+10)
	r.pendingUpdatesMutex.Unlock()

	for id, op := range pendingUpdates {
		if op == nil {
			batch.Delete(bluge.Identifier(id))
			continue
		}
		doc, err := MapMatchIndexEntry(id, op)
		if err != nil {
			r.logger.Error("error mapping match index entry to doc: %v", zap.Error(err))
		}
		batch.Update(bluge.Identifier(id), doc)
	}

	if err := r.indexWriter.Batch(batch); err != nil {
		r.logger.Error("error processing match label updates", zap.Error(err))
	}
	batch.Reset()
}

func (r *LocalMatchRegistry) CreateMatch(ctx context.Context, createFn RuntimeMatchCreateFunction, module string, params map[string]interface{}) (string, error) {
	buf := &bytes.Buffer{}
	if err := gob.NewEncoder(buf).Encode(params); err != nil {
		return "", runtime.ErrCannotEncodeParams
	}
	if err := gob.NewDecoder(buf).Decode(&params); err != nil {
		return "", runtime.ErrCannotDecodeParams
	}

	id := uuid.Must(uuid.NewV4())
	matchLogger := r.logger.With(zap.String("mid", id.String()))
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

func (r *LocalMatchRegistry) GetMatch(ctx context.Context, id string) (*api.Match, string, error) {
	// Validate the match ID.
	idComponents := strings.SplitN(id, ".", 2)
	if len(idComponents) != 2 {
		return nil, "", runtime.ErrMatchIdInvalid
	}
	matchID, err := uuid.FromString(idComponents[0])
	if err != nil {
		return nil, "", runtime.ErrMatchIdInvalid
	}

	// Relayed match.
	if idComponents[1] == "" {
		size := r.tracker.CountByStream(PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID})
		if size == 0 {
			return nil, "", nil
		}

		return &api.Match{
			MatchId: id,
			Size:    int32(size),
		}, "", nil
	}

	// Authoritative match.
	if idComponents[1] != r.node {
		return nil, "", nil
	}

	mh, ok := r.matches.Load(matchID)
	if !ok {
		return nil, "", nil
	}

	return &api.Match{
		MatchId:       mh.IDStr,
		Authoritative: true,
		Label:         &wrapperspb.StringValue{Value: mh.Label()},
		Size:          int32(mh.PresenceList.Size()),
		TickRate:      int32(mh.Rate),
		HandlerName:   mh.Core.HandlerName(),
	}, r.node, nil
}

func (r *LocalMatchRegistry) RemoveMatch(id uuid.UUID, stream PresenceStream) {
	r.matches.Delete(id)
	matchesRemaining := r.matchCount.Dec()
	r.metrics.GaugeAuthoritativeMatches(float64(matchesRemaining))

	r.tracker.UntrackByStream(stream)

	idStr := fmt.Sprintf("%v.%v", id.String(), r.node)
	r.pendingUpdatesMutex.Lock()
	r.pendingUpdates[idStr] = nil
	r.pendingUpdatesMutex.Unlock()

	// If there are no more matches in this registry and a shutdown was initiated then signal
	// that the process is complete.
	if matchesRemaining == 0 && r.stopped.Load() {
		r.ctxCancelFn()
		select {
		case r.stoppedCh <- struct{}{}:
		default:
			// Ignore if the signal has already been sent.
		}
	}
}

func (r *LocalMatchRegistry) UpdateMatchLabel(id uuid.UUID, tickRate int, handlerName, label string, createTime int64) error {
	if len(label) > MatchLabelMaxBytes {
		return runtime.ErrMatchLabelTooLong
	}
	var labelJSON map[string]interface{}
	// Doesn't matter if this is not JSON.
	_ = json.Unmarshal([]byte(label), &labelJSON)

	idStr := fmt.Sprintf("%v.%v", id.String(), r.node)
	entry := &MatchIndexEntry{
		Node:        r.node,
		Label:       labelJSON,
		TickRate:    tickRate,
		HandlerName: handlerName,
		LabelString: label,
		CreateTime:  createTime,
	}

	r.pendingUpdatesMutex.Lock()
	r.pendingUpdates[idStr] = entry
	r.pendingUpdatesMutex.Unlock()

	return nil
}

func (r *LocalMatchRegistry) ListMatches(ctx context.Context, limit int, authoritative *wrapperspb.BoolValue, label *wrapperspb.StringValue, minSize *wrapperspb.Int32Value, maxSize *wrapperspb.Int32Value, queryString *wrapperspb.StringValue, node *wrapperspb.StringValue) ([]*api.Match, []string, error) {
	if limit == 0 {
		return make([]*api.Match, 0), make([]string, 0), nil
	}

	indexReader, err := r.indexWriter.Reader()
	if err != nil {
		return nil, nil, fmt.Errorf("error accessing index reader: %v", err.Error())
	}
	defer func() {
		err = indexReader.Close()
		if err != nil {
			r.logger.Error("error closing index reader", zap.Error(err))
		}
	}()

	var allowRelayed bool
	var labelResults *BlugeResult
	if queryString != nil {
		if authoritative != nil && !authoritative.Value {
			// A filter on query is requested but authoritative matches are not allowed.
			return make([]*api.Match, 0), make([]string, 0), nil
		}

		// If there are filters other than query, we don't know which matches will work so get more than the limit.
		count := limit
		if minSize != nil || maxSize != nil {
			count = int(r.matchCount.Load())
		}
		if count == 0 {
			return make([]*api.Match, 0), make([]string, 0), nil
		}

		// Apply the query filter to the set of known match labels.
		var q bluge.Query
		if queryString := queryString.Value; queryString == "" {
			q = bluge.NewMatchAllQuery()
		} else {
			parsed, err := ParseQueryString(queryString)
			if err != nil {
				return nil, nil, fmt.Errorf("error parsing query string: %v", err.Error())
			}
			q = parsed
		}
		if node != nil {
			multiQuery := bluge.NewBooleanQuery()
			multiQuery.AddMust(q)
			nodeQuery := bluge.NewTermQuery(node.Value)
			nodeQuery.SetField("node")
			multiQuery.AddMust(nodeQuery)
			q = multiQuery
		}

		searchReq := bluge.NewTopNSearch(count, q)
		searchReq.SortBy([]string{"-_score", "-create_time"})

		labelResultsItr, err := indexReader.Search(ctx, searchReq)
		if err != nil {
			return nil, nil, fmt.Errorf("error listing matches by query: %v", err.Error())
		}
		labelResults, err = IterateBlugeMatches(labelResultsItr,
			map[string]struct{}{
				"label_string": {},
				"tick_rate":    {},
				"handler_name": {},
				"node":         {},
			}, r.logger)
		if err != nil {
			return nil, nil, fmt.Errorf("error iterating bluge matches: %v", err.Error())
		}
	} else if label != nil {
		if authoritative != nil && !authoritative.Value {
			// A filter on label is requested but authoritative matches are not allowed.
			return make([]*api.Match, 0), make([]string, 0), nil
		}

		// If there are filters other than label, we don't know which matches will work so get more than the limit.
		count := limit
		if minSize != nil || maxSize != nil {
			count = int(r.matchCount.Load())
		}
		if count == 0 {
			return make([]*api.Match, 0), make([]string, 0), nil
		}

		// Apply the label filter to the set of known match labels.
		indexQuery := bluge.NewTermQuery(label.Value)
		indexQuery.SetField("label_string")
		//indexQuery.SetAnalyzer(BlugeKeywordAnalyzer)
		searchReq := bluge.NewTopNSearch(count, indexQuery)
		searchReq.SortBy([]string{"-create_time"})

		labelResultsItr, err := indexReader.Search(ctx, searchReq)
		if err != nil {
			return nil, nil, fmt.Errorf("error listing matches by label: %v", err.Error())
		}
		labelResults, err = IterateBlugeMatches(labelResultsItr,
			map[string]struct{}{
				"label_string": {},
				"tick_rate":    {},
				"handler_name": {},
				"node":         {},
			}, r.logger)
		if err != nil {
			return nil, nil, fmt.Errorf("error iterating bluge matches: %v", err.Error())
		}
	} else if authoritative == nil || authoritative.Value {
		// Not using label/query filter but we still need access to the indexed labels to return them
		// if authoritative matches may be included in the results.
		count := limit
		if minSize != nil || maxSize != nil {
			count = int(r.matchCount.Load())
		}
		if count == 0 && authoritative != nil && authoritative.Value {
			return make([]*api.Match, 0), make([]string, 0), nil
		}

		var q bluge.Query = bluge.NewMatchAllQuery()
		if node != nil {
			multiQuery := bluge.NewBooleanQuery()
			multiQuery.AddMust(q)
			nodeQuery := bluge.NewTermQuery(node.Value)
			nodeQuery.SetField("node")
			multiQuery.AddMust(nodeQuery)
			q = multiQuery
		}
		searchReq := bluge.NewTopNSearch(count, q)
		searchReq.SortBy([]string{"-create_time"})

		labelResultsItr, err := indexReader.Search(ctx, searchReq)
		if err != nil {
			return nil, nil, fmt.Errorf("error listing matches by label: %v", err.Error())
		}
		labelResults, err = IterateBlugeMatches(labelResultsItr,
			map[string]struct{}{
				"label_string": {},
				"tick_rate":    {},
				"handler_name": {},
				"node":         {},
			}, r.logger)
		if err != nil {
			return nil, nil, fmt.Errorf("error iterating bluge matches: %v", err.Error())
		}

		if authoritative == nil {
			// Expect a possible mix of authoritative and relayed matches.
			allowRelayed = true
		}
	} else {
		// Authoritative was strictly false, and there was no label/query filter.
		allowRelayed = true
	}

	if labelResults != nil && len(labelResults.Hits) == 0 && authoritative != nil && !authoritative.Value {
		// No results based on label/query, no point in further filtering by size.
		return make([]*api.Match, 0), make([]string, 0), nil
	}

	// Results.
	results := make([]*api.Match, 0, limit)
	nodes := make([]string, 0, limit)

	// Use any eligible authoritative matches first.
	if labelResults != nil {
		for _, hit := range labelResults.Hits {
			matchIDComponents := strings.SplitN(hit.ID, ".", 2)
			id := uuid.FromStringOrNil(matchIDComponents[0])

			mh, ok := r.matches.Load(id)
			if !ok {
				continue
			}
			size := int32(mh.PresenceList.Size())

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

			var tickRate float64
			if tr, ok := hit.Fields["tick_rate"]; ok {
				if tickRate, ok = tr.(float64); !ok {
					r.logger.Warn("Field not an int in match registry label cache: tick_rate")
					continue
				}
			} else {
				r.logger.Warn("Field not found in match registry label cache: tick_rate")
				continue
			}

			var handlerName string
			if hn, ok := hit.Fields["handler_name"]; ok {
				if handlerName, ok = hn.(string); !ok {
					r.logger.Warn("Field not a string in match registry label cache: handler_name")
					continue
				}
			} else {
				r.logger.Warn("Field not found in match registry label cache: handler_name")
				continue
			}

			var node string
			if hn, ok := hit.Fields["node"]; ok {
				if node, ok = hn.(string); !ok {
					r.logger.Warn("Field not a string in match registry label cache: node")
					continue
				}
			} else {
				r.logger.Warn("Field not found in match registry label cache: node")
				continue
			}

			results = append(results, &api.Match{
				MatchId:       hit.ID,
				Authoritative: true,
				Label:         &wrapperspb.StringValue{Value: labelString},
				Size:          size,
				TickRate:      int32(tickRate),
				HandlerName:   handlerName,
			})
			nodes = append(nodes, node)
			if len(results) == limit {
				return results, nodes, nil
			}
		}
	}

	// If relayed matches are not allowed still return any available results.
	if !allowRelayed {
		return results, nodes, nil
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
			return results, nodes, nil
		}
	}

	return results, nodes, nil
}

func (r *LocalMatchRegistry) Stop(graceSeconds int) chan struct{} {
	// Mark the match registry as stopped, but allow further calls here to signal periodic termination to any matches still running.
	r.stopped.Store(true)

	// Graceful shutdown not allowed/required, or grace period has expired.
	if graceSeconds == 0 {
		// If grace period is 0 stop match label processing immediately.
		r.ctxCancelFn()

		r.matches.Range(func(id uuid.UUID, mh *MatchHandler) bool {
			mh.Stop()
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
	r.matches.Range(func(id uuid.UUID, mh *MatchHandler) bool {
		anyRunning = true
		// Don't care if the call queue is full, match is supposed to end anyway.
		mh.QueueTerminate(graceSeconds)
		return true
	})

	if !anyRunning {
		// Termination was triggered and there are no active matches.
		r.ctxCancelFn()
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

	mh, ok := r.matches.Load(id)
	if !ok {
		return false, false, false, "", "", nil
	}

	if mh.PresenceList.Contains(&PresenceID{Node: fromNode, SessionID: sessionID}) {
		// The user is already part of this match.
		return true, true, false, "", mh.Label(), mh.PresenceList.ListPresences()
	}

	resultCh := make(chan *MatchJoinAttemptResult, 1)
	if !mh.QueueJoinAttempt(ctx, resultCh, userID, sessionID, username, sessionExpiry, vars, clientIP, clientPort, fromNode, metadata) {
		// The match join attempt queue was full, match will not close but it can't be joined right now.
		return true, false, false, "Match is not currently accepting join requests", "", nil
	}

	// Set up a limit to how long the join attempt will wait, default is 10 seconds.
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
	mh.QueueJoin(presences, true)
}

func (r *LocalMatchRegistry) Leave(id uuid.UUID, presences []*MatchPresence) {
	mh, ok := r.matches.Load(id)
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

func (r *LocalMatchRegistry) SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte, reliable bool, receiveTime int64) {
	if node != r.node {
		return
	}

	mh, ok := r.matches.Load(id)
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
		Reliable:    reliable,
		ReceiveTime: receiveTime,
	})
}

func (r *LocalMatchRegistry) Signal(ctx context.Context, id, data string) (string, error) {
	// Validate the match ID.
	idComponents := strings.SplitN(id, ".", 2)
	if len(idComponents) != 2 {
		return "", runtime.ErrMatchIdInvalid
	}
	matchID, err := uuid.FromString(idComponents[0])
	if err != nil {
		return "", runtime.ErrMatchIdInvalid
	}

	// Relayed match.
	if idComponents[1] == "" {
		return "", runtime.ErrMatchNotFound
	}

	// Authoritative match.
	if idComponents[1] != r.node {
		return "", runtime.ErrMatchNotFound
	}

	mh, ok := r.matches.Load(matchID)
	if !ok {
		return "", runtime.ErrMatchNotFound
	}

	resultCh := make(chan *MatchSignalResult, 1)
	if !mh.QueueSignal(ctx, resultCh, data) {
		// The match signal queue was full.
		return "", runtime.ErrMatchBusy
	}

	// Set up a limit to how long the signal will wait, default is 10 seconds.
	timer := time.NewTimer(time.Second * 10)
	select {
	case <-ctx.Done():
		// Doesn't matter if the timer has fired concurrently, we're failing anyway.
		timer.Stop()
		// The caller has timed out, return a placeholder unsuccessful response.
		return "", runtime.ErrMatchBusy
	case <-timer.C:
		// The signal has timed out, match is assumed to be too busy to respond to this signal.
		return "", runtime.ErrMatchBusy
	case r := <-resultCh:
		// Doesn't matter if the timer has fired concurrently, we're in the desired case anyway.
		timer.Stop()
		// The signal has returned a result.
		if !r.Success {
			return "", runtime.ErrMatchBusy
		}
		return r.Result, nil
	}
}

func (r *LocalMatchRegistry) GetState(ctx context.Context, id uuid.UUID, node string) ([]*rtapi.UserPresence, int64, string, error) {
	if node != r.node {
		return nil, 0, "", nil
	}

	mh, ok := r.matches.Load(id)
	if !ok {
		return nil, 0, "", runtime.ErrMatchNotFound
	}

	resultCh := make(chan *MatchGetStateResult, 1)
	if !mh.QueueGetState(ctx, resultCh) {
		// The match call queue was full, so will be closed and therefore a state snapshot can't be retrieved.
		return nil, 0, "", nil
	}

	// Set up a limit to how long the call will wait, default is 10 seconds.
	timer := time.NewTimer(time.Second * 10)
	select {
	case <-timer.C:
		// The state snapshot request has timed out.
		return nil, 0, "", runtime.ErrMatchStateFailed
	case r := <-resultCh:
		// The join attempt has returned a result.
		// Doesn't matter if the timer has fired concurrently, we're in the desired case anyway.
		timer.Stop()

		if r.Error != nil {
			return nil, 0, "", r.Error
		}

		presences := make([]*rtapi.UserPresence, 0, len(r.Presences))
		for _, presence := range r.Presences {
			presences = append(presences, &rtapi.UserPresence{
				UserId:    presence.UserID.String(),
				SessionId: presence.SessionID.String(),
				Username:  presence.Username,
			})
		}
		return presences, r.Tick, r.State, nil
	}
}

func MapMatchIndexEntry(id string, in *MatchIndexEntry) (*bluge.Document, error) {
	rv := bluge.NewDocument(id)

	rv.AddField(bluge.NewKeywordField("node", in.Node).StoreValue())
	rv.AddField(bluge.NewKeywordField("label_string", in.LabelString).StoreValue())
	rv.AddField(bluge.NewNumericField("tick_rate", float64(in.TickRate)).StoreValue())
	rv.AddField(bluge.NewKeywordField("handler_name", in.HandlerName).StoreValue())
	rv.AddField(bluge.NewNumericField("create_time", float64(in.CreateTime)).StoreValue())

	if in.Label != nil {
		BlugeWalkDocument(in.Label, []string{"label"}, map[string]bool{}, rv)
	}

	return rv, nil
}
