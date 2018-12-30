package store

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

var goPath = filepath.Join(os.Getenv("HOME"), "go")

func init() {
	var once sync.Once
	once.Do(func() {
		cmd := exec.Command("go", "env", "GOPATH")
		b, err := cmd.CombinedOutput()
		if err != nil {
			return
		}
		goPath = strings.TrimSpace(string(b))
	})
}

// GoPath returns the current GOPATH env var
// or if it's missing, the default.
func GoPath() string {
	return goPath
}

// GoBin returns the current GO_BIN env var
// or if it's missing, a default of "go"
func GoBin() string {
	go_bin := os.Getenv("GO_BIN")
	if go_bin == "" {
		return "go"
	}
	return go_bin
}
