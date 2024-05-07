package iterium

// DropWhile returns all other values from the provided iterator
// after receiving the first `false` from the provided function.
//
// e.g. DropWhile(New(1, 4, 6, 4, 1), x < 5) => [6, 4, 1]
func DropWhile[T any](iterable Iter[T], pred func(T) bool) Iter[T] {
	iter := Instance[T](0, false)

	go func() {
		defer IterRecover()
		defer iter.Close()

		// Wait until the value from the channel returns false.
		for {
			if value, ok := <-iterable.Chan(); ok {
				if !pred(value) {
					// This value is also written
					// to the new iterator.
					iter.Chan() <- value
					break
				}
			}
		}

		// Once false has been received, write all
		// the following values to the channel.
		for true {
			next, err := iterable.Next()
			if err != nil {
				return
			}

			iter.Chan() <- next
		}
	}()

	return iter
}
