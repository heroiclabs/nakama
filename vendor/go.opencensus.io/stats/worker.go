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

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.opencensus.io/tag"
)

func init() {
	defaultWorker = newWorker()
	go defaultWorker.start()
}

type measureRef struct {
	measure Measure
	views   map[*View]struct{}
}

type worker struct {
	measures   map[string]*measureRef
	views      map[string]*View
	startTimes map[*View]time.Time

	timer      *time.Ticker
	c          chan command
	quit, done chan bool
}

var defaultWorker *worker

var defaultReportingDuration = 10 * time.Second

// NewMeasureFloat64 creates a new measure of type MeasureFloat64. It returns
// an error if a measure with the same name already exists.
func NewMeasureFloat64(name, description, unit string) (*MeasureFloat64, error) {
	if err := checkMeasureName(name); err != nil {
		return nil, err
	}
	m := &MeasureFloat64{
		name:        name,
		description: description,
		unit:        unit,
	}

	req := &registerMeasureReq{
		m:   m,
		err: make(chan error),
	}
	defaultWorker.c <- req
	if err := <-req.err; err != nil {
		return nil, err
	}

	return m, nil
}

// NewMeasureInt64 creates a new measure of type MeasureInt64. It returns an
// error if a measure with the same name already exists.
func NewMeasureInt64(name, description, unit string) (*MeasureInt64, error) {
	if err := checkMeasureName(name); err != nil {
		return nil, err
	}
	m := &MeasureInt64{
		name:        name,
		description: description,
		unit:        unit,
	}

	req := &registerMeasureReq{
		m:   m,
		err: make(chan error),
	}
	defaultWorker.c <- req
	if err := <-req.err; err != nil {
		return nil, err
	}

	return m, nil
}

// FindView returns a registered view associated with this name.
// If no registered view is found, nil is returned.
func FindView(name string) (v *View) {
	req := &getViewByNameReq{
		name: name,
		c:    make(chan *getViewByNameResp),
	}
	defaultWorker.c <- req
	resp := <-req.c
	return resp.v
}

// RegisterView registers view. It returns an error if the view is already registered.
//
// Subscription automatically registers a view.
// Most users will not register directly but register via subscription.
// Registeration can be used by libraries to claim a view name.
//
// Unregister the view once the view is not required anymore.
func RegisterView(v *View) error {
	req := &registerViewReq{
		v:   v,
		err: make(chan error),
	}
	defaultWorker.c <- req
	return <-req.err
}

// UnregisterView removes the previously registered view. It returns an error
// if the view wasn't registered. All data collected and not reported for the
// corresponding view will be lost. The view is automatically be unsubscribed.
func UnregisterView(v *View) error {
	req := &unregisterViewReq{
		v:   v,
		err: make(chan error),
	}
	defaultWorker.c <- req
	return <-req.err
}

// Subscribe subscribes a view. Once a view is subscribed, it reports data
// via the exporters.
// During subscription, if the view wasn't registered, it will be automatically
// registered. Once the view is no longer needed to export data,
// user should unsubscribe from the view.
func (v *View) Subscribe() error {
	req := &subscribeToViewReq{
		v:   v,
		err: make(chan error),
	}
	defaultWorker.c <- req
	return <-req.err
}

// Unsubscribe unsubscribes a previously subscribed channel.
// Data will not be exported from this view once unsubscription happens.
// If no more subscriber for v exists and the the ad hoc
// collection for this view isn't active, data stops being collected for this
// view.
func (v *View) Unsubscribe() error {
	req := &unsubscribeFromViewReq{
		v:   v,
		err: make(chan error),
	}
	defaultWorker.c <- req
	return <-req.err
}

// RetrieveData returns the current collected data for the view.
func (v *View) RetrieveData() ([]*Row, error) {
	if v == nil {
		return nil, errors.New("cannot retrieve data from nil view")
	}
	req := &retrieveDataReq{
		now: time.Now(),
		v:   v,
		c:   make(chan *retrieveDataResp),
	}
	defaultWorker.c <- req
	resp := <-req.c
	return resp.rows, resp.err
}

// Record records one or multiple measurements with the same tags at once.
// If there are any tags in the context, measurements will be tagged with them.
func Record(ctx context.Context, ms ...Measurement) {
	req := &recordReq{
		now: time.Now(),
		tm:  tag.FromContext(ctx),
		ms:  ms,
	}
	defaultWorker.c <- req
}

// SetReportingPeriod sets the interval between reporting aggregated views in
// the program. If duration is less than or
// equal to zero, it enables the default behavior.
func SetReportingPeriod(d time.Duration) {
	// TODO(acetechnologist): ensure that the duration d is more than a certain
	// value. e.g. 1s
	req := &setReportingPeriodReq{
		d: d,
		c: make(chan bool),
	}
	defaultWorker.c <- req
	<-req.c // don't return until the timer is set to the new duration.
}

func newWorker() *worker {
	return &worker{
		measures:   make(map[string]*measureRef),
		views:      make(map[string]*View),
		startTimes: make(map[*View]time.Time),
		timer:      time.NewTicker(defaultReportingDuration),
		c:          make(chan command),
		quit:       make(chan bool),
		done:       make(chan bool),
	}
}

func (w *worker) start() {
	for {
		select {
		case cmd := <-w.c:
			if cmd != nil {
				cmd.handleCommand(w)
			}
		case <-w.timer.C:
			w.reportUsage(time.Now())
		case <-w.quit:
			w.timer.Stop()
			close(w.c)
			w.done <- true
			return
		}
	}
}

func (w *worker) stop() {
	w.quit <- true
	<-w.done
}

func (w *worker) tryRegisterMeasure(m Measure) error {
	if ref, ok := w.measures[m.Name()]; ok {
		if ref.measure != m {
			return fmt.Errorf("cannot register measure %q; another measure with the same name is already registered", m.Name())
		}
		// the measure is already registered so there is nothing to do and the
		// command is considered successful.
		return nil
	}

	w.measures[m.Name()] = &measureRef{
		measure: m,
		views:   make(map[*View]struct{}),
	}
	return nil
}

func (w *worker) tryRegisterView(v *View) error {
	if x, ok := w.views[v.Name()]; ok {
		if x != v {
			return fmt.Errorf("cannot register view %q; another view with the same name is already registered", v.Name())
		}

		// the view is already registered so there is nothing to do and the
		// command is considered successful.
		return nil
	}

	// view is not registered and needs to be registered, but first its measure
	// needs to be registered.
	if err := w.tryRegisterMeasure(v.Measure()); err != nil {
		return fmt.Errorf("cannot register view %q: %v", v.Name(), err)
	}

	w.views[v.Name()] = v
	ref := w.measures[v.Measure().Name()]
	ref.views[v] = struct{}{}

	return nil
}

func (w *worker) reportUsage(start time.Time) {
	for _, v := range w.views {
		if !v.isSubscribed() {
			continue
		}
		rows := v.collectedRows(start)
		if isCumulative(v) {
			s, ok := w.startTimes[v]
			if !ok {
				w.startTimes[v] = start
			} else {
				start = s
			}
		}
		// Make sure collector is never going
		// to mutate the exported data.
		rows = deepCopyRowData(rows)
		viewData := &ViewData{
			View:  v,
			Start: start,
			End:   time.Now(),
			Rows:  rows,
		}
		exportersMu.Lock()
		for e := range exporters {
			e.ExportView(viewData)
		}
		exportersMu.Unlock()
		if !isCumulative(v) {
			v.clearRows()
		}
	}
}

func isCumulative(v *View) bool {
	switch v.Window().(type) {
	case *Cumulative:
		return true
	case Cumulative:
		return true
	}
	return false
}

func deepCopyRowData(rows []*Row) []*Row {
	newRows := make([]*Row, 0, len(rows))
	for _, r := range rows {
		newRows = append(newRows, &Row{
			Data: r.Data.clone(),
			Tags: r.Tags,
		})
	}
	return newRows
}
