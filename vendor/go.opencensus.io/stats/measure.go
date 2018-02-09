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

// Measure represents a type of metric to be tracked and recorded.
// For example, latency, request Mb/s, and response Mb/s are measures
// to collect from a server.
//
// Each measure needs to be registered before being used.
// Measure constructors such as NewMeasureInt64 and
// NewMeasureFloat64 automatically registers the measure
// by the given name.
// Each registered measure needs to be unique by name.
// Measures also have a description and a unit.
type Measure interface {
	Name() string
	Description() string
	Unit() string
}

// Measurement is the numeric value measured when recording stats. Each measure
// provides methods to create measurements of their kind. For example, MeasureInt64
// provides M to convert an int64 into a measurement.
type Measurement struct {
	v interface{} // int64 or float64
	m Measure
}

// FindMeasure returns the registered measure associated with name.
// If no registered measure is not found, nil is returned.
func FindMeasure(name string) (m Measure) {
	req := &getMeasureByNameReq{
		name: name,
		c:    make(chan *getMeasureByNameResp),
	}
	defaultWorker.c <- req
	resp := <-req.c
	return resp.m
}

// DeleteMeasure deletes an existing measure to allow for creation of a new
// measure with the same name. It returns an error if the measure cannot be
// deleted, such as one or multiple registered views refer to it.
func DeleteMeasure(m Measure) error {
	req := &deleteMeasureReq{
		m:   m,
		err: make(chan error),
	}
	defaultWorker.c <- req
	return <-req.err
}
