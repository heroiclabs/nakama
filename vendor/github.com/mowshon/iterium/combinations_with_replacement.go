package iterium

import (
	"math/big"
)

// CombinationsWithReplacementCount calculates the total number of combinations with replacement
// for a given set of n elements and a combination length of k.
func CombinationsWithReplacementCount(n, k int) int64 {
	// The function uses the binomial coefficient formula to
	// calculate the total number of combinations with replacement.
	numerator := big.NewInt(1).Binomial(int64(n+k-1), int64(k))
	return numerator.Int64()
}

// CombinationsWithReplacement generates all possible combinations with replacement
// of a given set of elements.
func CombinationsWithReplacement[T any](symbols []T, k int) Iter[[]T] {
	arr := placeHolders(len(symbols))
	total := CombinationsWithReplacementCount(len(symbols), k)
	iter := Instance[[]T](total, false)

	go func() {
		defer IterRecover()
		defer iter.Close()

		comb := make([]int, k)
		for i := range comb {
			comb[i] = -1
		}

		// Define a recursive function to generate combinations.
		var generateCombination func(start, combIndex int)
		generateCombination = func(start, combIndex int) {
			if combIndex == k {
				// When a combination is complete, send it to the channel.
				result := make([]T, k)
				replacePlaceholders[T](symbols, comb, &result)
				iter.Chan() <- result
				return
			}

			for i := start; i < len(arr); i++ {
				comb[combIndex] = arr[i]
				// Recursively generate the rest of the combination.
				generateCombination(i, combIndex+1)
			}
		}

		generateCombination(0, 0)
	}()

	return iter
}
