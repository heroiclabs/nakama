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
	"os"

	"cloud.google.com/go/compute/metadata"
	"contrib.go.opencensus.io/exporter/stackdriver"
	"contrib.go.opencensus.io/exporter/stackdriver/propagation"
	"go.opencensus.io/plugin/ochttp"
	"go.opencensus.io/stats/view"
	"go.opencensus.io/trace"
	"google.golang.org/genproto/googleapis/api/monitoredres"
)

func Example_defaults() {
	exporter, err := stackdriver.NewExporter(stackdriver.Options{ProjectID: "google-project-id"})
	if err != nil {
		log.Fatal(err)
	}

	// Export to Stackdriver Monitoring.
	view.RegisterExporter(exporter)

	// Subscribe views to see stats in Stackdriver Monitoring.
	if err := view.Register(
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

func Example_gKE() {

	// This example shows how to set up a Stackdriver exporter suitable for
	// monitoring a GKE container.

	instanceID, err := metadata.InstanceID()
	if err != nil {
		log.Println("Error getting instance ID:", err)
		instanceID = "unknown"
	}
	zone, err := metadata.Zone()
	if err != nil {
		log.Println("Error getting zone:", err)
		zone = "unknown"
	}

	exporter, err := stackdriver.NewExporter(stackdriver.Options{
		ProjectID: "google-project-id",
		// Set a MonitoredResource that represents a GKE container.
		Resource: &monitoredres.MonitoredResource{
			Type: "gke_container",
			Labels: map[string]string{
				"project_id":   "google-project-id",
				"cluster_name": "my-cluster-name",
				"instance_id":  instanceID,
				"zone":         zone,

				// See: https://kubernetes.io/docs/tasks/inject-data-application/environment-variable-expose-pod-information/
				"namespace_id":   os.Getenv("MY_POD_NAMESPACE"),
				"pod_id":         os.Getenv("MY_POD_NAME"),
				"container_name": os.Getenv("MY_CONTAINER_NAME"),
			},
		},
		// Set DefaultMonitoringLabels to avoid getting the default "opencensus_task"
		// label. For this to be valid, this exporter should be the only writer
		// to the metrics against this gke_container MonitoredResource. In this case,
		// it means you should only have one process writing to Stackdriver from this
		// container.
		DefaultMonitoringLabels: &stackdriver.Labels{},
	})
	if err != nil {
		log.Fatal(err)
	}

	// Register so that views are exported.
	view.RegisterExporter(exporter)
}
