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

func TestMortonHashMortonUnhash(t *testing.T) {
	tests := []struct {
		lon float64
		lat float64
	}{
		{-180.0, -90.0},
		{-5, 27.3},
		{0, 0},
		{1.0, 1.0},
		{24.7, -80.4},
		{180.0, 90.0},
	}

	for _, test := range tests {
		hash := MortonHash(test.lon, test.lat)
		lon := MortonUnhashLon(hash)
		lat := MortonUnhashLat(hash)
		if compareGeo(test.lon, lon) != 0 {
			t.Errorf("expected lon %f, got %f, hash %x", test.lon, lon, hash)
		}
		if compareGeo(test.lat, lat) != 0 {
			t.Errorf("expected lat %f, got %f, hash %x", test.lat, lat, hash)
		}
	}
}

func TestScaleLonUnscaleLon(t *testing.T) {
	tests := []struct {
		lon float64
	}{
		{-180.0},
		{0.0},
		{1.0},
		{180.0},
	}

	for _, test := range tests {
		s := scaleLon(test.lon)
		lon := unscaleLon(s)
		if compareGeo(test.lon, lon) != 0 {
			t.Errorf("expected %f, got %f, scaled was %d", test.lon, lon, s)
		}
	}
}

func TestScaleLatUnscaleLat(t *testing.T) {
	tests := []struct {
		lat float64
	}{
		{-90.0},
		{0.0},
		{1.0},
		{90.0},
	}

	for _, test := range tests {
		s := scaleLat(test.lat)
		lat := unscaleLat(s)
		if compareGeo(test.lat, lat) != 0 {
			t.Errorf("expected %.16f, got %.16f, scaled was %d", test.lat, lat, s)
		}
	}
}

func TestRectFromPointDistance(t *testing.T) {
	// at the equator 1 degree of latitude is about 110567 meters
	_, upperLeftLat, _, lowerRightLat, err := RectFromPointDistance(0, 0, 110567)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(upperLeftLat-1) > 1E-2 {
		t.Errorf("expected bounding box upper left lat to be almost 1, got %f", upperLeftLat)
	}
	if math.Abs(lowerRightLat+1) > 1E-2 {
		t.Errorf("expected bounding box lower right lat to be almost -1, got %f", lowerRightLat)
	}
}

func TestRectIntersects(t *testing.T) {
	tests := []struct {
		aMinX float64
		aMinY float64
		aMaxX float64
		aMaxY float64
		bMinX float64
		bMinY float64
		bMaxX float64
		bMaxY float64
		want  bool
	}{
		// clearly overlap
		{0, 0, 2, 2, 1, 1, 3, 3, true},
		// clearly do not overalp
		{0, 0, 1, 1, 2, 2, 3, 3, false},
		// share common point
		{0, 0, 1, 1, 1, 1, 2, 2, true},
	}

	for _, test := range tests {
		got := RectIntersects(test.aMinX, test.aMinY, test.aMaxX, test.aMaxY, test.bMinX, test.bMinY, test.bMaxX, test.bMaxY)
		if test.want != got {
			t.Errorf("expected intersects %t, got %t for %f %f %f %f %f %f %f %f", test.want, got, test.aMinX, test.aMinY, test.aMaxX, test.aMaxY, test.bMinX, test.bMinY, test.bMaxX, test.bMaxY)
		}
	}
}

func TestRectWithin(t *testing.T) {
	tests := []struct {
		aMinX float64
		aMinY float64
		aMaxX float64
		aMaxY float64
		bMinX float64
		bMinY float64
		bMaxX float64
		bMaxY float64
		want  bool
	}{
		// clearly within
		{1, 1, 2, 2, 0, 0, 3, 3, true},
		// clearly not within
		{0, 0, 1, 1, 2, 2, 3, 3, false},
		// overlapping
		{0, 0, 2, 2, 1, 1, 3, 3, false},
		// share common point
		{0, 0, 1, 1, 1, 1, 2, 2, false},
		// within, but boxes reversed (b is within a, but not a within b)
		{0, 0, 3, 3, 1, 1, 2, 2, false},
	}

	for _, test := range tests {
		got := RectWithin(test.aMinX, test.aMinY, test.aMaxX, test.aMaxY, test.bMinX, test.bMinY, test.bMaxX, test.bMaxY)
		if test.want != got {
			t.Errorf("expected within %t, got %t for %f %f %f %f %f %f %f %f", test.want, got, test.aMinX, test.aMinY, test.aMaxX, test.aMaxY, test.bMinX, test.bMinY, test.bMaxX, test.bMaxY)
		}
	}
}

func TestBoundingBoxContains(t *testing.T) {
	tests := []struct {
		lon  float64
		lat  float64
		minX float64
		minY float64
		maxX float64
		maxY float64
		want bool
	}{
		// clearly contains
		{1, 1, 0, 0, 2, 2, true},
		// clearly does not contain
		{0, 0, 1, 1, 2, 2, false},
		// on corner
		{0, 0, 0, 0, 2, 2, true},
	}
	for _, test := range tests {
		got := BoundingBoxContains(test.lon, test.lat, test.minX, test.minY, test.maxX, test.maxY)
		if test.want != got {
			t.Errorf("expected box contains %t, got %t for %f,%f in %f %f %f %f ", test.want, got, test.lon, test.lat, test.minX, test.minY, test.maxX, test.maxY)
		}
	}
}
