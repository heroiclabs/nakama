// Copyright 2021 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gofrs/uuid"
)

type SessionCacheRedis struct {
	sync.RWMutex
	config Config

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	isCluster          bool
	redisClient        redis.Client
	redisClusterClient redis.ClusterClient
	cache              map[uuid.UUID]*sessionCacheUser
}

func NewSessionCacheRedis(config Config) SessionCache {
	ctx, ctxCancelFn := context.WithCancel(context.Background())
	s := &SessionCacheRedis{
		config: config,

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,
	}
	s.isCluster = config.GetSharedCache().RedisCluster
	if !s.isCluster {
		var redisPassword string
		redisUrl, _ := url.Parse(config.GetSharedCache().RedisUri)
		redisPassword, _ = redisUrl.User.Password()
		database, err := strconv.Atoi(strings.Replace(redisUrl.Path, "/", "", 1))
		if err != nil {
			panic(err)
		}
		redisOpts := redis.Options{
			Addr:     redisUrl.Host,
			Password: redisPassword,
			DB:       database,
		}
		if redisUrl.Scheme == "rediss" {
			redisOpts.TLSConfig = &tls.Config{
				MinVersion: tls.VersionTLS12,
				//Certificates: []tls.Certificate{cert}
			}
		}
		s.redisClient = *redis.NewClient(&redisOpts)
	} else {
		clusterOpts := redis.ClusterOptions{
			Addrs:    config.GetSharedCache().RedisClusterAddrs,
			Password: config.GetSharedCache().RedisClusterPassword,
		}
		if config.GetSharedCache().RedisClusterTLSEnabled {
			clusterOpts.TLSConfig = &tls.Config{
				MinVersion: tls.VersionTLS12,
			}
		}
		s.redisClusterClient = *redis.NewClusterClient(&clusterOpts)
	}

	go func() {
	}()

	return s
}

func (s *SessionCacheRedis) Stop() {
	s.ctxCancelFn()
}
func (s *SessionCacheRedis) IsValidSession(userID uuid.UUID, exp int64, token string) bool {
	return s.redisExistsKey(fmt.Sprintf("%s_sessionToken:%s", userID.String(), token))
}

func (s *SessionCacheRedis) IsValidRefresh(userID uuid.UUID, exp int64, token string) bool {
	return s.redisExistsKey(fmt.Sprintf("%s_refreshToken:%s", userID.String(), token))
}

func (s *SessionCacheRedis) Add(userID uuid.UUID, sessionExp int64, sessionToken string, refreshExp int64, refreshToken string) {
	if s.config.GetSession().SingleSession && sessionToken != "" && refreshToken != "" {
		s.RemoveAll(userID)
	} else if s.config.GetSession().SingleSession && sessionToken != "" && refreshToken == "" {
		err := s.redisSearchAndDel(fmt.Sprintf("%s_sessionToken:*", userID.String()))
		if err != nil {
			fmt.Printf("Fork remove other token error:%s\n", err.Error())
		}
	}
	if sessionToken != "" {
		fmt.Printf("expSeconds: %s\n", time.Unix(sessionExp, 0).Sub(time.Now()).String())
		err := s.redisSetKey(fmt.Sprintf("%s_sessionToken:%s", userID.String(), sessionToken), 1, time.Unix(sessionExp, 0).Sub(time.Now()))
		if err != nil {
			fmt.Printf("Add session error%s\n", err.Error())
		}
	}
	if refreshToken != "" {
		err := s.redisSetKey(fmt.Sprintf("%s_refreshToken:%s", userID.String(), refreshToken), 1, time.Unix(refreshExp, 0).Sub(time.Now()))
		if err != nil {
			fmt.Printf("Add session error%s\n", err.Error())
		}
	}
}

func (s *SessionCacheRedis) Remove(userID uuid.UUID, sessionExp int64, sessionToken string, refreshExp int64, refreshToken string) {
	if sessionToken != "" {
		s.redisDelKey(fmt.Sprintf("%s_sessionToken:%s", userID.String(), sessionToken))
	}
	if refreshToken != "" {
		s.redisDelKey(fmt.Sprintf("%s_refreshToken:%s", userID.String(), refreshToken))
	}
}

func (s *SessionCacheRedis) RemoveAll(userID uuid.UUID) {
	err := s.redisSearchAndDel(fmt.Sprintf("%s_*", userID.String()))
	if err != nil {
		fmt.Printf("RemoveAll error%s\n", err.Error())
	}
}

func (s *SessionCacheRedis) Ban(userIDs []uuid.UUID) {
	for _, userID := range userIDs {
		s.RemoveAll(userID)
	}
}
func (s *SessionCacheRedis) Unban(userIDs []uuid.UUID) {}

func (s *SessionCacheRedis) redisSetKey(key string, value interface{}, expiration time.Duration) error {
	p, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if s.isCluster {
		return s.redisClusterClient.Set(s.ctx, key, p, expiration).Err()
	} else {
		return s.redisClient.Set(s.ctx, key, p, expiration).Err()
	}
}

func (s *SessionCacheRedis) redisGetKey(key string, dest interface{}) error {
	if s.isCluster {
		p, err := s.redisClusterClient.Get(s.ctx, key).Result()
		if err != nil {
			return err
		}
		return json.Unmarshal([]byte(p), dest)
	} else {
		p, err := s.redisClient.Get(s.ctx, key).Result()
		if err != nil {
			return err
		}
		return json.Unmarshal([]byte(p), dest)
	}
}
func (s *SessionCacheRedis) redisExistsKey(key string) bool {
	var (
		exists int64
		err    error
	)
	if s.isCluster {
		exists, err = s.redisClusterClient.Exists(s.ctx, key).Result()
	} else {
		exists, err = s.redisClient.Exists(s.ctx, key).Result()
	}
	if err != nil {
		fmt.Printf("redisExistsKey error%s\n", err.Error())
		return false
	}
	// fmt.Printf("redisExistsKey exists:%d\n", exists)
	return exists == 1
}
func (s *SessionCacheRedis) redisDelKey(key string) {
	if s.isCluster {
		s.redisClusterClient.Del(s.ctx, key)
	} else {
		s.redisClient.Del(s.ctx, key)
	}
}
func (s *SessionCacheRedis) redisScanKey(searchPattern string) *redis.ScanCmd {
	if s.isCluster {
		return s.redisClusterClient.Scan(s.ctx, 0, searchPattern, 0)
	} else {
		return s.redisClient.Scan(s.ctx, 0, searchPattern, 0)
	}
}
func (s *SessionCacheRedis) redisSearchAndDel(searchPattern string) error {
	var foundedRecordCount int = 0
	iter := s.redisScanKey(searchPattern).Iterator()
	fmt.Printf("YOUR SEARCH PATTERN= %s\n", searchPattern)
	for iter.Next(s.ctx) {
		fmt.Printf("Deleted= %s\n", iter.Val())
		s.redisDelKey(iter.Val())
		foundedRecordCount++
	}
	if err := iter.Err(); err != nil {
		return err
	}
	fmt.Printf("Deleted Count %d\n", foundedRecordCount)
	return nil
}
