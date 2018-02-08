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

package stats

import "time"

// aggregator represents the interface for the aggregators for the various windows.
type aggregator interface {
	isAggregator() bool
	addSample(v interface{}, now time.Time)
	retrieveCollected(now time.Time) AggregationData
}

// Window represents a time interval or samples count over
// which the aggregation occurs.
type Window interface {
	isWindow()
	newAggregator(now time.Time, newAggregationData func() AggregationData) aggregator
}

// Cumulative is a window that indicates that the aggregation occurs
// over the lifetime of the view.
type Cumulative struct{}

func (w Cumulative) isWindow() {}

func (w Cumulative) newAggregator(now time.Time, newAggregationData func() AggregationData) aggregator {
	return newAggregatorCumulative(now, newAggregationData)
}

// Interval is a window that indicates that the aggregation occurs over a sliding
// window of time: last n seconds, minutes, hours.
type Interval struct {
	Duration  time.Duration
	Intervals int
}

func (w Interval) isWindow() {}

func (w Interval) newAggregator(now time.Time, newAggregationData func() AggregationData) aggregator {
	return newAggregatorInterval(now, w.Duration, w.Intervals, newAggregationData)
}
