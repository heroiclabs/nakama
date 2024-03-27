package iterium

import (
	"errors"
	"golang.org/x/exp/constraints"
)

var (
	// stopIterationErr is an error that occurs when the iterator is closed.
	stopIterationErr = errors.New("stop iteration")
	// infiniteIteratorErr is an error that occurs when converting an infinite iterator to a slice.
	infiniteIteratorErr = errors.New("an infinite iterator cannot be a slice")
)

// Number is the type constraint which includes all numbers.
type Number interface {
	constraints.Integer | constraints.Float
}

// Signed is a type restriction on all numbers especially
// including negative numbers and floating point numbers.
type Signed interface {
	constraints.Signed | constraints.Float
}

// Iter is the iterator interface with all the necessary methods.
type Iter[T any] interface {
	IsInfinite() bool
	SetInfinite(bool)
	Next() (T, error)
	Chan() chan T
	Close()
	Slice() ([]T, error)
	Count() int64
}

// IterRecover intercepts the resulting error from the goroutine.
func IterRecover() {
	recover()
}

// placeHolders creates a slice of successive indexes.
func placeHolders(length int) []int {
	result := make([]int, length)

	for i := 0; i < length; i++ {
		result[i] = i
	}

	return result
}

// replacePlaceholders replaces the slice of the indexes with a slice
// of the provided values depending on their index in the first slide.
func replacePlaceholders[T any](from []T, to []int, result *[]T) {
	replace := *result
	for i := 0; i < len(to); i++ {
		replace[i] = from[to[i]]
	}
}

// argsTrio takes the first three values from the slice and returns them as arguments.
func argsTrio[T any](args []T, first, second, third T) (T, T, T) {
	switch len(args) {
	case 0:
		return first, second, third
	case 1:
		return args[0], second, third
	case 2:
		return args[0], args[1], third
	default:
		return args[0], args[1], args[2]
	}
}
