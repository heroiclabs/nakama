package q

import "github.com/gobuffalo/packr/v2"

func init() {
	packr.New("tom", "./petty")
	packr.NewBox("../e/heartbreakers")
}
