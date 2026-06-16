package pgxpprof

// Stack aggregation storage is adapted from Grafana Pyroscope godeltaprof's
// profMap, licensed under the Apache License, Version 2.0. See
// THIRD_PARTY_NOTICES.md.

import (
	"fmt"
	"io"
	"iter"
	"math"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/pprof/profile"
)

// Profiler aggregates PostgreSQL query costs by Go call stack.
//
// It is intentionally request-agnostic: it records the code path that incurred
// each DB cost, then lets profile/flamegraph tooling show the aggregate hot
// paths across the process.
type Profiler struct {
	mu          sync.Mutex
	samples     map[uint64]*sampleEntry
	sampleCount int
	freeEntries []sampleEntry
	freePCs     []uintptr
	stackPool   sync.Pool
	opts        options
	rng         atomic.Uint64
}

type options struct {
	maxStackDepth int
	sampleRate    float64
}

// Option configures a Profiler.
type Option func(*options)

// WithMaxStackDepth limits how many program counters are captured per sample.
func WithMaxStackDepth(depth int) Option {
	return func(o *options) {
		if depth > 0 {
			o.maxStackDepth = depth
		}
	}
}

// WithSampleRate records only a fraction of operations and scales values back
// up. Use this when DB TPS is high enough that stack capture overhead matters.
func WithSampleRate(rate float64) Option {
	return func(o *options) {
		if rate >= 0 && rate <= 1 {
			o.sampleRate = rate
		}
	}
}

// New creates a Profiler.
func New(opts ...Option) *Profiler {
	o := options{
		maxStackDepth: 64,
		sampleRate:    1,
	}
	for _, opt := range opts {
		opt(&o)
	}
	obs := &Profiler{samples: make(map[uint64]*sampleEntry), opts: o}
	obs.rng.Store(uint64(time.Now().UnixNano()))
	return obs
}

type measurement struct {
	obs      *Profiler
	pcs      []uintptr
	weight   float64
	finished bool
}

const callersSkip = 3 // runtime.Callers, Profiler.begin, queryTracer.TraceQueryStart.

func (o *Profiler) begin() measurement {
	if !o.enabled() {
		return measurement{}
	}
	weight, ok := o.sampleWeight()
	if !ok {
		return measurement{}
	}
	pcs := o.getStackBuffer()
	n := runtime.Callers(callersSkip, pcs)
	return measurement{obs: o, pcs: pcs[:n], weight: weight}
}

func (o *Profiler) enabled() bool {
	return o != nil && o.opts.sampleRate > 0
}

func (m *measurement) finish(d time.Duration) {
	m.finishCounts(d, 1, 0, 0)
}

func (m *measurement) finishCounts(queryDuration time.Duration, queryCount, txOpenCount, txCloseCount float64) {
	if m.obs == nil || m.finished {
		return
	}
	m.finished = true
	pcs := m.pcs
	m.pcs = nil
	defer m.obs.putStackBuffer(pcs)
	if len(pcs) == 0 {
		return
	}
	m.obs.add(
		pcs,
		queryCount*m.weight,
		float64(queryDuration.Nanoseconds())*m.weight,
		txOpenCount*m.weight,
		txCloseCount*m.weight,
	)
}

func (m *measurement) discard() {
	if m.obs == nil || m.finished {
		return
	}
	m.finished = true
	pcs := m.pcs
	m.pcs = nil
	m.obs.putStackBuffer(pcs)
}

func (o *Profiler) getStackBuffer() []uintptr {
	if v := o.stackPool.Get(); v != nil {
		pcs := v.([]uintptr)
		if cap(pcs) >= o.opts.maxStackDepth {
			return pcs[:o.opts.maxStackDepth]
		}
	}
	return make([]uintptr, o.opts.maxStackDepth)
}

func (o *Profiler) putStackBuffer(pcs []uintptr) {
	if cap(pcs) == 0 {
		return
	}
	clear(pcs[:cap(pcs)])
	o.stackPool.Put(pcs[:0])
}

func (o *Profiler) sampleWeight() (float64, bool) {
	rate := o.opts.sampleRate
	if rate <= 0 {
		return 0, false
	}
	if rate >= 1 {
		return 1, true
	}
	// Small, lock-free generator. The exact distribution is not security relevant.
	for {
		old := o.rng.Load()
		next := old*6364136223846793005 + 1442695040888963407
		if o.rng.CompareAndSwap(old, next) {
			v := float64(next>>11) / float64(uint64(1)<<53)
			if v < rate {
				return 1 / rate, true
			}
			return 0, false
		}
	}
}

func (o *Profiler) add(pcs []uintptr, queryCount, queryNanos, txOpenCount, txCloseCount float64) {
	h := sampleHash(pcs)
	o.mu.Lock()
	defer o.mu.Unlock()
	s := o.lookupSample(h, pcs)
	if s == nil {
		s = o.newSample(h, pcs)
	}
	s.Count += queryCount
	s.Nanos += queryNanos
	s.TxOpenCount += txOpenCount
	s.TxCloseCount += txCloseCount
}

func (o *Profiler) lookupSample(h uint64, pcs []uintptr) *sampleEntry {
Search:
	for s := o.samples[h]; s != nil; s = s.nextHash {
		if len(s.PCs) != len(pcs) {
			continue
		}
		for i, pc := range pcs {
			if s.PCs[i] != pc {
				continue Search
			}
		}
		return s
	}
	return nil
}

func (o *Profiler) newSample(h uint64, pcs []uintptr) *sampleEntry {
	if len(o.freeEntries) == 0 {
		o.freeEntries = make([]sampleEntry, 128)
	}
	s := &o.freeEntries[0]
	o.freeEntries = o.freeEntries[1:]
	*s = sampleEntry{}
	s.nextHash = o.samples[h]
	s.PCs = o.copyPersistentStack(pcs)
	o.samples[h] = s
	o.sampleCount++
	return s
}

func (o *Profiler) copyPersistentStack(pcs []uintptr) []uintptr {
	if len(o.freePCs) < len(pcs) {
		o.freePCs = make([]uintptr, max(1024, len(pcs)))
	}
	copyPCs := o.freePCs[:len(pcs):len(pcs)]
	o.freePCs = o.freePCs[len(pcs):]
	copy(copyPCs, pcs)
	return copyPCs
}

func sampleHash(pcs []uintptr) uint64 {
	// Same idea as godeltaprof's profMap: hash the stack and small tag set,
	// then compare full fields on collisions instead of allocating string keys.
	var h uint64 = 1469598103934665603
	for _, pc := range pcs {
		h ^= uint64(pc)
		h *= 1099511628211
	}
	return h
}

type sampleEntry struct {
	nextHash         *sampleEntry
	PCs              []uintptr
	Count            float64
	Nanos            float64
	TxOpenCount      float64
	TxCloseCount     float64
	LastCount        float64
	LastNanos        float64
	LastTxOpenCount  float64
	LastTxCloseCount float64
}

func (o *Profiler) snapshotSamples(delta bool) []sampleEntry {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	copySamples := make([]sampleEntry, 0, o.sampleCount)
	for _, bucket := range o.samples {
		for s := bucket; s != nil; s = s.nextHash {
			count := s.Count
			nanos := s.Nanos
			txOpenCount := s.TxOpenCount
			txCloseCount := s.TxCloseCount
			if delta {
				count -= s.LastCount
				nanos -= s.LastNanos
				txOpenCount -= s.LastTxOpenCount
				txCloseCount -= s.LastTxCloseCount
				s.LastCount = s.Count
				s.LastNanos = s.Nanos
				s.LastTxOpenCount = s.TxOpenCount
				s.LastTxCloseCount = s.TxCloseCount
				if count <= 0 && nanos <= 0 && txOpenCount <= 0 && txCloseCount <= 0 {
					continue
				}
			}
			copySamples = append(copySamples, sampleEntry{
				PCs:          slices.Clone(s.PCs),
				Count:        count,
				Nanos:        nanos,
				TxOpenCount:  txOpenCount,
				TxCloseCount: txCloseCount,
			})
		}
	}
	o.mu.Unlock()
	return copySamples
}

func isQueryInfrastructureFrame(frame runtime.Frame) bool {
	fn := frame.Function
	return strings.HasPrefix(fn, "github.com/redbaron/pgx-pprof.") ||
		strings.HasPrefix(fn, "database/sql.") ||
		strings.HasPrefix(fn, "github.com/jackc/pgx/")
}

func applicationFrameSeq(next func() (runtime.Frame, bool)) iter.Seq[runtime.Frame] {
	return func(yield func(runtime.Frame) bool) {
		trimLeaf := true
		for {
			frame, more := next()
			if trimLeaf && isQueryInfrastructureFrame(frame) {
				if !more {
					break
				}
				continue
			}
			trimLeaf = false
			if !yield(frame) || !more {
				break
			}
		}
	}
}

func (o *Profiler) writeDeltaPprof(w io.Writer) error {
	snapshot := o.snapshotSamples(true)
	p := &profile.Profile{
		SampleType: []*profile.ValueType{
			{Type: "db_query_count", Unit: "count"},
			{Type: "db_query_time", Unit: "nanoseconds"},
			{Type: "db_tx_open_count", Unit: "count"},
			{Type: "db_tx_close_count", Unit: "count"},
		},
		TimeNanos: time.Now().UnixNano(),
		Period:    1,
		PeriodType: &profile.ValueType{
			Type: "event", Unit: "count",
		},
	}

	funcIDs := map[string]uint64{}
	funcByID := map[uint64]*profile.Function{}
	locIDs := map[string]uint64{}
	locByID := map[uint64]*profile.Location{}
	var nextFuncID uint64 = 1
	var nextLocID uint64 = 1

	for _, s := range snapshot {
		callers := runtime.CallersFrames(s.PCs)
		locs := make([]*profile.Location, 0, len(s.PCs))
		// Frames are leaf-to-root. Trim only the contiguous pgx, database/sql,
		// and pgxpprof frames at the leaf side so the sample leaf is the
		// application callsite, while preserving the rest of the caller stack.
		for frame := range applicationFrameSeq(callers.Next) {
			funcKey := frame.Function + "\x00" + frame.File
			fid := funcIDs[funcKey]
			if fid == 0 {
				fid = nextFuncID
				nextFuncID++
				funcIDs[funcKey] = fid
				fn := &profile.Function{ID: fid, Name: frame.Function, Filename: frame.File}
				funcByID[fid] = fn
				p.Function = append(p.Function, fn)
			}

			locKey := fmt.Sprintf("%s\x00%d", funcKey, frame.Line)
			lid := locIDs[locKey]
			if lid == 0 {
				lid = nextLocID
				nextLocID++
				locIDs[locKey] = lid
				loc := &profile.Location{
					ID:   lid,
					Line: []profile.Line{{Function: funcByID[fid], Line: int64(frame.Line)}},
				}
				locByID[lid] = loc
				p.Location = append(p.Location, loc)
			}
			locs = append(locs, locByID[lid])
		}
		if len(locs) == 0 {
			continue
		}
		p.Sample = append(p.Sample, &profile.Sample{
			Location: locs,
			Value: []int64{
				roundInt64(s.Count),
				roundInt64(s.Nanos),
				roundInt64(s.TxOpenCount),
				roundInt64(s.TxCloseCount),
			},
		})
	}
	return p.Write(w)
}

func roundInt64(v float64) int64 {
	if v >= float64(math.MaxInt64) {
		return math.MaxInt64
	}
	if v <= float64(math.MinInt64) {
		return math.MinInt64
	}
	return int64(math.Round(v))
}
