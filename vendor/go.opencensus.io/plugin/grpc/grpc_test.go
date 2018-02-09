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

package grpc

import (
	"testing"
	"time"

	"golang.org/x/net/context"

	"go.opencensus.io/plugin/grpc/grpcstats"
	"go.opencensus.io/trace"

	"google.golang.org/grpc/stats"
)

func TestNewClientStatsHandler(t *testing.T) {
	ctx := context.Background()

	handler := NewClientStatsHandler()

	te := &traceExporter{}
	trace.RegisterExporter(te)
	if err := grpcstats.RPCClientRequestCountView.Subscribe(); err != nil {
		t.Fatal(err)
	}

	span := trace.NewSpan("/foo", nil, trace.StartOptions{
		Sampler: trace.AlwaysSample(),
	})
	ctx = trace.WithSpan(ctx, span)

	ctx = handler.TagRPC(ctx, &stats.RPCTagInfo{
		FullMethodName: "/service.foo/method",
	})
	handler.HandleRPC(ctx, &stats.Begin{
		Client:    true,
		BeginTime: time.Now(),
	})
	handler.HandleRPC(ctx, &stats.End{
		Client:  true,
		EndTime: time.Now(),
	})

	stats, err := grpcstats.RPCClientRequestCountView.RetrieveData()
	if err != nil {
		t.Fatal(err)
	}
	traces := te.buffer

	if got, want := len(stats), 1; got != want {
		t.Errorf("Got %v stats; want %v", got, want)
	}
	if got, want := len(traces), 1; got != want {
		t.Errorf("Got %v traces; want %v", got, want)
	}

	// Cleanup.
	if err := grpcstats.RPCClientRequestCountView.Unsubscribe(); err != nil {
		t.Fatal(err)
	}
}

func TestNewServerStatsHandler(t *testing.T) {
	ctx := context.Background()

	handler := NewServerStatsHandler()

	te := &traceExporter{}
	trace.RegisterExporter(te)
	if err := grpcstats.RPCServerRequestCountView.Subscribe(); err != nil {
		t.Fatal(err)
	}

	span := trace.NewSpan("/foo", nil, trace.StartOptions{
		Sampler: trace.AlwaysSample(),
	})
	ctx = trace.WithSpan(ctx, span)
	ctx = handler.TagRPC(ctx, &stats.RPCTagInfo{
		FullMethodName: "/service.foo/method",
	})
	handler.HandleRPC(ctx, &stats.Begin{
		BeginTime: time.Now(),
	})
	handler.HandleRPC(ctx, &stats.End{
		EndTime: time.Now(),
	})

	stats, err := grpcstats.RPCServerRequestCountView.RetrieveData()
	if err != nil {
		t.Fatal(err)
	}
	traces := te.buffer

	if got, want := len(stats), 1; got != want {
		t.Errorf("Got %v stats; want %v", got, want)
	}
	if got, want := len(traces), 1; got != want {
		t.Errorf("Got %v traces; want %v", got, want)
	}

	// Cleanup.
	if err := grpcstats.RPCServerRequestCountView.Unsubscribe(); err != nil {
		t.Fatal(err)
	}

}

type traceExporter struct {
	buffer []*trace.SpanData
}

func (e *traceExporter) ExportSpan(sd *trace.SpanData) {
	e.buffer = append(e.buffer, sd)
}
