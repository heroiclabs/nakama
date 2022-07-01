package server

import (
	"context"
	"math"
	"sync"
	"time"
)

type LockoutType int

const (
	maxAccountAttempts   = 5
	accountLockoutPeriod = time.Minute * 10
	maxIpAttempts        = 10
	ipLockoutPeriod      = time.Minute * 10

	// Period to which the max attempts apply, counting from the first attempt.
	cacheAttemptsPeriod = time.Minute * 10
)

const (
	unlocked LockoutType = iota
	accountBased
	ipBased
)

type LoginAttemptCache interface {
	Stop()
	// IsLockedOut Checks whether account or ip is locked out and resets lockout/attempts if expired.
	IsLockedOut(account string, ip string) (lockout LockoutType, lockedUntil time.Time)
	// AddAttempt Adds failed attempt and returns current lockout status.
	AddAttempt(account string, ip string) (remainingAttempts int, lockout LockoutType, lockedUntil time.Time)
	// ResetAttempts Resets account attempts on successful login.
	ResetAttempts(account string)
}

type lockoutStatus struct {
	lockedUntil time.Time
	attempts    []time.Time
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
				tM := t.UTC()
				c.Lock()
				for account, status := range c.accountCache {
					if status.lockedUntil.IsZero() {
						if len(status.attempts) == 0 || status.attempts[0].Add(cacheAttemptsPeriod).Before(tM) {
							delete(c.accountCache, account)
						}
					} else if status.lockedUntil.Before(tM) {
						delete(c.accountCache, account)
					}
				}
				for ip, status := range c.ipCache {
					if status.lockedUntil.IsZero() {
						if len(status.attempts) == 0 || status.attempts[0].Add(cacheAttemptsPeriod).Before(tM) {
							delete(c.ipCache, ip)
						}
					} else if status.lockedUntil.Before(tM) {
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

func (c *LocalLoginAttemptCache) IsLockedOut(account string, ip string) (lockout LockoutType, lockedUntil time.Time) {
	now := time.Now()
	c.Lock()
	defer c.Unlock()
	return isLockedOut(c, account, ip, now)
}

func (c *LocalLoginAttemptCache) ResetAttempts(account string) {
	c.Lock()
	delete(c.accountCache, account)
	c.Unlock()
}

func (c *LocalLoginAttemptCache) AddAttempt(account string, ip string) (remainingAttempts int, lockout LockoutType, lockedUntil time.Time) {
	now := time.Now().UTC()
	c.Lock()
	defer c.Unlock()
	lockout, until := isLockedOut(c, account, ip, now)
	if lockout != unlocked {
		return 0, lockout, until
	}
	var accLockedUntil, ipLockedUntil time.Time
	var accRemainingAttempts, ipRemainingAttempts int
	if account != "" {
		st, accFound := c.accountCache[account]
		if !accFound {
			// First failed attempt.
			st = &lockoutStatus{
				attempts: make([]time.Time, 0, maxAccountAttempts),
			}
			st.attempts = append(st.attempts, now)
			c.accountCache[account] = st
			accRemainingAttempts = maxAccountAttempts - 1
		} else if len(st.attempts) >= maxAccountAttempts-1 {
			// Reached attempt limit.
			st.lockedUntil = now.Add(accountLockoutPeriod)
			accLockedUntil = st.lockedUntil
		} else {
			st.attempts = append(st.attempts, now)
			accRemainingAttempts = maxAccountAttempts - len(st.attempts)
		}
	} else {
		accRemainingAttempts = math.MaxInt
	}
	if ip != "" {
		st, ipFound := c.ipCache[ip]
		if !ipFound {
			// First failed attempt.
			st = &lockoutStatus{
				attempts: make([]time.Time, 0, maxIpAttempts),
			}
			st.attempts = append(st.attempts, now)
			c.ipCache[ip] = st
			ipRemainingAttempts = maxIpAttempts - 1
		} else if len(st.attempts) >= maxIpAttempts-1 {
			// Reached attempt limit.
			st.lockedUntil = now.Add(ipLockoutPeriod)
			ipLockedUntil = st.lockedUntil
		} else {
			st.attempts = append(st.attempts, now)
			ipRemainingAttempts = maxIpAttempts - len(st.attempts)
		}
	}
	if accLockedUntil.After(ipLockedUntil) {
		lockedUntil = accLockedUntil
		lockout = accountBased
	} else {
		lockedUntil = ipLockedUntil
		lockout = ipBased
	}
	if lockedUntil.IsZero() {
		lockout = unlocked
	}
	remainingAttempts = min(accRemainingAttempts, ipRemainingAttempts)
	return
}

func isLockedOut(c *LocalLoginAttemptCache, account string, ip string, now time.Time) (lockout LockoutType, lockedUntil time.Time) {
	accStatus, accFound := c.accountCache[account]
	ipStatus, ipFound := c.ipCache[ip]
	var accLockedUntil, ipLockedUntil time.Time
	if accFound {
		if accStatus.lockedUntil.IsZero() {
			accLockedUntil = time.Time{}
			if len(accStatus.attempts) == 0 || accStatus.attempts[0].Add(cacheAttemptsPeriod).Before(now) {
				delete(c.accountCache, account)
			}
		} else {
			if accStatus.lockedUntil.After(now) {
				accLockedUntil = accStatus.lockedUntil
			} else {
				delete(c.accountCache, account)
				accLockedUntil = time.Time{}
			}
		}
	}
	if ipFound {
		if ipStatus.lockedUntil.IsZero() {
			ipLockedUntil = time.Time{}
			if len(ipStatus.attempts) == 0 || ipStatus.attempts[0].Add(cacheAttemptsPeriod).Before(now) {
				delete(c.ipCache, ip)
			}
		} else {
			if ipStatus.lockedUntil.After(now) {
				ipLockedUntil = ipStatus.lockedUntil
			} else {
				delete(c.ipCache, ip)
				ipLockedUntil = time.Time{}
			}
		}
	}
	if accLockedUntil.After(ipLockedUntil) {
		lockedUntil = accLockedUntil
		lockout = accountBased
	} else {
		lockedUntil = ipLockedUntil
		lockout = ipBased
	}
	if lockedUntil.IsZero() {
		lockout = unlocked
	}
	return
}

func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}
