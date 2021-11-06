// Copyright (c) 2021 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

package prometheus

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	prom "github.com/prometheus/client_golang/prometheus"
)

// Configuration is a configuration for a Prometheus reporter.
type Configuration struct {
	// HandlerPath if specified will be used instead of using the default
	// HTTP handler path "/metrics".
	HandlerPath string `yaml:"handlerPath"`

	// ListenNetwork if specified will be used instead of using tcp network.
	// Supported networks: tcp, tcp4, tcp6 and unix.
	ListenNetwork string `yaml:"listenNetwork"`

	// ListenAddress if specified will be used instead of just registering the
	// handler on the default HTTP serve mux without listening.
	ListenAddress string `yaml:"listenAddress"`

	// TimerType is the default Prometheus type to use for Tally timers.
	TimerType string `yaml:"timerType"`

	// DefaultHistogramBuckets if specified will set the default histogram
	// buckets to be used by the reporter.
	DefaultHistogramBuckets []HistogramObjective `yaml:"defaultHistogramBuckets"`

	// DefaultSummaryObjectives if specified will set the default summary
	// objectives to be used by the reporter.
	DefaultSummaryObjectives []SummaryObjective `yaml:"defaultSummaryObjectives"`

	// OnError specifies what to do when an error either with listening
	// on the specified listen address or registering a metric with the
	// Prometheus. By default the registerer will panic.
	OnError string `yaml:"onError"`
}

// HistogramObjective is a Prometheus histogram bucket.
// See: https://godoc.org/github.com/prometheus/client_golang/prometheus#HistogramOpts
type HistogramObjective struct {
	Upper float64 `yaml:"upper"`
}

// SummaryObjective is a Prometheus summary objective.
// See: https://godoc.org/github.com/prometheus/client_golang/prometheus#SummaryOpts
type SummaryObjective struct {
	Percentile   float64 `yaml:"percentile"`
	AllowedError float64 `yaml:"allowedError"`
}

// ConfigurationOptions allows some programatic options, such as using a
// specific registry and what error callback to register.
type ConfigurationOptions struct {
	// Registry if not nil will specify the specific registry to use
	// for registering metrics.
	Registry *prom.Registry
	// OnError allows for customization of what to do when a metric
	// registration error fails, the default is to panic.
	OnError func(e error)
}

// NewReporter creates a new M3 reporter from this configuration.
func (c Configuration) NewReporter(
	configOpts ConfigurationOptions,
) (Reporter, error) {
	var opts Options

	if configOpts.Registry != nil {
		opts.Registerer = configOpts.Registry
	}

	if configOpts.OnError != nil {
		opts.OnRegisterError = configOpts.OnError
	} else {
		switch c.OnError {
		case "stderr":
			opts.OnRegisterError = func(err error) {
				fmt.Fprintf(os.Stderr, "tally prometheus reporter error: %v\n", err)
			}
		case "log":
			opts.OnRegisterError = func(err error) {
				log.Printf("tally prometheus reporter error: %v\n", err)
			}
		case "none":
			opts.OnRegisterError = func(err error) {}
		default:
			opts.OnRegisterError = func(err error) {
				panic(err)
			}
		}
	}

	switch c.TimerType {
	case "summary":
		opts.DefaultTimerType = SummaryTimerType
	case "histogram":
		opts.DefaultTimerType = HistogramTimerType
	}

	if len(c.DefaultHistogramBuckets) > 0 {
		var values []float64
		for _, value := range c.DefaultHistogramBuckets {
			values = append(values, value.Upper)
		}
		opts.DefaultHistogramBuckets = values
	}

	if len(c.DefaultSummaryObjectives) > 0 {
		values := make(map[float64]float64)
		for _, value := range c.DefaultSummaryObjectives {
			values[value.Percentile] = value.AllowedError
		}
		opts.DefaultSummaryObjectives = values
	}

	reporter := NewReporter(opts)

	path := "/metrics"
	if handlerPath := strings.TrimSpace(c.HandlerPath); handlerPath != "" {
		path = handlerPath
	}

	if addr := strings.TrimSpace(c.ListenAddress); addr == "" {
		http.Handle(path, reporter.HTTPHandler())
	} else {
		mux := http.NewServeMux()
		mux.Handle(path, reporter.HTTPHandler())
		go func() {
			network := c.ListenNetwork
			if network == "" {
				network = "tcp"
			}

			listener, err := net.Listen(network, addr)
			if err != nil {
				opts.OnRegisterError(err)
				return
			}

			defer listener.Close()

			if err = http.Serve(listener, mux); err != nil {
				opts.OnRegisterError(err)
			}
		}()
	}

	return reporter, nil
}
