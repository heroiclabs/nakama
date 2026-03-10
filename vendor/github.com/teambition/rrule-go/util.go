// 2017-2022, Teambition. All rights reserved.

package rrule

import (
	"errors"
	"math"
	"time"
)

// MAXYEAR
const (
	MAXYEAR = 9999
)

// Next is a generator of time.Time.
// It returns false of Ok if there is no value to generate.
type Next func() (value time.Time, ok bool)

type timeSlice []time.Time

func (s timeSlice) Len() int           { return len(s) }
func (s timeSlice) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }
func (s timeSlice) Less(i, j int) bool { return s[i].Before(s[j]) }

// Python: MO-SU: 0 - 6
// Golang: SU-SAT 0 - 6
func toPyWeekday(from time.Weekday) int {
	return []int{6, 0, 1, 2, 3, 4, 5}[from]
}

// year -> 1 if leap year, else 0."
func isLeap(year int) int {
	if year%4 == 0 && (year%100 != 0 || year%400 == 0) {
		return 1
	}
	return 0
}

// daysIn returns the number of days in a month for a given year.
func daysIn(m time.Month, year int) int {
	return time.Date(year, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// mod in Python
func pymod(a, b int) int {
	r := a % b
	// If r and b differ in sign, add b to wrap the result to the correct sign.
	if r*b < 0 {
		r += b
	}
	return r
}

// divmod in Python
func divmod(a, b int) (div, mod int) {
	return int(math.Floor(float64(a) / float64(b))), pymod(a, b)
}

func contains(list []int, elem int) bool {
	for _, t := range list {
		if t == elem {
			return true
		}
	}
	return false
}

func timeContains(list []time.Time, elem time.Time) bool {
	for _, t := range list {
		if t.Equal(elem) {
			return true
		}
	}
	return false
}

func repeat(value, count int) []int {
	result := []int{}
	for i := 0; i < count; i++ {
		result = append(result, value)
	}
	return result
}

func concat(slices ...[]int) []int {
	result := []int{}
	for _, item := range slices {
		result = append(result, item...)
	}
	return result
}

func rang(start, end int) []int {
	result := []int{}
	for i := start; i < end; i++ {
		result = append(result, i)
	}
	return result
}

func pySubscript(slice []int, index int) (int, error) {
	if index < 0 {
		index += len(slice)
	}
	if index < 0 || index >= len(slice) {
		return 0, errors.New("index error")
	}
	return slice[index], nil
}

func timeSliceIterator(s []time.Time) func() (time.Time, bool) {
	index := 0
	return func() (time.Time, bool) {
		if index >= len(s) {
			return time.Time{}, false
		}
		result := s[index]
		index++
		return result, true
	}
}

func easter(year int) time.Time {
	g := year % 19
	c := year / 100
	h := (c - c/4 - (8*c+13)/25 + 19*g + 15) % 30
	i := h - (h/28)*(1-(h/28)*(29/(h+1))*((21-g)/11))
	j := (year + year/4 + i + 2 - c + c/4) % 7
	p := i - j
	d := 1 + (p+27+(p+6)/40)%31
	m := 3 + (p+26)/30
	return time.Date(year, time.Month(m), d, 0, 0, 0, 0, time.UTC)
}

func all(next Next) []time.Time {
	result := []time.Time{}
	for {
		v, ok := next()
		if !ok {
			return result
		}
		result = append(result, v)
	}
}

func between(next Next, after, before time.Time, inc bool) []time.Time {
	result := []time.Time{}
	for {
		v, ok := next()
		if !ok || inc && v.After(before) || !inc && !v.Before(before) {
			return result
		}
		if inc && !v.Before(after) || !inc && v.After(after) {
			result = append(result, v)
		}
	}
}

func before(next Next, dt time.Time, inc bool) time.Time {
	result := time.Time{}
	for {
		v, ok := next()
		if !ok || inc && v.After(dt) || !inc && !v.Before(dt) {
			return result
		}
		result = v
	}
}

func after(next Next, dt time.Time, inc bool) time.Time {
	for {
		v, ok := next()
		if !ok {
			return time.Time{}
		}
		if inc && !v.Before(dt) || !inc && v.After(dt) {
			return v
		}
	}
}

type optInt struct {
	Int     int
	Defined bool
}
