package server

import "testing"

func createTestConsoleServer(t *testing.T) {
	consoleLogger := loggerForTest(t)
	config := NewConfig(consoleLogger)
	c := newConsoleS
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()
}
