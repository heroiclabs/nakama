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

package zpages

import (
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"sort"
	"sync"
	"text/tabwriter"
	"time"

	"go.opencensus.io/plugin/grpc/grpcstats"
	"go.opencensus.io/stats"
	"go.opencensus.io/trace"
)

var (
	programStartTime = time.Now()
	mu               sync.Mutex // protects snaps
	snaps            = make(map[methodKey]*statSnapshot)

	// viewType lists the views we are interested in for RPC stats.
	// A view's map value indicates whether that view contains data for received
	// RPCs.
	viewType = map[*stats.View]bool{
		grpcstats.RPCClientErrorCountHourView:          false,
		grpcstats.RPCClientErrorCountMinuteView:        false,
		grpcstats.RPCClientErrorCountView:              false,
		grpcstats.RPCClientFinishedCountHourView:       false,
		grpcstats.RPCClientFinishedCountMinuteView:     false,
		grpcstats.RPCClientRequestBytesHourView:        false,
		grpcstats.RPCClientRequestBytesMinuteView:      false,
		grpcstats.RPCClientRequestBytesView:            false,
		grpcstats.RPCClientRequestCountHourView:        false,
		grpcstats.RPCClientRequestCountMinuteView:      false,
		grpcstats.RPCClientRequestCountView:            false,
		grpcstats.RPCClientResponseBytesHourView:       false,
		grpcstats.RPCClientResponseBytesMinuteView:     false,
		grpcstats.RPCClientResponseBytesView:           false,
		grpcstats.RPCClientResponseCountHourView:       false,
		grpcstats.RPCClientResponseCountMinuteView:     false,
		grpcstats.RPCClientResponseCountView:           false,
		grpcstats.RPCClientRoundTripLatencyHourView:    false,
		grpcstats.RPCClientRoundTripLatencyMinuteView:  false,
		grpcstats.RPCClientRoundTripLatencyView:        false,
		grpcstats.RPCClientStartedCountHourView:        false,
		grpcstats.RPCClientStartedCountMinuteView:      false,
		grpcstats.RPCServerErrorCountHourView:          true,
		grpcstats.RPCServerErrorCountMinuteView:        true,
		grpcstats.RPCServerErrorCountView:              true,
		grpcstats.RPCServerFinishedCountHourView:       true,
		grpcstats.RPCServerFinishedCountMinuteView:     true,
		grpcstats.RPCServerRequestBytesHourView:        true,
		grpcstats.RPCServerRequestBytesMinuteView:      true,
		grpcstats.RPCServerRequestBytesView:            true,
		grpcstats.RPCServerRequestCountHourView:        true,
		grpcstats.RPCServerRequestCountMinuteView:      true,
		grpcstats.RPCServerRequestCountView:            true,
		grpcstats.RPCServerResponseBytesHourView:       true,
		grpcstats.RPCServerResponseBytesMinuteView:     true,
		grpcstats.RPCServerResponseBytesView:           true,
		grpcstats.RPCServerResponseCountHourView:       true,
		grpcstats.RPCServerResponseCountMinuteView:     true,
		grpcstats.RPCServerResponseCountView:           true,
		grpcstats.RPCServerServerElapsedTimeHourView:   true,
		grpcstats.RPCServerServerElapsedTimeMinuteView: true,
		grpcstats.RPCServerServerElapsedTimeView:       true,
		grpcstats.RPCServerStartedCountHourView:        true,
		grpcstats.RPCServerStartedCountMinuteView:      true,
	}
)

func init() {
	for view := range viewType {
		if err := view.Subscribe(); err != nil {
			log.Printf("error subscribing to view %q: %v", view.Name(), err)
		}
	}
	stats.RegisterExporter(snapExporter{})
}

// RpczHandler is a handler for /rpcz.
func RpczHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	WriteHTMLRpczPage(w)
}

// WriteHTMLRpczPage writes an HTML document to w containing per-method RPC stats.
func WriteHTMLRpczPage(w io.Writer) {
	if err := headerTemplate.Execute(w, headerData{Title: "RPC Stats"}); err != nil {
		log.Printf("zpages: executing template: %v", err)
	}
	WriteHTMLRpczSummary(w)
	if err := footerTemplate.Execute(w, nil); err != nil {
		log.Printf("zpages: executing template: %v", err)
	}
}

// WriteHTMLRpczSummary writes HTML to w containing per-method RPC stats.
//
// It includes neither a header nor footer, so you can embed this data in other pages.
func WriteHTMLRpczSummary(w io.Writer) {
	mu.Lock()
	if err := statsTemplate.Execute(w, getStatsPage()); err != nil {
		log.Printf("zpages: executing template: %v", err)
	}
	mu.Unlock()
}

// WriteTextRpczPage writes formatted text to w containing per-method RPC stats.
func WriteTextRpczPage(w io.Writer) {
	mu.Lock()
	defer mu.Unlock()
	page := getStatsPage()

	for i, sg := range page.StatGroups {
		switch i {
		case 0:
			fmt.Fprint(w, "Sent:\n")
		case 1:
			fmt.Fprint(w, "\nReceived:\n")
		}
		tw := tabwriter.NewWriter(w, 6, 8, 1, ' ', 0)
		fmt.Fprint(tw, "Method\tCount\t\t\tAvgLat\t\t\tMaxLat\t\t\tRate\t\t\tIn (MiB/s)\t\t\tOut (MiB/s)\t\t\tErrors\t\t\n")
		fmt.Fprint(tw, "\tMin\tHr\tTot\tMin\tHr\tTot\tMin\tHr\tTot\tMin\tHr\tTot\tMin\tHr\tTot\tMin\tHr\tTot\tMin\tHr\tTot\n")
		for _, s := range sg.Snapshots {
			fmt.Fprintf(tw, "%s\t%d\t%d\t%d\t%v\t%v\t%v\t%v\t%v\t%v\t%.2f\t%.2f\t%.2f\t%.2f\t%.2f\t%.2f\t%.2f\t%.2f\t%.2f\t%d\t%d\t%d\n",
				s.Method,
				s.CountMinute,
				s.CountHour,
				s.CountTotal,
				s.AvgLatencyMinute,
				s.AvgLatencyHour,
				s.AvgLatencyTotal,
				s.MaxLatencyMinute,
				s.MaxLatencyHour,
				s.MaxLatencyTotal,
				s.RPCRateMinute,
				s.RPCRateHour,
				s.RPCRateTotal,
				s.InputRateMinute/1e6,
				s.InputRateHour/1e6,
				s.InputRateTotal/1e6,
				s.OutputRateMinute/1e6,
				s.OutputRateHour/1e6,
				s.OutputRateTotal/1e6,
				s.ErrorsMinute,
				s.ErrorsHour,
				s.ErrorsTotal)
		}
		tw.Flush()
	}
}

// headerData contains data for the header template.
type headerData struct {
	Title string
}

type summaryPageData struct {
	Header             []string
	LatencyBucketNames []string
	Links              bool
	TracesEndpoint     string
	Rows               []summaryPageRow
}

type summaryPageRow struct {
	Name    string
	Active  int
	Latency []int
	Errors  int
}

func (s *summaryPageData) Len() int           { return len(s.Rows) }
func (s *summaryPageData) Less(i, j int) bool { return s.Rows[i].Name < s.Rows[j].Name }
func (s *summaryPageData) Swap(i, j int)      { s.Rows[i], s.Rows[j] = s.Rows[j], s.Rows[i] }

func getSummaryPageData() summaryPageData {
	data := summaryPageData{
		Links:          true,
		TracesEndpoint: "/tracez",
	}
	for name, s := range trace.ReportSpansPerMethod() {
		if len(data.Header) == 0 {
			data.Header = []string{"Name", "Active"}
			for _, b := range s.LatencyBuckets {
				l := b.MinLatency
				s := fmt.Sprintf(">%v", l)
				if l == 100*time.Second {
					s = ">100s"
				}
				data.Header = append(data.Header, s)
				data.LatencyBucketNames = append(data.LatencyBucketNames, s)
			}
			data.Header = append(data.Header, "Errors")
		}
		row := summaryPageRow{Name: name, Active: s.Active}
		for _, l := range s.LatencyBuckets {
			row.Latency = append(row.Latency, l.Size)
		}
		for _, e := range s.ErrorBuckets {
			row.Errors += e.Size
		}
		data.Rows = append(data.Rows, row)
	}
	sort.Sort(&data)
	return data
}

// statsPage aggregates stats on the page for 'sent' and 'received' categories
type statsPage struct {
	StatGroups []*statGroup
}

// statGroup aggregates snapshots for a directional category
type statGroup struct {
	Direction string
	Snapshots []*statSnapshot
}

func (s *statGroup) Len() int {
	return len(s.Snapshots)
}

func (s *statGroup) Swap(i, j int) {
	s.Snapshots[i], s.Snapshots[j] = s.Snapshots[j], s.Snapshots[i]
}

func (s *statGroup) Less(i, j int) bool {
	return s.Snapshots[i].Method < s.Snapshots[j].Method
}

// statSnapshot holds the data items that are presented in a single row of RPC
// stat information.
type statSnapshot struct {
	Method           string
	Received         bool
	CountMinute      int
	CountHour        int
	CountTotal       int
	AvgLatencyMinute time.Duration
	AvgLatencyHour   time.Duration
	AvgLatencyTotal  time.Duration
	MaxLatencyMinute time.Duration
	MaxLatencyHour   time.Duration
	MaxLatencyTotal  time.Duration
	RPCRateMinute    float64
	RPCRateHour      float64
	RPCRateTotal     float64
	InputRateMinute  float64
	InputRateHour    float64
	InputRateTotal   float64
	OutputRateMinute float64
	OutputRateHour   float64
	OutputRateTotal  float64
	ErrorsMinute     int
	ErrorsHour       int
	ErrorsTotal      int
}

type methodKey struct {
	method   string
	received bool
}

type snapExporter struct{}

func (s snapExporter) ExportView(vd *stats.ViewData) {
	received, ok := viewType[vd.View]
	if !ok {
		return
	}
	if len(vd.Rows) == 0 {
		return
	}
	ageSec := float64(time.Now().Sub(programStartTime)) / float64(time.Second)

	computeRate := func(maxSec, x float64) float64 {
		dur := ageSec
		if maxSec > 0 && dur > maxSec {
			dur = maxSec
		}
		return x / dur
	}

	convertTime := func(ms float64) time.Duration {
		if math.IsInf(ms, 0) || math.IsNaN(ms) {
			return 0
		}
		return time.Duration(float64(time.Millisecond) * ms)
	}

	mu.Lock()
	defer mu.Unlock()
	for _, row := range vd.Rows {
		var method string
		for _, tag := range row.Tags {
			if tag.Key.Name() == "method" {
				method = tag.Value
				break
			}
		}

		key := methodKey{method: method, received: received}
		s := snaps[key]
		if s == nil {
			s = &statSnapshot{Method: method, Received: received}
			snaps[key] = s
		}

		var (
			dist  = &stats.DistributionData{}
			sum   float64
			count float64
		)
		switch v := row.Data.(type) {
		case *stats.CountData:
			sum = float64(*v)
			count = float64(*v)
		case *stats.DistributionData:
			dist = v
			sum = v.Sum()
			count = float64(v.Count)
		case *stats.MeanData:
			sum = v.Sum()
			count = v.Count
		case *stats.SumData:
			sum = float64(*v)
			count = float64(*v)
		}

		// Update field of s corresponding to the view.
		switch vd.View {
		case grpcstats.RPCClientErrorCountHourView:
			s.ErrorsHour = int(count)
		case grpcstats.RPCClientErrorCountMinuteView:
			s.ErrorsMinute = int(count)
		case grpcstats.RPCClientErrorCountView:
			s.ErrorsTotal = int(count)

		case grpcstats.RPCClientRoundTripLatencyHourView:
			s.AvgLatencyHour = convertTime(sum / count)
			s.MaxLatencyHour = convertTime(dist.Max)
		case grpcstats.RPCClientRoundTripLatencyMinuteView:
			s.AvgLatencyMinute = convertTime(sum / count)
			s.MaxLatencyMinute = convertTime(dist.Max)
		case grpcstats.RPCClientRoundTripLatencyView:
			s.AvgLatencyTotal = convertTime(sum / count)
			s.MaxLatencyTotal = convertTime(dist.Max)

		case grpcstats.RPCClientRequestBytesHourView:
			s.OutputRateHour = computeRate(3600, sum)
		case grpcstats.RPCClientRequestBytesMinuteView:
			s.OutputRateMinute = computeRate(60, sum)
		case grpcstats.RPCClientRequestBytesView:
			s.OutputRateTotal = computeRate(0, sum)

		case grpcstats.RPCClientResponseBytesHourView:
			s.InputRateHour = computeRate(3600, sum)
		case grpcstats.RPCClientResponseBytesMinuteView:
			s.InputRateMinute = computeRate(60, sum)
		case grpcstats.RPCClientResponseBytesView:
			s.InputRateTotal = computeRate(0, sum)

		case grpcstats.RPCClientStartedCountHourView:
			s.CountHour = int(count)
			s.RPCRateHour = computeRate(3600, count)
		case grpcstats.RPCClientStartedCountMinuteView:
			s.CountMinute = int(count)
			s.RPCRateMinute = computeRate(60, count)

		case grpcstats.RPCClientFinishedCountHourView:
			// currently unused
		case grpcstats.RPCClientFinishedCountMinuteView:
			// currently unused

		case grpcstats.RPCClientRequestCountHourView:
		case grpcstats.RPCClientRequestCountMinuteView:
		case grpcstats.RPCClientRequestCountView:
			s.CountTotal = int(count)
			s.RPCRateTotal = computeRate(0, count)

		case grpcstats.RPCClientResponseCountHourView:
			// currently unused
		case grpcstats.RPCClientResponseCountMinuteView:
			// currently unused
		case grpcstats.RPCClientResponseCountView:
			// currently unused

		case grpcstats.RPCServerErrorCountHourView:
			s.ErrorsHour = int(count)
		case grpcstats.RPCServerErrorCountMinuteView:
			s.ErrorsMinute = int(count)
		case grpcstats.RPCServerErrorCountView:
			s.ErrorsTotal = int(count)

		case grpcstats.RPCServerServerElapsedTimeHourView:
			s.AvgLatencyHour = convertTime(sum / count)
			s.MaxLatencyHour = convertTime(dist.Max)
		case grpcstats.RPCServerServerElapsedTimeMinuteView:
			s.AvgLatencyMinute = convertTime(sum / count)
			s.MaxLatencyMinute = convertTime(dist.Max)
		case grpcstats.RPCServerServerElapsedTimeView:
			s.AvgLatencyTotal = convertTime(sum / count)
			s.MaxLatencyTotal = convertTime(dist.Max)

		case grpcstats.RPCServerRequestBytesHourView:
			s.InputRateHour = computeRate(3600, sum)
		case grpcstats.RPCServerRequestBytesMinuteView:
			s.InputRateMinute = computeRate(60, sum)
		case grpcstats.RPCServerRequestBytesView:
			s.InputRateTotal = computeRate(0, sum)

		case grpcstats.RPCServerResponseBytesHourView:
			s.OutputRateHour = computeRate(3600, sum)
		case grpcstats.RPCServerResponseBytesMinuteView:
			s.OutputRateMinute = computeRate(60, sum)
		case grpcstats.RPCServerResponseBytesView:
			s.OutputRateTotal = computeRate(0, sum)

		case grpcstats.RPCServerStartedCountHourView:
			s.CountHour = int(count)
			s.RPCRateHour = computeRate(3600, count)
		case grpcstats.RPCServerStartedCountMinuteView:
			s.CountMinute = int(count)
			s.RPCRateMinute = computeRate(60, count)

		case grpcstats.RPCServerFinishedCountHourView:
			// currently unused
		case grpcstats.RPCServerFinishedCountMinuteView:
			// currently unused

		case grpcstats.RPCServerRequestCountHourView:
		case grpcstats.RPCServerRequestCountMinuteView:
		case grpcstats.RPCServerRequestCountView:
			s.CountTotal = int(count)
			s.RPCRateTotal = computeRate(0, count)

		case grpcstats.RPCServerResponseCountHourView:
			// currently unused
		case grpcstats.RPCServerResponseCountMinuteView:
			// currently unused
		case grpcstats.RPCServerResponseCountView:
			// currently unused
		}
	}
}

func getStatsPage() *statsPage {
	sentStats := statGroup{Direction: "Sent"}
	receivedStats := statGroup{Direction: "Received"}
	for key, sg := range snaps {
		if key.received {
			receivedStats.Snapshots = append(receivedStats.Snapshots, sg)
		} else {
			sentStats.Snapshots = append(sentStats.Snapshots, sg)
		}
	}
	sort.Sort(&sentStats)
	sort.Sort(&receivedStats)

	return &statsPage{
		StatGroups: []*statGroup{&sentStats, &receivedStats},
	}
}
