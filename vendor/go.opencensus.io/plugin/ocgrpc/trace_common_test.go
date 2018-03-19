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
	"fmt"
	"io"
	"net"
	"testing"
	"time"

	"go.opencensus.io/internal/testpb"
	"go.opencensus.io/trace"
	"golang.org/x/net/context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/stats"
)

type testServer struct{}

func (s *testServer) Single(ctx context.Context, in *testpb.FooRequest) (*testpb.FooResponse, error) {
	if in.Fail {
		return nil, fmt.Errorf("request failed")
	}
	return &testpb.FooResponse{}, nil
}

func (s *testServer) Multiple(stream testpb.Foo_MultipleServer) error {
	for {
		in, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if in.Fail {
			return fmt.Errorf("request failed")
		}
		if err := stream.Send(&testpb.FooResponse{}); err != nil {
			return err
		}
	}
}

func newTracingOnlyTestClientAndServer() (client testpb.FooClient, server *grpc.Server, cleanup func(), err error) {
	// initialize server
	listener, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		return nil, nil, nil, fmt.Errorf("net.Listen: %v", err)
	}
	server = grpc.NewServer(grpc.StatsHandler(&ServerHandler{NoStats: true}))
	testpb.RegisterFooServer(server, &testServer{})
	go server.Serve(listener)

	// initialize client
	clientConn, err := grpc.Dial(listener.Addr().String(), grpc.WithInsecure(), grpc.WithStatsHandler(&ClientHandler{NoStats: true}), grpc.WithBlock())
	if err != nil {
		return nil, nil, nil, fmt.Errorf("grpc.Dial: %v", err)
	}
	client = testpb.NewFooClient(clientConn)

	cleanup = func() {
		server.GracefulStop()
		clientConn.Close()
	}

	return client, server, cleanup, nil
}

type testExporter struct {
	ch chan *trace.SpanData
}

func (t *testExporter) ExportSpan(s *trace.SpanData) {
	go func() { t.ch <- s }()
}

func TestClientHandler_traceTagRPC(t *testing.T) {
	ch := &ClientHandler{}
	ch.StartOptions.Sampler = trace.AlwaysSample()
	rti := &stats.RPCTagInfo{
		FullMethodName: "xxx",
	}
	ctx := context.Background()
	ctx = ch.traceTagRPC(ctx, rti)

	span := trace.FromContext(ctx)
	if span == nil {
		t.Fatal("expected span, got nil")
	}
	if !span.IsRecordingEvents() {
		t.Errorf("span should be sampled")
	}
	md, ok := metadata.FromOutgoingContext(ctx)
	if !ok || len(md) == 0 || len(md[traceContextKey]) == 0 {
		t.Fatal("no metadata")
	}
}

func TestStreaming(t *testing.T) {
	trace.SetDefaultSampler(trace.AlwaysSample())
	te := testExporter{make(chan *trace.SpanData)}
	trace.RegisterExporter(&te)
	defer trace.UnregisterExporter(&te)

	client, _, cleanup, err := newTracingOnlyTestClientAndServer()
	if err != nil {
		t.Fatalf("initializing client and server: %v", err)
	}

	stream, err := client.Multiple(context.Background())
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	err = stream.Send(&testpb.FooRequest{})
	if err != nil {
		t.Fatalf("Couldn't send streaming request: %v", err)
	}
	stream.CloseSend()

	for {
		_, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Errorf("stream.Recv() = %v; want no errors", err)
		}
	}

	cleanup()

	s1 := <-te.ch
	s2 := <-te.ch

	checkSpanData(t, s1, s2, ".testpb.Foo.Multiple", true)

	select {
	case <-te.ch:
		t.Fatal("received extra exported spans")
	case <-time.After(time.Second / 10):
	}
}

func TestStreamingFail(t *testing.T) {
	trace.SetDefaultSampler(trace.AlwaysSample())
	te := testExporter{make(chan *trace.SpanData)}
	trace.RegisterExporter(&te)
	defer trace.UnregisterExporter(&te)

	client, _, cleanup, err := newTracingOnlyTestClientAndServer()
	if err != nil {
		t.Fatalf("initializing client and server: %v", err)
	}

	stream, err := client.Multiple(context.Background())
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	err = stream.Send(&testpb.FooRequest{Fail: true})
	if err != nil {
		t.Fatalf("Couldn't send streaming request: %v", err)
	}
	stream.CloseSend()

	for {
		_, err := stream.Recv()
		if err == nil || err == io.EOF {
			t.Errorf("stream.Recv() = %v; want errors", err)
		} else {
			break
		}
	}

	s1 := <-te.ch
	s2 := <-te.ch

	checkSpanData(t, s1, s2, ".testpb.Foo.Multiple", false)
	cleanup()

	select {
	case <-te.ch:
		t.Fatal("received extra exported spans")
	case <-time.After(time.Second / 10):
	}
}

func TestSingle(t *testing.T) {
	trace.SetDefaultSampler(trace.AlwaysSample())
	te := testExporter{make(chan *trace.SpanData)}
	trace.RegisterExporter(&te)
	defer trace.UnregisterExporter(&te)

	client, _, cleanup, err := newTracingOnlyTestClientAndServer()
	if err != nil {
		t.Fatalf("initializing client and server: %v", err)
	}

	_, err = client.Single(context.Background(), &testpb.FooRequest{})
	if err != nil {
		t.Fatalf("Couldn't send request: %v", err)
	}

	s1 := <-te.ch
	s2 := <-te.ch

	checkSpanData(t, s1, s2, ".testpb.Foo.Single", true)
	cleanup()

	select {
	case <-te.ch:
		t.Fatal("received extra exported spans")
	case <-time.After(time.Second / 10):
	}
}

func TestSingleFail(t *testing.T) {
	trace.SetDefaultSampler(trace.AlwaysSample())
	te := testExporter{make(chan *trace.SpanData)}
	trace.RegisterExporter(&te)
	defer trace.UnregisterExporter(&te)

	client, _, cleanup, err := newTracingOnlyTestClientAndServer()
	if err != nil {
		t.Fatalf("initializing client and server: %v", err)
	}

	_, err = client.Single(context.Background(), &testpb.FooRequest{Fail: true})
	if err == nil {
		t.Fatalf("Got nil error from request, want non-nil")
	}

	s1 := <-te.ch
	s2 := <-te.ch

	checkSpanData(t, s1, s2, ".testpb.Foo.Single", false)
	cleanup()

	select {
	case <-te.ch:
		t.Fatal("received extra exported spans")
	case <-time.After(time.Second / 10):
	}
}

func checkSpanData(t *testing.T, s1, s2 *trace.SpanData, methodName string, success bool) {
	t.Helper()

	if s1.Name < s2.Name {
		s1, s2 = s2, s1
	}

	if got, want := s1.Name, "Sent"+methodName; got != want {
		t.Errorf("Got name %q want %q", got, want)
	}
	if got, want := s2.Name, "Recv"+methodName; got != want {
		t.Errorf("Got name %q want %q", got, want)
	}
	if got, want := s2.SpanContext.TraceID, s1.SpanContext.TraceID; got != want {
		t.Errorf("Got trace IDs %s and %s, want them equal", got, want)
	}
	if got, want := s2.ParentSpanID, s1.SpanContext.SpanID; got != want {
		t.Errorf("Got ParentSpanID %s, want %s", got, want)
	}
	if got := (s1.Status.Code == 0); got != success {
		t.Errorf("Got success=%t want %t", got, success)
	}
	if got := (s2.Status.Code == 0); got != success {
		t.Errorf("Got success=%t want %t", got, success)
	}
	if s1.HasRemoteParent {
		t.Errorf("Got HasRemoteParent=%t, want false", s1.HasRemoteParent)
	}
	if !s2.HasRemoteParent {
		t.Errorf("Got HasRemoteParent=%t, want true", s2.HasRemoteParent)
	}
}
