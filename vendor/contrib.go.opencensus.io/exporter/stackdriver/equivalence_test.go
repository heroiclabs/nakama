// Copyright 2018, OpenCensus Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package stackdriver

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"reflect"
	"sync"
	"testing"
	"time"

	"contrib.go.opencensus.io/exporter/ocagent"
	"go.opencensus.io/exemplar"
	"go.opencensus.io/stats"
	"go.opencensus.io/stats/view"
	"google.golang.org/api/option"
	"google.golang.org/grpc"

	agentmetricspb "github.com/census-instrumentation/opencensus-proto/gen-go/agent/metrics/v1"
	"github.com/golang/protobuf/ptypes/empty"
	googlemetricpb "google.golang.org/genproto/googleapis/api/metric"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
	monitoringpb "google.golang.org/genproto/googleapis/monitoring/v3"
)

func TestStatsAndMetricsEquivalence(t *testing.T) {
	ma, addr, stop := createMockAgent(t)
	defer stop()

	oce, err := ocagent.NewExporter(ocagent.WithInsecure(),
		ocagent.WithAddress(addr),
		ocagent.WithReconnectionPeriod(1*time.Millisecond))
	if err != nil {
		t.Fatalf("Failed to create the ocagent exporter: %v", err)
	}
	time.Sleep(5 * time.Millisecond)

	startTime := time.Date(2018, 11, 25, 15, 38, 18, 997, time.UTC)
	mLatencyMs := stats.Float64("latency", "The latency for various methods", "ms")

	// Generate the view.Data.
	var vdl []*view.Data
	for i := 0; i < 100; i++ {
		vdl = append(vdl, &view.Data{
			Start: startTime,
			End:   startTime.Add(time.Duration(1+i) * time.Second),
			View: &view.View{
				Name:        "ocagent.io/latency",
				Description: "The latency of the various methods",
				Aggregation: view.Count(),
				Measure:     mLatencyMs,
			},
			Rows: []*view.Row{
				{
					Data: &view.CountData{Value: int64(4 * (i + 2))},
				},
			},
		})
	}

	// Now perform some exporting.
	for i, vd := range vdl {
		oce.ExportView(vd)
		oce.Flush()

		time.Sleep(30 * time.Millisecond)
		oce.Flush()

		var last *agentmetricspb.ExportMetricsServiceRequest
		ma.forEachRequest(func(emr *agentmetricspb.ExportMetricsServiceRequest) {
			last = emr
		})

		if last == nil || len(last.Metrics) == 0 {
			t.Errorf("#%d: Failed to retrieve any metrics", i)
			continue
		}

		se := &statsExporter{
			o: Options{ProjectID: "equivalence"},
		}

		ctx := context.Background()
		sMD, err := se.viewToMetricDescriptor(ctx, vd.View)
		if err != nil {
			t.Errorf("#%d: Stats.viewToMetricDescriptor: %v", i, err)
		}
		pMD, err := se.protoMetricDescriptorToCreateMetricDescriptorRequest(ctx, last.Metrics[0])
		if err != nil {
			t.Errorf("#%d: Stats.protoMetricDescriptorToMetricDescriptor: %v", i, err)
		}
		if !reflect.DeepEqual(sMD, pMD) {
			t.Errorf("MetricDescriptor Mismatch\nStats MetricDescriptor:\n\t%v\nProto MetricDescriptor:\n\t%v\n", sMD, pMD)
		}

		vdl := []*view.Data{vd}
		sctreql := se.makeReq(vdl, maxTimeSeriesPerUpload)
		tsl, _ := se.protoMetricToTimeSeries(ctx, last.Node, last.Resource, last.Metrics[0])
		pctreql := se.combineTimeSeriesToCreateTimeSeriesRequest(tsl)
		if !reflect.DeepEqual(sctreql, pctreql) {
			t.Errorf("#%d: TimeSeries Mismatch\nStats CreateTimeSeriesRequest:\n\t%v\nProto CreateTimeSeriesRequest:\n\t%v\n",
				i, sctreql, pctreql)
		}
	}
}

// This test creates and uses a "Stackdriver backend" which receives
// CreateTimeSeriesRequest and CreateMetricDescriptor requests
// that the Stackdriver Metrics Proto client then sends to, as it would
// send to Google Stackdriver backends.
//
// This test ensures that the final responses sent by direct stats(view.Data) exporting
// are exactly equal to those from view.Data-->OpenCensus-Proto.Metrics exporting.
func TestEquivalenceStatsVsMetricsUploads(t *testing.T) {
	ma, addr, doneFn := createMockAgent(t)
	defer doneFn()

	// Now create a gRPC connection to the agent.
	conn, err := grpc.Dial(addr, grpc.WithInsecure())
	if err != nil {
		t.Fatalf("Failed to make a gRPC connection to the agent: %v", err)
	}
	defer conn.Close()

	// Finally create the OpenCensus stats exporter
	exporterOptions := Options{
		ProjectID:               "equivalence",
		MonitoringClientOptions: []option.ClientOption{option.WithGRPCConn(conn)},

		// Setting this time delay threshold to a very large value
		// so that batching is performed deterministically and flushing is
		// fully controlled by us.
		BundleDelayThreshold: 2 * time.Hour,
	}
	se, err := newStatsExporter(exporterOptions)
	if err != nil {
		t.Fatalf("Failed to create the statsExporter: %v", err)
	}

	startTime := time.Date(2019, 1, 16, 15, 04, 23, 73, time.UTC)
	mLatencyMs := stats.Float64("latency", "The latency for various methods", "ms")
	mConnections := stats.Float64("connections", "The count of various connections at a point in time", "1")
	mTimeMs := stats.Float64("time", "Counts time in milliseconds", "ms")

	// Generate the view.Data.
	var vdl []*view.Data
	for i := 0; i < 10; i++ {
		vdl = append(vdl,
			&view.Data{
				Start: startTime,
				End:   startTime.Add(time.Duration(1+i) * time.Second),
				View: &view.View{
					Name:        "ocagent.io/calls",
					Description: "The number of the various calls",
					Aggregation: view.Count(),
					Measure:     mLatencyMs,
				},
				Rows: []*view.Row{
					{
						Data: &view.CountData{Value: int64(4 * (i + 2))},
					},
				},
			},
			&view.Data{
				Start: startTime,
				End:   startTime.Add(time.Duration(2+i) * time.Second),
				View: &view.View{
					Name:        "ocagent.io/latency",
					Description: "The latency of the various methods",
					Aggregation: view.Distribution(0, 100, 500, 1000, 2000, 4000, 8000, 16000),
					Measure:     mLatencyMs,
				},
				Rows: []*view.Row{
					{
						Data: &view.DistributionData{
							Count:          1,
							Min:            100,
							Max:            500,
							Mean:           125.9,
							CountPerBucket: []int64{0, 0, 1, 0, 0, 0, 0, 0},
							ExemplarsPerBucket: []*exemplar.Exemplar{
								nil, nil,
								{
									Value: 125.9, Timestamp: startTime.Add(time.Duration(1+i) * time.Second),
								},
								nil, nil, nil, nil, nil,
							},
						},
					},
				},
			},
			&view.Data{
				Start: startTime,
				End:   startTime.Add(time.Duration(3+i) * time.Second),
				View: &view.View{
					Name:        "ocagent.io/connections",
					Description: "The count of various connections instantaneously",
					Aggregation: view.LastValue(),
					Measure:     mConnections,
				},
				Rows: []*view.Row{
					{Data: &view.LastValueData{Value: 99}},
				},
			},
			&view.Data{
				Start: startTime,
				End:   startTime.Add(time.Duration(1+i) * time.Second),
				View: &view.View{
					Name:        "ocagent.io/uptime",
					Description: "The total uptime at any instance",
					Aggregation: view.Sum(),
					Measure:     mTimeMs,
				},
				Rows: []*view.Row{
					{Data: &view.SumData{Value: 199903.97}},
				},
			})
	}

	for _, vd := range vdl {
		// Export the view.Data to the Stackdriver backend.
		se.ExportView(vd)
	}
	se.Flush()

	// Examining the stackdriver metrics that are available.
	var stackdriverTimeSeriesFromStats []*monitoringpb.CreateTimeSeriesRequest
	ma.forEachStackdriverTimeSeries(func(sdt *monitoringpb.CreateTimeSeriesRequest) {
		stackdriverTimeSeriesFromStats = append(stackdriverTimeSeriesFromStats, sdt)
	})
	var stackdriverMetricDescriptorsFromStats []*monitoringpb.CreateMetricDescriptorRequest
	ma.forEachStackdriverMetricDescriptor(func(sdmd *monitoringpb.CreateMetricDescriptorRequest) {
		stackdriverMetricDescriptorsFromStats = append(stackdriverMetricDescriptorsFromStats, sdmd)
	})

	// Reset the stackdriverTimeSeries to enable fresh collection
	// and then comparison with the results from metrics uploads.
	ma.resetStackdriverTimeSeries()
	ma.resetStackdriverMetricDescriptors()

	// Now for the metrics sent by the metrics exporter.
	oce, err := ocagent.NewExporter(ocagent.WithInsecure(),
		ocagent.WithAddress(addr),
		ocagent.WithReconnectionPeriod(1*time.Millisecond))
	if err != nil {
		t.Fatalf("Failed to create the ocagent exporter: %v", err)
	}
	time.Sleep(5 * time.Millisecond)

	for _, vd := range vdl {
		// Perform the view.Data --> metricspb.Metric transformation.
		oce.ExportView(vd)
		oce.Flush()
		time.Sleep(2 * time.Millisecond)
	}
	oce.Flush()

	ma.forEachRequest(func(emr *agentmetricspb.ExportMetricsServiceRequest) {
		for _, metric := range emr.Metrics {
			_ = se.ExportMetric(context.Background(), emr.Node, emr.Resource, metric)
		}
	})
	se.Flush()

	var stackdriverTimeSeriesFromMetrics []*monitoringpb.CreateTimeSeriesRequest
	ma.forEachStackdriverTimeSeries(func(sdt *monitoringpb.CreateTimeSeriesRequest) {
		stackdriverTimeSeriesFromMetrics = append(stackdriverTimeSeriesFromMetrics, sdt)
	})
	var stackdriverMetricDescriptorsFromMetrics []*monitoringpb.CreateMetricDescriptorRequest
	ma.forEachStackdriverMetricDescriptor(func(sdmd *monitoringpb.CreateMetricDescriptorRequest) {
		stackdriverMetricDescriptorsFromMetrics = append(stackdriverMetricDescriptorsFromMetrics, sdmd)
	})

	// The results should be equal now
	if !reflect.DeepEqual(stackdriverTimeSeriesFromMetrics, stackdriverTimeSeriesFromStats) {
		blobFromMetrics := jsonBlob(stackdriverTimeSeriesFromMetrics)
		blobFromStats := jsonBlob(stackdriverTimeSeriesFromStats)
		t.Errorf("StackdriverTimeSeriesFromMetrics (%d):\n%s\n\nStackdriverTimeSeriesFromStats (%d):\n%s\n\n",
			len(stackdriverTimeSeriesFromMetrics), blobFromMetrics,
			len(stackdriverTimeSeriesFromStats), blobFromStats)
	}

	// Examining the metric descriptors too.
	if !reflect.DeepEqual(stackdriverMetricDescriptorsFromMetrics, stackdriverMetricDescriptorsFromStats) {
		t.Errorf("StackdriverMetricDescriptorsFromMetrics:\n%v\nStackdriverMetricDescriptors:\n%v\n\n",
			stackdriverMetricDescriptorsFromMetrics, stackdriverMetricDescriptorsFromStats)
	}
}

type metricsAgent struct {
	mu                           sync.RWMutex
	metrics                      []*agentmetricspb.ExportMetricsServiceRequest
	stackdriverTimeSeries        []*monitoringpb.CreateTimeSeriesRequest
	stackdriverMetricDescriptors []*monitoringpb.CreateMetricDescriptorRequest
}

func createMockAgent(t *testing.T) (*metricsAgent, string, func()) {
	ln, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatalf("Failed to bind to an available address: %v", err)
	}
	ma := new(metricsAgent)
	srv := grpc.NewServer()
	agentmetricspb.RegisterMetricsServiceServer(srv, ma)
	monitoringpb.RegisterMetricServiceServer(srv, ma)
	go func() {
		_ = srv.Serve(ln)
	}()
	stop := func() {
		srv.Stop()
		_ = ln.Close()
	}
	_, agentPortStr, _ := net.SplitHostPort(ln.Addr().String())
	return ma, ":" + agentPortStr, stop
}

func (ma *metricsAgent) Export(mes agentmetricspb.MetricsService_ExportServer) error {
	// Expecting the first message to contain the Node information
	firstMetric, err := mes.Recv()
	if err != nil {
		return err
	}

	if firstMetric == nil || firstMetric.Node == nil {
		return errors.New("Expecting a non-nil Node in the first message")
	}

	ma.addMetric(firstMetric)

	for {
		msg, err := mes.Recv()
		if err != nil {
			return err
		}
		ma.addMetric(msg)
	}
}

func (ma *metricsAgent) addMetric(metric *agentmetricspb.ExportMetricsServiceRequest) {
	ma.mu.Lock()
	ma.metrics = append(ma.metrics, metric)
	ma.mu.Unlock()
}

func (ma *metricsAgent) forEachRequest(fn func(*agentmetricspb.ExportMetricsServiceRequest)) {
	ma.mu.RLock()
	defer ma.mu.RUnlock()

	for _, req := range ma.metrics {
		fn(req)
	}
}

func (ma *metricsAgent) forEachStackdriverTimeSeries(fn func(sdt *monitoringpb.CreateTimeSeriesRequest)) {
	ma.mu.RLock()
	defer ma.mu.RUnlock()

	for _, sdt := range ma.stackdriverTimeSeries {
		fn(sdt)
	}
}

func (ma *metricsAgent) forEachStackdriverMetricDescriptor(fn func(sdmd *monitoringpb.CreateMetricDescriptorRequest)) {
	ma.mu.RLock()
	defer ma.mu.RUnlock()

	for _, sdmd := range ma.stackdriverMetricDescriptors {
		fn(sdmd)
	}
}

func (ma *metricsAgent) resetStackdriverTimeSeries() {
	ma.mu.Lock()
	ma.stackdriverTimeSeries = ma.stackdriverTimeSeries[:0]
	ma.mu.Unlock()
}

func (ma *metricsAgent) resetStackdriverMetricDescriptors() {
	ma.mu.Lock()
	ma.stackdriverMetricDescriptors = ma.stackdriverMetricDescriptors[:0]
	ma.mu.Unlock()
}

var _ monitoringpb.MetricServiceServer = (*metricsAgent)(nil)

func (ma *metricsAgent) GetMetricDescriptor(ctx context.Context, req *monitoringpb.GetMetricDescriptorRequest) (*googlemetricpb.MetricDescriptor, error) {
	return new(googlemetricpb.MetricDescriptor), nil
}

func (ma *metricsAgent) CreateMetricDescriptor(ctx context.Context, req *monitoringpb.CreateMetricDescriptorRequest) (*googlemetricpb.MetricDescriptor, error) {
	ma.mu.Lock()
	ma.stackdriverMetricDescriptors = append(ma.stackdriverMetricDescriptors, req)
	ma.mu.Unlock()
	return req.MetricDescriptor, nil
}

func (ma *metricsAgent) CreateTimeSeries(ctx context.Context, req *monitoringpb.CreateTimeSeriesRequest) (*empty.Empty, error) {
	ma.mu.Lock()
	ma.stackdriverTimeSeries = append(ma.stackdriverTimeSeries, req)
	ma.mu.Unlock()
	return new(empty.Empty), nil
}

func (ma *metricsAgent) ListTimeSeries(ctx context.Context, req *monitoringpb.ListTimeSeriesRequest) (*monitoringpb.ListTimeSeriesResponse, error) {
	return new(monitoringpb.ListTimeSeriesResponse), nil
}

func (ma *metricsAgent) DeleteMetricDescriptor(ctx context.Context, req *monitoringpb.DeleteMetricDescriptorRequest) (*empty.Empty, error) {
	return new(empty.Empty), nil
}

func (ma *metricsAgent) ListMetricDescriptors(ctx context.Context, req *monitoringpb.ListMetricDescriptorsRequest) (*monitoringpb.ListMetricDescriptorsResponse, error) {
	return new(monitoringpb.ListMetricDescriptorsResponse), nil
}

func (ma *metricsAgent) GetMonitoredResourceDescriptor(ctx context.Context, req *monitoringpb.GetMonitoredResourceDescriptorRequest) (*monitoredrespb.MonitoredResourceDescriptor, error) {
	return new(monitoredrespb.MonitoredResourceDescriptor), nil
}

func (ma *metricsAgent) ListMonitoredResourceDescriptors(ctx context.Context, req *monitoringpb.ListMonitoredResourceDescriptorsRequest) (*monitoringpb.ListMonitoredResourceDescriptorsResponse, error) {
	return new(monitoringpb.ListMonitoredResourceDescriptorsResponse), nil
}

func jsonBlob(v interface{}) []byte {
	blob, _ := json.MarshalIndent(v, "", "   ")
	return blob
}
