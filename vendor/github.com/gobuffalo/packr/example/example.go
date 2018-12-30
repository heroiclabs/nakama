package example

import (
	"github.com/gobuffalo/packr"
)

var a = packr.NewBox("./foo")

const constString = "./constant"

type S struct{}

func (S) f(packr.Box) {}

func init() {

	b := "./variable"
	packr.NewBox(b)

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
