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
	"io"
	"sync"
	"time"

	"go.uber.org/atomic"
)

const (
	_defaultInitialSliceSize = 16
)

var (
	// NoopScope is a scope that does nothing
	NoopScope, _ = NewRootScope(ScopeOptions{Reporter: NullStatsReporter}, 0)
	// DefaultSeparator is the default separator used to join nested scopes
	DefaultSeparator = "."

	globalNow = time.Now

	defaultScopeBuckets = DurationBuckets{
		0 * time.Millisecond,
		10 * time.Millisecond,
		25 * time.Millisecond,
		50 * time.Millisecond,
		75 * time.Millisecond,
		100 * time.Millisecond,
		200 * time.Millisecond,
		300 * time.Millisecond,
		400 * time.Millisecond,
		500 * time.Millisecond,
		600 * time.Millisecond,
		800 * time.Millisecond,
		1 * time.Second,
		2 * time.Second,
		5 * time.Second,
	}
)

type scope struct {
	separator      string
	prefix         string
	tags           map[string]string
	reporter       StatsReporter
	cachedReporter CachedStatsReporter
	baseReporter   BaseStatsReporter
	defaultBuckets Buckets
	sanitizer      Sanitizer

	registry *scopeRegistry

	cm sync.RWMutex
	gm sync.RWMutex
	tm sync.RWMutex
	hm sync.RWMutex

	counters        map[string]*counter
	countersSlice   []*counter
	gauges          map[string]*gauge
	gaugesSlice     []*gauge
	histograms      map[string]*histogram
	histogramsSlice []*histogram
	timers          map[string]*timer
	// nb: deliberately skipping timersSlice as we report timers immediately,
	// no buffering is involved.

	bucketCache *bucketCache
	closed      atomic.Bool
	done        chan struct{}
	wg          sync.WaitGroup
	root        bool
}

// ScopeOptions is a set of options to construct a scope.
type ScopeOptions struct {
	Tags            map[string]string
	Prefix          string
	Reporter        StatsReporter
	CachedReporter  CachedStatsReporter
	Separator       string
	DefaultBuckets  Buckets
	SanitizeOptions *SanitizeOptions
}

// NewRootScope creates a new root Scope with a set of options and
// a reporting interval.
// Must provide either a StatsReporter or a CachedStatsReporter.
func NewRootScope(opts ScopeOptions, interval time.Duration) (Scope, io.Closer) {
	s := newRootScope(opts, interval)
	return s, s
}

// NewTestScope creates a new Scope without a stats reporter with the
// given prefix and adds the ability to take snapshots of metrics emitted
// to it.
func NewTestScope(
	prefix string,
	tags map[string]string,
) TestScope {
	return newRootScope(ScopeOptions{Prefix: prefix, Tags: tags}, 0)
}

func newRootScope(opts ScopeOptions, interval time.Duration) *scope {
	sanitizer := NewNoOpSanitizer()
	if o := opts.SanitizeOptions; o != nil {
		sanitizer = NewSanitizer(*o)
	}

	if opts.Tags == nil {
		opts.Tags = make(map[string]string)
	}
	if opts.Separator == "" {
		opts.Separator = DefaultSeparator
	}

	var baseReporter BaseStatsReporter
	if opts.Reporter != nil {
		baseReporter = opts.Reporter
	} else if opts.CachedReporter != nil {
		baseReporter = opts.CachedReporter
	}

	if opts.DefaultBuckets == nil || opts.DefaultBuckets.Len() < 1 {
		opts.DefaultBuckets = defaultScopeBuckets
	}

	s := &scope{
		baseReporter:    baseReporter,
		bucketCache:     newBucketCache(),
		cachedReporter:  opts.CachedReporter,
		counters:        make(map[string]*counter),
		countersSlice:   make([]*counter, 0, _defaultInitialSliceSize),
		defaultBuckets:  opts.DefaultBuckets,
		done:            make(chan struct{}),
		gauges:          make(map[string]*gauge),
		gaugesSlice:     make([]*gauge, 0, _defaultInitialSliceSize),
		histograms:      make(map[string]*histogram),
		histogramsSlice: make([]*histogram, 0, _defaultInitialSliceSize),
		prefix:          sanitizer.Name(opts.Prefix),
		reporter:        opts.Reporter,
		sanitizer:       sanitizer,
		separator:       sanitizer.Name(opts.Separator),
		timers:          make(map[string]*timer),
		root:            true,
	}

	// NB(r): Take a copy of the tags on creation
	// so that it cannot be modified after set.
	s.tags = s.copyAndSanitizeMap(opts.Tags)

	// Register the root scope
	s.registry = newScopeRegistry(s)

	if interval > 0 {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.reportLoop(interval)
		}()
	}

	return s
}

// report dumps all aggregated stats into the reporter. Should be called automatically by the root scope periodically.
func (s *scope) report(r StatsReporter) {
	s.cm.RLock()
	for name, counter := range s.counters {
		counter.report(s.fullyQualifiedName(name), s.tags, r)
	}
	s.cm.RUnlock()

	s.gm.RLock()
	for name, gauge := range s.gauges {
		gauge.report(s.fullyQualifiedName(name), s.tags, r)
	}
	s.gm.RUnlock()

	// we do nothing for timers here because timers report directly to ths StatsReporter without buffering

	s.hm.RLock()
	for name, histogram := range s.histograms {
		histogram.report(s.fullyQualifiedName(name), s.tags, r)
	}
	s.hm.RUnlock()
}

func (s *scope) cachedReport() {
	s.cm.RLock()
	for _, counter := range s.countersSlice {
		counter.cachedReport()
	}
	s.cm.RUnlock()

	s.gm.RLock()
	for _, gauge := range s.gaugesSlice {
		gauge.cachedReport()
	}
	s.gm.RUnlock()

	// we do nothing for timers here because timers report directly to ths StatsReporter without buffering

	s.hm.RLock()
	for _, histogram := range s.histogramsSlice {
		histogram.cachedReport()
	}
	s.hm.RUnlock()
}

// reportLoop is used by the root scope for periodic reporting
func (s *scope) reportLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.reportLoopRun()
		case <-s.done:
			return
		}
	}
}

func (s *scope) reportLoopRun() {
	if s.closed.Load() {
		return
	}

	s.reportRegistry()
}

func (s *scope) reportRegistry() {
	if s.reporter != nil {
		s.registry.Report(s.reporter)
		s.reporter.Flush()
	} else if s.cachedReporter != nil {
		s.registry.CachedReport()
		s.cachedReporter.Flush()
	}
}

func (s *scope) Counter(name string) Counter {
	name = s.sanitizer.Name(name)
	if c, ok := s.counter(name); ok {
		return c
	}

	s.cm.Lock()
	defer s.cm.Unlock()

	if c, ok := s.counters[name]; ok {
		return c
	}

	var cachedCounter CachedCount
	if s.cachedReporter != nil {
		cachedCounter = s.cachedReporter.AllocateCounter(
			s.fullyQualifiedName(name),
			s.tags,
		)
	}

	c := newCounter(cachedCounter)
	s.counters[name] = c
	s.countersSlice = append(s.countersSlice, c)

	return c
}

func (s *scope) counter(sanitizedName string) (Counter, bool) {
	s.cm.RLock()
	defer s.cm.RUnlock()

	c, ok := s.counters[sanitizedName]
	return c, ok
}

func (s *scope) Gauge(name string) Gauge {
	name = s.sanitizer.Name(name)
	if g, ok := s.gauge(name); ok {
		return g
	}

	s.gm.Lock()
	defer s.gm.Unlock()

	if g, ok := s.gauges[name]; ok {
		return g
	}

	var cachedGauge CachedGauge
	if s.cachedReporter != nil {
		cachedGauge = s.cachedReporter.AllocateGauge(
			s.fullyQualifiedName(name), s.tags,
		)
	}

	g := newGauge(cachedGauge)
	s.gauges[name] = g
	s.gaugesSlice = append(s.gaugesSlice, g)

	return g
}

func (s *scope) gauge(name string) (Gauge, bool) {
	s.gm.RLock()
	defer s.gm.RUnlock()

	g, ok := s.gauges[name]
	return g, ok
}

func (s *scope) Timer(name string) Timer {
	name = s.sanitizer.Name(name)
	if t, ok := s.timer(name); ok {
		return t
	}

	s.tm.Lock()
	defer s.tm.Unlock()

	if t, ok := s.timers[name]; ok {
		return t
	}

	var cachedTimer CachedTimer
	if s.cachedReporter != nil {
		cachedTimer = s.cachedReporter.AllocateTimer(
			s.fullyQualifiedName(name), s.tags,
		)
	}

	t := newTimer(
		s.fullyQualifiedName(name), s.tags, s.reporter, cachedTimer,
	)
	s.timers[name] = t

	return t
}

func (s *scope) timer(sanitizedName string) (Timer, bool) {
	s.tm.RLock()
	defer s.tm.RUnlock()

	t, ok := s.timers[sanitizedName]
	return t, ok
}

func (s *scope) Histogram(name string, b Buckets) Histogram {
	name = s.sanitizer.Name(name)
	if h, ok := s.histogram(name); ok {
		return h
	}

	if b == nil {
		b = s.defaultBuckets
	}

	htype := valueHistogramType
	if _, ok := b.(DurationBuckets); ok {
		htype = durationHistogramType
	}

	s.hm.Lock()
	defer s.hm.Unlock()

	if h, ok := s.histograms[name]; ok {
		return h
	}

	var cachedHistogram CachedHistogram
	if s.cachedReporter != nil {
		cachedHistogram = s.cachedReporter.AllocateHistogram(
			s.fullyQualifiedName(name), s.tags, b,
		)
	}

	h := newHistogram(
		htype,
		s.fullyQualifiedName(name),
		s.tags,
		s.reporter,
		s.bucketCache.Get(htype, b),
		cachedHistogram,
	)
	s.histograms[name] = h
	s.histogramsSlice = append(s.histogramsSlice, h)

	return h
}

func (s *scope) histogram(sanitizedName string) (Histogram, bool) {
	s.hm.RLock()
	defer s.hm.RUnlock()

	h, ok := s.histograms[sanitizedName]
	return h, ok
}

func (s *scope) Tagged(tags map[string]string) Scope {
	return s.subscope(s.prefix, tags)
}

func (s *scope) SubScope(prefix string) Scope {
	prefix = s.sanitizer.Name(prefix)
	return s.subscope(s.fullyQualifiedName(prefix), nil)
}

func (s *scope) subscope(prefix string, tags map[string]string) Scope {
	return s.registry.Subscope(s, prefix, tags)
}

func (s *scope) Capabilities() Capabilities {
	if s.baseReporter == nil {
		return capabilitiesNone
	}
	return s.baseReporter.Capabilities()
}

func (s *scope) Snapshot() Snapshot {
	snap := newSnapshot()

	s.registry.ForEachScope(func(ss *scope) {
		// NB(r): tags are immutable, no lock required to read.
		tags := make(map[string]string, len(s.tags))
		for k, v := range ss.tags {
			tags[k] = v
		}

		ss.cm.RLock()
		for key, c := range ss.counters {
			name := ss.fullyQualifiedName(key)
			id := KeyForPrefixedStringMap(name, tags)
			snap.counters[id] = &counterSnapshot{
				name:  name,
				tags:  tags,
				value: c.snapshot(),
			}
		}
		ss.cm.RUnlock()
		ss.gm.RLock()
		for key, g := range ss.gauges {
			name := ss.fullyQualifiedName(key)
			id := KeyForPrefixedStringMap(name, tags)
			snap.gauges[id] = &gaugeSnapshot{
				name:  name,
				tags:  tags,
				value: g.snapshot(),
			}
		}
		ss.gm.RUnlock()
		ss.tm.RLock()
		for key, t := range ss.timers {
			name := ss.fullyQualifiedName(key)
			id := KeyForPrefixedStringMap(name, tags)
			snap.timers[id] = &timerSnapshot{
				name:   name,
				tags:   tags,
				values: t.snapshot(),
			}
		}
		ss.tm.RUnlock()
		ss.hm.RLock()
		for key, h := range ss.histograms {
			name := ss.fullyQualifiedName(key)
			id := KeyForPrefixedStringMap(name, tags)
			snap.histograms[id] = &histogramSnapshot{
				name:      name,
				tags:      tags,
				values:    h.snapshotValues(),
				durations: h.snapshotDurations(),
			}
		}
		ss.hm.RUnlock()
	})

	return snap
}

func (s *scope) Close() error {
	// n.b. Once this flag is set, the next scope report will remove it from
	//      the registry and clear its metrics.
	if !s.closed.CAS(false, true) {
		return nil
	}

	close(s.done)

	if s.root {
		s.reportRegistry()
		if closer, ok := s.baseReporter.(io.Closer); ok {
			return closer.Close()
		}
	}

	return nil
}

func (s *scope) clearMetrics() {
	s.cm.Lock()
	s.gm.Lock()
	s.tm.Lock()
	s.hm.Lock()
	defer s.cm.Unlock()
	defer s.gm.Unlock()
	defer s.tm.Unlock()
	defer s.hm.Unlock()

	for k := range s.counters {
		delete(s.counters, k)
	}
	s.countersSlice = nil

	for k := range s.gauges {
		delete(s.gauges, k)
	}
	s.gaugesSlice = nil

	for k := range s.timers {
		delete(s.timers, k)
	}

	for k := range s.histograms {
		delete(s.histograms, k)
	}
	s.histogramsSlice = nil
}

// NB(prateek): We assume concatenation of sanitized inputs is
// sanitized. If that stops being true, then we need to sanitize the
// output of this function.
func (s *scope) fullyQualifiedName(name string) string {
	if len(s.prefix) == 0 {
		return name
	}
	// NB: we don't need to sanitize the output of this function as we
	// sanitize all the the inputs (prefix, separator, name); and the
	// output we're creating is a concatenation of the sanitized inputs.
	// If we change the concatenation to involve other inputs or characters,
	// we'll need to sanitize them too.
	return s.prefix + s.separator + name
}

func (s *scope) copyAndSanitizeMap(tags map[string]string) map[string]string {
	result := make(map[string]string, len(tags))
	for k, v := range tags {
		k = s.sanitizer.Key(k)
		v = s.sanitizer.Value(v)
		result[k] = v
	}
	return result
}

// TestScope is a metrics collector that has no reporting, ensuring that
// all emitted values have a given prefix or set of tags
type TestScope interface {
	Scope

	// Snapshot returns a copy of all values since the last report execution,
	// this is an expensive operation and should only be use for testing purposes
	Snapshot() Snapshot
}

// Snapshot is a snapshot of values since last report execution
type Snapshot interface {
	// Counters returns a snapshot of all counter summations since last report execution
	Counters() map[string]CounterSnapshot

	// Gauges returns a snapshot of gauge last values since last report execution
	Gauges() map[string]GaugeSnapshot

	// Timers returns a snapshot of timer values since last report execution
	Timers() map[string]TimerSnapshot

	// Histograms returns a snapshot of histogram samples since last report execution
	Histograms() map[string]HistogramSnapshot
}

// CounterSnapshot is a snapshot of a counter
type CounterSnapshot interface {
	// Name returns the name
	Name() string

	// Tags returns the tags
	Tags() map[string]string

	// Value returns the value
	Value() int64
}

// GaugeSnapshot is a snapshot of a gauge
type GaugeSnapshot interface {
	// Name returns the name
	Name() string

	// Tags returns the tags
	Tags() map[string]string

	// Value returns the value
	Value() float64
}

// TimerSnapshot is a snapshot of a timer
type TimerSnapshot interface {
	// Name returns the name
	Name() string

	// Tags returns the tags
	Tags() map[string]string

	// Values returns the values
	Values() []time.Duration
}

// HistogramSnapshot is a snapshot of a histogram
type HistogramSnapshot interface {
	// Name returns the name
	Name() string

	// Tags returns the tags
	Tags() map[string]string

	// Values returns the sample values by upper bound for a valueHistogram
	Values() map[float64]int64

	// Durations returns the sample values by upper bound for a durationHistogram
	Durations() map[time.Duration]int64
}

// mergeRightTags merges 2 sets of tags with the tags from tagsRight overriding values from tagsLeft
func mergeRightTags(tagsLeft, tagsRight map[string]string) map[string]string {
	if tagsLeft == nil && tagsRight == nil {
		return nil
	}
	if len(tagsRight) == 0 {
		return tagsLeft
	}
	if len(tagsLeft) == 0 {
		return tagsRight
	}

	result := make(map[string]string, len(tagsLeft)+len(tagsRight))
	for k, v := range tagsLeft {
		result[k] = v
	}
	for k, v := range tagsRight {
		result[k] = v
	}
	return result
}

type snapshot struct {
	counters   map[string]CounterSnapshot
	gauges     map[string]GaugeSnapshot
	timers     map[string]TimerSnapshot
	histograms map[string]HistogramSnapshot
}

func newSnapshot() *snapshot {
	return &snapshot{
		counters:   make(map[string]CounterSnapshot),
		gauges:     make(map[string]GaugeSnapshot),
		timers:     make(map[string]TimerSnapshot),
		histograms: make(map[string]HistogramSnapshot),
	}
}

func (s *snapshot) Counters() map[string]CounterSnapshot {
	return s.counters
}

func (s *snapshot) Gauges() map[string]GaugeSnapshot {
	return s.gauges
}

func (s *snapshot) Timers() map[string]TimerSnapshot {
	return s.timers
}

func (s *snapshot) Histograms() map[string]HistogramSnapshot {
	return s.histograms
}

type counterSnapshot struct {
	name  string
	tags  map[string]string
	value int64
}

func (s *counterSnapshot) Name() string {
	return s.name
}

func (s *counterSnapshot) Tags() map[string]string {
	return s.tags
}

func (s *counterSnapshot) Value() int64 {
	return s.value
}

type gaugeSnapshot struct {
	name  string
	tags  map[string]string
	value float64
}

func (s *gaugeSnapshot) Name() string {
	return s.name
}

func (s *gaugeSnapshot) Tags() map[string]string {
	return s.tags
}

func (s *gaugeSnapshot) Value() float64 {
	return s.value
}

type timerSnapshot struct {
	name   string
	tags   map[string]string
	values []time.Duration
}

func (s *timerSnapshot) Name() string {
	return s.name
}

func (s *timerSnapshot) Tags() map[string]string {
	return s.tags
}

func (s *timerSnapshot) Values() []time.Duration {
	return s.values
}

type histogramSnapshot struct {
	name      string
	tags      map[string]string
	values    map[float64]int64
	durations map[time.Duration]int64
}

func (s *histogramSnapshot) Name() string {
	return s.name
}

func (s *histogramSnapshot) Tags() map[string]string {
	return s.tags
}

func (s *histogramSnapshot) Values() map[float64]int64 {
	return s.values
}

func (s *histogramSnapshot) Durations() map[time.Duration]int64 {
	return s.durations
}
