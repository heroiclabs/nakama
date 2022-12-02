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
	switch msg.Cid {
	case "*rtapi.partyjoinrequest":
		return s.onPartyJoinRequest(node, msg)

	case "*rtapi.partypromote":
		return s.onPartyPromote(node, msg)

	case "*rtapi.partyaccept":
		return s.onPartyAccept(node, msg)

	case "*rtapi.partyremove":
		return s.onPartyRemove(node, msg)

	case "*rtapi.partyclose":
		return s.onPartyClose(node, msg)

	case "*rtapi.partyjoinrequestlist":
		return s.onPartyJoinRequestList(node, msg)

	case "*rtapi.partymatchmakeradd":
		return s.onPartyMatchmakerAdd(node, msg)

	case "*rtapi.partymatchmakerremove":
		return s.onPartyMatchmakerRemove(node, msg)

	case "*rtapi.partydatadend":
		return s.onPartyDataSend(node, msg)

	case "*ncapi.RMatchJoinAttempt":
		return s.onMatchJoinAttempt(node, msg)

	case "*rtapi.matchdatasend":
		return s.onMatchSendData(node, msg)

	}

	return nil, ErrInvalidOperator
}
