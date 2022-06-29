package server

import (
	"context"
	"sync"
	"time"
)

type LockoutType int

const (
	maxAccountAttempts   = 5
	accountLockoutPeriod = time.Minute * 5
	maxIpAttempts        = 10
	ipLockoutPeriod      = time.Minute * 10
)

const (
	unlocked LockoutType = iota
	accountBased
	ipBased
)

type FailedLoginCache interface {
	AddAttempt(account string, ip string) LockoutType
	ResetAttempts(account string, ip string)
}

type status struct {
	lockedUntil time.Time
	attempts    []time.Time
}

type LocalFailedLoginCache struct {
	sync.RWMutex
	ctx         context.Context
	ctxCancelFn context.CancelFunc

	accountCache map[string]*status
	ipCache      map[string]*status
}

func (c *LocalFailedLoginCache) AddAttempt(account string, ip string) (remainingChances int, lockout LockoutType, lockedUntil time.Time) {
	// TODO: check if there are any locks first
	now := time.Now().UTC()
	lockout = unlocked
	c.Lock()
	if account != "" {
		st, accFound := c.accountCache[account]
		if !accFound {
			// First failed attempt.
			st = &status{
				attempts: make([]time.Time, 0, maxAccountAttempts),
			}
			st.attempts = append(st.attempts, now)
			c.accountCache[account] = st
			remainingChances = maxAccountAttempts - 1
		} else {
			if st.lockedUntil.IsZero() {
				if len(st.attempts) >= maxAccountAttempts-1 {
					// Reached attempt limit.
					st.lockedUntil = now.Add(accountLockoutPeriod)
					lockout = accountBased
					lockedUntil = st.lockedUntil
				}
			} else {
				// Currently locked out.
				lockout = accountBased
				lockedUntil = st.lockedUntil
			}
		}
	}
	if ip != "" {
		_, ipFound := c.ipCache[ip]
		if !ipFound {
			c.ipCache[ip] = &status{
				attempts: make([]time.Time, 0, maxIpAttempts),
			}
		} else {

		}
	}
	c.Unlock()
	return
}
