//  Copyright (c) 2015 Couchbase, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 		http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package metrics

import (
	"fmt"
	"io"
	"math"

	"github.com/rcrowley/go-metrics"
)

// NOTE: This is copy & pasted from cbft as otherwise there
// would be an import cycle.

var timerPercentiles = []float64{0.5, 0.75, 0.95, 0.99, 0.999}

func TimerMap(timer metrics.Timer) map[string]interface{} {

	rv := make(map[string]interface{})
	t := timer.Snapshot()
	p := t.Percentiles(timerPercentiles)

	percentileKeys := []string{"median", "75%", "95%", "99%", "99.9%"}
	percentiles := make(map[string]interface{})
	for i, pi := range p {
		if !isNanOrInf(pi) {
			percentileKey := percentileKeys[i]
			percentiles[percentileKey] = pi
		}
	}

	rateKeys := []string{"1-min", "5-min", "15-min", "mean"}
	rates := make(map[string]interface{})
	for i, ri := range []float64{t.Rate1(), t.Rate5(), t.Rate15(), t.RateMean()} {
		if !isNanOrInf(ri) {
			rateKey := rateKeys[i]
			rates[rateKey] = ri
		}
	}

	rv["count"] = t.Count()
	rv["min"] = t.Min()
	rv["max"] = t.Max()
	mean := t.Mean()
	if !isNanOrInf(mean) {
		rv["mean"] = mean
	}
	stddev := t.StdDev()
	if !isNanOrInf(stddev) {
		rv["stddev"] = stddev
	}
	rv["percentiles"] = percentiles
	rv["rates"] = rates

	return rv
}

func isNanOrInf(v float64) bool {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return true
	}
	return false
}

func WriteTimerJSON(w io.Writer, timer metrics.Timer) {
	t := timer.Snapshot()
	p := t.Percentiles(timerPercentiles)

	fmt.Fprintf(w, `{"count":%9d,`, t.Count())
	fmt.Fprintf(w, `"min":%9d,`, t.Min())
	fmt.Fprintf(w, `"max":%9d,`, t.Max())
	fmt.Fprintf(w, `"mean":%12.2f,`, t.Mean())
	fmt.Fprintf(w, `"stddev":%12.2f,`, t.StdDev())
	fmt.Fprintf(w, `"percentiles":{`)
	fmt.Fprintf(w, `"median":%12.2f,`, p[0])
	fmt.Fprintf(w, `"75%%":%12.2f,`, p[1])
	fmt.Fprintf(w, `"95%%":%12.2f,`, p[2])
	fmt.Fprintf(w, `"99%%":%12.2f,`, p[3])
	fmt.Fprintf(w, `"99.9%%":%12.2f},`, p[4])
	fmt.Fprintf(w, `"rates":{`)
	fmt.Fprintf(w, `"1-min":%12.2f,`, t.Rate1())
	fmt.Fprintf(w, `"5-min":%12.2f,`, t.Rate5())
	fmt.Fprintf(w, `"15-min":%12.2f,`, t.Rate15())
	fmt.Fprintf(w, `"mean":%12.2f}}`, t.RateMean())
}

func WriteTimerCSVHeader(w io.Writer, prefix string) {
	fmt.Fprintf(w, "%s-count,", prefix)
	fmt.Fprintf(w, "%s-min,", prefix)
	fmt.Fprintf(w, "%s-max,", prefix)
	fmt.Fprintf(w, "%s-mean,", prefix)
	fmt.Fprintf(w, "%s-stddev,", prefix)
	fmt.Fprintf(w, "%s-percentile-50%%,", prefix)
	fmt.Fprintf(w, "%s-percentile-75%%,", prefix)
	fmt.Fprintf(w, "%s-percentile-95%%,", prefix)
	fmt.Fprintf(w, "%s-percentile-99%%,", prefix)
	fmt.Fprintf(w, "%s-percentile-99.9%%,", prefix)
	fmt.Fprintf(w, "%s-rate-1-min,", prefix)
	fmt.Fprintf(w, "%s-rate-5-min,", prefix)
	fmt.Fprintf(w, "%s-rate-15-min,", prefix)
	fmt.Fprintf(w, "%s-rate-mean", prefix)
}

func WriteTimerCSV(w io.Writer, timer metrics.Timer) {
	t := timer.Snapshot()
	p := t.Percentiles(timerPercentiles)

	fmt.Fprintf(w, `%d,`, t.Count())
	fmt.Fprintf(w, `%d,`, t.Min())
	fmt.Fprintf(w, `%d,`, t.Max())
	fmt.Fprintf(w, `%f,`, t.Mean())
	fmt.Fprintf(w, `%f,`, t.StdDev())
	fmt.Fprintf(w, `%f,`, p[0])
	fmt.Fprintf(w, `%f,`, p[1])
	fmt.Fprintf(w, `%f,`, p[2])
	fmt.Fprintf(w, `%f,`, p[3])
	fmt.Fprintf(w, `%f,`, p[4])
	fmt.Fprintf(w, `%f,`, t.Rate1())
	fmt.Fprintf(w, `%f,`, t.Rate5())
	fmt.Fprintf(w, `%f,`, t.Rate15())
	fmt.Fprintf(w, `%f`, t.RateMean())
}
