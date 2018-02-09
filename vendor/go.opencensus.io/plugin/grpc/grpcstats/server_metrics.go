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
//

package grpcstats

import (
	"log"

	"go.opencensus.io/stats"
	"go.opencensus.io/tag"
)

// The following variables are measures and views made available for gRPC clients.
// Server needs to use a ServerStatsHandler in order to enable collection.
var (
	// Available server measures
	RPCServerErrorCount        *stats.MeasureInt64
	RPCServerServerElapsedTime *stats.MeasureFloat64
	RPCServerRequestBytes      *stats.MeasureInt64
	RPCServerResponseBytes     *stats.MeasureInt64
	RPCServerStartedCount      *stats.MeasureInt64
	RPCServerFinishedCount     *stats.MeasureInt64
	RPCServerRequestCount      *stats.MeasureInt64
	RPCServerResponseCount     *stats.MeasureInt64

	// Predefined server views
	RPCServerErrorCountView        *stats.View
	RPCServerServerElapsedTimeView *stats.View
	RPCServerRequestBytesView      *stats.View
	RPCServerResponseBytesView     *stats.View
	RPCServerRequestCountView      *stats.View
	RPCServerResponseCountView     *stats.View

	RPCServerServerElapsedTimeMinuteView *stats.View
	RPCServerRequestBytesMinuteView      *stats.View
	RPCServerResponseBytesMinuteView     *stats.View
	RPCServerErrorCountMinuteView        *stats.View
	RPCServerStartedCountMinuteView      *stats.View
	RPCServerFinishedCountMinuteView     *stats.View
	RPCServerRequestCountMinuteView      *stats.View
	RPCServerResponseCountMinuteView     *stats.View

	RPCServerServerElapsedTimeHourView *stats.View
	RPCServerRequestBytesHourView      *stats.View
	RPCServerResponseBytesHourView     *stats.View
	RPCServerErrorCountHourView        *stats.View
	RPCServerStartedCountHourView      *stats.View
	RPCServerFinishedCountHourView     *stats.View
	RPCServerRequestCountHourView      *stats.View
	RPCServerResponseCountHourView     *stats.View
)

// TODO(acetechnologist): This is temporary and will need to be replaced by a
// mechanism to load these defaults from a common repository/config shared by
// all supported languages. Likely a serialized protobuf of these defaults.

func defaultServerMeasures() {
	var err error

	if RPCServerErrorCount, err = stats.NewMeasureInt64("grpc.io/server/error_count", "RPC Errors", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/server/error_count: %v", err)
	}
	if RPCServerServerElapsedTime, err = stats.NewMeasureFloat64("grpc.io/server/server_elapsed_time", "Server elapsed time in msecs", unitMillisecond); err != nil {
		log.Fatalf("Cannot create measure grpc.io/server/server_elapsed_time: %v", err)
	}
	if RPCServerRequestBytes, err = stats.NewMeasureInt64("grpc.io/server/request_bytes", "Request bytes", unitByte); err != nil {
		log.Fatalf("Cannot create measure grpc.io/server/request_bytes: %v", err)
	}
	if RPCServerResponseBytes, err = stats.NewMeasureInt64("grpc.io/server/response_bytes", "Response bytes", unitByte); err != nil {
		log.Fatalf("Cannot create measure grpc.io/server/response_bytes: %v", err)
	}
	if RPCServerStartedCount, err = stats.NewMeasureInt64("grpc.io/server/started_count", "Number of server RPCs (streams) started", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/server/started_count: %v", err)
	}
	if RPCServerFinishedCount, err = stats.NewMeasureInt64("grpc.io/server/finished_count", "Number of server RPCs (streams) finished", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/server/finished_count: %v", err)
	}
	if RPCServerRequestCount, err = stats.NewMeasureInt64("grpc.io/server/request_count", "Number of server RPC request messages", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/server/request_count: %v", err)
	}
	if RPCServerResponseCount, err = stats.NewMeasureInt64("grpc.io/server/response_count", "Number of server RPC response messages", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/server/response_count: %v", err)
	}
}

func defaultServerViews() {
	RPCServerErrorCountView, _ = stats.NewView(
		"grpc.io/server/error_count/cumulative",
		"RPC Errors",
		[]tag.Key{keyMethod, keyStatus},
		RPCServerErrorCount,
		aggCount,
		windowCumulative)
	RPCServerServerElapsedTimeView, _ = stats.NewView(
		"grpc.io/server/server_elapsed_time/cumulative",
		"Server elapsed time in msecs",
		[]tag.Key{keyMethod},
		RPCServerServerElapsedTime,
		aggDistMillis,
		windowCumulative)
	RPCServerRequestBytesView, _ = stats.NewView(
		"grpc.io/server/request_bytes/cumulative",
		"Request bytes",
		[]tag.Key{keyMethod},
		RPCServerRequestBytes,
		aggDistBytes,
		windowCumulative)
	RPCServerResponseBytesView, _ = stats.NewView(
		"grpc.io/server/response_bytes/cumulative",
		"Response bytes",
		[]tag.Key{keyMethod},
		RPCServerResponseBytes,
		aggDistBytes,
		windowCumulative)
	RPCServerRequestCountView, _ = stats.NewView(
		"grpc.io/server/request_count/cumulative",
		"Count of request messages per server RPC",
		[]tag.Key{keyMethod},
		RPCServerRequestCount,
		aggDistCounts,
		windowCumulative)
	RPCServerResponseCountView, _ = stats.NewView(
		"grpc.io/server/response_count/cumulative",
		"Count of response messages per server RPC",
		[]tag.Key{keyMethod},
		RPCServerResponseCount,
		aggDistCounts,
		windowCumulative)

	serverViews = append(serverViews,
		RPCServerErrorCountView,
		RPCServerServerElapsedTimeView,
		RPCServerRequestBytesView,
		RPCServerResponseBytesView,
		RPCServerRequestCountView,
		RPCServerResponseCountView)

	// TODO(jbd): Add roundtrip_latency, uncompressed_request_bytes, uncompressed_response_bytes, request_count, response_count.

	RPCServerServerElapsedTimeMinuteView, _ = stats.NewView(
		"grpc.io/server/server_elapsed_time/minute",
		"Minute stats for server elapsed time in msecs",
		[]tag.Key{keyMethod},
		RPCServerServerElapsedTime,
		aggDistMillis,
		windowSlidingMinute)
	RPCServerRequestBytesMinuteView, _ = stats.NewView(
		"grpc.io/server/request_bytes/minute",
		"Minute stats for request size in bytes",
		[]tag.Key{keyMethod},
		RPCServerRequestBytes,
		aggCount,
		windowSlidingMinute)
	RPCServerResponseBytesMinuteView, _ = stats.NewView(
		"grpc.io/server/response_bytes/minute",
		"Minute stats for response size in bytes",
		[]tag.Key{keyMethod},
		RPCServerResponseBytes,
		aggCount,
		windowSlidingMinute)
	RPCServerErrorCountMinuteView, _ = stats.NewView(
		"grpc.io/server/error_count/minute",
		"Minute stats for rpc errors",
		[]tag.Key{keyMethod},
		RPCServerErrorCount,
		aggCount,
		windowSlidingMinute)
	RPCServerStartedCountMinuteView, _ = stats.NewView(
		"grpc.io/server/started_count/minute",
		"Minute stats on the number of server RPCs started",
		[]tag.Key{keyMethod},
		RPCServerStartedCount,
		aggCount,
		windowSlidingMinute)
	RPCServerFinishedCountMinuteView, _ = stats.NewView(
		"grpc.io/server/finished_count/minute",
		"Minute stats on the number of server RPCs finished",
		[]tag.Key{keyMethod},
		RPCServerFinishedCount,
		aggCount,
		windowSlidingMinute)
	RPCServerRequestCountMinuteView, _ = stats.NewView(
		"grpc.io/server/request_count/minute",
		"Minute stats on the count of request messages per server RPC",
		[]tag.Key{keyMethod},
		RPCServerRequestCount,
		aggCount,
		windowSlidingMinute)
	RPCServerResponseCountMinuteView, _ = stats.NewView(
		"grpc.io/server/response_count/minute",
		"Minute stats on the count of response messages per server RPC",
		[]tag.Key{keyMethod},
		RPCServerResponseCount,
		aggCount,
		windowSlidingMinute)

	serverViews = append(serverViews,
		RPCServerServerElapsedTimeMinuteView,
		RPCServerRequestBytesMinuteView,
		RPCServerResponseBytesMinuteView,
		RPCServerErrorCountMinuteView,
		RPCServerStartedCountMinuteView,
		RPCServerFinishedCountMinuteView,
		RPCServerRequestCountMinuteView,
		RPCServerResponseCountMinuteView,
	)

	RPCServerServerElapsedTimeHourView, _ = stats.NewView(
		"grpc.io/server/server_elapsed_time/hour",
		"Hour stats for server elapsed time in msecs",
		[]tag.Key{keyMethod},
		RPCServerServerElapsedTime,
		aggDistMillis,
		windowSlidingHour)
	RPCServerRequestBytesHourView, _ = stats.NewView(
		"grpc.io/server/request_bytes/hour",
		"Hour stats for request size in bytes",
		[]tag.Key{keyMethod},
		RPCServerRequestBytes,
		aggCount,
		windowSlidingHour)
	RPCServerResponseBytesHourView, _ = stats.NewView(
		"grpc.io/server/response_bytes/hour",
		"Hour stats for response size in bytes",
		[]tag.Key{keyMethod},
		RPCServerResponseBytes,
		aggCount,
		windowSlidingHour)
	RPCServerErrorCountHourView, _ = stats.NewView(
		"grpc.io/server/error_count/hour",
		"Hour stats for rpc errors",
		[]tag.Key{keyMethod},
		RPCServerErrorCount,
		aggCount,
		windowSlidingHour)
	RPCServerStartedCountHourView, _ = stats.NewView(
		"grpc.io/server/started_count/hour",
		"Hour stats on the number of server RPCs started",
		[]tag.Key{keyMethod},
		RPCServerStartedCount,
		aggCount,
		windowSlidingHour)
	RPCServerFinishedCountHourView, _ = stats.NewView(
		"grpc.io/server/finished_count/hour",
		"Hour stats on the number of server RPCs finished",
		[]tag.Key{keyMethod},
		RPCServerFinishedCount,
		aggCount,
		windowSlidingHour)
	RPCServerRequestCountHourView, _ = stats.NewView(
		"grpc.io/server/request_count/hour",
		"Hour stats on the count of request messages per server RPC",
		[]tag.Key{keyMethod},
		RPCServerRequestCount,
		aggCount,
		windowSlidingHour)
	RPCServerResponseCountHourView, _ = stats.NewView(
		"grpc.io/server/response_count/hour",
		"Hour stats on the count of response messages per server RPC",
		[]tag.Key{keyMethod},
		RPCServerResponseCount,
		aggCount,
		windowSlidingHour)

	serverViews = append(serverViews,
		RPCServerResponseCountHourView,
		RPCServerServerElapsedTimeHourView,
		RPCServerRequestBytesHourView,
		RPCServerResponseBytesHourView,
		RPCServerErrorCountHourView,
		RPCServerStartedCountHourView,
		RPCServerFinishedCountHourView,
		RPCServerRequestCountHourView,
	)
}

func initServer() {
	defaultServerMeasures()
	defaultServerViews()
}

var serverViews []*stats.View
