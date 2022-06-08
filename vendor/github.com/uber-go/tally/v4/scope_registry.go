// Copyright (c) 2021 Uber Technologies, Inc.
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

import (
	"sync"
	"unsafe"
)

var scopeRegistryKey = keyForPrefixedStringMaps

type scopeRegistry struct {
	mu        sync.RWMutex
	root      *scope
	subscopes map[string]*scope
}

func newScopeRegistry(root *scope) *scopeRegistry {
	r := &scopeRegistry{
		root:      root,
		subscopes: make(map[string]*scope),
	}
	r.subscopes[scopeRegistryKey(root.prefix, root.tags)] = root
	return r
}

func (r *scopeRegistry) Report(reporter StatsReporter) {
	defer r.purgeIfRootClosed()
	r.mu.RLock()
	defer r.mu.RUnlock()

	for name, s := range r.subscopes {
		s.report(reporter)

		if s.closed.Load() {
			r.removeWithRLock(name)
			s.clearMetrics()
		}
	}
}

func (r *scopeRegistry) CachedReport() {
	defer r.purgeIfRootClosed()

	r.mu.RLock()
	defer r.mu.RUnlock()

	for name, s := range r.subscopes {
		s.cachedReport()

		if s.closed.Load() {
			r.removeWithRLock(name)
			s.clearMetrics()
		}
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
	if r.root.closed.Load() || parent.closed.Load() {
		return NoopScope.(*scope)
	}

	buf := keyForPrefixedStringMapsAsKey(make([]byte, 0, 256), prefix, parent.tags, tags)
	r.mu.RLock()
	// buf is stack allocated and casting it to a string for lookup from the cache
	// as the memory layout of []byte is a superset of string the below casting is safe and does not do any alloc
	// However it cannot be used outside of the stack; a heap allocation is needed if that string needs to be stored
	// in the map as a key
	if s, ok := r.lockedLookup(*(*string)(unsafe.Pointer(&buf))); ok {
		r.mu.RUnlock()
		return s
	}
	r.mu.RUnlock()

	// heap allocating the buf as a string to keep the key in the subscopes map
	preSanitizeKey := string(buf)
	tags = parent.copyAndSanitizeMap(tags)
	key := scopeRegistryKey(prefix, parent.tags, tags)

	r.mu.Lock()
	defer r.mu.Unlock()

	if s, ok := r.lockedLookup(key); ok {
		if _, ok = r.lockedLookup(preSanitizeKey); !ok {
			r.subscopes[preSanitizeKey] = s
		}
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
		bucketCache:     parent.bucketCache,
		done:            make(chan struct{}),
	}
	r.subscopes[key] = subscope
	if _, ok := r.lockedLookup(preSanitizeKey); !ok {
		r.subscopes[preSanitizeKey] = subscope
	}
	return subscope
}

func (r *scopeRegistry) lockedLookup(key string) (*scope, bool) {
	ss, ok := r.subscopes[key]
	return ss, ok
}

func (r *scopeRegistry) purgeIfRootClosed() {
	if !r.root.closed.Load() {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	for k, s := range r.subscopes {
		_ = s.Close()
		s.clearMetrics()
		delete(r.subscopes, k)
	}
}

func (r *scopeRegistry) removeWithRLock(key string) {
	// n.b. This function must lock the registry for writing and return it to an
	//      RLocked state prior to exiting. Defer order is important (LIFO).
	r.mu.RUnlock()
	defer r.mu.RLock()
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.subscopes, key)
}
