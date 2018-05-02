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
	"github.com/satori/go.uuid"
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
		return nil, status.Error(codes.Internal, "Error while trying to create group.")
	}

	if group == nil {
		return nil, status.Error(codes.InvalidArgument, "Did not create group as a group already exists with the same name.")
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
	updated, err := UpdateGroup(s.logger, s.db, groupID, userID, nil, in.GetName(), in.GetLangTag(), in.GetDescription(), in.GetAvatarUrl(), nil, in.GetOpen(), -1)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to update group.")
	}

	if !updated {
		return nil, status.Error(codes.InvalidArgument, "Did not update group - Make sure that group exists, group name is unique and you have the correct permissions.")
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
	deleted, err := DeleteGroup(s.logger, s.db, groupID, userID)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to delete group.")
	}

	if !deleted {
		return nil, status.Error(codes.InvalidArgument, "Did not delete group - Make sure that group exists and you have the correct permissions.")
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

	joined, err := JoinGroup(s.logger, s.db, groupID, userID)

	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to join group.")
	}

	if !joined {
		return nil, status.Error(codes.InvalidArgument, "Did not join group - Make sure that group exists and maximum count has not been reached.")
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
	left, err := LeaveGroup(s.logger, s.db, groupID, userID)

	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to leave group.")
	}

	if !left {
		return nil, status.Error(codes.InvalidArgument, "Did not leave group - Make sure that group exists and you have the correct permissions.")
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
	done, err := AddGroupUsers(s.logger, s.db, userID, groupID, userIDs)

	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to add users to a group.")
	}

	if !done {
		return nil, status.Error(codes.InvalidArgument, "Did not add users to group - Make sure that group exists, you have correct permissions, and maximum member count is not reached.")
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
	promoted, err := PromoteGroupUsers(s.logger, s.db, userID, groupID, userIDs)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to promote users in a group.")
	}

	if !promoted {
		return nil, status.Error(codes.InvalidArgument, "Did not promote users to group - Make sure that group exists and you have correct permissions.")
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
