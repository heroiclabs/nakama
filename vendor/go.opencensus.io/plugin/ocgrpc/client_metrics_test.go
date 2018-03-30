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

package ocgrpc

import (
	"reflect"
	"runtime"
	"testing"

	"go.opencensus.io/stats/view"
)

func TestViewsAggregationsConform(t *testing.T) {
	// See Issue https://github.com/census-instrumentation/opencensus-go/issues/210.
	// This test ensures that the types of our Views match up with those
	// from the Java reference at
	// https://github.com/census-instrumentation/opencensus-java/blob/2b464864e3dd3f80e8e4c9dc72fccc225444a939/contrib/grpc_metrics/src/main/java/io/opencensus/contrib/grpc/metrics/RpcViewConstants.java#L113-L658
	// Add any other defined views to be type checked during tests to ensure we don't regress.

	assertTypeOf := func(v *view.View, wantSample *view.Aggregation) {
		aggregation := v.Aggregation
		gotValue := reflect.ValueOf(aggregation)
		wantValue := reflect.ValueOf(wantSample)
		if gotValue.Type() != wantValue.Type() {
			_, _, line, _ := runtime.Caller(1)
			t.Errorf("Item on line: %d got %T want %T", line, aggregation, wantSample)
		}
	}

	assertTypeOf(ClientErrorCountView, view.Mean())
	assertTypeOf(ClientRoundTripLatencyView, view.Distribution())
	assertTypeOf(ClientRequestBytesView, view.Distribution())
	assertTypeOf(ClientResponseBytesView, view.Distribution())
	assertTypeOf(ClientRequestCountView, view.Distribution())
	assertTypeOf(ClientResponseCountView, view.Distribution())
}

func TestStrictViewNames(t *testing.T) {
	alreadySeen := make(map[string]int)
	assertName := func(v *view.View, want string) {
		_, _, line, _ := runtime.Caller(1)
		if prevLine, ok := alreadySeen[v.Name]; ok {
			t.Errorf("Item's Name on line %d was already used on line %d", line, prevLine)
			return
		}
		if got := v.Name; got != want {
			t.Errorf("Item on line: %d got %q want %q", line, got, want)
		}
		alreadySeen[v.Name] = line
	}

	assertName(ClientErrorCountView, "grpc.io/client/error_count")
	assertName(ClientRoundTripLatencyView, "grpc.io/client/roundtrip_latency")
	assertName(ClientRequestBytesView, "grpc.io/client/request_bytes")
	assertName(ClientResponseBytesView, "grpc.io/client/response_bytes")
	assertName(ClientRequestCountView, "grpc.io/client/request_count")
	assertName(ClientResponseCountView, "grpc.io/client/response_count")
}
