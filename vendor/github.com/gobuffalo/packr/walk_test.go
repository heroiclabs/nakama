package packr

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_Box_Walk_Physical(t *testing.T) {
	r := require.New(t)
	count := 0
	err := testBox.Walk(func(path string, f File) error {
		count++
		return nil
	})
	r.NoError(err)
	r.Equal(3, count)
}

func Test_Box_Walk_Virtual(t *testing.T) {
	r := require.New(t)
	count := 0
	err := virtualBox.Walk(func(path string, f File) error {
		count++
		return nil
	})
	r.NoError(err)
	r.Equal(4, count)
}

func Test_Box_WalkPrefix_Physical(t *testing.T) {
	r := require.New(t)
	var files []string
	b := NewBox("../packr/fixtures")
	err := b.WalkPrefix("foo/", func(path string, f File) error {
		files = append(files, path)
		return nil
	})
	r.NoError(err)
	r.Equal(2, len(files))
	mustHave := osPaths("foo/a.txt", "foo/bar/b.txt")
	r.Equal(mustHave, files)
}

func Test_Box_WalkPrefix_Virtual(t *testing.T) {
	r := require.New(t)
	var files []string
	err := virtualBox.WalkPrefix("d", func(path string, f File) error {
		files = append(files, path)
		return nil
	})
	r.NoError(err)
	r.Equal(1, len(files))
	r.Equal([]string{"d/a"}, files)
}
