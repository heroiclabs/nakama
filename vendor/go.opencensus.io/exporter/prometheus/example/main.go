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

// Command prometheus is an example program that collects data for
// video size. Collected data is exported to Prometheus.
package main

import (
	"context"
	"log"
	"math/rand"
	"net/http"
	"time"

	"go.opencensus.io/exporter/prometheus"
	"go.opencensus.io/stats"
	"go.opencensus.io/stats/view"
)

func main() {
	ctx := context.Background()

	exporter, err := prometheus.NewExporter(prometheus.Options{})
	if err != nil {
		log.Fatal(err)
	}
	view.RegisterExporter(exporter)

	// Create measures. The program will record measures for the size of
	// processed videos and the number of videos marked as spam.
	videoCount, err := stats.Int64("my.org/measures/video_count", "number of processed videos", "")
	if err != nil {
		log.Fatalf("Video count measure not created: %v", err)
	}
	videoSize, err := stats.Int64("my.org/measures/video_size", "size of processed video", "MBy")
	if err != nil {
		log.Fatalf("Video size measure not created: %v", err)
	}

	// Create view to see the number of processed videos cumulatively.
	// Create view to see the amount of video processed
	// Subscribe will allow view data to be exported.
	// Once no longer needed, you can unsubscribe from the view.
	if err = view.Subscribe(
		&view.View{
			Name:        "video_count",
			Description: "number of videos processed over time",
			Measure:     videoCount,
			Aggregation: &view.CountAggregation{},
		},
		&view.View{
			Name:        "video_size",
			Description: "processed video size over time",
			Measure:     videoSize,
			Aggregation: view.DistributionAggregation{0, 1 << 16, 1 << 32},
		},
	); err != nil {
		log.Fatalf("Cannot subscribe to the view: %v", err)
	}

	// Set reporting period to report data at every second.
	view.SetReportingPeriod(1 * time.Second)

	// Record some data points...
	go func() {
		for {
			stats.Record(ctx, videoCount.M(1), videoSize.M(rand.Int63()))
			<-time.After(time.Millisecond * time.Duration(1+rand.Intn(400)))
		}
	}()

	addr := ":9999"
	log.Printf("Serving at %s", addr)
	http.Handle("/metrics", exporter)
	log.Fatal(http.ListenAndServe(addr, nil))
}
