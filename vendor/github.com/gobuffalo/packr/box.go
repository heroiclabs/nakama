package packr

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/gobuffalo/packd"
)

var (
	// ErrResOutsideBox gets returned in case of the requested resources being outside the box
	ErrResOutsideBox = fmt.Errorf("Can't find a resource outside the box")
)

var _ packd.Box = Box{}
var _ packd.HTTPBox = Box{}
var _ packd.Lister = Box{}
var _ packd.Addable = Box{}
var _ packd.Walkable = Box{}
var _ packd.Finder = Box{}
var _ packd.LegacyBox = Box{}

// NewBox returns a Box that can be used to
// retrieve files from either disk or the embedded
// binary.
func NewBox(path string) Box {
	var cd string
	if !filepath.IsAbs(path) {
		_, filename, _, _ := runtime.Caller(1)
		cd = filepath.Dir(filename)
	}

	// this little hack courtesy of the `-cover` flag!!
	cov := filepath.Join("_test", "_obj_test")
	cd = strings.Replace(cd, string(filepath.Separator)+cov, "", 1)
	if !filepath.IsAbs(cd) && cd != "" {
		cd = filepath.Join(GoPath(), "src", cd)
	}

	return Box{
		Path:       path,
		callingDir: cd,
		data:       map[string][]byte{},
	}
}

// Box represent a folder on a disk you want to
// have access to in the built Go binary.
type Box struct {
	Path        string
	callingDir  string
	data        map[string][]byte
	directories map[string]bool
}

// AddString converts t to a byteslice and delegates to AddBytes to add to b.data
func (b Box) AddString(path string, t string) error {
	b.AddBytes(path, []byte(t))
	return nil
}

// AddBytes sets t in b.data by the given path
func (b Box) AddBytes(path string, t []byte) error {
	b.data[path] = t
	return nil
}

// Deprecated: Use FindString instead.
func (b Box) String(name string) string {
	bb, _ := b.FindString(name)
	return bb
}

// Deprecated: Use FindString instead.
func (b Box) MustString(name string) (string, error) {
	return b.FindString(name)
}

// Deprecated: Use Find instead.
func (b Box) Bytes(name string) []byte {
	bb, _ := b.Find(name)
	return bb
}

// Deprecated: Use Find instead.
func (b Box) MustBytes(name string) ([]byte, error) {
	return b.Find(name)
}

// FindString returns either the string of the requested
// file or an error if it can not be found.
func (b Box) FindString(name string) (string, error) {
	bb, err := b.Find(name)
	return string(bb), err
}

// Find returns either the byte slice of the requested
// file or an error if it can not be found.
func (b Box) Find(name string) ([]byte, error) {
	f, err := b.find(name)
	if err == nil {
		bb := &bytes.Buffer{}
		bb.ReadFrom(f)
		return bb.Bytes(), err
	}
	return nil, err
}

// Has returns true if the resource exists in the box
func (b Box) Has(name string) bool {
	_, err := b.find(name)
	if err != nil {
		return false
	}
	return true
}

func (b Box) decompress(bb []byte) []byte {
	reader, err := gzip.NewReader(bytes.NewReader(bb))
	if err != nil {
		return bb
	}
	defer reader.Close()

	data, err := ioutil.ReadAll(reader)
	if err != nil {
		return bb
	}
	return data
}

func (b Box) find(name string) (File, error) {
	if bb, ok := b.data[name]; ok {
		return packd.NewFile(name, bytes.NewReader(bb))
	}

	if b.directories == nil {
		b.indexDirectories()
	}

	cleanName := filepath.ToSlash(filepath.Clean(name))
	// Ensure name is not outside the box
	if strings.HasPrefix(cleanName, "../") {
		return nil, ErrResOutsideBox
	}
	// Absolute name is considered as relative to the box root
	cleanName = strings.TrimPrefix(cleanName, "/")

	if _, ok := data[b.Path]; ok {
		if bb, ok := data[b.Path][cleanName]; ok {
			bb = b.decompress(bb)
			return packd.NewFile(cleanName, bytes.NewReader(bb))
		}
		if _, ok := b.directories[cleanName]; ok {
			return packd.NewDir(cleanName)
		}
		if filepath.Ext(cleanName) != "" {
			// The Handler created by http.FileSystem checks for those errors and
			// returns http.StatusNotFound instead of http.StatusInternalServerError.
			return nil, os.ErrNotExist
		}
		return nil, os.ErrNotExist
	}

	// Not found in the box virtual fs, try to get it from the file system
	cleanName = filepath.FromSlash(cleanName)
	p := filepath.Join(b.callingDir, b.Path, cleanName)
	return fileFor(p, cleanName)
}

// Open returns a File using the http.File interface
func (b Box) Open(name string) (http.File, error) {
	return b.find(name)
}

// List shows "What's in the box?"
func (b Box) List() []string {
	var keys []string

	if b.data == nil || len(b.data) == 0 {
		b.Walk(func(path string, info File) error {
			finfo, _ := info.FileInfo()
			if !finfo.IsDir() {
				keys = append(keys, finfo.Name())
			}
			return nil
		})
	} else {
		for k := range b.data {
			keys = append(keys, k)
		}
	}
	return keys
}

func (b *Box) indexDirectories() {
	b.directories = map[string]bool{}
	if _, ok := data[b.Path]; ok {
		for name := range data[b.Path] {
			prefix, _ := path.Split(name)
			// Even on Windows the suffix appears to be a /
			prefix = strings.TrimSuffix(prefix, "/")
			b.directories[prefix] = true
		}
	}
}

func fileFor(p string, name string) (File, error) {
	fi, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	if fi.IsDir() {
		return packd.NewDir(p)
	}
	if bb, err := ioutil.ReadFile(p); err == nil {
		return packd.NewFile(name, bytes.NewReader(bb))
	}
	return nil, os.ErrNotExist
}
