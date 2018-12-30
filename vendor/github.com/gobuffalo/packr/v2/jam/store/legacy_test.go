package store

import (
	"path/filepath"
	"testing"

	"github.com/gobuffalo/genny/gentest"
	"github.com/gobuffalo/packr/v2/jam/parser"
	"github.com/markbates/oncer"
	"github.com/stretchr/testify/require"
)

func Test_Legacy_Pack(t *testing.T) {
	r := require.New(t)

	d := NewLegacy()

	p, err := parser.NewFromRoots([]string{"./_fixtures/disk"}, &parser.RootsOptions{
		IgnoreImports: true,
	})
	r.NoError(err)
	boxes, err := p.Run()
	r.NoError(err)

	for _, b := range boxes {
		r.NoError(d.Pack(b))
	}

	db := d.boxes
	r.Len(db, 2)
	for k, v := range db {
		switch filepath.Base(k) {
		case "disk":
			r.Len(v, 1)
		case "e":
			r.Len(v, 2)
		default:
			r.Fail(k)
		}
	}
}

func Test_Legacy_Close(t *testing.T) {
	oncer.Reset()
	r := require.New(t)

	d := NewLegacy()

	p, err := parser.NewFromRoots([]string{"./_fixtures/disk"}, &parser.RootsOptions{
		IgnoreImports: true,
	})
	r.NoError(err)
	boxes, err := p.Run()
	r.NoError(err)

	for _, b := range boxes {
		r.NoError(d.Pack(b))
	}
	r.Len(d.boxes, 2)

	run := gentest.NewRunner()
	r.NoError(run.WithNew(d.Generator()))
	r.NoError(run.Run())

	res := run.Results()
	r.Len(res.Files, 2)
}
