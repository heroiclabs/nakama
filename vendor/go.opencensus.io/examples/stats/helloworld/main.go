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

// Command helloworld is an example program that collects data for
// video size over a time window.
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.opencensus.io/stats"
)

func main() {
	ctx := context.Background()

	// Register an exporter to be able to retrieve
	// the data from the subscribed views.
	stats.RegisterExporter(&exporter{})

	// Create measures. The program will record measures for the size of
	// processed videos and the nubmer of videos marked as spam.
	videoSize, err := stats.NewMeasureInt64("my.org/measure/video_size", "size of processed videos", "MBy")
	if err != nil {
		log.Fatalf("Video size measure not created: %v", err)
	}

	// Create view to see the processed video size
	// distribution over 10 seconds.
	view, err := stats.NewView(
		"my.org/views/video_size",
		"processed video size over time",
		nil,
		videoSize,
		stats.DistributionAggregation([]float64{0, 1 << 16, 1 << 32}),
		stats.Cumulative{},
	)
	if err != nil {
		log.Fatalf("Cannot create view: %v", err)
	}

	// Set reporting period to report data at every second.
	stats.SetReportingPeriod(1 * time.Second)

	// Subscribe will allow view data to be exported.
	// Once no longer need, you can unsubscribe from the view.
	if err := view.Subscribe(); err != nil {
		log.Fatalf("Cannot subscribe to the view: %v", err)
	}

	// Record data points.
	stats.Record(ctx, videoSize.M(25648), videoSize.M(48000), videoSize.M(128000))

	// Wait for a duration longer than reporting duration to ensure the stats
	// library reports the collected data.
	fmt.Println("Wait longer than the reporting duration...")
	time.Sleep(2 * time.Second)
}

type exporter struct{}

func (e *exporter) ExportView(vd *stats.ViewData) {
	log.Println(vd)
}
