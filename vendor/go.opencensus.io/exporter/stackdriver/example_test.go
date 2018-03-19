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

package stackdriver_test

import (
	"log"
	"net/http"

	"go.opencensus.io/exporter/stackdriver"
	"go.opencensus.io/exporter/stackdriver/propagation"
	"go.opencensus.io/plugin/ochttp"
	"go.opencensus.io/stats/view"
	"go.opencensus.io/trace"
)

func Example() {
	exporter, err := stackdriver.NewExporter(stackdriver.Options{ProjectID: "google-project-id"})
	if err != nil {
		log.Fatal(err)
	}

	// Export to Stackdriver Monitoring.
	view.RegisterExporter(exporter)

	// Subscribe views to see stats in Stackdriver Monitoring.
	if err := view.Subscribe(
		ochttp.ClientLatencyView,
		ochttp.ClientResponseBytesView,
	); err != nil {
		log.Fatal(err)
	}

	// Export to Stackdriver Trace.
	trace.RegisterExporter(exporter)

	// Automatically add a Stackdriver trace header to outgoing requests:
	client := &http.Client{
		Transport: &ochttp.Transport{
			Propagation: &propagation.HTTPFormat{},
		},
	}
	_ = client // use client

	// All outgoing requests from client will include a Stackdriver Trace header.
	// See the ochttp package for how to handle incoming requests.
}
