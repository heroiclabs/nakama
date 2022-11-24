package nakamacluster

import (
	"context"
	"time"

	"github.com/uber-go/tally/v4"
	"go.uber.org/atomic"
)

type Metrics struct {
	cancelFn          context.CancelFunc
	snapshotRateSec   *atomic.Float64
	snapshotRecvKbSec *atomic.Float64
	snapshotSentKbSec *atomic.Float64

	currentReqCount  *atomic.Int64
	currentRecvCount *atomic.Int64
	currentRecvBytes *atomic.Int64
	currentSentBytes *atomic.Int64
	scope            tally.Scope
}

func (m *Metrics) SnapshotRateSec() float64 {
	return m.snapshotRateSec.Load()
}

func (m *Metrics) SnapshotRecvKbSec() float64 {
	return m.snapshotRecvKbSec.Load()
}

func (m *Metrics) SnapshotSentKbSec() float64 {
	return m.snapshotSentKbSec.Load()
}

func (m *Metrics) NodeJoin(value float64) {
	m.scope.Gauge("node_count").Update(value)
}

func (m *Metrics) NodeLeave(value float64) {
	m.scope.Gauge("node_count").Update(value)
}

func (m *Metrics) RecvBroadcast(recvBytes int64) {
	m.currentRecvCount.Inc()
	m.currentRecvBytes.Add(recvBytes)
	m.scope.Counter("overall_recv_bytes").Inc(recvBytes)
}

func (m *Metrics) SentBroadcast(sentBytes int64) {
	m.currentReqCount.Inc()
	m.currentSentBytes.Add(sentBytes)
	m.scope.Counter("overall_sent_bytes").Inc(sentBytes)
}

func (m *Metrics) PingMs(elapsed time.Duration) {
	m.scope.Timer("overall_ping_ms").Record(elapsed)
}

func NewMetrics(scope tally.Scope) *Metrics {
	ctx, cancelFn := context.WithCancel(context.Background())
	m := &Metrics{
		cancelFn:          cancelFn,
		snapshotRateSec:   atomic.NewFloat64(0),
		snapshotRecvKbSec: atomic.NewFloat64(0),
		snapshotSentKbSec: atomic.NewFloat64(0),

		currentRecvCount: atomic.NewInt64(0),
		currentReqCount:  atomic.NewInt64(0),
		currentRecvBytes: atomic.NewInt64(0),
		currentSentBytes: atomic.NewInt64(0),
		scope:            scope,
	}

	go func() {
		const snapshotFrequencySec = 5
		ticker := time.NewTicker(snapshotFrequencySec * time.Second)
		for {
			select {
			case <-ctx.Done():
				return

			case <-ticker.C:
				reqCount := float64(m.currentReqCount.Swap(0))
				recvBytes := float64(m.currentRecvBytes.Swap(0))
				sentBytes := float64(m.currentSentBytes.Swap(0))

				m.snapshotRateSec.Store(reqCount / snapshotFrequencySec)
				m.snapshotRecvKbSec.Store((recvBytes / 1024) / snapshotFrequencySec)
				m.snapshotSentKbSec.Store((sentBytes / 1024) / snapshotFrequencySec)
			}
		}
	}()

	return m
}
