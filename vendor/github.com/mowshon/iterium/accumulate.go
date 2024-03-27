package iterium

// Accumulate returns an iterator that sends the accumulated
// result from the binary function to the channel.
func Accumulate[T any](iterable Iter[T], operator func(T, T) T) Iter[T] {
	iter := Instance[T](iterable.Count(), iterable.IsInfinite())

	go func() {
		defer IterRecover()
		defer iter.Close()

		var last T
		var start bool
		for true {
			next, err := iterable.Next()
			if err != nil {
				return
			}

			if !start {
				iter.Chan() <- next
				last = next
				start = true
				continue
			}

			result := operator(last, next)
			iter.Chan() <- result
			last = result
		}
	}()

	return iter
}
