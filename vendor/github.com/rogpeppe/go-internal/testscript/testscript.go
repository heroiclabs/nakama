// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Script-driven tests.
// See testdata/script/README for an overview.

package testscript

import (
	"bytes"
	"flag"
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rogpeppe/go-internal/par"
	"github.com/rogpeppe/go-internal/testenv"
	"github.com/rogpeppe/go-internal/txtar"
)

var execCache par.Cache

// If -testwork is specified, the test prints the name of the temp directory
// and does not remove it when done, so that a programmer can
// poke at the test file tree afterward.
var testWork = flag.Bool("testwork", false, "")

// Env holds the environment to use at the start of a test script invocation.
type Env struct {
	WorkDir string
	Vars    []string
	Cd      string
}

// Params holds parameters for a call to Run.
type Params struct {
	// Dir holds the name of the directory holding the scripts.
	// All files in the directory with a .txt suffix will be considered
	// as test scripts. By default the current directory is used.
	// Dir is interpreted relative to the current test directory.
	Dir string

	// Setup is called, if not nil, to complete any setup required
	// for a test. The WorkDir and Vars fields will have already
	// been initialized, and Cd will be the same as WorkDir.
	// The Setup function may modify Vars and Cd as it wishes.
	Setup func(*Env) error

	// Condition is called, if not nil, to determine whether a particular
	// condition is true. It's called only for conditions not in the
	// standard set, and may be nil.
	Condition func(cond string) (bool, error)

	// Cmds holds a map of commands available to the script.
	// It will only be consulted for commands not part of the standard set.
	Cmds map[string]func(ts *TestScript, neg bool, args []string)

	// TestWork specifies that working directories should be
	// left intact for later inspection.
	TestWork bool

	// IgnoreMissedCoverage specifies that if coverage information
	// is being generated (with the -test.coverprofile flag) and a subcommand
	// function passed to RunMain fails to generate coverage information
	// (for example because the function invoked os.Exit), then the
	// error will be ignored.
	IgnoreMissedCoverage bool
}

// RunDir runs the tests in the given directory. All files in dir with a ".txt"
// are considered to be test files.
func Run(t *testing.T, p Params) {
	files, err := filepath.Glob(filepath.Join(p.Dir, "*.txt"))
	if err != nil {
		t.Fatal(err)
	}
	testTempDir, err := ioutil.TempDir(os.Getenv("GOTMPDIR"), "go-test-script")
	if err != nil {
		t.Fatal(err)
	}
	refCount := int32(len(files))
	for _, file := range files {
		file := file
		name := strings.TrimSuffix(filepath.Base(file), ".txt")
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			ts := &TestScript{
				t:           t,
				testTempDir: testTempDir,
				name:        name,
				file:        file,
				params:      p,
			}
			ts.setup()
			if !p.TestWork {
				defer func() {
					removeAll(ts.workdir)
					if atomic.AddInt32(&refCount, -1) == 0 {
						// This is the last subtest to finish. Remove the
						// parent directory too.
						os.Remove(testTempDir)
					}
				}()
			}
			ts.run()
		})
	}
}

// A TestScript holds execution state for a single test script.
type TestScript struct {
	params      Params
	t           *testing.T
	testTempDir string
	workdir     string            // temporary work dir ($WORK)
	log         bytes.Buffer      // test execution log (printed at end of test)
	mark        int               // offset of next log truncation
	cd          string            // current directory during test execution; initially $WORK/gopath/src
	name        string            // short name of test ("foo")
	file        string            // full file name ("testdata/script/foo.txt")
	lineno      int               // line number currently executing
	line        string            // line currently executing
	env         []string          // environment list (for os/exec)
	envMap      map[string]string // environment mapping (matches env)
	stdout      string            // standard output from last 'go' command; for 'stdout' command
	stderr      string            // standard error from last 'go' command; for 'stderr' command
	stopped     bool              // test wants to stop early
	start       time.Time         // time phase started
}

// setup sets up the test execution temporary directory and environment.
func (ts *TestScript) setup() {
	ts.workdir = filepath.Join(ts.testTempDir, "script-"+ts.name)
	ts.Check(os.MkdirAll(filepath.Join(ts.workdir, "tmp"), 0777))
	env := &Env{
		Vars: []string{
			"WORK=" + ts.workdir, // must be first for ts.abbrev
			"PATH=" + os.Getenv("PATH"),
			homeEnvName() + "=/no-home",
			tempEnvName() + "=" + filepath.Join(ts.workdir, "tmp"),
			"devnull=" + os.DevNull,
			":=" + string(os.PathListSeparator),
		},
		WorkDir: ts.workdir,
		Cd:      ts.workdir,
	}
	if ts.params.Setup != nil {
		ts.Check(ts.params.Setup(env))
	}
	ts.cd = env.Cd
	ts.env = env.Vars

	ts.envMap = make(map[string]string)
	for _, kv := range ts.env {
		if i := strings.Index(kv, "="); i >= 0 {
			ts.envMap[kv[:i]] = kv[i+1:]
		}
	}
}

// run runs the test script.
func (ts *TestScript) run() {
	// Truncate log at end of last phase marker,
	// discarding details of successful phase.
	rewind := func() {
		if !testing.Verbose() {
			ts.log.Truncate(ts.mark)
		}
	}

	// Insert elapsed time for phase at end of phase marker
	markTime := func() {
		if ts.mark > 0 && !ts.start.IsZero() {
			afterMark := append([]byte{}, ts.log.Bytes()[ts.mark:]...)
			ts.log.Truncate(ts.mark - 1) // cut \n and afterMark
			fmt.Fprintf(&ts.log, " (%.3fs)\n", time.Since(ts.start).Seconds())
			ts.log.Write(afterMark)
		}
		ts.start = time.Time{}
	}

	defer func() {
		markTime()
		// Flush testScript log to testing.T log.
		ts.t.Log("\n" + ts.abbrev(ts.log.String()))
	}()

	// Unpack archive.
	a, err := txtar.ParseFile(ts.file)
	ts.Check(err)
	for _, f := range a.Files {
		name := ts.MkAbs(ts.expand(f.Name))
		ts.Check(os.MkdirAll(filepath.Dir(name), 0777))
		ts.Check(ioutil.WriteFile(name, f.Data, 0666))
	}

	// With -v or -testwork, start log with full environment.
	if *testWork || testing.Verbose() {
		// Display environment.
		ts.cmdEnv(false, nil)
		fmt.Fprintf(&ts.log, "\n")
		ts.mark = ts.log.Len()
	}

	// Run script.
	// See testdata/script/README for documentation of script form.
	script := string(a.Comment)
Script:
	for script != "" {
		// Extract next line.
		ts.lineno++
		var line string
		if i := strings.Index(script, "\n"); i >= 0 {
			line, script = script[:i], script[i+1:]
		} else {
			line, script = script, ""
		}

		// # is a comment indicating the start of new phase.
		if strings.HasPrefix(line, "#") {
			// If there was a previous phase, it succeeded,
			// so rewind the log to delete its details (unless -v is in use).
			// If nothing has happened at all since the mark,
			// rewinding is a no-op and adding elapsed time
			// for doing nothing is meaningless, so don't.
			if ts.log.Len() > ts.mark {
				rewind()
				markTime()
			}
			// Print phase heading and mark start of phase output.
			fmt.Fprintf(&ts.log, "%s\n", line)
			ts.mark = ts.log.Len()
			ts.start = time.Now()
			continue
		}

		// Parse input line. Ignore blanks entirely.
		args := ts.parse(line)
		if len(args) == 0 {
			continue
		}

		// Echo command to log.
		fmt.Fprintf(&ts.log, "> %s\n", line)

		// Command prefix [cond] means only run this command if cond is satisfied.
		for strings.HasPrefix(args[0], "[") && strings.HasSuffix(args[0], "]") {
			cond := args[0]
			cond = cond[1 : len(cond)-1]
			cond = strings.TrimSpace(cond)
			args = args[1:]
			if len(args) == 0 {
				ts.Fatalf("missing command after condition")
			}
			want := true
			if strings.HasPrefix(cond, "!") {
				want = false
				cond = strings.TrimSpace(cond[1:])
			}
			ok, err := ts.condition(cond)
			if err != nil {
				ts.Fatalf("bad condition %q: %v", cond, err)
			}
			if ok != want {
				// Don't run rest of line.
				continue Script
			}
		}

		// Command prefix ! means negate the expectations about this command:
		// go command should fail, match should not be found, etc.
		neg := false
		if args[0] == "!" {
			neg = true
			args = args[1:]
			if len(args) == 0 {
				ts.Fatalf("! on line by itself")
			}
		}

		// Run command.
		cmd := scriptCmds[args[0]]
		if cmd == nil {
			cmd = ts.params.Cmds[args[0]]
		}
		if cmd == nil {
			ts.Fatalf("unknown command %q", args[0])
		}
		cmd(ts, neg, args[1:])

		// Command can ask script to stop early.
		if ts.stopped {
			return
		}
	}

	// Final phase ended.
	rewind()
	markTime()
	fmt.Fprintf(&ts.log, "PASS\n")
}

// condition reports whether the given condition is satisfied.
func (ts *TestScript) condition(cond string) (bool, error) {
	switch cond {
	case "short":
		return testing.Short(), nil
	case "net":
		return testenv.HasExternalNetwork(), nil
	case "link":
		return testenv.HasLink(), nil
	case "symlink":
		return testenv.HasSymlink(), nil
	default:
		if strings.HasPrefix(cond, "exec:") {
			prog := cond[len("exec:"):]
			ok := execCache.Do(prog, func() interface{} {
				_, err := exec.LookPath(prog)
				return err == nil
			}).(bool)
			return ok, nil
		}
		if ts.params.Condition != nil {
			return ts.params.Condition(cond)
		}
		ts.Fatalf("unknown condition %q", cond)
		panic("unreachable")
	}
}

// Helpers for command implementations.

// abbrev abbreviates the actual work directory in the string s to the literal string "$WORK".
func (ts *TestScript) abbrev(s string) string {
	s = strings.Replace(s, ts.workdir, "$WORK", -1)
	if *testWork {
		// Expose actual $WORK value in environment dump on first line of work script,
		// so that the user can find out what directory -testwork left behind.
		s = "WORK=" + ts.workdir + "\n" + strings.TrimPrefix(s, "WORK=$WORK\n")
	}
	return s
}

// Check calls ts.Fatalf if err != nil.
func (ts *TestScript) Check(err error) {
	if err != nil {
		ts.Fatalf("%v", err)
	}
}

// Logf appends the given formatted message to the test log transcript.
func (ts *TestScript) Logf(format string, args ...interface{}) {
	format = strings.TrimSuffix(format, "\n")
	fmt.Fprintf(&ts.log, format, args...)
	ts.log.WriteByte('\n')
}

// exec runs the given command line (an actual subprocess, not simulated)
// in ts.cd with environment ts.env and then returns collected standard output and standard error.
func (ts *TestScript) exec(command string, args ...string) (stdout, stderr string, err error) {
	cmd := exec.Command(command, args...)
	cmd.Dir = ts.cd
	cmd.Env = append(ts.env, "PWD="+ts.cd)
	var stdoutBuf, stderrBuf strings.Builder
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	err = cmd.Run()
	return stdoutBuf.String(), stderrBuf.String(), err
}

// Exec runs the given command and saves its stdout and stderr so
// they can be inspected by subsequent script commands.
func (ts *TestScript) Exec(command string, args ...string) error {
	var err error
	ts.stdout, ts.stderr, err = ts.exec(command, args...)
	if ts.stdout != "" {
		ts.Logf("[stdout]\n%s", ts.stdout)
	}
	if ts.stderr != "" {
		ts.Logf("[stderr]\n%s", ts.stderr)
	}
	return err
}

// expand applies environment variable expansion to the string s.
func (ts *TestScript) expand(s string) string {
	return os.Expand(s, func(key string) string { return ts.envMap[key] })
}

// fatalf aborts the test with the given failure message.
func (ts *TestScript) Fatalf(format string, args ...interface{}) {
	fmt.Fprintf(&ts.log, "FAIL: %s:%d: %s\n", ts.file, ts.lineno, fmt.Sprintf(format, args...))
	ts.t.FailNow()
}

// MkAbs interprets file relative to the test script's current directory
// and returns the corresponding absolute path.
func (ts *TestScript) MkAbs(file string) string {
	if filepath.IsAbs(file) {
		return file
	}
	return filepath.Join(ts.cd, file)
}

// parse parses a single line as a list of space-separated arguments
// subject to environment variable expansion (but not resplitting).
// Single quotes around text disable splitting and expansion.
// To embed a single quote, double it: 'Don''t communicate by sharing memory.'
func (ts *TestScript) parse(line string) []string {
	ts.line = line

	var (
		args   []string
		arg    string  // text of current arg so far (need to add line[start:i])
		start  = -1    // if >= 0, position where current arg text chunk starts
		quoted = false // currently processing quoted text
	)
	for i := 0; ; i++ {
		if !quoted && (i >= len(line) || line[i] == ' ' || line[i] == '\t' || line[i] == '\r' || line[i] == '#') {
			// Found arg-separating space.
			if start >= 0 {
				arg += ts.expand(line[start:i])
				args = append(args, arg)
				start = -1
				arg = ""
			}
			if i >= len(line) || line[i] == '#' {
				break
			}
			continue
		}
		if i >= len(line) {
			ts.Fatalf("unterminated quoted argument")
		}
		if line[i] == '\'' {
			if !quoted {
				// starting a quoted chunk
				if start >= 0 {
					arg += ts.expand(line[start:i])
				}
				start = i + 1
				quoted = true
				continue
			}
			// 'foo''bar' means foo'bar, like in rc shell and Pascal.
			if i+1 < len(line) && line[i+1] == '\'' {
				arg += line[start:i]
				start = i + 1
				i++ // skip over second ' before next iteration
				continue
			}
			// ending a quoted chunk
			arg += line[start:i]
			start = i + 1
			quoted = false
			continue
		}
		// found character worth saving; make sure we're saving
		if start < 0 {
			start = i
		}
	}
	return args
}

// diff returns a formatted diff of the two texts,
// showing the entire text and the minimum line-level
// additions and removals to turn text1 into text2.
// (That is, lines only in text1 appear with a leading -,
// and lines only in text2 appear with a leading +.)
func diff(text1, text2 string) string {
	if text1 != "" && !strings.HasSuffix(text1, "\n") {
		text1 += "(missing final newline)"
	}
	lines1 := strings.Split(text1, "\n")
	lines1 = lines1[:len(lines1)-1] // remove empty string after final line
	if text2 != "" && !strings.HasSuffix(text2, "\n") {
		text2 += "(missing final newline)"
	}
	lines2 := strings.Split(text2, "\n")
	lines2 = lines2[:len(lines2)-1] // remove empty string after final line

	// Naive dynamic programming algorithm for edit distance.
	// https://en.wikipedia.org/wiki/Wagner–Fischer_algorithm
	// dist[i][j] = edit distance between lines1[:len(lines1)-i] and lines2[:len(lines2)-j]
	// (The reversed indices make following the minimum cost path
	// visit lines in the same order as in the text.)
	dist := make([][]int, len(lines1)+1)
	for i := range dist {
		dist[i] = make([]int, len(lines2)+1)
		if i == 0 {
			for j := range dist[0] {
				dist[0][j] = j
			}
			continue
		}
		for j := range dist[i] {
			if j == 0 {
				dist[i][0] = i
				continue
			}
			cost := dist[i][j-1] + 1
			if cost > dist[i-1][j]+1 {
				cost = dist[i-1][j] + 1
			}
			if lines1[len(lines1)-i] == lines2[len(lines2)-j] {
				if cost > dist[i-1][j-1] {
					cost = dist[i-1][j-1]
				}
			}
			dist[i][j] = cost
		}
	}

	var buf strings.Builder
	i, j := len(lines1), len(lines2)
	for i > 0 || j > 0 {
		cost := dist[i][j]
		if i > 0 && j > 0 && cost == dist[i-1][j-1] && lines1[len(lines1)-i] == lines2[len(lines2)-j] {
			fmt.Fprintf(&buf, " %s\n", lines1[len(lines1)-i])
			i--
			j--
		} else if i > 0 && cost == dist[i-1][j]+1 {
			fmt.Fprintf(&buf, "-%s\n", lines1[len(lines1)-i])
			i--
		} else {
			fmt.Fprintf(&buf, "+%s\n", lines2[len(lines2)-j])
			j--
		}
	}
	return buf.String()
}

func removeAll(dir string) error {
	// module cache has 0444 directories;
	// make them writable in order to remove content.
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // ignore errors walking in file system
		}
		if info.IsDir() {
			os.Chmod(path, 0777)
		}
		return nil
	})
	return os.RemoveAll(dir)
}

func homeEnvName() string {
	switch runtime.GOOS {
	case "windows":
		return "USERPROFILE"
	case "plan9":
		return "home"
	default:
		return "HOME"
	}
}

func tempEnvName() string {
	switch runtime.GOOS {
	case "windows":
		return "TMP"
	case "plan9":
		return "TMPDIR" // actually plan 9 doesn't have one at all but this is fine
	default:
		return "TMPDIR"
	}
}
