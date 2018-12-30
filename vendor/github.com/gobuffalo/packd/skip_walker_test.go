package packd

import (
	"sort"
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_SkipWalker(t *testing.T) {
	r := require.New(t)

	box := NewMemoryBox()
	files := []string{
		"node_modules/foo.js",
		".idea/something",
		"main.go",
		"actions/app.go",
		"_example/foo.go",
		"_example/bar.go",
		"_EXAMPLE/bar.go",
		"actions/app_test.go",
		"/go/src/hello_world/node_modules/ejs/README.md",
		"/go/src/hello_world/NODE_MODULES/ejs/README.md",
	}

	for _, f := range files {
		box.AddString(f, f)
	}

	var found []string
	err := SkipWalker(box, CommonSkipPrefixes, func(path string, file File) error {
		found = append(found, path)
		return nil
	})

	r.NoError(err)
	r.Len(found, 3)

	sort.Strings(found)
	r.Equal([]string{"actions/app.go", "actions/app_test.go", "main.go"}, found)
}
