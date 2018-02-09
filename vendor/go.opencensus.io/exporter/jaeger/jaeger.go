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

// Package jaeger contains an OpenCensus tracing exporter for Jaeger.
package jaeger

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"

	"git.apache.org/thrift.git/lib/go/thrift"
	gen "go.opencensus.io/exporter/jaeger/internal/gen-go/jaeger"
	"go.opencensus.io/trace"
	"google.golang.org/api/support/bundler"
)

const defaultServiceName = "OpenCensus"

// Options are the options to be used when initializing a Jaeger exporter.
type Options struct {
	// Endpoint is the Jaeger HTTP Thrift endpoint.
	// For example, http://localhost:14268.
	Endpoint string

	// OnError is the hook to be called when there is
	// an error occurred when uploading the stats data.
	// If no custom hook is set, errors are logged.
	// Optional.
	OnError func(err error)

	// Username to be used if basic auth is required.
	// Optional.
	Username string

	// Password to be used if basic auth is required.
	// Optional.
	Password string

	// ServiceName is the Jaeger service name.
	ServiceName string
}

// NewExporter returns a trace.Exporter implementation that exports
// the collected spans to Jaeger.
func NewExporter(o Options) (*Exporter, error) {
	endpoint := o.Endpoint
	if endpoint == "" {
		return nil, errors.New("missing endpoint for Jaeger exporter")
	}
	endpoint = endpoint + "/api/traces?format=jaeger.thrift"
	onError := func(err error) {
		if o.OnError != nil {
			o.OnError(err)
			return
		}
		log.Printf("Error when uploading spans to Jaeger: %v", err)
	}
	service := o.ServiceName
	if service == "" {
		service = defaultServiceName
	}
	e := &Exporter{
		endpoint: endpoint,
		username: o.Username,
		password: o.Password,
		service:  service,
	}
	bundler := bundler.NewBundler((*gen.Span)(nil), func(bundle interface{}) {
		if err := e.upload(bundle.([]*gen.Span)); err != nil {
			onError(err)
		}
	})
	e.bundler = bundler
	return e, nil
}

// Exporter is an implementation of trace.Exporter that uploads spans to Jaeger.
type Exporter struct {
	endpoint string
	service  string
	bundler  *bundler.Bundler

	username, password string
}

var _ trace.Exporter = (*Exporter)(nil)

// TODO(jbd): Also implement propagation.HTTPFormat.

// ExportSpan exports a SpanData to Jaeger.
func (e *Exporter) ExportSpan(data *trace.SpanData) {
	var tags []*gen.Tag
	for k, v := range data.Attributes {
		tag := attributeToTag(k, v)
		if tag != nil {
			tags = append(tags, tag)
		}
	}
	var logs []*gen.Log
	for _, a := range data.Annotations {
		var fields []*gen.Tag
		for k, v := range a.Attributes {
			tag := attributeToTag(k, v)
			if tag != nil {
				fields = append(tags, tag)
			}
		}
		logs = append(logs, &gen.Log{
			Timestamp: a.Time.Unix() * 1000 * 1000,
			Fields:    fields,
		})
	}
	var refs []*gen.SpanRef
	for _, link := range data.Links {
		refs = append(refs, &gen.SpanRef{
			TraceIdLow:  bytesToInt64(link.TraceID[0:8]),
			TraceIdHigh: bytesToInt64(link.TraceID[8:16]),
			SpanId:      bytesToInt64(link.SpanID[:]),
		})
	}
	span := &gen.Span{
		TraceIdLow:    bytesToInt64(data.TraceID[0:8]),
		TraceIdHigh:   bytesToInt64(data.TraceID[8:16]),
		SpanId:        bytesToInt64(data.SpanID[:]),
		ParentSpanId:  bytesToInt64(data.ParentSpanID[:]),
		OperationName: data.Name,
		Flags:         int32(data.TraceOptions),
		StartTime:     data.StartTime.Unix() * 1000 * 1000, // Add nanosecs.
		Duration:      int64(data.EndTime.Sub(data.StartTime)),
		Tags:          tags,
		Logs:          logs,
		References:    refs,
	}
	e.bundler.Add(span, 1)
	// TODO(jbd): Handle oversized bundlers.
}

func attributeToTag(key string, a interface{}) *gen.Tag {
	var tag *gen.Tag
	switch value := a.(type) {
	case bool:
		tag = &gen.Tag{
			Key:   key,
			VBool: &value,
		}
	case string:
		tag = &gen.Tag{
			Key:  key,
			VStr: &value,
		}
	case int64:
		tag = &gen.Tag{
			Key:   key,
			VLong: &value,
		}
	}
	return tag
}

// Flush waits for exported trace spans to be uploaded.
//
// This is useful if your program is ending and you do not want to lose recent spans.
func (e *Exporter) Flush() {
	e.bundler.Flush()
}

func (e *Exporter) upload(spans []*gen.Span) error {
	batch := &gen.Batch{
		Spans: spans,
		Process: &gen.Process{
			ServiceName: e.service,
		},
	}
	body, err := serialize(batch)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", e.endpoint, body)
	if err != nil {
		return err
	}
	if e.username != "" && e.password != "" {
		req.SetBasicAuth(e.username, e.password)
	}
	req.Header.Set("Content-Type", "application/x-thrift")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}

	io.Copy(ioutil.Discard, resp.Body)
	resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("failed to upload traces; HTTP status code: %d", resp.StatusCode)
	}
	return nil
}

func serialize(obj thrift.TStruct) (*bytes.Buffer, error) {
	buf := thrift.NewTMemoryBuffer()
	if err := obj.Write(thrift.NewTBinaryProtocolTransport(buf)); err != nil {
		return nil, err
	}
	return buf.Buffer, nil
}

func bytesToInt64(buf []byte) int64 {
	u := binary.BigEndian.Uint64(buf)
	return int64(u)
}
