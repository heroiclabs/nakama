package nakamacluster

import (
	"context"
	"crypto/tls"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/doublemo/nakama-cluster/sd"
	"github.com/gofrs/uuid"
	"go.etcd.io/etcd/api/v3/mvccpb"
	"go.etcd.io/etcd/client/pkg/v3/transport"
	etcdv3 "go.etcd.io/etcd/client/v3"
	"go.uber.org/zap"
)

type sessionCacheUser struct {
	sessionTokens map[string]int64
	refreshTokens map[string]int64
}

type SessionCache struct {
	node       string
	ctx        context.Context
	cancelFn   context.CancelFunc
	etcdClient *etcdv3.Client
	kv         etcdv3.KV
	watcher    etcdv3.Watcher
	lease      etcdv3.Lease
	key        string
	logger     *zap.Logger
	once       sync.Once

	cache map[uuid.UUID]*sessionCacheUser
	sync.RWMutex
}

func (s *SessionCache) Stop() {
	s.once.Do(func() {
		if s.cancelFn != nil {
			s.cancelFn()
		}
	})
}

func (s *SessionCache) IsValidSession(userID uuid.UUID, exp int64, token string) bool {
	s.RLock()
	cache, found := s.cache[userID]
	if !found {
		s.RUnlock()
		return false
	}
	_, found = cache.sessionTokens[token]
	s.RUnlock()
	return found
}

func (s *SessionCache) IsValidRefresh(userID uuid.UUID, exp int64, token string) bool {
	s.RLock()
	cache, found := s.cache[userID]
	if !found {
		s.RUnlock()
		return false
	}
	_, found = cache.refreshTokens[token]
	s.RUnlock()
	return found
}

func (s *SessionCache) Add(userID uuid.UUID, sessionExp int64, sessionToken string, refreshExp int64, refreshToken string) {
	if sessionToken != "" {
		grantResp, err := s.lease.Grant(s.ctx, sessionExp-time.Now().UTC().Unix()+1)
		if err != nil {
			s.logger.Warn("Failed to Grant", zap.Error(err))
			return
		}

		_, err = s.kv.Put(s.ctx, s.sessionKey(userID.String(), sessionToken), fmt.Sprint(sessionExp), etcdv3.WithLease(grantResp.ID))
		if err != nil {
			s.logger.Warn("Failed put key", zap.Error(err))
			return
		}
	}

	if refreshToken != "" {
		grantResp, err := s.lease.Grant(s.ctx, refreshExp-time.Now().UTC().Unix()+1)
		if err != nil {
			s.logger.Warn("Failed to Grant", zap.Error(err))
			return
		}

		_, err = s.kv.Put(s.ctx, s.refreshKey(userID.String(), refreshToken), fmt.Sprint(refreshExp), etcdv3.WithLease(grantResp.ID))
		if err != nil {
			s.logger.Warn("Failed put key", zap.Error(err))
			return
		}
	}
}

func (s *SessionCache) Remove(userID uuid.UUID, sessionExp int64, sessionToken string, refreshExp int64, refreshToken string) {
	if sessionToken != "" {
		_, err := s.kv.Delete(s.ctx, s.sessionKey(userID.String(), sessionToken), etcdv3.WithIgnoreLease())
		if err != nil {
			s.logger.Warn("Failed put key", zap.Error(err))
			return
		}
	}

	if refreshToken != "" {
		_, err := s.kv.Delete(s.ctx, s.refreshKey(userID.String(), refreshToken), etcdv3.WithIgnoreLease())
		if err != nil {
			s.logger.Warn("Failed put key", zap.Error(err))
			return
		}
	}
}

func (s *SessionCache) RemoveAll(userID uuid.UUID) {
	s.kv.Delete(s.ctx, s.key+s.node, etcdv3.WithPrefix())
	s.Lock()
	delete(s.cache, userID)
	s.Unlock()
}

func (s *SessionCache) Ban(userIDs []uuid.UUID) {
	txn := s.kv.Txn(s.ctx)
	for _, userID := range userIDs {
		txn.Then(etcdv3.OpDelete(s.userIdKey(userID.String()), etcdv3.WithPrefix()))

		s.Lock()
		delete(s.cache, userID)
		s.Unlock()
	}
	txn.Commit()
}

func (s *SessionCache) Unban(userIDs []uuid.UUID) {}

func (s *SessionCache) add(userID uuid.UUID, sessionExp int64, sessionToken string, refreshExp int64, refreshToken string) {
	s.Lock()
	cache, found := s.cache[userID]
	if !found {
		cache = &sessionCacheUser{
			sessionTokens: make(map[string]int64),
			refreshTokens: make(map[string]int64),
		}
		s.cache[userID] = cache
	}
	if sessionToken != "" {
		cache.sessionTokens[sessionToken] = sessionExp + 1
	}
	if refreshToken != "" {
		cache.refreshTokens[refreshToken] = refreshExp + 1
	}
	s.Unlock()
}

func (s *SessionCache) remove(userID uuid.UUID, sessionExp int64, sessionToken string, refreshExp int64, refreshToken string) {
	s.Lock()
	cache, found := s.cache[userID]
	if !found {
		s.Unlock()
		return
	}
	if sessionToken != "" {
		delete(cache.sessionTokens, sessionToken)
	}
	if refreshToken != "" {
		delete(cache.refreshTokens, refreshToken)
	}
	if len(cache.sessionTokens) == 0 && len(cache.refreshTokens) == 0 {
		delete(s.cache, userID)
	}
	s.Unlock()
}

func (s *SessionCache) watch() {
	wch := s.watcher.Watch(s.ctx, s.key, etcdv3.WithPrefix(), etcdv3.WithRev(0))
	for {
		select {
		case frame, ok := <-wch:
			if !ok {
				return
			}

			for _, event := range frame.Events {
				s.handleKV(event.Type, string(event.Kv.Key), string(event.Kv.Value))
			}

		case <-s.ctx.Done():
			return
		}
	}
}

func (s *SessionCache) handleKV(typ mvccpb.Event_EventType, key, value string) {
	sessionData := strings.SplitN(strings.TrimLeft(key, s.key), "/", 4)
	if len(sessionData) != 4 {
		return
	}

	tokenType := sessionData[2]
	switch typ {
	case mvccpb.PUT:
		exp, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			s.logger.Warn("Failed to parse string", zap.Error(err))
			return
		}

		if tokenType == "refresh_token" {
			s.add(uuid.FromStringOrNil(sessionData[1]), 0, "", exp, sessionData[3])
		} else {
			s.add(uuid.FromStringOrNil(sessionData[1]), exp, sessionData[3], 0, "")
		}

	case mvccpb.DELETE:
		if tokenType == "refresh_token" {
			s.remove(uuid.FromStringOrNil(sessionData[1]), 0, "", 0, sessionData[3])
		} else {
			s.remove(uuid.FromStringOrNil(sessionData[1]), 0, sessionData[3], 0, "")
		}
	}
}

func (s *SessionCache) sessionKey(id, token string) string {
	key := s.key
	if !strings.HasSuffix(key, "/") {
		key += "/"
	}

	return key + strings.Join([]string{s.node, id, "session_token", token}, "/")
}

func (s *SessionCache) refreshKey(id, token string) string {
	key := s.key
	if !strings.HasSuffix(key, "/") {
		key += "/"
	}

	return key + strings.Join([]string{s.node, id, "refresh_token", token}, "/")
}

func (s *SessionCache) userIdKey(id string) string {
	key := s.key
	if !strings.HasSuffix(key, "/") {
		key += "/"
	}

	return key + strings.Join([]string{s.node, id}, "/")
}

func (s *SessionCache) syncRemote() error {
	data, err := s.kv.Get(s.ctx, s.key, etcdv3.WithPrefix())
	if err != nil {
		s.logger.Warn("Failed to read session", zap.Error(err))
		return err
	}

	for _, v := range data.Kvs {
		s.handleKV(mvccpb.PUT, string(v.Key), string(v.Value))
	}
	return nil
}

func NewSessionCache(ctx context.Context, logger *zap.Logger, key, node string, machines []string, options sd.EtcdClientOptions) *SessionCache {
	ctx, cancel := context.WithCancel(ctx)
	if !strings.HasSuffix(key, "/") {
		key += "/"
	}

	if options.DialTimeout == 0 {
		options.DialTimeout = 3 * time.Second
	}
	if options.DialKeepAlive == 0 {
		options.DialKeepAlive = 3 * time.Second
	}

	var err error
	var tlscfg *tls.Config

	if options.Cert != "" && options.Key != "" {
		tlsInfo := transport.TLSInfo{
			CertFile:      options.Cert,
			KeyFile:       options.Key,
			TrustedCAFile: options.CACert,
		}
		tlscfg, err = tlsInfo.ClientConfig()
		if err != nil {
			logger.Fatal("Failed to init TLS", zap.Error(err))
		}
	}

	cli, err := etcdv3.New(etcdv3.Config{
		Context:           ctx,
		Endpoints:         machines,
		DialTimeout:       options.DialTimeout,
		DialKeepAliveTime: options.DialKeepAlive,
		DialOptions:       options.DialOptions,
		TLS:               tlscfg,
		Username:          options.Username,
		Password:          options.Password,
	})

	if err != nil {
		logger.Fatal("Failed to create etcd client", zap.Error(err))
	}

	s := &SessionCache{
		node:       node,
		etcdClient: cli,
		ctx:        ctx,
		cancelFn:   cancel,
		kv:         etcdv3.NewKV(cli),
		watcher:    etcdv3.NewWatcher(cli),
		lease:      etcdv3.NewLease(cli),
		logger:     logger,
		key:        key,
		cache:      make(map[uuid.UUID]*sessionCacheUser),
	}

	go s.watch()
	s.syncRemote()
	return s
}
