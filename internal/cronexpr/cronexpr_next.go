/*!
 * Copyright 2013 Raymond Hill
 *
 * Project: github.com/gorhill/cronexpr
 * File: cronexpr_next.go
 * Version: 1.0
 * License: pick the one which suits you :
 *   GPL v3 see <https://www.gnu.org/licenses/gpl.html>
 *   APL v2 see <http://www.apache.org/licenses/LICENSE-2.0>
 *
 */

package cronexpr

/******************************************************************************/

import (
	"sort"
	"time"
)

/******************************************************************************/

var dowNormalizedOffsets = [][]int{
	{1, 8, 15, 22, 29},
	{2, 9, 16, 23, 30},
	{3, 10, 17, 24, 31},
	{4, 11, 18, 25},
	{5, 12, 19, 26},
	{6, 13, 20, 27},
	{7, 14, 21, 28},
}

/******************************************************************************/

func (expr *Expression) nextYear(t time.Time) time.Time {
	// Find index at which item in list is greater or equal to
	// candidate year
	i := sort.SearchInts(expr.yearList, t.Year()+1)
	if i == len(expr.yearList) {
		return time.Time{}
	}
	// Year changed, need to recalculate actual days of month
	expr.actualDaysOfMonthList = expr.calculateActualDaysOfMonth(expr.yearList[i], expr.monthList[0])
	if len(expr.actualDaysOfMonthList) == 0 {
		return expr.nextMonth(time.Date(
			expr.yearList[i],
			time.Month(expr.monthList[0]),
			1,
			expr.hourList[0],
			expr.minuteList[0],
			expr.secondList[0],
			0,
			t.Location()))
	}
	return time.Date(
		expr.yearList[i],
		time.Month(expr.monthList[0]),
		expr.actualDaysOfMonthList[0],
		expr.hourList[0],
		expr.minuteList[0],
		expr.secondList[0],
		0,
		t.Location())
}

func (expr *Expression) lastYear(t time.Time, acc bool) time.Time {
	// candidate year
	v := t.Year()
	if acc {
		v--
	}
	i := sort.SearchInts(expr.yearList, v)
	var year int
	if i < len(expr.yearList) && v == expr.yearList[i] {
		year = expr.yearList[i]
	} else if i == 0 {
		return time.Time{}
	} else {
		year = expr.yearList[i-1]
	}
	// Year changed, need to recalculate actual days of month
	expr.actualDaysOfMonthList = expr.calculateActualDaysOfMonth(
		year,
		expr.monthList[len(expr.monthList)-1])

	if len(expr.actualDaysOfMonthList) == 0 {
		return expr.lastMonth(time.Date(
			year,
			time.Month(expr.monthList[len(expr.monthList)-1]),
			1,
			expr.hourList[len(expr.hourList)-1],
			expr.minuteList[len(expr.minuteList)-1],
			expr.secondList[len(expr.secondList)-1],
			0,
			t.Location()), true)
	}
	return time.Date(
		year,
		time.Month(expr.monthList[len(expr.monthList)-1]),
		expr.actualDaysOfMonthList[len(expr.actualDaysOfMonthList)-1],
		expr.hourList[len(expr.hourList)-1],
		expr.minuteList[len(expr.minuteList)-1],
		expr.secondList[len(expr.secondList)-1],
		0,
		t.Location())
}

/******************************************************************************/
/******************************************************************************/

func (expr *Expression) nextMonth(t time.Time) time.Time {
	// Find index at which item in list is greater or equal to
	// candidate month
	i := sort.SearchInts(expr.monthList, int(t.Month())+1)
	if i == len(expr.monthList) {
		return expr.nextYear(t)
	}
	// Month changed, need to recalculate actual days of month
	actualDaysOfMonthList := expr.calculateActualDaysOfMonth(t.Year(), expr.monthList[i])
	if len(actualDaysOfMonthList) == 0 {
		return expr.nextMonth(time.Date(
			t.Year(),
			time.Month(expr.monthList[i]),
			1,
			expr.hourList[0],
			expr.minuteList[0],
			expr.secondList[0],
			0,
			t.Location()))
	}

	return time.Date(
		t.Year(),
		time.Month(expr.monthList[i]),
		actualDaysOfMonthList[0],
		expr.hourList[0],
		expr.minuteList[0],
		expr.secondList[0],
		0,
		t.Location())
}

func (expr *Expression) lastMonth(t time.Time, acc bool) time.Time {
	// candidate month
	v := int(t.Month())
	if acc {
		v--
	}
	i := sort.SearchInts(expr.monthList, v)

	var month int
	if i < len(expr.monthList) && v == expr.monthList[i] {
		month = expr.monthList[i]
	} else if i == 0 {
		return expr.lastYear(t, true)
	} else {
		month = expr.monthList[i-1]
	}

	// Month changed, need to recalculate actual days of month
	expr.actualDaysOfMonthList = expr.calculateActualDaysOfMonth(t.Year(), month)
	if len(expr.actualDaysOfMonthList) == 0 {
		return expr.lastMonth(time.Date(
			t.Year(),
			time.Month(month),
			1,
			expr.hourList[len(expr.hourList)-1],
			expr.minuteList[len(expr.minuteList)-1],
			expr.secondList[len(expr.secondList)-1],
			0,
			t.Location()), true)
	}

	return time.Date(
		t.Year(),
		time.Month(month),
		expr.actualDaysOfMonthList[len(expr.actualDaysOfMonthList)-1],
		expr.hourList[len(expr.hourList)-1],
		expr.minuteList[len(expr.minuteList)-1],
		expr.secondList[len(expr.secondList)-1],
		0,
		t.Location())
}

/******************************************************************************/

func (expr *Expression) nextDayOfMonth(t time.Time, actualDaysOfMonthList []int) time.Time {
	// Find index at which item in list is greater or equal to
	// candidate day of month
	i := sort.SearchInts(actualDaysOfMonthList, t.Day()+1)
	if i == len(actualDaysOfMonthList) {
		return expr.nextMonth(t)
	}

	return time.Date(
		t.Year(),
		t.Month(),
		actualDaysOfMonthList[i],
		expr.hourList[0],
		expr.minuteList[0],
		expr.secondList[0],
		0,
		t.Location())
}

func (expr *Expression) lastActualDayOfMonth(t time.Time, acc bool) time.Time {
	// candidate day of month
	v := t.Day()
	if acc {
		v--
	}
	i := sort.SearchInts(expr.actualDaysOfMonthList, v)

	var day int
	if i < len(expr.actualDaysOfMonthList) && v == expr.actualDaysOfMonthList[i] {
		day = expr.actualDaysOfMonthList[i]
	} else if i == 0 {
		return expr.lastMonth(t, true)
	} else {
		day = expr.actualDaysOfMonthList[i-1]
	}

	return time.Date(
		t.Year(),
		t.Month(),
		day,
		expr.hourList[len(expr.hourList)-1],
		expr.minuteList[len(expr.minuteList)-1],
		expr.secondList[len(expr.secondList)-1],
		0,
		t.Location())
}

/******************************************************************************/

func (expr *Expression) nextHour(t time.Time, actualDaysOfMonthList []int) time.Time {
	// Find index at which item in list is greater or equal to
	// candidate hour
	i := sort.SearchInts(expr.hourList, t.Hour()+1)
	if i == len(expr.hourList) {
		return expr.nextDayOfMonth(t, actualDaysOfMonthList)
	}

	return time.Date(
		t.Year(),
		t.Month(),
		t.Day(),
		expr.hourList[i],
		expr.minuteList[0],
		expr.secondList[0],
		0,
		t.Location())
}

/******************************************************************************/

func (expr *Expression) lastHour(t time.Time, acc bool) time.Time {
	// candidate hour
	v := t.Hour()
	if acc {
		v--
	}
	i := sort.SearchInts(expr.hourList, v)

	var hour int
	if i < len(expr.hourList) && v == expr.hourList[i] {
		hour = expr.hourList[i]
	} else if i == 0 {
		return expr.lastActualDayOfMonth(t, true)
	} else {
		hour = expr.hourList[i-1]
	}

	return time.Date(
		t.Year(),
		t.Month(),
		t.Day(),
		hour,
		expr.minuteList[len(expr.minuteList)-1],
		expr.secondList[len(expr.secondList)-1],
		0,
		t.Location())
}

/******************************************************************************/

/******************************************************************************/

func (expr *Expression) nextMinute(t time.Time, actualDaysOfMonthList []int) time.Time {
	// Find index at which item in list is greater or equal to
	// candidate minute
	i := sort.SearchInts(expr.minuteList, t.Minute()+1)
	if i == len(expr.minuteList) {
		return expr.nextHour(t, actualDaysOfMonthList)
	}

	return time.Date(
		t.Year(),
		t.Month(),
		t.Day(),
		t.Hour(),
		expr.minuteList[i],
		expr.secondList[0],
		0,
		t.Location())
}

/******************************************************************************/

func (expr *Expression) lastMinute(t time.Time, acc bool) time.Time {
	// candidate minute
	v := t.Minute()
	if !acc {
		v--
	}
	i := sort.SearchInts(expr.minuteList, v)
	var min int
	if i < len(expr.minuteList) && v == expr.minuteList[i] {
		min = expr.minuteList[i]
	} else if i == 0 {
		return expr.lastHour(t, true)
	} else {
		min = expr.minuteList[i-1]
	}

	return time.Date(
		t.Year(),
		t.Month(),
		t.Day(),
		t.Hour(),
		min,
		expr.secondList[len(expr.secondList)-1],
		0,
		t.Location())
}

/******************************************************************************/

func (expr *Expression) nextSecond(t time.Time, actualDaysOfMonthList []int) time.Time {
	// nextSecond() assumes all other fields are exactly matched
	// to the cron expression

	// Find index at which item in list is greater or equal to
	// candidate second
	i := sort.SearchInts(expr.secondList, t.Second()+1)
	if i == len(expr.secondList) {
		return expr.nextMinute(t, actualDaysOfMonthList)
	}

	return time.Date(
		t.Year(),
		t.Month(),
		t.Day(),
		t.Hour(),
		t.Minute(),
		expr.secondList[i],
		0,
		t.Location())
}

/******************************************************************************/
// lastSecond() assumes all other fields are exactly matched
// to the cron expression
func (expr *Expression) lastSecond(t time.Time) time.Time {
	// candidate second
	v := t.Second() - 1
	i := sort.SearchInts(expr.secondList, v)
	if i == len(expr.secondList) || expr.secondList[i] != v {
		return expr.lastMinute(t, false)
	}

	return time.Date(
		t.Year(),
		t.Month(),
		t.Day(),
		t.Hour(),
		t.Minute(),
		expr.secondList[i],
		0,
		t.Location())
}

/******************************************************************************/

func (expr *Expression) calculateActualDaysOfMonth(year, month int) []int {
	actualDaysOfMonthMap := make(map[int]bool)
	firstDayOfMonth := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	lastDayOfMonth := firstDayOfMonth.AddDate(0, 1, -1)

	// As per crontab man page (http://linux.die.net/man/5/crontab#):
	//  "The day of a command's execution can be specified by two
	//  "fields - day of month, and day of week. If both fields are
	//  "restricted (ie, aren't *), the command will be run when
	//  "either field matches the current time"

	// If both fields are not restricted, all days of the month are a hit
	if expr.daysOfMonthRestricted == false && expr.daysOfWeekRestricted == false {
		return genericDefaultList[1 : lastDayOfMonth.Day()+1]
	}

	// day-of-month != `*`
	if expr.daysOfMonthRestricted {
		// Last day of month
		if expr.lastDayOfMonth {
			actualDaysOfMonthMap[lastDayOfMonth.Day()] = true
		}
		// Last work day of month
		if expr.lastWorkdayOfMonth {
			actualDaysOfMonthMap[workdayOfMonth(lastDayOfMonth, lastDayOfMonth)] = true
		}
		// Days of month
		for v := range expr.daysOfMonth {
			// Ignore days beyond end of month
			if v <= lastDayOfMonth.Day() {
				actualDaysOfMonthMap[v] = true
			}
		}
		// Work days of month
		// As per Wikipedia: month boundaries are not crossed.
		for v := range expr.workdaysOfMonth {
			// Ignore days beyond end of month
			if v <= lastDayOfMonth.Day() {
				actualDaysOfMonthMap[workdayOfMonth(firstDayOfMonth.AddDate(0, 0, v-1), lastDayOfMonth)] = true
			}
		}
	}

	// day-of-week != `*`
	if expr.daysOfWeekRestricted {
		// How far first sunday is from first day of month
		offset := 7 - int(firstDayOfMonth.Weekday())
		// days of week
		//  offset : (7 - day_of_week_of_1st_day_of_month)
		//  target : 1 + (7 * week_of_month) + (offset + day_of_week) % 7
		for v := range expr.daysOfWeek {
			w := dowNormalizedOffsets[(offset+v)%7]
			actualDaysOfMonthMap[w[0]] = true
			actualDaysOfMonthMap[w[1]] = true
			actualDaysOfMonthMap[w[2]] = true
			actualDaysOfMonthMap[w[3]] = true
			if len(w) > 4 && w[4] <= lastDayOfMonth.Day() {
				actualDaysOfMonthMap[w[4]] = true
			}
		}
		// days of week of specific week in the month
		//  offset : (7 - day_of_week_of_1st_day_of_month)
		//  target : 1 + (7 * week_of_month) + (offset + day_of_week) % 7
		for v := range expr.specificWeekDaysOfWeek {
			v = 1 + 7*(v/7) + (offset+v)%7
			if v <= lastDayOfMonth.Day() {
				actualDaysOfMonthMap[v] = true
			}
		}
		// Last days of week of the month
		lastWeekOrigin := firstDayOfMonth.AddDate(0, 1, -7)
		offset = 7 - int(lastWeekOrigin.Weekday())
		for v := range expr.lastWeekDaysOfWeek {
			v = lastWeekOrigin.Day() + (offset+v)%7
			if v <= lastDayOfMonth.Day() {
				actualDaysOfMonthMap[v] = true
			}
		}
	}

	return toList(actualDaysOfMonthMap)
}

func workdayOfMonth(targetDom, lastDom time.Time) int {
	// If saturday, then friday
	// If sunday, then monday
	dom := targetDom.Day()
	dow := targetDom.Weekday()
	if dow == time.Saturday {
		if dom > 1 {
			dom--
		} else {
			dom += 2
		}
	} else if dow == time.Sunday {
		if dom < lastDom.Day() {
			dom++
		} else {
			dom -= 2
		}
	}
	return dom
}
