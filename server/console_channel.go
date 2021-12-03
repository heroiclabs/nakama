package server

import (
	"context"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/console"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"sort"
)

func (s *ConsoleServer) ListChannelMessages(ctx context.Context, in *console.ListChannelMessagesRequest) (*api.ChannelMessageList, error) {
	const limit = 50

	stream, err := buildStream(in)
	if err != nil {
		return nil, err
	}

	channelId, err := StreamToChannelId(*stream)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}

	messageList, err := ChannelMessagesList(ctx, s.logger, s.db, uuid.Nil, *stream, channelId, limit, false, in.Cursor)
	if err == runtime.ErrChannelCursorInvalid {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing messages from channel.")
	}

	return messageList, nil
}

func buildStream(in *console.ListChannelMessagesRequest) (*PresenceStream, error) {
	stream := PresenceStream{}
	var err error
	switch in.Type {
	case 2:
		stream.Mode = StreamModeChannel
		if l := len(in.Label); l < 1 || l > 64 {
			return nil, status.Error(codes.InvalidArgument, "Invalid label size.")
		}
		stream.Label = in.Label
	case 3:
		stream.Mode = StreamModeGroup
		if stream.Subject, err = uuid.FromString(in.GroupId); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid group ID format.")
		}
	case 4:
		stream.Mode = StreamModeDM
		users := []string{in.UserIdOne, in.UserIdTwo}
		sort.Strings(users)
		if stream.Subject, err = uuid.FromString(users[0]); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID format.")
		}
		if stream.Subcontext, err = uuid.FromString(users[1]); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID format.")
		}
	default:
		return nil, status.Error(codes.Internal, "Invalid chat type.")
	}
	return &stream, nil
}
