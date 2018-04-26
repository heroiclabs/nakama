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

import (
	"fmt"
	"math"
	"reflect"
	"strconv"
	"testing"
)

func TestParseDistance(t *testing.T) {
	tests := []struct {
		dist    string
		want    float64
		wantErr error
	}{
		{"5mi", 5 * 1609.344, nil},
		{"3", 3, nil},
		{"3m", 3, nil},
		{"5km", 5000, nil},
		{"km", 0, &strconv.NumError{Func: "ParseFloat", Num: "", Err: strconv.ErrSyntax}},
		{"", 0, &strconv.NumError{Func: "ParseFloat", Num: "", Err: strconv.ErrSyntax}},
	}

	for _, test := range tests {
		got, err := ParseDistance(test.dist)
		if !reflect.DeepEqual(err, test.wantErr) {
			t.Errorf("expected err: %v, got %v for %s", test.wantErr, err, test.dist)
		}
		if got != test.want {
			t.Errorf("expected distance %f got %f for %s", test.want, got, test.dist)
		}
	}
}

func TestParseDistanceUnit(t *testing.T) {
	tests := []struct {
		dist    string
		want    float64
		wantErr error
	}{
		{"mi", 1609.344, nil},
		{"m", 1, nil},
		{"km", 1000, nil},
		{"", 0, fmt.Errorf("unknown distance unit: ")},
		{"kam", 0, fmt.Errorf("unknown distance unit: kam")},
	}

	for _, test := range tests {
		got, err := ParseDistanceUnit(test.dist)
		if !reflect.DeepEqual(err, test.wantErr) {
			t.Errorf("expected err: %v, got %v for %s", test.wantErr, err, test.dist)
		}
		if got != test.want {
			t.Errorf("expected distance %f got %f for %s", test.want, got, test.dist)
		}
	}
}

func TestHaversinDistance(t *testing.T) {
	earthRadiusKMs := 6378.137
	halfCircle := earthRadiusKMs * math.Pi

	tests := []struct {
		lon1 float64
		lat1 float64
		lon2 float64
		lat2 float64
		want float64
	}{
		{1, 1, math.NaN(), 1, math.NaN()},
		{1, 1, 1, math.NaN(), math.NaN()},
		{1, math.NaN(), 1, 1, math.NaN()},
		{math.NaN(), 1, 1, 1, math.NaN()},

		{0, 0, 0, 0, 0},
		{-180, 0, -180, 0, 0},
		{-180, 0, 180, 0, 0},
		{180, 0, 180, 0, 0},

		{0, 90, 0, 90, 0},
		{-180, 90, -180, 90, 0},
		{-180, 90, 180, 90, 0},
		{180, 90, 180, 90, 0},

		{0, 0, 180, 0, halfCircle},

		{-74.0059731, 40.7143528, -74.0059731, 40.7143528, 0},
		{-74.0059731, 40.7143528, -73.9844722, 40.759011, 5.286},
		{-74.0059731, 40.7143528, -74.007819, 40.718266, 0.4621},
		{-74.0059731, 40.7143528, -74.0088305, 40.7051157, 1.055},
		{-74.0059731, 40.7143528, -74, 40.7247222, 1.258},
		{-74.0059731, 40.7143528, -73.9962255, 40.731033, 2.029},
		{-74.0059731, 40.7143528, -73.95, 40.65, 8.572},
	}

	for _, test := range tests {
		got := Haversin(test.lon1, test.lat1, test.lon2, test.lat2)
		if math.IsNaN(test.want) && !math.IsNaN(got) {
			t.Errorf("expected NaN, got %f", got)
		}
		if !math.IsNaN(test.want) && math.Abs(got-test.want) > 1E-2 {
			t.Errorf("expected %f got %f", test.want, got)
		}
	}
}
