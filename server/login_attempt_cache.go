// Copyright 2022 The Nakama Authors
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
	"sync"
	"time"
)

type LockoutType uint8

const (
	LockoutTypeNone LockoutType = iota
	LockoutTypeAccount
	LockoutTypeIp
)

const (
	maxAttemptsAccount   = 5
	lockoutPeriodAccount = time.Minute * 1

	maxAttemptsIp   = 10
	lockoutPeriodIp = time.Minute * 10
)

type LoginAttemptCache interface {
	Stop()
	// Allow checks whether account or IP is locked out or should be allowed to attempt to authenticate.
	Allow(account, ip string) bool
	// Add a failed attempt and return current lockout status.
	Add(account, ip string) (LockoutType, time.Time)
	// Reset account attempts on successful login.
	Reset(account string)
}

type lockoutStatus struct {
	lockedUntil time.Time
	attempts    []time.Time
}

func (ls *lockoutStatus) trim(now time.Time, retentionPeriod time.Duration) bool {
	if ls.lockedUntil.Before(now) {
		ls.lockedUntil = time.Time{}
	}
	for i := len(ls.attempts) - 1; i >= 0; i-- {
		if now.Sub(ls.attempts[i]) >= retentionPeriod {
			ls.attempts = ls.attempts[i+1:]
			break
		}
	}

	return ls.lockedUntil.IsZero() && len(ls.attempts) == 0
}

type LocalLoginAttemptCache struct {
	sync.RWMutex
	ctx         context.Context
	ctxCancelFn context.CancelFunc

	accountCache map[string]*lockoutStatus
	ipCache      map[string]*lockoutStatus
}

func NewLocalLoginAttemptCache() LoginAttemptCache {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	c := &LocalLoginAttemptCache{
		accountCache: make(map[string]*lockoutStatus),
		ipCache:      make(map[string]*lockoutStatus),

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,
	}

	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		for {
			select {
			case <-c.ctx.Done():
				ticker.Stop()
				return
			case t := <-ticker.C:
				now := t.UTC()
				c.Lock()
				for account, status := range c.accountCache {
					if status.trim(now, lockoutPeriodAccount) {
						delete(c.accountCache, account)
					}
				}
				for ip, status := range c.ipCache {
					if status.trim(now, lockoutPeriodIp) {
						delete(c.ipCache, ip)
					}
				}
				c.Unlock()
			}
		}
	}()

	return c
}

func (c *LocalLoginAttemptCache) Stop() {
	c.ctxCancelFn()
}

func (c *LocalLoginAttemptCache) Allow(account, ip string) bool {
	now := time.Now().UTC()
	c.RLock()
	defer c.RUnlock()
	if status, found := c.accountCache[account]; found && !status.lockedUntil.IsZero() && status.lockedUntil.After(now) {
		return false
	}
	if status, found := c.ipCache[ip]; found && !status.lockedUntil.IsZero() && status.lockedUntil.After(now) {
		return false
	}
	return true
}

func (c *LocalLoginAttemptCache) Reset(account string) {
	c.Lock()
	delete(c.accountCache, account)
	c.Unlock()
}

func (c *LocalLoginAttemptCache) Add(account, ip string) (LockoutType, time.Time) {
	now := time.Now().UTC()
	var lockoutType LockoutType
	var lockedUntil time.Time
	c.Lock()
	defer c.Unlock()
	if account != "" {
		status, found := c.accountCache[account]
		if !found {
			status = &lockoutStatus{}
			c.accountCache[account] = status
		}
		status.attempts = append(status.attempts, now)
		_ = status.trim(now, lockoutPeriodAccount)
		if len(status.attempts) >= maxAttemptsAccount {
			status.lockedUntil = now.Add(lockoutPeriodAccount)
			lockedUntil = status.lockedUntil
			lockoutType = LockoutTypeAccount
		}
	}
	//if ip != "" {
	//	status, found := c.ipCache[ip]
	//	if !found {
	//		status = &lockoutStatus{}
	//		c.ipCache[ip] = status
	//	}
	//	status.attempts = append(status.attempts, now)
	//	_ = status.trim(now, lockoutPeriodIp)
	//	if len(status.attempts) >= maxAttemptsIp {
	//		status.lockedUntil = now.Add(lockoutPeriodIp)
	//		lockedUntil = status.lockedUntil
	//		lockoutType = LockoutTypeIp
	//	}
	//}
	return lockoutType, lockedUntil
}
