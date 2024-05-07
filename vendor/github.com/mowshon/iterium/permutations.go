package iterium

import (
	"math/big"
)

// PermutationCount returns the total number of possible permutations
// of k elements from a sequence of n elements.
//
// Formula: n! / (n-k)!
func PermutationCount(countOfSymbols, limit int) int64 {
	// Create a big.Int value to store the total number of permutations.
	total := big.NewInt(1)

	// Calculate n! / (n-k)! and store the result in the 'total' variable.
	for i := countOfSymbols - limit + 1; i <= countOfSymbols; i++ {
		total.Mul(total, big.NewInt(int64(i)))
	}

	// Return the total number of permutations.
	return total.Int64()
}

// Permutations generates all possible permutations of the input slice of symbols using recursion.
func Permutations[T any](symbols []T, limit int) Iter[[]T] {
	if limit > len(symbols) {
		// The length of the permutation cannot be
		// longer than the characters provided.
		return Empty[[]T]()
	}

	total := PermutationCount(len(symbols), limit)
	// Create a new channel receiving slices.
	iter := Instance[[]T](total, false)
	arr := placeHolders(len(symbols))

	// Define a recursive backtrack function to generate permutations.
	var backtrack func(first int)

	go func() {
		defer IterRecover()
		defer iter.Close()

		backtrack = func(first int) {
			// if we have used up all the elements in the iterable,
			// add the current permutation to the channel.
			if first == limit {
				result := make([]T, limit)
				replacePlaceholders[T](symbols, arr[:limit], &result)
				iter.Chan() <- result
				return
			}

			// for each index i in the range [first, len(arr)),
			// swap the elements at index i and first,
			// and recursively generate permutations starting from index first+1
			for i := first; i < len(arr); i++ {
				arr[first], arr[i] = arr[i], arr[first]
				backtrack(first + 1)
				arr[first], arr[i] = arr[i], arr[first]
			}
		}

		// Call the backtrack function to generate permutations starting from index 0.
		backtrack(0)
	}()

	return iter
}
