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

// Package httptrace contains OpenCensus tracing integrations with net/http.
package httptrace

import (
	"io"
	"net/http"
	"net/url"
	"sync"

	"go.opencensus.io/trace"
	"go.opencensus.io/trace/propagation"
)

// TODO(jbd): Add godoc examples.

// Transport is an http.RoundTripper that traces the outgoing requests.
//
// Use NewTransport to create new transports.
type Transport struct {
	// Base represents the underlying roundtripper that does the actual requests.
	// If none is given, http.DefaultTransport is used.
	//
	// If base HTTP roundtripper implements CancelRequest,
	// the returned round tripper will be cancelable.
	Base http.RoundTripper

	// Formats are the mechanisms that propagate
	// the outgoing trace in an HTTP request.
	Formats []propagation.HTTPFormat
}

// RoundTrip creates a trace.Span and inserts it into the outgoing request's headers.
// The created span can follow a parent span, if a parent is presented in
// the request's context.
func (t *Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	name := spanNameFromURL("Sent", req.URL)
	// TODO(jbd): Discuss whether we want to prefix
	// outgoing requests with Sent.
	ctx, span := trace.StartSpan(req.Context(), name)
	req = req.WithContext(ctx)

	for _, f := range t.Formats {
		f.ToRequest(span.SpanContext(), req)
	}

	resp, err := t.base().RoundTrip(req)

	// TODO(jbd): Add status and attributes.
	if err != nil {
		span.End()
		return resp, err
	}

	// trace.EndSpan(ctx) will be invoked after
	// a read from resp.Body returns io.EOF or when
	// resp.Body.Close() is invoked.
	resp.Body = &spanEndBody{rc: resp.Body, span: span}
	return resp, err
}

// spanEndBody wraps a response.Body and invokes
// trace.EndSpan on encountering io.EOF on reading
// the body of the original response.
type spanEndBody struct {
	rc   io.ReadCloser
	span *trace.Span

	endSpanOnce sync.Once
}

var _ io.ReadCloser = (*spanEndBody)(nil)

func (seb *spanEndBody) Read(b []byte) (int, error) {
	n, err := seb.rc.Read(b)

	switch err {
	case nil:
		return n, nil
	case io.EOF:
		seb.endSpan()
	default:
		// For all other errors, set the span status
		seb.span.SetStatus(trace.Status{
			// Code 2 is the error code for Internal server error.
			Code:    2,
			Message: err.Error(),
		})
	}
	return n, err
}

// endSpan invokes trace.EndSpan exactly once
func (seb *spanEndBody) endSpan() {
	seb.endSpanOnce.Do(func() {
		seb.span.End()
	})
}

func (seb *spanEndBody) Close() error {
	// Invoking endSpan on Close will help catch the cases
	// in which a read returned a non-nil error, we set the
	// span status but didn't end the span.
	seb.endSpan()
	return seb.rc.Close()
}

// CancelRequest cancels an in-flight request by closing its connection.
func (t *Transport) CancelRequest(req *http.Request) {
	type canceler interface {
		CancelRequest(*http.Request)
	}
	if cr, ok := t.base().(canceler); ok {
		cr.CancelRequest(req)
	}
}

func (t *Transport) base() http.RoundTripper {
	if t.Base != nil {
		return t.Base
	}
	return http.DefaultTransport
}

// NewTransport returns an http.RoundTripper that traces the outgoing requests.
//
// Traces are propagated via the provided HTTP propagation mechanisms.
func NewTransport(format ...propagation.HTTPFormat) *Transport {
	return &Transport{Formats: format}
}

// NewHandler returns a http.Handler from the given handler
// that is aware of the incoming request's span.
// The span can be extracted from the incoming request in handler
// functions from incoming request's context:
//
//    span := trace.FromContext(r.Context())
//
// The span will be automatically ended by the handler.
//
// Incoming propagation mechanism is determined by the given HTTP propagators.
func NewHandler(base http.Handler, format ...propagation.HTTPFormat) http.Handler {
	return &handler{handler: base, formats: format}
}

type handler struct {
	handler http.Handler
	formats []propagation.HTTPFormat
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name := spanNameFromURL("Recv", r.URL)

	var (
		sc trace.SpanContext
		ok bool
	)

	ctx := r.Context()
	for _, f := range h.formats {
		sc, ok = f.FromRequest(r)
		if ok {
			break
		}
	}
	var span *trace.Span
	if ok {
		ctx, span = trace.StartSpanWithRemoteParent(ctx, name, sc, trace.StartOptions{})
	} else {
		ctx, span = trace.StartSpan(ctx, name)
	}
	defer span.End()

	// TODO(jbd): Add status and attributes.
	r = r.WithContext(ctx)
	h.handler.ServeHTTP(w, r)
}

func spanNameFromURL(prefix string, u *url.URL) string {
	host := u.Hostname()
	port := ":" + u.Port()
	if port == ":" || port == ":80" || port == ":443" {
		port = ""
	}
	return prefix + "." + host + port + u.Path
}
