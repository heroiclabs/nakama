package recurrence

import "time"

type Recurrence interface {

	// Next returns the closest time instant immediately following `fromTime` which
	// matches the cron expression `expr`.
	//
	// The `time.Location` of the returned time instant is the same as that of
	// `fromTime`.
	//
	// The zero value of time.Time is returned if no matching time instant exists
	// or if a `fromTime` is itself a zero value.
	Next(fromTime time.Time) time.Time

	// Last returns the closest time instant immediately before `fromTime` which
	// matches the cron expression `expr`.
	//
	// The `time.Location` of the returned time instant is the same as that of
	// `fromTime`.
	//
	// The zero value of time.Time is returned if no matching time instant exists
	// or if a `fromTime` is itself a zero value.
	Last(fromTime time.Time) time.Time

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
	NextN(fromTime time.Time, n uint) []time.Time
}

type ScheduleParser interface {

	// Parse returns a new Recurrence pointer. An error is returned if a malformed
	// expression is supplied.
	Parse(expr string) (*Recurrence, error)

	// MustParse returns a new Recurrence pointer. It expects a well-formed
	// expression. If a malformed expression is supplied, it will `panic`.
	MustParse(expr string) *Recurrence
}
