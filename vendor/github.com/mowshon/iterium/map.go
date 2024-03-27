package iterium

func Map[T, W any](iterable Iter[T], apply func(T) W) Iter[W] {
	iter := Instance[W](iterable.Count(), iterable.IsInfinite())

	go func() {
		defer IterRecover()
		defer iter.Close()

		for true {
			next, err := iterable.Next()
			if err != nil {
				break
			}

			iter.Chan() <- apply(next)
		}
	}()

	return iter
}
