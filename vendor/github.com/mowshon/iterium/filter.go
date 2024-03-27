package iterium

// Filter creates a new iterator and writes to the channel only
// those values that returned `true` after executing the predicate function.
func Filter[T any](iterable Iter[T], predicate func(T) bool) Iter[T] {
	iter := Instance[T](iterable.Count(), iterable.IsInfinite())

	go func() {
		defer IterRecover()
		defer iter.Close()

		for {
			next, err := iterable.Next()
			if err != nil {
				return
			}

			// Send a value to the channel only
			// if the result is `true`.
			if predicate(next) {
				iter.Chan() <- next
			}
		}
	}()

	return iter
}
