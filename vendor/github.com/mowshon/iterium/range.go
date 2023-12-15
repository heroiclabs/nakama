package iterium

import (
	"math"
)

func RangeCount[N Number](start, stop, step N) int64 {
	a, b, c := float64(start), float64(stop), float64(step)
	return int64(math.Ceil((b - a) / c))
}

// Range function returns a sequence of numbers, starting from 0 by default, and
// increments by 1 (by default), and stops before a specified number.
func Range[S Signed](args ...S) Iter[S] {
	var start, stop, step S
	var total int64

	switch len(args) {
	case 0:
		return Empty[S]()
	case 1:
		// If there is only one value, assign a value to the variable `stop`.
		stop, start, step = argsTrio(args, 0, 0, 1)
		if args[0] < 0 {
			step = -1
		}
	default:
		start, stop, step = argsTrio(args, 0, 0, 1)
	}

	// Check if the parameters are logically correct.
	total = RangeCount(start, stop, step)
	if total <= 0 {
		return Empty[S]()
	}

	// Initialisation of a new channel.
	iter := Instance[S](total, false)

	go func() {
		defer IterRecover()
		defer iter.Close()

		for i := uint(0); i < uint(total); i++ {
			iter.Chan() <- start
			start = start + step
		}
	}()

	return iter
}
