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
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
)

type Operation operation

type ExtendedPatch struct {
	Patch
}

func ToExtendedPatch(ops []Operation) ExtendedPatch {
	// Could also be done using unsafe pointers to avoid the loop, but
	// prefer the type-safe way unless we find a very good reason not to.
	// For reference:
	//   return Patch(*(*[]operation)(unsafe.Pointer(&ops)))
	// Where:
	//   type Operation operation
	patch := make(Patch, len(ops))
	for i, op := range ops {
		patch[i] = operation(op)
	}
	return ExtendedPatch{patch}
}

// Apply mutates a JSON document according to the patch, and returns the new
// document.
func (p ExtendedPatch) Apply(doc []byte) ([]byte, error) {
	return p.ApplyIndent(doc, "")
}

// ApplyIndent mutates a JSON document according to the patch, and returns the new
// document indented.
func (p ExtendedPatch) ApplyIndent(doc []byte, indent string) ([]byte, error) {
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

	for _, op := range p.Patch {
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
			err = p.appendOp(&pd, op)
		case "incr":
			err = p.incr(&pd, op)
		case "init":
			err = p.init(&pd, op)
		case "merge":
			err = p.merge(&pd, op)
		//case "patch":
		//	err = p.patch(&pd, op)
		//case "compare":
		//	err = p.compare(&pd, op)
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
func (p Patch) appendOp(doc *container, op operation) error {
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

func (p Patch) incr(doc *container, op operation) error {
	path := op.path()

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
	if err := json.Unmarshal(*op.value().raw, &incr); err != nil {
		return errors.New("jsonpatch incr operation does not apply: value must be a number")
	}

	raw := json.RawMessage([]byte(strconv.FormatFloat(value+incr, 'f', -1, 64)))
	node := newLazyNode(&raw)

	return con.set(key, node)
}

func (p Patch) init(doc *container, op operation) error {
	path := op.path()

	con, key := findObject(doc, path)

	if con == nil {
		return fmt.Errorf("jsonpatch init operation does not apply: doc is missing parent path: %s", path)
	}

	val, ok := con.get(key)
	if ok != nil {
		return fmt.Errorf("jsonpatch init operation does not apply: doc is missing key: %s", path)
	}
	if val == nil {
		return con.set(key, op.value())
	}

	return nil
}

func (p Patch) merge(doc *container, op operation) error {
	path := op.path()

	con, key := findObject(doc, path)

	if con == nil {
		return fmt.Errorf("jsonpatch merge operation does not apply: doc is missing path: %s", path)
	}

	val, ok := con.get(key)
	if val == nil || ok != nil {
		return fmt.Errorf("jsonpatch merge operation does not apply: doc is missing key: %s", path)
	}

	raw, err := MergePatch(*val.raw, *op.value().raw)
	if err != nil {
		return fmt.Errorf("jsonpatch merge operation does not apply: doc cannot be merged: %s", err.Error())
	}
	rawMessage := json.RawMessage(raw)
	node := newLazyNode(&rawMessage)

	return con.set(key, node)
}
