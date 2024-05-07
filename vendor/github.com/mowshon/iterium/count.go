package iterium

// Count returns an iterator in which each successive value
// will be added to the value from step.
func Count[N Number](args ...N) Iter[N] {
	start, step, _ := argsTrio[N](args, 0, 1, 0)

	// Initialisation of a new channel.
	iter := Instance[N](0, true)

	go func() {
		defer IterRecover()
		defer iter.Close()

		for {
			iter.Chan() <- start
			start = start + step
		}
	}()

	return iter
}
