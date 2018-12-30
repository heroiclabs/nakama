package store

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/gobuffalo/genny/gentest"
	"github.com/gobuffalo/genny/movinglater/gotools/gomods"
	"github.com/gobuffalo/packr/v2"
	"github.com/gobuffalo/packr/v2/jam/parser"
	"github.com/markbates/oncer"
	"github.com/stretchr/testify/require"
)

func init() {
	parser.DefaultIgnoredFolders = []string{"vendor", ".git", "node_modules", ".idea"}
}

func Test_Disk_Generator(t *testing.T) {
	gomods.Disable(func() error {

		r := require.New(t)

		p, err := parser.NewFromRoots([]string{"./_fixtures/disk-pack"}, &parser.RootsOptions{
			IgnoreImports: true,
		})
		r.NoError(err)

		boxes, err := p.Run()
		r.NoError(err)

		d := NewDisk(".", "")
		for _, b := range boxes {
			r.NoError(d.Pack(b))
		}

		run := gentest.NewRunner()
		run.WithNew(d.Generator())
		r.NoError(run.Run())

		res := run.Results()
		r.Len(res.Files, 3)

		f := res.Files[0]
		r.Equal("a-packr.go", filepath.Base(f.Name()))
		r.Contains(f.String(), `import _ "github.com/gobuffalo/packr/v2/jam/packrd"`)
		return nil
	})
}

func Test_Disk_FileNames(t *testing.T) {
	r := require.New(t)

	d := &Disk{}

	box := parser.NewBox("Test_Disk_FileNames", "./_fixtures/disk/franklin")
	names, err := d.FileNames(box)
	r.NoError(err)
	r.Len(names, 2)

	r.Equal("aretha.txt", filepath.Base(names[0]))
	r.Equal("think.txt", filepath.Base(names[1]))
}

func Test_Disk_Files(t *testing.T) {
	r := require.New(t)

	d := &Disk{}

	box := parser.NewBox("Test_Disk_Files", "./_fixtures/disk/franklin")
	files, err := d.Files(box)
	r.NoError(err)
	r.Len(files, 2)

	f := files[0]
	r.Equal("aretha.txt", filepath.Base(f.Name()))
	r.Equal("RESPECT!", strings.TrimSpace(f.String()))

	f = files[1]
	r.Equal("think.txt", filepath.Base(f.Name()))
	r.Equal("THINK!", strings.TrimSpace(f.String()))
}

func Test_Disk_Pack(t *testing.T) {
	oncer.Reset()
	r := require.New(t)

	d := NewDisk("", "")

	p, err := parser.NewFromRoots([]string{"./_fixtures/disk-pack"}, &parser.RootsOptions{
		IgnoreImports: true,
	})
	r.NoError(err)
	boxes, err := p.Run()
	r.NoError(err)

	for _, b := range boxes {
		r.NoError(d.Pack(b))
	}

	global := d.global
	r.Len(global, 3)

	r.Len(d.boxes, 3)

}

func Test_Disk_Packed_Test(t *testing.T) {
	r := require.New(t)

	b := packr.NewBox("simpsons")

	s, err := b.FindString("parents/homer.txt")
	r.NoError(err)
	r.Equal("HOMER Simpson", strings.TrimSpace(s))

	s, err = b.FindString("parents/marge.txt")
	r.NoError(err)
	r.Equal("MARGE Simpson", strings.TrimSpace(s))

	_, err = b.FindString("idontexist")
	r.Error(err)
}

func Test_Disk_Close(t *testing.T) {
	gomods.Disable(func() error {
		r := require.New(t)

		p, err := parser.NewFromRoots([]string{"./_fixtures/disk-pack"}, nil)
		r.NoError(err)
		boxes, err := p.Run()
		r.NoError(err)

		d := NewDisk("./_fixtures/disk-pack", "")
		for _, b := range boxes {
			r.NoError(d.Pack(b))
		}
		r.NoError(d.Close())
		return nil
	})
}
