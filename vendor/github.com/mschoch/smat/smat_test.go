//  Copyright (c) 2016 Marty Schoch

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the
//  License. You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//  Unless required by applicable law or agreed to in writing,
//  software distributed under the License is distributed on an "AS
//  IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
//  express or implied. See the License for the specific language
//  governing permissions and limitations under the License.

package smat

import (
	"bytes"
	"fmt"
	"sync"
	"testing"
	"time"
)

type testContext struct {
	t             *testing.T
	setupFired    bool
	teardownFired bool
	action1Fired  bool
	action2Fired  bool
	count         int
}

const (
	setup ActionID = iota
	teardown
	action1
	action2
	errExpected
	setupToNop
	setupToErr
)

func state1(next byte) ActionID {
	return PercentExecute(next,
		PercentAction{Percent: 50, Action: action1},
		PercentAction{Percent: 50, Action: action2},
	)
}

func stateToErr(next byte) ActionID {
	return PercentExecute(next,
		PercentAction{Percent: 100, Action: errExpected})
}

func stateNop(next byte) ActionID {
	return PercentExecute(next,
		PercentAction{Percent: 90, Action: action1})
}

func setupAction(ctx Context) (next State, err error) {
	context := ctx.(*testContext)
	context.setupFired = true
	return state1, nil
}

func setupToErrAction(ctx Context) (next State, err error) {
	return stateToErr, nil
}

func setupToNopAction(ctx Context) (next State, err error) {
	return stateNop, nil
}

func teardownAction(ctx Context) (next State, err error) {
	context := ctx.(*testContext)
	context.teardownFired = true
	return state1, nil
}

func action1Action(ctx Context) (next State, err error) {
	context := ctx.(*testContext)
	context.action1Fired = true

	return state1, nil
}

func action2Action(ctx Context) (next State, err error) {
	context := ctx.(*testContext)
	context.action2Fired = true
	context.count++
	return state1, nil
}

var errExpectedErr = fmt.Errorf("expected")

func errExpectedAction(ctx Context) (next State, err error) {
	return nil, errExpectedErr
}

func TestRunMachine(t *testing.T) {

	var actionMap = ActionMap{
		setup:    setupAction,
		teardown: teardownAction,
		action1:  action1Action,
		action2:  action2Action,
	}

	ctx := &testContext{t: t}
	err := runReader(ctx, setup, teardown, actionMap, bytes.NewReader([]byte{0, 255}), nil)
	if err != nil {
		t.Fatalf("err running reader: %v", err)
	}

	if !ctx.setupFired {
		t.Errorf("expected setup to happen, did not")
	}
	if !ctx.teardownFired {
		t.Errorf("expected teardown to happen, did not")
	}
	if !ctx.action1Fired {
		t.Errorf("expected action1 to happen, did not")
	}
	if !ctx.action2Fired {
		t.Errorf("expected action2 to happen, did not")
	}
}

func TestRunMachineErrors(t *testing.T) {
	var actionMap = ActionMap{
		setup:       setupAction,
		teardown:    teardownAction,
		errExpected: errExpectedAction,
		setupToErr:  setupToErrAction,
	}
	// setup missing
	err := runReader(nil, -1, teardown, actionMap, bytes.NewReader([]byte{}), nil)
	if err != ErrSetupMissing {
		t.Errorf("expected ErrSetupMissing, got %v", err)
	}
	// teardown missing
	err = runReader(nil, setup, -1, actionMap, bytes.NewReader([]byte{}), nil)
	if err != ErrTeardownMissing {
		t.Errorf("expected ErrTeardownMissing, got %v", err)
	}
	// setup error
	err = runReader(nil, errExpected, teardown, actionMap, bytes.NewReader([]byte{}), nil)
	if err != errExpectedErr {
		t.Errorf("expected errExpectedErr, got %v", err)
	}
	// err in action
	ctx := &testContext{t: t}
	err = runReader(ctx, setupToErr, teardown, actionMap, bytes.NewReader([]byte{0}), nil)
	if err != errExpectedErr {
		t.Errorf("expected errExpectedErr, got %v", err)
	}

}

func TestRunMachineWithNop(t *testing.T) {

	var actionMap = ActionMap{
		setupToNop: setupToNopAction,
		teardown:   teardownAction,
		action1:    action1Action,
	}

	ctx := &testContext{t: t}
	// first go to nop, then to action1
	err := runReader(ctx, setupToNop, teardown, actionMap, bytes.NewReader([]byte{255, 0}), nil)
	if err != nil {
		t.Errorf("expected no err, got %v", err)
	}

	if !ctx.action1Fired {
		t.Errorf("expected action1 to happen, did not")
	}

}

func TestFuzz(t *testing.T) {

	var actionMap = ActionMap{
		setup:    setupAction,
		teardown: teardownAction,
		action1:  action1Action,
		action2:  action2Action,
	}

	ctx := &testContext{t: t}
	res := Fuzz(ctx, setup, teardown, actionMap, []byte{0, 255})
	if res != 1 {
		t.Errorf("expected return 1, got %d", res)
	}
	if !ctx.setupFired {
		t.Errorf("expected setup to happen, did not")
	}
	if !ctx.teardownFired {
		t.Errorf("expected teardown to happen, did not")
	}
	if !ctx.action1Fired {
		t.Errorf("expected action1 to happen, did not")
	}
	if !ctx.action2Fired {
		t.Errorf("expected action2 to happen, did not")
	}
}

func TestFuzzErr(t *testing.T) {

	sawPanic := false

	defer func() {
		if sawPanic == false {
			t.Errorf("expected to see panic, did not")
		}
	}()

	defer func() {
		if r := recover(); r != nil {
			sawPanic = true
		}
	}()

	var actionMap = ActionMap{
		setupToErr:  setupToErrAction,
		teardown:    teardownAction,
		errExpected: errExpectedAction,
	}

	ctx := &testContext{t: t}
	Fuzz(ctx, setupToErr, teardown, actionMap, []byte{0})
}

func TestLongevity(t *testing.T) {
	var actionMap = ActionMap{
		setup:    setupAction,
		teardown: teardownAction,
		action1:  action1Action,
		action2:  action2Action,
	}

	var err error
	ctx := &testContext{t: t}
	wg := sync.WaitGroup{}
	closeChan := make(chan struct{})
	wg.Add(1)
	go func() {
		err = Longevity(ctx, setup, teardown, actionMap, 0, closeChan)
		wg.Done()
	}()
	// sleep briefly
	time.Sleep(1 * time.Second)
	// then close
	close(closeChan)
	// wait for the longeivity function to return
	wg.Wait()
	if err != ErrClosed {
		t.Errorf("expected ErrClosed, got: %v", err)
	}
	if !ctx.setupFired {
		t.Errorf("expected setup to happen, did not")
	}
	if !ctx.teardownFired {
		t.Errorf("expected teardown to happen, did not")
	}
	if !ctx.action1Fired {
		t.Errorf("expected action1 to happen, did not")
	}
	if !ctx.action2Fired {
		t.Errorf("expected action2 to happen, did not")
	}
	if ctx.count < 10000 {
		t.Errorf("expected actions to fire a lot, but only %d", ctx.count)
	}
}
