package packr

import (
	"bytes"
	"io/ioutil"
	"os"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_Box_FindString(t *testing.T) {
	r := require.New(t)
	s, err := testBox.FindString("hello.txt")
	r.NoError(err)
	r.Equal("hello world!", strings.TrimSpace(s))

	_, err = testBox.Find("idontexist.txt")
	r.Error(err)
}

func Test_Box_FindBytes(t *testing.T) {
	r := require.New(t)
	s, err := testBox.Find("hello.txt")
	r.NoError(err)
	r.Equal([]byte("hello world!"), bytes.TrimSpace(s))

	_, err = testBox.Find("idontexist.txt")
	r.Error(err)
}

func Test_Box_Has(t *testing.T) {
	r := require.New(t)
	r.True(testBox.Has("hello.txt"))
	r.False(testBox.Has("idontexist.txt"))
}

func Test_List_Virtual(t *testing.T) {
	r := require.New(t)
	mustHave := []string{"a", "b", "c", "d/a"}
	actual := virtualBox.List()
	sort.Strings(actual)
	r.Equal(mustHave, actual)
}

func Test_List_Physical(t *testing.T) {
	r := require.New(t)
	mustHave := osPaths("MyFile.txt", "foo/a.txt", "foo/bar/b.txt", "goodbye.txt", "hello.txt", "index.html")
	actual := testBox.List()
	r.Equal(mustHave, actual)
}

func Test_Outside_Box(t *testing.T) {
	r := require.New(t)
	f, err := ioutil.TempFile("", "")
	r.NoError(err)
	defer os.RemoveAll(f.Name())
	_, err = testBox.FindString(f.Name())
	r.Error(err)
}

func Test_Box_find(t *testing.T) {
	box := NewBox("./example")

	onWindows := runtime.GOOS == "windows"
	table := []struct {
		name  string
		found bool
	}{
		{"assets/app.css", true},
		{"assets\\app.css", onWindows},
		{"foo/bar.baz", false},
		{"bar", true},
		{"bar/sub", true},
		{"bar/foo", false},
		{"bar/sub/sub.html", true},
	}

	for _, tt := range table {
		t.Run(tt.name, func(st *testing.T) {
			r := require.New(st)
			_, err := box.find(tt.name)
			if tt.found {
				r.True(box.Has(tt.name))
				r.NoError(err)
			} else {
				r.False(box.Has(tt.name))
				r.Error(err)
			}
		})
	}
}

func Test_Virtual_Directory_Not_Found(t *testing.T) {
	r := require.New(t)
	_, err := virtualBox.find("d")
	r.NoError(err)
	_, err = virtualBox.find("does-not-exist")
	r.Error(err)
}

func Test_AddString(t *testing.T) {
	r := require.New(t)

	_, err := virtualBox.Find("string")
	r.Error(err)

	virtualBox.AddString("string", "hello")

	s, err := virtualBox.FindString("string")
	r.NoError(err)
	r.Equal("hello", s)
}

func Test_AddBytes(t *testing.T) {
	r := require.New(t)

	_, err := virtualBox.Find("bytes")
	r.Error(err)

	virtualBox.AddBytes("bytes", []byte("hello"))

	s, err := virtualBox.Find("bytes")
	r.NoError(err)
	r.Equal([]byte("hello"), s)
}
