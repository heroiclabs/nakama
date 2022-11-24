package nakamacluster

import (
	"context"
	"strconv"
	"sync"

	"github.com/doublemo/nakama-cluster/api"
	"github.com/serialx/hashring"
	"github.com/shimingyah/pool"
	"go.uber.org/zap"
	"google.golang.org/grpc/metadata"
)

type Peer interface {
	Get(id string) (*NodeMeta, bool)
	GetByName(name string) []*NodeMeta
	All() []*NodeMeta
	AllToMap() map[string]*NodeMeta
	Size() int
	SizeByName(name string) int
	Send(ctx context.Context, node *NodeMeta, in *api.Envelope) (*api.Envelope, error)
	SendStream(ctx context.Context, clientId string, node *NodeMeta, in *api.Envelope, md metadata.MD) (created bool, ch chan *api.Envelope, err error)
	GetWithHashRing(name, k string) (*NodeMeta, bool)
	Add(nodes ...*NodeMeta)
	Update(id string, status MetaStatus)
	Delete(id string)
}

type PeerOptions struct {
	// Maximum number of idle connections in the pool.
	MaxIdle int

	// Maximum number of connections allocated by the pool at a given time.
	// When zero, there is no limit on the number of connections in the pool.
	MaxActive int

	// MaxConcurrentStreams limit on the number of concurrent streams to each single connection
	MaxConcurrentStreams int

	// If Reuse is true and the pool is at the MaxActive limit, then Get() reuse
	// the connection to return, If Reuse is false and the pool is at the MaxActive limit,
	// create a one-time connection to return.
	Reuse bool

	MessageQueueSize int
}

type streamContext struct {
	ctx    context.Context
	cancel context.CancelFunc
}

type LocalPeer struct {
	ctx                context.Context
	ctxCancelFn        context.CancelFunc
	nodes              map[string]*NodeMeta
	nodesByName        map[string]int
	rings              map[string]*hashring.HashRing
	grpcPool           sync.Map
	grpcStreams        sync.Map
	grpcStreamCancelFn sync.Map
	options            *PeerOptions
	logger             *zap.Logger
	sync.RWMutex
}

func (peer *LocalPeer) Get(id string) (*NodeMeta, bool) {
	peer.RLock()
	defer peer.RUnlock()
	node, ok := peer.nodes[id]
	if !ok {
		return nil, false
	}
	return node.Clone(), true
}

func (peer *LocalPeer) GetByName(name string) []*NodeMeta {
	nodes := make([]*NodeMeta, 0)
	size := peer.SizeByName(name)
	if size < 1 {
		return nodes
	}

	peer.RLock()
	for _, node := range peer.nodes {
		peer.RUnlock()
		nodes = append(nodes, node.Clone())
		peer.RLock()
	}
	peer.RUnlock()
	return nodes
}

func (peer *LocalPeer) All() []*NodeMeta {
	len := peer.Size()
	nodes := make([]*NodeMeta, len)

	i := 0
	peer.RLock()
	for _, v := range peer.nodes {
		peer.RUnlock()
		nodes[i] = v.Clone()
		i++
		peer.RLock()
	}
	peer.RUnlock()
	return nodes
}

func (peer *LocalPeer) AllToMap() map[string]*NodeMeta {
	nodes := make(map[string]*NodeMeta)
	peer.RLock()
	for k, v := range peer.nodes {
		peer.RUnlock()
		nodes[k] = v.Clone()
		peer.RLock()
	}
	peer.RUnlock()
	return nodes
}

func (peer *LocalPeer) Size() int {
	peer.RLock()
	defer peer.RUnlock()
	return len(peer.nodes)
}

func (peer *LocalPeer) SizeByName(name string) int {
	peer.RLock()
	defer peer.RUnlock()
	return peer.nodesByName[name]
}

func (peer *LocalPeer) Send(ctx context.Context, node *NodeMeta, in *api.Envelope) (*api.Envelope, error) {
	p, err := peer.makeGrpcPool(node.Id, node.Addr)
	if err != nil {
		return nil, err
	}

	conn, err := p.Get()
	if err != nil {
		return nil, err
	}

	defer conn.Close()
	client := api.NewApiServerClient(conn.Value())
	return client.Call(ctx, in)
}

func (peer *LocalPeer) SendStream(ctx context.Context, clientId string, node *NodeMeta, in *api.Envelope, md metadata.MD) (created bool, ch chan *api.Envelope, err error) {
	stream, ok := peer.grpcStreams.Load(clientId)
	if ok {
		err = stream.(api.ApiServer_StreamClient).Send(in)
		return
	}

	p, err := peer.makeGrpcPool(node.Id, node.Addr)
	if err != nil {
		return false, nil, err
	}

	conn, err := p.Get()
	if err != nil {
		return false, nil, err
	}

	defer conn.Close()

	client := api.NewApiServerClient(conn.Value())

	ctxStream, ok := peer.grpcStreamCancelFn.Load(node.Id)
	if ok {
		ctxS := ctxStream.(*streamContext)
		ctx = ctxS.ctx
	} else {
		ctxM, cancel := context.WithCancel(ctx)
		ctx = ctxM
		peer.grpcStreamCancelFn.Store(node.Id, &streamContext{ctx: ctxM, cancel: cancel})
	}

	ctx = metadata.NewOutgoingContext(ctx, md)
	s, err := client.Stream(ctx)
	if err != nil {
		return false, nil, err
	}

	ch = make(chan *api.Envelope, peer.options.MessageQueueSize)
	go func() {
		defer func() {
			close(ch)
			peer.grpcStreams.Delete(clientId)
		}()

		out, err := s.Recv()
		if err != nil {
			peer.logger.Warn("recv message error", zap.Error(err))
			return
		}

		select {
		case ch <- out:
		case <-ctx.Done():
			s.CloseSend()
			return
		default:
		}
	}()
	return true, ch, s.Send(in)
}

func (peer *LocalPeer) GetWithHashRing(name, k string) (*NodeMeta, bool) {
	peer.RLock()
	defer peer.RUnlock()
	ring, ok := peer.rings[name]
	if !ok {
		return nil, false
	}

	id, ok := ring.GetNode(k)
	if !ok {
		return nil, false
	}
	node, ok := peer.nodes[id]
	if !ok {
		return nil, false
	}

	return node, true
}

func (peer *LocalPeer) Add(nodes ...*NodeMeta) {
	peer.Lock()
	defer peer.Unlock()
	var weight int
	for _, node := range nodes {
		peer.nodes[node.Id] = node
		weight = 1

		if v, ok := node.Vars["weight"]; ok {
			weight, _ = strconv.Atoi(v)
			if weight < 1 {
				weight = 1
			}
		}

		if _, ok := peer.rings[node.Name]; !ok {
			peer.rings[node.Name] = hashring.NewWithWeights(map[string]int{node.Id: weight})
		} else {
			peer.rings[node.Name].AddWeightedNode(node.Id, weight)
		}
		peer.nodesByName[node.Name]++
	}
}

func (peer *LocalPeer) Delete(id string) {
	peer.Lock()
	if m, ok := peer.nodes[id]; ok {
		peer.nodesByName[m.Name]--
		if _, ok := peer.rings[m.Name]; ok {
			peer.rings[m.Name] = peer.rings[m.Name].RemoveNode(m.Id)
		}

		if peer.nodesByName[m.Name] < 1 {
			delete(peer.nodesByName, m.Name)
			delete(peer.rings, m.Name)
		}
		delete(peer.nodes, m.Id)
	}
	peer.Unlock()

	if m, ok := peer.grpcPool.Load(id); ok {
		m.(pool.Pool).Close()
		peer.grpcPool.Delete(id)
	}

	if m, ok := peer.grpcStreamCancelFn.Load(id); ok {
		m.(*streamContext).cancel()
		peer.grpcStreamCancelFn.Delete(id)
	}
}

func (peer *LocalPeer) Update(id string, status MetaStatus) {
	peer.Lock()
	defer peer.Unlock()
	node, ok := peer.nodes[id]
	if !ok {
		return
	}

	newNode := node.Clone()
	newNode.Status = status
	peer.nodes[id] = newNode
}

func (peer *LocalPeer) makeGrpcPool(id, addr string) (pool.Pool, error) {
	p, ok := peer.grpcPool.Load(id)
	if ok {
		return p.(pool.Pool), nil
	}

	pool, err := pool.New(addr, pool.Options{
		Dial:                 pool.Dial,
		MaxIdle:              peer.options.MaxIdle,
		MaxActive:            peer.options.MaxActive,
		MaxConcurrentStreams: peer.options.MaxConcurrentStreams,
		Reuse:                peer.options.Reuse,
	})

	if err != nil {
		return nil, err
	}

	peer.grpcPool.Store(id, pool)
	return pool, nil
}

func NewPeer(ctx context.Context, logger *zap.Logger, options PeerOptions) *LocalPeer {
	ctx, cancel := context.WithCancel(ctx)
	s := &LocalPeer{
		ctx:         ctx,
		ctxCancelFn: cancel,
		nodes:       make(map[string]*NodeMeta),
		nodesByName: make(map[string]int),
		rings:       make(map[string]*hashring.HashRing),
		logger:      logger,
		options:     &options,
	}
	return s
}
