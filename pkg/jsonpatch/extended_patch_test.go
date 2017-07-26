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
	"testing"
)

func TestNewExtendedPatch(t *testing.T) {
	var ops []map[string]*json.RawMessage
	err := json.Unmarshal([]byte(`[{"op":"init","path":"/foo","value":{"bar":1}},{"op":"incr","path":"/foo/bar","value":3}]`), &ops)
	if err != nil {
		t.Fatalf("Error decoding new extended patch: %v", err)
	}

	ep, err := NewExtendedPatch(ops)
	if err != nil {
		t.Fatalf("Error creating new extended patch: %v", err)
	}

	out, err := ep.Apply([]byte(`{}`))
	if err != nil {
		t.Fatalf("Error applying new extended patch: %v", err)
	}

	outString := string(out)
	expectedString := `{"foo":{"bar":4}}`

	if !compareJSON(expectedString, outString) {
		t.Errorf("ExtendedPatch did not apply. Expected:\n%s\n\nActual:\n%s",
			reformatJSON(expectedString), reformatJSON(outString))
	}
}

func TestDecodeExtendedPatch(t *testing.T) {
	_, err := DecodeExtendedPatch([]byte(`[{"op":"incr","path":"/foo"},{"op":"init","path":"/bar","value":{}}]`))
	if err != nil {
		t.Fatalf("Error decoding extended patch: %v", err)
	}
}

func applyExtendedPatch(doc, patch string) (string, error) {
	obj, err := DecodeExtendedPatch([]byte(patch))

	if err != nil {
		panic(err)
	}

	out, err := obj.Apply([]byte(doc))

	if err != nil {
		return "", err
	}

	return string(out), nil
}

var ExtendedCases = []Case{
	{
		doc:    `{"foo":["bar"]}`,
		patch:  `[{"op":"append","path":"/foo","value":"baz"}]`,
		result: `{"foo":["bar","baz"]}`,
	},
	{
		doc:    `{}`,
		patch:  `[{"op":"init","path":"/foo","value":1}]`,
		result: `{"foo":1}`,
	},
	{
		doc:    `{"foo":"exists"}`,
		patch:  `[{"op":"init","path":"/foo","value":1}]`,
		result: `{"foo":"exists"}`,
	},
	{
		doc:    `{"foo":1}`,
		patch:  `[{"op":"incr","path":"/foo","value":3}]`,
		result: `{"foo":4}`,
	},
	{
		doc:    `{"foo":1}`,
		patch:  `[{"op":"incr","path":"/foo","value":-2.5}]`,
		result: `{"foo":-1.5}`,
	},
	{
		doc:    `{"foo":{"bar":1}}`,
		patch:  `[{"op":"merge","path":"/foo","value":{"baz":true}}]`,
		result: `{"foo":{"bar":1,"baz":true}}`,
	},
	{
		doc:    `{"foo":{"bar":1}}`,
		patch:  `[{"op":"merge","path":"/foo","value":{"baz":true,"bar":2}}]`,
		result: `{"foo":{"bar":2,"baz":true}}`,
	},
	{
		doc:    `{"foo":{"bar":1}}`,
		patch:  `[{"op":"patch","path":"/foo","value":[{"op":"incr","path":"/bar","value":5}]}]`,
		result: `{"foo":{"bar":6}}`,
	},
	{
		doc:    `{"foo":{"bar":1}}`,
		patch:  `[{"op":"patch","path":"/foo","value":[{"op":"incr","path":"/bar","value":5}]}]`,
		result: `{"foo":{"bar":6}}`,
	},
	{
		doc:    `{"foo":{"bar":1}}`,
		patch:  `[{"op":"patch","path":"/foo","conditional":true,"value":[{"op":"test","path":"/bar","value":2},{"op":"incr","path":"/bar","value":5}]},{"op":"incr","path":"/foo/bar","value":2}]`,
		result: `{"foo":{"bar":3}}`,
	},
	{
		doc:    `{"foo":1}`,
		patch:  `[{"op":"compare","path":"/foo","value":2,"assert":-1},{"op":"incr","path":"/foo","value":7}]`,
		result: `{"foo":8}`,
	},
}

func TestAllExtendedCases(t *testing.T) {
	for _, c := range ExtendedCases {
		out, err := applyExtendedPatch(c.doc, c.patch)

		if err != nil {
			t.Errorf("Unable to apply extended patch: %s", err)
		}

		if !compareJSON(out, c.result) {
			t.Errorf("ExtendedPatch did not apply. Expected:\n%s\n\nActual:\n%s",
				reformatJSON(c.result), reformatJSON(out))
		}
	}
}
