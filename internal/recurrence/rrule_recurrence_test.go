package recurrence

import (
	"testing"
	"time"
)

func mustParseRRuleRecurrence(t *testing.T, expr string) Recurrence {
	t.Helper()

	parser := &rRuleRecurrenceParser{}
	schedule, err := parser.Parse(expr)
	if err != nil {
		t.Fatalf("Parse(%q) returned error: %v", expr, err)
	}
	if schedule == nil {
		t.Fatalf("Parse(%q) returned nil schedule", expr)
	}

	return *schedule
}

func assertTimesEqual(t *testing.T, got, want []time.Time) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("len(got)=%d len(want)=%d\n got=%v\nwant=%v", len(got), len(want), got, want)
	}
	for i := range want {
		if !got[i].Equal(want[i]) {
			t.Fatalf("times differ at index %d\n got=%v\nwant=%v", i, got[i], want[i])
		}
	}
}

func assertTimeEqual(t *testing.T, got, want time.Time) {
	t.Helper()

	if want.IsZero() {
		if !got.IsZero() {
			t.Fatalf("got=%v want zero time", got)
		}
		return
	}

	if !got.Equal(want) {
		t.Fatalf("got=%v want=%v", got, want)
	}
}

func TestRRuleRecurrenceParserParse(t *testing.T) {
	parser := &rRuleRecurrenceParser{}

	schedule, err := parser.Parse("FREQ=DAILY;COUNT=3;DTSTART=20240101T090000Z")
	if err != nil {
		t.Fatalf("Parse(valid) returned error: %v", err)
	}
	if schedule == nil {
		t.Fatal("Parse(valid) returned nil schedule")
	}

	from := time.Date(2024, 1, 1, 8, 0, 0, 0, time.UTC)
	next := (*schedule).Next(from)
	want := time.Date(2024, 1, 1, 9, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("Next(%v)=%v want=%v", from, next, want)
	}

	if _, err = parser.Parse("FREQ=NOT_A_REAL_FREQ;COUNT=3;DTSTART=20240101T090000Z"); err == nil {
		t.Fatal("Parse(invalid) returned nil error")
	}
}

func TestRRuleRecurrenceParserMustParse(t *testing.T) {
	parser := &rRuleRecurrenceParser{}

	if parser.MustParse("FREQ=DAILY;COUNT=1;DTSTART=20240101T090000Z") == nil {
		t.Fatal("MustParse(valid) returned nil schedule")
	}

	defer func() {
		if recover() == nil {
			t.Fatal("MustParse(invalid) did not panic")
		}
	}()
	parser.MustParse("FREQ=NOPE;COUNT=1;DTSTART=20240101T090000Z")
}

func TestRRuleRecurrenceParserParse_WithoutDTSTART(t *testing.T) {
	parser := &rRuleRecurrenceParser{}

	schedule, err := parser.Parse("FREQ=DAILY;COUNT=2")
	if err != nil {
		t.Fatalf("Parse(without DTSTART) returned error: %v", err)
	}
	if schedule == nil {
		t.Fatal("Parse(without DTSTART) returned nil schedule")
	}

	// rrule-go defaults DTSTART to current UTC time when DTSTART is omitted.
	from := time.Now().UTC().Add(-2 * time.Hour)
	next := (*schedule).Next(from)
	if next.IsZero() {
		t.Fatal("Next() returned zero for rule parsed without DTSTART")
	}
	if !next.After(from) {
		t.Fatalf("Next(%v)=%v, expected strictly after from", from, next)
	}
}

func TestRRuleRecurrenceParserParse_WithoutDTSTART_BoundedCount(t *testing.T) {
	parser := &rRuleRecurrenceParser{}

	schedule, err := parser.Parse("FREQ=DAILY;COUNT=1")
	if err != nil {
		t.Fatalf("Parse(without DTSTART and count=1) returned error: %v", err)
	}
	if schedule == nil {
		t.Fatal("Parse(without DTSTART and count=1) returned nil schedule")
	}

	// With COUNT=1 and implicit DTSTART≈now, querying sufficiently in the future
	// should have no next occurrence.
	from := time.Now().UTC().Add(48 * time.Hour)
	next := (*schedule).Next(from)
	if !next.IsZero() {
		t.Fatalf("Next(%v)=%v, expected zero time", from, next)
	}
}

func TestRRuleRecurrence_NextLast_ZeroFromTime(t *testing.T) {
	r := mustParseRRuleRecurrence(t, "FREQ=DAILY;COUNT=3;DTSTART=20240101T090000Z")

	if got := r.Next(time.Time{}); !got.IsZero() {
		t.Fatalf("Next(zero)=%v want zero", got)
	}
	if got := r.Last(time.Time{}); !got.IsZero() {
		t.Fatalf("Last(zero)=%v want zero", got)
	}

	nextN := r.NextN(time.Time{}, 5)
	if len(nextN) != 0 {
		t.Fatalf("NextN(zero, 5) returned %d entries, want 0", len(nextN))
	}
}

func TestRRuleRecurrence_NextLast_ExclusiveSemantics(t *testing.T) {
	r := mustParseRRuleRecurrence(t, "FREQ=DAILY;COUNT=3;DTSTART=20240101T090000Z")

	from := time.Date(2024, 1, 1, 9, 0, 0, 0, time.UTC)
	next := r.Next(from)
	wantNext := time.Date(2024, 1, 2, 9, 0, 0, 0, time.UTC)
	if !next.Equal(wantNext) {
		t.Fatalf("Next(%v)=%v want=%v", from, next, wantNext)
	}

	last := r.Last(from)
	if !last.IsZero() {
		t.Fatalf("Last(%v)=%v want zero", from, last)
	}

	from = time.Date(2024, 1, 2, 9, 0, 0, 0, time.UTC)
	last = r.Last(from)
	wantLast := time.Date(2024, 1, 1, 9, 0, 0, 0, time.UTC)
	if !last.Equal(wantLast) {
		t.Fatalf("Last(%v)=%v want=%v", from, last, wantLast)
	}
}

func TestRRuleRecurrence_NextN_OrderingAndBounded(t *testing.T) {
	r := mustParseRRuleRecurrence(t, "FREQ=DAILY;COUNT=3;DTSTART=20240101T090000Z")

	from := time.Date(2023, 12, 31, 0, 0, 0, 0, time.UTC)
	got := r.NextN(from, 10)
	want := []time.Time{
		time.Date(2024, 1, 1, 9, 0, 0, 0, time.UTC),
		time.Date(2024, 1, 2, 9, 0, 0, 0, time.UTC),
		time.Date(2024, 1, 3, 9, 0, 0, 0, time.UTC),
	}
	assertTimesEqual(t, got, want)

	if len(r.NextN(from, 0)) != 0 {
		t.Fatal("NextN(from, 0) should return empty slice")
	}

	for i := 1; i < len(got); i++ {
		if !got[i-1].Before(got[i]) {
			t.Fatalf("NextN is not strictly ascending at index %d: %v then %v", i, got[i-1], got[i])
		}
	}
}

func TestRRuleRecurrence_LeapYear_Feb29(t *testing.T) {
	r := mustParseRRuleRecurrence(t, "FREQ=YEARLY;COUNT=4;BYMONTH=2;BYMONTHDAY=29;DTSTART=20160229T090000Z")

	from := time.Date(2015, 1, 1, 0, 0, 0, 0, time.UTC)
	got := r.NextN(from, 4)
	want := []time.Time{
		time.Date(2016, 2, 29, 9, 0, 0, 0, time.UTC),
		time.Date(2020, 2, 29, 9, 0, 0, 0, time.UTC),
		time.Date(2024, 2, 29, 9, 0, 0, 0, time.UTC),
		time.Date(2028, 2, 29, 9, 0, 0, 0, time.UTC),
	}
	assertTimesEqual(t, got, want)

	last := r.Last(time.Date(2023, 3, 1, 0, 0, 0, 0, time.UTC))
	wantLast := time.Date(2020, 2, 29, 9, 0, 0, 0, time.UTC)
	if !last.Equal(wantLast) {
		t.Fatalf("Last(2023-03-01)=%v want=%v", last, wantLast)
	}
}

func TestRRuleRecurrence_MonthEnd_SkipsShortMonths(t *testing.T) {
	r := mustParseRRuleRecurrence(t, "FREQ=MONTHLY;COUNT=6;BYMONTHDAY=31;DTSTART=20240131T103000Z")

	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	got := r.NextN(from, 6)
	want := []time.Time{
		time.Date(2024, 1, 31, 10, 30, 0, 0, time.UTC),
		time.Date(2024, 3, 31, 10, 30, 0, 0, time.UTC),
		time.Date(2024, 5, 31, 10, 30, 0, 0, time.UTC),
		time.Date(2024, 7, 31, 10, 30, 0, 0, time.UTC),
		time.Date(2024, 8, 31, 10, 30, 0, 0, time.UTC),
		time.Date(2024, 10, 31, 10, 30, 0, 0, time.UTC),
	}
	assertTimesEqual(t, got, want)
}

func TestRRuleRecurrence_LocationMatchesFromTime(t *testing.T) {
	la, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Skipf("timezone data not available: %v", err)
	}

	r := mustParseRRuleRecurrence(t, "FREQ=DAILY;COUNT=3;DTSTART=20240101T090000Z")
	from := time.Date(2023, 12, 31, 23, 0, 0, 0, la)

	next := r.Next(from)
	if next.Location() != la {
		t.Fatalf("Next() location=%s want=%s", next.Location(), la)
	}
	want := time.Date(2024, 1, 1, 1, 0, 0, 0, la)
	if !next.Equal(want) {
		t.Fatalf("Next()=%v want=%v", next, want)
	}

	nextN := r.NextN(from, 2)
	if len(nextN) != 2 {
		t.Fatalf("NextN(from,2) returned %d entries, want 2", len(nextN))
	}
	for i, v := range nextN {
		if v.Location() != la {
			t.Fatalf("NextN[%d] location=%s want=%s", i, v.Location(), la)
		}
	}
}

func TestRRuleRecurrence_DSTTransitions(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("timezone data not available: %v", err)
	}

	spring := mustParseRRuleRecurrence(t,
		"DTSTART;TZID=America/New_York:20240309T120000\nRRULE:FREQ=DAILY;COUNT=4",
	)
	springFrom := time.Date(2024, 3, 9, 0, 0, 0, 0, ny)
	springGot := spring.NextN(springFrom, 4)
	springWant := []time.Time{
		time.Date(2024, 3, 9, 12, 0, 0, 0, ny),
		time.Date(2024, 3, 10, 12, 0, 0, 0, ny),
		time.Date(2024, 3, 11, 12, 0, 0, 0, ny),
		time.Date(2024, 3, 12, 12, 0, 0, 0, ny),
	}
	assertTimesEqual(t, springGot, springWant)

	fall := mustParseRRuleRecurrence(t,
		"DTSTART;TZID=America/New_York:20241102T120000\nRRULE:FREQ=DAILY;COUNT=3",
	)
	fallFrom := time.Date(2024, 11, 2, 0, 0, 0, 0, ny)
	fallGot := fall.NextN(fallFrom, 3)
	fallWant := []time.Time{
		time.Date(2024, 11, 2, 12, 0, 0, 0, ny),
		time.Date(2024, 11, 3, 12, 0, 0, 0, ny),
		time.Date(2024, 11, 4, 12, 0, 0, 0, ny),
	}
	assertTimesEqual(t, fallGot, fallWant)
}

func TestRRuleRecurrence_Next_UsageExamples(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("timezone data not available: %v", err)
	}

	tests := []struct {
		name string
		expr string
		from time.Time
		want time.Time
	}{
		{
			name: "daily recurrence from before first occurrence",
			expr: "FREQ=DAILY;COUNT=3;DTSTART=20240101T090000Z",
			from: time.Date(2023, 12, 31, 10, 0, 0, 0, time.UTC),
			want: time.Date(2024, 1, 1, 9, 0, 0, 0, time.UTC),
		},
		{
			name: "next is exclusive when fromTime is an occurrence",
			expr: "FREQ=DAILY;COUNT=3;DTSTART=20240101T090000Z",
			from: time.Date(2024, 1, 1, 9, 0, 0, 0, time.UTC),
			want: time.Date(2024, 1, 2, 9, 0, 0, 0, time.UTC),
		},
		{
			name: "weekly weekdays skips weekend",
			expr: "DTSTART:20240101T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=10",
			from: time.Date(2024, 1, 5, 12, 0, 0, 0, time.UTC), // Friday noon
			want: time.Date(2024, 1, 8, 9, 0, 0, 0, time.UTC),  // Monday
		},
		{
			name: "month day 31 skips february",
			expr: "FREQ=MONTHLY;BYMONTHDAY=31;COUNT=4;DTSTART=20240131T100000Z",
			from: time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC),
			want: time.Date(2024, 3, 31, 10, 0, 0, 0, time.UTC),
		},
		{
			name: "leap day recurrence jumps to next leap year",
			expr: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=3;DTSTART=20160229T090000Z",
			from: time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC),
			want: time.Date(2024, 2, 29, 9, 0, 0, 0, time.UTC),
		},
		{
			name: "no next occurrence returns zero",
			expr: "FREQ=DAILY;COUNT=2;DTSTART=20240101T090000Z",
			from: time.Date(2024, 1, 4, 0, 0, 0, 0, time.UTC),
			want: time.Time{},
		},
		{
			name: "timezone expression across dst start keeps wall clock time",
			expr: "DTSTART;TZID=America/New_York:20240309T120000\nRRULE:FREQ=DAILY;COUNT=3",
			from: time.Date(2024, 3, 9, 12, 30, 0, 0, ny),
			want: time.Date(2024, 3, 10, 12, 0, 0, 0, ny),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := mustParseRRuleRecurrence(t, tc.expr)
			assertTimeEqual(t, r.Next(tc.from), tc.want)
		})
	}
}

func TestRRuleRecurrence_Last_UsageExamples(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("timezone data not available: %v", err)
	}

	tests := []struct {
		name string
		expr string
		from time.Time
		want time.Time
	}{
		{
			name: "daily recurrence from after first occurrence",
			expr: "FREQ=DAILY;COUNT=4;DTSTART=20240101T090000Z",
			from: time.Date(2024, 1, 3, 10, 0, 0, 0, time.UTC),
			want: time.Date(2024, 1, 3, 9, 0, 0, 0, time.UTC),
		},
		{
			name: "last is exclusive when fromTime is an occurrence",
			expr: "FREQ=DAILY;COUNT=4;DTSTART=20240101T090000Z",
			from: time.Date(2024, 1, 3, 9, 0, 0, 0, time.UTC),
			want: time.Date(2024, 1, 2, 9, 0, 0, 0, time.UTC),
		},
		{
			name: "before first occurrence returns zero",
			expr: "FREQ=DAILY;COUNT=4;DTSTART=20240101T090000Z",
			from: time.Date(2023, 12, 31, 23, 59, 0, 0, time.UTC),
			want: time.Time{},
		},
		{
			name: "monthly day 31 before april finds march 31",
			expr: "FREQ=MONTHLY;BYMONTHDAY=31;COUNT=6;DTSTART=20240131T100000Z",
			from: time.Date(2024, 4, 15, 0, 0, 0, 0, time.UTC),
			want: time.Date(2024, 3, 31, 10, 0, 0, 0, time.UTC),
		},
		{
			name: "leap day recurrence before 2025 returns 2024",
			expr: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=4;DTSTART=20160229T090000Z",
			from: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
			want: time.Date(2024, 2, 29, 9, 0, 0, 0, time.UTC),
		},
		{
			name: "timezone expression across dst end keeps wall clock time",
			expr: "DTSTART;TZID=America/New_York:20241102T120000\nRRULE:FREQ=DAILY;COUNT=4",
			from: time.Date(2024, 11, 4, 8, 0, 0, 0, ny),
			want: time.Date(2024, 11, 3, 12, 0, 0, 0, ny),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := mustParseRRuleRecurrence(t, tc.expr)
			assertTimeEqual(t, r.Last(tc.from), tc.want)
		})
	}
}
