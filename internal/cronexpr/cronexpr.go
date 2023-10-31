/*!
 * Copyright 2013 Raymond Hill
 *
 * Project: github.com/gorhill/cronexpr
 * File: cronexpr.go
 * Version: 1.0
 * License: pick the one which suits you :
 *   GPL v3 see <https://www.gnu.org/licenses/gpl.html>
 *   APL v2 see <http://www.apache.org/licenses/LICENSE-2.0>
 *
 */

// Package cronexpr parses cron time expressions.
package cronexpr

/******************************************************************************/

import (
	"fmt"
	"sort"
	"time"
)

/******************************************************************************/

// A Expression represents a specific cron time expression as defined at
// <https://github.com/gorhill/cronexpr#implementation>
type Expression struct {
	expression             string
	secondList             []int
	minuteList             []int
	hourList               []int
	daysOfMonth            map[int]bool
	workdaysOfMonth        map[int]bool
	lastDayOfMonth         bool
	lastWorkdayOfMonth     bool
	daysOfMonthRestricted  bool
	actualDaysOfMonthList  []int
	monthList              []int
	daysOfWeek             map[int]bool
	specificWeekDaysOfWeek map[int]bool
	lastWeekDaysOfWeek     map[int]bool
	daysOfWeekRestricted   bool
	yearList               []int
}

/******************************************************************************/

// MustParse returns a new Expression pointer. It expects a well-formed cron
// expression. If a malformed cron expression is supplied, it will `panic`.
// See <https://github.com/gorhill/cronexpr#implementation> for documentation
// about what is a well-formed cron expression from this library's point of
// view.
func MustParse(cronLine string) *Expression {
	expr, err := Parse(cronLine)
	if err != nil {
		panic(err)
	}
	return expr
}

/******************************************************************************/

// Parse returns a new Expression pointer. An error is returned if a malformed
// cron expression is supplied.
// See <https://github.com/gorhill/cronexpr#implementation> for documentation
// about what is a well-formed cron expression from this library's point of
// view.
func Parse(cronLine string) (*Expression, error) {

	// Maybe one of the built-in aliases is being used
	cron := cronNormalizer.Replace(cronLine)

	indices := fieldFinder.FindAllStringIndex(cron, -1)
	fieldCount := len(indices)
	if fieldCount < 5 {
		return nil, fmt.Errorf("missing field(s)")
	}
	// ignore fields beyond 7th
	if fieldCount > 7 {
		fieldCount = 7
	}

	var expr = Expression{}
	var field = 0
	var err error

	// second field (optional)
	if fieldCount == 7 {
		err = expr.secondFieldHandler(cron[indices[field][0]:indices[field][1]])
		if err != nil {
			return nil, err
		}
		field++
	} else {
		expr.secondList = []int{0}
	}

	// minute field
	err = expr.minuteFieldHandler(cron[indices[field][0]:indices[field][1]])
	if err != nil {
		return nil, err
	}
	field++

	// hour field
	err = expr.hourFieldHandler(cron[indices[field][0]:indices[field][1]])
	if err != nil {
		return nil, err
	}
	field++

	// day of month field
	err = expr.domFieldHandler(cron[indices[field][0]:indices[field][1]])
	if err != nil {
		return nil, err
	}
	field++

	// month field
	err = expr.monthFieldHandler(cron[indices[field][0]:indices[field][1]])
	if err != nil {
		return nil, err
	}
	field++

	// day of week field
	err = expr.dowFieldHandler(cron[indices[field][0]:indices[field][1]])
	if err != nil {
		return nil, err
	}
	field++

	// year field
	if field < fieldCount {
		err = expr.yearFieldHandler(cron[indices[field][0]:indices[field][1]])
		if err != nil {
			return nil, err
		}
	} else {
		expr.yearList = yearDescriptor.defaultList
	}

	return &expr, nil
}

/******************************************************************************/

// Next returns the closest time instant immediately following `fromTime` which
// matches the cron expression `expr`.
//
// The `time.Location` of the returned time instant is the same as that of
// `fromTime`.
//
// The zero value of time.Time is returned if no matching time instant exists
// or if a `fromTime` is itself a zero value.
func (expr *Expression) Next(fromTime time.Time) time.Time {
	// Special case
	if fromTime.IsZero() {
		return fromTime
	}

	// Since expr.nextSecond()-expr.nextMonth() expects that the
	// supplied time stamp is a perfect match to the underlying cron
	// expression, and since this function is an entry point where `fromTime`
	// does not necessarily matches the underlying cron expression,
	// we first need to ensure supplied time stamp matches
	// the cron expression. If not, this means the supplied time
	// stamp falls in between matching time stamps, thus we move
	// to closest future matching immediately upon encountering a mismatching
	// time stamp.

	// year
	v := fromTime.Year()
	i := sort.SearchInts(expr.yearList, v)
	if i == len(expr.yearList) {
		return time.Time{}
	}
	if v != expr.yearList[i] {
		return expr.nextYear(fromTime)
	}
	// month
	v = int(fromTime.Month())
	i = sort.SearchInts(expr.monthList, v)
	if i == len(expr.monthList) {
		return expr.nextYear(fromTime)
	}
	if v != expr.monthList[i] {
		return expr.nextMonth(fromTime)
	}

	actualDaysOfMonthList := expr.calculateActualDaysOfMonth(fromTime.Year(), int(fromTime.Month()))
	if len(actualDaysOfMonthList) == 0 {
		return expr.nextMonth(fromTime)
	}

	// day of month
	v = fromTime.Day()
	i = sort.SearchInts(actualDaysOfMonthList, v)
	if i == len(actualDaysOfMonthList) {
		return expr.nextMonth(fromTime)
	}
	if v != actualDaysOfMonthList[i] {
		return expr.nextDayOfMonth(fromTime, actualDaysOfMonthList)
	}
	// hour
	v = fromTime.Hour()
	i = sort.SearchInts(expr.hourList, v)
	if i == len(expr.hourList) {
		return expr.nextDayOfMonth(fromTime, actualDaysOfMonthList)
	}
	if v != expr.hourList[i] {
		return expr.nextHour(fromTime, actualDaysOfMonthList)
	}
	// minute
	v = fromTime.Minute()
	i = sort.SearchInts(expr.minuteList, v)
	if i == len(expr.minuteList) {
		return expr.nextHour(fromTime, actualDaysOfMonthList)
	}
	if v != expr.minuteList[i] {
		return expr.nextMinute(fromTime, actualDaysOfMonthList)
	}
	// second
	v = fromTime.Second()
	i = sort.SearchInts(expr.secondList, v)
	if i == len(expr.secondList) {
		return expr.nextMinute(fromTime, actualDaysOfMonthList)
	}

	// If we reach this point, there is nothing better to do
	// than to move to the next second

	return expr.nextSecond(fromTime, actualDaysOfMonthList)
}

// Last returns the closest time instant immediately before `fromTime` which
// matches the cron expression `expr`.
//
// The `time.Location` of the returned time instant is the same as that of
// `fromTime`.
//
// The zero value of time.Time is returned if no matching time instant exists
// or if a `fromTime` is itself a zero value.
func (expr *Expression) Last(fromTime time.Time) time.Time {
	// Special case
	if fromTime.IsZero() {
		return fromTime
	}

	// year
	v := fromTime.Year()
	i := sort.SearchInts(expr.yearList, v)
	if i == 0 && v != expr.yearList[i] {
		return time.Time{}
	}
	if i == len(expr.yearList) || v != expr.yearList[i] {
		return expr.lastYear(fromTime, false)
	}
	// month
	v = int(fromTime.Month())
	i = sort.SearchInts(expr.monthList, v)
	if i == 0 && v != expr.monthList[i] {
		return expr.lastYear(fromTime, true)
	}
	if i == len(expr.monthList) || v != expr.monthList[i] {
		return expr.lastMonth(fromTime, false)
	}

	expr.actualDaysOfMonthList = expr.calculateActualDaysOfMonth(fromTime.Year(), int(fromTime.Month()))
	if len(expr.actualDaysOfMonthList) == 0 {
		return expr.lastMonth(fromTime, true)
	}

	// day of month
	v = fromTime.Day()
	i = sort.SearchInts(expr.actualDaysOfMonthList, v)
	if i == 0 && v != expr.actualDaysOfMonthList[i] {
		return expr.lastMonth(fromTime, true)
	}
	if i == len(expr.actualDaysOfMonthList) || v != expr.actualDaysOfMonthList[i] {
		return expr.lastActualDayOfMonth(fromTime, false)
	}
	// hour
	v = fromTime.Hour()
	i = sort.SearchInts(expr.hourList, v)
	if i == 0 && v != expr.hourList[i] {
		return expr.lastActualDayOfMonth(fromTime, true)
	}
	if i == len(expr.hourList) || v != expr.hourList[i] {
		return expr.lastHour(fromTime, false)
	}

	// minute
	v = fromTime.Minute()
	i = sort.SearchInts(expr.minuteList, v)
	if i == 0 && v != expr.minuteList[i] {
		return expr.lastHour(fromTime, true)
	}
	if i == len(expr.minuteList) || v != expr.minuteList[i] {
		return expr.lastMinute(fromTime, false)
	}
	// second
	v = fromTime.Second()
	i = sort.SearchInts(expr.secondList, v)
	if i == len(expr.secondList) {
		return expr.lastMinute(fromTime, true)
	}

	// If we reach this point, there is nothing better to do
	// than to move to the next second

	return expr.lastSecond(fromTime)
}

/******************************************************************************/

/******************************************************************************/

// NextN returns a slice of `n` closest time instants immediately following
// `fromTime` which match the cron expression `expr`.
//
// The time instants in the returned slice are in chronological ascending order.
// The `time.Location` of the returned time instants is the same as that of
// `fromTime`.
//
// A slice with len between [0-`n`] is returned, that is, if not enough existing
// matching time instants exist, the number of returned entries will be less
// than `n`.
func (expr *Expression) NextN(fromTime time.Time, n uint) []time.Time {
	nextTimes := make([]time.Time, 0, n)
	if n > 0 {
		fromTime = expr.Next(fromTime)
		for {
			if fromTime.IsZero() {
				break
			}
			nextTimes = append(nextTimes, fromTime)
			n -= 1
			if n == 0 {
				break
			}
			actualDaysOfMonthList := expr.calculateActualDaysOfMonth(fromTime.Year(), int(fromTime.Month()))
			fromTime = expr.nextSecond(fromTime, actualDaysOfMonthList)
		}
	}
	return nextTimes
}
