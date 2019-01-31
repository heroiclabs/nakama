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

package stackdriver

import (
	"context"
	"fmt"
	"testing"
	"time"

	"go.opencensus.io/trace"
	tracepb "google.golang.org/genproto/googleapis/devtools/cloudtrace/v2"
)

func TestBundling(t *testing.T) {
	exporter := newTraceExporterWithClient(Options{
		ProjectID:            "fakeProjectID",
		BundleDelayThreshold: time.Second / 10,
		BundleCountThreshold: 10,
	}, nil)

	ch := make(chan []*tracepb.Span)
	exporter.uploadFn = func(spans []*tracepb.Span) {
		ch <- spans
	}
	trace.RegisterExporter(exporter)

	for i := 0; i < 35; i++ {
		_, span := trace.StartSpan(context.Background(), "span", trace.WithSampler(trace.AlwaysSample()))
		span.End()
	}

	// Read the first three bundles.
	<-ch
	<-ch
	<-ch

	// Test that the fourth bundle isn't sent early.
	select {
	case <-ch:
		t.Errorf("bundle sent too early")
	case <-time.After(time.Second / 20):
		<-ch
	}

	// Test that there aren't extra bundles.
	select {
	case <-ch:
		t.Errorf("too many bundles sent")
	case <-time.After(time.Second / 5):
	}
}

func TestNewContext_Timeout(t *testing.T) {
	e := newTraceExporterWithClient(Options{
		Timeout: 10 * time.Millisecond,
	}, nil)
	ctx, cancel := e.o.newContextWithTimeout()
	defer cancel()
	select {
	case <-time.After(60 * time.Second):
		t.Fatal("should have timed out")
	case <-ctx.Done():
	}
}

func TestTraceSpansBufferMaxBytes(t *testing.T) {
	e := newTraceExporterWithClient(Options{
		Context:                  context.Background(),
		Timeout:                  10 * time.Millisecond,
		TraceSpansBufferMaxBytes: 20000,
	}, nil)
	waitCh := make(chan struct{})
	exported := 0
	e.uploadFn = func(spans []*tracepb.Span) {
		<-waitCh
		exported++
	}
	for i := 0; i < 10; i++ {
		e.ExportSpan(makeSampleSpanData())
	}
	close(waitCh)
	e.Flush()
	if exported != 2 {
		t.Errorf("exported = %d; want 2", exported)
	}
}

func makeSampleSpanData() *trace.SpanData {
	sd := &trace.SpanData{
		Annotations:   make([]trace.Annotation, 32),
		Links:         make([]trace.Link, 32),
		MessageEvents: make([]trace.MessageEvent, 128),
		Attributes:    make(map[string]interface{}),
	}
	for i := 0; i < 32; i++ {
		sd.Attributes[fmt.Sprintf("attribute-%d", i)] = ""
	}
	return sd
}
