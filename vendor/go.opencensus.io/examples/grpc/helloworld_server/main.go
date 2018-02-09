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

//go:generate protoc -I ../proto --go_out=plugins=grpc:../proto ../proto/helloworld.proto

package main

import (
	"log"
	"net"
	"net/http"

	"go.opencensus.io/examples/grpc/exporter"
	pb "go.opencensus.io/examples/grpc/proto"
	ocgrpc "go.opencensus.io/plugin/grpc"
	"go.opencensus.io/plugin/grpc/grpcstats"
	"go.opencensus.io/stats"
	"go.opencensus.io/zpages"
	"golang.org/x/net/context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

const port = ":50051"

// server is used to implement helloworld.GreeterServer.
type server struct{}

// SayHello implements helloworld.GreeterServer
func (s *server) SayHello(ctx context.Context, in *pb.HelloRequest) (*pb.HelloReply, error) {
	return &pb.HelloReply{Message: "Hello " + in.Name}, nil
}

func main() {
	zpages.AddDefaultHTTPHandlers()
	go func() { log.Fatal(http.ListenAndServe(":8081", nil)) }()
	// Register stats and trace exporters to export
	// the collected data.
	stats.RegisterExporter(&exporter.Exporter{})

	// Subscribe to collect server request count.
	if err := grpcstats.RPCServerRequestCountView.Subscribe(); err != nil {
		log.Fatal(err)
	}

	lis, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	// Set up a new server with the OpenCensus
	// stats handler to enable stats and tracing.
	s := grpc.NewServer(grpc.StatsHandler(ocgrpc.NewServerStatsHandler()))
	pb.RegisterGreeterServer(s, &server{})
	// Register reflection service on gRPC server.
	reflection.Register(s)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
