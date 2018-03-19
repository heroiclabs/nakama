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

package ocgrpc

import (
	"testing"
	"time"

	"go.opencensus.io/stats/view"
	"golang.org/x/net/context"
	"google.golang.org/grpc/metadata"

	"go.opencensus.io/trace"

	"google.golang.org/grpc/stats"
)

func TestClientHandler(t *testing.T) {
	ctx := context.Background()
	te := &traceExporter{}
	trace.RegisterExporter(te)
	if err := ClientRequestCountView.Subscribe(); err != nil {
		t.Fatal(err)
	}

	span := trace.NewSpan("/foo", nil, trace.StartOptions{
		Sampler: trace.AlwaysSample(),
	})
	ctx = trace.WithSpan(ctx, span)

	var handler ClientHandler
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

	stats, err := view.RetrieveData(ClientRequestCountView.Name)
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
	view.Unsubscribe(ClientErrorCountView)
}

func TestServerHandler(t *testing.T) {
	tests := []struct {
		name         string
		newTrace     bool
		expectTraces int
	}{
		{"trust_metadata", false, 1},
		{"no_trust_metadata", true, 0},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {

			ctx := context.Background()

			handler := &ServerHandler{
				IsPublicEndpoint: test.newTrace,
				StartOptions: trace.StartOptions{
					Sampler: trace.ProbabilitySampler(0.0),
				},
			}

			te := &traceExporter{}
			trace.RegisterExporter(te)
			if err := ServerRequestCountView.Subscribe(); err != nil {
				t.Fatal(err)
			}

			md := metadata.MD{
				"grpc-trace-bin": []string{string([]byte{0, 0, 62, 116, 14, 118, 117, 157, 126, 7, 114, 152, 102, 125, 235, 34, 114, 238, 1, 187, 201, 24, 210, 231, 20, 175, 241, 2, 1})},
			}
			ctx = metadata.NewIncomingContext(ctx, md)
			ctx = handler.TagRPC(ctx, &stats.RPCTagInfo{
				FullMethodName: "/service.foo/method",
			})
			handler.HandleRPC(ctx, &stats.Begin{
				BeginTime: time.Now(),
			})
			handler.HandleRPC(ctx, &stats.End{
				EndTime: time.Now(),
			})

			rows, err := view.RetrieveData(ServerRequestCountView.Name)
			if err != nil {
				t.Fatal(err)
			}
			traces := te.buffer

			if got, want := len(rows), 1; got != want {
				t.Errorf("Got %v rows; want %v", got, want)
			}
			if got, want := len(traces), test.expectTraces; got != want {
				t.Errorf("Got %v traces; want %v", got, want)
			}

			// Cleanup.
			view.Unsubscribe(ServerRequestCountView)
		})
	}
}

type traceExporter struct {
	buffer []*trace.SpanData
}

func (e *traceExporter) ExportSpan(sd *trace.SpanData) {
	e.buffer = append(e.buffer, sd)
}
