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

	redisClient redis.Client
	cache       map[uuid.UUID]*sessionCacheUser
}

func NewSessionCacheRedis(config Config) SessionCache {
	ctx, ctxCancelFn := context.WithCancel(context.Background())
	// var opt := redis.Options;
	// opt, err := redis.ParseURL(config.GetSharedCache().RedisUri)
	// if err != nil {
	// 	opt := &redis.Options{
	// 		Addr:     config.GetSharedCache().RedisAddr,
	// 		Password: config.GetSharedCache().RedisPassword, // no password set
	// 		DB:       config.GetSharedCache().RedisDb,       // use default DB
	// 		TLSConfig: &tls.Config{
	// 			MinVersion: tls.VersionTLS12,
	// 			//Certificates: []tls.Certificate{cert}
	// 		},
	// 	}
	// }
	var (
		redisAddr     string
		redisPassword string
		redisDBIndex  int
	)

	if config.GetSharedCache().RedisUri != "" {
		redisUrl, _ := url.Parse(config.GetSharedCache().RedisUri)
		redisPassword, _ = redisUrl.User.Password()
		database, err := strconv.Atoi(strings.Replace(redisUrl.Path, "/", "", 1))
		if err != nil {
			panic(err)
		}
		redisAddr = redisUrl.Host
		redisDBIndex = database

	} else {
		redisAddr = config.GetSharedCache().RedisAddr
		redisPassword = config.GetSharedCache().RedisPassword
		redisDBIndex = config.GetSharedCache().RedisDb
	}
	redisOpts := redis.Options{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       redisDBIndex,
	}
	if config.GetSharedCache().TLSEnabled {
		redisOpts.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
			//Certificates: []tls.Certificate{cert}
		}
	}
	s := &SessionCacheRedis{
		config: config,

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,
		redisClient: *redis.NewClient(&redisOpts),
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
		s.redisClient.Del(s.ctx, fmt.Sprintf("%s_sessionToken:%s", userID.String(), sessionToken))
	}
	if refreshToken != "" {
		s.redisClient.Del(s.ctx, fmt.Sprintf("%s_refreshToken:%s", userID.String(), refreshToken))
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
	return s.redisClient.Set(s.ctx, key, p, expiration).Err()
}

func (s *SessionCacheRedis) redisGetKey(key string, dest interface{}) error {
	p, err := s.redisClient.Get(s.ctx, key).Result()
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(p), dest)
}
func (s *SessionCacheRedis) redisExistsKey(key string) bool {
	exists, err := s.redisClient.Exists(s.ctx, key).Result()
	if err != nil {
		fmt.Printf("redisExistsKey error%s\n", err.Error())
		return false
	}
	return exists == 1
}

func (s *SessionCacheRedis) redisSearchAndDel(searchPattern string) error {
	var foundedRecordCount int = 0
	iter := s.redisClient.Scan(s.ctx, 0, searchPattern, 0).Iterator()
	fmt.Printf("YOUR SEARCH PATTERN= %s\n", searchPattern)
	for iter.Next(s.ctx) {
		fmt.Printf("Deleted= %s\n", iter.Val())
		s.redisClient.Del(s.ctx, iter.Val())
		foundedRecordCount++
	}
	if err := iter.Err(); err != nil {
		return err
	}
	fmt.Printf("Deleted Count %d\n", foundedRecordCount)
	return nil
}
