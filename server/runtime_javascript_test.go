// Copyright 2018 The Nakama Authors
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

package server

import (
	"encoding/json"
	"github.com/dop251/goja"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"strings"
	"testing"
)

func TestJsObjectFreeze(t *testing.T) {
	t.Run("after freeze new global vars cannot be created", func(t *testing.T) {
		observer, _ := observer.New(zap.InfoLevel)
		logger := zap.New(observer)
		config := NewConfig(logger)
		config.Runtime.JsReadOnlyGlobals = true

		r := goja.New()
		freezeGlobalObject(config, r)

		p, _ := goja.Compile("test", `
var k = 'new string';
`, true)

		_, err := r.RunProgram(p)
		if err == nil {
			t.Errorf("should've thrown an error")
		}
		if !strings.Contains(err.Error(), "TypeError: Cannot define global variable 'k', global object is not extensible at test:1:1(0)") {
			t.Errorf("should've thrown an error")
		}
	})

	t.Run("after freeze global vars become immutable", func(t *testing.T) {
		observer, _ := observer.New(zap.InfoLevel)
		logger := zap.New(observer)
		config := NewConfig(logger)
		config.Runtime.JsReadOnlyGlobals = true

		r := goja.New()

		p, _ := goja.Compile("test", `
var m = {foo: 'bar'};
`, true)

		_, err := r.RunProgram(p)
		if err != nil {
			t.Errorf("failed to run script: %s", err.Error())
		}

		freezeGlobalObject(config, r)

		p, _ = goja.Compile("test", `
m.foo = 'baz';
`, true)

		_, err = r.RunProgram(p)
		if err == nil {
			t.Errorf("should've thrown an error")
		}
		if !strings.Contains(err.Error(), "TypeError: Cannot assign to read only property 'foo'") {
			t.Errorf("should've thrown an error")
		}
	})

	t.Run("after freeze newly instanced objects are mutable", func(t *testing.T) {
		observer, _ := observer.New(zap.InfoLevel)
		logger := zap.New(observer)
		config := NewConfig(logger)
		config.Runtime.JsReadOnlyGlobals = true

		r := goja.New()

		p, _ := goja.Compile("test", `
var m = new Map();
`, true)

		_, err := r.RunProgram(p)
		if err != nil {
			t.Error("Failed to run JS script")
		}

		freezeGlobalObject(config, r)

		p, _ = goja.Compile("test", `
m.set('a', 1);
m.get('a');
`, true)

		v, err := r.RunProgram(p)
		if err != nil {
			t.Errorf("failed to run script: %s", err.Error())
		}

		if v.String() != "1" {
			t.Errorf("expected returned value to be '1'")
		}
	})
}

const data = `{"title_data":{"ads_config": [1,2,3]}}`

// go test -run=XXX -bench=BenchmarkParse ./...
// go test -run=XXX -bench=BenchmarkParse ./... -benchmem
func BenchmarkParseJsonGoja(b *testing.B) {
	vm := goja.New()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		v, err := jsJsonParse(vm, data)
		if err != nil {
			b.Fatal(err)
		}
		_ = vm.Set("data", v)
		_, err = vm.RunString(`data.foo = []; data.foo.push(3)`)
		if err != nil {
			b.Fatal(err)
		}
	}
}
func BenchmarkParseJsonGo(b *testing.B) {
	vm := goja.New()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var out map[string]any
		err := json.Unmarshal([]byte(data), &out)
		if err != nil {
			b.Fatal(err)
		}
		pointerizeSlices(out)
		_ = vm.Set("data", out)
		_, err = vm.RunString(`data.foo = []; data.foo.push(3)`)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// pointerizeSlices recursively walks a map[string]interface{} and replaces any []interface{} references for *[]interface{}.
// This is needed to allow goja operations that resize a JS wrapped Go slice to work as expected, otherwise
// such operations won't reflect on the original slice as it would be passed by value and not by reference.
func pointerizeSlices(m interface{}) {
	switch i := m.(type) {
	case map[string]interface{}:
		for k, v := range i {
			if s, ok := v.([]interface{}); ok {
				i[k] = &s
				pointerizeSlices(&s)
			}
			if mi, ok := v.(map[string]interface{}); ok {
				pointerizeSlices(mi)
			}
		}
	case *[]interface{}:
		for idx, v := range *i {
			if s, ok := v.([]interface{}); ok {
				(*i)[idx] = &s
				pointerizeSlices(&s)
			}
			if mi, ok := v.(map[string]interface{}); ok {
				pointerizeSlices(mi)
			}
		}
	}
}
