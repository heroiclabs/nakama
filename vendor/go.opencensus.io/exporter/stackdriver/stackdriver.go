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
// Stackdriver Monitoring and Tracing.
//
// Please note that the Stackdriver exporter is currently experimental.
//
// Create an exporter:
//
// 	import (
// 		"go.opencensus.io/exporter/stackdriver"
// 		"go.opencensus.io/trace"
// 		"go.opencensus.io/stats"
// 	)
//
// 	exporter, err := stackdriver.NewExporter(stackdriver.Options{ProjectID: "google-project-id"})
// 	if err != nil {
// 		log.Fatal(err)
// 	}
//
// Export to Stackdriver Stats:
//
// 	stats.RegisterExporter(exporter)
//
// Export to Stackdriver Trace:
//
// 	trace.RegisterExporter(exporter)
//
// The package uses Application Default Credentials to authenticate.  See
// https://developers.google.com/identity/protocols/application-default-credentials
//
// Exporter can be used to propagate traces over HTTP requests for Stackdriver Trace.
//
// Example:
//
// 	import (
// 		"go.opencensus.io/plugin/http/httptrace"
// 		"go.opencensus.io/plugin/http/propagation/google"
// 	)
//
//	client := &http.Client {
//		Transport: httptrace.NewTransport(nil, &google.HTTPFormat{}),
//	}
//
// All outgoing requests from client will include a Stackdriver Trace header.
// See the httptrace package for how to handle incoming requests.
package stackdriver

import (
	"time"

	"go.opencensus.io/stats"
	"go.opencensus.io/trace"
	"google.golang.org/api/option"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
)

// Options contains options for configuring the exporter.
type Options struct {
	// ProjectID is the identifier of the Stackdriver
	// project the user is uploading the stats data to.
	ProjectID string

	// OnError is the hook to be called when there is
	// an error occurred when uploading the stats data.
	// If no custom hook is set, errors are logged.
	// Optional.
	OnError func(err error)

	// ClientOptions are additional options to be passed
	// to the underlying Stackdriver Monitoring API client.
	// Optional.
	ClientOptions []option.ClientOption

	// BundleDelayThreshold determines the max amount of time
	// the exporter can wait before uploading view data to
	// the backend.
	// Optional.
	BundleDelayThreshold time.Duration

	// BundleCountThreshold determines how many view data events
	// can be buffered before batch uploading them to the backend.
	// Optional.
	BundleCountThreshold int

	// Resource is an optional field that represents the Stackdriver
	// MonitoredResource, a resource that can be used for monitoring.
	// If no custom ResourceDescriptor is set, a default MonitoredResource
	// with type global and no resource labels will be used.
	// Optional.
	Resource *monitoredrespb.MonitoredResource
}

// Exporter is a stats.Exporter and trace.Exporter
// implementation that uploads data to Stackdriver.
type Exporter struct {
	traceExporter *traceExporter
	statsExporter *statsExporter
}

func NewExporter(o Options) (*Exporter, error) {
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
func (e *Exporter) ExportView(vd *stats.ViewData) {
	e.statsExporter.ExportView(vd)
}

// ExportSpan exports a SpanData to Stackdriver Trace.
func (e *Exporter) ExportSpan(sd *trace.SpanData) {
	e.traceExporter.ExportSpan(sd)
}

// Flush waits for exported data to be uploaded.
//
// This is useful if your program is ending and you do not
// want to lose recent stats or spans.
func (e *Exporter) Flush() {
	e.statsExporter.Flush()
	e.traceExporter.Flush()
}
