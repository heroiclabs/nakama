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

package grpctrace_test

import (
	"fmt"
	"io"
	"net"
	"testing"
	"time"

	"go.opencensus.io/plugin/grpc/grpctrace"
	testpb "go.opencensus.io/plugin/grpc/grpctrace/testdata"
	"go.opencensus.io/trace"
	"golang.org/x/net/context"
	"google.golang.org/grpc"
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

func newTestClientAndServer() (client testpb.FooClient, server *grpc.Server, cleanup func(), err error) {
	// initialize server
	listener, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		return nil, nil, nil, fmt.Errorf("net.Listen: %v", err)
	}
	server = grpc.NewServer(grpc.StatsHandler(&grpctrace.ServerStatsHandler{}))
	testpb.RegisterFooServer(server, &testServer{})
	go server.Serve(listener)

	// initialize client
	clientConn, err := grpc.Dial(listener.Addr().String(), grpc.WithInsecure(), grpc.WithStatsHandler(&grpctrace.ClientStatsHandler{}), grpc.WithBlock())
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

func TestSpanCreation(t *testing.T) {
	client, _, cleanup, err := newTestClientAndServer()
	if err != nil {
		t.Fatalf("initializing client and server: %v", err)
	}
	defer cleanup()

	trace.SetDefaultSampler(trace.AlwaysSample())
	te := testExporter{make(chan *trace.SpanData)}
	trace.RegisterExporter(&te)
	defer trace.UnregisterExporter(&te)

	for _, test := range []struct {
		streaming bool
		success   bool
	}{
		{true, false},
		{true, true},
		{false, false},
		{false, true},
	} {
		var methodName string
		if test.streaming {
			methodName = ".testdata.Foo.Multiple"
			stream, err := client.Multiple(context.Background())
			if err != nil {
				t.Fatalf("%#v: call failed: %v", test, err)
			}
			for i := 0; i < 5; i++ {
				if i == 2 && !test.success {
					// make the third request return an error.
					err = stream.Send(&testpb.FooRequest{Fail: true})
					if err != nil {
						t.Fatalf("%#v: couldn't send streaming request: %v", test, err)
					}
					_, err = stream.Recv()
					if err == nil {
						t.Errorf("%#v: got nil error on receive, want non-nil", test)
					}
					break
				}
				err = stream.Send(&testpb.FooRequest{})
				if err != nil {
					t.Fatalf("%#v: couldn't send streaming request: %v", test, err)
				}
				_, err := stream.Recv()
				if err != nil {
					t.Errorf("%#v: couldn't receive streaming response: %v", test, err)
				}
			}
			if err := stream.CloseSend(); err != nil {
				if err != nil {
					t.Fatalf("%#v: couldn't close stream: %v", test, err)
				}
			}
		} else {
			methodName = ".testdata.Foo.Single"
			if test.success {
				_, err := client.Single(context.Background(), &testpb.FooRequest{})
				if err != nil {
					t.Fatalf("%#v: couldn't send request: %v", test, err)
				}
			} else {
				_, err := client.Single(context.Background(), &testpb.FooRequest{Fail: true})
				if err == nil {
					t.Fatalf("%#v: got nil error from request, want non-nil", test)
				}
			}
		}

		// get the client- and server-side spans from the exporter.
		s2 := <-te.ch
		s1 := <-te.ch
		if s1.Name < s2.Name {
			s1, s2 = s2, s1
		}

		if got, want := s1.Name, "Sent"+methodName; got != want {
			t.Errorf("%#v: got name %q want %q", test, got, want)
		}
		if got, want := s2.Name, "Recv"+methodName; got != want {
			t.Errorf("%#v: got name %q want %q", test, got, want)
		}
		if got, want := s2.SpanContext.TraceID, s1.SpanContext.TraceID; got != want {
			t.Errorf("%#v: got trace IDs %s and %s, want them equal", test, got, want)
		}
		if got, want := s2.ParentSpanID, s1.SpanContext.SpanID; got != want {
			t.Errorf("%#v: got ParentSpanID %s, want %s", test, got, want)
		}
		if got := (s1.Status.Code == 0); got != test.success {
			t.Errorf("%#v: got success=%t want %t", test, got, test.success)
		}
		if got := (s2.Status.Code == 0); got != test.success {
			t.Errorf("%#v: got success=%t want %t", test, got, test.success)
		}
		if s1.HasRemoteParent {
			t.Errorf("%#v: got HasRemoteParent=%t, want false", test, s1.HasRemoteParent)
		}
		if !s2.HasRemoteParent {
			t.Errorf("%#v: got HasRemoteParent=%t, want true", test, s2.HasRemoteParent)
		}
	}

	select {
	case <-te.ch:
		t.Fatal("received extra exported spans")
	case <-time.After(time.Second / 10):
	}
}
