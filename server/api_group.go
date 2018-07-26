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
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) CreateGroup(ctx context.Context, in *api.CreateGroupRequest) (*api.Group, error) {
	if in.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group name must be set.")
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	group, err := CreateGroup(s.logger, s.db, userID, userID, in.GetName(), in.GetLangTag(), in.GetDescription(), in.GetAvatarUrl(), "", in.GetOpen(), -1)
	if err != nil {
		if err == ErrGroupNameInUse {
			return nil, status.Error(codes.InvalidArgument, "Group name is in use.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to create group.")
	}

	return group, nil
}

func (s *ApiServer) UpdateGroup(ctx context.Context, in *api.UpdateGroupRequest) (*empty.Empty, error) {
	if in.GetGroupId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be set.")
	}

	groupID, err := uuid.FromString(in.GetGroupId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	if in.GetName() != nil {
		if len(in.GetName().String()) < 1 {
			return nil, status.Error(codes.InvalidArgument, "Group name cannot be empty.")
		}
	}

	if in.GetLangTag() != nil {
		if len(in.GetLangTag().String()) < 1 {
			return nil, status.Error(codes.InvalidArgument, "Group language cannot be empty.")
		}
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	err = UpdateGroup(s.logger, s.db, groupID, userID, nil, in.GetName(), in.GetLangTag(), in.GetDescription(), in.GetAvatarUrl(), nil, in.GetOpen(), -1)
	if err != nil {
		if err == ErrGroupPermissionDenied {
			return nil, status.Error(codes.NotFound, "Group not found or you're not allowed to update.")
		} else if err == ErrGroupNoUpdateOps {
			return nil, status.Error(codes.InvalidArgument, "Specify at least one field to update.")
		} else if err == ErrGroupNotUpdated {
			return nil, status.Error(codes.InvalidArgument, "No new fields in group update.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to update group.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) DeleteGroup(ctx context.Context, in *api.DeleteGroupRequest) (*empty.Empty, error) {
	if in.GetGroupId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be set.")
	}

	groupID, err := uuid.FromString(in.GetGroupId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	err = DeleteGroup(s.logger, s.db, groupID, userID)
	if err != nil {
		if err == ErrGroupPermissionDenied {
			return nil, status.Error(codes.InvalidArgument, "Group not found or you're not allowed to delete.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to delete group.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) JoinGroup(ctx context.Context, in *api.JoinGroupRequest) (*empty.Empty, error) {
	if in.GetGroupId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be set.")
	}

	groupID, err := uuid.FromString(in.GetGroupId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	err = JoinGroup(s.logger, s.db, groupID, userID)
	if err != nil {
		if err == ErrGroupNotFound {
			return nil, status.Error(codes.NotFound, "Group not found.")
		} else if err == ErrGroupFull {
			return nil, status.Error(codes.InvalidArgument, "Group is full.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to join group.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LeaveGroup(ctx context.Context, in *api.LeaveGroupRequest) (*empty.Empty, error) {
	if in.GetGroupId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be set.")
	}

	groupID, err := uuid.FromString(in.GetGroupId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	err = LeaveGroup(s.logger, s.db, groupID, userID)
	if err != nil {
		if err == ErrGroupLastSuperadmin {
			return nil, status.Error(codes.InvalidArgument, "Cannot leave group when you are the last superadmin.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to leave group.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) AddGroupUsers(ctx context.Context, in *api.AddGroupUsersRequest) (*empty.Empty, error) {
	if in.GetGroupId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be set.")
	}

	groupID, err := uuid.FromString(in.GetGroupId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	if len(in.GetUserIds()) == 0 {
		return &empty.Empty{}, nil
	}

	userIDs := make([]uuid.UUID, 0, len(in.GetUserIds()))
	for _, id := range in.GetUserIds() {
		uid := uuid.FromStringOrNil(id)
		if uuid.Equal(uuid.Nil, uid) {
			return nil, status.Error(codes.InvalidArgument, "User ID must be a valid ID.")
		}
		userIDs = append(userIDs, uid)
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	err = AddGroupUsers(s.logger, s.db, userID, groupID, userIDs)
	if err != nil {
		if err == ErrGroupPermissionDenied {
			return nil, status.Error(codes.NotFound, "Group not found or permission denied.")
		} else if err == ErrGroupFull {
			return nil, status.Error(codes.InvalidArgument, "Group is full.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to add users to a group.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) KickGroupUsers(ctx context.Context, in *api.KickGroupUsersRequest) (*empty.Empty, error) {
	if in.GetGroupId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be set.")
	}

	groupID, err := uuid.FromString(in.GetGroupId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	if len(in.GetUserIds()) == 0 {
		return &empty.Empty{}, nil
	}

	userIDs := make([]uuid.UUID, 0, len(in.GetUserIds()))
	for _, id := range in.GetUserIds() {
		uid := uuid.FromStringOrNil(id)
		if uuid.Equal(uuid.Nil, uid) {
			return nil, status.Error(codes.InvalidArgument, "User ID must be a valid ID.")
		}
		userIDs = append(userIDs, uid)
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	if err = KickGroupUsers(s.logger, s.db, userID, groupID, userIDs); err != nil {
		if err == ErrGroupPermissionDenied {
			return nil, status.Error(codes.NotFound, "Group not found or permission denied.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to kick users from a group.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) PromoteGroupUsers(ctx context.Context, in *api.PromoteGroupUsersRequest) (*empty.Empty, error) {
	if in.GetGroupId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be set.")
	}

	groupID, err := uuid.FromString(in.GetGroupId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	if len(in.GetUserIds()) == 0 {
		return &empty.Empty{}, nil
	}

	userIDs := make([]uuid.UUID, 0, len(in.GetUserIds()))
	for _, id := range in.GetUserIds() {
		uid := uuid.FromStringOrNil(id)
		if uuid.Equal(uuid.Nil, uid) {
			return nil, status.Error(codes.InvalidArgument, "User ID must be a valid ID.")
		}
		userIDs = append(userIDs, uid)
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	err = PromoteGroupUsers(s.logger, s.db, userID, groupID, userIDs)
	if err != nil {
		if err == ErrGroupPermissionDenied {
			return nil, status.Error(codes.NotFound, "Group not found or permission denied.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to promote users in a group.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) ListGroupUsers(ctx context.Context, in *api.ListGroupUsersRequest) (*api.GroupUserList, error) {
	if in.GetGroupId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be set.")
	}

	groupID, err := uuid.FromString(in.GetGroupId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	groupUsers, err := ListGroupUsers(s.logger, s.db, s.tracker, groupID)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to list users in a group.")
	}

	return groupUsers, nil
}

func (s *ApiServer) ListUserGroups(ctx context.Context, in *api.ListUserGroupsRequest) (*api.UserGroupList, error) {
	if in.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "User ID must be set.")
	}

	userID, err := uuid.FromString(in.GetUserId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Group ID must be a valid ID.")
	}

	userGroups, err := ListUserGroups(s.logger, s.db, userID)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to list groups for a user.")
	}

	return userGroups, nil
}

func (s *ApiServer) ListGroups(ctx context.Context, in *api.ListGroupsRequest) (*api.GroupList, error) {
	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	groups, err := ListGroups(s.logger, s.db, in.GetName(), limit, in.GetCursor())
	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to list groups.")
	}

	return groups, nil
}
