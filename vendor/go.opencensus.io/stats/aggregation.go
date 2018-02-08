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

// Aggregation represents a data aggregation method. There are several
// aggregation methods made available in the package such as
// CountAggregation, SumAggregation, MeanAggregation and
// DistributionAggregation.
type Aggregation interface {
	isAggregation() bool
	newData() func() AggregationData
}

// CountAggregation indicates that data collected and aggregated
// with this method will be turned into a count value.
// For example, total number of accepted requests can be
// aggregated by using CountAggregation.
type CountAggregation struct{}

func (a CountAggregation) isAggregation() bool { return true }

func (a CountAggregation) newData() func() AggregationData {
	return func() AggregationData { return newCountData(0) }
}

// SumAggregation indicates that data collected and aggregated
// with this method will be summed up.
// For example, accumulated request bytes can be aggregated by using
// SumAggregation.
type SumAggregation struct{}

func (a SumAggregation) isAggregation() bool { return true }

func (a SumAggregation) newData() func() AggregationData {
	return func() AggregationData { return newSumData(0) }
}

// MeanAggregation indicates that collect and aggregate data and maintain
// the mean value.
// For example, average latency in milliseconds can be aggregated by using
// MeanAggregation.
type MeanAggregation struct{}

func (a MeanAggregation) isAggregation() bool { return true }

func (a MeanAggregation) newData() func() AggregationData {
	return func() AggregationData { return newMeanData(0, 0) }
}

// DistributionAggregation indicates that the desired aggregation is
// a histogram distribution.
// An distribution aggregation may contain a histogram of the values in the
// population. The bucket boundaries for that histogram are described
// by DistributionAggregation slice. This defines length+1 buckets.
//
// If length >= 2 then the boundaries for bucket index i are:
//
//     [-infinity, bounds[i]) for i = 0
//     [bounds[i-1], bounds[i]) for 0 < i < length
//     [bounds[i-1], +infinity) for i = length
//
// If length is 0 then there is no histogram associated with the
// distribution. There will be a single bucket with boundaries
// (-infinity, +infinity).
//
// If length is 1 then there is no finite buckets, and that single
// element is the common boundary of the overflow and underflow buckets.
type DistributionAggregation []float64

func (a DistributionAggregation) isAggregation() bool { return true }

func (a DistributionAggregation) newData() func() AggregationData {
	return func() AggregationData { return newDistributionData([]float64(a)) }
}

// aggregatorCumulative indicates that the aggregation occurs over all samples
// seen since the view collection started.
type aggregatorCumulative struct {
	data AggregationData
}

// newAggregatorCumulative creates an aggregatorCumulative.
func newAggregatorCumulative(now time.Time, newAggregationValue func() AggregationData) *aggregatorCumulative {
	return &aggregatorCumulative{
		data: newAggregationValue(),
	}
}

func (a *aggregatorCumulative) isAggregator() bool {
	return true
}

func (a *aggregatorCumulative) addSample(v interface{}, now time.Time) {
	a.data.addSample(v)
}

func (a *aggregatorCumulative) retrieveCollected(now time.Time) AggregationData {
	return a.data
}

// aggregatorInterval indicates that the aggregation occurs over a
// window of time.
type aggregatorInterval struct {
	// keptDuration is the full duration that needs to be kept in memory in
	// order to retrieve the aggregated data whenever it is requested. Its size
	// is subDuration*len(entries+1). The actual desiredDuration interval is
	// slightly shorter: subDuration*len(entries). The extra subDuration is
	// needed to compute an approximation of the collected stats over the last
	// desiredDuration without storing every instance with its timestamp.
	keptDuration    time.Duration
	desiredDuration time.Duration
	subDuration     time.Duration
	entries         []*timeSerieEntry
	idx             int
}

// newAggregatorInterval creates an aggregatorSlidingTime.
func newAggregatorInterval(now time.Time, d time.Duration, subIntervalsCount int, newAggregationValue func() AggregationData) *aggregatorInterval {
	subDuration := d / time.Duration(subIntervalsCount)
	start := now.Add(-subDuration * time.Duration(subIntervalsCount))
	var entries []*timeSerieEntry
	// Keeps track of subIntervalsCount+1 entries in order to approximate the
	// collected stats without storing every instance with its timestamp.
	for i := 0; i <= subIntervalsCount; i++ {
		entries = append(entries, &timeSerieEntry{
			endTime: start.Add(subDuration),
			av:      newAggregationValue(),
		})
		start = start.Add(subDuration)
	}

	return &aggregatorInterval{
		keptDuration:    subDuration * time.Duration(len(entries)),
		desiredDuration: subDuration * time.Duration(len(entries)-1), // this is equal to d
		subDuration:     subDuration,
		entries:         entries,
		idx:             subIntervalsCount,
	}
}

func (a *aggregatorInterval) isAggregator() bool {
	return true
}

func (a *aggregatorInterval) addSample(v interface{}, now time.Time) {
	a.moveToCurrentEntry(now)
	e := a.entries[a.idx]
	e.av.addSample(v)
}

func (a *aggregatorInterval) retrieveCollected(now time.Time) AggregationData {
	a.moveToCurrentEntry(now)

	e := a.entries[a.idx]
	remaining := float64(e.endTime.Sub(now)) / float64(a.subDuration)
	oldestIdx := (a.idx + 1) % len(a.entries)

	e = a.entries[oldestIdx]
	ret := e.av.multiplyByFraction(remaining)

	for j := 1; j < len(a.entries); j++ {
		oldestIdx = (oldestIdx + 1) % len(a.entries)
		e = a.entries[oldestIdx]
		ret.addOther(e.av)
	}
	return ret
}

func (a *aggregatorInterval) moveToCurrentEntry(now time.Time) {
	e := a.entries[a.idx]
	for {
		if e.endTime.After(now) {
			break
		}
		a.idx = (a.idx + 1) % len(a.entries)
		e = a.entries[a.idx]
		e.endTime = e.endTime.Add(a.keptDuration)
		e.av.clear()
	}
}

type timeSerieEntry struct {
	endTime time.Time
	av      AggregationData
}
