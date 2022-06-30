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
	IsLockedOut(account string, ip string) (LockoutType, time.Time)
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

func (c *LocalFailedLoginCache) IsLockedOut(account string, ip string) (lockout LockoutType, lockedUntil time.Time) {
	c.RLock()
	lockout, lockedUntil = isLockedOut(c, account, ip)
	c.RUnlock()
	return
}

func (c *LocalFailedLoginCache) ResetAttempts(account string, ip string) {
	c.Lock()
	delete(c.accountCache, account)
	delete(c.ipCache, ip)
	c.Unlock()
}

func (c *LocalFailedLoginCache) AddAttempt(account string, ip string) (remainingChances int, lockout LockoutType, lockedUntil time.Time) {
	now := time.Now().UTC()
	lockout = unlocked
	c.Lock()
	lockout, until := isLockedOut(c, account, ip)
	if lockout != unlocked {
		c.Unlock()
		return 0, lockout, until
	}
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

func isLockedOut(c *LocalFailedLoginCache, account string, ip string) (lockout LockoutType, lockedUntil time.Time) {
	accStatus, accFound := c.accountCache[account]
	ipStatus, ipFound := c.ipCache[ip]
	var accLockedUntil, ipLockedUntil time.Time
	if accFound {
		accLockedUntil = accStatus.lockedUntil
	}
	if ipFound {
		ipLockedUntil = ipStatus.lockedUntil
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
