package packr

import (
	"github.com/gobuffalo/envy"
)

// GoPath returns the current GOPATH env var
// or if it's missing, the default.
var GoPath = envy.GoPath

// GoBin returns the current GO_BIN env var
// or if it's missing, a default of "go"
var GoBin = envy.GoBin
