// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package testscript

import (
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// scriptCmds are the script command implementations.
// Keep list and the implementations below sorted by name.
//
// NOTE: If you make changes here, update doc.go.
//
var scriptCmds = map[string]func(*TestScript, bool, []string){
	"cd":      (*TestScript).cmdCd,
	"chmod":   (*TestScript).cmdChmod,
	"cmp":     (*TestScript).cmdCmp,
	"cp":      (*TestScript).cmdCp,
	"env":     (*TestScript).cmdEnv,
	"exec":    (*TestScript).cmdExec,
	"exists":  (*TestScript).cmdExists,
	"grep":    (*TestScript).cmdGrep,
	"mkdir":   (*TestScript).cmdMkdir,
	"rm":      (*TestScript).cmdRm,
	"skip":    (*TestScript).cmdSkip,
	"stderr":  (*TestScript).cmdStderr,
	"stdout":  (*TestScript).cmdStdout,
	"stop":    (*TestScript).cmdStop,
	"symlink": (*TestScript).cmdSymlink,
}

// cd changes to a different directory.
func (ts *TestScript) cmdCd(neg bool, args []string) {
	if neg {
		ts.Fatalf("unsupported: ! cd")
	}
	if len(args) != 1 {
		ts.Fatalf("usage: cd dir")
	}

	dir := args[0]
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(ts.cd, dir)
	}
	info, err := os.Stat(dir)
	if os.IsNotExist(err) {
		ts.Fatalf("directory %s does not exist", dir)
	}
	ts.Check(err)
	if !info.IsDir() {
		ts.Fatalf("%s is not a directory", dir)
	}
	ts.cd = dir
	ts.Logf("%s\n", ts.cd)
}

func (ts *TestScript) cmdChmod(neg bool, args []string) {
	if len(args) != 2 {
		ts.Fatalf("usage: chmod mode file")
	}
	mode, err := strconv.ParseInt(args[0], 8, 32)
	if err != nil {
		ts.Fatalf("bad file mode %q: %v", args[0], err)
	}
	if mode > 0777 {
		ts.Fatalf("unsupported file mode %.3o", mode)
	}
	err = os.Chmod(ts.MkAbs(args[1]), os.FileMode(mode))
	if neg {
		if err == nil {
			ts.Fatalf("unexpected chmod success")
		}
		return
	}
	if err != nil {
		ts.Fatalf("unexpected chmod failure: %v", err)
	}
}

// cmp compares two files.
func (ts *TestScript) cmdCmp(neg bool, args []string) {
	if neg {
		// It would be strange to say "this file can have any content except this precise byte sequence".
		ts.Fatalf("unsupported: ! cmp")
	}
	if len(args) != 2 {
		ts.Fatalf("usage: cmp file1 file2")
	}

	name1, name2 := args[0], args[1]
	var text1, text2 string
	if name1 == "stdout" {
		text1 = ts.stdout
	} else if name1 == "stderr" {
		text1 = ts.stderr
	} else {
		data, err := ioutil.ReadFile(ts.MkAbs(name1))
		ts.Check(err)
		text1 = string(data)
	}

	data, err := ioutil.ReadFile(ts.MkAbs(name2))
	ts.Check(err)
	text2 = string(data)

	if text1 == text2 {
		return
	}

	ts.Logf("[diff -%s +%s]\n%s\n", name1, name2, diff(text1, text2))
	ts.Fatalf("%s and %s differ", name1, name2)
}

// cp copies files, maybe eventually directories.
func (ts *TestScript) cmdCp(neg bool, args []string) {
	if neg {
		ts.Fatalf("unsupported: ! cp")
	}
	if len(args) < 2 {
		ts.Fatalf("usage: cp src... dst")
	}

	dst := ts.MkAbs(args[len(args)-1])
	info, err := os.Stat(dst)
	dstDir := err == nil && info.IsDir()
	if len(args) > 2 && !dstDir {
		ts.Fatalf("cp: destination %s is not a directory", dst)
	}

	for _, arg := range args[:len(args)-1] {
		src := ts.MkAbs(arg)
		info, err := os.Stat(src)
		ts.Check(err)
		data, err := ioutil.ReadFile(src)
		ts.Check(err)
		targ := dst
		if dstDir {
			targ = filepath.Join(dst, filepath.Base(src))
		}
		ts.Check(ioutil.WriteFile(targ, data, info.Mode()&0777))
	}
}

// env displays or adds to the environment.
func (ts *TestScript) cmdEnv(neg bool, args []string) {
	if neg {
		ts.Fatalf("unsupported: ! env")
	}
	if len(args) == 0 {
		printed := make(map[string]bool) // env list can have duplicates; only print effective value (from envMap) once
		for _, kv := range ts.env {
			k := kv[:strings.Index(kv, "=")]
			if !printed[k] {
				ts.Logf("%s=%s\n", k, ts.envMap[k])
			}
		}
		return
	}
	for _, env := range args {
		i := strings.Index(env, "=")
		if i < 0 {
			// Display value instead of setting it.
			ts.Logf("%s=%s\n", env, ts.envMap[env])
			continue
		}
		ts.env = append(ts.env, env)
		ts.envMap[env[:i]] = env[i+1:]
	}
}

// exec runs the given command.
func (ts *TestScript) cmdExec(neg bool, args []string) {
	if len(args) < 1 {
		ts.Fatalf("usage: exec program [args...]")
	}
	err := ts.Exec(args[0], args[1:]...)
	if err != nil {
		ts.Logf("[%v]\n", err)
		if !neg {
			ts.Fatalf("unexpected command failure")
		}
	} else {
		if neg {
			ts.Fatalf("unexpected command success")
		}
	}
}

// exists checks that the list of files exists.
func (ts *TestScript) cmdExists(neg bool, args []string) {
	var readonly bool
	if len(args) > 0 && args[0] == "-readonly" {
		readonly = true
		args = args[1:]
	}
	if len(args) == 0 {
		ts.Fatalf("usage: exists [-readonly] file...")
	}

	for _, file := range args {
		file = ts.MkAbs(file)
		info, err := os.Stat(file)
		if err == nil && neg {
			what := "file"
			if info.IsDir() {
				what = "directory"
			}
			ts.Fatalf("%s %s unexpectedly exists", what, file)
		}
		if err != nil && !neg {
			ts.Fatalf("%s does not exist", file)
		}
		if err == nil && !neg && readonly && info.Mode()&0222 != 0 {
			ts.Fatalf("%s exists but is writable", file)
		}
	}
}

// mkdir creates directories.
func (ts *TestScript) cmdMkdir(neg bool, args []string) {
	if neg {
		ts.Fatalf("unsupported: ! mkdir")
	}
	if len(args) < 1 {
		ts.Fatalf("usage: mkdir dir...")
	}
	for _, arg := range args {
		ts.Check(os.MkdirAll(ts.MkAbs(arg), 0777))
	}
}

// rm removes files or directories.
func (ts *TestScript) cmdRm(neg bool, args []string) {
	if neg {
		ts.Fatalf("unsupported: ! rm")
	}
	if len(args) < 1 {
		ts.Fatalf("usage: rm file...")
	}
	for _, arg := range args {
		file := ts.MkAbs(arg)
		removeAll(file)              // does chmod and then attempts rm
		ts.Check(os.RemoveAll(file)) // report error
	}
}

// skip marks the test skipped.
func (ts *TestScript) cmdSkip(neg bool, args []string) {
	if len(args) > 1 {
		ts.Fatalf("usage: skip [msg]")
	}
	if neg {
		ts.Fatalf("unsupported: ! skip")
	}
	if len(args) == 1 {
		ts.t.Skip(args[0])
	}
	ts.t.Skip()
}

// stdout checks that the last go command standard output matches a regexp.
func (ts *TestScript) cmdStdout(neg bool, args []string) {
	scriptMatch(ts, neg, args, ts.stdout, "stdout")
}

// stderr checks that the last go command standard output matches a regexp.
func (ts *TestScript) cmdStderr(neg bool, args []string) {
	scriptMatch(ts, neg, args, ts.stderr, "stderr")
}

// grep checks that file content matches a regexp.
// Like stdout/stderr and unlike Unix grep, it accepts Go regexp syntax.
func (ts *TestScript) cmdGrep(neg bool, args []string) {
	scriptMatch(ts, neg, args, "", "grep")
}

// stop stops execution of the test (marking it passed).
func (ts *TestScript) cmdStop(neg bool, args []string) {
	if neg {
		ts.Fatalf("unsupported: ! stop")
	}
	if len(args) > 1 {
		ts.Fatalf("usage: stop [msg]")
	}
	if len(args) == 1 {
		ts.Logf("stop: %s\n", args[0])
	} else {
		ts.Logf("stop\n")
	}
	ts.stopped = true
}

// symlink creates a symbolic link.
func (ts *TestScript) cmdSymlink(neg bool, args []string) {
	if neg {
		ts.Fatalf("unsupported: ! symlink")
	}
	if len(args) != 3 || args[1] != "->" {
		ts.Fatalf("usage: symlink file -> target")
	}
	// Note that the link target args[2] is not interpreted with MkAbs:
	// it will be interpreted relative to the directory file is in.
	ts.Check(os.Symlink(args[2], ts.MkAbs(args[0])))
}

// scriptMatch implements both stdout and stderr.
func scriptMatch(ts *TestScript, neg bool, args []string, text, name string) {
	n := 0
	if len(args) >= 1 && strings.HasPrefix(args[0], "-count=") {
		if neg {
			ts.Fatalf("cannot use -count= with negated match")
		}
		var err error
		n, err = strconv.Atoi(args[0][len("-count="):])
		if err != nil {
			ts.Fatalf("bad -count=: %v", err)
		}
		if n < 1 {
			ts.Fatalf("bad -count=: must be at least 1")
		}
		args = args[1:]
	}

	extraUsage := ""
	want := 1
	if name == "grep" {
		extraUsage = " file"
		want = 2
	}
	if len(args) != want {
		ts.Fatalf("usage: %s [-count=N] 'pattern'%s", name, extraUsage)
	}

	pattern := args[0]
	re, err := regexp.Compile(`(?m)` + pattern)
	ts.Check(err)

	isGrep := name == "grep"
	if isGrep {
		name = args[1] // for error messages
		data, err := ioutil.ReadFile(ts.MkAbs(args[1]))
		ts.Check(err)
		text = string(data)
	}

	if neg {
		if re.MatchString(text) {
			if isGrep {
				ts.Logf("[%s]\n%s\n", name, text)
			}
			ts.Fatalf("unexpected match for %#q found in %s: %s", pattern, name, re.FindString(text))
		}
	} else {
		if !re.MatchString(text) {
			if isGrep {
				ts.Logf("[%s]\n%s\n", name, text)
			}
			ts.Fatalf("no match for %#q found in %s", pattern, name)
		}
		if n > 0 {
			count := len(re.FindAllString(text, -1))
			if count != n {
				if isGrep {
					ts.Logf("[%s]\n%s\n", name, text)
				}
				ts.Fatalf("have %d matches for %#q, want %d", count, pattern, n)
			}
		}
	}
}
