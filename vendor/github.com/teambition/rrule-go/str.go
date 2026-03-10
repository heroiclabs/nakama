// 2017-2022, Teambition. All rights reserved.

package rrule

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	// DateTimeFormat is date-time format used in iCalendar (RFC 5545)
	DateTimeFormat = "20060102T150405Z"
	// LocalDateTimeFormat is a date-time format without Z prefix
	LocalDateTimeFormat = "20060102T150405"
	// DateFormat is date format used in iCalendar (RFC 5545)
	DateFormat = "20060102"
)

func timeToStr(time time.Time) string {
	return time.UTC().Format(DateTimeFormat)
}

func strToTimeInLoc(str string, loc *time.Location) (time.Time, error) {
	if len(str) == len(DateFormat) {
		return time.ParseInLocation(DateFormat, str, loc)
	}
	if len(str) == len(LocalDateTimeFormat) {
		return time.ParseInLocation(LocalDateTimeFormat, str, loc)
	}
	// date-time format carries zone info
	return time.Parse(DateTimeFormat, str)
}

func (f Frequency) String() string {
	return [...]string{
		"YEARLY", "MONTHLY", "WEEKLY", "DAILY",
		"HOURLY", "MINUTELY", "SECONDLY"}[f]
}

func StrToFreq(str string) (Frequency, error) {
	freqMap := map[string]Frequency{
		"YEARLY": YEARLY, "MONTHLY": MONTHLY, "WEEKLY": WEEKLY, "DAILY": DAILY,
		"HOURLY": HOURLY, "MINUTELY": MINUTELY, "SECONDLY": SECONDLY,
	}
	result, ok := freqMap[str]
	if !ok {
		return 0, errors.New("undefined frequency: " + str)
	}
	return result, nil
}

func (wday Weekday) String() string {
	s := [...]string{"MO", "TU", "WE", "TH", "FR", "SA", "SU"}[wday.weekday]
	if wday.n == 0 {
		return s
	}
	return fmt.Sprintf("%+d%s", wday.n, s)
}

func strToWeekday(str string) (Weekday, error) {
	if len(str) < 2 {
		return Weekday{}, errors.New("undefined weekday: " + str)
	}
	weekMap := map[string]Weekday{
		"MO": MO, "TU": TU, "WE": WE, "TH": TH,
		"FR": FR, "SA": SA, "SU": SU}
	result, ok := weekMap[str[len(str)-2:]]
	if !ok {
		return Weekday{}, errors.New("undefined weekday: " + str)
	}
	if len(str) > 2 {
		n, e := strconv.Atoi(str[:len(str)-2])
		if e != nil {
			return Weekday{}, e
		}
		result.n = n
	}
	return result, nil
}

func strToWeekdays(value string) ([]Weekday, error) {
	contents := strings.Split(value, ",")
	result := make([]Weekday, len(contents))
	var e error
	for i, s := range contents {
		result[i], e = strToWeekday(s)
		if e != nil {
			return nil, e
		}
	}
	return result, nil
}

func appendIntsOption(options []string, key string, value []int) []string {
	if len(value) == 0 {
		return options
	}
	valueStr := make([]string, len(value))
	for i, v := range value {
		valueStr[i] = strconv.Itoa(v)
	}
	return append(options, fmt.Sprintf("%s=%s", key, strings.Join(valueStr, ",")))
}

func strToInts(value string) ([]int, error) {
	contents := strings.Split(value, ",")
	result := make([]int, len(contents))
	var e error
	for i, s := range contents {
		result[i], e = strconv.Atoi(s)
		if e != nil {
			return nil, e
		}
	}
	return result, nil
}

// String returns RRULE string with DTSTART if exists. e.g.
//
//	DTSTART;TZID=America/New_York:19970105T083000
//	RRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=1;BYDAY=SU;BYHOUR=8,9;BYMINUTE=30
func (option *ROption) String() string {
	str := option.RRuleString()
	if option.Dtstart.IsZero() {
		return str
	}

	return fmt.Sprintf("DTSTART%s\nRRULE:%s", timeToRFCDatetimeStr(option.Dtstart), str)
}

// RRuleString returns RRULE string exclude DTSTART
func (option *ROption) RRuleString() string {
	result := []string{fmt.Sprintf("FREQ=%v", option.Freq)}
	if option.Interval != 0 {
		result = append(result, fmt.Sprintf("INTERVAL=%v", option.Interval))
	}
	if option.Wkst != MO {
		result = append(result, fmt.Sprintf("WKST=%v", option.Wkst))
	}
	if option.Count != 0 {
		result = append(result, fmt.Sprintf("COUNT=%v", option.Count))
	}
	if !option.Until.IsZero() {
		result = append(result, fmt.Sprintf("UNTIL=%v", timeToStr(option.Until)))
	}
	result = appendIntsOption(result, "BYSETPOS", option.Bysetpos)
	result = appendIntsOption(result, "BYMONTH", option.Bymonth)
	result = appendIntsOption(result, "BYMONTHDAY", option.Bymonthday)
	result = appendIntsOption(result, "BYYEARDAY", option.Byyearday)
	result = appendIntsOption(result, "BYWEEKNO", option.Byweekno)
	if len(option.Byweekday) != 0 {
		valueStr := make([]string, len(option.Byweekday))
		for i, wday := range option.Byweekday {
			valueStr[i] = wday.String()
		}
		result = append(result, fmt.Sprintf("BYDAY=%s", strings.Join(valueStr, ",")))
	}
	result = appendIntsOption(result, "BYHOUR", option.Byhour)
	result = appendIntsOption(result, "BYMINUTE", option.Byminute)
	result = appendIntsOption(result, "BYSECOND", option.Bysecond)
	result = appendIntsOption(result, "BYEASTER", option.Byeaster)
	return strings.Join(result, ";")
}

// StrToROption converts string to ROption.
func StrToROption(rfcString string) (*ROption, error) {
	return StrToROptionInLocation(rfcString, time.UTC)
}

// StrToROptionInLocation is same as StrToROption but in case local
// time is supplied as date-time/date field (ex. UNTIL), it is parsed
// as a time in a given location (time zone)
func StrToROptionInLocation(rfcString string, loc *time.Location) (*ROption, error) {
	rfcString = strings.TrimSpace(rfcString)
	strs := strings.Split(rfcString, "\n")
	var rruleStr, dtstartStr string
	switch len(strs) {
	case 1:
		rruleStr = strs[0]
	case 2:
		dtstartStr = strs[0]
		rruleStr = strs[1]
	default:
		return nil, errors.New("invalid RRULE string")
	}

	result := ROption{}
	freqSet := false

	if dtstartStr != "" {
		firstName, err := processRRuleName(dtstartStr)
		if err != nil {
			return nil, fmt.Errorf("expect DTSTART but: %s", err)
		}
		if firstName != "DTSTART" {
			return nil, fmt.Errorf("expect DTSTART but: %s", firstName)
		}

		result.Dtstart, err = StrToDtStart(dtstartStr[len(firstName)+1:], loc)
		if err != nil {
			return nil, fmt.Errorf("StrToDtStart failed: %s", err)
		}
	}

	rruleStr = strings.TrimPrefix(rruleStr, "RRULE:")
	for _, attr := range strings.Split(rruleStr, ";") {
		keyValue := strings.Split(attr, "=")
		if len(keyValue) != 2 {
			return nil, errors.New("wrong format")
		}
		key, value := keyValue[0], keyValue[1]
		if len(value) == 0 {
			return nil, errors.New(key + " option has no value")
		}
		var e error
		switch key {
		case "FREQ":
			result.Freq, e = StrToFreq(value)
			freqSet = true
		case "DTSTART":
			result.Dtstart, e = strToTimeInLoc(value, loc)
		case "INTERVAL":
			result.Interval, e = strconv.Atoi(value)
		case "WKST":
			result.Wkst, e = strToWeekday(value)
		case "COUNT":
			result.Count, e = strconv.Atoi(value)
		case "UNTIL":
			result.Until, e = strToTimeInLoc(value, loc)
		case "BYSETPOS":
			result.Bysetpos, e = strToInts(value)
		case "BYMONTH":
			result.Bymonth, e = strToInts(value)
		case "BYMONTHDAY":
			result.Bymonthday, e = strToInts(value)
		case "BYYEARDAY":
			result.Byyearday, e = strToInts(value)
		case "BYWEEKNO":
			result.Byweekno, e = strToInts(value)
		case "BYDAY":
			result.Byweekday, e = strToWeekdays(value)
		case "BYHOUR":
			result.Byhour, e = strToInts(value)
		case "BYMINUTE":
			result.Byminute, e = strToInts(value)
		case "BYSECOND":
			result.Bysecond, e = strToInts(value)
		case "BYEASTER":
			result.Byeaster, e = strToInts(value)
		default:
			return nil, errors.New("unknown RRULE property: " + key)
		}
		if e != nil {
			return nil, e
		}
	}
	if !freqSet {
		// Per RFC 5545, FREQ is mandatory and supposed to be the first
		// parameter. We'll just confirm it exists because we do not
		// have a meaningful default nor a way to confirm if we parsed
		// a value from the options this returns.
		return nil, errors.New("RRULE property FREQ is required")
	}
	return &result, nil
}

func (r *RRule) String() string {
	return r.OrigOptions.String()
}

func (set *Set) String() string {
	res := set.Recurrence()
	return strings.Join(res, "\n")
}

// StrToRRule converts string to RRule
func StrToRRule(rfcString string) (*RRule, error) {
	option, e := StrToROption(rfcString)
	if e != nil {
		return nil, e
	}
	return NewRRule(*option)
}

// StrToRRuleSet converts string to RRuleSet
func StrToRRuleSet(s string) (*Set, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, errors.New("empty string")
	}
	ss := strings.Split(s, "\n")
	return StrSliceToRRuleSet(ss)
}

// StrSliceToRRuleSet converts given str slice to RRuleSet
// In case there is a time met in any rule without specified time zone, when
// it is parsed in UTC (see StrSliceToRRuleSetInLoc)
func StrSliceToRRuleSet(ss []string) (*Set, error) {
	return StrSliceToRRuleSetInLoc(ss, time.UTC)
}

// StrSliceToRRuleSetInLoc is same as StrSliceToRRuleSet, but by default parses local times
// in specified default location
func StrSliceToRRuleSetInLoc(ss []string, defaultLoc *time.Location) (*Set, error) {
	if len(ss) == 0 {
		return &Set{}, nil
	}

	set := Set{}

	// According to RFC DTSTART is always the first line.
	firstName, err := processRRuleName(ss[0])
	if err != nil {
		return nil, err
	}
	if firstName == "DTSTART" {
		dt, err := StrToDtStart(ss[0][len(firstName)+1:], defaultLoc)
		if err != nil {
			return nil, fmt.Errorf("StrToDtStart failed: %v", err)
		}
		// default location should be taken from DTSTART property to correctly
		// parse local times met in RDATE,EXDATE and other rules
		defaultLoc = dt.Location()
		set.DTStart(dt)
		// We've processed the first one
		ss = ss[1:]
	}

	for _, line := range ss {
		name, err := processRRuleName(line)
		if err != nil {
			return nil, err
		}
		rule := line[len(name)+1:]

		switch name {
		case "RRULE":
			rOpt, err := StrToROptionInLocation(rule, defaultLoc)
			if err != nil {
				return nil, fmt.Errorf("StrToROption failed: %v", err)
			}
			r, err := NewRRule(*rOpt)
			if err != nil {
				return nil, fmt.Errorf("NewRRule failed: %v", r)
			}

			set.RRule(r)
		case "RDATE", "EXDATE":
			ts, err := StrToDatesInLoc(rule, defaultLoc)
			if err != nil {
				return nil, fmt.Errorf("strToDates failed: %v", err)
			}
			for _, t := range ts {
				if name == "RDATE" {
					set.RDate(t)
				} else {
					set.ExDate(t)
				}
			}
		}
	}

	return &set, nil
}

// https://tools.ietf.org/html/rfc5545#section-3.3.5
// DTSTART:19970714T133000                       ; Local time
// DTSTART:19970714T173000Z                      ; UTC time
// DTSTART;TZID=America/New_York:19970714T133000 ; Local time and time zone reference
func timeToRFCDatetimeStr(time time.Time) string {
	if time.Location().String() != "UTC" {
		return fmt.Sprintf(";TZID=%s:%s", time.Location().String(), time.Format(LocalDateTimeFormat))
	}
	return fmt.Sprintf(":%s", time.Format(DateTimeFormat))
}

// StrToDates is intended to parse RDATE and EXDATE properties supporting only
// VALUE=DATE-TIME (DATE and PERIOD are not supported).
// Accepts string with format: "VALUE=DATE-TIME;[TZID=...]:{time},{time},...,{time}"
// or simply "{time},{time},...{time}" and parses it to array of dates
// In case no time zone specified in str, when all dates are parsed in UTC
func StrToDates(str string) (ts []time.Time, err error) {
	return StrToDatesInLoc(str, time.UTC)
}

// StrToDatesInLoc same as StrToDates but it consideres default location to parse dates in
// in case no location specified with TZID parameter
func StrToDatesInLoc(str string, defaultLoc *time.Location) (ts []time.Time, err error) {
	tmp := strings.Split(str, ":")
	if len(tmp) > 2 {
		return nil, fmt.Errorf("bad format")
	}
	loc := defaultLoc
	if len(tmp) == 2 {
		params := strings.Split(tmp[0], ";")
		for _, param := range params {
			if strings.HasPrefix(param, "TZID=") {
				loc, err = parseTZID(param)
			} else if param != "VALUE=DATE-TIME" && param != "VALUE=DATE" {
				err = fmt.Errorf("unsupported: %v", param)
			}
			if err != nil {
				return nil, fmt.Errorf("bad dates param: %s", err.Error())
			}
		}
		tmp = tmp[1:]
	}
	for _, datestr := range strings.Split(tmp[0], ",") {
		t, err := strToTimeInLoc(datestr, loc)
		if err != nil {
			return nil, fmt.Errorf("strToTime failed: %v", err)
		}
		ts = append(ts, t)
	}
	return
}

// processRRuleName processes the name of an RRule off a multi-line RRule set
func processRRuleName(line string) (string, error) {
	line = strings.ToUpper(strings.TrimSpace(line))
	if line == "" {
		return "", fmt.Errorf("bad format %v", line)
	}

	nameLen := strings.IndexAny(line, ";:")
	if nameLen <= 0 {
		return "", fmt.Errorf("bad format %v", line)
	}

	name := line[:nameLen]
	if strings.IndexAny(name, "=") > 0 {
		return "", fmt.Errorf("bad format %v", line)
	}

	return name, nil
}

// StrToDtStart accepts string with format: "(TZID={timezone}:)?{time}" and parses it to a date
// may be used to parse DTSTART rules, without the DTSTART; part.
func StrToDtStart(str string, defaultLoc *time.Location) (time.Time, error) {
	tmp := strings.Split(str, ":")
	if len(tmp) > 2 || len(tmp) == 0 {
		return time.Time{}, fmt.Errorf("bad format")
	}

	if len(tmp) == 2 {
		// tzid
		loc, err := parseTZID(tmp[0])
		if err != nil {
			return time.Time{}, err
		}
		return strToTimeInLoc(tmp[1], loc)
	}
	// no tzid, len == 1
	return strToTimeInLoc(tmp[0], defaultLoc)
}

func parseTZID(s string) (*time.Location, error) {
	if !strings.HasPrefix(s, "TZID=") || len(s) == len("TZID=") {
		return nil, fmt.Errorf("bad TZID parameter format")
	}
	return time.LoadLocation(s[len("TZID="):])
}
