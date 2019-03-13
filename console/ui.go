package console

import (
	"net/http"

	"github.com/gobuffalo/packr"
)

func Handler() http.Handler {
	uiBox := packr.NewBox("./ui/build") // path must be string not a variable for packr to understand
	return http.FileServer(uiBox)
}
