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
	"reflect"
	"strings"
	"testing"

	monitoring "cloud.google.com/go/monitoring/apiv3"
	"github.com/golang/protobuf/ptypes/timestamp"
	distributionpb "google.golang.org/genproto/googleapis/api/distribution"
	googlemetricpb "google.golang.org/genproto/googleapis/api/metric"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
	monitoringpb "google.golang.org/genproto/googleapis/monitoring/v3"

	metricspb "github.com/census-instrumentation/opencensus-proto/gen-go/metrics/v1"
	resourcepb "github.com/census-instrumentation/opencensus-proto/gen-go/resource/v1"
)

func TestProtoResourceToMonitoringResource(t *testing.T) {
	tests := []struct {
		in   *resourcepb.Resource
		want *monitoredrespb.MonitoredResource
	}{
		{in: nil, want: &monitoredrespb.MonitoredResource{Type: "global"}},
		{in: &resourcepb.Resource{}, want: &monitoredrespb.MonitoredResource{Type: "global"}},
		{
			in: &resourcepb.Resource{
				Type: "foo",
			},
			want: &monitoredrespb.MonitoredResource{
				Type: "foo",
			},
		},
		{
			in: &resourcepb.Resource{
				Type:   "foo",
				Labels: map[string]string{},
			},
			want: &monitoredrespb.MonitoredResource{
				Type:   "foo",
				Labels: map[string]string{},
			},
		},
		{
			in: &resourcepb.Resource{
				Type:   "foo",
				Labels: map[string]string{"a": "A"},
			},
			want: &monitoredrespb.MonitoredResource{
				Type:   "foo",
				Labels: map[string]string{"a": "A"},
			},
		},
	}

	for i, tt := range tests {
		got := protoResourceToMonitoredResource(tt.in)
		if !reflect.DeepEqual(got, tt.want) {
			gj, wj := serializeAsJSON(got), serializeAsJSON(tt.want)
			if gj != wj {
				t.Errorf("#%d: Unmatched JSON\nGot:\n\t%s\nWant:\n\t%s", i, gj, wj)
			}
		}
	}
}

func TestProtoMetricToCreateTimeSeriesRequest(t *testing.T) {
	startTimestamp := &timestamp.Timestamp{
		Seconds: 1543160298,
		Nanos:   100000090,
	}
	endTimestamp := &timestamp.Timestamp{
		Seconds: 1543160298,
		Nanos:   100000997,
	}

	tests := []struct {
		in            *metricspb.Metric
		want          []*monitoringpb.CreateTimeSeriesRequest
		wantErr       string
		statsExporter *statsExporter
	}{
		{
			in: &metricspb.Metric{
				Descriptor_: &metricspb.Metric_MetricDescriptor{
					MetricDescriptor: &metricspb.MetricDescriptor{
						Name:        "with_metric_descriptor",
						Description: "This is a test",
						Unit:        "By",
					},
				},
				Timeseries: []*metricspb.TimeSeries{
					{
						StartTimestamp: startTimestamp,
						Points: []*metricspb.Point{
							{
								Timestamp: endTimestamp,
								Value: &metricspb.Point_DistributionValue{
									DistributionValue: &metricspb.DistributionValue{
										Count:                 1,
										Sum:                   11.9,
										SumOfSquaredDeviation: 0,
										Buckets: []*metricspb.DistributionValue_Bucket{
											{}, {Count: 1}, {}, {}, {},
										},
										BucketOptions: &metricspb.DistributionValue_BucketOptions{
											Type: &metricspb.DistributionValue_BucketOptions_Explicit_{
												Explicit: &metricspb.DistributionValue_BucketOptions_Explicit{
													Bounds: []float64{0, 10, 20, 30, 40},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
			statsExporter: &statsExporter{
				o: Options{ProjectID: "foo"},
			},
			want: []*monitoringpb.CreateTimeSeriesRequest{
				{
					Name: "projects/foo",
					TimeSeries: []*monitoringpb.TimeSeries{
						{
							Metric: &googlemetricpb.Metric{
								Type: "custom.googleapis.com/opencensus/with_metric_descriptor",
							},
							Resource: &monitoredrespb.MonitoredResource{
								Type: "global",
							},
							Points: []*monitoringpb.Point{
								{
									Interval: &monitoringpb.TimeInterval{
										StartTime: startTimestamp,
										EndTime:   endTimestamp,
									},
									Value: &monitoringpb.TypedValue{
										Value: &monitoringpb.TypedValue_DistributionValue{
											DistributionValue: &distributionpb.Distribution{
												Count:                 1,
												Mean:                  11.9,
												SumOfSquaredDeviation: 0,
												BucketCounts:          []int64{0, 1, 0, 0, 0},
												BucketOptions: &distributionpb.Distribution_BucketOptions{
													Options: &distributionpb.Distribution_BucketOptions_ExplicitBuckets{
														ExplicitBuckets: &distributionpb.Distribution_BucketOptions_Explicit{
															Bounds: []float64{0, 10, 20, 30, 40},
														},
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	for i, tt := range tests {
		se := tt.statsExporter
		if se == nil {
			se = new(statsExporter)
		}
		tsl, err := se.protoMetricToTimeSeries(context.Background(), nil, nil, tt.in)
		if tt.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("#%d: unmatched error. Got\n\t%v\nWant\n\t%v", i, err, tt.wantErr)
			}
			continue
		}
		if err != nil {
			t.Errorf("#%d: unexpected error: %v", i, err)
			continue
		}

		got := se.combineTimeSeriesToCreateTimeSeriesRequest(tsl)
		if !reflect.DeepEqual(got, tt.want) {
			// Our saving grace is serialization equality since some
			// unexported fields could be present in the various values.
			gj, wj := serializeAsJSON(got), serializeAsJSON(tt.want)
			if gj != wj {
				t.Errorf("#%d: Unmatched JSON\nGot:\n\t%s\nWant:\n\t%s", i, gj, wj)
			}
		}
	}
}

func TestProtoToMonitoringMetricDescriptor(t *testing.T) {
	tests := []struct {
		in      *metricspb.Metric
		want    *googlemetricpb.MetricDescriptor
		wantErr string

		statsExporter *statsExporter
	}{
		{in: nil, wantErr: "non-nil metric"},
		{
			in: &metricspb.Metric{},
			statsExporter: &statsExporter{
				o: Options{ProjectID: "test"},
			},
			want: &googlemetricpb.MetricDescriptor{
				Name:        "projects/test/metricDescriptors/custom.googleapis.com/opencensus",
				Type:        "custom.googleapis.com/opencensus",
				DisplayName: "OpenCensus",
			},
		},
		{
			in: &metricspb.Metric{
				Descriptor_: &metricspb.Metric_Name{Name: "with_name"},
			},
			statsExporter: &statsExporter{
				o: Options{ProjectID: "test"},
			},
			want: &googlemetricpb.MetricDescriptor{
				Name:        "projects/test/metricDescriptors/custom.googleapis.com/opencensus/with_name",
				Type:        "custom.googleapis.com/opencensus/with_name",
				DisplayName: "OpenCensus/with_name",
			},
		},
		{
			in: &metricspb.Metric{
				Descriptor_: &metricspb.Metric_MetricDescriptor{
					MetricDescriptor: &metricspb.MetricDescriptor{
						Name:        "with_metric_descriptor",
						Description: "This is with metric descriptor",
						Unit:        "By",
					},
				},
			},
			statsExporter: &statsExporter{
				o: Options{ProjectID: "test"},
			},
			want: &googlemetricpb.MetricDescriptor{
				Name:        "projects/test/metricDescriptors/custom.googleapis.com/opencensus/with_metric_descriptor",
				Type:        "custom.googleapis.com/opencensus/with_metric_descriptor",
				DisplayName: "OpenCensus/with_metric_descriptor",
				Description: "This is with metric descriptor",
				Unit:        "By",
			},
		},
	}

	for i, tt := range tests {
		se := tt.statsExporter
		if se == nil {
			se = new(statsExporter)
		}
		got, err := se.protoToMonitoringMetricDescriptor(tt.in)
		if tt.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("#%d: \nGot %v\nWanted error substring %q", i, err, tt.wantErr)
			}
			continue
		}

		if err != nil {
			t.Errorf("#%d: Unexpected error: %v", i, err)
			continue
		}

		if !reflect.DeepEqual(got, tt.want) {
			// Our saving grace is serialization equality since some
			// unexported fields could be present in the various values.
			gj, wj := serializeAsJSON(got), serializeAsJSON(tt.want)
			if gj != wj {
				t.Errorf("#%d: Unmatched JSON\nGot:\n\t%s\nWant:\n\t%s", i, gj, wj)
			}
		}
	}
}

func TestProtoMetricsToMonitoringMetrics_fromProtoPoint(t *testing.T) {
	startTimestamp := &timestamp.Timestamp{
		Seconds: 1543160298,
		Nanos:   100000090,
	}
	endTimestamp := &timestamp.Timestamp{
		Seconds: 1543160298,
		Nanos:   100000997,
	}

	tests := []struct {
		in      *metricspb.Point
		want    *monitoringpb.Point
		wantErr string
	}{
		{
			in: &metricspb.Point{
				Timestamp: endTimestamp,
				Value: &metricspb.Point_DistributionValue{
					DistributionValue: &metricspb.DistributionValue{
						Count:                 1,
						Sum:                   11.9,
						SumOfSquaredDeviation: 0,
						Buckets: []*metricspb.DistributionValue_Bucket{
							{}, {Count: 1}, {}, {}, {},
						},
						BucketOptions: &metricspb.DistributionValue_BucketOptions{
							Type: &metricspb.DistributionValue_BucketOptions_Explicit_{
								Explicit: &metricspb.DistributionValue_BucketOptions_Explicit{
									Bounds: []float64{0, 10, 20, 30, 40},
								},
							},
						},
					},
				},
			},
			want: &monitoringpb.Point{
				Interval: &monitoringpb.TimeInterval{
					StartTime: startTimestamp,
					EndTime:   endTimestamp,
				},
				Value: &monitoringpb.TypedValue{
					Value: &monitoringpb.TypedValue_DistributionValue{
						DistributionValue: &distributionpb.Distribution{
							Count:                 1,
							Mean:                  11.9,
							SumOfSquaredDeviation: 0,
							BucketCounts:          []int64{0, 1, 0, 0, 0},
							BucketOptions: &distributionpb.Distribution_BucketOptions{
								Options: &distributionpb.Distribution_BucketOptions_ExplicitBuckets{
									ExplicitBuckets: &distributionpb.Distribution_BucketOptions_Explicit{
										Bounds: []float64{0, 10, 20, 30, 40},
									},
								},
							},
						},
					},
				},
			},
		},
		{
			in: &metricspb.Point{
				Timestamp: endTimestamp,
				Value:     &metricspb.Point_DoubleValue{DoubleValue: 50},
			},
			want: &monitoringpb.Point{
				Interval: &monitoringpb.TimeInterval{
					StartTime: startTimestamp,
					EndTime:   endTimestamp,
				},
				Value: &monitoringpb.TypedValue{
					Value: &monitoringpb.TypedValue_DoubleValue{DoubleValue: 50},
				},
			},
		},
		{
			in: &metricspb.Point{
				Timestamp: endTimestamp,
				Value:     &metricspb.Point_Int64Value{Int64Value: 17},
			},
			want: &monitoringpb.Point{
				Interval: &monitoringpb.TimeInterval{
					StartTime: startTimestamp,
					EndTime:   endTimestamp,
				},
				Value: &monitoringpb.TypedValue{
					Value: &monitoringpb.TypedValue_Int64Value{Int64Value: 17},
				},
			},
		},
	}

	for i, tt := range tests {
		mpt, err := fromProtoPoint(startTimestamp, tt.in)
		if tt.wantErr != "" {
			continue
		}

		if err != nil {
			t.Errorf("#%d: unexpected error: %v", i, err)
			continue
		}

		if g, w := mpt, tt.want; !reflect.DeepEqual(g, w) {
			// Our saving grace is serialization equality since some
			// unexported fields could be present in the various values.
			gj, wj := serializeAsJSON(g), serializeAsJSON(w)
			if gj != wj {
				t.Errorf("#%d: Unmatched JSON\nGot:\n\t%s\nWant:\n\t%s", i, gj, wj)
			}
		}
	}
}

func TestCombineTimeSeriesAndDeduplication(t *testing.T) {
	se := new(statsExporter)

	tests := []struct {
		in   []*monitoringpb.TimeSeries
		want []*monitoringpb.CreateTimeSeriesRequest
	}{
		{
			in: []*monitoringpb.TimeSeries{
				{
					Metric: &googlemetricpb.Metric{
						Type: "a/b/c",
					},
				},
				{
					Metric: &googlemetricpb.Metric{
						Type: "a/b/c",
					},
				},
				{
					Metric: &googlemetricpb.Metric{
						Type: "A/b/c",
					},
				},
				{
					Metric: &googlemetricpb.Metric{
						Type: "a/b/c",
					},
				},
				{
					Metric: &googlemetricpb.Metric{
						Type: "X/Y/Z",
					},
				},
			},
			want: []*monitoringpb.CreateTimeSeriesRequest{
				{
					Name: monitoring.MetricProjectPath(se.o.ProjectID),
					TimeSeries: []*monitoringpb.TimeSeries{
						{
							Metric: &googlemetricpb.Metric{
								Type: "a/b/c",
							},
						},
						{
							Metric: &googlemetricpb.Metric{
								Type: "A/b/c",
							},
						},
						{
							Metric: &googlemetricpb.Metric{
								Type: "X/Y/Z",
							},
						},
					},
				},
				{
					Name: monitoring.MetricProjectPath(se.o.ProjectID),
					TimeSeries: []*monitoringpb.TimeSeries{
						{
							Metric: &googlemetricpb.Metric{
								Type: "a/b/c",
							},
						},
					},
				},
				{
					Name: monitoring.MetricProjectPath(se.o.ProjectID),
					TimeSeries: []*monitoringpb.TimeSeries{
						{
							Metric: &googlemetricpb.Metric{
								Type: "a/b/c",
							},
						},
					},
				},
			},
		},
	}

	for i, tt := range tests {
		got := se.combineTimeSeriesToCreateTimeSeriesRequest(tt.in)
		want := tt.want
		if !reflect.DeepEqual(got, want) {
			gj, wj := serializeAsJSON(got), serializeAsJSON(want)
			if gj != wj {
				t.Errorf("#%d: Unmatched JSON\nGot:\n\t%s\nWant:\n\t%s", i, gj, wj)
			}
		}
	}
}

func serializeAsJSON(v interface{}) string {
	blob, _ := json.MarshalIndent(v, "", "  ")
	return string(blob)
}
