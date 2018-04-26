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
	"reflect"
	"testing"
)

func TestByteEncoding(t *testing.T) {
	var actionMap = ActionMap{
		setup:    setupAction,
		teardown: teardownAction,
		action1:  action1Action,
		action2:  action2Action,
	}

	tests := []struct {
		actionSeq ActionSeq
		expected  []byte
		err       error
	}{
		{
			actionSeq: ActionSeq{
				action1,
				action2,
				action1,
				action2,
			},
			expected: []byte{0, 129, 0, 129},
		},
		{
			actionSeq: ActionSeq{
				action1,
				action2,
				errExpected,
			},
			err: ErrActionNotPossible,
		},
	}

	for _, test := range tests {
		ctx := &testContext{t: t}
		rv, err := test.actionSeq.ByteEncoding(ctx, setup, teardown, actionMap)
		if err != test.err {
			t.Errorf("expected err: %v got: %v", test.err, err)
		}
		if !reflect.DeepEqual(rv, test.expected) {
			t.Errorf("expected: %v, got %v", test.expected, rv)
		}
	}
}

func TestByteEncodingErrors(t *testing.T) {
	var actionMap = ActionMap{
		setup:       setupAction,
		teardown:    teardownAction,
		errExpected: errExpectedAction,
		setupToErr:  setupToErrAction,
		setupToNop:  setupToNopAction,
	}

	actionSeq := ActionSeq{
		action1,
		action2,
		action1,
		action2,
	}

	// setup missing
	_, err := actionSeq.ByteEncoding(nil, -1, teardown, actionMap)
	if err != ErrSetupMissing {
		t.Errorf("expected ErrSetupMissing, got %v", err)
	}
	// setup error
	_, err = actionSeq.ByteEncoding(nil, errExpected, teardown, actionMap)
	if err != errExpectedErr {
		t.Errorf("expected errExpectedErr, got %v", err)
	}
	// err in action
	ctx := &testContext{t: t}
	actionSeq = ActionSeq{
		errExpected,
	}
	_, err = actionSeq.ByteEncoding(ctx, setupToErr, teardown, actionMap)
	if err != errExpectedErr {
		t.Errorf("expected errExpectedErr, got %v", err)
	}
}

func TestByteEncodingNop(t *testing.T) {

	var actionMap = ActionMap{
		teardown:   teardownAction,
		setupToNop: setupToNopAction,
	}

	// nop in actions
	ctx := &testContext{t: t}
	actionSeq := ActionSeq{
		NopAction,
	}
	rv, err := actionSeq.ByteEncoding(ctx, setupToNop, teardown, actionMap)
	if err != nil {
		t.Fatalf("expected no err, got: %v", err)
	}
	expected := []byte{232}
	if !reflect.DeepEqual(rv, expected) {
		t.Errorf("expected: %v, got %v", expected, rv)
	}
}
