package b

import "github.com/gobuffalo/packr/v2"

func init() {
	packr.New("b-box", "../c")
	packr.New("cb-box", "../c")
}
