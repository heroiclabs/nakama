package server

import (
	"context"
	"fmt"
	"strings"
	"time"

	ncapi "github.com/doublemo/nakama-cluster/api"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

func (s *ClusterServer) MatchJoinAttempt(ctx context.Context, id uuid.UUID, node string, userID, sessionID uuid.UUID, username string, sessionExpiry int64, vars map[string]string, clientIP, clientPort, fromNode string, metadata map[string]string) (bool, bool, bool, string, string, []*MatchPresence) {
	request := ncapi.RMatchJoinAttempt{
		Id:            id.String(),
		UserID:        userID.String(),
		SessionID:     sessionID.String(),
		Username:      username,
		SessionExpiry: sessionExpiry,
		Vars:          vars,
		ClientIP:      clientIP,
		ClientPort:    clientPort,
		FromNode:      fromNode,
		Metadata:      metadata,
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return false, false, false, "", "", nil
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return false, false, false, "", "", nil
	}

	if len(respose) < 1 {
		return false, false, false, "", "", nil
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		return false, false, false, "", "", nil

	case *ncapi.Envelope_Bytes:
		var ret ncapi.WMatchJoinAttempt
		if err := proto.Unmarshal(respose[0].GetBytes(), &ret); err != nil {
			return false, false, false, "", "", nil
		}

		matchPresences := make([]*MatchPresence, len(ret.MatchPresences))
		for i, presence := range ret.MatchPresences {
			matchPresences[i] = &MatchPresence{
				Node:      presence.Node,
				UserID:    uuid.FromStringOrNil(presence.UserID),
				SessionID: uuid.FromStringOrNil(presence.SessionID),
				Username:  presence.Username,
				Reason:    runtime.PresenceReason(presence.Reason),
			}
		}

		return ret.Found, ret.Allow, ret.IsNew, ret.Reason, ret.Label, matchPresences
	}

	return false, false, false, "", "", nil
}

func (s *ClusterServer) onMatchJoinAttempt(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	var request ncapi.RMatchJoinAttempt
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	id := uuid.FromStringOrNil(request.Id)
	userID := uuid.FromStringOrNil(request.UserID)
	sessionID := uuid.FromStringOrNil(request.SessionID)

	var matchPresence []*MatchPresence
	data := &ncapi.WMatchJoinAttempt{}
	data.Found, data.Allow, data.IsNew, data.Reason, data.Label, matchPresence = s.matchRegistry.JoinAttempt(s.ctx, id, s.NodeId(), userID, sessionID, request.Username, request.SessionExpiry, request.Vars, request.ClientIP, request.ClientPort, request.FromNode, request.Metadata)
	if matchPresence != nil {
		data.MatchPresences = make([]*ncapi.MatchPresence, len(matchPresence))
		for i, presence := range matchPresence {
			data.MatchPresences[i] = &ncapi.MatchPresence{
				Node:      presence.Node,
				UserID:    presence.UserID.String(),
				SessionID: presence.SessionID.String(),
				Username:  presence.Username,
				Reason:    int32(presence.Reason),
			}
		}
	}

	bytes, _ := proto.Marshal(data)
	response := &ncapi.Envelope_Bytes{
		Bytes: bytes,
	}

	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) MatchSendData(ctx context.Context, id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte, reliable bool, receiveTime int64) {
	request := rtapi.MatchDataSend{
		MatchId:   id.String(),
		OpCode:    opCode,
		Presences: make([]*rtapi.UserPresence, 0),
		Data:      data,
		Reliable:  reliable,
	}

	request.Presences[0] = &rtapi.UserPresence{
		UserId:    userID.String(),
		SessionId: sessionID.String(),
		Username:  username,
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		s.logger.Warn("Failed to sent match data", zap.Error(err))
		return
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	err = s.Send(envelope, node)
	if err != nil {
		s.logger.Warn("Failed to sent match data", zap.Error(err))
		return
	}
}

func (s *ClusterServer) onMatchSendData(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	var request rtapi.MatchDataSend
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	matchId := uuid.FromStringOrNil(request.MatchId)
	userID := uuid.FromStringOrNil(request.Presences[0].UserId)
	sessionID := uuid.FromStringOrNil(request.Presences[0].SessionId)
	s.matchRegistry.SendData(matchId, s.NodeId(), userID, sessionID, request.Presences[0].Username, node, request.OpCode, request.Data, request.Reliable, time.Now().UTC().UnixNano()/int64(time.Millisecond))
	return nil, nil
}
