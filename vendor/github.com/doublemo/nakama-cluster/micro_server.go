package nakamacluster

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/doublemo/nakama-cluster/api"
	"github.com/doublemo/nakama-cluster/sd"
	"github.com/gogo/protobuf/proto"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type MircoDelegate interface {
	Call(ctx context.Context, in *api.Envelope) (*api.Envelope, error)
	Stream(ctx context.Context, client func(out *api.Envelope) bool, in *api.Envelope) error
	OnStreamClose(ctx context.Context)
}

// MicroServer 微信服务处理
type MicroServer struct {
	api.UnimplementedApiServerServer
	ctx        context.Context
	cancelFn   context.CancelFunc
	delegate   atomic.Value
	peers      Peer
	meta       *NodeMeta
	metrics    *Metrics
	config     *Config
	sdClient   sd.Client
	grpcServer *grpc.Server
	logger     *zap.Logger
	sync.Mutex
	once sync.Once
}

func (s *MicroServer) Metrics(metrics *Metrics) {
	s.Lock()
	s.metrics = metrics
	s.Unlock()
}

// Node 获取本地节点
func (s *MicroServer) Node() *NodeMeta {
	s.Lock()
	meta := s.meta.Clone()
	s.Unlock()
	return meta
}

// Peers 获取所有节点
func (s *MicroServer) Peers() Peer {
	return s.peers
}

func (s *MicroServer) Delegate(delegate MircoDelegate) {
	s.delegate.Store(delegate)
}

// Call
func (s *MicroServer) Call(ctx context.Context, in *api.Envelope) (*api.Envelope, error) {
	fn, ok := s.delegate.Load().(MircoDelegate)
	if !ok || fn == nil {
		return nil, status.Errorf(codes.InvalidArgument, "Method Call not implemented")
	}

	if s.metrics != nil {
		bytes, _ := proto.Marshal(in)
		s.metrics.RecvBroadcast(int64(len(bytes)))
	}

	return fn.Call(ctx, in)
}

// Stream
func (s *MicroServer) Stream(in api.ApiServer_StreamServer) error {
	fn, ok := s.delegate.Load().(MircoDelegate)
	if !ok || fn == nil {
		return status.Errorf(codes.InvalidArgument, "Method Stream not implemented")
	}

	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	incomingCh := make(chan *api.Envelope, s.config.BroadcastQueueSize)
	outgoingCh := make(chan *api.Envelope, s.config.BroadcastQueueSize)

	client := func(out *api.Envelope) bool {
		select {
		case outgoingCh <- out:
		default:
			return false
		}
		return true
	}

	go func() {
		defer func() {
			close(incomingCh)
		}()

		for {
			payload, err := in.Recv()
			if err != nil {
				s.logger.Debug("Error reading message from client", zap.Error(err))
				break
			}

			select {
			case incomingCh <- payload:
			case <-ctx.Done():
				return
			}
		}
	}()

IncomingLoop:
	for {
		select {
		case msg, ok := <-incomingCh:
			if !ok {
				return status.Errorf(codes.Aborted, "Failed read data from incomingCh")
			}

			if s.metrics != nil {
				bytes, _ := proto.Marshal(msg)
				s.metrics.RecvBroadcast(int64(len(bytes)))
			}

			if err := fn.Stream(in.Context(), client, msg); err != nil {
				s.logger.Warn("Failed handle message", zap.Error(err))
				return status.Errorf(codes.InvalidArgument, err.Error())
			}

		case msg := <-outgoingCh:

			if s.metrics != nil {
				bytes, _ := proto.Marshal(msg)
				s.metrics.SentBroadcast(int64(len(bytes)))
			}

			if err := in.Send(msg); err != nil {
				s.logger.Warn("Failed write to stream", zap.Error(err))
			}

		case <-ctx.Done():
			break IncomingLoop
		}
	}

	fn.OnStreamClose(in.Context())
	return nil
}

// UpdateMeta 更新节点meta信息
func (s *MicroServer) UpdateMeta(status MetaStatus, vars map[string]string) error {
	s.Lock()
	meta := s.meta.Clone()
	meta.Status = status
	meta.Vars = vars
	s.meta = meta
	s.Unlock()

	metaValue, err := meta.Marshal()
	if err != nil {
		s.logger.Error("Failed marshal meta", zap.Error(err))
		return err
	}

	sdService := sd.Service{
		Key:   fmt.Sprintf("%s/%s", s.config.Prefix, meta.Id),
		Value: string(metaValue),
	}

	if err := s.sdClient.Update(sdService); err != nil {
		s.logger.Error("Failed update meta", zap.Error(err))
		return err
	}

	return nil
}

func (s *MicroServer) Stop() {
	s.once.Do(func() {
		if s.cancelFn != nil {
			s.cancelFn()
			s.grpcServer.Stop()
		}
	})
}

func (s *MicroServer) serve() {
	s.Lock()
	meta := s.meta.Clone()
	s.Unlock()

	metaValue, err := meta.Marshal()
	if err != nil {
		s.logger.Fatal("Failed marshal meta", zap.Error(err))
	}

	sdService := sd.Service{
		Key:   fmt.Sprintf("%s/%s", s.config.Prefix, meta.Id),
		Value: string(metaValue),
		TTL:   sd.NewTTLOption(3*time.Second, 10*time.Second),
	}

	s.sdClient.Register(sdService)
	defer func() {
		s.sdClient.Deregister(sdService)
		s.logger.Info("Micro cluster stoped")
	}()

	watchCh := make(chan struct{}, 1)
	go s.sdClient.WatchPrefix(s.config.Prefix, watchCh)
	for {
		select {
		case <-s.ctx.Done():
			return

		case <-watchCh:
			s.collectMicroNodes()
		}
	}
}

func (s *MicroServer) collectMicroNodes() {
	nodes, _, err := s.metaNodesFromSD()
	if err != nil {
		s.logger.Fatal("Failed reading meta nodes from sd", zap.Error(err))
	}

	for _, node := range nodes {
		s.peers.Add(node)
	}
}

// metaNodesFromSD 从服务发现中获取在线节点
func (s *MicroServer) metaNodesFromSD() ([]*NodeMeta, []string, error) {
	values, err := s.sdClient.GetEntries(s.config.Prefix)
	if err != nil {
		s.logger.Warn("Failed reading meta nodes from sd", zap.Error(err))
		return nil, nil, err
	}

	nodes := make([]*NodeMeta, len(values))
	nodeAddrs := make([]string, len(values))
	for k, v := range values {
		node := NewNodeMetaFromJSON([]byte(v))
		if node == nil {
			s.logger.Warn("Failed parse meta nodes from sd", zap.String("value", v))
			return nil, nil, fmt.Errorf("Failed parse meta nodes from sd: %s", v)
		}

		nodes[k] = node
		nodeAddrs[k] = node.Addr
	}
	return nodes, nodeAddrs, nil
}

// NewWithMicroServer
func NewWithMicroServer(ctx context.Context, logger *zap.Logger, client sd.Client, id, name string, vars map[string]string, c Config) *MicroServer {
	ctx, cancel := context.WithCancel(ctx)
	meta := NewNodeMetaFromConfig(id, name, NODE_TYPE_MICROSERVICES, vars, c)

	s := &MicroServer{
		ctx:      ctx,
		cancelFn: cancel,
		meta:     meta,
		peers: NewPeer(ctx, logger, PeerOptions{
			MaxIdle:              c.GrpcPoolMaxIdle,
			MaxActive:            c.GrpcPoolMaxActive,
			MaxConcurrentStreams: c.GrpcPoolMaxConcurrentStreams,
			Reuse:                c.GrpcPoolReuse,
			MessageQueueSize:     c.MaxGossipPacketSize,
		}),
		logger:   logger,
		config:   &c,
		sdClient: client,
	}

	s.collectMicroNodes()
	s.grpcServer = newGrpcServer(logger, s, c)
	go s.serve()
	return s
}
