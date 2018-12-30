package main

import (
	"os"
	"testing"

	"github.com/rogpeppe/go-internal/testscript"
)

func TestMain(m *testing.M) {
	os.Exit(testscript.RunMain(m, map[string]func() int{
		"txtar-savedir": main1,
	}))
}

func TestScripts(t *testing.T) {
	p := testscript.Params{Dir: "testdata"}
	testscript.Run(t, p)
}
