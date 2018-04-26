package roaring

// to run just these tests: go test -run TestSetUtil*

import (
	"testing"
)

func TestSetUtilDifference(t *testing.T) {
	data1 := []uint16{0, 1, 2, 3, 4, 9}
	data2 := []uint16{2, 3, 4, 5, 8, 9, 11}
	result := make([]uint16, 0, len(data1)+len(data2))
	expectedresult := []uint16{0, 1}
	nl := difference(data1, data2, result)
	result = result[:nl]
	if !equal(result, expectedresult) {
		t.Errorf("Difference is broken")
	}
	expectedresult = []uint16{5, 8, 11}
	nl = difference(data2, data1, result)
	result = result[:nl]
	if !equal(result, expectedresult) {
		t.Errorf("Difference is broken")
	}
}

func TestSetUtilUnion(t *testing.T) {
	data1 := []uint16{0, 1, 2, 3, 4, 9}
	data2 := []uint16{2, 3, 4, 5, 8, 9, 11}
	result := make([]uint16, 0, len(data1)+len(data2))
	expectedresult := []uint16{0, 1, 2, 3, 4, 5, 8, 9, 11}
	nl := union2by2(data1, data2, result)
	result = result[:nl]
	if !equal(result, expectedresult) {
		t.Errorf("Union is broken")
	}
	nl = union2by2(data2, data1, result)
	result = result[:nl]
	if !equal(result, expectedresult) {
		t.Errorf("Union is broken")
	}
}

func TestSetUtilExclusiveUnion(t *testing.T) {
	data1 := []uint16{0, 1, 2, 3, 4, 9}
	data2 := []uint16{2, 3, 4, 5, 8, 9, 11}
	result := make([]uint16, 0, len(data1)+len(data2))
	expectedresult := []uint16{0, 1, 5, 8, 11}
	nl := exclusiveUnion2by2(data1, data2, result)
	result = result[:nl]
	if !equal(result, expectedresult) {
		t.Errorf("Exclusive Union is broken")
	}
	nl = exclusiveUnion2by2(data2, data1, result)
	result = result[:nl]
	if !equal(result, expectedresult) {
		t.Errorf("Exclusive Union is broken")
	}
}

func TestSetUtilIntersection(t *testing.T) {
	data1 := []uint16{0, 1, 2, 3, 4, 9}
	data2 := []uint16{2, 3, 4, 5, 8, 9, 11}
	result := make([]uint16, 0, len(data1)+len(data2))
	expectedresult := []uint16{2, 3, 4, 9}
	nl := intersection2by2(data1, data2, result)
	result = result[:nl]
	result = result[:len(expectedresult)]
	if !equal(result, expectedresult) {
		t.Errorf("Intersection is broken")
	}
	nl = intersection2by2(data2, data1, result)
	result = result[:nl]
	if !equal(result, expectedresult) {
		t.Errorf("Intersection is broken")
	}
	data1 = []uint16{4}

	data2 = make([]uint16, 10000)
	for i := range data2 {
		data2[i] = uint16(i)
	}
	result = make([]uint16, 0, len(data1)+len(data2))
	expectedresult = data1
	nl = intersection2by2(data1, data2, result)
	result = result[:nl]

	if !equal(result, expectedresult) {
		t.Errorf("Long intersection is broken")
	}
	nl = intersection2by2(data2, data1, result)
	result = result[:nl]
	if !equal(result, expectedresult) {
		t.Errorf("Long intersection is broken")
	}

}

func TestSetUtilIntersection2(t *testing.T) {
	data1 := []uint16{0, 2, 4, 6, 8, 10, 12, 14, 16, 18}
	data2 := []uint16{0, 3, 6, 9, 12, 15, 18}
	result := make([]uint16, 0, len(data1)+len(data2))
	expectedresult := []uint16{0, 6, 12, 18}
	nl := intersection2by2(data1, data2, result)
	result = result[:nl]
	result = result[:len(expectedresult)]
	if !equal(result, expectedresult) {
		t.Errorf("Intersection is broken")
	}
}

func TestSetUtilBinarySearch(t *testing.T) {
	data := make([]uint16, 256)
	for i := range data {
		data[i] = uint16(2 * i)
	}
	for i := 0; i < 2*len(data); i++ {
		key := uint16(i)
		loc := binarySearch(data, key)
		if (key & 1) == 0 {
			if loc != int(key)/2 {
				t.Errorf("binary search is broken")
			}
		} else {
			if loc != -int(key)/2-2 {
				t.Errorf("neg binary search is broken")
			}
		}
	}
}
