// Copyright 2026 The Nakama Authors
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
	"sync/atomic"

	"github.com/uber-go/tally/v4"
)

var _ tally.Scope = (*metricsLimitedScope)(nil)

type metricsLimitedScope struct {
	scope tally.Scope

	keysLimit int32
	keysCount *atomic.Int32
	keys      *MapOf[string, bool]
}

func newMetricsLimitedScope(scope tally.Scope, limit int32) *metricsLimitedScope {
	return &metricsLimitedScope{
		scope: scope,

		keysLimit: limit,
		keysCount: &atomic.Int32{},
		keys:      &MapOf[string, bool]{},
	}
}

func (m *metricsLimitedScope) Counter(name string) tally.Counter {
	return m.scope.Counter(name)
}

func (m *metricsLimitedScope) Gauge(name string) tally.Gauge {
	return m.scope.Gauge(name)
}

func (m *metricsLimitedScope) Timer(name string) tally.Timer {
	return m.scope.Timer(name)
}

func (m *metricsLimitedScope) Histogram(name string, buckets tally.Buckets) tally.Histogram {
	return m.scope.Histogram(name, buckets)
}

func (m *metricsLimitedScope) Tagged(tags map[string]string) tally.Scope {
	key := tally.KeyForStringMap(tags)

	_, seen := m.keys.Load(key)
	if seen {
		// This is a known scope, allow it to be re-used.
		return m.scope.Tagged(tags)
	}

	if m.keysCount.Load() >= m.keysLimit {
		// Clearly exceeded number of scopes, return a noop one to prevent allocating further memory.
		return tally.NoopScope
	}
	m.keysCount.Add(1)

	_, seen = m.keys.LoadOrStore(key, true)
	if seen {
		// Key was stored by a concurrent operation, do not count it as new.
		m.keysCount.Add(-1)
	}

	return m.scope.Tagged(tags)
}

func (m *metricsLimitedScope) SubScope(name string) tally.Scope {
	return m.scope.SubScope(name)
}

func (m *metricsLimitedScope) Capabilities() tally.Capabilities {
	return m.scope.Capabilities()
}
