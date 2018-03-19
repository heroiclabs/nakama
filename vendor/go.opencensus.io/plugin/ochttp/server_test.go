package ochttp

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"go.opencensus.io/stats/view"
	"go.opencensus.io/trace"
)

func httpHandler(statusCode, respSize int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(statusCode)
		body := make([]byte, respSize)
		w.Write(body)
	})
}

func updateMean(mean float64, sample, count int) float64 {
	if count == 1 {
		return float64(sample)
	}
	return mean + (float64(sample)-mean)/float64(count)
}

func TestHandlerStatsCollection(t *testing.T) {
	for _, v := range DefaultServerViews {
		v.Subscribe()
	}

	views := []string{
		"opencensus.io/http/server/request_count",
		"opencensus.io/http/server/latency",
		"opencensus.io/http/server/request_bytes",
		"opencensus.io/http/server/response_bytes",
	}

	// TODO: test latency measurements?
	tests := []struct {
		name, method, target                 string
		count, statusCode, reqSize, respSize int
	}{
		{"get 200", "GET", "http://opencensus.io/request/one", 10, 200, 512, 512},
		{"post 503", "POST", "http://opencensus.io/request/two", 5, 503, 1024, 16384},
		{"no body 302", "GET", "http://opencensus.io/request/three", 2, 302, 0, 0},
	}
	totalCount, meanReqSize, meanRespSize := 0, 0.0, 0.0

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := bytes.NewBuffer(make([]byte, test.reqSize))
			r := httptest.NewRequest(test.method, test.target, body)
			w := httptest.NewRecorder()
			h := &Handler{
				Handler: httpHandler(test.statusCode, test.respSize),
			}
			h.StartOptions.Sampler = trace.NeverSample()

			for i := 0; i < test.count; i++ {
				h.ServeHTTP(w, r)
				totalCount++
				// Distributions do not track sum directly, we must
				// mimic their behaviour to avoid rounding failures.
				meanReqSize = updateMean(meanReqSize, test.reqSize, totalCount)
				meanRespSize = updateMean(meanRespSize, test.respSize, totalCount)
			}
		})
	}

	for _, viewName := range views {
		v := view.Find(viewName)
		if v == nil {
			t.Errorf("view not found %q", viewName)
			continue
		}
		rows, err := view.RetrieveData(viewName)
		if err != nil {
			t.Error(err)
			continue
		}
		if got, want := len(rows), 1; got != want {
			t.Errorf("len(%q) = %d; want %d", viewName, got, want)
			continue
		}
		data := rows[0].Data

		var count int
		var sum float64
		switch data := data.(type) {
		case *view.CountData:
			count = int(*data)
		case *view.DistributionData:
			count = int(data.Count)
			sum = data.Sum()
		default:
			t.Errorf("Unkown data type: %v", data)
			continue
		}

		if got, want := count, totalCount; got != want {
			t.Fatalf("%s = %d; want %d", viewName, got, want)
		}

		// We can only check sum for distribution views.
		switch viewName {
		case "opencensus.io/http/server/request_bytes":
			if got, want := sum, meanReqSize*float64(totalCount); got != want {
				t.Fatalf("%s = %g; want %g", viewName, got, want)
			}
		case "opencensus.io/http/server/response_bytes":
			if got, want := sum, meanRespSize*float64(totalCount); got != want {
				t.Fatalf("%s = %g; want %g", viewName, got, want)
			}
		}
	}
}
