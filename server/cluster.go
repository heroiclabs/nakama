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
	ctx      context.Context
	cancelFn context.CancelFunc
	cns      *nakamacluster.NakamaServer
	config   Config
	logger   *zap.Logger
	once     sync.Once
}

func NewClusterServer(ctx context.Context, logger *zap.Logger, config Config) *ClusterServer {
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

	cns := nakamacluster.NewWithNakamaServer(ctx, logger, sdClient, config.GetName(), vars, clusterConfig.Config)
	cns.Delegate(s)
	s.cns = cns
	return s
}

func (s *ClusterServer) NotifyAlive(node *nakamacluster.NodeMeta) error {
	return nil
}

func (s *ClusterServer) LocalState(join bool) []byte {
	return nil
}

func (s *ClusterServer) MergeRemoteState(buf []byte, join bool) {}

func (s *ClusterServer) NotifyJoin(node *nakamacluster.NodeMeta) {}

func (s *ClusterServer) NotifyLeave(node *nakamacluster.NodeMeta) {}

func (s *ClusterServer) NotifyUpdate(node *nakamacluster.NodeMeta) {}

func (s *ClusterServer) NotifyMsg(msg *ncapi.Envelope) {}

// Send 向集群远端发送信息
// 如果没有指定远端节点,信息将采用UDP进行广播
// 否则, 使用TCP进行可靠发送
func (s *ClusterServer) Send(msg *ncapi.Envelope, to ...string) bool {
	return s.cns.Send(msg, to...)
}

func (s *ClusterServer) NodeId() string {
	return s.cns.Node().Name
}

func (s *ClusterServer) Stop() {
	s.once.Do(func() {
		if s.cancelFn != nil {
			s.cancelFn()
		}
	})
}
