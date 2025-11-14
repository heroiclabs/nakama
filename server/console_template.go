// Copyright 2025 The Nakama Authors
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
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/heroiclabs/nakama/v3/console/acl"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *ConsoleServer) AddAclTemplate(ctx context.Context, in *console.AddAclTemplateRequest) (*console.AclTemplate, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	query := `
		INSERT INTO console_acl_template
			(id, name, description, acl)
		VALUES
			($1, $2, $3, $4)
		RETURNING
			name, description, acl, create_time, update_time
`

	templateAcl := acl.New(in.Acl)
	aclValue, err := templateAcl.ToJson()
	if err != nil {
		logger.Error("Error marshaling acl to json", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal error")
	}

	id := uuid.Must(uuid.NewV4())
	var createTime, updateTime time.Time
	var name, description, aclJson string
	if err = s.db.QueryRowContext(ctx, query, id, in.Name, in.Description, aclValue).Scan(&name, &description, &aclJson, &createTime, &updateTime); err != nil {
		logger.Error("Error inserting acl template", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error adding ACL template.")
	}

	templateAcl, err = acl.NewFromJson(aclJson)
	if err != nil {
		logger.Error("Error unmarshaling acl from json", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal error")
	}

	out := &console.AclTemplate{
		Id:          id.String(),
		Name:        name,
		Description: description,
		Acl:         templateAcl.ACL(),
		CreateTime:  timestamppb.New(createTime),
		UpdateTime:  timestamppb.New(updateTime),
	}

	return out, nil
}

func (s *ConsoleServer) UpdateAclTemplate(ctx context.Context, in *console.UpdateAclTemplateRequest) (*console.AclTemplate, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	query := `
		UPDATE console_acl_template SET
			name = $1,
			description = $2,
			acl = $3
		WHERE
			id = $4
		RETURNING
			id, name, description, acl, create_time, update_time
`

	templateAcl := acl.New(in.Acl)
	aclValue, err := templateAcl.ToJson()
	if err != nil {
		logger.Error("Error marshaling acl to json", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal error")
	}

	var id uuid.UUID
	var createTime, updateTime time.Time
	var name, description, aclJson string
	if err = s.db.QueryRowContext(ctx, query, in.Name, in.Description, aclValue, in.Id).Scan(&id, &name, &description, &aclJson, &createTime, &updateTime); err != nil {
		logger.Error("Error inserting acl template", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error adding ACL template.")
	}

	templateAcl, err = acl.NewFromJson(aclJson)
	if err != nil {
		logger.Error("Error unmarshaling acl from json", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal error")
	}

	out := &console.AclTemplate{
		Name:        name,
		Description: description,
		Acl:         templateAcl.ACL(),
		CreateTime:  timestamppb.New(createTime),
		UpdateTime:  timestamppb.New(updateTime),
	}

	return out, nil
}

func (s *ConsoleServer) ListAclTemplates(ctx context.Context, in *emptypb.Empty) (*console.AclTemplateList, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	query := `
		SELECT
			id, name, description, acl, create_time, update_time
		FROM
			console_acl_template
		ORDER BY
			name ASC
`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		logger.Error("Error querying acl templates", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error listing ACL templates.")
	}
	defer rows.Close()

	var templates []*console.AclTemplate
	for rows.Next() {
		var id uuid.UUID
		var name, description, aclJson string
		var createTime, updateTime time.Time

		if err := rows.Scan(&id, &name, &description, &aclJson, &createTime, &updateTime); err != nil {
			logger.Error("Error scanning acl template row", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error listing ACL templates.")
		}

		templateAcl, err := acl.NewFromJson(aclJson)
		if err != nil {
			logger.Error("Error unmarshaling acl from json", zap.Error(err))
			return nil, status.Error(codes.Internal, "Internal error")
		}

		template := &console.AclTemplate{
			Id:          id.String(),
			Name:        name,
			Description: description,
			Acl:         templateAcl.ACL(),
			CreateTime:  timestamppb.New(createTime),
			UpdateTime:  timestamppb.New(updateTime),
		}
		templates = append(templates, template)
	}

	return &console.AclTemplateList{Templates: templates}, nil
}

func (s *ConsoleServer) DeleteAclTemplate(ctx context.Context, in *console.DeleteAclTemplateRequest) (*emptypb.Empty, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	if _, err := s.db.ExecContext(ctx, "DELETE from console_acl_template WHERE id = $1", in.Id); err != nil {
		logger.Error("Error deleting acl template", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error deleting ACL template.")
	}

	return &emptypb.Empty{}, nil
}
