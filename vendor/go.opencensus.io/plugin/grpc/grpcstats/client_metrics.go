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
// Client connection needs to use a ClientStatsHandler in order to enable collection.
var (
	// Available client measures
	RPCClientErrorCount       *stats.MeasureInt64
	RPCClientRoundTripLatency *stats.MeasureFloat64
	RPCClientRequestBytes     *stats.MeasureInt64
	RPCClientResponseBytes    *stats.MeasureInt64
	RPCClientStartedCount     *stats.MeasureInt64
	RPCClientFinishedCount    *stats.MeasureInt64
	RPCClientRequestCount     *stats.MeasureInt64
	RPCClientResponseCount    *stats.MeasureInt64

	// Predefined client views
	RPCClientErrorCountView       *stats.View
	RPCClientRoundTripLatencyView *stats.View
	RPCClientRequestBytesView     *stats.View
	RPCClientResponseBytesView    *stats.View
	RPCClientRequestCountView     *stats.View
	RPCClientResponseCountView    *stats.View

	RPCClientRoundTripLatencyMinuteView *stats.View
	RPCClientRequestBytesMinuteView     *stats.View
	RPCClientResponseBytesMinuteView    *stats.View
	RPCClientErrorCountMinuteView       *stats.View
	RPCClientStartedCountMinuteView     *stats.View
	RPCClientFinishedCountMinuteView    *stats.View
	RPCClientRequestCountMinuteView     *stats.View
	RPCClientResponseCountMinuteView    *stats.View

	RPCClientRoundTripLatencyHourView *stats.View
	RPCClientRequestBytesHourView     *stats.View
	RPCClientResponseBytesHourView    *stats.View
	RPCClientErrorCountHourView       *stats.View
	RPCClientStartedCountHourView     *stats.View
	RPCClientFinishedCountHourView    *stats.View
	RPCClientRequestCountHourView     *stats.View
	RPCClientResponseCountHourView    *stats.View
)

// TODO(acetechnologist): This is temporary and will need to be replaced by a
// mechanism to load these defaults from a common repository/config shared by
// all supported languages. Likely a serialized protobuf of these defaults.

func defaultClientMeasures() {
	var err error

	// Creating client measures
	if RPCClientErrorCount, err = stats.NewMeasureInt64("grpc.io/client/error_count", "RPC Errors", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/client/error_count: %v", err)
	}
	if RPCClientRoundTripLatency, err = stats.NewMeasureFloat64("grpc.io/client/roundtrip_latency", "RPC roundtrip latency in msecs", unitMillisecond); err != nil {
		log.Fatalf("Cannot create measure grpc.io/client/roundtrip_latency: %v", err)
	}
	if RPCClientRequestBytes, err = stats.NewMeasureInt64("grpc.io/client/request_bytes", "Request bytes", unitByte); err != nil {
		log.Fatalf("Cannot create measure grpc.io/client/request_bytes: %v", err)
	}
	if RPCClientResponseBytes, err = stats.NewMeasureInt64("grpc.io/client/response_bytes", "Response bytes", unitByte); err != nil {
		log.Fatalf("Cannot create measure grpc.io/client/response_bytes: %v", err)
	}
	if RPCClientStartedCount, err = stats.NewMeasureInt64("grpc.io/client/started_count", "Number of client RPCs (streams) started", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/client/started_count: %v", err)
	}
	if RPCClientFinishedCount, err = stats.NewMeasureInt64("grpc.io/client/finished_count", "Number of client RPCs (streams) finished", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/client/finished_count: %v", err)
	}
	if RPCClientRequestCount, err = stats.NewMeasureInt64("grpc.io/client/request_count", "Number of client RPC request messages", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/client/request_count: %v", err)
	}
	if RPCClientResponseCount, err = stats.NewMeasureInt64("grpc.io/client/response_count", "Number of client RPC response messages", unitCount); err != nil {
		log.Fatalf("Cannot create measure grpc.io/client/response_count: %v", err)
	}
}

func defaultClientViews() {
	RPCClientErrorCountView, _ = stats.NewView(
		"grpc.io/client/error_count/cumulative",
		"RPC Errors",
		[]tag.Key{keyStatus, keyMethod},
		RPCClientErrorCount,
		aggMean,
		windowCumulative)
	RPCClientRoundTripLatencyView, _ = stats.NewView(
		"grpc.io/client/roundtrip_latency/cumulative",
		"Latency in msecs",
		[]tag.Key{keyMethod},
		RPCClientRoundTripLatency,
		aggDistMillis,
		windowCumulative)
	RPCClientRequestBytesView, _ = stats.NewView(
		"grpc.io/client/request_bytes/cumulative",
		"Request bytes",
		[]tag.Key{keyMethod},
		RPCClientRequestBytes,
		aggDistBytes,
		windowCumulative)
	RPCClientResponseBytesView, _ = stats.NewView(
		"grpc.io/client/response_bytes/cumulative",
		"Response bytes",
		[]tag.Key{keyMethod},
		RPCClientResponseBytes,
		aggDistBytes,
		windowCumulative)
	RPCClientRequestCountView, _ = stats.NewView(
		"grpc.io/client/request_count/cumulative",
		"Count of request messages per client RPC",
		[]tag.Key{keyMethod},
		RPCClientRequestCount,
		aggDistCounts,
		windowCumulative)
	RPCClientResponseCountView, _ = stats.NewView(
		"grpc.io/client/response_count/cumulative",
		"Count of response messages per client RPC",
		[]tag.Key{keyMethod},
		RPCClientResponseCount,
		aggDistCounts,
		windowCumulative)

	clientViews = append(clientViews,
		RPCClientErrorCountView,
		RPCClientRoundTripLatencyView,
		RPCClientRequestBytesView,
		RPCClientResponseBytesView,
		RPCClientRequestCountView,
		RPCClientResponseCountView,
	)
	// TODO(jbd): Add roundtrip_latency, uncompressed_request_bytes, uncompressed_response_bytes, request_count, response_count.

	RPCClientRoundTripLatencyMinuteView, _ = stats.NewView(
		"grpc.io/client/roundtrip_latency/minute",
		"Minute stats for latency in msecs",
		[]tag.Key{keyMethod},
		RPCClientRoundTripLatency,
		aggMean,
		windowSlidingMinute)
	RPCClientRequestBytesMinuteView, _ = stats.NewView(
		"grpc.io/client/request_bytes/minute",
		"Minute stats for request size in bytes",
		[]tag.Key{keyMethod},
		RPCClientRequestBytes,
		aggMean,
		windowSlidingMinute)
	RPCClientResponseBytesMinuteView, _ = stats.NewView(
		"grpc.io/client/response_bytes/minute",
		"Minute stats for response size in bytes",
		[]tag.Key{keyMethod},
		RPCClientResponseBytes,
		aggMean,
		windowSlidingMinute)
	RPCClientErrorCountMinuteView, _ = stats.NewView(
		"grpc.io/client/error_count/minute",
		"Minute stats for rpc errors",
		[]tag.Key{keyMethod},
		RPCClientErrorCount,
		aggMean,
		windowSlidingMinute)
	RPCClientStartedCountMinuteView, _ = stats.NewView(
		"grpc.io/client/started_count/minute",
		"Minute stats on the number of client RPCs started",
		[]tag.Key{keyMethod},
		RPCClientStartedCount,
		aggMean,
		windowSlidingMinute)
	RPCClientFinishedCountMinuteView, _ = stats.NewView(
		"grpc.io/client/finished_count/minute",
		"Minute stats on the number of client RPCs finished",
		[]tag.Key{keyMethod},
		RPCClientFinishedCount,
		aggMean,
		windowSlidingMinute)
	RPCClientRequestCountMinuteView, _ = stats.NewView(
		"grpc.io/client/request_count/minute",
		"Minute stats on the count of request messages per client RPC",
		[]tag.Key{keyMethod},
		RPCClientRequestCount,
		aggMean,
		windowSlidingMinute)
	RPCClientResponseCountMinuteView, _ = stats.NewView(
		"grpc.io/client/response_count/minute",
		"Minute stats on the count of response messages per client RPC",
		[]tag.Key{keyMethod},
		RPCClientResponseCount,
		aggMean,
		windowSlidingMinute)

	clientViews = append(clientViews,
		RPCClientRoundTripLatencyMinuteView,
		RPCClientRequestBytesMinuteView,
		RPCClientResponseBytesMinuteView,
		RPCClientErrorCountMinuteView,
		RPCClientStartedCountMinuteView,
		RPCClientFinishedCountMinuteView,
		RPCClientRequestCountMinuteView,
		RPCClientResponseCountMinuteView,
	)

	RPCClientRoundTripLatencyHourView, _ = stats.NewView(
		"grpc.io/client/roundtrip_latency/hour",
		"Hour stats for latency in msecs",
		[]tag.Key{keyMethod},
		RPCClientRoundTripLatency,
		aggMean,
		windowSlidingHour)
	RPCClientRequestBytesHourView, _ = stats.NewView(
		"grpc.io/client/request_bytes/hour",
		"Hour stats for request size in bytes",
		[]tag.Key{keyMethod},
		RPCClientRequestBytes,
		aggMean,
		windowSlidingHour)
	RPCClientResponseBytesHourView, _ = stats.NewView(
		"grpc.io/client/response_bytes/hour",
		"Hour stats for response size in bytes",
		[]tag.Key{keyMethod},
		RPCClientResponseBytes,
		aggMean,
		windowSlidingHour)
	RPCClientErrorCountHourView, _ = stats.NewView(
		"grpc.io/client/error_count/hour",
		"Hour stats for rpc errors",
		[]tag.Key{keyMethod},
		RPCClientErrorCount,
		aggMean,
		windowSlidingHour)
	RPCClientStartedCountHourView, _ = stats.NewView(
		"grpc.io/client/started_count/hour",
		"Hour stats on the number of client RPCs started",
		[]tag.Key{keyMethod},
		RPCClientStartedCount,
		aggMean,
		windowSlidingHour)
	RPCClientFinishedCountHourView, _ = stats.NewView(
		"grpc.io/client/finished_count/hour",
		"Hour stats on the number of client RPCs finished",
		[]tag.Key{keyMethod},
		RPCClientFinishedCount,
		aggMean,
		windowSlidingHour)
	RPCClientRequestCountHourView, _ = stats.NewView(
		"grpc.io/client/request_count/hour",
		"Hour stats on the count of request messages per client RPC",
		[]tag.Key{keyMethod},
		RPCClientRequestCount,
		aggMean,
		windowSlidingHour)
	RPCClientResponseCountHourView, _ = stats.NewView(
		"grpc.io/client/response_count/hour",
		"Hour stats on the count of response messages per client RPC",
		[]tag.Key{keyMethod},
		RPCClientResponseCount,
		aggMean,
		windowSlidingHour)

	clientViews = append(clientViews,
		RPCClientRoundTripLatencyHourView,
		RPCClientRequestBytesHourView,
		RPCClientResponseBytesHourView,
		RPCClientErrorCountHourView,
		RPCClientStartedCountHourView,
		RPCClientFinishedCountHourView,
		RPCClientRequestCountHourView,
		RPCClientResponseCountHourView,
	)
}

// initClient registers the default metrics (measures and views)
// for a GRPC client.
func initClient() {
	defaultClientMeasures()
	defaultClientViews()
}

var clientViews []*stats.View
