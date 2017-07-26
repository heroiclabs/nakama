// Copyright 2017 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package jsonpatch

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
)

type ExtendedPatch Patch

func (o operation) assert() int {
	if obj, ok := o["assert"]; ok {
		var op int

		err := json.Unmarshal(*obj, &op)

		if err != nil {
			return -2 // Bad value.
		}

		return op
	}

	return -2 // Bad value.
}

func (o operation) conditional() bool {
	if obj, ok := o["conditional"]; ok {
		var op bool

		err := json.Unmarshal(*obj, &op)

		if err != nil {
			return false // Treat bad values as not conditional.
		}

		return op
	}

	return false // Treat bad values as not conditional.
}

func NewExtendedPatch(ops []map[string]*json.RawMessage) (ExtendedPatch, error) {
	ep := make(ExtendedPatch, len(ops))
	for i, op := range ops {
		ep[i] = operation(op)
	}
	return ep, nil
}

// DecodePatch decodes the passed JSON document as an RFC 6902 patch.
func DecodeExtendedPatch(buf []byte) (ExtendedPatch, error) {
	var ep ExtendedPatch

	err := json.Unmarshal(buf, &ep)

	if err != nil {
		return nil, err
	}

	return ep, nil
}

// Apply mutates a JSON document according to the patch, and returns the new
// document.
func (ep ExtendedPatch) Apply(doc []byte) ([]byte, error) {
	return ep.ApplyIndent(doc, "")
}

// ApplyIndent mutates a JSON document according to the patch, and returns the new
// document indented.
func (ep ExtendedPatch) ApplyIndent(doc []byte, indent string) ([]byte, error) {
	var pd container
	if doc[0] == '[' {
		pd = &partialArray{}
	} else {
		pd = &partialDoc{}
	}

	err := json.Unmarshal(doc, pd)

	if err != nil {
		return nil, err
	}

	err = nil
	p := Patch(ep)

	for _, op := range p {
		switch op.kind() {
		case "add":
			err = p.add(&pd, op)
		case "remove":
			err = p.remove(&pd, op)
		case "replace":
			err = p.replace(&pd, op)
		case "move":
			err = p.move(&pd, op)
		case "test":
			err = p.test(&pd, op)
		case "copy":
			err = p.copy(&pd, op)
		// Extended ops here:
		case "append":
			err = ep.appendOp(&pd, op)
		case "incr":
			err = ep.incr(&pd, op)
		case "init":
			err = ep.init(&pd, op)
		case "merge":
			err = ep.merge(&pd, op)
		case "patch":
			err = ep.patch(&pd, op)
		case "compare":
			err = ep.compare(&pd, op)
		default:
			err = fmt.Errorf("Unexpected kind: %s", op.kind())
		}

		if err != nil {
			return nil, err
		}
	}

	if indent != "" {
		return json.MarshalIndent(pd, "", indent)
	}

	return json.Marshal(pd)
}

// Note: named `appendOp` rather than `append` to avoid name collision with builtin function.
func (ep ExtendedPatch) appendOp(doc *container, op operation) error {
	path := op.path()

	con, key := findObject(doc, path)

	if con == nil {
		return fmt.Errorf("jsonpatch append operation does not apply: doc is missing path: %s", path)
	}

	val, ok := con.get(key)
	if val == nil || ok != nil {
		return fmt.Errorf("jsonpatch append operation does not apply: doc is missing key: %s", path)
	}

	array, err := val.intoAry()
	if err != nil {
		return fmt.Errorf("jsonpatch append operation does not apply: path does not point to an array: %s", path)
	}

	err = array.add("-", op.value())
	if err != nil {
		return errors.New("jsonpatch append operation does not apply: array cannot be appended to")
	}

	raw, err := json.Marshal(array)
	if err != nil {
		return fmt.Errorf("jsonpatch append operation does not apply: array cannot be encoded: %s", err.Error())
	}
	rawMessage := json.RawMessage(raw)
	node := newLazyNode(&rawMessage)

	return con.set(key, node)
}

func (ep ExtendedPatch) incr(doc *container, op operation) error {
	path := op.path()
	incomingValue := op.value()
	if incomingValue == nil {
		return errors.New("jsonpatch incr operation does not apply: value is required")
	}

	con, key := findObject(doc, path)

	if con == nil {
		return fmt.Errorf("jsonpatch incr operation does not apply: doc is missing path: %s", path)
	}

	val, ok := con.get(key)
	if val == nil || ok != nil {
		return fmt.Errorf("jsonpatch incr operation does not apply: doc is missing key: %s", path)
	}

	var value float64
	var incr float64
	if err := json.Unmarshal(*val.raw, &value); err != nil {
		return fmt.Errorf("jsonpatch incr operation does not apply: path does not point to a number: %s", path)
	}
	if err := json.Unmarshal(*incomingValue.raw, &incr); err != nil {
		return errors.New("jsonpatch incr operation does not apply: value must be a number")
	}

	raw := json.RawMessage([]byte(strconv.FormatFloat(value+incr, 'f', -1, 64)))
	node := newLazyNode(&raw)

	return con.set(key, node)
}

func (ep ExtendedPatch) init(doc *container, op operation) error {
	path := op.path()

	con, key := findObject(doc, path)

	if con == nil {
		return fmt.Errorf("jsonpatch init operation does not apply: doc is missing parent path: %s", path)
	}

	val, ok := con.get(key)
	if ok != nil {
		return fmt.Errorf("jsonpatch init operation does not apply: doc is missing key: %s", path)
	}

	// Initialise missing keys.
	if val == nil {
		return con.set(key, op.value())
	}

	// Overwrite "null" value keys.
	b, err := json.Marshal(*val.raw)
	if err != nil {
		return fmt.Errorf("jsonpatch init operation does not apply: error converting value: %s", err.Error())
	}
	if bytes.Equal(b, []byte("null")) {
		return con.set(key, op.value())
	}

	return nil
}

func (ep ExtendedPatch) merge(doc *container, op operation) error {
	path := op.path()
	incomingValue := op.value()
	if incomingValue == nil {
		return errors.New("jsonpatch merge operation does not apply: value is required")
	}

	con, key := findObject(doc, path)

	if con == nil {
		return fmt.Errorf("jsonpatch merge operation does not apply: doc is missing path: %s", path)
	}

	val, ok := con.get(key)
	if val == nil || ok != nil {
		return fmt.Errorf("jsonpatch merge operation does not apply: doc is missing key: %s", path)
	}

	raw, err := MergePatch(*val.raw, *incomingValue.raw)
	if err != nil {
		return fmt.Errorf("jsonpatch merge operation does not apply: doc cannot be merged: %s", err.Error())
	}
	rawMessage := json.RawMessage(raw)
	node := newLazyNode(&rawMessage)

	return con.set(key, node)
}

func (ep ExtendedPatch) patch(doc *container, op operation) error {
	path := op.path()
	conditional := op.conditional()
	incomingValue := op.value()
	if incomingValue == nil {
		return errors.New("jsonpatch patch operation does not apply: value is required")
	}

	con, key := findObject(doc, path)

	if con == nil {
		if conditional {
			return nil
		}
		return fmt.Errorf("jsonpatch patch operation does not apply: doc is missing path: %s", path)
	}

	val, ok := con.get(key)
	if val == nil || ok != nil {
		if conditional {
			return nil
		}
		return fmt.Errorf("jsonpatch patch operation does not apply: doc is missing key: %s", path)
	}

	patch, err := DecodeExtendedPatch(*incomingValue.raw)
	if err != nil {
		return errors.New("jsonpatch patch operation does not apply: value is not a valid patch op")
	}

	raw, err := patch.Apply(*val.raw)
	if err != nil {
		if conditional {
			return nil
		}
		return fmt.Errorf("jsonpatch patch operation does not apply: patch op failed: %s", err.Error())
	}

	rawMessage := json.RawMessage(raw)
	node := newLazyNode(&rawMessage)

	return con.set(key, node)
}

func (ep ExtendedPatch) compare(doc *container, op operation) error {
	path := op.path()
	assert := op.assert()
	if assert < -1 || assert > 1 {
		return errors.New("jsonpatch compare operation does not apply: assert value must be -1, 0, or 1")
	}
	incomingValue := op.value()
	if incomingValue == nil {
		return errors.New("jsonpatch compare operation does not apply: value is required")
	}

	con, key := findObject(doc, path)

	if con == nil {
		return fmt.Errorf("jsonpatch compare operation does not apply: doc is missing path: %s", path)
	}

	val, ok := con.get(key)
	if val == nil || ok != nil {
		return fmt.Errorf("jsonpatch compare operation does not apply: doc is missing key: %s", path)
	}

	// Incoming compare value is a null.
	if bytes.Equal(*incomingValue.raw, []byte("null")) {
		if bytes.Equal(*val.raw, []byte("null")) && assert != 0 {
			// Comparing nulls should be 0.
			return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
		} else if assert != -1 {
			// Any existing non-null value compares as "greater than" a null.
			return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
		}
		return nil
	}

	// Incoming compare value is a boolean.
	var incomingBoolean bool
	if err := json.Unmarshal(*incomingValue.raw, &incomingBoolean); err == nil {
		if bytes.Equal(*val.raw, []byte("null")) && assert != -1 {
			// Any given boolean is "greater than" a null.
			return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
		}
		var existingBoolean bool
		if err := json.Unmarshal(*val.raw, &existingBoolean); err == nil {
			if existingBoolean == incomingBoolean && assert != 0 {
				// Same boolean value.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			} else if !existingBoolean && incomingBoolean && assert != -1 {
				// Existing false, incoming true.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			} else if existingBoolean && !incomingBoolean && assert != 1 {
				// Existing false, incoming true.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			}
		} else {
			// Existing value is not a boolean type, so we can't compare.
			return fmt.Errorf("jsonpatch compare operation failed: incompatible types assert error on path: %s", path)
		}
		return nil
	}

	// Incoming value is a number.
	var incomingNumber float64
	if err := json.Unmarshal(*incomingValue.raw, &incomingNumber); err == nil {
		if bytes.Equal(*val.raw, []byte("null")) && assert != -1 {
			// Any given number is "greater than" a null.
			return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
		}
		var existingNumber float64
		if err := json.Unmarshal(*val.raw, &existingNumber); err == nil {
			if existingNumber == incomingNumber && assert != 0 {
				// Same number value.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			} else if existingNumber < incomingNumber && assert != -1 {
				// Existing less than incoming.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			} else if existingNumber > incomingNumber && assert != 1 {
				// Existing greater than incoming.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			}
		} else {
			// Existing value is not a number type, so we can't compare.
			return fmt.Errorf("jsonpatch compare operation failed: incompatible types assert error on path: %s", path)
		}
		return nil
	}

	// Incoming value is a string.
	var incomingString string
	if err := json.Unmarshal(*incomingValue.raw, &incomingString); err == nil {
		if bytes.Equal(*val.raw, []byte("null")) && assert != -1 {
			// Any given string is "greater than" a null.
			return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
		}
		var existingString string
		if err := json.Unmarshal(*val.raw, &existingString); err == nil {
			if existingString == incomingString && assert != 0 {
				// Same string value.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			} else if existingString < incomingString && assert != -1 {
				// Existing less than incoming.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			} else if existingString > incomingString && assert != 1 {
				// Existing greater than incoming.
				return fmt.Errorf("jsonpatch compare operation failed: assert failed on path: %s", path)
			}
		} else {
			// Existing value is not a string type, so we can't compare.
			return fmt.Errorf("jsonpatch compare operation failed: incompatible types assert error on path: %s", path)
		}
		return nil
	}

	return errors.New("jsonpatch compare operation failed: given value is not comparable")
}
