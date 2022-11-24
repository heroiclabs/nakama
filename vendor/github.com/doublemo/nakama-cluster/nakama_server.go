package nakamacluster

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/doublemo/nakama-cluster/api"
	"github.com/doublemo/nakama-cluster/sd"
	"github.com/hashicorp/memberlist"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// NakamaServer Nakama服务
type NakamaServer struct {
	ctx          context.Context
	cancelFn     context.CancelFunc
	sdClient     sd.Client
	meta         *NodeMeta
	memberlist   *memberlist.Memberlist
	peers        Peer
	logger       *zap.Logger
	config       *Config
	incomingCh   chan *api.Envelope
	metrics      *Metrics
	messageQueue *memberlist.TransmitLimitedQueue
	messageCur   *MessageCursor
	delegate     atomic.Value
	once         sync.Once
	sync.Mutex
}

func (s *NakamaServer) Delegate(delegate Delegate) {
	s.delegate.Store(delegate)
}

func (s *NakamaServer) Metrics(metrics *Metrics) {
	s.Lock()
	s.metrics = metrics
	s.Unlock()
}

// Node 获取本地节点
func (s *NakamaServer) Node() *memberlist.Node {
	return s.memberlist.LocalNode()
}

// Nodes 获取所有节点
func (s *NakamaServer) Nodes() []*memberlist.Node {
	return s.memberlist.Members()
}

// Peers 获取所有子节点
func (s *NakamaServer) Peers() Peer {
	return s.peers
}

// UpdateMeta 更新节点meta信息
func (s *NakamaServer) UpdateMeta(status MetaStatus, vars map[string]string) {
	s.Lock()
	meta := s.meta.Clone()
	meta.Status = status
	meta.Vars = vars
	s.meta = meta
	s.Unlock()

	err := s.memberlist.UpdateNode(time.Second * 10)
	if err != nil {
		s.logger.Warn("Failed update node", zap.Error(err))
	}
}

func (s *NakamaServer) Send(msg *api.Envelope, to ...string) bool {
	if len(to) > 0 {
		msg.Node = strings.Join(to, ",")
	}

	select {
	case s.incomingCh <- msg:
	default:
		return false
	}

	return true
}

func (s *NakamaServer) Stop() {
	s.once.Do(func() {
		if s.cancelFn != nil {
			s.cancelFn()
			s.memberlist.Leave(time.Second * 30)
			s.memberlist.Shutdown()
		}
	})
}

func (s *NakamaServer) serve() {
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
		s.logger.Info("Nakama cluster stoped")
	}()

	watchCh := make(chan struct{}, 1)
	go s.sdClient.WatchPrefix(s.config.Prefix, watchCh)
	var seqid uint64
	for {
		select {
		case <-s.ctx.Done():
			return

		case <-watchCh:
			s.collectMicroNodes()

		case data, ok := <-s.incomingCh:
			if !ok {
				return
			}

			seqid++
			s.send(seqid, data)
		}
	}

}

func (s *NakamaServer) send(id uint64, data *api.Envelope) {
	var nodes []*memberlist.Node
	if data.Node != "" {
		nodeids := strings.Split(data.Node, ",")
		nodesMap := make(map[string]bool)
		for _, v := range nodeids {
			nodesMap[v] = true
		}

		for _, node := range s.Nodes() {
			if nodesMap[node.Name] {
				nodes = append(nodes, node)
			}
		}
	}

	msg := NewBroadcast(&api.Envelope{Id: id, Node: s.Node().Name, Payload: data.Payload})
	msgBytes := msg.Message()
	msgSize := int64(len(msgBytes))
	if len(nodes) < 1 {
		s.messageQueue.QueueBroadcast(msg)
		if s.metrics != nil {
			s.metrics.SentBroadcast(msgSize)
		}
		return
	}

	for _, node := range nodes {
		if err := s.memberlist.SendReliable(node, msgBytes); err != nil {
			s.logger.Warn("Failed send message to node", zap.Error(err))
		}

		if s.metrics != nil {
			s.metrics.SentBroadcast(msgSize)
		}
	}
}

func (s *NakamaServer) collectMicroNodes() {
	nodes, _, err := s.metaNodesFromSD(map[NodeType]bool{NODE_TYPE_MICROSERVICES: true})
	if err != nil {
		s.logger.Fatal("Failed reading meta nodes from sd", zap.Error(err))
	}

	for _, node := range nodes {
		s.peers.Add(node)
	}
}

// metaNodesFromSD 从服务发现中获取在线节点
func (s *NakamaServer) metaNodesFromSD(nodeType map[NodeType]bool) ([]*NodeMeta, []string, error) {
	values, err := s.sdClient.GetEntries(s.config.Prefix)
	if err != nil {
		s.logger.Warn("Failed reading meta nodes from sd", zap.Error(err))
		return nil, nil, err
	}

	nodes := make([]*NodeMeta, 0, len(values))
	nodeAddrs := make([]string, 0, len(values))
	for _, v := range values {
		node := NewNodeMetaFromJSON([]byte(v))
		if node == nil {
			s.logger.Warn("Failed parse meta nodes from sd", zap.String("value", v))
			continue
		}

		if nodeType != nil && !nodeType[node.Type] {
			continue
		}

		nodes = append(nodes, node)
		nodeAddrs = append(nodeAddrs, node.Addr)
	}
	return nodes, nodeAddrs, nil
}

// NewWithNakamaServer 创建Nakama服务
func NewWithNakamaServer(ctx context.Context, logger *zap.Logger, client sd.Client, id string, vars map[string]string, c Config) *NakamaServer {
	var err error
	ctx, cancel := context.WithCancel(ctx)
	meta := NewNodeMetaFromConfig(id, "nakama", NODE_TYPE_NAKAMA, vars, c)
	addr := "0.0.0.0"
	if c.Addr != "" {
		addr = c.Addr
	}

	s := &NakamaServer{
		ctx:      ctx,
		cancelFn: cancel,
		sdClient: client,
		meta:     meta,
		peers: NewPeer(ctx, logger, PeerOptions{
			MaxIdle:              c.GrpcPoolMaxIdle,
			MaxActive:            c.GrpcPoolMaxActive,
			MaxConcurrentStreams: c.GrpcPoolMaxConcurrentStreams,
			Reuse:                c.GrpcPoolReuse,
			MessageQueueSize:     c.MaxGossipPacketSize,
		}),
		logger:     logger,
		config:     &c,
		incomingCh: make(chan *api.Envelope, c.BroadcastQueueSize),
		messageCur: NewMessageCursor(10),
	}

	memberlistConfig := memberlist.DefaultLocalConfig()
	memberlistConfig.BindAddr = addr
	memberlistConfig.BindPort = c.Port
	memberlistConfig.PushPullInterval = time.Duration(c.PushPullInterval) * time.Second
	memberlistConfig.GossipInterval = time.Duration(c.GossipInterval) * time.Millisecond
	memberlistConfig.ProbeInterval = time.Duration(c.ProbeInterval) * time.Second
	memberlistConfig.ProbeTimeout = time.Duration(c.ProbeTimeout) * time.Millisecond
	memberlistConfig.UDPBufferSize = c.MaxGossipPacketSize
	memberlistConfig.TCPTimeout = time.Duration(c.TCPTimeout) * time.Second
	memberlistConfig.RetransmitMult = c.RetransmitMult
	memberlistConfig.Name = id
	memberlistConfig.Ping = s
	memberlistConfig.Delegate = s
	memberlistConfig.Events = s
	memberlistConfig.Alive = s
	memberlistConfig.Logger = log.New(os.Stdout, "nakama-cluster", 0)

	if !logger.Core().Enabled(zapcore.DebugLevel) {
		memberlistConfig.Logger.SetOutput(io.Discard)
	}

	s.messageQueue = &memberlist.TransmitLimitedQueue{
		NumNodes: func() int {
			return s.memberlist.NumMembers()
		},

		RetransmitMult: c.RetransmitMult,
	}
	s.memberlist, err = memberlist.Create(memberlistConfig)
	if err != nil {
		logger.Fatal("Failed to create memberlist", zap.Error(err))
	}

	_, nodes, err := s.metaNodesFromSD(map[NodeType]bool{NODE_TYPE_NAKAMA: true})
	if err != nil {
		logger.Fatal(err.Error())
	}

	if _, err := s.memberlist.Join(nodes); err != nil {
		logger.Warn("Failed to join cluster", zap.Error(err))
	}

	go s.serve()
	return s
}
