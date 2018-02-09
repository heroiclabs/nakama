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
	"reflect"
	"runtime"
	"testing"

	"go.opencensus.io/stats"
)

func TestViewsAggregationsConform(t *testing.T) {
	// See Issue https://github.com/census-instrumentation/opencensus-go/issues/210.
	// This test ensures that the types of our Views match up with those
	// from the Java reference at
	// https://github.com/census-instrumentation/opencensus-java/blob/2b464864e3dd3f80e8e4c9dc72fccc225444a939/contrib/grpc_metrics/src/main/java/io/opencensus/contrib/grpc/metrics/RpcViewConstants.java#L113-L658
	// Add any other defined views to be type checked during tests to ensure we don't regress.

	assertTypeOf := func(v *stats.View, wantSample stats.Aggregation) {
		aggregation := v.Aggregation()
		gotValue := reflect.ValueOf(aggregation)
		wantValue := reflect.ValueOf(wantSample)
		if gotValue.Type() != wantValue.Type() {
			_, _, line, _ := runtime.Caller(1)
			t.Errorf("Item on line: %d got %T want %T", line, aggregation, wantSample)
		}
	}

	assertTypeOf(RPCClientErrorCountView, stats.MeanAggregation{})
	assertTypeOf(RPCClientRoundTripLatencyView, stats.DistributionAggregation{})
	assertTypeOf(RPCClientRequestBytesView, stats.DistributionAggregation{})
	assertTypeOf(RPCClientResponseBytesView, stats.DistributionAggregation{})
	assertTypeOf(RPCClientRequestCountView, stats.DistributionAggregation{})
	assertTypeOf(RPCClientResponseCountView, stats.DistributionAggregation{})
	assertTypeOf(RPCClientRoundTripLatencyMinuteView, stats.MeanAggregation{})
	assertTypeOf(RPCClientRequestBytesMinuteView, stats.MeanAggregation{})
	assertTypeOf(RPCClientResponseBytesMinuteView, stats.MeanAggregation{})
	assertTypeOf(RPCClientErrorCountMinuteView, stats.MeanAggregation{})
	assertTypeOf(RPCClientStartedCountMinuteView, stats.MeanAggregation{})
	assertTypeOf(RPCClientFinishedCountMinuteView, stats.MeanAggregation{})
	assertTypeOf(RPCClientRequestCountMinuteView, stats.MeanAggregation{})
	assertTypeOf(RPCClientResponseCountMinuteView, stats.MeanAggregation{})
	assertTypeOf(RPCClientRoundTripLatencyHourView, stats.MeanAggregation{})
	assertTypeOf(RPCClientRequestBytesHourView, stats.MeanAggregation{})
	assertTypeOf(RPCClientResponseBytesHourView, stats.MeanAggregation{})
	assertTypeOf(RPCClientErrorCountHourView, stats.MeanAggregation{})
	assertTypeOf(RPCClientStartedCountHourView, stats.MeanAggregation{})
	assertTypeOf(RPCClientFinishedCountHourView, stats.MeanAggregation{})
	assertTypeOf(RPCClientRequestCountHourView, stats.MeanAggregation{})
	assertTypeOf(RPCClientResponseCountHourView, stats.MeanAggregation{})
}

func TestStrictViewNames(t *testing.T) {
	alreadySeen := make(map[string]int)
	assertName := func(v *stats.View, want string) {
		_, _, line, _ := runtime.Caller(1)
		if prevLine, ok := alreadySeen[v.Name()]; ok {
			t.Errorf("Item's Name on line %d was already used on line %d", line, prevLine)
			return
		}
		if got := v.Name(); got != want {
			t.Errorf("Item on line: %d got %q want %q", line, got, want)
		}
		alreadySeen[v.Name()] = line
	}

	assertName(RPCClientErrorCountView, "grpc.io/client/error_count/cumulative")
	assertName(RPCClientRoundTripLatencyView, "grpc.io/client/roundtrip_latency/cumulative")
	assertName(RPCClientRequestBytesView, "grpc.io/client/request_bytes/cumulative")
	assertName(RPCClientResponseBytesView, "grpc.io/client/response_bytes/cumulative")
	assertName(RPCClientRequestCountView, "grpc.io/client/request_count/cumulative")
	assertName(RPCClientResponseCountView, "grpc.io/client/response_count/cumulative")
	assertName(RPCClientRoundTripLatencyMinuteView, "grpc.io/client/roundtrip_latency/minute")
	assertName(RPCClientRequestBytesMinuteView, "grpc.io/client/request_bytes/minute")
	assertName(RPCClientResponseBytesMinuteView, "grpc.io/client/response_bytes/minute")
	assertName(RPCClientErrorCountMinuteView, "grpc.io/client/error_count/minute")
	assertName(RPCClientStartedCountMinuteView, "grpc.io/client/started_count/minute")
	assertName(RPCClientFinishedCountMinuteView, "grpc.io/client/finished_count/minute")
	assertName(RPCClientRequestCountMinuteView, "grpc.io/client/request_count/minute")
	assertName(RPCClientResponseCountMinuteView, "grpc.io/client/response_count/minute")
	assertName(RPCClientRoundTripLatencyHourView, "grpc.io/client/roundtrip_latency/hour")
	assertName(RPCClientRequestBytesHourView, "grpc.io/client/request_bytes/hour")
	assertName(RPCClientResponseBytesHourView, "grpc.io/client/response_bytes/hour")
	assertName(RPCClientErrorCountHourView, "grpc.io/client/error_count/hour")
	assertName(RPCClientStartedCountHourView, "grpc.io/client/started_count/hour")
	assertName(RPCClientFinishedCountHourView, "grpc.io/client/finished_count/hour")
	assertName(RPCClientRequestCountHourView, "grpc.io/client/request_count/hour")
	assertName(RPCClientResponseCountHourView, "grpc.io/client/response_count/hour")
}
