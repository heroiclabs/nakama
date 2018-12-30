package builder

import (
	"bytes"
	"context"
	"io/ioutil"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_Builder_Run(t *testing.T) {
	r := require.New(t)

	root := filepath.Join("..", "example")
	Clean(root)
	defer Clean(root)

	exPackr := filepath.Join(root, "a_example-packr.go")

	fooPackr := filepath.Join(root, "foo", "a_foo-packr.go")

	b := New(context.Background(), root)
	err := b.Run()
	r.NoError(err)

	r.True(fileExists(exPackr))
	r.True(fileExists(fooPackr))

	bb, err := ioutil.ReadFile(exPackr)
	r.NoError(err)
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("./assets", "app.css", "\"Ym9ke`)))
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("./assets", "app.js", "\"YWxlcn`)))
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("./templates", "index.html", "\"PCFET0NUWVBF`)))

	bb, err = ioutil.ReadFile(fooPackr)
	r.NoError(err)
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("../assets", "app.css", "\"Ym9keS`)))
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("../assets", "app.js", "\"YWxlcn`)))
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("../templates", "index.html", "\"PCFET0NUW`)))
}

func Test_Builder_Run_Compress(t *testing.T) {
	r := require.New(t)

	root := filepath.Join("..", "example")
	defer Clean(root)

	exPackr := filepath.Join(root, "a_example-packr.go")

	fooPackr := filepath.Join(root, "foo", "a_foo-packr.go")

	b := New(context.Background(), root)
	b.Compress = true
	err := b.Run()
	r.NoError(err)

	r.True(fileExists(exPackr))
	r.True(fileExists(fooPackr))

	bb, err := ioutil.ReadFile(exPackr)
	r.NoError(err)
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("./assets", "app.css", "\"H4sIAAAAAAAA/0rKT`)))
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("./assets", "app.js", "\"H4sIAAAAAAAA/0rMSS`)))

	bb, err = ioutil.ReadFile(fooPackr)
	r.NoError(err)
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("../assets", "app.css", "\"H4sIAAAAAAAA/0rKT`)))
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("../assets", "app.js", "\"H4sIAAAAAAAA/0rMSS`)))
	r.True(bytes.Contains(bb, []byte(`packr.PackJSONBytes("../templates", "index.html", "\"H4sIAAAAAAAA`)))
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
