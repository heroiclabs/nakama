package iterium

// TakeWhile returns only the first values from the provided iterator that
// returned `true` after sending them to the provided function.
//
// e.g. TakeWhile(New(1, 4, 6, 4, 1), x < 5) => [1, 4]
func TakeWhile[T any](iterable Iter[T], pred func(T) bool) Iter[T] {
	iter := Instance[T](0, false)

	go func() {
		defer IterRecover()
		defer iter.Close()

		for true {
			next, err := iterable.Next()
			if err != nil {
				return
			}

			// Send values to the channel if the result
			// of the function returns true.
			if pred(next) {
				iter.Chan() <- next
			} else {
				// The first error forces the channel to be
				// closed and the result returned.
				return
			}
		}
	}()

	return iter
}
