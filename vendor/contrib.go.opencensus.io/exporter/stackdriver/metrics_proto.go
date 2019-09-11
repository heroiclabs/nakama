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

/*
The code in this file is responsible for converting OpenCensus Proto metrics
directly to Stackdriver Metrics.
*/

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"

	"go.opencensus.io/resource"

	commonpb "github.com/census-instrumentation/opencensus-proto/gen-go/agent/common/v1"
	metricspb "github.com/census-instrumentation/opencensus-proto/gen-go/metrics/v1"
	resourcepb "github.com/census-instrumentation/opencensus-proto/gen-go/resource/v1"
	timestamppb "github.com/golang/protobuf/ptypes/timestamp"
	distributionpb "google.golang.org/genproto/googleapis/api/distribution"
	labelpb "google.golang.org/genproto/googleapis/api/label"
	googlemetricpb "google.golang.org/genproto/googleapis/api/metric"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
	monitoringpb "google.golang.org/genproto/googleapis/monitoring/v3"
)

var errNilMetricOrMetricDescriptor = errors.New("non-nil metric or metric descriptor")
var percentileLabelKey = &metricspb.LabelKey{
	Key:         "percentile",
	Description: "the value at a given percentile of a distribution",
}
var globalResource = &resource.Resource{Type: "global"}
var domains = []string{"googleapis.com", "kubernetes.io", "istio.io"}

// PushMetricsProto exports OpenCensus Metrics Proto to Stackdriver Monitoring synchronously,
// without de-duping or adding proto metrics to the bundler.
func (se *statsExporter) PushMetricsProto(ctx context.Context, node *commonpb.Node, rsc *resourcepb.Resource, metrics []*metricspb.Metric) (int, error) {
	if len(metrics) == 0 {
		return 0, errNilMetricOrMetricDescriptor
	}

	ctx, cancel := newContextWithTimeout(ctx, se.o.Timeout)
	defer cancel()

	// Caches the resources seen so far
	seenResources := make(map[*resourcepb.Resource]*monitoredrespb.MonitoredResource)

	mb := newMetricsBatcher(se.o.ProjectID)
	for _, metric := range metrics {
		if len(metric.GetTimeseries()) == 0 {
			// No TimeSeries to export, skip this metric.
			continue
		}
		mappedRsc := se.getResource(rsc, metric, seenResources)
		if metric.GetMetricDescriptor().GetType() == metricspb.MetricDescriptor_SUMMARY {
			summaryMtcs := se.convertSummaryMetrics(metric)
			for _, summaryMtc := range summaryMtcs {
				if err := se.createMetricDescriptor(ctx, summaryMtc); err != nil {
					mb.recordDroppedTimeseries(len(summaryMtc.GetTimeseries()), err)
					continue
				}
				se.protoMetricToTimeSeries(ctx, mappedRsc, summaryMtc, mb)
			}
		} else {
			if err := se.createMetricDescriptor(ctx, metric); err != nil {
				mb.recordDroppedTimeseries(len(metric.GetTimeseries()), err)
				continue
			}
			se.protoMetricToTimeSeries(ctx, mappedRsc, metric, mb)
		}
	}

	mb.export(ctx, se.c)
	return mb.droppedTimeSeries, mb.finalError()
}

func (se *statsExporter) convertSummaryMetrics(summary *metricspb.Metric) []*metricspb.Metric {
	var metrics []*metricspb.Metric
	var percentileTss []*metricspb.TimeSeries
	var countTss []*metricspb.TimeSeries
	var sumTss []*metricspb.TimeSeries

	for _, ts := range summary.Timeseries {
		lvs := ts.GetLabelValues()

		startTime := ts.StartTimestamp
		for _, pt := range ts.GetPoints() {
			ptTimestamp := pt.GetTimestamp()
			summaryValue := pt.GetSummaryValue()
			if summaryValue.Sum != nil {
				sumTs := &metricspb.TimeSeries{
					LabelValues:    lvs,
					StartTimestamp: startTime,
					Points: []*metricspb.Point{
						{
							Value: &metricspb.Point_DoubleValue{
								DoubleValue: summaryValue.Sum.Value,
							},
							Timestamp: ptTimestamp,
						},
					},
				}
				sumTss = append(sumTss, sumTs)
			}

			if summaryValue.Count != nil {
				countTs := &metricspb.TimeSeries{
					LabelValues:    lvs,
					StartTimestamp: startTime,
					Points: []*metricspb.Point{
						{
							Value: &metricspb.Point_Int64Value{
								Int64Value: summaryValue.Count.Value,
							},
							Timestamp: ptTimestamp,
						},
					},
				}
				countTss = append(countTss, countTs)
			}

			snapshot := summaryValue.GetSnapshot()
			for _, percentileValue := range snapshot.GetPercentileValues() {
				lvsWithPercentile := lvs[0:]
				lvsWithPercentile = append(lvsWithPercentile, &metricspb.LabelValue{
					Value: fmt.Sprintf("%f", percentileValue.Percentile),
				})
				percentileTs := &metricspb.TimeSeries{
					LabelValues:    lvsWithPercentile,
					StartTimestamp: nil,
					Points: []*metricspb.Point{
						{
							Value: &metricspb.Point_DoubleValue{
								DoubleValue: percentileValue.Value,
							},
							Timestamp: ptTimestamp,
						},
					},
				}
				percentileTss = append(percentileTss, percentileTs)
			}
		}

		if len(sumTss) > 0 {
			metric := &metricspb.Metric{
				MetricDescriptor: &metricspb.MetricDescriptor{
					Name:        fmt.Sprintf("%s_summary_sum", summary.GetMetricDescriptor().GetName()),
					Description: summary.GetMetricDescriptor().GetDescription(),
					Type:        metricspb.MetricDescriptor_CUMULATIVE_DOUBLE,
					Unit:        summary.GetMetricDescriptor().GetUnit(),
					LabelKeys:   summary.GetMetricDescriptor().GetLabelKeys(),
				},
				Timeseries: sumTss,
				Resource:   summary.Resource,
			}
			metrics = append(metrics, metric)
		}
		if len(countTss) > 0 {
			metric := &metricspb.Metric{
				MetricDescriptor: &metricspb.MetricDescriptor{
					Name:        fmt.Sprintf("%s_summary_count", summary.GetMetricDescriptor().GetName()),
					Description: summary.GetMetricDescriptor().GetDescription(),
					Type:        metricspb.MetricDescriptor_CUMULATIVE_INT64,
					Unit:        "1",
					LabelKeys:   summary.GetMetricDescriptor().GetLabelKeys(),
				},
				Timeseries: countTss,
				Resource:   summary.Resource,
			}
			metrics = append(metrics, metric)
		}
		if len(percentileTss) > 0 {
			lks := summary.GetMetricDescriptor().GetLabelKeys()[0:]
			lks = append(lks, percentileLabelKey)
			metric := &metricspb.Metric{
				MetricDescriptor: &metricspb.MetricDescriptor{
					Name:        fmt.Sprintf("%s_summary_percentile", summary.GetMetricDescriptor().GetName()),
					Description: summary.GetMetricDescriptor().GetDescription(),
					Type:        metricspb.MetricDescriptor_GAUGE_DOUBLE,
					Unit:        summary.GetMetricDescriptor().GetUnit(),
					LabelKeys:   lks,
				},
				Timeseries: percentileTss,
				Resource:   summary.Resource,
			}
			metrics = append(metrics, metric)
		}
	}
	return metrics
}

func (se *statsExporter) getResource(rsc *resourcepb.Resource, metric *metricspb.Metric, seenRscs map[*resourcepb.Resource]*monitoredrespb.MonitoredResource) *monitoredrespb.MonitoredResource {
	var resource = rsc
	if metric.Resource != nil {
		resource = metric.Resource
	}
	mappedRsc, ok := seenRscs[resource]
	if !ok {
		mappedRsc = se.o.MapResource(resourcepbToResource(resource))
		seenRscs[resource] = mappedRsc
	}
	return mappedRsc
}

func resourcepbToResource(rsc *resourcepb.Resource) *resource.Resource {
	if rsc == nil {
		return globalResource
	}
	res := &resource.Resource{
		Type:   rsc.Type,
		Labels: make(map[string]string, len(rsc.Labels)),
	}

	for k, v := range rsc.Labels {
		res.Labels[k] = v
	}
	return res
}

// protoMetricToTimeSeries converts a metric into a Stackdriver Monitoring v3 API CreateTimeSeriesRequest
// but it doesn't invoke any remote API.
func (se *statsExporter) protoMetricToTimeSeries(ctx context.Context, mappedRsc *monitoredrespb.MonitoredResource, metric *metricspb.Metric, mb *metricsBatcher) {
	if metric == nil || metric.MetricDescriptor == nil {
		mb.recordDroppedTimeseries(len(metric.GetTimeseries()), errNilMetricOrMetricDescriptor)
	}

	metricName := metric.GetMetricDescriptor().GetName()
	metricType := se.metricTypeFromProto(metricName)
	metricLabelKeys := metric.GetMetricDescriptor().GetLabelKeys()
	metricKind, valueType := protoMetricDescriptorTypeToMetricKind(metric)
	labelKeys := make([]string, 0, len(metricLabelKeys))
	for _, key := range metricLabelKeys {
		labelKeys = append(labelKeys, sanitize(key.GetKey()))
	}

	for _, protoTimeSeries := range metric.Timeseries {
		sdPoints, err := se.protoTimeSeriesToMonitoringPoints(protoTimeSeries, metricKind)
		if err != nil {
			mb.recordDroppedTimeseries(1, err)
			continue
		}

		// Each TimeSeries has labelValues which MUST be correlated
		// with that from the MetricDescriptor
		labels, err := labelsPerTimeSeries(se.defaultLabels, labelKeys, protoTimeSeries.GetLabelValues())
		if err != nil {
			mb.recordDroppedTimeseries(1, err)
			continue
		}
		mb.addTimeSeries(&monitoringpb.TimeSeries{
			Metric: &googlemetricpb.Metric{
				Type:   metricType,
				Labels: labels,
			},
			MetricKind: metricKind,
			ValueType:  valueType,
			Resource:   mappedRsc,
			Points:     sdPoints,
		})
	}
}

func labelsPerTimeSeries(defaults map[string]labelValue, labelKeys []string, labelValues []*metricspb.LabelValue) (map[string]string, error) {
	labels := make(map[string]string)
	// Fill in the defaults firstly, irrespective of if the labelKeys and labelValues are mismatched.
	for key, label := range defaults {
		labels[key] = label.val
	}

	// Perform this sanity check now.
	if len(labelKeys) != len(labelValues) {
		return labels, fmt.Errorf("length mismatch: len(labelKeys)=%d len(labelValues)=%d", len(labelKeys), len(labelValues))
	}

	for i, labelKey := range labelKeys {
		labelValue := labelValues[i]
		if !labelValue.GetHasValue() {
			continue
		}
		labels[labelKey] = labelValue.GetValue()
	}

	return labels, nil
}

// createMetricDescriptor creates a metric descriptor from the OpenCensus proto metric
// and then creates it remotely using Stackdriver's API.
func (se *statsExporter) createMetricDescriptor(ctx context.Context, metric *metricspb.Metric) error {
	se.protoMu.Lock()
	defer se.protoMu.Unlock()

	name := metric.GetMetricDescriptor().GetName()
	if _, created := se.protoMetricDescriptors[name]; created {
		return nil
	}

	// Otherwise, we encountered a cache-miss and
	// should create the metric descriptor remotely.
	inMD, err := se.protoToMonitoringMetricDescriptor(metric, se.defaultLabels)
	if err != nil {
		return err
	}

	if builtinMetric(inMD.Type) {
		se.protoMetricDescriptors[name] = true
	} else {
		cmrdesc := &monitoringpb.CreateMetricDescriptorRequest{
			Name:             fmt.Sprintf("projects/%s", se.o.ProjectID),
			MetricDescriptor: inMD,
		}
		_, err = createMetricDescriptor(ctx, se.c, cmrdesc)
		if err == nil {
			// Now record the metric as having been created.
			se.protoMetricDescriptors[name] = true
		}
	}

	return err
}

func (se *statsExporter) protoTimeSeriesToMonitoringPoints(ts *metricspb.TimeSeries, metricKind googlemetricpb.MetricDescriptor_MetricKind) (sptl []*monitoringpb.Point, err error) {
	for _, pt := range ts.Points {
		// If we have a last value aggregation point i.e. MetricDescriptor_GAUGE
		// StartTime should be nil.
		startTime := ts.StartTimestamp
		if metricKind == googlemetricpb.MetricDescriptor_GAUGE {
			startTime = nil
		}

		spt, err := fromProtoPoint(startTime, pt)
		if err != nil {
			return nil, err
		}
		sptl = append(sptl, spt)
	}
	return sptl, nil
}

func (se *statsExporter) protoToMonitoringMetricDescriptor(metric *metricspb.Metric, additionalLabels map[string]labelValue) (*googlemetricpb.MetricDescriptor, error) {
	if metric == nil || metric.MetricDescriptor == nil {
		return nil, errNilMetricOrMetricDescriptor
	}

	md := metric.GetMetricDescriptor()
	metricName := md.GetName()
	unit := md.GetUnit()
	description := md.GetDescription()
	metricType := se.metricTypeFromProto(metricName)
	displayName := se.displayName(metricName)
	metricKind, valueType := protoMetricDescriptorTypeToMetricKind(metric)

	sdm := &googlemetricpb.MetricDescriptor{
		Name:        fmt.Sprintf("projects/%s/metricDescriptors/%s", se.o.ProjectID, metricType),
		DisplayName: displayName,
		Description: description,
		Unit:        unit,
		Type:        metricType,
		MetricKind:  metricKind,
		ValueType:   valueType,
		Labels:      labelDescriptorsFromProto(additionalLabels, metric.GetMetricDescriptor().GetLabelKeys()),
	}

	return sdm, nil
}

func labelDescriptorsFromProto(defaults map[string]labelValue, protoLabelKeys []*metricspb.LabelKey) []*labelpb.LabelDescriptor {
	labelDescriptors := make([]*labelpb.LabelDescriptor, 0, len(defaults)+len(protoLabelKeys))

	// Fill in the defaults first.
	for key, lbl := range defaults {
		labelDescriptors = append(labelDescriptors, &labelpb.LabelDescriptor{
			Key:         sanitize(key),
			Description: lbl.desc,
			ValueType:   labelpb.LabelDescriptor_STRING,
		})
	}

	// Now fill in those from the metric.
	for _, protoKey := range protoLabelKeys {
		labelDescriptors = append(labelDescriptors, &labelpb.LabelDescriptor{
			Key:         sanitize(protoKey.GetKey()),
			Description: protoKey.GetDescription(),
			ValueType:   labelpb.LabelDescriptor_STRING, // We only use string tags
		})
	}
	return labelDescriptors
}

func (se *statsExporter) metricTypeFromProto(name string) string {
	prefix := se.o.MetricPrefix
	if prefix != "" {
		name = prefix + name
	}
	if !hasDomain(name) {
		// Still needed because the name may or may not have a "/" at the beginning.
		name = path.Join(defaultDomain, name)
	}
	return name
}

// hasDomain checks if the metric name already has a domain in it.
func hasDomain(name string) bool {
	for _, domain := range domains {
		if strings.Contains(name, domain) {
			return true
		}
	}
	return false
}

func fromProtoPoint(startTime *timestamppb.Timestamp, pt *metricspb.Point) (*monitoringpb.Point, error) {
	if pt == nil {
		return nil, nil
	}

	mptv, err := protoToMetricPoint(pt.Value)
	if err != nil {
		return nil, err
	}

	return &monitoringpb.Point{
		Value: mptv,
		Interval: &monitoringpb.TimeInterval{
			StartTime: startTime,
			EndTime:   pt.Timestamp,
		},
	}, nil
}

func protoToMetricPoint(value interface{}) (*monitoringpb.TypedValue, error) {
	if value == nil {
		return nil, nil
	}

	switch v := value.(type) {
	default:
		// All the other types are not yet handled.
		// TODO: (@odeke-em, @songy23) talk to the Stackdriver team to determine
		// the use cases for:
		//
		//      *TypedValue_BoolValue
		//      *TypedValue_StringValue
		//
		// and then file feature requests on OpenCensus-Specs and then OpenCensus-Proto,
		// lest we shall error here.
		//
		// TODO: Add conversion from SummaryValue when
		//      https://github.com/census-ecosystem/opencensus-go-exporter-stackdriver/issues/66
		// has been figured out.
		return nil, fmt.Errorf("protoToMetricPoint: unknown Data type: %T", value)

	case *metricspb.Point_Int64Value:
		return &monitoringpb.TypedValue{
			Value: &monitoringpb.TypedValue_Int64Value{
				Int64Value: v.Int64Value,
			},
		}, nil

	case *metricspb.Point_DoubleValue:
		return &monitoringpb.TypedValue{
			Value: &monitoringpb.TypedValue_DoubleValue{
				DoubleValue: v.DoubleValue,
			},
		}, nil

	case *metricspb.Point_DistributionValue:
		dv := v.DistributionValue
		var mv *monitoringpb.TypedValue_DistributionValue
		if dv != nil {
			var mean float64
			if dv.Count > 0 {
				mean = float64(dv.Sum) / float64(dv.Count)
			}
			mv = &monitoringpb.TypedValue_DistributionValue{
				DistributionValue: &distributionpb.Distribution{
					Count:                 dv.Count,
					Mean:                  mean,
					SumOfSquaredDeviation: dv.SumOfSquaredDeviation,
				},
			}

			insertZeroBound := false
			if bopts := dv.BucketOptions; bopts != nil && bopts.Type != nil {
				bexp, ok := bopts.Type.(*metricspb.DistributionValue_BucketOptions_Explicit_)
				if ok && bexp != nil && bexp.Explicit != nil {
					insertZeroBound = shouldInsertZeroBound(bexp.Explicit.Bounds...)
					mv.DistributionValue.BucketOptions = &distributionpb.Distribution_BucketOptions{
						Options: &distributionpb.Distribution_BucketOptions_ExplicitBuckets{
							ExplicitBuckets: &distributionpb.Distribution_BucketOptions_Explicit{
								// The first bucket bound should be 0.0 because the Metrics first bucket is
								// [0, first_bound) but Stackdriver monitoring bucket bounds begin with -infinity
								// (first bucket is (-infinity, 0))
								Bounds: addZeroBoundOnCondition(insertZeroBound, bexp.Explicit.Bounds...),
							},
						},
					}
				}
			}
			mv.DistributionValue.BucketCounts = addZeroBucketCountOnCondition(insertZeroBound, bucketCounts(dv.Buckets)...)

		}
		return &monitoringpb.TypedValue{Value: mv}, nil
	}
}

func bucketCounts(buckets []*metricspb.DistributionValue_Bucket) []int64 {
	bucketCounts := make([]int64, len(buckets))
	for i, bucket := range buckets {
		if bucket != nil {
			bucketCounts[i] = bucket.Count
		}
	}
	return bucketCounts
}

func protoMetricDescriptorTypeToMetricKind(m *metricspb.Metric) (googlemetricpb.MetricDescriptor_MetricKind, googlemetricpb.MetricDescriptor_ValueType) {
	dt := m.GetMetricDescriptor()
	if dt == nil {
		return googlemetricpb.MetricDescriptor_METRIC_KIND_UNSPECIFIED, googlemetricpb.MetricDescriptor_VALUE_TYPE_UNSPECIFIED
	}

	switch dt.Type {
	case metricspb.MetricDescriptor_CUMULATIVE_INT64:
		return googlemetricpb.MetricDescriptor_CUMULATIVE, googlemetricpb.MetricDescriptor_INT64

	case metricspb.MetricDescriptor_CUMULATIVE_DOUBLE:
		return googlemetricpb.MetricDescriptor_CUMULATIVE, googlemetricpb.MetricDescriptor_DOUBLE

	case metricspb.MetricDescriptor_CUMULATIVE_DISTRIBUTION:
		return googlemetricpb.MetricDescriptor_CUMULATIVE, googlemetricpb.MetricDescriptor_DISTRIBUTION

	case metricspb.MetricDescriptor_GAUGE_DOUBLE:
		return googlemetricpb.MetricDescriptor_GAUGE, googlemetricpb.MetricDescriptor_DOUBLE

	case metricspb.MetricDescriptor_GAUGE_INT64:
		return googlemetricpb.MetricDescriptor_GAUGE, googlemetricpb.MetricDescriptor_INT64

	case metricspb.MetricDescriptor_GAUGE_DISTRIBUTION:
		return googlemetricpb.MetricDescriptor_GAUGE, googlemetricpb.MetricDescriptor_DISTRIBUTION

	default:
		return googlemetricpb.MetricDescriptor_METRIC_KIND_UNSPECIFIED, googlemetricpb.MetricDescriptor_VALUE_TYPE_UNSPECIFIED
	}
}
