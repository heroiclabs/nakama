//  Copyright (c) 2015 Couchbase, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 		http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package metrics

import (
	"bytes"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/blevesearch/bleve/index/store/gtreap"
)

func TestMetricsStore(t *testing.T) {
	s, err := New(nil, map[string]interface{}{})
	if err == nil {
		t.Errorf("expected err when bad config")
	}

	s, err = New(nil, map[string]interface{}{
		"kvStoreName_actual": "some-invalid-kvstore-name",
	})
	if err == nil {
		t.Errorf("expected err when unknown kvStoreName_actual")
	}

	s, err = New(nil, map[string]interface{}{
		"kvStoreName_actual": gtreap.Name,
		"path":               "",
	})
	if err != nil {
		t.Fatal(err)
	}

	b := bytes.NewBuffer(nil)
	err = s.(*Store).WriteJSON(b)
	if err != nil {
		t.Fatal(err)
	}
	if b.Len() <= 0 {
		t.Errorf("expected some output from WriteJSON")
	}
	var m map[string]interface{}
	err = json.Unmarshal(b.Bytes(), &m)
	if err != nil {
		t.Errorf("expected WriteJSON to be unmarshallable")
	}
	if len(m) == 0 {
		t.Errorf("expected some entries")
	}

	b = bytes.NewBuffer(nil)
	s.(*Store).WriteCSVHeader(b)
	if b.Len() <= 0 {
		t.Errorf("expected some output from WriteCSVHeader")
	}

	b = bytes.NewBuffer(nil)
	s.(*Store).WriteCSV(b)
	if b.Len() <= 0 {
		t.Errorf("expected some output from WriteCSV")
	}
}

func TestErrors(t *testing.T) {
	s, err := New(nil, map[string]interface{}{
		"kvStoreName_actual": gtreap.Name,
		"path":               "",
	})
	if err != nil {
		t.Fatal(err)
	}

	x, ok := s.(*Store)
	if !ok {
		t.Errorf("expecting a Store")
	}

	x.AddError("foo", fmt.Errorf("Foo"), []byte("fooKey"))
	x.AddError("bar", fmt.Errorf("Bar"), nil)
	x.AddError("baz", fmt.Errorf("Baz"), []byte("bazKey"))

	b := bytes.NewBuffer(nil)
	err = x.WriteJSON(b)
	if err != nil {
		t.Fatal(err)
	}

	var m map[string]interface{}
	err = json.Unmarshal(b.Bytes(), &m)
	if err != nil {
		t.Errorf("expected unmarshallable writeJSON, err: %v, b: %s",
			err, b.Bytes())
	}

	errorsi, ok := m["Errors"]
	if !ok || errorsi == nil {
		t.Errorf("expected errorsi")
	}
	errors, ok := errorsi.([]interface{})
	if !ok || errors == nil {
		t.Errorf("expected errorsi is array")
	}
	if len(errors) != 3 {
		t.Errorf("expected errors len 3")
	}

	e := errors[0].(map[string]interface{})
	if e["Op"].(string) != "foo" ||
		e["Err"].(string) != "Foo" ||
		len(e["Time"].(string)) < 10 ||
		e["Key"].(string) != "fooKey" {
		t.Errorf("expected foo, %#v", e)
	}
	e = errors[1].(map[string]interface{})
	if e["Op"].(string) != "bar" ||
		e["Err"].(string) != "Bar" ||
		len(e["Time"].(string)) < 10 ||
		e["Key"].(string) != "" {
		t.Errorf("expected bar, %#v", e)
	}
	e = errors[2].(map[string]interface{})
	if e["Op"].(string) != "baz" ||
		e["Err"].(string) != "Baz" ||
		len(e["Time"].(string)) < 10 ||
		e["Key"].(string) != "bazKey" {
		t.Errorf("expected baz, %#v", e)
	}
}
