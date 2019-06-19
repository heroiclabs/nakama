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

// Package stackdriver contains the OpenCensus exporters for
// Stackdriver Monitoring and Stackdriver Tracing.
//
// This exporter can be used to send metrics to Stackdriver Monitoring and traces
// to Stackdriver trace.
//
// The package uses Application Default Credentials to authenticate by default.
// See: https://developers.google.com/identity/protocols/application-default-credentials
//
// Alternatively, pass the authentication options in both the MonitoringClientOptions
// and the TraceClientOptions fields of Options.
//
// Stackdriver Monitoring
//
// This exporter support exporting OpenCensus views to Stackdriver Monitoring.
// Each registered view becomes a metric in Stackdriver Monitoring, with the
// tags becoming labels.
//
// The aggregation function determines the metric kind: LastValue aggregations
// generate Gauge metrics and all other aggregations generate Cumulative metrics.
//
// In order to be able to push your stats to Stackdriver Monitoring, you must:
//
//   1. Create a Cloud project: https://support.google.com/cloud/answer/6251787?hl=en
//   2. Enable billing: https://support.google.com/cloud/answer/6288653#new-billing
//   3. Enable the Stackdriver Monitoring API: https://console.cloud.google.com/apis/dashboard
//
// These steps enable the API but don't require that your app is hosted on Google Cloud Platform.
//
// Stackdriver Trace
//
// This exporter supports exporting Trace Spans to Stackdriver Trace. It also
// supports the Google "Cloud Trace" propagation format header.
package stackdriver // import "contrib.go.opencensus.io/exporter/stackdriver"

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path"
	"time"

	metadataapi "cloud.google.com/go/compute/metadata"
	traceapi "cloud.google.com/go/trace/apiv2"
	"contrib.go.opencensus.io/exporter/stackdriver/monitoredresource"
	"go.opencensus.io/resource"
	"go.opencensus.io/stats/view"
	"go.opencensus.io/tag"
	"go.opencensus.io/trace"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"

	commonpb "github.com/census-instrumentation/opencensus-proto/gen-go/agent/common/v1"
	metricspb "github.com/census-instrumentation/opencensus-proto/gen-go/metrics/v1"
	resourcepb "github.com/census-instrumentation/opencensus-proto/gen-go/resource/v1"
	"go.opencensus.io/metric/metricdata"
)

// Options contains options for configuring the exporter.
type Options struct {
	// ProjectID is the identifier of the Stackdriver
	// project the user is uploading the stats data to.
	// If not set, this will default to your "Application Default Credentials".
	// For details see: https://developers.google.com/accounts/docs/application-default-credentials.
	//
	// It will be used in the project_id label of a Stackdriver monitored
	// resource if the resource does not inherently belong to a specific
	// project, e.g. on-premise resource like k8s_container or generic_task.
	ProjectID string

	// Location is the identifier of the GCP or AWS cloud region/zone in which
	// the data for a resource is stored.
	// If not set, it will default to the location provided by the metadata server.
	//
	// It will be used in the location label of a Stackdriver monitored resource
	// if the resource does not inherently belong to a specific project, e.g.
	// on-premise resource like k8s_container or generic_task.
	Location string

	// OnError is the hook to be called when there is
	// an error uploading the stats or tracing data.
	// If no custom hook is set, errors are logged.
	// Optional.
	OnError func(err error)

	// MonitoringClientOptions are additional options to be passed
	// to the underlying Stackdriver Monitoring API client.
	// Optional.
	MonitoringClientOptions []option.ClientOption

	// TraceClientOptions are additional options to be passed
	// to the underlying Stackdriver Trace API client.
	// Optional.
	TraceClientOptions []option.ClientOption

	// BundleDelayThreshold determines the max amount of time
	// the exporter can wait before uploading view data or trace spans to
	// the backend.
	// Optional.
	BundleDelayThreshold time.Duration

	// BundleCountThreshold determines how many view data events or trace spans
	// can be buffered before batch uploading them to the backend.
	// Optional.
	BundleCountThreshold int

	// TraceSpansBufferMaxBytes is the maximum size (in bytes) of spans that
	// will be buffered in memory before being dropped.
	//
	// If unset, a default of 8MB will be used.
	TraceSpansBufferMaxBytes int

	// Resource sets the MonitoredResource against which all views will be
	// recorded by this exporter.
	//
	// All Stackdriver metrics created by this exporter are custom metrics,
	// so only a limited number of MonitoredResource types are supported, see:
	// https://cloud.google.com/monitoring/custom-metrics/creating-metrics#which-resource
	//
	// An important consideration when setting the Resource here is that
	// Stackdriver Monitoring only allows a single writer per
	// TimeSeries, see: https://cloud.google.com/monitoring/api/v3/metrics-details#intro-time-series
	// A TimeSeries is uniquely defined by the metric type name
	// (constructed from the view name and the MetricPrefix), the Resource field,
	// and the set of label key/value pairs (in OpenCensus terminology: tag).
	//
	// If no custom Resource is set, a default MonitoredResource
	// with type global and no resource labels will be used. If you explicitly
	// set this field, you may also want to set custom DefaultMonitoringLabels.
	//
	// Deprecated: Use MonitoredResource instead.
	Resource *monitoredrespb.MonitoredResource

	// MonitoredResource sets the MonitoredResource against which all views will be
	// recorded by this exporter.
	//
	// All Stackdriver metrics created by this exporter are custom metrics,
	// so only a limited number of MonitoredResource types are supported, see:
	// https://cloud.google.com/monitoring/custom-metrics/creating-metrics#which-resource
	//
	// An important consideration when setting the MonitoredResource here is that
	// Stackdriver Monitoring only allows a single writer per
	// TimeSeries, see: https://cloud.google.com/monitoring/api/v3/metrics-details#intro-time-series
	// A TimeSeries is uniquely defined by the metric type name
	// (constructed from the view name and the MetricPrefix), the MonitoredResource field,
	// and the set of label key/value pairs (in OpenCensus terminology: tag).
	//
	// If no custom MonitoredResource is set AND if Resource is also not set then
	// a default MonitoredResource with type global and no resource labels will be used.
	// If you explicitly set this field, you may also want to set custom DefaultMonitoringLabels.
	//
	// This field replaces Resource field. If this is set then it will override the
	// Resource field.
	// Optional, but encouraged.
	MonitoredResource monitoredresource.Interface

	// ResourceDetector provides a hook to discover arbitrary resource information.
	//
	// The translation function provided in MapResource must be able to conver the
	// the resource information to a Stackdriver monitored resource.
	//
	// If this field is unset, resource type and tags will automatically be discovered through
	// the OC_RESOURCE_TYPE and OC_RESOURCE_LABELS environment variables.
	ResourceDetector resource.Detector

	// MapResource converts a OpenCensus resource to a Stackdriver monitored resource.
	//
	// If this field is unset, defaultMapResource will be used which encodes a set of default
	// conversions from auto-detected resources to well-known Stackdriver monitored resources.
	MapResource func(*resource.Resource) *monitoredrespb.MonitoredResource

	// MetricPrefix overrides the prefix of a Stackdriver metric display names.
	// Optional. If unset defaults to "OpenCensus/".
	// Deprecated: Provide GetMetricDisplayName to change the display name of
	// the metric.
	// If GetMetricDisplayName is non-nil, this option is ignored.
	MetricPrefix string

	// GetMetricDisplayName allows customizing the display name for the metric
	// associated with the given view. By default it will be:
	//   MetricPrefix + view.Name
	GetMetricDisplayName func(view *view.View) string

	// GetMetricType allows customizing the metric type for the given view.
	// By default, it will be:
	//   "custom.googleapis.com/opencensus/" + view.Name
	//
	// See: https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.metricDescriptors#MetricDescriptor
	GetMetricType func(view *view.View) string

	// DefaultTraceAttributes will be appended to every span that is exported to
	// Stackdriver Trace.
	DefaultTraceAttributes map[string]interface{}

	// DefaultMonitoringLabels are labels added to every metric created by this
	// exporter in Stackdriver Monitoring.
	//
	// If unset, this defaults to a single label with key "opencensus_task" and
	// value "go-<pid>@<hostname>". This default ensures that the set of labels
	// together with the default Resource (global) are unique to this
	// process, as required by Stackdriver Monitoring.
	//
	// If you set DefaultMonitoringLabels, make sure that the Resource field
	// together with these labels is unique to the
	// current process. This is to ensure that there is only a single writer to
	// each TimeSeries in Stackdriver.
	//
	// Set this to &Labels{} (a pointer to an empty Labels) to avoid getting the
	// default "opencensus_task" label. You should only do this if you know that
	// the Resource you set uniquely identifies this Go process.
	DefaultMonitoringLabels *Labels

	// Context allows you to provide a custom context for API calls.
	//
	// This context will be used several times: first, to create Stackdriver
	// trace and metric clients, and then every time a new batch of traces or
	// stats needs to be uploaded.
	//
	// Do not set a timeout on this context. Instead, set the Timeout option.
	//
	// If unset, context.Background() will be used.
	Context context.Context

	// Timeout for all API calls. If not set, defaults to 5 seconds.
	Timeout time.Duration

	// GetMonitoredResource may be provided to supply the details of the
	// monitored resource dynamically based on the tags associated with each
	// data point. Most users will not need to set this, but should instead
	// set the MonitoredResource field.
	//
	// GetMonitoredResource may add or remove tags by returning a new set of
	// tags. It is safe for the function to mutate its argument and return it.
	//
	// See the documentation on the MonitoredResource field for guidance on the
	// interaction between monitored resources and labels.
	//
	// The MonitoredResource field is ignored if this field is set to a non-nil
	// value.
	GetMonitoredResource func(*view.View, []tag.Tag) ([]tag.Tag, monitoredresource.Interface)

	// ReportingInterval sets the interval between reporting metrics.
	// If it is set to zero then default value is used.
	ReportingInterval time.Duration
}

const defaultTimeout = 5 * time.Second

// Exporter is a stats and trace exporter that uploads data to Stackdriver.
//
// You can create a single Exporter and register it as both a trace exporter
// (to export to Stackdriver Trace) and a stats exporter (to integrate with
// Stackdriver Monitoring).
type Exporter struct {
	traceExporter *traceExporter
	statsExporter *statsExporter
}

// NewExporter creates a new Exporter that implements both stats.Exporter and
// trace.Exporter.
func NewExporter(o Options) (*Exporter, error) {
	if o.ProjectID == "" {
		ctx := o.Context
		if ctx == nil {
			ctx = context.Background()
		}
		creds, err := google.FindDefaultCredentials(ctx, traceapi.DefaultAuthScopes()...)
		if err != nil {
			return nil, fmt.Errorf("stackdriver: %v", err)
		}
		if creds.ProjectID == "" {
			return nil, errors.New("stackdriver: no project found with application default credentials")
		}
		o.ProjectID = creds.ProjectID
	}
	if o.Location == "" {
		ctx := o.Context
		if ctx == nil {
			ctx = context.Background()
		}
		zone, err := metadataapi.Zone()
		if err != nil {
			log.Printf("Setting Stackdriver default location failed: %s", err)
		} else {
			log.Printf("Setting Stackdriver default location to %q", zone)
			o.Location = zone
		}
	}

	if o.MonitoredResource != nil {
		o.Resource = convertMonitoredResourceToPB(o.MonitoredResource)
	}
	if o.MapResource == nil {
		o.MapResource = defaultMapResource
	}
	if o.ResourceDetector != nil {
		// For backwards-compatibility we still respect the deprecated resource field.
		if o.Resource != nil {
			return nil, errors.New("stackdriver: ResourceDetector must not be used in combination with deprecated resource fields")
		}
		res, err := o.ResourceDetector(o.Context)
		if err != nil {
			return nil, fmt.Errorf("stackdriver: detect resource: %s", err)
		}
		// Populate internal resource labels for defaulting project_id, location, and
		// generic resource labels of applicable monitored resources.
		res.Labels[stackdriverProjectID] = o.ProjectID
		res.Labels[stackdriverLocation] = o.Location
		res.Labels[stackdriverGenericTaskNamespace] = "default"
		res.Labels[stackdriverGenericTaskJob] = path.Base(os.Args[0])
		res.Labels[stackdriverGenericTaskID] = getTaskValue()

		o.Resource = o.MapResource(res)
	}

	se, err := newStatsExporter(o)
	if err != nil {
		return nil, err
	}
	te, err := newTraceExporter(o)
	if err != nil {
		return nil, err
	}
	return &Exporter{
		statsExporter: se,
		traceExporter: te,
	}, nil
}

// ExportView exports to the Stackdriver Monitoring if view data
// has one or more rows.
func (e *Exporter) ExportView(vd *view.Data) {
	e.statsExporter.ExportView(vd)
}

// ExportMetricsProto exports OpenCensus Metrics Proto to Stackdriver Monitoring.
func (e *Exporter) ExportMetricsProto(ctx context.Context, node *commonpb.Node, rsc *resourcepb.Resource, metrics []*metricspb.Metric) error {
	return e.statsExporter.ExportMetricsProto(ctx, node, rsc, metrics)
}

// ExportMetrics exports OpenCensus Metrics to Stackdriver Monitoring
func (e *Exporter) ExportMetrics(ctx context.Context, metrics []*metricdata.Metric) error {
	return e.statsExporter.ExportMetrics(ctx, metrics)
}

// StartMetricsExporter starts exporter by creating an interval reader that reads metrics
// from all registered producers at set interval and exports them.
// Use StopMetricsExporter to stop exporting metrics.
// Previously, it required registering exporter to export stats collected by opencensus.
//    exporter := stackdriver.NewExporter(stackdriver.Option{})
//    view.RegisterExporter(exporter)
// Now, it requires to call StartMetricsExporter() to export stats and metrics collected by opencensus.
//    exporter := stackdriver.NewExporter(stackdriver.Option{})
//    exporter.StartMetricsExporter()
//    defer exporter.StopMetricsExporter()
//
// Both approach should not be used simultaenously. Otherwise it may result into unknown behavior.
// Previous approach continues to work as before but will not report newly define metrics such
// as gauges.
func (e *Exporter) StartMetricsExporter() error {
	return e.statsExporter.startMetricsReader()
}

// StopMetricsExporter stops exporter from exporting metrics.
func (e *Exporter) StopMetricsExporter() {
	e.statsExporter.stopMetricsReader()
}

// ExportSpan exports a SpanData to Stackdriver Trace.
func (e *Exporter) ExportSpan(sd *trace.SpanData) {
	if len(e.traceExporter.o.DefaultTraceAttributes) > 0 {
		sd = e.sdWithDefaultTraceAttributes(sd)
	}
	e.traceExporter.ExportSpan(sd)
}

func (e *Exporter) sdWithDefaultTraceAttributes(sd *trace.SpanData) *trace.SpanData {
	newSD := *sd
	newSD.Attributes = make(map[string]interface{})
	for k, v := range e.traceExporter.o.DefaultTraceAttributes {
		newSD.Attributes[k] = v
	}
	for k, v := range sd.Attributes {
		newSD.Attributes[k] = v
	}
	return &newSD
}

// Flush waits for exported data to be uploaded.
//
// This is useful if your program is ending and you do not
// want to lose recent stats or spans.
func (e *Exporter) Flush() {
	e.statsExporter.Flush()
	e.traceExporter.Flush()
}

func (o Options) handleError(err error) {
	if o.OnError != nil {
		o.OnError(err)
		return
	}
	log.Printf("Failed to export to Stackdriver: %v", err)
}

func (o Options) newContextWithTimeout() (context.Context, func()) {
	ctx := o.Context
	if ctx == nil {
		ctx = context.Background()
	}
	timeout := o.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	return context.WithTimeout(ctx, timeout)
}

// convertMonitoredResourceToPB converts MonitoredResource data in to
// protocol buffer.
func convertMonitoredResourceToPB(mr monitoredresource.Interface) *monitoredrespb.MonitoredResource {
	mrpb := new(monitoredrespb.MonitoredResource)
	var labels map[string]string
	mrpb.Type, labels = mr.MonitoredResource()
	mrpb.Labels = make(map[string]string)
	for k, v := range labels {
		mrpb.Labels[k] = v
	}
	return mrpb
}
