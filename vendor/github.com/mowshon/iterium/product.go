package iterium

import (
	"math"
)

// ProductCount calculates the number of Cartesian products with repeat.
func ProductCount(countOfSymbols, repeat int) int64 {
	return int64(math.Pow(float64(countOfSymbols), float64(repeat)))
}

// Product generates a Cartesian product for a given slice of elements with a repeat.
func Product[T any](symbols []T, repeat int) Iter[[]T] {
	total := ProductCount(len(symbols), repeat)
	// Create a new channel receiving slices.
	iter := Instance[[]T](total, false)

	start, end := 0, len(symbols)-1
	slice := make([]int, repeat)

	// Create a slice of length `repeat` and initialize it with the value `start`
	for i := 0; i < repeat; i++ {
		slice[i] = start
	}

	go func() {
		defer IterRecover()
		defer iter.Close()

		// Generate all possible combinations of `repeat` elements
		// from the integer slice `[start, end]`.
		for step := uint(0); step < uint(total); step++ {
			result := make([]T, repeat)
			replacePlaceholders[T](symbols, slice, &result)
			iter.Chan() <- result

			// Increment the rightmost element of the combination by 1
			// and propagate the carry to the left if necessary.
			for i := repeat - 1; i >= 0; i-- {
				slice[i]++

				if slice[i] <= end {
					break
				}

				slice[i] = start
			}
		}
	}()

	return iter
}
