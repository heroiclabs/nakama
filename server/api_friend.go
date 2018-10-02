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
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"go.opencensus.io/stats"
	"go.opencensus.io/tag"
	"go.opencensus.io/trace"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"time"
)

func (s *ApiServer) ListFriends(ctx context.Context, in *empty.Empty) (*api.Friends, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeListFriends(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", userID.String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	friends, err := GetFriends(s.logger, s.db, s.tracker, userID)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to list friends.")
	}

	// After hook.
	if fn := s.runtime.AfterListFriends(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, friends)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return friends, nil
}

func (s *ApiServer) AddFriends(ctx context.Context, in *api.AddFriendsRequest) (*empty.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeAddFriends(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", userID.String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	username := ctx.Value(ctxUsernameKey{}).(string)

	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot add self as friend.")
		}
		if _, err := uuid.FromString(id); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	for _, u := range in.GetUsernames() {
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot add self as friend.")
		}
	}

	userIDs, err := fetchUserID(s.db, in.GetUsernames())
	if err != nil {
		s.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", in.GetUsernames()))
		return nil, status.Error(codes.Internal, "Error while trying to add friends.")
	}

	if len(userIDs)+len(in.GetIds()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "No valid ID or username was provided.")
	}

	allIDs := make([]string, 0, len(in.GetIds())+len(userIDs))
	allIDs = append(allIDs, in.GetIds()...)
	allIDs = append(allIDs, userIDs...)

	if err := AddFriends(s.logger, s.db, s.router, userID, username, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to add friends.")
	}

	// After hook.
	if fn := s.runtime.AfterAddFriends(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, &empty.Empty{})

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) DeleteFriends(ctx context.Context, in *api.DeleteFriendsRequest) (*empty.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeDeleteFriends(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", userID.String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot delete self.")
		}
		if _, err := uuid.FromString(id); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	username := ctx.Value(ctxUsernameKey{}).(string)
	for _, u := range in.GetUsernames() {
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot delete self.")
		}
	}

	userIDs, err := fetchUserID(s.db, in.GetUsernames())
	if err != nil {
		s.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", in.GetUsernames()))
		return nil, status.Error(codes.Internal, "Error while trying to delete friends.")
	}

	if len(userIDs)+len(in.GetIds()) == 0 {
		s.logger.Info("No valid ID or username was provided.")
		return &empty.Empty{}, nil
	}

	allIDs := make([]string, 0, len(in.GetIds())+len(userIDs))
	allIDs = append(allIDs, in.GetIds()...)
	allIDs = append(allIDs, userIDs...)

	if err := DeleteFriends(s.logger, s.db, userID, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to delete friends.")
	}

	// After hook.
	if fn := s.runtime.AfterDeleteFriends(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, &empty.Empty{})

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) BlockFriends(ctx context.Context, in *api.BlockFriendsRequest) (*empty.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeBlockFriends(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", userID.String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot block self.")
		}
		if _, err := uuid.FromString(id); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	username := ctx.Value(ctxUsernameKey{}).(string)
	for _, u := range in.GetUsernames() {
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot block self.")
		}
	}

	userIDs, err := fetchUserID(s.db, in.GetUsernames())
	if err != nil {
		s.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", in.GetUsernames()))
		return nil, status.Error(codes.Internal, "Error while trying to block friends.")
	}

	if len(userIDs)+len(in.GetIds()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "No valid ID or username was provided.")
	}

	allIDs := make([]string, 0, len(in.GetIds())+len(userIDs))
	allIDs = append(allIDs, in.GetIds()...)
	allIDs = append(allIDs, userIDs...)

	if err := BlockFriends(s.logger, s.db, userID, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to block friends.")
	}

	// After hook.
	if fn := s.runtime.AfterBlockFriends(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, &empty.Empty{})

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) ImportFacebookFriends(ctx context.Context, in *api.ImportFacebookFriendsRequest) (*empty.Empty, error) {
	// Before hook.
	if fn := s.runtime.BeforeImportFacebookFriends(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", ctx.Value(ctxUserIDKey{}).(uuid.UUID).String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	if in.Account == nil || in.Account.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Facebook token is required.")
	}

	err := importFacebookFriends(s.logger, s.db, s.router, s.socialClient, ctx.Value(ctxUserIDKey{}).(uuid.UUID), ctx.Value(ctxUsernameKey{}).(string), in.Account.Token, in.Reset_ != nil && in.Reset_.Value)
	if err != nil {
		// Already logged inside the core importFacebookFriends function.
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterImportFacebookFriends(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, &empty.Empty{})

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return &empty.Empty{}, nil
}
