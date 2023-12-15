package iterium

// Repeat returns a channel from which a value can be retrieved n-number of times.
func Repeat[T any](value T, n int) Iter[T] {
	// Initialisation of a new channel.
	iter := Instance[T](int64(n), false)

	// If the length is below zero, then
	// the iterator will run forever.
	if n < 0 {
		iter.SetInfinite(true)
	}

	go func() {
		defer IterRecover()
		defer iter.Close()

		if iter.IsInfinite() {
			for {
				iter.Chan() <- value
			}
		}

		for step := 0; step < n; step++ {
			iter.Chan() <- value
		}
	}()

	return iter
}
