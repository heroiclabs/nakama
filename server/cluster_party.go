package server

import (
	"context"
	"errors"
	"fmt"
	"strings"

	ncapi "github.com/doublemo/nakama-cluster/api"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func (s *ClusterServer) PartyJoinRequest(ctx context.Context, id uuid.UUID, node string, presence *Presence) (bool, error) {
	request := rtapi.PartyJoinRequest{
		PartyId:   id.String(),
		Presences: make([]*rtapi.UserPresence, 1),
	}

	request.Presences[0] = &rtapi.UserPresence{
		UserId:      presence.GetUserId(),
		SessionId:   presence.GetSessionId(),
		Username:    presence.GetUsername(),
		Persistence: presence.GetPersistence(),
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return false, err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	respose, err := s.SendAndRecv(ctx, &ncapi.Envelope{Cid: cid, Payload: &ncapi.Envelope_Bytes{Bytes: bytes}}, node)
	if err != nil {
		return false, err
	}

	if len(respose) < 1 {
		return false, errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return false, errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		ret := respose[0].GetBytes()
		return ret[0] == 0x1, nil
	}
	return false, ErrPartyNotFound
}

func (s *ClusterServer) onPartyJoinRequest(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	var request rtapi.PartyJoinRequest
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	ok, err := s.partyRegistry.PartyJoinRequest(s.ctx, partyId, s.NodeId(), &Presence{
		ID: PresenceID{
			Node:      node,
			SessionID: uuid.FromStringOrNil(request.Presences[0].SessionId),
		},

		UserID: uuid.FromStringOrNil(request.Presences[0].UserId),
		Meta: PresenceMeta{
			Username: request.Presences[0].Username,
		},
	})

	if err != nil {
		return nil, err
	}

	response := &ncapi.Envelope_Bytes{
		Bytes: make([]byte, 1),
	}

	if ok {
		response.Bytes[0] = 0x1
	} else {
		response.Bytes[0] = 0x0
	}
	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) PartyPromote(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	request := rtapi.PartyPromote{
		PartyId:  id.String(),
		Presence: presence,
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	envelope.Vars["sessionID"] = sessionID
	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return err
	}

	if len(respose) < 1 {
		return errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		return nil
	}

	return ErrPartyNotFound
}

func (s *ClusterServer) onPartyPromote(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	sessionID := msg.Vars["sessionID"]
	var request rtapi.PartyPromote
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	err := s.partyRegistry.PartyPromote(s.ctx, partyId, s.NodeId(), sessionID, node, request.GetPresence())
	if err != nil {
		return nil, err
	}

	response := &ncapi.Envelope_Bytes{
		Bytes: make([]byte, 1),
	}

	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) PartyAccept(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	request := rtapi.PartyAccept{
		PartyId:  id.String(),
		Presence: presence,
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	envelope.Vars["sessionID"] = sessionID
	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return err
	}

	if len(respose) < 1 {
		return errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		return nil
	}

	return ErrPartyNotFound
}

func (s *ClusterServer) onPartyAccept(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	sessionID := msg.Vars["sessionID"]
	var request rtapi.PartyAccept
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	err := s.partyRegistry.PartyAccept(s.ctx, partyId, s.NodeId(), sessionID, node, request.GetPresence())
	if err != nil {
		return nil, err
	}

	response := &ncapi.Envelope_Bytes{
		Bytes: make([]byte, 1),
	}

	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) PartyRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	request := rtapi.PartyRemove{
		PartyId:  id.String(),
		Presence: presence,
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	envelope.Vars["sessionID"] = sessionID
	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return err
	}

	if len(respose) < 1 {
		return errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		return nil
	}

	return ErrPartyNotFound
}

func (s *ClusterServer) onPartyRemove(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	sessionID := msg.Vars["sessionID"]
	var request rtapi.PartyRemove
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	err := s.partyRegistry.PartyRemove(s.ctx, partyId, s.NodeId(), sessionID, node, request.GetPresence())
	if err != nil {
		return nil, err
	}

	response := &ncapi.Envelope_Bytes{
		Bytes: make([]byte, 1),
	}

	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) PartyClose(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) error {
	request := rtapi.PartyClose{
		PartyId: id.String(),
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	envelope.Vars["sessionID"] = sessionID
	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return err
	}
	if len(respose) < 1 {
		return errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		return nil
	}

	return ErrPartyNotFound
}

func (s *ClusterServer) onPartyClose(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	sessionID := msg.Vars["sessionID"]
	var request rtapi.PartyClose
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	err := s.partyRegistry.PartyClose(s.ctx, partyId, s.NodeId(), sessionID, node)
	if err != nil {
		return nil, err
	}

	response := &ncapi.Envelope_Bytes{
		Bytes: make([]byte, 1),
	}

	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) PartyJoinRequestList(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) ([]*rtapi.UserPresence, error) {
	request := rtapi.PartyJoinRequestList{
		PartyId: id.String(),
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return nil, err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	envelope.Vars["sessionID"] = sessionID
	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return nil, err
	}

	if len(respose) < 1 {
		return nil, errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return nil, errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		var ret rtapi.PartyJoinRequest
		if err := proto.Unmarshal(respose[0].GetBytes(), &ret); err != nil {
			return nil, err
		}

		return ret.Presences, nil
	}

	return nil, ErrPartyNotFound
}

func (s *ClusterServer) onPartyJoinRequestList(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	sessionID := msg.Vars["sessionID"]
	var request rtapi.PartyJoinRequestList
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	userPresences, err := s.partyRegistry.PartyJoinRequestList(s.ctx, partyId, s.NodeId(), sessionID, node)
	if err != nil {
		return nil, err
	}

	bytes, _ := proto.Marshal(&rtapi.PartyJoinRequest{PartyId: request.PartyId, Presences: userPresences})
	response := &ncapi.Envelope_Bytes{
		Bytes: bytes,
	}

	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) PartyMatchmakerAdd(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, query string, minCount, maxCount, countMultiple int, stringProperties map[string]string, numericProperties map[string]float64) (string, []*PresenceID, error) {
	request := rtapi.PartyMatchmakerAdd{
		PartyId:           id.String(),
		MinCount:          int32(minCount),
		MaxCount:          int32(maxCount),
		Query:             query,
		StringProperties:  stringProperties,
		NumericProperties: numericProperties,
		CountMultiple:     &wrapperspb.Int32Value{Value: int32(countMultiple)},
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return "", nil, err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	envelope.Vars["sessionID"] = sessionID
	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return "", nil, err
	}

	if len(respose) < 1 {
		return "", nil, errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return "", nil, errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		var ret ncapi.WPartyMatchmakerAdd
		if err := proto.Unmarshal(respose[0].GetBytes(), &ret); err != nil {
			return "", nil, err
		}

		presences := make([]*PresenceID, len(ret.Presences))
		for i, presence := range ret.Presences {
			presences[i] = &PresenceID{Node: presence.Node, SessionID: uuid.FromStringOrNil(presence.SessionID)}
		}
		return ret.Ticket, presences, nil
	}
	return "", nil, ErrPartyNotFound
}

func (s *ClusterServer) onPartyMatchmakerAdd(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	sessionID := msg.Vars["sessionID"]
	var request rtapi.PartyMatchmakerAdd
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	ticket, presences, err := s.partyRegistry.PartyMatchmakerAdd(s.ctx, partyId, s.NodeId(), sessionID, node, request.Query, int(request.MinCount), int(request.MaxCount), int(request.CountMultiple.GetValue()), request.StringProperties, request.NumericProperties)
	if err != nil {
		return nil, err
	}

	data := &ncapi.WPartyMatchmakerAdd{
		Ticket:    ticket,
		Presences: make([]*ncapi.PresenceID, len(presences)),
	}

	for i, presence := range presences {
		data.Presences[i] = &ncapi.PresenceID{
			Node:      presence.Node,
			SessionID: presence.SessionID.String(),
		}
	}

	bytes, _ := proto.Marshal(data)
	response := &ncapi.Envelope_Bytes{
		Bytes: bytes,
	}

	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) PartyMatchmakerRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, ticket string) error {
	request := rtapi.PartyMatchmakerRemove{
		PartyId: id.String(),
		Ticket:  ticket,
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	envelope.Vars["sessionID"] = sessionID
	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return err
	}

	if len(respose) < 1 {
		return errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		return nil
	}
	return ErrPartyNotFound
}

func (s *ClusterServer) onPartyMatchmakerRemove(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	sessionID := msg.Vars["sessionID"]
	var request rtapi.PartyMatchmakerRemove
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	err := s.partyRegistry.PartyMatchmakerRemove(s.ctx, partyId, s.NodeId(), sessionID, node, request.Ticket)
	if err != nil {
		return nil, err
	}

	response := &ncapi.Envelope_Bytes{
		Bytes: make([]byte, 1),
	}
	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}

func (s *ClusterServer) PartyDataSend(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, opCode int64, data []byte) error {
	request := rtapi.PartyDataSend{
		PartyId: id.String(),
		OpCode:  opCode,
		Data:    data,
	}

	bytes, err := proto.Marshal(&request)
	if err != nil {
		return err
	}

	cid := strings.ToLower(fmt.Sprintf("%T", &request))
	envelope := &ncapi.Envelope{
		Cid:     cid,
		Payload: &ncapi.Envelope_Bytes{Bytes: bytes},
		Vars:    make(map[string]string),
	}

	envelope.Vars["sessionID"] = sessionID
	respose, err := s.SendAndRecv(ctx, envelope, node)
	if err != nil {
		return err
	}

	if len(respose) < 1 {
		return errors.New("failed recv data")
	}

	switch respose[0].Payload.(type) {
	case *ncapi.Envelope_Error:
		err := respose[0].GetError()
		return errors.New(err.Message)
	case *ncapi.Envelope_Bytes:
		return nil
	}
	return ErrPartyNotFound
}

func (s *ClusterServer) OnPartyDataSend(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	sessionID := msg.Vars["sessionID"]
	var request rtapi.PartyDataSend
	if err := proto.Unmarshal(msg.GetBytes(), &request); err != nil {
		return nil, err
	}

	partyId := uuid.FromStringOrNil(request.PartyId)
	err := s.partyRegistry.PartyDataSend(s.ctx, partyId, s.NodeId(), sessionID, node, request.OpCode, request.Data)
	if err != nil {
		return nil, err
	}

	response := &ncapi.Envelope_Bytes{
		Bytes: make([]byte, 1),
	}
	return &ncapi.Envelope{Cid: msg.Cid, Payload: response}, nil
}
