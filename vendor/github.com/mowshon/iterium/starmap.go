package iterium

// StarMap takes a iterator with slices of two values and applies
// a binary function to them, returning a new iterator with the result of that function.
func StarMap[T any](iterable Iter[[]T], apply func(T, T) T) Iter[T] {
	iter := Instance[T](iterable.Count(), iterable.IsInfinite())

	go func() {
		defer IterRecover()
		defer iter.Close()

		for true {
			next, err := iterable.Next()
			if err != nil {
				return
			}

			// Apply the function to the values from the slide.
			iter.Chan() <- apply(next[0], next[1])
		}
	}()

	return iter
}
