package lua

import (
	"fmt"
	"io"
	"os"
	"testing"
)

func TestMathRandom(t *testing.T) {
	//
	// Arrange: state and script
	L := NewState()
	script := `
		print(math.random())
		print(math.random(100))
		print(math.random(10, 100))

		math.randomseed(1234)

		print(math.random())
		print(math.random(100))
		print(math.random(10, 100))
	`

	//
	// Act: run script.
	_, err := captureOutput(func() error {
		return L.DoString(script)
	})

	//
	// Assert: should run ok
	if err != nil {
		t.Fatalf("Failed to run lua script: %s", err.Error())
	}
}

func TestMathRandomUnseeded(t *testing.T) {
	//
	// Arrange: two states
	L1, L2 := NewState(), NewState()
	defer L1.Close()
	defer L2.Close()

	// Arrange: unseeded generator script
	numRands := 1000
	randRange := 1000

	script := fmt.Sprintf(`
		local num_runs = %d
		for _ = 1, num_runs, 1 do
			print(math.random(%d))
		end
	`, numRands, randRange)

	//
	// Act: run generators on both states.
	out1, err := captureOutput(func() error {
		return L1.DoString(script)
	})
	if err != nil {
		t.Fatalf("Failed to run lua script: %s", err.Error())
	}

	out2, err := captureOutput(func() error {
		return L2.DoString(script)
	})
	if err != nil {
		t.Fatalf("Failed to run lua script: %s", err.Error())
	}

	//
	// Assert: output should differ
	if out1 == out2 {
		t.Fatalf("Output is the same")
	}
}

func TestMathRandomSeeded(t *testing.T) {
	//
	// Arrange: two states
	L1, L2 := NewState(), NewState()
	defer L1.Close()
	defer L2.Close()

	// Arrange: seeded generator script
	numRands := 1000
	randRange := 1000

	script := fmt.Sprintf(`
		math.randomseed(123456789)
		local num_runs = %d
		for _ = 1, num_runs, 1 do
			print(math.random(%d))
		end
	`, numRands, randRange)

	//
	// Act: run generators on both states.
	out1, err := captureOutput(func() error {
		return L1.DoString(script)
	})
	if err != nil {
		t.Fatalf("Failed to run lua script: %s", err.Error())
	}

	out2, err := captureOutput(func() error {
		return L2.DoString(script)
	})
	if err != nil {
		t.Fatalf("Failed to run lua script: %s", err.Error())
	}

	//
	// Assert: output should be the same
	if out1 != out2 {
		t.Fatalf("Output is not the same")
	}
}

func captureOutput(f func() error) (string, error) {
	orig := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	err := f()
	os.Stdout = orig
	w.Close()
	out, _ := io.ReadAll(r)
	return string(out), err
}
