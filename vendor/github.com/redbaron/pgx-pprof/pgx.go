package pgxpprof

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type queryTraceKey struct{}
type batchTraceKey struct{}

type queryTracer struct {
	obs      *Profiler
	queryKey *queryTraceKey
	batchKey *batchTraceKey
}

type queryTrace struct {
	measurement measurement
	start       time.Time
	txOpenCount float64
}

type batchTrace struct {
	measurement measurement
	start       time.Time
	queued      int
	seen        float64
	txOpenCount float64
}

var _ pgx.BatchTracer = (*queryTracer)(nil)

func (t *queryTracer) TraceQueryStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if !t.obs.enabled() {
		return ctx
	}
	trace := queryTrace{
		measurement: t.obs.begin(),
		start:       time.Now(),
	}
	if conn.PgConn().TxStatus() == 'I' {
		trace.txOpenCount = 1
	}
	return context.WithValue(ctx, t.queryKey, &trace)
}

func (t *queryTracer) TraceQueryEnd(ctx context.Context, conn *pgx.Conn, _ pgx.TraceQueryEndData) {
	trace, ok := ctx.Value(t.queryKey).(*queryTrace)
	if !ok {
		return
	}
	d := time.Since(trace.start)
	txCloseCount := float64(0)
	if conn.PgConn().TxStatus() == 'I' {
		txCloseCount = 1
	}
	trace.measurement.finishCounts(d, 1, trace.txOpenCount, txCloseCount)
}

func (t *queryTracer) TraceBatchStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceBatchStartData) context.Context {
	if !t.obs.enabled() || data.Batch == nil {
		return ctx
	}
	trace := batchTrace{
		measurement: t.obs.begin(),
		start:       time.Now(),
		queued:      data.Batch.Len(),
	}
	if conn.PgConn().TxStatus() == 'I' {
		trace.txOpenCount = 1
	}
	return context.WithValue(ctx, t.batchKey, &trace)
}

func (t *queryTracer) TraceBatchQuery(ctx context.Context, _ *pgx.Conn, _ pgx.TraceBatchQueryData) {
	trace, ok := ctx.Value(t.batchKey).(*batchTrace)
	if !ok {
		return
	}
	if int(trace.seen) < trace.queued {
		trace.seen++
	}
}

func (t *queryTracer) TraceBatchEnd(ctx context.Context, conn *pgx.Conn, _ pgx.TraceBatchEndData) {
	trace, ok := ctx.Value(t.batchKey).(*batchTrace)
	if !ok {
		return
	}
	if trace.seen == 0 {
		trace.measurement.discard()
		return
	}
	txCloseCount := float64(0)
	if conn.PgConn().TxStatus() == 'I' {
		txCloseCount = 1
	}
	trace.measurement.finishCounts(time.Since(trace.start), trace.seen, trace.txOpenCount, txCloseCount)
}

// QueryTracer returns a pgx QueryTracer that records query costs into obs. The
// returned tracer also implements pgx.BatchTracer for SendBatch calls. Install
// it on pgx.ConnConfig.Tracer before creating connections or pools.
func QueryTracer(obs *Profiler) pgx.QueryTracer {
	return &queryTracer{obs: obs, queryKey: &queryTraceKey{}, batchKey: &batchTraceKey{}}
}
