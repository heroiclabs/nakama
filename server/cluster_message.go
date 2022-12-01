package server

import (
	ncapi "github.com/doublemo/nakama-cluster/api"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

func (s *ClusterServer) onMessage(node string, msg *ncapi.Envelope) {
	message := msg.GetMessage()
	var envelope rtapi.Envelope
	if err := proto.Unmarshal(message.GetContent(), &envelope); err != nil {
		s.logger.Error("Failed to unmarshal message", zap.Error(err))
		return
	}

	for _, id := range message.SessionID {
		session := s.sessionRegistry.Get(uuid.FromStringOrNil(id))
		if session == nil {
			continue
		}

		if err := session.Send(&envelope, true); err != nil {
			s.logger.Warn("Failed to send message", zap.Error(err))
		}
	}
}

func (s *ClusterServer) onBytes(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	bytes := msg.GetBytes()
	switch msg.Cid {
	case "0":
		s.logger.Debug("recv bytes", zap.Int("Len", len(bytes)))
	}

	return nil, nil
}
