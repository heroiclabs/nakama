package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/gobuffalo/packr/v2/jam/parser"
	"github.com/gobuffalo/packr/v2/jam/store"
	"github.com/markbates/oncer"
	"github.com/stretchr/testify/require"
)

func init() {
	parser.DefaultIgnoredFolders = []string{"vendor", ".git", "node_modules", ".idea"}
}

func Test_Parser_Run(t *testing.T) {
	r := require.New(t)

	f1 := parser.NewFile("a/a.x", strings.NewReader(fmt.Sprintf(basicGoTmpl, "a")))
	f2 := parser.NewFile("b/b.x", strings.NewReader(fmt.Sprintf(basicGoTmpl, "b")))

	p := parser.New(f1, f2)
	boxes, err := p.Run()
	r.NoError(err)

	r.Len(boxes, 4)
}

func Test_NewFrom_Roots_Imports(t *testing.T) {
	r := require.New(t)
	store.Clean("./_fixtures")
	p, err := parser.NewFromRoots([]string{"./_fixtures/new_from_roots"}, &parser.RootsOptions{})
	r.NoError(err)

	boxes, err := p.Run()
	r.NoError(err)
	r.Len(boxes, 3)
}

func Test_NewFrom_Roots_Disk(t *testing.T) {
	r := require.New(t)
	oncer.Reset()
	store.Clean("./_fixtures")
	p, err := parser.NewFromRoots([]string{"./_fixtures/new_from_roots"}, &parser.RootsOptions{
		IgnoreImports: true,
	})
	r.NoError(err)

	boxes, err := p.Run()
	r.NoError(err)
	r.Len(boxes, 3)
}

const basicGoTmpl = `package %s

import "github.com/gobuffalo/packr/v2"

func init() {
	packr.New("elvis", "./presley")
	packr.NewBox("./buddy-holly")
}
`
