package server

import (
	"context"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
)

func (s *ConsoleServer) ListGroups(ctx context.Context, in *console.ListGroupsRequest) (*console.GroupList, error) {
	return &console.GroupList{
		Users: []*api.Group{
			{
				Name: "Group1",
			},
			{
				Name: "Group2",
			},
			{
				Name: "Group3",
			},
		},
		TotalCount: 0,
		NextCursor: "",
	}, nil
}
