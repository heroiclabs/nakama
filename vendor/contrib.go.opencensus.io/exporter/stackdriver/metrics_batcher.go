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

import (
	"context"
	"fmt"
	"strings"

	monitoring "cloud.google.com/go/monitoring/apiv3"
	monitoringpb "google.golang.org/genproto/googleapis/monitoring/v3"
)

type metricsBatcher struct {
	projectName string
	allReqs     []*monitoringpb.CreateTimeSeriesRequest
	allTss      []*monitoringpb.TimeSeries
	allErrs     []error
	// Counts all dropped TimeSeries by this exporter.
	droppedTimeSeries int
}

func newMetricsBatcher(projectID string) *metricsBatcher {
	return &metricsBatcher{
		projectName:       fmt.Sprintf("projects/%s", projectID),
		allTss:            make([]*monitoringpb.TimeSeries, 0, maxTimeSeriesPerUpload),
		droppedTimeSeries: 0,
	}
}

func (mb *metricsBatcher) recordDroppedTimeseries(numTimeSeries int, err error) {
	mb.droppedTimeSeries += numTimeSeries
	mb.allErrs = append(mb.allErrs, err)
}

func (mb *metricsBatcher) addTimeSeries(ts *monitoringpb.TimeSeries) {
	mb.allTss = append(mb.allTss, ts)
	if len(mb.allTss) == maxTimeSeriesPerUpload {
		mb.allReqs = append(mb.allReqs, &monitoringpb.CreateTimeSeriesRequest{
			Name:       mb.projectName,
			TimeSeries: mb.allTss,
		})
		mb.allTss = make([]*monitoringpb.TimeSeries, 0, maxTimeSeriesPerUpload)
	}
}

func (mb *metricsBatcher) export(ctx context.Context, mc *monitoring.MetricClient) {
	// Last batch, if any.
	if len(mb.allTss) > 0 {
		mb.allReqs = append(mb.allReqs, &monitoringpb.CreateTimeSeriesRequest{
			Name:       mb.projectName,
			TimeSeries: mb.allTss,
		})
	}

	// Send create time series requests to Stackdriver.
	for _, req := range mb.allReqs {
		if err := createTimeSeries(ctx, mc, req); err != nil {
			mb.recordDroppedTimeseries(len(req.TimeSeries), err)
		}
	}
}

func (mb *metricsBatcher) finalError() error {
	numErrors := len(mb.allErrs)
	if numErrors == 0 {
		return nil
	}

	if numErrors == 1 {
		return mb.allErrs[0]
	}

	errMsgs := make([]string, 0, numErrors)
	for _, err := range mb.allErrs {
		errMsgs = append(errMsgs, err.Error())
	}
	return fmt.Errorf("[%s]", strings.Join(errMsgs, "; "))
}
