package packr

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gobuffalo/packd"
	"github.com/gobuffalo/packr/v2/file/resolver"
	"github.com/stretchr/testify/require"
)

var httpBox = func() packd.Box {
	box := New("http box", "")

	ind, err := resolver.HexGzipString("<h1>Index!</h1>")
	if err != nil {
		panic(err)
	}

	hello, err := resolver.HexGzipString("hello world!")
	if err != nil {
		panic(err)
	}

	hg, err := resolver.NewHexGzip(map[string]string{
		"index.html": ind,
		"hello.txt":  hello,
	})
	if err != nil {
		panic(err)
	}

	box.DefaultResolver = hg
	return box
}()

func Test_HTTPBox(t *testing.T) {
	r := require.New(t)

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(httpBox))

	req, err := http.NewRequest("GET", "/hello.txt", nil)
	r.NoError(err)

	res := httptest.NewRecorder()

	mux.ServeHTTP(res, req)

	r.Equal(200, res.Code)
	r.Equal("hello world!", strings.TrimSpace(res.Body.String()))
}

func Test_HTTPBox_NotFound(t *testing.T) {
	r := require.New(t)

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(httpBox))

	req, err := http.NewRequest("GET", "/notInBox.txt", nil)
	r.NoError(err)

	res := httptest.NewRecorder()

	mux.ServeHTTP(res, req)

	r.Equal(404, res.Code)
}

func Test_HTTPBox_Handles_IndexHTML(t *testing.T) {
	r := require.New(t)

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(httpBox))

	req, err := http.NewRequest("GET", "/", nil)
	r.NoError(err)

	res := httptest.NewRecorder()

	mux.ServeHTTP(res, req)

	r.Equal(200, res.Code)

	r.Equal("<h1>Index!</h1>", strings.TrimSpace(res.Body.String()))
}

func Test_HTTPBox_CaseInsensitive(t *testing.T) {
	mux := http.NewServeMux()
	httpBox.AddString("myfile.txt", "this is my file")
	mux.Handle("/", http.FileServer(httpBox))

	for _, path := range []string{"/MyFile.txt", "/myfile.txt", "/Myfile.txt"} {
		t.Run(path, func(st *testing.T) {
			r := require.New(st)

			req, err := http.NewRequest("GET", path, nil)
			r.NoError(err)

			res := httptest.NewRecorder()

			mux.ServeHTTP(res, req)

			r.Equal(200, res.Code)
			r.Equal("this is my file", strings.TrimSpace(res.Body.String()))
		})
	}
}
