package iterium

// FilterFalse creates a new iterator and writes to the channel only
// those values that returned FALSE after executing the predicate function.
func FilterFalse[T any](iterable Iter[T], predicate func(T) bool) Iter[T] {
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
			// if the result is `false`.
			if !predicate(next) {
				iter.Chan() <- next
			}
		}
	}()

	return iter
}
