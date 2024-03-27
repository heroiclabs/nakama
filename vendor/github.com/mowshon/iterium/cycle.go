package iterium

// Cycle returns an infinite iterator that writes data from
// the provided iterator to the infinite iterator.
//
// e.g. Cycle(New(1, 2, 3)) => 1, 2, 3, 1, 2, 3 ...
func Cycle[T any](iterable Iter[T]) Iter[T] {
	if iterable.IsInfinite() {
		return iterable
	}

	// Creation of a new iterator.
	iter := Instance[T](0, true)

	// Conversion of iterator to slice
	slice, _ := iterable.Slice()
	if len(slice) == 0 {
		return Empty[T]()
	}

	// Run infinite loop into the goroutine and
	// send values from the slice to the channel.
	go func() {
		defer IterRecover()
		defer iter.Close()

		for {
			for _, value := range slice {
				iter.Chan() <- value
			}
		}
	}()

	return iter
}
