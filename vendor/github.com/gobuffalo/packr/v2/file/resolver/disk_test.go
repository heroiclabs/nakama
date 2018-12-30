package resolver

import (
	"io/ioutil"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_Disk_Find(t *testing.T) {
	r := require.New(t)

	d := &Disk{
		Root: "_fixtures\\templates",
	}

	f, err := d.Resolve("", "foo.txt")
	r.NoError(err)

	fi, err := f.FileInfo()
	r.NoError(err)
	r.Equal("foo.txt", fi.Name())

	b, err := ioutil.ReadAll(f)
	r.NoError(err)
	r.Equal("foo!", strings.TrimSpace(string(b)))
}
