package iterium

// FirstFalse returns the iterator with the first value from
// the provided iterator that returned `false` after the function was applied.
func FirstFalse[T any](iterable Iter[T], apply func(T) bool) Iter[T] {
	iter := Instance[T](0, false)

	go func() {
		defer IterRecover()
		defer iter.Close()

		for true {
			next, err := iterable.Next()
			if err != nil {
				return
			}

			if !apply(next) {
				iter.Chan() <- next
				return
			}
		}
	}()

	return iter
}
