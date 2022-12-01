package nakamacluster

import (
	"context"
	"crypto/tls"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/doublemo/nakama-cluster/api"
	"github.com/doublemo/nakama-cluster/sd"
	grpc_prometheus "github.com/grpc-ecosystem/go-grpc-prometheus"
	"github.com/shimingyah/pool"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/channelz/service"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

var (
	ErrMissingMetadata = status.Errorf(codes.InvalidArgument, "missing metadata")
	ErrInvalidToken    = status.Errorf(codes.Unauthenticated, "invalid token")
)

type ServerDelegate interface {
	// Call rpc call
	Call(ctx context.Context, in *api.Envelope) (*api.Envelope, error)

	// Stream rpc stream
	Stream(ctx context.Context, client func(out *api.Envelope) bool, in *api.Envelope) error

	// OnStreamClose rpc stream close
	OnStreamClose(ctx context.Context)
}

type Server struct {
	api.UnimplementedApiServerServer
	ctx        context.Context
	cancelFn   context.CancelFunc
	config     *Config
	peers      Peer
	delegate   atomic.Value
	meta       atomic.Value
	wathcer    *Watcher
	grpcServer *grpc.Server
	logger     *zap.Logger
	once       sync.Once
}

func (s *Server) Stop() {
	s.once.Do(func() {
		if s.cancelFn != nil {
			s.cancelFn()
		}
	})
}

func (s *Server) OnDelegate(delegate ServerDelegate) {
	s.delegate.Store(delegate)
}

func (s *Server) GetPeers() Peer {
	return s.peers
}

func (s *Server) Call(ctx context.Context, in *api.Envelope) (*api.Envelope, error) {
	fn, ok := s.delegate.Load().(ServerDelegate)
	if !ok || fn == nil {
		return nil, status.Errorf(codes.InvalidArgument, "Method Call not implemented")
	}

	return fn.Call(ctx, in)
}

func (s *Server) Stream(in api.ApiServer_StreamServer) error {
	fn, ok := s.delegate.Load().(ServerDelegate)
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

			if err := fn.Stream(in.Context(), client, msg); err != nil {
				s.logger.Warn("Failed handle message", zap.Error(err))
				return status.Errorf(codes.InvalidArgument, err.Error())
			}

		case msg := <-outgoingCh:
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

func (s *Server) GetMeta() *Meta {
	meta, ok := s.meta.Load().(*Meta)
	if !ok || meta == nil {
		return nil
	}

	return meta.Clone()
}

func (s *Server) UpdateMeta(status MetaStatus, vars map[string]string) error {
	meta := s.GetMeta()
	meta.Status = status
	meta.Vars = vars
	s.meta.Store(meta)

	return s.wathcer.Update(meta)
}

func (s *Server) onUpdate(metas []*Meta) {
	for _, meta := range metas {
		if meta.Type == NODE_TYPE_MICROSERVICES && meta.Name == NAKAMA {
			s.logger.Warn("Invalid node name", zap.String("ID", meta.Id))
			continue
		}
		s.peers.Add(meta)
	}
}

func NewServer(ctx context.Context, logger *zap.Logger, sdclient sd.Client, id, name string, vars map[string]string, config Config) *Server {
	ctx, cancel := context.WithCancel(ctx)
	meta := NewNodeMetaFromConfig(id, name, NODE_TYPE_MICROSERVICES, vars, config)

	s := &Server{
		ctx:      ctx,
		cancelFn: cancel,
		peers: NewPeer(ctx, logger, PeerOptions{
			MaxIdle:              config.GrpcPoolMaxIdle,
			MaxActive:            config.GrpcPoolMaxActive,
			MaxConcurrentStreams: config.GrpcPoolMaxConcurrentStreams,
			Reuse:                config.GrpcPoolReuse,
			MessageQueueSize:     config.MaxGossipPacketSize,
		}),
		logger: logger,
		config: &config,
	}
	s.meta.Store(meta)
	s.wathcer = NewWatcher(ctx, logger, sdclient, config.Prefix, meta)
	metas, err := s.wathcer.GetEntries()
	if err != nil {
		logger.Fatal(err.Error())
	}
	s.onUpdate(metas)
	s.wathcer.OnUpdate(s.onUpdate)
	s.grpcServer = newGrpcServer(logger, s, config)
	return s
}

func newGrpcServer(logger *zap.Logger, srv api.ApiServerServer, c Config) *grpc.Server {
	opts := []grpc.ServerOption{
		grpc.InitialWindowSize(pool.InitialWindowSize),
		grpc.InitialConnWindowSize(pool.InitialConnWindowSize),
		grpc.MaxSendMsgSize(pool.MaxSendMsgSize),
		grpc.MaxRecvMsgSize(pool.MaxRecvMsgSize),
		grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			PermitWithoutStream: true,
		}),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			Time:    pool.KeepAliveTime,
			Timeout: pool.KeepAliveTimeout,
		}),
	}

	if len(c.GrpcX509Key) > 0 && len(c.GrpcX509Pem) > 0 {
		cert, err := tls.LoadX509KeyPair(c.GrpcX509Pem, c.GrpcX509Key)
		if err != nil {
			logger.Fatal("Failed load x509", zap.Error(err))
		}

		opts = append(opts,
			grpc.ChainStreamInterceptor(ensureStreamValidToken(c), grpc_prometheus.StreamServerInterceptor),
			grpc.ChainUnaryInterceptor(ensureValidToken(c), grpc_prometheus.UnaryServerInterceptor),
			grpc.Creds(credentials.NewServerTLSFromCert(&cert)),
		)
	}

	listen, err := net.Listen("tcp", net.JoinHostPort(c.Addr, strconv.Itoa(c.Port)))
	if err != nil {
		logger.Fatal("Failed listen from addr", zap.Error(err), zap.String("addr", c.Addr), zap.Int("port", c.Port))
	}

	s := grpc.NewServer(opts...)
	api.RegisterApiServerServer(s, srv)
	service.RegisterChannelzServiceToServer(s)
	grpc_prometheus.Register(s)
	healthpb.RegisterHealthServer(s, health.NewServer())
	go func() {
		logger.Info("Starting API server for gRPC requests", zap.Int("port", c.Port))
		if err := s.Serve(listen); err != nil {
			logger.Fatal("API server listener failed", zap.Error(err))
		}
	}()
	return s
}

func ensureValidToken(config Config) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp interface{}, err error) {
		md, ok := metadata.FromIncomingContext(ctx)
		if !ok {
			return nil, ErrMissingMetadata
		}
		// The keys within metadata.MD are normalized to lowercase.
		// See: https://godoc.org/google.golang.org/grpc/metadata#New
		authorization := md["authorization"]
		if len(authorization) < 1 {
			return nil, ErrInvalidToken
		}

		token := strings.TrimPrefix(authorization[0], "Bearer ")
		if token != config.GrpcToken {
			return nil, ErrInvalidToken
		}

		// Continue execution of handler after ensuring a valid token.
		return handler(ctx, req)
	}
}

//func(srv interface{}, ss ServerStream, info *StreamServerInfo, handler StreamHandler)
func ensureStreamValidToken(config Config) grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		md, ok := metadata.FromIncomingContext(ss.Context())
		if !ok {
			return ErrMissingMetadata
		}

		authorization := md["authorization"]
		if len(authorization) < 1 {
			return ErrInvalidToken
		}

		token := strings.TrimPrefix(authorization[0], "Bearer ")
		if token != config.GrpcToken {
			return ErrInvalidToken
		}

		// Continue execution of handler after ensuring a valid token.
		return handler(srv, ss)
	}
}
