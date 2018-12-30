package packr

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_PackBytes(t *testing.T) {
	r := require.New(t)

	box := NewBox("my/box")
	name := "foo.txt"
	body := []byte("foo!!")
	PackBytes(box.Name, name, body)

	f, err := box.FindString(name)
	r.NoError(err)
	r.Equal(string(body), f)
}

func Test_PackBytesGzip(t *testing.T) {
	r := require.New(t)

	box := NewBox("my/box")
	name := "foo.txt"
	body := []byte("foo!!")
	PackBytesGzip(box.Name, name, body)

	f, err := box.FindString(name)
	r.NoError(err)
	r.Equal(string(body), f)
}

func Test_PackJSONBytes(t *testing.T) {
	r := require.New(t)

	box := NewBox("my/box")
	name := "foo.txt"
	body := "\"PGgxPnRlbXBsYXRlcy9tYWlsZXJzL2xheW91dC5odG1sPC9oMT4KCjwlPSB5aWVsZCAlPgo=\""
	PackJSONBytes(box.Name, name, body)

	f, err := box.FindString(name)
	r.NoError(err)
	r.Equal("<h1>templates/mailers/layout.html</h1>\n\n<%= yield %>\n", f)
}
