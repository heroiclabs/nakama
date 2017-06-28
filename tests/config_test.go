package tests

import (
	"nakama/server"
	"os"
	"testing"
)

const CONFIG_FILE = "config_test.yml"

var l = server.NewConsoleLogger(os.Stdout, true)

func TestConfigLoad(t *testing.T) {
	c := server.ParseArgs(l, []string{"nakama", "--config", CONFIG_FILE})

	if c.GetName() != "nakama-test" {
		t.Error("Unmatched config value - name")
	}
	if c.GetRuntime().HTTPKey != "testkey" {
		t.Error("Unmatched config value - runtime.http_key")
	}
}

func TestConfigLoadOverride(t *testing.T) {
	c := server.ParseArgs(l, []string{
		"nakama",
		"--config",
		CONFIG_FILE,
		"--log.stdout",
		"--runtime.http_key",
		"testkey-override",
	})

	if c.GetName() != "nakama-test" {
		t.Error("Unmatched config value - name")
	}

	if !c.GetLog().Stdout {
		t.Error("Unmatched config value - log.stdout")
	}

	if c.GetRuntime().HTTPKey != "testkey-override" {
		t.Error("Unmatched config value - name")
	}
}

func TestCmdOverride(t *testing.T) {
	c := server.ParseArgs(l, []string{
		"nakama",
		"--name",
		"nakama-test-override",
		"--log.stdout",
		"--runtime.http_key",
		"testkey-override",
	})

	if c.GetName() != "nakama-test-override" {
		t.Error("Unmatched config value - name")
	}

	if !c.GetLog().Stdout {
		t.Error("Unmatched config value - log.stdout")
	}

	if c.GetRuntime().HTTPKey != "testkey-override" {
		t.Error("Unmatched config value - runtime.http_key")
	}
}
