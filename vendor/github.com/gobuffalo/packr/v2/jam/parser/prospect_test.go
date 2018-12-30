package parser

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_IsProspect(t *testing.T) {
	table := []struct {
		path string
		pass bool
	}{
		{"foo/.git/config", false},
		{"foo/.git/baz.go", false},
		{"a.go", true},
		{".", true},
		{"a/b.go", true},
		{"a/b_test.go", false},
		{"a/b-packr.go", false},
		{"a/vendor/b.go", false},
		{"a/_c/c.go", false},
		{"a/_c/e/fe/f/c.go", false},
		{"a/d/_d.go", false},
		{"a/d/", false},
	}

	for _, tt := range table {
		t.Run(tt.path, func(st *testing.T) {
			r := require.New(st)
			if tt.pass {
				r.True(IsProspect(tt.path, ".", "_"))
			} else {
				r.False(IsProspect(tt.path, ".", "_"))
			}
		})
	}
}
