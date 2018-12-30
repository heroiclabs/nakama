package resolver

import "github.com/gobuffalo/packr/v2/file"

func qfile(name string, body string) file.File {
	f, err := file.NewFile(name, []byte(body))
	if err != nil {
		panic(err)
	}
	return f
}
