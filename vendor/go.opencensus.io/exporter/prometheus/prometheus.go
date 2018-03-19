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

// Package prometheus contains a Prometheus exporter.
//
// Please note that this exporter is currently work in progress and not complete.
package prometheus // import "go.opencensus.io/exporter/prometheus"

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"

	"go.opencensus.io/internal"
	"go.opencensus.io/stats/view"
	"go.opencensus.io/tag"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const (
	defaultNamespace = "opencensus"
)

// Exporter exports stats to Prometheus, users need
// to register the exporter as an http.Handler to be
// able to export.
type Exporter struct {
	opts    Options
	g       prometheus.Gatherer
	c       *collector
	handler http.Handler
}

// Options contains options for configuring the exporter.
type Options struct {
	Namespace string
	Registry  *prometheus.Registry
	OnError   func(err error)
}

var (
	newExporterOnce      sync.Once
	errSingletonExporter = errors.New("expecting only one exporter per instance")
)

// NewExporter returns an exporter that exports stats to Prometheus.
// Only one exporter should exist per instance
func NewExporter(o Options) (*Exporter, error) {
	var err = errSingletonExporter
	var exporter *Exporter
	newExporterOnce.Do(func() {
		exporter, err = newExporter(o)
	})
	return exporter, err
}

func newExporter(o Options) (*Exporter, error) {
	if o.Namespace == "" {
		o.Namespace = defaultNamespace
	}
	if o.Registry == nil {
		o.Registry = prometheus.NewRegistry()
	}
	collector := newCollector(o, o.Registry)
	e := &Exporter{
		opts:    o,
		g:       o.Registry,
		c:       collector,
		handler: promhttp.HandlerFor(o.Registry, promhttp.HandlerOpts{}),
	}
	return e, nil
}

var _ http.Handler = (*Exporter)(nil)
var _ view.Exporter = (*Exporter)(nil)

func (c *collector) registerViews(views ...*view.View) {
	count := 0
	for _, view := range views {
		sig := viewSignature(c.opts.Namespace, view)
		c.registeredViewsMu.Lock()
		_, ok := c.registeredViews[sig]
		c.registeredViewsMu.Unlock()

		if !ok {
			desc := prometheus.NewDesc(
				viewName(c.opts.Namespace, view),
				view.Description,
				tagKeysToLabels(view.TagKeys),
				nil,
			)
			c.registeredViewsMu.Lock()
			c.registeredViews[sig] = desc
			c.registeredViewsMu.Unlock()
			count++
		}
	}
	if count == 0 {
		return
	}

	c.ensureRegisteredOnce()
}

// ensureRegisteredOnce invokes reg.Register on the collector itself
// exactly once to ensure that we don't get errors such as
//  cannot register the collector: descriptor Desc{fqName: *}
//  already exists with the same fully-qualified name and const label values
// which is documented by Prometheus at
//  https://github.com/prometheus/client_golang/blob/fcc130e101e76c5d303513d0e28f4b6d732845c7/prometheus/registry.go#L89-L101
func (c *collector) ensureRegisteredOnce() {
	c.registerOnce.Do(func() {
		if err := c.reg.Register(c); err != nil {
			c.opts.onError(fmt.Errorf("cannot register the collector: %v", err))
		}
	})

}

func (o *Options) onError(err error) {
	if o.OnError != nil {
		o.OnError(err)
	} else {
		log.Printf("Failed to export to Prometheus: %v", err)
	}
}

// ExportView exports to the Prometheus if view data has one or more rows.
// Each OpenCensus AggregationData will be converted to
// corresponding Prometheus Metric: SumData will be converted
// to Untyped Metric, CountData will be Counter Metric,
// DistributionData will be Histogram Metric, and MeanData
// will be Summary Metric. Please note the Summary Metric from
// MeanData does not have any quantiles.
func (e *Exporter) ExportView(vd *view.Data) {
	if len(vd.Rows) == 0 {
		return
	}
	e.c.addViewData(vd)
}

// ServeHTTP serves the Prometheus endpoint.
func (e *Exporter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e.handler.ServeHTTP(w, r)
}

// collector implements prometheus.Collector
type collector struct {
	opts Options
	mu   sync.Mutex // mu guards all the fields.

	registerOnce sync.Once

	// reg helps collector register views dynamically.
	reg *prometheus.Registry

	// viewData are accumulated and atomically
	// appended to on every Export invocation, from
	// stats. These views are cleared out when
	// Collect is invoked and the cycle is repeated.
	viewData map[string]*view.Data

	registeredViewsMu sync.Mutex
	// registeredViews maps a view to a prometheus desc.
	registeredViews map[string]*prometheus.Desc
}

func (c *collector) addViewData(vd *view.Data) {
	c.registerViews(vd.View)
	sig := viewSignature(c.opts.Namespace, vd.View)

	c.mu.Lock()
	c.viewData[sig] = vd
	c.mu.Unlock()
}

func (c *collector) Describe(ch chan<- *prometheus.Desc) {
	c.registeredViewsMu.Lock()
	registered := make(map[string]*prometheus.Desc)
	for k, desc := range c.registeredViews {
		registered[k] = desc
	}
	c.registeredViewsMu.Unlock()

	for _, desc := range registered {
		ch <- desc
	}
}

// Collect fetches the statistics from OpenCensus
// and delivers them as Prometheus Metrics.
// Collect is invoked everytime a prometheus.Gatherer is run
// for example when the HTTP endpoint is invoked by Prometheus.
func (c *collector) Collect(ch chan<- prometheus.Metric) {
	// We need a copy of all the view data up until this point.
	viewData := c.cloneViewData()

	for _, vd := range viewData {
		sig := viewSignature(c.opts.Namespace, vd.View)
		c.registeredViewsMu.Lock()
		desc := c.registeredViews[sig]
		c.registeredViewsMu.Unlock()

		for _, row := range vd.Rows {
			metric, err := c.toMetric(desc, vd.View, row)
			if err != nil {
				c.opts.onError(err)
			} else {
				ch <- metric
			}
		}
	}

}

func (c *collector) toMetric(desc *prometheus.Desc, v *view.View, row *view.Row) (prometheus.Metric, error) {
	switch agg := v.Aggregation.(type) {
	case view.CountAggregation:
		data := row.Data.(*view.CountData)
		return prometheus.NewConstMetric(desc, prometheus.CounterValue, float64(*data), tagValues(row.Tags)...)

	case view.DistributionAggregation:
		data := row.Data.(*view.DistributionData)
		points := make(map[float64]uint64)
		for i, b := range agg {
			points[b] = uint64(data.CountPerBucket[i])
		}
		return prometheus.NewConstHistogram(desc, uint64(data.Count), data.Sum(), points, tagValues(row.Tags)...)

	case view.MeanAggregation:
		data := row.Data.(*view.MeanData)
		return prometheus.NewConstSummary(desc, uint64(data.Count), data.Sum(), make(map[float64]float64), tagValues(row.Tags)...)

	case view.SumAggregation:
		data := row.Data.(*view.SumData)
		return prometheus.NewConstMetric(desc, prometheus.UntypedValue, float64(*data), tagValues(row.Tags)...)

	default:
		return nil, fmt.Errorf("aggregation %T is not yet supported", v.Aggregation)
	}
}

func tagKeysToLabels(keys []tag.Key) (labels []string) {
	for _, key := range keys {
		labels = append(labels, internal.Sanitize(key.Name()))
	}
	return labels
}

func tagsToLabels(tags []tag.Tag) []string {
	var names []string
	for _, tag := range tags {
		names = append(names, internal.Sanitize(tag.Key.Name()))
	}
	return names
}

func newCollector(opts Options, registrar *prometheus.Registry) *collector {
	return &collector{
		reg:             registrar,
		opts:            opts,
		registeredViews: make(map[string]*prometheus.Desc),
		viewData:        make(map[string]*view.Data),
	}
}

func tagValues(t []tag.Tag) []string {
	var values []string
	for _, t := range t {
		values = append(values, t.Value)
	}
	return values
}

func viewName(namespace string, v *view.View) string {
	return namespace + "_" + internal.Sanitize(v.Name)
}

func viewSignature(namespace string, v *view.View) string {
	var buf bytes.Buffer
	buf.WriteString(viewName(namespace, v))
	for _, k := range v.TagKeys {
		buf.WriteString("-" + k.Name())
	}
	return buf.String()
}

func (c *collector) cloneViewData() map[string]*view.Data {
	c.mu.Lock()
	defer c.mu.Unlock()

	viewDataCopy := make(map[string]*view.Data)
	for sig, viewData := range c.viewData {
		viewDataCopy[sig] = viewData
	}
	return viewDataCopy
}
