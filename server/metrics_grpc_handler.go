// Copyright 2020 The Nakama Authors
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
	"context"
	"sync/atomic"
	"time"

	"google.golang.org/grpc/stats"
)

type ctxMetricsGrpcHandlerKey struct{}

type metricsGrpcHandlerData struct {
	fullMethodName string
	recvBytes      int64
	sentBytes      int64
}

type MetricsGrpcHandler struct {
	MetricsFn func(name string, elapsed time.Duration, recvBytes, sentBytes int64, isErr bool)
	Metrics   Metrics
}

// TagRPC can attach some information to the given context.
// The context used for the rest lifetime of the RPC will be derived from
// the returned context.
func (m *MetricsGrpcHandler) TagRPC(ctx context.Context, info *stats.RPCTagInfo) context.Context {
	return context.WithValue(ctx, ctxMetricsGrpcHandlerKey{}, &metricsGrpcHandlerData{fullMethodName: info.FullMethodName})
}

// HandleRPC processes the RPC stats.
func (m *MetricsGrpcHandler) HandleRPC(ctx context.Context, rs stats.RPCStats) {
	data, ok := ctx.Value(ctxMetricsGrpcHandlerKey{}).(*metricsGrpcHandlerData)
	if ok {
		switch rs := rs.(type) {
		case *stats.Begin:
			// No-op.
		case *stats.InPayload:
			atomic.AddInt64(&data.recvBytes, int64(rs.WireLength))
		case *stats.OutPayload:
			atomic.AddInt64(&data.sentBytes, int64(rs.WireLength))
		case *stats.End:
			m.MetricsFn(data.fullMethodName, rs.EndTime.Sub(rs.BeginTime), data.recvBytes, data.sentBytes, rs.Error != nil)
		}
	} else {
		m.Metrics.CountUntaggedGrpcStatsCalls(1)
	}
}

// TagConn can attach some information to the given context.
// The returned context will be used for stats handling.
// For conn stats handling, the context used in HandleConn for this
// connection will be derived from the context returned.
// For RPC stats handling,
//   - On server side, the context used in HandleRPC for all RPCs on this
//
// connection will be derived from the context returned.
//   - On client side, the context is not derived from the context returned.
func (m *MetricsGrpcHandler) TagConn(ctx context.Context, _ *stats.ConnTagInfo) context.Context {
	return ctx
}

// HandleConn processes the Conn stats.
func (m *MetricsGrpcHandler) HandleConn(context.Context, stats.ConnStats) {}
