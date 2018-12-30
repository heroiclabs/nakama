package cmd

import (
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gobuffalo/genny"
	"github.com/gobuffalo/packr/v2/plog"
	"github.com/pkg/errors"
)

func goCmd(name string, args ...string) error {
	cargs := []string{name}
	cargs = append(cargs, args...)
	if len(args) > 0 {
		err := func() error {
			path := "."

			pwd, err := os.Getwd()
			if err != nil {
				return errors.WithStack(err)
			}

			if fi, err := os.Stat(filepath.Join(pwd, args[len(args)-1])); err == nil {
				if fi.IsDir() {
					return nil
				}
				path = fi.Name()
			}

			if filepath.Ext(path) != ".go" {
				return nil
			}

			path, err = filepath.Abs(filepath.Dir(path))
			if err != nil {
				return errors.WithStack(err)
			}

			files, err := ioutil.ReadDir(path)
			if err != nil {
				return errors.WithStack(err)
			}
			for _, f := range files {
				if strings.HasSuffix(f.Name(), "-packr.go") {
					cargs = append(cargs, f.Name())
				}
			}
			return nil
		}()
		if err != nil {
			return errors.WithStack(err)
		}
	}
	cp := exec.Command(genny.GoBin(), cargs...)
	plog.Logger.Debug(strings.Join(cp.Args, " "))
	cp.Stderr = os.Stderr
	cp.Stdin = os.Stdin
	cp.Stdout = os.Stdout
	return cp.Run()
}
