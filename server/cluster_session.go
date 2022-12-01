package server

import (
	ncapi "github.com/doublemo/nakama-cluster/api"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

func (s *ClusterServer) NotifySessionUp(sessionID, userID uuid.UUID, username string, format SessionFormat, hidden bool) error {
	session := ncapi.SessionNew{
		SessionID: sessionID.String(),
		UserID:    userID.String(),
		Username:  username,
		Format:    int32(format),
		Hidden:    hidden,
	}
	return s.Broadcast(&ncapi.Envelope{Payload: &ncapi.Envelope_SessionNew{SessionNew: &session}})
}

func (s *ClusterServer) NotifySessionDown(sessionID, userID uuid.UUID, reason runtime.PresenceReason, messages ...[]byte) error {
	session := ncapi.SessionClose{
		SessionID: sessionID.String(),
		UserID:    userID.String(),
		Reason:    int32(reason),
		Messages:  messages,
	}

	return s.Broadcast(&ncapi.Envelope{Payload: &ncapi.Envelope_SessionClose{SessionClose: &session}})
}

func (s *ClusterServer) onSessionUp(node string, msg *ncapi.Envelope) {
	session := msg.GetSessionNew()
	sessionID := uuid.FromStringOrNil(session.SessionID)
	userID := uuid.FromStringOrNil(session.UserID)
	s.statusRegistry.Follow(sessionID, map[uuid.UUID]struct{}{userID: {}})
	s.logger.Debug("onSessionUp", zap.String("node", node), zap.String("sessionID", session.SessionID))
}

func (s *ClusterServer) onSessionDown(node string, msg *ncapi.Envelope) {
	close := msg.GetSessionClose()
	sessionID := uuid.FromStringOrNil(close.SessionID)
	s.logger.Debug("onSessionDown", zap.String("node", node), zap.String("sessionID", close.SessionID))
	session := s.sessionRegistry.Get(sessionID)
	if session == nil {
		s.statusRegistry.UnfollowAll(sessionID)
		return
	}

	messages := make([]*rtapi.Envelope, 0, len(close.Messages))
	for _, message := range close.Messages {
		var envelope rtapi.Envelope
		if err := proto.Unmarshal(message, &envelope); err != nil {
			continue
		}

		messages = append(messages, &envelope)
	}

	// to close session
	session.Close("server-side session disconnect", runtime.PresenceReason(close.Reason), messages...)
}
