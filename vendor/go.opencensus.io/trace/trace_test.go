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

package trace

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"
)

var (
	tid = TraceID{1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 4, 8, 16, 32, 64, 128}
	sid = SpanID{1, 2, 4, 8, 16, 32, 64, 128}
)

func init() {
	// no random sampling, but sample children of sampled spans.
	SetDefaultSampler(ProbabilitySampler(0))
}

func TestStrings(t *testing.T) {
	if got, want := tid.String(), "01020304050607080102040810204080"; got != want {
		t.Errorf("TraceID.String: got %q want %q", got, want)
	}
	if got, want := sid.String(), "0102040810204080"; got != want {
		t.Errorf("SpanID.String: got %q want %q", got, want)
	}
}

func TestFromContext(t *testing.T) {
	want := &Span{}
	ctx := WithSpan(context.Background(), want)
	got := FromContext(ctx)
	if got != want {
		t.Errorf("got Span pointer %p want %p", got, want)
	}
}

type foo int

func (f foo) String() string {
	return "foo"
}

// checkChild tests that c has fields set appropriately, given that it is a child span of p.
func checkChild(p SpanContext, c *Span, expectRecordingEvents bool) error {
	if c == nil {
		return fmt.Errorf("got nil child span, want non-nil")
	}
	if got, want := c.spanContext.TraceID, p.TraceID; got != want {
		return fmt.Errorf("got child trace ID %s, want %s", got, want)
	}
	if childID, parentID := c.spanContext.SpanID, p.SpanID; childID == parentID {
		return fmt.Errorf("got child span ID %s, parent span ID %s; want unequal IDs", childID, parentID)
	}
	if got, want := c.spanContext.TraceOptions, p.TraceOptions; got != want {
		return fmt.Errorf("got child trace options %d, want %d", got, want)
	}
	if expectRecordingEvents {
		if c.data == nil {
			return fmt.Errorf("child span is not recording events")
		}
		if got, want := c.data.ParentSpanID, p.SpanID; got != want {
			return fmt.Errorf("got ParentSpanID %s, want %s", got, want)
		}
	} else {
		if c.data != nil {
			return fmt.Errorf("child span is recording events")
		}
	}
	return nil
}

func TestStartSpan(t *testing.T) {
	ctx, _ := StartSpan(context.Background(), "StartSpan")
	if FromContext(ctx).data != nil {
		t.Error("StartSpan: new span is recording events")
	}
}

func TestSampling(t *testing.T) {
	for _, test := range []struct {
		remoteParent        bool
		localParent         bool
		parentTraceOptions  TraceOptions
		recordEvents        bool
		sampler             Sampler
		wantRecordingEvents bool
		wantTraceOptions    TraceOptions
	}{
		{true, false, 0, false, nil, false, 0},
		{true, false, 0, true, nil, true, 0},
		{true, false, 1, false, nil, true, 1},
		{true, false, 1, true, nil, true, 1},
		{true, false, 0, false, NeverSample(), false, 0},
		{true, false, 0, true, NeverSample(), true, 0},
		{true, false, 1, false, NeverSample(), false, 0},
		{true, false, 1, true, NeverSample(), true, 0},
		{true, false, 0, false, AlwaysSample(), true, 1},
		{true, false, 0, true, AlwaysSample(), true, 1},
		{true, false, 1, false, AlwaysSample(), true, 1},
		{true, false, 1, true, AlwaysSample(), true, 1},
		{false, true, 0, false, NeverSample(), false, 0},
		{false, true, 0, true, NeverSample(), true, 0},
		{false, true, 1, false, NeverSample(), false, 0},
		{false, true, 1, true, NeverSample(), true, 0},
		{false, true, 0, false, AlwaysSample(), true, 1},
		{false, true, 0, true, AlwaysSample(), true, 1},
		{false, true, 1, false, AlwaysSample(), true, 1},
		{false, true, 1, true, AlwaysSample(), true, 1},
		{false, false, 0, false, nil, false, 0},
		{false, false, 0, true, nil, true, 0},
		{false, false, 0, false, NeverSample(), false, 0},
		{false, false, 0, true, NeverSample(), true, 0},
		{false, false, 0, false, AlwaysSample(), true, 1},
		{false, false, 0, true, AlwaysSample(), true, 1},
	} {
		var ctx context.Context
		if test.remoteParent {
			sc := SpanContext{
				TraceID:      tid,
				SpanID:       sid,
				TraceOptions: test.parentTraceOptions,
			}
			ctx, _ = StartSpanWithRemoteParent(context.Background(), "foo", sc, StartOptions{
				RecordEvents: test.recordEvents,
				Sampler:      test.sampler,
			})
		} else if test.localParent {
			sampler := NeverSample()
			if test.parentTraceOptions == 1 {
				sampler = AlwaysSample()
			}
			ctx2, _ := StartSpanWithOptions(context.Background(), "foo", StartOptions{Sampler: sampler})
			ctx, _ = StartSpanWithOptions(ctx2, "foo", StartOptions{
				RecordEvents: test.recordEvents,
				Sampler:      test.sampler,
			})
		} else {
			ctx, _ = StartSpanWithOptions(context.Background(), "foo", StartOptions{
				RecordEvents: test.recordEvents,
				Sampler:      test.sampler,
			})
		}
		sc := FromContext(ctx).SpanContext()
		if (sc == SpanContext{}) {
			t.Errorf("case %#v: starting new span: no span in context", test)
			continue
		}
		if sc.SpanID == (SpanID{}) {
			t.Errorf("case %#v: starting new span: got zero SpanID, want nonzero", test)
		}
		if recording := FromContext(ctx).data != nil; recording != test.wantRecordingEvents {
			t.Errorf("case %#v: starting new span: recording events is %t, want %t", test, recording, test.wantRecordingEvents)
		}
		if sc.TraceOptions != test.wantTraceOptions {
			t.Errorf("case %#v: starting new span: got TraceOptions %x, want %x", test, sc.TraceOptions, test.wantTraceOptions)
		}
	}

	// Test that for children of local spans, the default sampler has no effect.
	for _, test := range []struct {
		parentTraceOptions  TraceOptions
		recordEvents        bool
		wantRecordingEvents bool
		wantTraceOptions    TraceOptions
	}{
		{0, false, false, 0},
		{0, true, true, 0},
		{1, false, true, 1},
		{1, true, true, 1},
	} {
		for _, defaultSampler := range []Sampler{
			NeverSample(),
			AlwaysSample(),
			ProbabilitySampler(0),
		} {
			SetDefaultSampler(defaultSampler)
			sampler := NeverSample()
			if test.parentTraceOptions == 1 {
				sampler = AlwaysSample()
			}
			ctx2, _ := StartSpanWithOptions(context.Background(), "foo", StartOptions{Sampler: sampler})
			ctx, _ := StartSpanWithOptions(ctx2, "foo", StartOptions{
				RecordEvents: test.recordEvents,
			})
			sc := FromContext(ctx).SpanContext()
			if (sc == SpanContext{}) {
				t.Errorf("case %#v: starting new child of local span: no span in context", test)
				continue
			}
			if sc.SpanID == (SpanID{}) {
				t.Errorf("case %#v: starting new child of local span: got zero SpanID, want nonzero", test)
			}
			if recording := FromContext(ctx).data != nil; recording != test.wantRecordingEvents {
				t.Errorf("case %#v: starting new child of local span: recording events is %t, want %t", test, recording, test.wantRecordingEvents)
			}
			if sc.TraceOptions != test.wantTraceOptions {
				t.Errorf("case %#v: starting new child of local span: got TraceOptions %x, want %x", test, sc.TraceOptions, test.wantTraceOptions)
			}
		}
	}
	SetDefaultSampler(ProbabilitySampler(0)) // reset the default sampler.
}

func TestProbabilitySampler(t *testing.T) {
	exported := 0
	for i := 0; i < 1000; i++ {
		_, span := StartSpanWithOptions(context.Background(), "foo", StartOptions{
			Sampler: ProbabilitySampler(0.3),
		})
		if span.SpanContext().IsSampled() {
			exported++
		}
	}
	if exported < 200 || exported > 400 {
		t.Errorf("got %f%% exported spans, want approximately 30%%", float64(exported)*0.1)
	}
}

func TestStartSpanWithRemoteParent(t *testing.T) {
	sc := SpanContext{
		TraceID:      tid,
		SpanID:       sid,
		TraceOptions: 0x0,
	}
	ctx, _ := StartSpanWithRemoteParent(context.Background(), "StartSpanWithRemoteParent", sc, StartOptions{})
	if err := checkChild(sc, FromContext(ctx), false); err != nil {
		t.Error(err)
	}

	ctx, _ = StartSpanWithRemoteParent(context.Background(), "StartSpanWithRemoteParent", sc, StartOptions{RecordEvents: true})
	if err := checkChild(sc, FromContext(ctx), true); err != nil {
		t.Error(err)
	}

	sc = SpanContext{
		TraceID:      tid,
		SpanID:       sid,
		TraceOptions: 0x1,
	}
	ctx, _ = StartSpanWithRemoteParent(context.Background(), "StartSpanWithRemoteParent", sc, StartOptions{})
	if err := checkChild(sc, FromContext(ctx), true); err != nil {
		t.Error(err)
	}

	ctx, _ = StartSpanWithRemoteParent(context.Background(), "StartSpanWithRemoteParent", sc, StartOptions{RecordEvents: true})
	if err := checkChild(sc, FromContext(ctx), true); err != nil {
		t.Error(err)
	}

	ctx2, _ := StartSpan(ctx, "StartSpan")
	parent := FromContext(ctx).SpanContext()
	if err := checkChild(parent, FromContext(ctx2), true); err != nil {
		t.Error(err)
	}
}

// startSpan returns a context with a new Span that is recording events and will be exported.
func startSpan() *Span {
	return NewSpanWithRemoteParent("span0",
		SpanContext{
			TraceID:      tid,
			SpanID:       sid,
			TraceOptions: 1,
		},
		StartOptions{
			RecordEvents: true,
		})
}

type testExporter struct {
	spans []*SpanData
}

func (t *testExporter) ExportSpan(s *SpanData) {
	t.spans = append(t.spans, s)
}

// endSpan ends the Span in the context and returns the exported SpanData.
//
// It also does some tests on the Span, and tests and clears some fields in the SpanData.
func endSpan(span *Span) (*SpanData, error) {

	if !span.IsRecordingEvents() {
		return nil, fmt.Errorf("IsRecordingEvents: got false, want true")
	}
	if !span.SpanContext().IsSampled() {
		return nil, fmt.Errorf("IsSampled: got false, want true")
	}
	var te testExporter
	RegisterExporter(&te)
	span.End()
	UnregisterExporter(&te)
	if len(te.spans) != 1 {
		return nil, fmt.Errorf("got exported spans %#v, want one span", te.spans)
	}
	got := te.spans[0]
	if got.SpanContext.SpanID == (SpanID{}) {
		return nil, fmt.Errorf("exporting span: expected nonzero SpanID")
	}
	got.SpanContext.SpanID = SpanID{}
	if !checkTime(&got.StartTime) {
		return nil, fmt.Errorf("exporting span: expected nonzero StartTime")
	}
	if !checkTime(&got.EndTime) {
		return nil, fmt.Errorf("exporting span: expected nonzero EndTime")
	}
	return got, nil
}

// checkTime checks that a nonzero time was set in x, then clears it.
func checkTime(x *time.Time) bool {
	if x.IsZero() {
		return false
	}
	*x = time.Time{}
	return true
}

func TestSetSpanAttributes(t *testing.T) {
	span := startSpan()
	span.SetAttributes(StringAttribute{"key1", "value1"})
	got, err := endSpan(span)
	if err != nil {
		t.Fatal(err)
	}

	want := &SpanData{
		SpanContext: SpanContext{
			TraceID:      tid,
			SpanID:       SpanID{},
			TraceOptions: 0x1,
		},
		ParentSpanID:    sid,
		Name:            "span0",
		Attributes:      map[string]interface{}{"key1": "value1"},
		HasRemoteParent: true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("exporting span: got %#v want %#v", got, want)
	}
}

func TestAnnotations(t *testing.T) {
	span := startSpan()
	span.Annotatef([]Attribute{StringAttribute{"key1", "value1"}}, "%f", 1.5)
	span.Annotate([]Attribute{StringAttribute{"key2", "value2"}}, "Annotate")
	got, err := endSpan(span)
	if err != nil {
		t.Fatal(err)
	}

	for i := range got.Annotations {
		if !checkTime(&got.Annotations[i].Time) {
			t.Error("exporting span: expected nonzero Annotation Time")
		}
	}

	want := &SpanData{
		SpanContext: SpanContext{
			TraceID:      tid,
			SpanID:       SpanID{},
			TraceOptions: 0x1,
		},
		ParentSpanID: sid,
		Name:         "span0",
		Annotations: []Annotation{
			{Message: "1.500000", Attributes: map[string]interface{}{"key1": "value1"}},
			{Message: "Annotate", Attributes: map[string]interface{}{"key2": "value2"}},
		},
		HasRemoteParent: true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("exporting span: got %#v want %#v", got, want)
	}
}

func TestMessageEvents(t *testing.T) {
	span := startSpan()
	span.AddMessageReceiveEvent(3, 400, 300)
	span.AddMessageSendEvent(1, 200, 100)
	got, err := endSpan(span)
	if err != nil {
		t.Fatal(err)
	}

	for i := range got.MessageEvents {
		if !checkTime(&got.MessageEvents[i].Time) {
			t.Error("exporting span: expected nonzero MessageEvent Time")
		}
	}

	want := &SpanData{
		SpanContext: SpanContext{
			TraceID:      tid,
			SpanID:       SpanID{},
			TraceOptions: 0x1,
		},
		ParentSpanID: sid,
		Name:         "span0",
		MessageEvents: []MessageEvent{
			{EventType: 2, MessageID: 0x3, UncompressedByteSize: 0x190, CompressedByteSize: 0x12c},
			{EventType: 1, MessageID: 0x1, UncompressedByteSize: 0xc8, CompressedByteSize: 0x64},
		},
		HasRemoteParent: true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("exporting span: got %#v want %#v", got, want)
	}
}

func TestSetSpanStatus(t *testing.T) {
	span := startSpan()
	span.SetStatus(Status{Code: int32(1), Message: "request failed"})
	got, err := endSpan(span)
	if err != nil {
		t.Fatal(err)
	}

	want := &SpanData{
		SpanContext: SpanContext{
			TraceID:      tid,
			SpanID:       SpanID{},
			TraceOptions: 0x1,
		},
		ParentSpanID:    sid,
		Name:            "span0",
		Status:          Status{Code: 1, Message: "request failed"},
		HasRemoteParent: true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("exporting span: got %#v want %#v", got, want)
	}
}

func TestAddLink(t *testing.T) {
	span := startSpan()
	span.AddLink(Link{
		TraceID:    tid,
		SpanID:     sid,
		Type:       LinkTypeParent,
		Attributes: map[string]interface{}{"key5": "value5"},
	})
	got, err := endSpan(span)
	if err != nil {
		t.Fatal(err)
	}

	want := &SpanData{
		SpanContext: SpanContext{
			TraceID:      tid,
			SpanID:       SpanID{},
			TraceOptions: 0x1,
		},
		ParentSpanID: sid,
		Name:         "span0",
		Links: []Link{{
			TraceID:    tid,
			SpanID:     sid,
			Type:       2,
			Attributes: map[string]interface{}{"key5": "value5"},
		}},
		HasRemoteParent: true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("exporting span: got %#v want %#v", got, want)
	}
}

func TestUnregisterExporter(t *testing.T) {
	var te testExporter
	RegisterExporter(&te)
	UnregisterExporter(&te)

	ctx := startSpan()
	endSpan(ctx)
	if len(te.spans) != 0 {
		t.Error("unregistered Exporter was called")
	}
}

func TestBucket(t *testing.T) {
	// make a bucket of size 5 and add 10 spans
	b := makeBucket(5)
	for i := 1; i <= 10; i++ {
		b.nextTime = time.Time{} // reset the time so that the next span is accepted.
		// add a span, with i stored in the TraceID so we can test for it later.
		b.add(&SpanData{SpanContext: SpanContext{TraceID: TraceID{byte(i)}}, EndTime: time.Now()})
		if i <= 5 {
			if b.size() != i {
				t.Fatalf("got bucket size %d, want %d %#v\n", b.size(), i, b)
			}
			for j := 0; j < i; j++ {
				if b.span(j).TraceID[0] != byte(j+1) {
					t.Errorf("got span index %d, want %d\n", b.span(j).TraceID[0], j+1)
				}
			}
		} else {
			if b.size() != 5 {
				t.Fatalf("got bucket size %d, want 5\n", b.size())
			}
			for j := 0; j < 5; j++ {
				want := i - 4 + j
				if b.span(j).TraceID[0] != byte(want) {
					t.Errorf("got span index %d, want %d\n", b.span(j).TraceID[0], want)
				}
			}
		}
	}
	// expand the bucket
	b.resize(20)
	if b.size() != 5 {
		t.Fatalf("after resizing upwards: got bucket size %d, want 5\n", b.size())
	}
	for i := 0; i < 5; i++ {
		want := 6 + i
		if b.span(i).TraceID[0] != byte(want) {
			t.Errorf("after resizing upwards: got span index %d, want %d\n", b.span(i).TraceID[0], want)
		}
	}
	// shrink the bucket
	b.resize(3)
	if b.size() != 3 {
		t.Fatalf("after resizing downwards: got bucket size %d, want 3\n", b.size())
	}
	for i := 0; i < 3; i++ {
		want := 8 + i
		if b.span(i).TraceID[0] != byte(want) {
			t.Errorf("after resizing downwards: got span index %d, want %d\n", b.span(i).TraceID[0], want)
		}
	}
}

type exporter map[string]*SpanData

func (e exporter) ExportSpan(s *SpanData) {
	e[s.Name] = s
}

func Test_Issue328_EndSpanTwice(t *testing.T) {
	spans := make(exporter)
	RegisterExporter(&spans)
	defer UnregisterExporter(&spans)
	ctx := context.Background()
	ctx, span := StartSpanWithOptions(ctx, "span-1", StartOptions{Sampler: AlwaysSample()})
	span.End()
	span.End()
	UnregisterExporter(&spans)
	if len(spans) != 1 {
		t.Fatalf("expected only a single span, got %#v", spans)
	}
}

func TestStartSpanAfterEnd(t *testing.T) {
	spans := make(exporter)
	RegisterExporter(&spans)
	defer UnregisterExporter(&spans)
	ctx, span0 := StartSpanWithOptions(context.Background(), "parent", StartOptions{Sampler: AlwaysSample()})
	ctx1, span1 := StartSpanWithOptions(ctx, "span-1", StartOptions{Sampler: AlwaysSample()})
	span1.End()
	// Start a new span with the context containing span-1
	// even though span-1 is ended, we still add this as a new child of span-1
	_, span2 := StartSpanWithOptions(ctx1, "span-2", StartOptions{Sampler: AlwaysSample()})
	span2.End()
	span0.End()
	UnregisterExporter(&spans)
	if got, want := len(spans), 3; got != want {
		t.Fatalf("len(%#v) = %d; want %d", spans, got, want)
	}
	if got, want := spans["span-1"].TraceID, spans["parent"].TraceID; got != want {
		t.Errorf("span-1.TraceID=%q; want %q", got, want)
	}
	if got, want := spans["span-2"].TraceID, spans["parent"].TraceID; got != want {
		t.Errorf("span-2.TraceID=%q; want %q", got, want)
	}
	if got, want := spans["span-1"].ParentSpanID, spans["parent"].SpanID; got != want {
		t.Errorf("span-1.ParentSpanID=%q; want %q (parent.SpanID)", got, want)
	}
	if got, want := spans["span-2"].ParentSpanID, spans["span-1"].SpanID; got != want {
		t.Errorf("span-2.ParentSpanID=%q; want %q (span1.SpanID)", got, want)
	}
}
