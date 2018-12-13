//  Copyright (c) 2017 Couchbase, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 		http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package geo

import "testing"

func TestExtractGeoPoint(t *testing.T) {

	tests := []struct {
		in      interface{}
		lon     float64
		lat     float64
		success bool
	}{
		// values are ints
		{
			in: map[string]interface{}{
				"lat": 5,
				"lon": 5,
			},
			lon:     5,
			lat:     5,
			success: true,
		},
		// values are uints
		{
			in: map[string]interface{}{
				"lat": uint(5),
				"lon": uint(5),
			},
			lon:     5,
			lat:     5,
			success: true,
		},
		// values float64 as with parsed JSON
		{
			in: map[string]interface{}{
				"lat": 5.0,
				"lon": 5.0,
			},
			lon:     5,
			lat:     5,
			success: true,
		},
		// values are bool (not supported)
		{
			in: map[string]interface{}{
				"lat": true,
				"lon": false,
			},
			lon:     0,
			lat:     0,
			success: false,
		},
		// using lng variant of lon
		{
			in: map[string]interface{}{
				"lat": 5.0,
				"lng": 5.0,
			},
			lon:     5,
			lat:     5,
			success: true,
		},
		// using struct
		{
			in: struct {
				Lon float64
				Lat float64
			}{
				Lon: 3.0,
				Lat: 7.5,
			},
			lon:     3.0,
			lat:     7.5,
			success: true,
		},
		// struct with lng alternate
		{
			in: struct {
				Lng float64
				Lat float64
			}{
				Lng: 3.0,
				Lat: 7.5,
			},
			lon:     3.0,
			lat:     7.5,
			success: true,
		},
		// test going throug interface
		{
			in: &s1{
				lon: 4.0,
				lat: 6.9,
			},
			lon:     4.0,
			lat:     6.9,
			success: true,
		},
		// test going throug interface with lng variant
		{
			in: &s2{
				lng: 4.0,
				lat: 6.9,
			},
			lon:     4.0,
			lat:     6.9,
			success: true,
		},
		// try GeoJSON slice
		{
			in:      []interface{}{3.4, 5.9},
			lon:     3.4,
			lat:     5.9,
			success: true,
		},
		// try GeoJSON slice too long
		{
			in:      []interface{}{3.4, 5.9, 9.4},
			lon:     0,
			lat:     0,
			success: false,
		},
		// slice of floats
		{
			in:      []float64{3.4, 5.9},
			lon:     3.4,
			lat:     5.9,
			success: true,
		},
		// values are nil (not supported)
		{
			in: map[string]interface{}{
				"lat": nil,
				"lon": nil,
			},
			lon:     0,
			lat:     0,
			success: false,
		},
		// input is nil
		{
			in:      nil,
			lon:     0,
			lat:     0,
			success: false,
		},
	}

	for _, test := range tests {
		lon, lat, success := ExtractGeoPoint(test.in)
		if success != test.success {
			t.Errorf("expected extract geo point %t, got %t for %v", test.success, success, test.in)
		}
		if lon != test.lon {
			t.Errorf("expected lon %f, got %f for %v", test.lon, lon, test.in)
		}
		if lat != test.lat {
			t.Errorf("expected lat %f, got %f for %v", test.lat, lat, test.in)
		}
	}
}

type s1 struct {
	lon float64
	lat float64
}

func (s *s1) Lon() float64 {
	return s.lon
}

func (s *s1) Lat() float64 {
	return s.lat
}

type s2 struct {
	lng float64
	lat float64
}

func (s *s2) Lng() float64 {
	return s.lng
}

func (s *s2) Lat() float64 {
	return s.lat
}
