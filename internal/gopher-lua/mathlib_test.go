package lua

import (
	"fmt"
	"io"
	"os"
	"sync"
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
	// Assert: output should be the same.
	if out1 != out2 {
		t.Fatalf("Output is not the same")
	}
}

func TestMathRandomConcurrencyRace(t *testing.T) {
	//
	// Arrange: new state and wait group of 100 goroutines.
	L := NewState()
	defer L.Close()

	numGoroutines := 100
	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	// Push argument for seed.
	L.Push(LNumber(100))

	//
	// Act: fire goroutines and test random funcs.
	// can't really test mathRandom here, because it relies on
	// lua state which is not thread-safe.
	for range numGoroutines {
		go func() {
			defer wg.Done()

			mathRandomseed(L)
			random.Float64()
			random.Intn(10)
		}()
	}

	// Wait for all to complete.
	wg.Wait()

	// Assert: shouldn't crash
}

func captureOutput(f func() error) (string, error) {
	orig := os.Stdout
	r, w, pipeErr := os.Pipe()
	if pipeErr != nil {
		return "", pipeErr
	}
	os.Stdout = w
	err := f()
	os.Stdout = orig
	w.Close()
	out, readErr := io.ReadAll(r)
	if readErr != nil {
		return "", readErr
	}
	return string(out), err
}
