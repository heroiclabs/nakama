package server

import (
	"context"
	"strconv"
	"sync"
	"time"

	nakamacluster "github.com/doublemo/nakama-cluster"
	ncapi "github.com/doublemo/nakama-cluster/api"
	"github.com/doublemo/nakama-cluster/sd"
	"go.uber.org/zap"
)

type ClusterServer struct {
	ctx             context.Context
	cancelFn        context.CancelFunc
	client          *nakamacluster.Client
	config          Config
	tracker         Tracker
	sessionRegistry SessionRegistry
	statusRegistry  *StatusRegistry
	partyRegistry   PartyRegistry
	logger          *zap.Logger
	once            sync.Once
}

var cc *ClusterServer

func CC() *ClusterServer {
	return cc
}

func StartClusterServer(ctx context.Context, logger *zap.Logger, config Config) *ClusterServer {
	logger.Info("Initializing cluster")
	clusterConfig := config.GetCluster()
	options := sd.EtcdClientOptions{
		Cert:          clusterConfig.Etcd.Cert,
		Key:           clusterConfig.Etcd.Key,
		CACert:        clusterConfig.Etcd.CACert,
		DialTimeout:   time.Duration(clusterConfig.Etcd.DialTimeout) * time.Second,
		DialKeepAlive: time.Duration(clusterConfig.Etcd.DialKeepAlive) * time.Second,
		Username:      clusterConfig.Etcd.Username,
		Password:      clusterConfig.Etcd.Password,
	}

	sdClient, err := sd.NewEtcdV3Client(context.Background(), clusterConfig.Etcd.Endpoints, options)
	if err != nil {
		logger.Fatal("Failed initializing etcd", zap.Error(err))
	}

	vars := map[string]string{
		"rpc_port": strconv.Itoa(config.GetSocket().Port - 1),
		"port":     strconv.Itoa(config.GetSocket().Port),
	}

	ctx, cancelFn := context.WithCancel(ctx)
	s := &ClusterServer{
		ctx:      ctx,
		cancelFn: cancelFn,
		config:   config,
		logger:   logger,
	}

	client := nakamacluster.NewClient(ctx, logger, sdClient, config.GetName(), vars, clusterConfig.Config)
	client.OnDelegate(s)
	s.client = client
	cc = s
	return s
}

func (s *ClusterServer) NotifyAlive(node *nakamacluster.Meta) error {
	return nil
}

func (s *ClusterServer) LocalState(join bool) []byte {
	return nil
}

func (s *ClusterServer) MergeRemoteState(buf []byte, join bool) {}

func (s *ClusterServer) NotifyJoin(node *nakamacluster.Meta) {}

func (s *ClusterServer) NotifyLeave(node *nakamacluster.Meta) {}

func (s *ClusterServer) NotifyUpdate(node *nakamacluster.Meta) {}

func (s *ClusterServer) NotifyMsg(node string, msg *ncapi.Envelope) (*ncapi.Envelope, error) {
	switch msg.Payload.(type) {
	case *ncapi.Envelope_Message:
		s.onMessage(node, msg)

	case *ncapi.Envelope_SessionNew:
		s.onSessionUp(node, msg)

	case *ncapi.Envelope_SessionClose:
		s.onSessionDown(node, msg)

	case *ncapi.Envelope_Track:
		s.onTrack(node, msg)

	case *ncapi.Envelope_Untrack:
		s.onUntrack(node, msg)

	case *ncapi.Envelope_UntrackAll:
		s.onUntrackAll(node, msg)

	case *ncapi.Envelope_UntrackByMode:
		s.onUntrackByMode(node, msg)

	case *ncapi.Envelope_UntrackByStream:
		s.onUntrackByStream(node, msg)

	case *ncapi.Envelope_Bytes:
		return s.onBytes(node, msg)

	}
	return nil, nil
}

// Send 使用TCP发送信息
func (s *ClusterServer) SendAndRecv(ctx context.Context, msg *ncapi.Envelope, to ...string) ([]*ncapi.Envelope, error) {
	return s.client.Send(nakamacluster.NewMessageWithReply(ctx, msg, to...))
}

func (s *ClusterServer) Send(msg *ncapi.Envelope, to ...string) ([]*ncapi.Envelope, error) {
	return s.client.Send(nakamacluster.NewMessage(msg), to...)
}

func (s *ClusterServer) Broadcast(msg *ncapi.Envelope) error {
	return s.client.Broadcast(nakamacluster.NewMessage(msg))
}

func (s *ClusterServer) NodeId() string {
	return s.client.GetLocalNode().Name
}

func (s *ClusterServer) NodeStatus() nakamacluster.MetaStatus {
	return s.client.GetMeta().Status
}

func (s *ClusterServer) Stop() {
	s.once.Do(func() {
		if s.cancelFn != nil {
			s.client.Stop()
			s.cancelFn()
		}
	})
}

func (s *ClusterServer) SetTracker(t Tracker) {
	s.tracker = t
}

func (s *ClusterServer) SetSessionRegistry(sessionRegistry SessionRegistry) {
	s.sessionRegistry = sessionRegistry
}

func (s *ClusterServer) SetStatusRegistry(statusRegistry *StatusRegistry) {
	s.statusRegistry = statusRegistry
}

func (s *ClusterServer) SetPartyRegistry(partyRegistry PartyRegistry) {
	s.partyRegistry = partyRegistry
}
