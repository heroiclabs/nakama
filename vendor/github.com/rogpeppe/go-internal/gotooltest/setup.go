// Copyright 2015 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package gotooltest implements functionality useful for testing
// tools that use the go command.
package gotooltest

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/rogpeppe/go-internal/imports"
	"github.com/rogpeppe/go-internal/testscript"
)

type testContext struct {
	goroot  string
	gocache string
}

// Setup sets up the given test environment for tests that use the go
// command. It adds support for go tags to p.Condition and adds the go
// command to p.Cmds. It also wraps p.Setup to set up the environment
// variables for running the go command appropriately.
//
// It checks go command can run, but not that it can build or run
// binaries.
func Setup(p *testscript.Params) error {
	var c testContext
	if err := c.init(); err != nil {
		return err
	}
	origSetup := p.Setup
	p.Setup = func(e *testscript.Env) error {
		e.Vars = c.goEnviron(e.Vars)
		if origSetup != nil {
			return origSetup(e)
		}
		return nil
	}
	if p.Cmds == nil {
		p.Cmds = make(map[string]func(ts *testscript.TestScript, neg bool, args []string))
	}
	p.Cmds["go"] = cmdGo
	origCondition := p.Condition
	p.Condition = func(cond string) (bool, error) {
		switch cond {
		case runtime.GOOS, runtime.GOARCH, runtime.Compiler:
			return true, nil
		default:
			if imports.KnownArch[cond] || imports.KnownOS[cond] || cond == "gc" || cond == "gccgo" {
				return false, nil
			}
		}
		if origCondition == nil {
			return false, fmt.Errorf("unknown condition %q", cond)
		}
		return origCondition(cond)
	}
	return nil
}

func (c *testContext) init() error {
	goEnv := func(name string) (string, error) {
		out, err := exec.Command("go", "env", name).CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("go env %s: %v (%s)", name, err, out)
		}
		return strings.TrimSpace(string(out)), nil
	}
	var err error
	c.goroot, err = goEnv("GOROOT")
	if err != nil {
		return err
	}
	c.gocache, err = goEnv("GOCACHE")
	if err != nil {
		return err
	}
	return nil
}

func (c *testContext) goEnviron(env0 []string) []string {
	env := environ(env0)
	workdir := env.get("WORK")
	return append(env, []string{
		"GOPATH=" + filepath.Join(workdir, "gopath"),
		"CCACHE_DISABLE=1", // ccache breaks with non-existent HOME
		"GOARCH=" + runtime.GOARCH,
		"GOOS=" + runtime.GOOS,
		"GOROOT=" + c.goroot,
		"GOCACHE=" + c.gocache,
	}...)
}

func cmdGo(ts *testscript.TestScript, neg bool, args []string) {
	if len(args) < 1 {
		ts.Fatalf("usage: go subcommand ...")
	}
	err := ts.Exec("go", args...)
	if err != nil {
		ts.Logf("[%v]\n", err)
		if !neg {
			ts.Fatalf("unexpected go command failure")
		}
	} else {
		if neg {
			ts.Fatalf("unexpected go command success")
		}
	}
}

type environ []string

func (e0 *environ) get(name string) string {
	e := *e0
	for i := len(e) - 1; i >= 0; i-- {
		v := e[i]
		if len(v) <= len(name) {
			continue
		}
		if strings.HasPrefix(v, name) && v[len(name)] == '=' {
			return v[len(name)+1:]
		}
	}
	return ""
}

func (e *environ) set(name, val string) {
	*e = append(*e, name+"="+val)
}

func (e *environ) unset(name string) {
	// TODO actually remove the name from the environment.
	e.set(name, "")
}
