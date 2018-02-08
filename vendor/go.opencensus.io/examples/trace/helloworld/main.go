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

// Command helloworld is an example program that creates spans.
package main

import (
	"context"
	"log"
	"time"

	"go.opencensus.io/trace"
)

func main() {
	ctx := context.Background()

	// Register an exporter to be able to retrieve
	// the collected spans.
	trace.RegisterExporter(&exporter{})

	trace.SetDefaultSampler(trace.AlwaysSample())

	ctx, span := trace.StartSpan(ctx, "/foo")
	bar(ctx)
	span.End()

	time.Sleep(1 * time.Second) // Wait enough for the exporter to report.
}

func bar(ctx context.Context) {
	ctx, span := trace.StartSpan(ctx, "/bar")
	defer span.End()

	// Do bar...
}

type exporter struct{}

func (e *exporter) ExportSpan(sd *trace.SpanData) {
	log.Println(sd)
}
