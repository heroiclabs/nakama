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
	"log"

	"go.opencensus.io/plugin/grpc/grpctrace"
	"google.golang.org/grpc"
)

func ExampleNewClientStatsHandler() {
	// Set up a new client connection with the OpenCensus
	// stats handler to enable tracing for the outgoing requests.
	conn, err := grpc.Dial("address", grpc.WithStatsHandler(grpctrace.NewClientStatsHandler()))
	if err != nil {
		log.Fatalf("did not connect: %v", err)
	}
	defer conn.Close()
}

func ExampleNewServerStatsHandler() {
	// Set up a new client connection with the OpenCensus
	// stats handler to enable tracing for the incoming requests.
	s := grpc.NewServer(grpc.StatsHandler(grpctrace.NewServerStatsHandler()))
	_ = s // use s
}
