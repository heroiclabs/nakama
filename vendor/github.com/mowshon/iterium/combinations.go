package iterium

import "math"

// CombinationsCount is a function that takes a positive integer `n` and a limit `k` as input
// and returns the total number of possible combinations of `k` elements from a set of `n` distinct elements.
//
// Formula: n! / (k! * (n - k)!)
func CombinationsCount(n, k int) int64 {
	a, _ := math.Lgamma(float64(n) + 1)
	b, _ := math.Lgamma(float64(k) + 1)
	c, _ := math.Lgamma(float64(n-k) + 1)
	return int64(math.Round(math.Exp(a - b - c)))
}

// Combinations is a function that takes a slice of T and a
// limit as input and returns a slice of all possible combinations of
// the T in the input slice of the given limit.
func Combinations[T any](symbols []T, limit int) Iter[[]T] {
	// If the length of the input slice is less than the desired limit,
	// there are no valid combinations, so return an empty slice.
	if len(symbols) < limit {
		return Empty[[]T]()
	}

	total := CombinationsCount(len(symbols), limit)
	iter := Instance[[]T](total, false)
	nums := placeHolders(len(symbols))

	// Initialize a stack to hold the indices of the elements to be included
	// in each combination. The stack is initialized with the index of each
	// element in the input slice.
	stack := make([][]int, 0, len(nums))
	for i := 0; i < len(nums); i++ {
		stack = append(stack, []int{i})
	}

	go func() {
		defer IterRecover()
		defer iter.Close()

		// Loop over the stack until it is empty.
		for len(stack) > 0 {
			// Pop the first set of indices from the stack.
			combIdxs := stack[0]
			stack = stack[1:]

			// If the combination has the desired length, construct the combination
			// from the corresponding elements of the input slice and insert it to
			// the channel.
			if len(combIdxs) == limit {
				result := make([]T, limit)
				replacePlaceholders[T](symbols, combIdxs, &result)
				iter.Chan() <- result
				continue
			}

			// If the combination has fewer elements than the desired length, add
			// all possible extensions to the stack.
			lastIdx := combIdxs[len(combIdxs)-1]
			for i := lastIdx + 1; i <= len(nums)-(limit-len(combIdxs)); i++ {
				newCombIdxs := make([]int, len(combIdxs))
				copy(newCombIdxs, combIdxs)
				newCombIdxs = append(newCombIdxs, i)
				stack = append(stack, newCombIdxs)
			}
		}
	}()

	return iter
}
