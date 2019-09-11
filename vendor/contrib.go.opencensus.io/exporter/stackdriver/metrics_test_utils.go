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
Common test utilities for comparing Stackdriver metrics.
*/

import (
	"testing"

	"github.com/golang/protobuf/proto"
	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	googlemetricpb "google.golang.org/genproto/googleapis/api/metric"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
	monitoringpb "google.golang.org/genproto/googleapis/monitoring/v3"
)

func cmpResource(got, want *monitoredrespb.MonitoredResource) string {
	return cmp.Diff(got, want, cmpopts.IgnoreUnexported(monitoredrespb.MonitoredResource{}))
}

func requireTimeSeriesRequestEqual(t *testing.T, got, want []*monitoringpb.CreateTimeSeriesRequest) {
	if len(got) != len(want) {
		t.Fatalf("Unexpected slice len got: %d want: %d", len(got), len(want))
	}
	for i, g := range got {
		w := want[i]
		if !proto.Equal(g, w) {
			t.Fatalf("Unexpected proto difference got: %s want: %s", proto.MarshalTextString(g), proto.MarshalTextString(w))
		}
	}
}

func cmpTSReqs(got, want []*monitoringpb.CreateTimeSeriesRequest) string {
	return cmp.Diff(got, want, cmpopts.IgnoreUnexported(monitoringpb.CreateTimeSeriesRequest{}), cmpopts.IgnoreTypes(googlemetricpb.MetricDescriptor_METRIC_KIND_UNSPECIFIED, googlemetricpb.MetricDescriptor_VALUE_TYPE_UNSPECIFIED))
}

func cmpMD(got, want *googlemetricpb.MetricDescriptor) string {
	return cmp.Diff(got, want, cmpopts.IgnoreUnexported(googlemetricpb.MetricDescriptor{}))
}

func cmpMDReq(got, want *monitoringpb.CreateMetricDescriptorRequest) string {
	return cmp.Diff(got, want, cmpopts.IgnoreUnexported(monitoringpb.CreateMetricDescriptorRequest{}))
}

func cmpMDReqs(got, want []*monitoringpb.CreateMetricDescriptorRequest) string {
	return cmp.Diff(got, want, cmpopts.IgnoreUnexported(monitoringpb.CreateMetricDescriptorRequest{}))
}

func cmpPoint(got, want *monitoringpb.Point) string {
	return cmp.Diff(got, want, cmpopts.IgnoreUnexported(monitoringpb.Point{}))
}
