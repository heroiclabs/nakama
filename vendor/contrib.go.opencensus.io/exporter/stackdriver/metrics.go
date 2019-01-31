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

	"github.com/golang/protobuf/ptypes/timestamp"
	"go.opencensus.io/stats"
	"go.opencensus.io/trace"

	monitoring "cloud.google.com/go/monitoring/apiv3"
	distributionpb "google.golang.org/genproto/googleapis/api/distribution"
	labelpb "google.golang.org/genproto/googleapis/api/label"
	googlemetricpb "google.golang.org/genproto/googleapis/api/metric"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
	monitoringpb "google.golang.org/genproto/googleapis/monitoring/v3"

	commonpb "github.com/census-instrumentation/opencensus-proto/gen-go/agent/common/v1"
	metricspb "github.com/census-instrumentation/opencensus-proto/gen-go/metrics/v1"
	resourcepb "github.com/census-instrumentation/opencensus-proto/gen-go/resource/v1"
)

var errNilMetric = errors.New("expecting a non-nil metric")

type metricPayload struct {
	node     *commonpb.Node
	resource *resourcepb.Resource
	metric   *metricspb.Metric
}

// ExportMetric exports OpenCensus Metrics to Stackdriver Monitoring.
func (se *statsExporter) ExportMetric(ctx context.Context, node *commonpb.Node, rsc *resourcepb.Resource, metric *metricspb.Metric) error {
	if metric == nil {
		return errNilMetric
	}

	payload := &metricPayload{
		metric:   metric,
		resource: rsc,
		node:     node,
	}
	se.protoMetricsBundler.Add(payload, 1)

	return nil
}

func (se *statsExporter) handleMetricsUpload(payloads []*metricPayload) error {
	ctx, cancel := se.o.newContextWithTimeout()
	defer cancel()

	ctx, span := trace.StartSpan(
		ctx,
		"contrib.go.opencensus.io/exporter/stackdriver.uploadMetrics",
		trace.WithSampler(trace.NeverSample()),
	)
	defer span.End()

	for _, payload := range payloads {
		// Now create the metric descriptor remotely.
		if err := se.createMetricDescriptor(ctx, payload.metric); err != nil {
			span.SetStatus(trace.Status{Code: 2, Message: err.Error()})
			return err
		}
	}

	var allTimeSeries []*monitoringpb.TimeSeries
	for _, payload := range payloads {
		tsl, err := se.protoMetricToTimeSeries(ctx, payload.node, payload.resource, payload.metric)
		if err != nil {
			span.SetStatus(trace.Status{Code: 2, Message: err.Error()})
			return err
		}
		allTimeSeries = append(allTimeSeries, tsl...)
	}

	// Now batch timeseries up and then export.
	for start, end := 0, 0; start < len(allTimeSeries); start = end {
		end = start + maxTimeSeriesPerUpload
		if end > len(allTimeSeries) {
			end = len(allTimeSeries)
		}
		batch := allTimeSeries[start:end]
		ctsreql := se.combineTimeSeriesToCreateTimeSeriesRequest(batch)
		for _, ctsreq := range ctsreql {
			if err := createTimeSeries(ctx, se.c, ctsreq); err != nil {
				span.SetStatus(trace.Status{Code: trace.StatusCodeUnknown, Message: err.Error()})
				// TODO(@odeke-em): Don't fail fast here, perhaps batch errors?
				// return err
			}
		}
	}

	return nil
}

func (se *statsExporter) combineTimeSeriesToCreateTimeSeriesRequest(ts []*monitoringpb.TimeSeries) (ctsreql []*monitoringpb.CreateTimeSeriesRequest) {
	if len(ts) == 0 {
		return nil
	}

	// Since there are scenarios in which Metrics with the same Type
	// can be bunched in the same TimeSeries, we have to ensure that
	// we create a unique CreateTimeSeriesRequest with entirely unique Metrics
	// per TimeSeries, lest we'll encounter:
	//
	//      err: rpc error: code = InvalidArgument desc = One or more TimeSeries could not be written:
	//      Field timeSeries[2] had an invalid value: Duplicate TimeSeries encountered.
	//      Only one point can be written per TimeSeries per request.: timeSeries[2]
	//
	// This scenario happens when we are using the OpenCensus Agent in which multiple metrics
	// are streamed by various client applications.
	// See https://github.com/census-ecosystem/opencensus-go-exporter-stackdriver/issues/73
	uniqueTimeSeries := make([]*monitoringpb.TimeSeries, 0, len(ts))
	nonUniqueTimeSeries := make([]*monitoringpb.TimeSeries, 0, len(ts))
	seenMetrics := make(map[string]struct{})

	for _, tti := range ts {
		signature := tti.Metric.GetType()
		if _, alreadySeen := seenMetrics[signature]; !alreadySeen {
			uniqueTimeSeries = append(uniqueTimeSeries, tti)
			seenMetrics[signature] = struct{}{}
		} else {
			nonUniqueTimeSeries = append(nonUniqueTimeSeries, tti)
		}
	}

	// UniqueTimeSeries can be bunched up together
	// While for each nonUniqueTimeSeries, we have
	// to make a unique CreateTimeSeriesRequest.
	ctsreql = append(ctsreql, &monitoringpb.CreateTimeSeriesRequest{
		Name:       monitoring.MetricProjectPath(se.o.ProjectID),
		TimeSeries: uniqueTimeSeries,
	})

	// Now recursively also combine the non-unique TimeSeries
	// that were singly added to nonUniqueTimeSeries.
	// The reason is that we need optimal combinations
	// for optimal combinations because:
	// * "a/b/c"
	// * "a/b/c"
	// * "x/y/z"
	// * "a/b/c"
	// * "x/y/z"
	// * "p/y/z"
	// * "d/y/z"
	//
	// should produce:
	//      CreateTimeSeries(uniqueTimeSeries)    :: ["a/b/c", "x/y/z", "p/y/z", "d/y/z"]
	//      CreateTimeSeries(nonUniqueTimeSeries) :: ["a/b/c"]
	//      CreateTimeSeries(nonUniqueTimeSeries) :: ["a/b/c", "x/y/z"]
	nonUniqueRequests := se.combineTimeSeriesToCreateTimeSeriesRequest(nonUniqueTimeSeries)
	ctsreql = append(ctsreql, nonUniqueRequests...)

	return ctsreql
}

// protoMetricToTimeSeries converts a metric into a Stackdriver Monitoring v3 API CreateTimeSeriesRequest
// but it doesn't invoke any remote API.
func (se *statsExporter) protoMetricToTimeSeries(ctx context.Context, node *commonpb.Node, rsc *resourcepb.Resource, metric *metricspb.Metric) ([]*monitoringpb.TimeSeries, error) {
	if metric == nil {
		return nil, errNilMetric
	}

	var resource = rsc
	if metric.Resource != nil {
		resource = metric.Resource
	}

	metricName, _, _, _ := metricProseFromProto(metric)
	metricType, _ := se.metricTypeFromProto(metricName)
	metricLabelKeys := metric.GetMetricDescriptor().GetLabelKeys()
	metricKind, _ := protoMetricDescriptorTypeToMetricKind(metric)

	timeSeries := make([]*monitoringpb.TimeSeries, 0, len(metric.Timeseries))
	for _, protoTimeSeries := range metric.Timeseries {
		sdPoints, err := se.protoTimeSeriesToMonitoringPoints(protoTimeSeries, metricKind)
		if err != nil {
			return nil, err
		}

		// Each TimeSeries has labelValues which MUST be correlated
		// with that from the MetricDescriptor
		labels, err := labelsPerTimeSeries(se.defaultLabels, metricLabelKeys, protoTimeSeries.GetLabelValues())
		if err != nil {
			// TODO: (@odeke-em) perhaps log this error from labels extraction, if non-nil.
			continue
		}
		timeSeries = append(timeSeries, &monitoringpb.TimeSeries{
			Metric: &googlemetricpb.Metric{
				Type:   metricType,
				Labels: labels,
			},
			Resource: protoResourceToMonitoredResource(resource),
			Points:   sdPoints,
		})
	}

	return timeSeries, nil
}

func labelsPerTimeSeries(defaults map[string]labelValue, labelKeys []*metricspb.LabelKey, labelValues []*metricspb.LabelValue) (map[string]string, error) {
	labels := make(map[string]string)
	// Fill in the defaults firstly, irrespective of if the labelKeys and labelValues are mismatched.
	for key, label := range defaults {
		labels[sanitize(key)] = label.val
	}

	// Perform this sanity check now.
	if len(labelKeys) != len(labelValues) {
		return labels, fmt.Errorf("Length mismatch: len(labelKeys)=%d len(labelValues)=%d", len(labelKeys), len(labelValues))
	}

	for i, labelKey := range labelKeys {
		labelValue := labelValues[i]
		labels[sanitize(labelKey.GetKey())] = labelValue.GetValue()
	}

	return labels, nil
}

func (se *statsExporter) protoMetricDescriptorToCreateMetricDescriptorRequest(ctx context.Context, metric *metricspb.Metric) (*monitoringpb.CreateMetricDescriptorRequest, error) {
	// Otherwise, we encountered a cache-miss and
	// should create the metric descriptor remotely.
	inMD, err := se.protoToMonitoringMetricDescriptor(metric)
	if err != nil {
		return nil, err
	}

	cmrdesc := &monitoringpb.CreateMetricDescriptorRequest{
		Name:             fmt.Sprintf("projects/%s", se.o.ProjectID),
		MetricDescriptor: inMD,
	}

	return cmrdesc, nil
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
	inMD, err := se.protoToMonitoringMetricDescriptor(metric)
	if err != nil {
		return err
	}

	cmrdesc := &monitoringpb.CreateMetricDescriptorRequest{
		Name:             fmt.Sprintf("projects/%s", se.o.ProjectID),
		MetricDescriptor: inMD,
	}
	md, err := createMetricDescriptor(ctx, se.c, cmrdesc)

	if err == nil {
		// Now record the metric as having been created.
		se.protoMetricDescriptors[name] = md
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

func (se *statsExporter) protoToMonitoringMetricDescriptor(metric *metricspb.Metric) (*googlemetricpb.MetricDescriptor, error) {
	if metric == nil {
		return nil, errNilMetric
	}

	metricName, description, unit, _ := metricProseFromProto(metric)
	metricType, _ := se.metricTypeFromProto(metricName)
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
		Labels:      labelDescriptorsFromProto(se.defaultLabels, metric.GetMetricDescriptor().GetLabelKeys()),
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

func metricProseFromProto(metric *metricspb.Metric) (name, description, unit string, ok bool) {
	mname := metric.GetName()
	if mname != "" {
		name = mname
		return
	}

	md := metric.GetMetricDescriptor()

	name = md.GetName()
	unit = md.GetUnit()
	description = md.GetDescription()

	if md != nil && md.Type == metricspb.MetricDescriptor_CUMULATIVE_INT64 {
		// If the aggregation type is count, which counts the number of recorded measurements, the unit must be "1",
		// because this view does not apply to the recorded values.
		unit = stats.UnitDimensionless
	}

	return
}

func (se *statsExporter) metricTypeFromProto(name string) (string, bool) {
	// TODO: (@odeke-em) support non-"custom.googleapis.com" metrics names.
	name = path.Join("custom.googleapis.com", "opencensus", name)
	return name, true
}

func fromProtoPoint(startTime *timestamp.Timestamp, pt *metricspb.Point) (*monitoringpb.Point, error) {
	if pt == nil {
		return nil, nil
	}

	mptv, err := protoToMetricPoint(pt.Value)
	if err != nil {
		return nil, err
	}

	mpt := &monitoringpb.Point{
		Value: mptv,
		Interval: &monitoringpb.TimeInterval{
			StartTime: startTime,
			EndTime:   pt.Timestamp,
		},
	}
	return mpt, nil
}

func protoToMetricPoint(value interface{}) (*monitoringpb.TypedValue, error) {
	if value == nil {
		return nil, nil
	}

	var err error
	var tval *monitoringpb.TypedValue
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
		err = fmt.Errorf("protoToMetricPoint: unknown Data type: %T", value)

	case *metricspb.Point_Int64Value:
		tval = &monitoringpb.TypedValue{
			Value: &monitoringpb.TypedValue_Int64Value{
				Int64Value: v.Int64Value,
			},
		}

	case *metricspb.Point_DoubleValue:
		tval = &monitoringpb.TypedValue{
			Value: &monitoringpb.TypedValue_DoubleValue{
				DoubleValue: v.DoubleValue,
			},
		}

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
					BucketCounts:          bucketCounts(dv.Buckets),
				},
			}

			if bopts := dv.BucketOptions; bopts != nil && bopts.Type != nil {
				bexp, ok := bopts.Type.(*metricspb.DistributionValue_BucketOptions_Explicit_)
				if ok && bexp != nil && bexp.Explicit != nil {
					mv.DistributionValue.BucketOptions = &distributionpb.Distribution_BucketOptions{
						Options: &distributionpb.Distribution_BucketOptions_ExplicitBuckets{
							ExplicitBuckets: &distributionpb.Distribution_BucketOptions_Explicit{
								Bounds: bexp.Explicit.Bounds[:],
							},
						},
					}
				}
			}
		}
		tval = &monitoringpb.TypedValue{Value: mv}
	}

	return tval, err
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

func protoResourceToMonitoredResource(rsp *resourcepb.Resource) *monitoredrespb.MonitoredResource {
	if rsp == nil {
		return &monitoredrespb.MonitoredResource{
			Type: "global",
		}
	}
	typ := rsp.Type
	if typ == "" {
		typ = "global"
	}
	mrsp := &monitoredrespb.MonitoredResource{
		Type: typ,
	}
	if rsp.Labels != nil {
		mrsp.Labels = make(map[string]string, len(rsp.Labels))
		for k, v := range rsp.Labels {
			mrsp.Labels[k] = v
		}
	}
	return mrsp
}
