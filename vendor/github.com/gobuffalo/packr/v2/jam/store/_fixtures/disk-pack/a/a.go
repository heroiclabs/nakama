package a

import "github.com/gobuffalo/packr/v2"

func init() {
	packr.New("a-box", "../c")
}
