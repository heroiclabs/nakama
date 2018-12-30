package packr

import (
	"path/filepath"
	"testing"

	"github.com/gobuffalo/packr/v2/file"
	"github.com/stretchr/testify/require"
)

func Test_Box_Walk(t *testing.T) {
	r := require.New(t)

	box := NewBox(filepath.Join("_fixtures", "list_test"))
	r.NoError(box.AddString(filepath.Join("d", "d.txt"), "D"))

	var act []string
	r.NoError(box.Walk(func(path string, f file.File) error {
		act = append(act, path)
		return nil
	}))
	exp := []string{"a.txt", filepath.Join("b", "b.txt"), filepath.Join("b", "b2.txt"), filepath.Join("c", "c.txt"), filepath.Join("d", "d.txt")}
	r.Equal(exp, act)
}

func Test_Box_WalkPrefix(t *testing.T) {
	r := require.New(t)

	box := NewBox(filepath.Join("_fixtures", "list_test"))
	r.NoError(box.AddString(filepath.Join("d", "d.txt"), "D"))

	var act []string
	r.NoError(box.WalkPrefix("b/", func(path string, f file.File) error {
		act = append(act, path)
		return nil
	}))
	exp := []string{filepath.Join("b", "b.txt"), filepath.Join("b", "b2.txt")}
	r.Equal(exp, act)
}
