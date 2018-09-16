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
	"encoding/json"
	"fmt"
	"go.opencensus.io/stats"
	"go.opencensus.io/tag"
	"go.opencensus.io/trace"
	"go.uber.org/zap"
	"time"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) ListStorageObjects(ctx context.Context, in *api.ListStorageObjectsRequest) (*api.StorageObjectList, error) {
	caller := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeListStorageObjects(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, caller.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", caller.String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	userID := uuid.Nil
	if in.GetUserId() != "" {
		uid, err := uuid.FromString(in.GetUserId())
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID - make sure user ID is a valid UUID.")
		}
		userID = uid
	}

	storageObjectList, code, listingError := StorageListObjects(s.logger, s.db, caller, userID, in.GetCollection(), limit, in.GetCursor())

	if listingError != nil {
		if code == codes.Internal {
			return nil, status.Error(code, "Error listing storage objects.")
		}
		return nil, status.Error(code, listingError.Error())
	}

	// After hook.
	if fn := s.runtime.AfterListStorageObjects(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, caller.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, storageObjectList)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return storageObjectList, nil
}

func (s *ApiServer) ReadStorageObjects(ctx context.Context, in *api.ReadStorageObjectsRequest) (*api.StorageObjects, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeReadStorageObjects(); fn != nil {
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

	if in.GetObjectIds() == nil || len(in.GetObjectIds()) == 0 {
		return &api.StorageObjects{}, nil
	}

	for _, object := range in.GetObjectIds() {
		if object.GetCollection() == "" || object.GetKey() == "" {
			return nil, status.Error(codes.InvalidArgument, "Invalid collection or key value supplied. They must be set.")
		}

		if object.GetUserId() != "" {
			if uid, err := uuid.FromString(object.GetUserId()); err != nil || uuid.Equal(uid, uuid.Nil) {
				return nil, status.Error(codes.InvalidArgument, "Invalid user ID - make sure user ID is a valid UUID.")
			}
		}
	}

	objects, err := StorageReadObjects(s.logger, s.db, userID, in.GetObjectIds())
	if err != nil {
		return nil, status.Error(codes.Internal, "Error reading storage objects.")
	}

	// After hook.
	if fn := s.runtime.AfterReadStorageObjects(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, objects)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return objects, nil
}

func (s *ApiServer) WriteStorageObjects(ctx context.Context, in *api.WriteStorageObjectsRequest) (*api.StorageObjectAcks, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeWriteStorageObjects(); fn != nil {
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
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", ctx.Value(ctxUsernameKey{}).(string)))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	if in.GetObjects() == nil || len(in.GetObjects()) == 0 {
		return &api.StorageObjectAcks{}, nil
	}

	for _, object := range in.GetObjects() {
		if object.GetCollection() == "" || object.GetKey() == "" || object.GetValue() == "" {
			return nil, status.Error(codes.InvalidArgument, "Invalid collection or key value supplied. They must be set.")
		}

		if object.GetPermissionRead() != nil {
			permissionRead := object.GetPermissionRead().GetValue()
			if permissionRead < 0 || permissionRead > 2 {
				return nil, status.Error(codes.InvalidArgument, "Invalid Read permission supplied. It must be either 0, 1 or 2.")
			}
		}

		if object.GetPermissionWrite() != nil {
			permissionWrite := object.GetPermissionWrite().GetValue()
			if permissionWrite < 0 || permissionWrite > 1 {
				return nil, status.Error(codes.InvalidArgument, "Invalid Write permission supplied. It must be either 0 or 1.")
			}
		}

		var maybeJSON map[string]interface{}
		if json.Unmarshal([]byte(object.GetValue()), &maybeJSON) != nil {
			return nil, status.Error(codes.InvalidArgument, "Object value must be JSON.")
		}
	}

	userObjects := map[uuid.UUID][]*api.WriteStorageObject{userID: in.GetObjects()}

	acks, code, err := StorageWriteObjects(s.logger, s.db, false, userObjects)
	if err != nil {
		if code == codes.Internal {
			return nil, status.Error(codes.Internal, "Error writing storage objects.")
		}
		return nil, status.Error(code, err.Error())
	}

	// After hook.
	if fn := s.runtime.AfterWriteStorageObjects(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, acks)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return acks, nil
}

func (s *ApiServer) DeleteStorageObjects(ctx context.Context, in *api.DeleteStorageObjectsRequest) (*empty.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeDeleteStorageObjects(); fn != nil {
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

	if in.GetObjectIds() == nil || len(in.GetObjectIds()) == 0 {
		return &empty.Empty{}, nil
	}

	for _, objectID := range in.GetObjectIds() {
		if objectID.GetCollection() == "" || objectID.GetKey() == "" {
			return nil, status.Error(codes.InvalidArgument, "Invalid collection or key value supplied. They must be set.")
		}
	}

	objectIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{userID: in.GetObjectIds()}

	if code, err := StorageDeleteObjects(s.logger, s.db, false, objectIDs); err != nil {
		if code == codes.Internal {
			return nil, status.Error(codes.Internal, "Error deleting storage objects.")
		}
		return nil, status.Error(code, err.Error())
	}

	// After hook.
	if fn := s.runtime.AfterDeleteStorageObjects(); fn != nil {
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
