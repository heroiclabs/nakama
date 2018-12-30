package oncer

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_Do(t *testing.T) {
	r := require.New(t)

	var counter int
	for i := 0; i < 5; i++ {
		Do("foo", func() {
			counter++
		})
	}
	r.Equal(1, counter)
}

func Test_Reset_ByName(t *testing.T) {
	r := require.New(t)

	Do("foo", func() {})
	Do("bar", func() {})

	_, ok := onces.Load("foo")
	r.True(ok)

	_, ok = onces.Load("bar")
	r.True(ok)

	Reset("foo")

	_, ok = onces.Load("foo")
	r.False(ok)

	_, ok = onces.Load("bar")
	r.True(ok)
}

func Test_Reset_All(t *testing.T) {
	r := require.New(t)

	Do("foo", func() {})
	Do("bar", func() {})

	_, ok := onces.Load("foo")
	r.True(ok)

	_, ok = onces.Load("bar")
	r.True(ok)

	Reset()

	_, ok = onces.Load("foo")
	r.False(ok)

	_, ok = onces.Load("bar")
	r.False(ok)
}
