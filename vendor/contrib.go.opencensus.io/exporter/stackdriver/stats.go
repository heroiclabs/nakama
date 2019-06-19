// Copyright 2017, OpenCensus Authors
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
	"errors"
	"fmt"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opencensus.io"
	"go.opencensus.io/stats"
	"go.opencensus.io/stats/view"
	"go.opencensus.io/tag"
	"go.opencensus.io/trace"

	"cloud.google.com/go/monitoring/apiv3"
	"github.com/golang/protobuf/ptypes/timestamp"
	"go.opencensus.io/metric/metricdata"
	"go.opencensus.io/metric/metricexport"
	"google.golang.org/api/option"
	"google.golang.org/api/support/bundler"
	distributionpb "google.golang.org/genproto/googleapis/api/distribution"
	labelpb "google.golang.org/genproto/googleapis/api/label"
	"google.golang.org/genproto/googleapis/api/metric"
	metricpb "google.golang.org/genproto/googleapis/api/metric"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
	monitoringpb "google.golang.org/genproto/googleapis/monitoring/v3"
)

const (
	maxTimeSeriesPerUpload    = 200
	opencensusTaskKey         = "opencensus_task"
	opencensusTaskDescription = "Opencensus task identifier"
	defaultDisplayNamePrefix  = "OpenCensus"
	version                   = "0.10.0"
)

var userAgent = fmt.Sprintf("opencensus-go %s; stackdriver-exporter %s", opencensus.Version(), version)

// statsExporter exports stats to the Stackdriver Monitoring.
type statsExporter struct {
	o Options

	viewDataBundler     *bundler.Bundler
	protoMetricsBundler *bundler.Bundler
	metricsBundler      *bundler.Bundler

	createdViewsMu sync.Mutex
	createdViews   map[string]*metricpb.MetricDescriptor // Views already created remotely

	protoMu                sync.Mutex
	protoMetricDescriptors map[string]*metricpb.MetricDescriptor // Saves the metric descriptors that were already created remotely

	metricMu          sync.Mutex
	metricDescriptors map[string]*metricpb.MetricDescriptor // Saves the metric descriptors that were already created remotely

	c             *monitoring.MetricClient
	defaultLabels map[string]labelValue
	ir            *metricexport.IntervalReader

	initReaderOnce sync.Once
}

var (
	errBlankProjectID = errors.New("expecting a non-blank ProjectID")
)

// newStatsExporter returns an exporter that uploads stats data to Stackdriver Monitoring.
// Only one Stackdriver exporter should be created per ProjectID per process, any subsequent
// invocations of NewExporter with the same ProjectID will return an error.
func newStatsExporter(o Options) (*statsExporter, error) {
	if strings.TrimSpace(o.ProjectID) == "" {
		return nil, errBlankProjectID
	}

	opts := append(o.MonitoringClientOptions, option.WithUserAgent(userAgent))
	ctx, cancel := o.newContextWithTimeout()
	defer cancel()
	client, err := monitoring.NewMetricClient(ctx, opts...)
	if err != nil {
		return nil, err
	}
	e := &statsExporter{
		c:                      client,
		o:                      o,
		createdViews:           make(map[string]*metricpb.MetricDescriptor),
		protoMetricDescriptors: make(map[string]*metricpb.MetricDescriptor),
		metricDescriptors:      make(map[string]*metricpb.MetricDescriptor),
	}

	if o.DefaultMonitoringLabels != nil {
		e.defaultLabels = o.DefaultMonitoringLabels.m
	} else {
		e.defaultLabels = map[string]labelValue{
			opencensusTaskKey: {val: getTaskValue(), desc: opencensusTaskDescription},
		}
	}

	e.viewDataBundler = bundler.NewBundler((*view.Data)(nil), func(bundle interface{}) {
		vds := bundle.([]*view.Data)
		e.handleUpload(vds...)
	})
	e.protoMetricsBundler = bundler.NewBundler((*metricProtoPayload)(nil), func(bundle interface{}) {
		payloads := bundle.([]*metricProtoPayload)
		e.handleMetricsProtoUpload(payloads)
	})
	e.metricsBundler = bundler.NewBundler((*metricdata.Metric)(nil), func(bundle interface{}) {
		metrics := bundle.([]*metricdata.Metric)
		e.handleMetricsUpload(metrics)
	})
	if delayThreshold := e.o.BundleDelayThreshold; delayThreshold > 0 {
		e.viewDataBundler.DelayThreshold = delayThreshold
		e.protoMetricsBundler.DelayThreshold = delayThreshold
		e.metricsBundler.DelayThreshold = delayThreshold
	}
	if countThreshold := e.o.BundleCountThreshold; countThreshold > 0 {
		e.viewDataBundler.BundleCountThreshold = countThreshold
		e.protoMetricsBundler.BundleCountThreshold = countThreshold
		e.metricsBundler.BundleCountThreshold = countThreshold
	}
	return e, nil
}

func (e *statsExporter) startMetricsReader() error {
	e.initReaderOnce.Do(func() {
		e.ir, _ = metricexport.NewIntervalReader(&metricexport.Reader{}, e)
	})
	e.ir.ReportingInterval = e.o.ReportingInterval
	return e.ir.Start()
}

func (e *statsExporter) stopMetricsReader() {
	if e.ir != nil {
		e.ir.Stop()
	}
}

func (e *statsExporter) getMonitoredResource(v *view.View, tags []tag.Tag) ([]tag.Tag, *monitoredrespb.MonitoredResource) {
	if get := e.o.GetMonitoredResource; get != nil {
		newTags, mr := get(v, tags)
		return newTags, convertMonitoredResourceToPB(mr)
	}
	resource := e.o.Resource
	if resource == nil {
		resource = &monitoredrespb.MonitoredResource{
			Type: "global",
		}
	}
	return tags, resource
}

// ExportView exports to the Stackdriver Monitoring if view data
// has one or more rows.
func (e *statsExporter) ExportView(vd *view.Data) {
	if len(vd.Rows) == 0 {
		return
	}
	err := e.viewDataBundler.Add(vd, 1)
	switch err {
	case nil:
		return
	case bundler.ErrOverflow:
		e.o.handleError(errors.New("failed to upload: buffer full"))
	default:
		e.o.handleError(err)
	}
}

// getTaskValue returns a task label value in the format of
// "go-<pid>@<hostname>".
func getTaskValue() string {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "localhost"
	}
	return "go-" + strconv.Itoa(os.Getpid()) + "@" + hostname
}

// handleUpload handles uploading a slice
// of Data, as well as error handling.
func (e *statsExporter) handleUpload(vds ...*view.Data) {
	if err := e.uploadStats(vds); err != nil {
		e.o.handleError(err)
	}
}

// Flush waits for exported view data and metrics to be uploaded.
//
// This is useful if your program is ending and you do not
// want to lose data that hasn't yet been exported.
func (e *statsExporter) Flush() {
	e.viewDataBundler.Flush()
	e.protoMetricsBundler.Flush()
	e.metricsBundler.Flush()
}

func (e *statsExporter) uploadStats(vds []*view.Data) error {
	ctx, cancel := e.o.newContextWithTimeout()
	defer cancel()
	ctx, span := trace.StartSpan(
		ctx,
		"contrib.go.opencensus.io/exporter/stackdriver.uploadStats",
		trace.WithSampler(trace.NeverSample()),
	)
	defer span.End()

	for _, vd := range vds {
		if err := e.createMeasure(ctx, vd.View); err != nil {
			span.SetStatus(trace.Status{Code: 2, Message: err.Error()})
			return err
		}
	}
	for _, req := range e.makeReq(vds, maxTimeSeriesPerUpload) {
		if err := createTimeSeries(ctx, e.c, req); err != nil {
			span.SetStatus(trace.Status{Code: 2, Message: err.Error()})
			// TODO(jbd): Don't fail fast here, batch errors?
			return err
		}
	}
	return nil
}

func (e *statsExporter) makeReq(vds []*view.Data, limit int) []*monitoringpb.CreateTimeSeriesRequest {
	var reqs []*monitoringpb.CreateTimeSeriesRequest

	var allTimeSeries []*monitoringpb.TimeSeries
	for _, vd := range vds {
		for _, row := range vd.Rows {
			tags, resource := e.getMonitoredResource(vd.View, append([]tag.Tag(nil), row.Tags...))
			ts := &monitoringpb.TimeSeries{
				Metric: &metricpb.Metric{
					Type:   e.metricType(vd.View),
					Labels: newLabels(e.defaultLabels, tags),
				},
				Resource: resource,
				Points:   []*monitoringpb.Point{newPoint(vd.View, row, vd.Start, vd.End)},
			}
			allTimeSeries = append(allTimeSeries, ts)
		}
	}

	var timeSeries []*monitoringpb.TimeSeries
	for _, ts := range allTimeSeries {
		timeSeries = append(timeSeries, ts)
		if len(timeSeries) == limit {
			ctsreql := e.combineTimeSeriesToCreateTimeSeriesRequest(timeSeries)
			reqs = append(reqs, ctsreql...)
			timeSeries = timeSeries[:0]
		}
	}

	if len(timeSeries) > 0 {
		ctsreql := e.combineTimeSeriesToCreateTimeSeriesRequest(timeSeries)
		reqs = append(reqs, ctsreql...)
	}
	return reqs
}

func (e *statsExporter) viewToMetricDescriptor(ctx context.Context, v *view.View) (*metricpb.MetricDescriptor, error) {
	m := v.Measure
	agg := v.Aggregation
	viewName := v.Name

	metricType := e.metricType(v)
	var valueType metricpb.MetricDescriptor_ValueType
	unit := m.Unit()
	// Default metric Kind
	metricKind := metricpb.MetricDescriptor_CUMULATIVE

	switch agg.Type {
	case view.AggTypeCount:
		valueType = metricpb.MetricDescriptor_INT64
		// If the aggregation type is count, which counts the number of recorded measurements, the unit must be "1",
		// because this view does not apply to the recorded values.
		unit = stats.UnitDimensionless
	case view.AggTypeSum:
		switch m.(type) {
		case *stats.Int64Measure:
			valueType = metricpb.MetricDescriptor_INT64
		case *stats.Float64Measure:
			valueType = metricpb.MetricDescriptor_DOUBLE
		}
	case view.AggTypeDistribution:
		valueType = metricpb.MetricDescriptor_DISTRIBUTION
	case view.AggTypeLastValue:
		metricKind = metricpb.MetricDescriptor_GAUGE
		switch m.(type) {
		case *stats.Int64Measure:
			valueType = metricpb.MetricDescriptor_INT64
		case *stats.Float64Measure:
			valueType = metricpb.MetricDescriptor_DOUBLE
		}
	default:
		return nil, fmt.Errorf("unsupported aggregation type: %s", agg.Type.String())
	}

	var displayName string
	if e.o.GetMetricDisplayName == nil {
		displayName = e.displayName(viewName)
	} else {
		displayName = e.o.GetMetricDisplayName(v)
	}

	res := &metricpb.MetricDescriptor{
		Name:        fmt.Sprintf("projects/%s/metricDescriptors/%s", e.o.ProjectID, metricType),
		DisplayName: displayName,
		Description: v.Description,
		Unit:        unit,
		Type:        metricType,
		MetricKind:  metricKind,
		ValueType:   valueType,
		Labels:      newLabelDescriptors(e.defaultLabels, v.TagKeys),
	}
	return res, nil
}

func (e *statsExporter) viewToCreateMetricDescriptorRequest(ctx context.Context, v *view.View) (*monitoringpb.CreateMetricDescriptorRequest, error) {
	inMD, err := e.viewToMetricDescriptor(ctx, v)
	if err != nil {
		return nil, err
	}

	cmrdesc := &monitoringpb.CreateMetricDescriptorRequest{
		Name:             fmt.Sprintf("projects/%s", e.o.ProjectID),
		MetricDescriptor: inMD,
	}
	return cmrdesc, nil
}

// createMeasure creates a MetricDescriptor for the given view data in Stackdriver Monitoring.
// An error will be returned if there is already a metric descriptor created with the same name
// but it has a different aggregation or keys.
func (e *statsExporter) createMeasure(ctx context.Context, v *view.View) error {
	e.createdViewsMu.Lock()
	defer e.createdViewsMu.Unlock()

	viewName := v.Name

	if md, ok := e.createdViews[viewName]; ok {
		// [TODO:rghetia] Temporary fix for https://github.com/census-ecosystem/opencensus-go-exporter-stackdriver/issues/76#issuecomment-459459091
		if builtinMetric(md.Type) {
			return nil
		}
		return e.equalMeasureAggTagKeys(md, v.Measure, v.Aggregation, v.TagKeys)
	}

	inMD, err := e.viewToMetricDescriptor(ctx, v)
	if err != nil {
		return err
	}

	var dmd *metric.MetricDescriptor
	if builtinMetric(inMD.Type) {
		gmrdesc := &monitoringpb.GetMetricDescriptorRequest{
			Name: inMD.Name,
		}
		dmd, err = getMetricDescriptor(ctx, e.c, gmrdesc)
	} else {
		cmrdesc := &monitoringpb.CreateMetricDescriptorRequest{
			Name:             fmt.Sprintf("projects/%s", e.o.ProjectID),
			MetricDescriptor: inMD,
		}
		dmd, err = createMetricDescriptor(ctx, e.c, cmrdesc)
	}
	if err != nil {
		return err
	}

	// Now cache the metric descriptor
	e.createdViews[viewName] = dmd
	return err
}

func (e *statsExporter) displayName(suffix string) string {
	displayNamePrefix := defaultDisplayNamePrefix
	if e.o.MetricPrefix != "" {
		displayNamePrefix = e.o.MetricPrefix
	}
	return path.Join(displayNamePrefix, suffix)
}

func newPoint(v *view.View, row *view.Row, start, end time.Time) *monitoringpb.Point {
	switch v.Aggregation.Type {
	case view.AggTypeLastValue:
		return newGaugePoint(v, row, end)
	default:
		return newCumulativePoint(v, row, start, end)
	}
}

func newCumulativePoint(v *view.View, row *view.Row, start, end time.Time) *monitoringpb.Point {
	return &monitoringpb.Point{
		Interval: &monitoringpb.TimeInterval{
			StartTime: &timestamp.Timestamp{
				Seconds: start.Unix(),
				Nanos:   int32(start.Nanosecond()),
			},
			EndTime: &timestamp.Timestamp{
				Seconds: end.Unix(),
				Nanos:   int32(end.Nanosecond()),
			},
		},
		Value: newTypedValue(v, row),
	}
}

func newGaugePoint(v *view.View, row *view.Row, end time.Time) *monitoringpb.Point {
	gaugeTime := &timestamp.Timestamp{
		Seconds: end.Unix(),
		Nanos:   int32(end.Nanosecond()),
	}
	return &monitoringpb.Point{
		Interval: &monitoringpb.TimeInterval{
			EndTime: gaugeTime,
		},
		Value: newTypedValue(v, row),
	}
}

func newTypedValue(vd *view.View, r *view.Row) *monitoringpb.TypedValue {
	switch v := r.Data.(type) {
	case *view.CountData:
		return &monitoringpb.TypedValue{Value: &monitoringpb.TypedValue_Int64Value{
			Int64Value: v.Value,
		}}
	case *view.SumData:
		switch vd.Measure.(type) {
		case *stats.Int64Measure:
			return &monitoringpb.TypedValue{Value: &monitoringpb.TypedValue_Int64Value{
				Int64Value: int64(v.Value),
			}}
		case *stats.Float64Measure:
			return &monitoringpb.TypedValue{Value: &monitoringpb.TypedValue_DoubleValue{
				DoubleValue: v.Value,
			}}
		}
	case *view.DistributionData:
		insertZeroBound := shouldInsertZeroBound(vd.Aggregation.Buckets...)
		return &monitoringpb.TypedValue{Value: &monitoringpb.TypedValue_DistributionValue{
			DistributionValue: &distributionpb.Distribution{
				Count:                 v.Count,
				Mean:                  v.Mean,
				SumOfSquaredDeviation: v.SumOfSquaredDev,
				// TODO(songya): uncomment this once Stackdriver supports min/max.
				// Range: &distributionpb.Distribution_Range{
				// 	Min: v.Min,
				// 	Max: v.Max,
				// },
				BucketOptions: &distributionpb.Distribution_BucketOptions{
					Options: &distributionpb.Distribution_BucketOptions_ExplicitBuckets{
						ExplicitBuckets: &distributionpb.Distribution_BucketOptions_Explicit{
							Bounds: addZeroBoundOnCondition(insertZeroBound, vd.Aggregation.Buckets...),
						},
					},
				},
				BucketCounts: addZeroBucketCountOnCondition(insertZeroBound, v.CountPerBucket...),
			},
		}}
	case *view.LastValueData:
		switch vd.Measure.(type) {
		case *stats.Int64Measure:
			return &monitoringpb.TypedValue{Value: &monitoringpb.TypedValue_Int64Value{
				Int64Value: int64(v.Value),
			}}
		case *stats.Float64Measure:
			return &monitoringpb.TypedValue{Value: &monitoringpb.TypedValue_DoubleValue{
				DoubleValue: v.Value,
			}}
		}
	}
	return nil
}

func shouldInsertZeroBound(bounds ...float64) bool {
	if len(bounds) > 0 && bounds[0] != 0.0 {
		return true
	}
	return false
}

func addZeroBucketCountOnCondition(insert bool, counts ...int64) []int64 {
	if insert {
		return append([]int64{0}, counts...)
	}
	return counts
}

func addZeroBoundOnCondition(insert bool, bounds ...float64) []float64 {
	if insert {
		return append([]float64{0.0}, bounds...)
	}
	return bounds
}

func (e *statsExporter) metricType(v *view.View) string {
	if formatter := e.o.GetMetricType; formatter != nil {
		return formatter(v)
	}
	return path.Join("custom.googleapis.com", "opencensus", v.Name)
}

func newLabels(defaults map[string]labelValue, tags []tag.Tag) map[string]string {
	labels := make(map[string]string)
	for k, lbl := range defaults {
		labels[sanitize(k)] = lbl.val
	}
	for _, tag := range tags {
		labels[sanitize(tag.Key.Name())] = tag.Value
	}
	return labels
}

func newLabelDescriptors(defaults map[string]labelValue, keys []tag.Key) []*labelpb.LabelDescriptor {
	labelDescriptors := make([]*labelpb.LabelDescriptor, 0, len(keys)+len(defaults))
	for key, lbl := range defaults {
		labelDescriptors = append(labelDescriptors, &labelpb.LabelDescriptor{
			Key:         sanitize(key),
			Description: lbl.desc,
			ValueType:   labelpb.LabelDescriptor_STRING,
		})
	}
	for _, key := range keys {
		labelDescriptors = append(labelDescriptors, &labelpb.LabelDescriptor{
			Key:       sanitize(key.Name()),
			ValueType: labelpb.LabelDescriptor_STRING, // We only use string tags
		})
	}
	return labelDescriptors
}

func (e *statsExporter) equalMeasureAggTagKeys(md *metricpb.MetricDescriptor, m stats.Measure, agg *view.Aggregation, keys []tag.Key) error {
	var aggTypeMatch bool
	switch md.ValueType {
	case metricpb.MetricDescriptor_INT64:
		if _, ok := m.(*stats.Int64Measure); !(ok || agg.Type == view.AggTypeCount) {
			return fmt.Errorf("stackdriver metric descriptor was not created as int64")
		}
		aggTypeMatch = agg.Type == view.AggTypeCount || agg.Type == view.AggTypeSum || agg.Type == view.AggTypeLastValue
	case metricpb.MetricDescriptor_DOUBLE:
		if _, ok := m.(*stats.Float64Measure); !ok {
			return fmt.Errorf("stackdriver metric descriptor was not created as double")
		}
		aggTypeMatch = agg.Type == view.AggTypeSum || agg.Type == view.AggTypeLastValue
	case metricpb.MetricDescriptor_DISTRIBUTION:
		aggTypeMatch = agg.Type == view.AggTypeDistribution
	}

	if !aggTypeMatch {
		return fmt.Errorf("stackdriver metric descriptor was not created with aggregation type %T", agg.Type)
	}

	labels := make(map[string]struct{}, len(keys)+len(e.defaultLabels))
	for _, k := range keys {
		labels[sanitize(k.Name())] = struct{}{}
	}
	for k := range e.defaultLabels {
		labels[sanitize(k)] = struct{}{}
	}

	for _, k := range md.Labels {
		if _, ok := labels[k.Key]; !ok {
			return fmt.Errorf("stackdriver metric descriptor %q was not created with label %q", md.Type, k)
		}
		delete(labels, k.Key)
	}

	if len(labels) > 0 {
		extra := make([]string, 0, len(labels))
		for k := range labels {
			extra = append(extra, k)
		}
		return fmt.Errorf("stackdriver metric descriptor %q contains unexpected labels: %s", md.Type, strings.Join(extra, ", "))
	}

	return nil
}

var createMetricDescriptor = func(ctx context.Context, c *monitoring.MetricClient, mdr *monitoringpb.CreateMetricDescriptorRequest) (*metric.MetricDescriptor, error) {
	return c.CreateMetricDescriptor(ctx, mdr)
}

var getMetricDescriptor = func(ctx context.Context, c *monitoring.MetricClient, mdr *monitoringpb.GetMetricDescriptorRequest) (*metric.MetricDescriptor, error) {
	return c.GetMetricDescriptor(ctx, mdr)
}

var createTimeSeries = func(ctx context.Context, c *monitoring.MetricClient, ts *monitoringpb.CreateTimeSeriesRequest) error {
	return c.CreateTimeSeries(ctx, ts)
}

var knownExternalMetricPrefixes = []string{
	"custom.googleapis.com/",
	"external.googleapis.com/",
}

// builtinMetric returns true if a MetricType is a heuristically known
// built-in Stackdriver metric
func builtinMetric(metricType string) bool {
	for _, knownExternalMetric := range knownExternalMetricPrefixes {
		if strings.HasPrefix(metricType, knownExternalMetric) {
			return false
		}
	}
	return true
}
