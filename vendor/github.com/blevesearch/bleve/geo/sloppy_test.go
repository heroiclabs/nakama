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
	"math"
	"testing"
)

func TestCos(t *testing.T) {

	cosDelta := 1E-15

	tests := []struct {
		in   float64
		want float64
	}{
		{math.NaN(), math.NaN()},
		{math.Inf(-1), math.NaN()},
		{math.Inf(1), math.NaN()},
		{1, math.Cos(1)},
		{0, math.Cos(0)},
		{math.Pi / 2, math.Cos(math.Pi / 2)},
		{-math.Pi / 2, math.Cos(-math.Pi / 2)},
		{math.Pi / 4, math.Cos(math.Pi / 4)},
		{-math.Pi / 4, math.Cos(-math.Pi / 4)},
		{math.Pi * 2 / 3, math.Cos(math.Pi * 2 / 3)},
		{-math.Pi * -2 / 3, math.Cos(-math.Pi * -2 / 3)},
		{math.Pi / 6, math.Cos(math.Pi / 6)},
		{-math.Pi / 6, math.Cos(-math.Pi / 6)},
	}

	for _, test := range tests {
		got := cos(test.in)
		if math.IsNaN(test.want) && !math.IsNaN(got) {
			t.Errorf("wanted NaN, got %f for cos(%f)", got, test.in)
		}
		if !math.IsNaN(test.want) && math.Abs(got-test.want) > cosDelta {
			t.Errorf("wanted: %f, got %f for cos(%f) diff %f", test.want, got, test.in, math.Abs(got-test.want))
		}
	}
}

func TestAsin(t *testing.T) {

	asinDelta := 1E-7

	tests := []struct {
		in   float64
		want float64
	}{
		{math.NaN(), math.NaN()},
		{2, math.NaN()},
		{-2, math.NaN()},
		{-1, -math.Pi / 2},
		{-0.8660254, -math.Pi / 3},
		{-0.7071068, -math.Pi / 4},
		{-0.5, -math.Pi / 6},
		{0, 0},
		{0.5, math.Pi / 6},
		{0.7071068, math.Pi / 4},
		{0.8660254, math.Pi / 3},
		{1, math.Pi / 2},
		// these last two cases test the code outside tabular range
		{0.999999999999999, math.Pi / 2},
		{-0.999999999999999, -math.Pi / 2},
	}

	for _, test := range tests {
		got := asin(test.in)
		if math.IsNaN(test.want) && !math.IsNaN(got) {
			t.Errorf("wanted NaN, got %f for asin(%f)", got, test.in)
		}
		if !math.IsNaN(test.want) && math.Abs(got-test.want) > asinDelta {
			t.Errorf("wanted: %f, got %f for asin(%f) diff %.16f", test.want, got, test.in, math.Abs(got-test.want))
		}
	}
}
