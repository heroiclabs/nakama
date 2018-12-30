package packr

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_Pointer_Find(t *testing.T) {
	r := require.New(t)

	b1 := New("b1", "")
	r.NoError(b1.AddString("foo.txt", "FOO!"))

	b2 := New("b2", "")
	b2.SetResolver("bar.txt", &Pointer{
		ForwardBox:  "b1",
		ForwardPath: "foo.txt",
	})

	s, err := b2.FindString("bar.txt")
	r.NoError(err)
	r.Equal("FOO!", s)
}
