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

// Package readme generates the README.
package readme

import (
	"context"
	"log"
	"time"

	"go.opencensus.io/stats"
)

// README.md is generated with the examples here by using embedmd.
// For more details, see https://github.com/rakyll/embedmd.

func statsExamples() {
	ctx := context.Background()

	// START measure
	videoSize, err := stats.NewMeasureInt64("my.org/video_size", "processed video size", "MB")
	if err != nil {
		log.Fatal(err)
	}
	// END measure
	_ = videoSize

	// START findMeasure
	m := stats.FindMeasure("my.org/video_size")
	if m == nil {
		log.Fatalln("measure not found")
	}
	// END findMeasure

	_ = m

	// START deleteMeasure
	if err := stats.DeleteMeasure(m); err != nil {
		log.Fatal(err)
	}
	// END deleteMeasure

	// START aggs
	distAgg := stats.DistributionAggregation([]float64{0, 1 << 32, 2 << 32, 3 << 32})
	countAgg := stats.CountAggregation{}
	sumAgg := stats.SumAggregation{}
	meanAgg := stats.MeanAggregation{}
	// END aggs

	_, _, _, _ = distAgg, countAgg, sumAgg, meanAgg

	// START windows
	cum := stats.Cumulative{}
	// END windows

	// START view
	view, err := stats.NewView(
		"my.org/video_size_distribution",
		"distribution of processed video size over time",
		nil,
		videoSize,
		distAgg,
		cum,
	)
	if err != nil {
		log.Fatalf("cannot create view: %v", err)
	}
	if err := stats.RegisterView(view); err != nil {
		log.Fatal(err)
	}
	// END view

	// START findView
	v := stats.FindView("my.org/video_size_distribution")
	if v == nil {
		log.Fatalln("view not found")
	}
	// END findView

	_ = v

	// START unregisterView
	if err = stats.UnregisterView(v); err != nil {
		log.Fatal(err)
	}
	// END unregisterView

	// START reportingPeriod
	stats.SetReportingPeriod(5 * time.Second)
	// END reportingPeriod

	// START record
	stats.Record(ctx, videoSize.M(102478))
	// END record

	// START subscribe
	if err := view.Subscribe(); err != nil {
		log.Fatal(err)
	}
	// END subscribe

	// START registerExporter
	// Register an exporter to be able to retrieve
	// the data from the subscribed views.
	stats.RegisterExporter(&exporter{})
	// END registerExporter
}

// START exporter

type exporter struct{}

func (e *exporter) ExportView(vd *stats.ViewData) {
	log.Println(vd)
}

// END exporter
