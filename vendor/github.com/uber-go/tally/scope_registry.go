// Copyright (c) 2020 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

package tally

import "sync"

var scopeRegistryKey = keyForPrefixedStringMaps

type scopeRegistry struct {
	mu        sync.RWMutex
	subscopes map[string]*scope
}

func newScopeRegistry(root *scope) *scopeRegistry {
	r := &scopeRegistry{
		subscopes: make(map[string]*scope),
	}
	r.subscopes[scopeRegistryKey(root.prefix, root.tags)] = root
	return r
}

func (r *scopeRegistry) Report(reporter StatsReporter) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, s := range r.subscopes {
		s.report(reporter)
	}
}

func (r *scopeRegistry) CachedReport() {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, s := range r.subscopes {
		s.cachedReport()
	}
}

func (r *scopeRegistry) ForEachScope(f func(*scope)) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, s := range r.subscopes {
		f(s)
	}
}

func (r *scopeRegistry) Subscope(parent *scope, prefix string, tags map[string]string) *scope {
	key := scopeRegistryKey(prefix, parent.tags, tags)

	r.mu.RLock()
	if s, ok := r.lockedLookup(key); ok {
		r.mu.RUnlock()
		return s
	}
	r.mu.RUnlock()

	r.mu.Lock()
	defer r.mu.Unlock()

	if s, ok := r.lockedLookup(key); ok {
		return s
	}

	allTags := mergeRightTags(parent.tags, tags)
	subscope := &scope{
		separator: parent.separator,
		prefix:    prefix,
		// NB(prateek): don't need to copy the tags here,
		// we assume the map provided is immutable.
		tags:           allTags,
		reporter:       parent.reporter,
		cachedReporter: parent.cachedReporter,
		baseReporter:   parent.baseReporter,
		defaultBuckets: parent.defaultBuckets,
		sanitizer:      parent.sanitizer,
		registry:       parent.registry,

		counters:        make(map[string]*counter),
		countersSlice:   make([]*counter, 0, _defaultInitialSliceSize),
		gauges:          make(map[string]*gauge),
		gaugesSlice:     make([]*gauge, 0, _defaultInitialSliceSize),
		histograms:      make(map[string]*histogram),
		histogramsSlice: make([]*histogram, 0, _defaultInitialSliceSize),
		timers:          make(map[string]*timer),
	}
	r.subscopes[key] = subscope
	return subscope
}

func (r *scopeRegistry) lockedLookup(key string) (*scope, bool) {
	ss, ok := r.subscopes[key]
	return ss, ok
}
