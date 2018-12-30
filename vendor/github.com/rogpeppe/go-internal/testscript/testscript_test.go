// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package testscript

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
)

func printArgs() int {
	fmt.Printf("%q\n", os.Args)
	return 0
}

func exitWithStatus() int {
	n, _ := strconv.Atoi(os.Args[1])
	return n
}

func TestMain(m *testing.M) {
	os.Exit(RunMain(m, map[string]func() int{
		"printargs": printArgs,
		"status":    exitWithStatus,
	}))
}

func TestSimple(t *testing.T) {
	// TODO set temp directory.
	Run(t, Params{
		Dir: "scripts",
	})
	// TODO check that the temp directory has been removed.
}

var diffTests = []struct {
	text1 string
	text2 string
	diff  string
}{
	{"a b c", "a b d e f", "a b -c +d +e +f"},
	{"", "a b c", "+a +b +c"},
	{"a b c", "", "-a -b -c"},
	{"a b c", "d e f", "-a -b -c +d +e +f"},
	{"a b c d e f", "a b d e f", "a b -c d e f"},
	{"a b c e f", "a b c d e f", "a b c +d e f"},
}

func TestDiff(t *testing.T) {
	for _, tt := range diffTests {
		// Turn spaces into \n.
		text1 := strings.Replace(tt.text1, " ", "\n", -1)
		if text1 != "" {
			text1 += "\n"
		}
		text2 := strings.Replace(tt.text2, " ", "\n", -1)
		if text2 != "" {
			text2 += "\n"
		}
		out := diff(text1, text2)
		// Cut final \n, cut spaces, turn remaining \n into spaces.
		out = strings.Replace(strings.Replace(strings.TrimSuffix(out, "\n"), " ", "", -1), "\n", " ", -1)
		if out != tt.diff {
			t.Errorf("diff(%q, %q) = %q, want %q", text1, text2, out, tt.diff)
		}
	}
}
