// Copyright 2018, OpenCensus Authors
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

package httptrace

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"go.opencensus.io/trace"
	"go.opencensus.io/trace/propagation"
)

type testTransport struct {
	ch chan *http.Request
}

func (t *testTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.ch <- req
	return nil, errors.New("noop")
}

type testPropagator struct{}

func (t testPropagator) FromRequest(req *http.Request) (sc trace.SpanContext, ok bool) {
	header := req.Header.Get("trace")
	buf, err := hex.DecodeString(header)
	if err != nil {
		log.Fatalf("Cannot decode trace header: %q", header)
	}
	r := bytes.NewReader(buf)
	r.Read(sc.TraceID[:])
	r.Read(sc.SpanID[:])
	opts, err := r.ReadByte()
	if err != nil {
		log.Fatalf("Cannot read trace options from trace header: %q", header)
	}
	sc.TraceOptions = trace.TraceOptions(opts)
	return sc, true
}

func (t testPropagator) ToRequest(sc trace.SpanContext, req *http.Request) {
	var buf bytes.Buffer
	buf.Write(sc.TraceID[:])
	buf.Write(sc.SpanID[:])
	buf.WriteByte(byte(sc.TraceOptions))
	req.Header.Set("trace", hex.EncodeToString(buf.Bytes()))
}

func TestTransport_RoundTrip(t *testing.T) {
	parent := trace.NewSpan("parent", nil, trace.StartOptions{})
	tests := []struct {
		name       string
		parent     *trace.Span
		wantHeader string
	}{
		{
			name:   "no parent",
			parent: nil,
		},
		{
			name:   "parent",
			parent: parent,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			transport := &testTransport{ch: make(chan *http.Request, 1)}
			rt := NewTransport(&testPropagator{})
			rt.Base = transport

			req, _ := http.NewRequest("GET", "http://foo.com", nil)
			if tt.parent != nil {
				req = req.WithContext(trace.WithSpan(req.Context(), tt.parent))
			}
			rt.RoundTrip(req)

			req = <-transport.ch
			span := trace.FromContext(req.Context())

			if header := req.Header.Get("trace"); header == "" {
				t.Fatalf("Trace header = empty; want valid trace header")
			}
			if span == nil {
				t.Fatalf("Got no spans in req context; want one")
			}
			if tt.parent != nil {
				if got, want := span.SpanContext().TraceID, tt.parent.SpanContext().TraceID; got != want {
					t.Errorf("span.SpanContext().TraceID=%v; want %v", got, want)
				}
			}
		})
	}
}

func TestHandler(t *testing.T) {
	traceID := [16]byte{16, 84, 69, 170, 120, 67, 188, 139, 242, 6, 177, 32, 0, 16, 0, 0}
	tests := []struct {
		header           string
		wantTraceID      trace.TraceID
		wantTraceOptions trace.TraceOptions
	}{
		{
			header:           "105445aa7843bc8bf206b12000100000000000000000000000",
			wantTraceID:      traceID,
			wantTraceOptions: trace.TraceOptions(0),
		},
		{
			header:           "105445aa7843bc8bf206b12000100000000000000000000001",
			wantTraceID:      traceID,
			wantTraceOptions: trace.TraceOptions(1),
		},
	}

	for _, tt := range tests {
		t.Run(tt.header, func(t *testing.T) {
			propagator := &testPropagator{}

			handler := NewHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				span := trace.FromContext(r.Context())
				sc := span.SpanContext()
				if got, want := sc.TraceID, tt.wantTraceID; got != want {
					t.Errorf("TraceID = %q; want %q", got, want)
				}
				if got, want := sc.TraceOptions, tt.wantTraceOptions; got != want {
					t.Errorf("TraceOptions = %v; want %v", got, want)
				}
			}), propagator)
			req, _ := http.NewRequest("GET", "http://foo.com", nil)
			req.Header.Add("trace", tt.header)
			handler.ServeHTTP(nil, req)
		})
	}
}

var _ http.RoundTripper = (*Transport)(nil)
var propagators = []propagation.HTTPFormat{testPropagator{}}

type collector []*trace.SpanData

func (c *collector) ExportSpan(s *trace.SpanData) {
	*c = append(*c, s)
}

func TestEndToEnd(t *testing.T) {
	var spans collector
	trace.RegisterExporter(&spans)
	defer trace.UnregisterExporter(&spans)

	ctx, _ := trace.StartSpanWithOptions(context.Background(),
		"top-level",
		trace.StartOptions{
			RecordEvents: true,
			Sampler:      trace.AlwaysSample(),
		})

	serverDone := make(chan struct{})
	serverReturn := make(chan time.Time)
	url := serveHTTP(serverDone, serverReturn)

	req, err := http.NewRequest(
		"POST",
		fmt.Sprintf("%s/example/url/path?qparam=val", url),
		strings.NewReader("expected-request-body"))
	if err != nil {
		t.Fatalf("unexpected error %#v", err)
	}
	req = req.WithContext(ctx)

	rt := &Transport{Formats: propagators}
	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("unexpected error %#v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected stats: %d", resp.StatusCode)
	}

	serverReturn <- time.Now().Add(time.Millisecond)

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("unexpected read error: %#v", err)
	}
	if string(respBody) != "expected-response" {
		t.Fatalf("unexpected response: %s", string(respBody))
	}

	resp.Body.Close()

	<-serverDone
	trace.UnregisterExporter(&spans)

	if len(spans) != 2 {
		t.Fatalf("expected two spans, got: %#v", spans)
	}

	var client, server *trace.SpanData
	for _, sp := range spans {
		if strings.HasPrefix(sp.Name, "Sent.") {
			client = sp
			serverHostport := req.URL.Hostname() + ":" + req.URL.Port()
			if got, want := client.Name, "Sent."+serverHostport+"/example/url/path"; got != want {
				t.Errorf("Span name: %q; want %q", got, want)
			}
		} else if strings.HasPrefix(sp.Name, "Recv.") {
			server = sp
			if got, want := server.Name, "Recv./example/url/path"; got != want {
				t.Errorf("Span name: %q; want %q", got, want)
			}
		}
	}

	if server == nil || client == nil {
		t.Fatalf("server or client span missing")
	}
	if server.TraceID != client.TraceID {
		t.Errorf("TraceID does not match: server.TraceID=%q client.TraceID=%q", server.TraceID, client.TraceID)
	}
	if server.StartTime.Before(client.StartTime) {
		t.Errorf("server span starts before client span")
	}
	if server.EndTime.After(client.EndTime) {
		t.Errorf("client span ends before server span")
	}
	if !server.HasRemoteParent {
		t.Errorf("server span should have remote parent")
	}
	if server.ParentSpanID != client.SpanID {
		t.Errorf("server span should have client span as parent")
	}
}

func serveHTTP(done chan struct{}, wait chan time.Time) string {
	server := httptest.NewServer(NewHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()

		// simulate a slow-responding server
		sleepUntil := <-wait
		for time.Now().Before(sleepUntil) {
			time.Sleep(sleepUntil.Sub(time.Now()))
		}

		io.WriteString(w, "expected-response")
		close(done)
	}), propagators...))
	go func() {
		<-done
		server.Close()
	}()
	return server.URL
}

func TestSpanNameFromURL(t *testing.T) {
	tests := []struct {
		prefix string
		u      string
		want   string
	}{
		{
			prefix: "Sent",
			u:      "http://localhost:80/hello?q=a",
			want:   "Sent.localhost/hello",
		},
		{
			prefix: "Recv",
			u:      "https://localhost:443/a",
			want:   "Recv.localhost/a",
		},
		{
			prefix: "Recv",
			u:      "https://example.com:7654/a",
			want:   "Recv.example.com:7654/a",
		},
		{
			prefix: "Sent",
			u:      "/a/b?q=c",
			want:   "Sent./a/b",
		},
	}
	for _, tt := range tests {
		t.Run(tt.prefix+"-"+tt.u, func(t *testing.T) {
			u, err := url.Parse(tt.u)
			if err != nil {
				t.Errorf("url.Parse() = %v", err)
			}
			if got := spanNameFromURL(tt.prefix, u); got != tt.want {
				t.Errorf("spanNameFromURL() = %v, want %v", got, tt.want)
			}
		})
	}
}
