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

	"github.com/heroiclabs/nakama/v3/console"
	"github.com/heroiclabs/nakama/v3/console/acl"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *ConsoleServer) AddAclTemplate(ctx context.Context, in *console.AddAclTemplateRequest) (*console.AclTemplate, error) {
	query := `
		INSERT INTO console_acl_template
			(name, description, acl)
		VALUES
			($1, $2, $3)
		ON CONFLICT
			(name)
		DO UPDATE SET
			description = $2,
			acl = $3,
			update_time = now()
		RETURNING
			name, description, acl, create_time, update_time
`

	templateAcl := acl.New(in.Acl)
	aclValue, err := templateAcl.ToJson()
	if err != nil {
		s.logger.Error("Error marshaling acl to json", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal error")
	}

	var createTime, updateTime time.Time
	var name, description, aclJson string
	if err = s.db.QueryRowContext(ctx, query, in.Name, in.Description, aclValue).Scan(&name, &description, &aclJson, &createTime, &updateTime); err != nil {
		s.logger.Error("Error inserting acl template", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error adding ACL template.")
	}

	templateAcl, err = acl.NewFromJson(aclJson)
	if err != nil {
		s.logger.Error("Error unmarshaling acl from json", zap.Error(err))
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
	query := `
		SELECT
			name, description, acl, create_time, update_time
		FROM
			console_acl_template
		ORDER BY
			name ASC
`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		s.logger.Error("Error querying acl templates", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error listing ACL templates.")
	}
	defer rows.Close()

	var templates []*console.AclTemplate
	for rows.Next() {
		var name, description, aclJson string
		var createTime, updateTime time.Time

		if err := rows.Scan(&name, &description, &aclJson, &createTime, &updateTime); err != nil {
			s.logger.Error("Error scanning acl template row", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error listing ACL templates.")
		}

		templateAcl, err := acl.NewFromJson(aclJson)
		if err != nil {
			s.logger.Error("Error unmarshaling acl from json", zap.Error(err))
			return nil, status.Error(codes.Internal, "Internal error")
		}

		template := &console.AclTemplate{
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

// TODO: Add audit log entry and ACL check.
