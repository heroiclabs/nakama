// Copyright 2019, OpenCensus Authors
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
	"github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/ptypes/any"
	"github.com/golang/protobuf/ptypes/timestamp"
	"go.opencensus.io/trace"

	distributionpb "google.golang.org/genproto/googleapis/api/distribution"
	labelpb "google.golang.org/genproto/googleapis/api/label"
	googlemetricpb "google.golang.org/genproto/googleapis/api/metric"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
	monitoringpb "google.golang.org/genproto/googleapis/monitoring/v3"

	"go.opencensus.io/metric/metricdata"
	"go.opencensus.io/resource"
)

var (
	errLableExtraction       = errors.New("error extracting labels")
	errUnspecifiedMetricKind = errors.New("metric kind is unpsecified")
)

const (
	exemplarAttachmentTypeString  = "type.googleapis.com/google.protobuf.StringValue"
	exemplarAttachmentTypeSpanCtx = "type.googleapis.com/google.monitoring.v3.SpanContext"

	// TODO(songy23): add support for this.
	// exemplarAttachmentTypeDroppedLabels = "type.googleapis.com/google.monitoring.v3.DroppedLabels"
)

// ExportMetrics exports OpenCensus Metrics to Stackdriver Monitoring.
func (se *statsExporter) ExportMetrics(ctx context.Context, metrics []*metricdata.Metric) error {
	if len(metrics) == 0 {
		return nil
	}

	for _, metric := range metrics {
		se.metricsBundler.Add(metric, 1)
		// TODO: [rghetia] handle errors.
	}

	return nil
}

func (se *statsExporter) handleMetricsUpload(metrics []*metricdata.Metric) {
	err := se.uploadMetrics(metrics)
	if err != nil {
		se.o.handleError(err)
	}
}

func (se *statsExporter) uploadMetrics(metrics []*metricdata.Metric) error {
	ctx, cancel := se.o.newContextWithTimeout()
	defer cancel()

	ctx, span := trace.StartSpan(
		ctx,
		"contrib.go.opencensus.io/exporter/stackdriver.uploadMetrics",
		trace.WithSampler(trace.NeverSample()),
	)
	defer span.End()

	for _, metric := range metrics {
		// Now create the metric descriptor remotely.
		if err := se.createMetricDescriptorFromMetric(ctx, metric); err != nil {
			span.SetStatus(trace.Status{Code: trace.StatusCodeUnknown, Message: err.Error()})
			//TODO: [rghetia] record error metrics.
			continue
		}
	}

	var allTimeSeries []*monitoringpb.TimeSeries
	for _, metric := range metrics {
		tsl, err := se.metricToMpbTs(ctx, metric)
		if err != nil {
			span.SetStatus(trace.Status{Code: trace.StatusCodeUnknown, Message: err.Error()})
			//TODO: [rghetia] record error metrics.
			continue
		}
		if tsl != nil {
			allTimeSeries = append(allTimeSeries, tsl...)
		}
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
				// TODO(@rghetia): record error metrics
				// return err
			}
		}
	}

	return nil
}

// metricToMpbTs converts a metric into a list of Stackdriver Monitoring v3 API TimeSeries
// but it doesn't invoke any remote API.
func (se *statsExporter) metricToMpbTs(ctx context.Context, metric *metricdata.Metric) ([]*monitoringpb.TimeSeries, error) {
	if metric == nil {
		return nil, errNilMetric
	}

	resource := se.metricRscToMpbRsc(metric.Resource)

	metricName := metric.Descriptor.Name
	metricType, _ := se.metricTypeFromProto(metricName)
	metricLabelKeys := metric.Descriptor.LabelKeys
	metricKind, _ := metricDescriptorTypeToMetricKind(metric)

	if metricKind == googlemetricpb.MetricDescriptor_METRIC_KIND_UNSPECIFIED {
		// ignore these Timeserieses. TODO [rghetia] log errors.
		return nil, nil
	}

	timeSeries := make([]*monitoringpb.TimeSeries, 0, len(metric.TimeSeries))
	for _, ts := range metric.TimeSeries {
		sdPoints, err := se.metricTsToMpbPoint(ts, metricKind)
		if err != nil {
			// TODO(@rghetia): record error metrics
			continue
		}

		// Each TimeSeries has labelValues which MUST be correlated
		// with that from the MetricDescriptor
		labels, err := metricLabelsToTsLabels(se.defaultLabels, metricLabelKeys, ts.LabelValues)
		if err != nil {
			// TODO: (@rghetia) perhaps log this error from labels extraction, if non-nil.
			continue
		}
		timeSeries = append(timeSeries, &monitoringpb.TimeSeries{
			Metric: &googlemetricpb.Metric{
				Type:   metricType,
				Labels: labels,
			},
			Resource: resource,
			Points:   sdPoints,
		})
	}

	return timeSeries, nil
}

func metricLabelsToTsLabels(defaults map[string]labelValue, labelKeys []metricdata.LabelKey, labelValues []metricdata.LabelValue) (map[string]string, error) {
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
		labels[sanitize(labelKey.Key)] = labelValue.Value
	}

	return labels, nil
}

// createMetricDescriptorFromMetric creates a metric descriptor from the OpenCensus metric
// and then creates it remotely using Stackdriver's API.
func (se *statsExporter) createMetricDescriptorFromMetric(ctx context.Context, metric *metricdata.Metric) error {
	se.metricMu.Lock()
	defer se.metricMu.Unlock()

	name := metric.Descriptor.Name
	if _, created := se.metricDescriptors[name]; created {
		return nil
	}

	// Otherwise, we encountered a cache-miss and
	// should create the metric descriptor remotely.
	inMD, err := se.metricToMpbMetricDescriptor(metric)
	if err != nil {
		return err
	}

	var md *googlemetricpb.MetricDescriptor
	if builtinMetric(inMD.Type) {
		gmrdesc := &monitoringpb.GetMetricDescriptorRequest{
			Name: inMD.Name,
		}
		md, err = getMetricDescriptor(ctx, se.c, gmrdesc)
	} else {

		cmrdesc := &monitoringpb.CreateMetricDescriptorRequest{
			Name:             fmt.Sprintf("projects/%s", se.o.ProjectID),
			MetricDescriptor: inMD,
		}
		md, err = createMetricDescriptor(ctx, se.c, cmrdesc)
	}

	if err == nil {
		// Now record the metric as having been created.
		se.metricDescriptors[name] = md
	}

	return err
}

func (se *statsExporter) metricToMpbMetricDescriptor(metric *metricdata.Metric) (*googlemetricpb.MetricDescriptor, error) {
	if metric == nil {
		return nil, errNilMetric
	}

	metricType, _ := se.metricTypeFromProto(metric.Descriptor.Name)
	displayName := se.displayName(metric.Descriptor.Name)
	metricKind, valueType := metricDescriptorTypeToMetricKind(metric)

	sdm := &googlemetricpb.MetricDescriptor{
		Name:        fmt.Sprintf("projects/%s/metricDescriptors/%s", se.o.ProjectID, metricType),
		DisplayName: displayName,
		Description: metric.Descriptor.Description,
		Unit:        string(metric.Descriptor.Unit),
		Type:        metricType,
		MetricKind:  metricKind,
		ValueType:   valueType,
		Labels:      metricLableKeysToLabels(se.defaultLabels, metric.Descriptor.LabelKeys),
	}

	return sdm, nil
}

func metricLableKeysToLabels(defaults map[string]labelValue, labelKeys []metricdata.LabelKey) []*labelpb.LabelDescriptor {
	labelDescriptors := make([]*labelpb.LabelDescriptor, 0, len(defaults)+len(labelKeys))

	// Fill in the defaults first.
	for key, lbl := range defaults {
		labelDescriptors = append(labelDescriptors, &labelpb.LabelDescriptor{
			Key:         sanitize(key),
			Description: lbl.desc,
			ValueType:   labelpb.LabelDescriptor_STRING,
		})
	}

	// Now fill in those from the metric.
	for _, key := range labelKeys {
		labelDescriptors = append(labelDescriptors, &labelpb.LabelDescriptor{
			Key:         sanitize(key.Key),
			Description: key.Description,
			ValueType:   labelpb.LabelDescriptor_STRING, // We only use string tags
		})
	}
	return labelDescriptors
}

func metricDescriptorTypeToMetricKind(m *metricdata.Metric) (googlemetricpb.MetricDescriptor_MetricKind, googlemetricpb.MetricDescriptor_ValueType) {
	if m == nil {
		return googlemetricpb.MetricDescriptor_METRIC_KIND_UNSPECIFIED, googlemetricpb.MetricDescriptor_VALUE_TYPE_UNSPECIFIED
	}

	switch m.Descriptor.Type {
	case metricdata.TypeCumulativeInt64:
		return googlemetricpb.MetricDescriptor_CUMULATIVE, googlemetricpb.MetricDescriptor_INT64

	case metricdata.TypeCumulativeFloat64:
		return googlemetricpb.MetricDescriptor_CUMULATIVE, googlemetricpb.MetricDescriptor_DOUBLE

	case metricdata.TypeCumulativeDistribution:
		return googlemetricpb.MetricDescriptor_CUMULATIVE, googlemetricpb.MetricDescriptor_DISTRIBUTION

	case metricdata.TypeGaugeFloat64:
		return googlemetricpb.MetricDescriptor_GAUGE, googlemetricpb.MetricDescriptor_DOUBLE

	case metricdata.TypeGaugeInt64:
		return googlemetricpb.MetricDescriptor_GAUGE, googlemetricpb.MetricDescriptor_INT64

	case metricdata.TypeGaugeDistribution:
		return googlemetricpb.MetricDescriptor_GAUGE, googlemetricpb.MetricDescriptor_DISTRIBUTION

	case metricdata.TypeSummary:
		// TODO: [rghetia] after upgrading to proto version3, retrun UNRECOGNIZED instead of UNSPECIFIED
		return googlemetricpb.MetricDescriptor_METRIC_KIND_UNSPECIFIED, googlemetricpb.MetricDescriptor_VALUE_TYPE_UNSPECIFIED

	default:
		// TODO: [rghetia] after upgrading to proto version3, retrun UNRECOGNIZED instead of UNSPECIFIED
		return googlemetricpb.MetricDescriptor_METRIC_KIND_UNSPECIFIED, googlemetricpb.MetricDescriptor_VALUE_TYPE_UNSPECIFIED
	}
}

func (se *statsExporter) metricRscToMpbRsc(rs *resource.Resource) *monitoredrespb.MonitoredResource {
	if rs == nil {
		resource := se.o.Resource
		if resource == nil {
			resource = &monitoredrespb.MonitoredResource{
				Type: "global",
			}
		}
		return resource
	}
	typ := rs.Type
	if typ == "" {
		typ = "global"
	}
	mrsp := &monitoredrespb.MonitoredResource{
		Type: typ,
	}
	if rs.Labels != nil {
		mrsp.Labels = make(map[string]string, len(rs.Labels))
		for k, v := range rs.Labels {
			// TODO: [rghetia] add mapping between OC Labels and SD Labels.
			mrsp.Labels[k] = v
		}
	}
	return mrsp
}

func (se *statsExporter) metricTsToMpbPoint(ts *metricdata.TimeSeries, metricKind googlemetricpb.MetricDescriptor_MetricKind) (sptl []*monitoringpb.Point, err error) {
	for _, pt := range ts.Points {

		// If we have a last value aggregation point i.e. MetricDescriptor_GAUGE
		// StartTime should be nil.
		startTime := timestampProto(ts.StartTime)
		if metricKind == googlemetricpb.MetricDescriptor_GAUGE {
			startTime = nil
		}

		spt, err := metricPointToMpbPoint(startTime, &pt, se.o.ProjectID)
		if err != nil {
			return nil, err
		}
		sptl = append(sptl, spt)
	}
	return sptl, nil
}

func metricPointToMpbPoint(startTime *timestamp.Timestamp, pt *metricdata.Point, projectID string) (*monitoringpb.Point, error) {
	if pt == nil {
		return nil, nil
	}

	mptv, err := metricPointToMpbValue(pt, projectID)
	if err != nil {
		return nil, err
	}

	mpt := &monitoringpb.Point{
		Value: mptv,
		Interval: &monitoringpb.TimeInterval{
			StartTime: startTime,
			EndTime:   timestampProto(pt.Time),
		},
	}
	return mpt, nil
}

func metricPointToMpbValue(pt *metricdata.Point, projectID string) (*monitoringpb.TypedValue, error) {
	if pt == nil {
		return nil, nil
	}

	var err error
	var tval *monitoringpb.TypedValue
	switch v := pt.Value.(type) {
	default:
		err = fmt.Errorf("protoToMetricPoint: unknown Data type: %T", pt.Value)

	case int64:
		tval = &monitoringpb.TypedValue{
			Value: &monitoringpb.TypedValue_Int64Value{
				Int64Value: v,
			},
		}

	case float64:
		tval = &monitoringpb.TypedValue{
			Value: &monitoringpb.TypedValue_DoubleValue{
				DoubleValue: v,
			},
		}

	case *metricdata.Distribution:
		dv := v
		var mv *monitoringpb.TypedValue_DistributionValue
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
		if bopts := dv.BucketOptions; bopts != nil {
			insertZeroBound = shouldInsertZeroBound(bopts.Bounds...)
			mv.DistributionValue.BucketOptions = &distributionpb.Distribution_BucketOptions{
				Options: &distributionpb.Distribution_BucketOptions_ExplicitBuckets{
					ExplicitBuckets: &distributionpb.Distribution_BucketOptions_Explicit{
						// The first bucket bound should be 0.0 because the Metrics first bucket is
						// [0, first_bound) but Stackdriver monitoring bucket bounds begin with -infinity
						// (first bucket is (-infinity, 0))
						Bounds: addZeroBoundOnCondition(insertZeroBound, bopts.Bounds...),
					},
				},
			}
		}
		bucketCounts, exemplars := metricBucketToBucketCountsAndExemplars(dv.Buckets, projectID)
		mv.DistributionValue.BucketCounts = addZeroBucketCountOnCondition(insertZeroBound, bucketCounts...)
		mv.DistributionValue.Exemplars = exemplars

		tval = &monitoringpb.TypedValue{Value: mv}
	}

	return tval, err
}

func metricBucketToBucketCountsAndExemplars(buckets []metricdata.Bucket, projectID string) ([]int64, []*distributionpb.Distribution_Exemplar) {
	bucketCounts := make([]int64, len(buckets))
	var exemplars []*distributionpb.Distribution_Exemplar
	for i, bucket := range buckets {
		bucketCounts[i] = bucket.Count
		if bucket.Exemplar != nil {
			exemplars = append(exemplars, metricExemplarToPbExemplar(bucket.Exemplar, projectID))
		}
	}
	return bucketCounts, exemplars
}

func metricExemplarToPbExemplar(exemplar *metricdata.Exemplar, projectID string) *distributionpb.Distribution_Exemplar {
	return &distributionpb.Distribution_Exemplar{
		Value:       exemplar.Value,
		Timestamp:   timestampProto(exemplar.Timestamp),
		Attachments: attachmentsToPbAttachments(exemplar.Attachments, projectID),
	}
}

func attachmentsToPbAttachments(attachments metricdata.Attachments, projectID string) []*any.Any {
	var pbAttachments []*any.Any
	for _, v := range attachments {
		switch v.(type) {
		case trace.SpanContext:
			spanCtx, _ := v.(trace.SpanContext)
			pbAttachments = append(pbAttachments, toPbSpanCtxAttachment(spanCtx, projectID))
		default:
			// Treat everything else as plain string for now.
			// TODO(songy23): add support for dropped label attachments.
			pbAttachments = append(pbAttachments, toPbStringAttachment(v))
		}
	}
	return pbAttachments
}

func toPbStringAttachment(v interface{}) *any.Any {
	s := fmt.Sprintf("%v", v)
	return &any.Any{
		TypeUrl: exemplarAttachmentTypeString,
		Value:   []byte(s),
	}
}

func toPbSpanCtxAttachment(spanCtx trace.SpanContext, projectID string) *any.Any {
	pbSpanCtx := monitoringpb.SpanContext{
		SpanName: fmt.Sprintf("projects/%s/traces/%s/spans/%s", projectID, spanCtx.TraceID.String(), spanCtx.SpanID.String()),
	}
	bytes, _ := proto.Marshal(&pbSpanCtx)
	return &any.Any{
		TypeUrl: exemplarAttachmentTypeSpanCtx,
		Value:   bytes,
	}
}
