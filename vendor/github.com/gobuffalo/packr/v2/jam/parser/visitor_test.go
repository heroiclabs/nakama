package parser

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_Visitor(t *testing.T) {
	r := require.New(t)
	v := NewVisitor(NewFile("example/example.go", strings.NewReader(example)))

	boxes, err := v.Run()
	r.NoError(err)

	r.Equal("example", v.Package)
	r.Len(v.errors, 0)

	var act []string
	for _, b := range boxes {
		act = append(act, b.Name)
	}

	exp := []string{"./assets", "./bar", "./constant", "./foo", "./sf", "./templates", "./variable", "beatles"}
	r.Len(act, len(exp))
	r.Equal(exp, act)
}

const example = `package example

import (
	"github.com/gobuffalo/packr/v2"
)

var a = packr.NewBox("./foo")
var pw = packr.New("beatles", "./paperback-writer")

const constString = "./constant"

type S struct{}

func (S) f(packr.Box) {}

func init() {
	// packr.NewBox("../idontexists")

	b := "./variable"
	packr.NewBox(b)

	packr.New("beatles", "./day-tripper")

	packr.NewBox(constString)

	// Cannot work from a function
	packr.NewBox(strFromFunc())

	// This variable should not be added
	fromFunc := strFromFunc()
	packr.NewBox(fromFunc)

	foo("/templates", packr.NewBox("./templates"))
	packr.NewBox("./assets")

	packr.NewBox("./bar")

	s := S{}
	s.f(packr.NewBox("./sf"))
}

func strFromFunc() string {
	return "./fromFunc"
}

func foo(s string, box packr.Box) {}
`
