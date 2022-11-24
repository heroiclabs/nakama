package server

import (
	"context"
	"fmt"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"

	nakamacluster "github.com/doublemo/nakama-cluster"
	"github.com/doublemo/nakama-cluster/api"
)

type sessionProxy struct {
	id              uuid.UUID
	userID          uuid.UUID
	node            string
	conn            *nakamacluster.NakamaServer
	username        *atomic.String
	format          SessionFormat
	sessionRegistry SessionRegistry
	statusRegistry  *StatusRegistry
	matchmaker      Matchmaker
	tracker         Tracker
	logger          *zap.Logger
}

func (s *sessionProxy) Logger() *zap.Logger {
	return s.logger
}

func (s *sessionProxy) ID() uuid.UUID {
	return s.id
}

func (s *sessionProxy) UserID() uuid.UUID {
	return s.userID
}

func (s *sessionProxy) ClientIP() string {
	return ""
}

func (s *sessionProxy) ClientPort() string {
	return ""
}

func (s *sessionProxy) Lang() string {
	return ""
}

func (s *sessionProxy) Context() context.Context {
	return context.Background()
}

func (s *sessionProxy) Username() string {
	return s.username.Load()
}

func (s *sessionProxy) SetUsername(username string) {
	s.username.Store(username)
}

func (s *sessionProxy) Vars() map[string]string {
	return make(map[string]string)
}

func (s *sessionProxy) Expiry() int64 {
	return 0
}

func (s *sessionProxy) Node() string {
	return s.node
}

func (s *sessionProxy) Consume() {}

func (s *sessionProxy) Format() SessionFormat {
	return s.format
}

func (s *sessionProxy) Send(envelope *rtapi.Envelope, reliable bool) error {
	bytes, err := proto.Marshal(envelope)
	if err != nil {
		return err
	}

	ok := s.conn.Send(&api.Envelope{Payload: &api.Envelope_Message{Message: &api.Message{SessionID: []string{s.id.String()}, Content: bytes}}}, s.node)
	if !ok {
		return fmt.Errorf("Could not write message")
	}

	return nil
}

func (s *sessionProxy) SendBytes(payload []byte, reliable bool) error {
	ok := s.conn.Send(&api.Envelope{Payload: &api.Envelope_Message{Message: &api.Message{SessionID: []string{s.id.String()}, Content: payload}}}, s.node)
	if !ok {
		return fmt.Errorf("Could not write message")
	}
	return nil
}

func (s *sessionProxy) Close(msg string, reason runtime.PresenceReason, envelopes ...*rtapi.Envelope) {

	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaning up closed client connection")
	}

	// When connection close originates internally in the session, ensure cleanup of external resources and references.
	if err := s.matchmaker.RemoveSessionAll(s.id.String()); err != nil {
		s.logger.Warn("Failed to remove all matchmaking tickets", zap.Error(err))
	}

	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaned up closed connection matchmaker")
	}

	s.tracker.UntrackAll(s.id, reason)
	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaned up closed connection tracker")
	}

	s.statusRegistry.UnfollowAll(s.id)
	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaned up closed connection status registry")
	}

	s.sessionRegistry.Remove(s.id)
	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaned up closed connection session registry")
	}

	// Send final messages, if any are specified.
	for _, envelope := range envelopes {
		s.Send(envelope, true)
	}

	s.logger.Info("Closed client connection")
}

func NewSessionProxy(logger *zap.Logger, sessionID, userID uuid.UUID, node string, username string, format SessionFormat, conn *nakamacluster.NakamaServer) *sessionProxy {
	sessionLogger := logger.With(zap.String("uid", userID.String()), zap.String("sid", sessionID.String()))

	sessionLogger.Info("New proxy session connected", zap.String("node", node))

	session := &sessionProxy{
		id:     sessionID,
		userID: userID,
		node:   node,
		conn:   conn,
		format: format,
		logger: sessionLogger,
	}

	session.SetUsername(username)
	return session
}
