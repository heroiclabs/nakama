package iterium

// iterator is the initial iterator structure.
type iterator[T any] struct {
	channel  chan T
	infinite bool
	length   int64
}

// IsInfinite returns the iterator infinite state.
func (i *iterator[T]) IsInfinite() bool {
	return i.infinite
}

// SetInfinite update the infinity state of the iterator.
func (i *iterator[T]) SetInfinite(endless bool) {
	i.infinite = endless
}

// Chan returns the iterator channel.
func (i *iterator[T]) Chan() chan T {
	return i.channel
}

// Next returns the next value or error from the iterator channel.
func (i *iterator[T]) Next() (result T, err error) {
	if value, ok := <-i.Chan(); ok {
		return value, nil
	}

	return result, stopIterationErr
}

// Close closes the iterator channel.
func (i *iterator[T]) Close() {
	close(i.channel)
}

// Count returns the number of possible values the iterator can return.
func (i *iterator[T]) Count() int64 {
	return i.length
}

// Slice turns the iterator into a slice of values.
func (i *iterator[T]) Slice() ([]T, error) {
	if i.IsInfinite() {
		return nil, infiniteIteratorErr
	}

	result := make([]T, 0)
	for {
		next, err := i.Next()
		if err != nil {
			return result, nil
		}

		result = append(result, next)
	}
}

// New creates a new iterator with a generic data type.
func New[T any](values ...T) Iter[T] {
	iter := Instance[T](int64(len(values)), false)

	go func() {
		defer IterRecover()
		defer iter.Close()

		for _, val := range values {
			iter.Chan() <- val
		}
	}()

	return iter
}

// Instance initialises and returns the basic iterator structure.
func Instance[T any](length int64, infinite bool) Iter[T] {
	return &iterator[T]{
		channel:  make(chan T),
		infinite: infinite,
		length:   length,
	}
}

// Empty creates an empty-closed iterator.
func Empty[T any]() Iter[T] {
	empty := Instance[T](0, false)
	empty.Close()

	return empty
}
