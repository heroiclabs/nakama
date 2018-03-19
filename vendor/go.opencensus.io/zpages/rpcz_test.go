// Copyright 2018, OpenCensus Authors
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
//

package zpages

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"testing"
	"time"

	"go.opencensus.io/internal/testpb"
	"go.opencensus.io/plugin/ocgrpc"
	"go.opencensus.io/stats/view"
	"google.golang.org/grpc"
)

type testServer struct{}

var _ testpb.FooServer = (*testServer)(nil)

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

func newClientAndServer() (client testpb.FooClient, server *grpc.Server, cleanup func()) {
	// initialize server
	listener, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		log.Fatal(err)
	}
	server = grpc.NewServer(grpc.StatsHandler(&ocgrpc.ServerHandler{}))
	testpb.RegisterFooServer(server, &testServer{})
	go server.Serve(listener)

	// Initialize client.
	clientConn, err := grpc.Dial(
		listener.Addr().String(),
		grpc.WithInsecure(),
		grpc.WithStatsHandler(&ocgrpc.ClientHandler{}),
		grpc.WithBlock())

	if err != nil {
		log.Fatal(err)
	}
	client = testpb.NewFooClient(clientConn)

	cleanup = func() {
		server.GracefulStop()
		clientConn.Close()
	}

	return client, server, cleanup
}

func TestRpcz(t *testing.T) {
	client, _, cleanup := newClientAndServer()
	defer cleanup()

	_, err := client.Single(context.Background(), &testpb.FooRequest{})
	if err != nil {
		t.Fatal(err)
	}

	view.SetReportingPeriod(time.Millisecond)
	time.Sleep(2 * time.Millisecond)
	view.SetReportingPeriod(time.Second)

	mu.Lock()
	defer mu.Unlock()

	if len(snaps) == 0 {
		t.Fatal("Expected len(snaps) > 0")
	}

	snapshot, ok := snaps[methodKey{"testpb.Foo/Single", false}]
	if !ok {
		t.Fatal("Expected method stats not recorded")
	}

	if got, want := snapshot.CountTotal, 1; got != want {
		t.Errorf("snapshot.CountTotal = %d; want %d", got, want)
	}
}
