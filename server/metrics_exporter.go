// Copyright 2019 The Nakama Authors
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
	"go.opencensus.io/plugin/ocgrpc"
	"go.opencensus.io/stats/view"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type MetricsExporter struct {
	logger *zap.Logger

	Latency *atomic.Float64
	Rate    *atomic.Float64
	Input   *atomic.Float64
	Output  *atomic.Float64
}

func NewMetricsExporter(logger *zap.Logger) *MetricsExporter {
	return &MetricsExporter{
		logger: logger,

		Latency: atomic.NewFloat64(0),
		Rate:    atomic.NewFloat64(0),
		Input:   atomic.NewFloat64(0),
		Output:  atomic.NewFloat64(0),
	}
}

func (m *MetricsExporter) ExportView(vd *view.Data) {
	windowSec := float64(vd.End.Unix() - vd.Start.Unix())
	if windowSec <= 0 {
		return
	}

	switch vd.View {
	case ocgrpc.ServerLatencyView:
		var count, mean float64
		for _, row := range vd.Rows {
			rdd, ok := row.Data.(*view.DistributionData)
			if !ok {
				m.logger.Warn("Error casting metrics view row data.", zap.String("view", ocgrpc.ServerLatencyView.Name))
				continue
			}
			c := float64(rdd.Count)
			if c == 0 {
				continue
			}
			count, mean = c+count, (c*rdd.Mean+count*mean)/(c+count)
		}
		// Average latency across all requests for all handlers.
		m.Latency.Store(mean)
	case ocgrpc.ServerCompletedRPCsView:
		var count int64
		for _, row := range vd.Rows {
			rcd, ok := row.Data.(*view.CountData)
			if !ok {
				m.logger.Warn("Error casting metrics view row data.", zap.String("view", ocgrpc.ServerCompletedRPCsView.Name))
				continue
			}
			count += rcd.Value
			//for _, t := range row.Tags {
			//	if t.Key.Name() == ocgrpc.KeyServerStatus.Name() && t.Value != codes.OK.String() {
			//		// If error counts are ever needed this is how they're exposed.
			//	}
			//}
		}
		m.Rate.Store(float64(count) / windowSec)
	case ocgrpc.ServerReceivedBytesPerRPCView:
		var total float64
		for _, row := range vd.Rows {
			rdd, ok := row.Data.(*view.DistributionData)
			if !ok {
				m.logger.Warn("Error casting metrics view row data.", zap.String("view", ocgrpc.ServerCompletedRPCsView.Name))
				continue
			}
			total += rdd.Mean * float64(rdd.Count)
		}
		m.Input.Store(total / 1024 / windowSec)
	case ocgrpc.ServerSentBytesPerRPCView:
		var total float64
		for _, row := range vd.Rows {
			rdd, ok := row.Data.(*view.DistributionData)
			if !ok {
				m.logger.Warn("Error casting metrics view row data.", zap.String("view", ocgrpc.ServerCompletedRPCsView.Name))
				continue
			}
			total += rdd.Mean * float64(rdd.Count)
		}
		m.Output.Store(total / 1024 / windowSec)
	}
}
