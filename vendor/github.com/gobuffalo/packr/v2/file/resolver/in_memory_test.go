package resolver

import (
	"io/ioutil"
	"strings"
	"testing"

	"github.com/gobuffalo/packr/v2/file"
	"github.com/stretchr/testify/require"
)

func Test_inMemory_Find(t *testing.T) {
	r := require.New(t)

	files := map[string]file.File{
		"foo.txt": qfile("foo.txt", "foo!"),
	}
	d := NewInMemory(files)

	f, err := d.Resolve("", "foo.txt")
	r.NoError(err)

	fi, err := f.FileInfo()
	r.NoError(err)
	r.Equal("foo.txt", fi.Name())

	b, err := ioutil.ReadAll(f)
	r.NoError(err)
	r.Equal("foo!", strings.TrimSpace(string(b)))
}
