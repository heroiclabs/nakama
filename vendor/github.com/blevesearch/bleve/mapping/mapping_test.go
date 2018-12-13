//  Copyright (c) 2014 Couchbase, Inc.
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

package mapping

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/blevesearch/bleve/analysis/tokenizer/exception"
	"github.com/blevesearch/bleve/analysis/tokenizer/regexp"
	"github.com/blevesearch/bleve/document"
)

var mappingSource = []byte(`{
    "types": {
    	"beer": {
    		"properties": {
    			"name": {
    				"fields": [
    					{
    						"name": "name",
    						"type": "text",
    						"analyzer": "standard",
    						"store": true,
    						"index": true,
                            "include_term_vectors": true,
                            "include_in_all": true,
                            "docvalues": true
    					}
    				]
    			}
    		}
    	},
    	"brewery": {
    	}
    },
    "type_field": "_type",
    "default_type": "_default"
}`)

func buildMapping() IndexMapping {
	nameFieldMapping := NewTextFieldMapping()
	nameFieldMapping.Name = "name"
	nameFieldMapping.Analyzer = "standard"

	beerMapping := NewDocumentMapping()
	beerMapping.AddFieldMappingsAt("name", nameFieldMapping)

	breweryMapping := NewDocumentMapping()

	mapping := NewIndexMapping()
	mapping.AddDocumentMapping("beer", beerMapping)
	mapping.AddDocumentMapping("brewery", breweryMapping)

	return mapping
}

func TestUnmarshalMappingJSON(t *testing.T) {
	mapping := buildMapping()

	var indexMapping IndexMappingImpl
	err := json.Unmarshal(mappingSource, &indexMapping)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(&indexMapping, mapping) {
		t.Errorf("expected %#v,\n got %#v", mapping, &indexMapping)
	}
}

func TestMappingStructWithJSONTags(t *testing.T) {

	mapping := buildMapping()

	x := struct {
		NoJSONTag string
		Name      string `json:"name"`
	}{
		Name: "marty",
	}

	doc := document.NewDocument("1")
	err := mapping.MapDocument(doc, x)
	if err != nil {
		t.Fatal(err)
	}
	foundJSONName := false
	foundNoJSONName := false
	count := 0
	for _, f := range doc.Fields {
		if f.Name() == "name" {
			foundJSONName = true
		}
		if f.Name() == "NoJSONTag" {
			foundNoJSONName = true
		}
		count++
	}
	if !foundJSONName {
		t.Errorf("expected to find field named 'name'")
	}
	if !foundNoJSONName {
		t.Errorf("expected to find field named 'NoJSONTag'")
	}
	if count != 2 {
		t.Errorf("expected to find 2 find, found %d", count)
	}
}

func TestMappingStructWithJSONTagsOneDisabled(t *testing.T) {

	mapping := buildMapping()

	x := struct {
		Name      string `json:"name"`
		Title     string `json:"-"`
		NoJSONTag string
	}{
		Name: "marty",
	}

	doc := document.NewDocument("1")
	err := mapping.MapDocument(doc, x)
	if err != nil {
		t.Fatal(err)
	}
	foundJSONName := false
	foundNoJSONName := false
	count := 0
	for _, f := range doc.Fields {
		if f.Name() == "name" {
			foundJSONName = true
		}
		if f.Name() == "NoJSONTag" {
			foundNoJSONName = true
		}
		count++
	}
	if !foundJSONName {
		t.Errorf("expected to find field named 'name'")
	}
	if !foundNoJSONName {
		t.Errorf("expected to find field named 'NoJSONTag'")
	}
	if count != 2 {
		t.Errorf("expected to find 2 find, found %d", count)
	}
}

func TestMappingStructWithAlternateTags(t *testing.T) {

	mapping := buildMapping()
	mapping.(*IndexMappingImpl).DefaultMapping.StructTagKey = "bleve"

	x := struct {
		NoBLEVETag string
		Name       string `bleve:"name"`
	}{
		Name: "marty",
	}

	doc := document.NewDocument("1")
	err := mapping.MapDocument(doc, x)
	if err != nil {
		t.Fatal(err)
	}
	foundBLEVEName := false
	foundNoBLEVEName := false
	count := 0
	for _, f := range doc.Fields {
		if f.Name() == "name" {
			foundBLEVEName = true
		}
		if f.Name() == "NoBLEVETag" {
			foundNoBLEVEName = true
		}
		count++
	}
	if !foundBLEVEName {
		t.Errorf("expected to find field named 'name'")
	}
	if !foundNoBLEVEName {
		t.Errorf("expected to find field named 'NoBLEVETag'")
	}
	if count != 2 {
		t.Errorf("expected to find 2 find, found %d", count)
	}
}

func TestMappingStructWithAlternateTagsTwoDisabled(t *testing.T) {

	mapping := buildMapping()
	mapping.(*IndexMappingImpl).DefaultMapping.StructTagKey = "bleve"

	x := struct {
		Name       string `json:"-"     bleve:"name"`
		Title      string `json:"-"     bleve:"-"`
		NoBLEVETag string `json:"-"`
		Extra      string `json:"extra" bleve:"-"`
	}{
		Name: "marty",
	}

	doc := document.NewDocument("1")
	err := mapping.MapDocument(doc, x)
	if err != nil {
		t.Fatal(err)
	}
	foundBLEVEName := false
	foundNoBLEVEName := false
	count := 0
	for _, f := range doc.Fields {
		if f.Name() == "name" {
			foundBLEVEName = true
		}
		if f.Name() == "NoBLEVETag" {
			foundNoBLEVEName = true
		}
		count++
	}
	if !foundBLEVEName {
		t.Errorf("expected to find field named 'name'")
	}
	if !foundNoBLEVEName {
		t.Errorf("expected to find field named 'NoBLEVETag'")
	}
	if count != 2 {
		t.Errorf("expected to find 2 find, found %d", count)
	}
}

func TestMappingStructWithPointerToString(t *testing.T) {

	mapping := buildMapping()

	name := "marty"

	x := struct {
		Name *string
	}{
		Name: &name,
	}

	doc := document.NewDocument("1")
	err := mapping.MapDocument(doc, x)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	count := 0
	for _, f := range doc.Fields {
		if f.Name() == "Name" {
			found = true
		}
		count++
	}
	if !found {
		t.Errorf("expected to find field named 'Name'")
	}
	if count != 1 {
		t.Errorf("expected to find 1 find, found %d", count)
	}
}

func TestMappingJSONWithNull(t *testing.T) {

	mapping := NewIndexMapping()

	jsonbytes := []byte(`{"name":"marty", "age": null}`)
	var jsondoc interface{}
	err := json.Unmarshal(jsonbytes, &jsondoc)
	if err != nil {
		t.Fatal(err)
	}

	doc := document.NewDocument("1")
	err = mapping.MapDocument(doc, jsondoc)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	count := 0
	for _, f := range doc.Fields {
		if f.Name() == "name" {
			found = true
		}
		count++
	}
	if !found {
		t.Errorf("expected to find field named 'name'")
	}
	if count != 1 {
		t.Errorf("expected to find 1 find, found %d", count)
	}
}

func TestMappingForPath(t *testing.T) {

	enFieldMapping := NewTextFieldMapping()
	enFieldMapping.Analyzer = "en"

	docMappingA := NewDocumentMapping()
	docMappingA.AddFieldMappingsAt("name", enFieldMapping)

	customMapping := NewTextFieldMapping()
	customMapping.Analyzer = "xyz"
	customMapping.Name = "nameCustom"

	subDocMappingB := NewDocumentMapping()
	customFieldX := NewTextFieldMapping()
	customFieldX.Analyzer = "analyzerx"
	subDocMappingB.AddFieldMappingsAt("desc", customFieldX)

	docMappingA.AddFieldMappingsAt("author", enFieldMapping, customMapping)
	docMappingA.AddSubDocumentMapping("child", subDocMappingB)

	mapping := NewIndexMapping()
	mapping.AddDocumentMapping("a", docMappingA)

	analyzerName := mapping.AnalyzerNameForPath("name")
	if analyzerName != enFieldMapping.Analyzer {
		t.Errorf("expected '%s' got '%s'", enFieldMapping.Analyzer, analyzerName)
	}

	analyzerName = mapping.AnalyzerNameForPath("nameCustom")
	if analyzerName != customMapping.Analyzer {
		t.Errorf("expected '%s' got '%s'", customMapping.Analyzer, analyzerName)
	}

	analyzerName = mapping.AnalyzerNameForPath("child.desc")
	if analyzerName != customFieldX.Analyzer {
		t.Errorf("expected '%s' got '%s'", customFieldX.Analyzer, analyzerName)
	}

}

func TestMappingWithTokenizerDeps(t *testing.T) {

	tokNoDeps := map[string]interface{}{
		"type":   regexp.Name,
		"regexp": "",
	}

	tokDepsL1 := map[string]interface{}{
		"type":       exception.Name,
		"tokenizer":  "a",
		"exceptions": []string{".*"},
	}

	// this tests a 1-level dependency
	// it is run 100 times to increase the
	// likelihood that it fails along time way
	// (depends on key order iteration in map)
	for i := 0; i < 100; i++ {

		m := NewIndexMapping()
		ca := customAnalysis{
			Tokenizers: map[string]map[string]interface{}{
				"a": tokNoDeps,
				"b": tokDepsL1,
			},
		}
		err := ca.registerAll(m)
		if err != nil {
			t.Fatal(err)
		}
	}

	tokDepsL2 := map[string]interface{}{
		"type":       "exception",
		"tokenizer":  "b",
		"exceptions": []string{".*"},
	}

	// now test a second-level dependency
	for i := 0; i < 100; i++ {

		m := NewIndexMapping()
		ca := customAnalysis{
			Tokenizers: map[string]map[string]interface{}{
				"a": tokNoDeps,
				"b": tokDepsL1,
				"c": tokDepsL2,
			},
		}
		err := ca.registerAll(m)
		if err != nil {
			t.Fatal(err)
		}
	}

	tokUnsatisfied := map[string]interface{}{
		"type":      "exception",
		"tokenizer": "e",
	}

	// now make sure an unsatisfied dep still
	// results in an error
	m := NewIndexMapping()
	ca := customAnalysis{
		Tokenizers: map[string]map[string]interface{}{
			"a": tokNoDeps,
			"b": tokDepsL1,
			"c": tokDepsL2,
			"d": tokUnsatisfied,
		},
	}
	err := ca.registerAll(m)
	if err == nil {
		t.Fatal(err)
	}
}

func TestEnablingDisablingStoringDynamicFields(t *testing.T) {

	// first verify that with system defaults, dynamic field is stored
	data := map[string]interface{}{
		"name": "bleve",
	}
	doc := document.NewDocument("x")
	mapping := NewIndexMapping()
	err := mapping.MapDocument(doc, data)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range doc.Fields {
		if field.Name() == "name" && !field.Options().IsStored() {
			t.Errorf("expected field 'name' to be stored, isn't")
		}
	}

	// now change system level defaults, verify dynamic field is not stored
	StoreDynamic = false
	defer func() {
		StoreDynamic = true
	}()

	mapping = NewIndexMapping()
	doc = document.NewDocument("y")
	err = mapping.MapDocument(doc, data)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range doc.Fields {
		if field.Name() == "name" && field.Options().IsStored() {
			t.Errorf("expected field 'name' to be not stored, is")
		}
	}

	// now override the system level defaults inside the index mapping
	mapping = NewIndexMapping()
	mapping.StoreDynamic = true
	doc = document.NewDocument("y")
	err = mapping.MapDocument(doc, data)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range doc.Fields {
		if field.Name() == "name" && !field.Options().IsStored() {
			t.Errorf("expected field 'name' to be stored, isn't")
		}
	}
}

func TestMappingBool(t *testing.T) {
	boolMapping := NewBooleanFieldMapping()
	docMapping := NewDocumentMapping()
	docMapping.AddFieldMappingsAt("prop", boolMapping)
	mapping := NewIndexMapping()
	mapping.AddDocumentMapping("doc", docMapping)

	pprop := false
	x := struct {
		Prop  bool  `json:"prop"`
		PProp *bool `json:"pprop"`
	}{
		Prop:  true,
		PProp: &pprop,
	}

	doc := document.NewDocument("1")
	err := mapping.MapDocument(doc, x)
	if err != nil {
		t.Fatal(err)
	}
	foundProp := false
	foundPProp := false
	count := 0
	for _, f := range doc.Fields {
		if f.Name() == "prop" {
			foundProp = true
		}
		if f.Name() == "pprop" {
			foundPProp = true
		}
		count++
	}
	if !foundProp {
		t.Errorf("expected to find bool field named 'prop'")
	}
	if !foundPProp {
		t.Errorf("expected to find pointer to bool field named 'pprop'")
	}
	if count != 2 {
		t.Errorf("expected to find 2 fields, found %d", count)
	}
}

func TestDisableDefaultMapping(t *testing.T) {
	indexMapping := NewIndexMapping()
	indexMapping.DefaultMapping.Enabled = false

	data := map[string]string{
		"name": "bleve",
	}

	doc := document.NewDocument("x")
	err := indexMapping.MapDocument(doc, data)
	if err != nil {
		t.Error(err)
	}

	if len(doc.Fields) > 0 {
		t.Errorf("expected no fields, got %d", len(doc.Fields))
	}
}

func TestInvalidFieldMappingStrict(t *testing.T) {
	mappingBytes := []byte(`{"includeInAll":true,"name":"a parsed name"}`)

	// first unmarhsal it without strict
	var fm FieldMapping
	err := json.Unmarshal(mappingBytes, &fm)
	if err != nil {
		t.Fatal(err)
	}

	if fm.Name != "a parsed name" {
		t.Fatalf("expect to find field mapping name 'a parsed name', got '%s'", fm.Name)
	}

	// reset
	fm.Name = ""

	// now enable strict
	MappingJSONStrict = true
	defer func() {
		MappingJSONStrict = false
	}()

	expectedInvalidKeys := []string{"includeInAll"}
	expectedErr := fmt.Errorf("field mapping contains invalid keys: %v", expectedInvalidKeys)
	err = json.Unmarshal(mappingBytes, &fm)
	if err.Error() != expectedErr.Error() {
		t.Fatalf("expected err: %v, got err: %v", expectedErr, err)
	}

	if fm.Name != "a parsed name" {
		t.Fatalf("expect to find field mapping name 'a parsed name', got '%s'", fm.Name)
	}

}

func TestInvalidDocumentMappingStrict(t *testing.T) {
	mappingBytes := []byte(`{"defaultAnalyzer":true,"enabled":false}`)

	// first unmarhsal it without strict
	var dm DocumentMapping
	err := json.Unmarshal(mappingBytes, &dm)
	if err != nil {
		t.Fatal(err)
	}

	if dm.Enabled != false {
		t.Fatalf("expect to find document mapping enabled false, got '%t'", dm.Enabled)
	}

	// reset
	dm.Enabled = true

	// now enable strict
	MappingJSONStrict = true
	defer func() {
		MappingJSONStrict = false
	}()

	expectedInvalidKeys := []string{"defaultAnalyzer"}
	expectedErr := fmt.Errorf("document mapping contains invalid keys: %v", expectedInvalidKeys)
	err = json.Unmarshal(mappingBytes, &dm)
	if err.Error() != expectedErr.Error() {
		t.Fatalf("expected err: %v, got err: %v", expectedErr, err)
	}

	if dm.Enabled != false {
		t.Fatalf("expect to find document mapping enabled false, got '%t'", dm.Enabled)
	}
}

func TestInvalidIndexMappingStrict(t *testing.T) {
	mappingBytes := []byte(`{"typeField":"type","default_field":"all"}`)

	// first unmarhsal it without strict
	var im IndexMappingImpl
	err := json.Unmarshal(mappingBytes, &im)
	if err != nil {
		t.Fatal(err)
	}

	if im.DefaultField != "all" {
		t.Fatalf("expect to find index mapping default field 'all', got '%s'", im.DefaultField)
	}

	// reset
	im.DefaultField = "_all"

	// now enable strict
	MappingJSONStrict = true
	defer func() {
		MappingJSONStrict = false
	}()

	expectedInvalidKeys := []string{"typeField"}
	expectedErr := fmt.Errorf("index mapping contains invalid keys: %v", expectedInvalidKeys)
	err = json.Unmarshal(mappingBytes, &im)
	if err.Error() != expectedErr.Error() {
		t.Fatalf("expected err: %v, got err: %v", expectedErr, err)
	}

	if im.DefaultField != "all" {
		t.Fatalf("expect to find index mapping default field 'all', got '%s'", im.DefaultField)
	}
}

func TestMappingBug353(t *testing.T) {
	dataBytes := `{
  "Reviews": [
    {
      "ReviewID": "RX16692001",
      "Content": "Usually stay near the airport..."
    }
	],
	"Other": {
	  "Inside": "text"
  },
  "Name": "The Inn at Baltimore White Marsh"
}`

	var data map[string]interface{}
	err := json.Unmarshal([]byte(dataBytes), &data)
	if err != nil {
		t.Fatal(err)
	}

	reviewContentFieldMapping := NewTextFieldMapping()
	reviewContentFieldMapping.Analyzer = "crazy"

	reviewsMapping := NewDocumentMapping()
	reviewsMapping.Dynamic = false
	reviewsMapping.AddFieldMappingsAt("Content", reviewContentFieldMapping)
	otherMapping := NewDocumentMapping()
	otherMapping.Dynamic = false
	mapping := NewIndexMapping()
	mapping.DefaultMapping.AddSubDocumentMapping("Reviews", reviewsMapping)
	mapping.DefaultMapping.AddSubDocumentMapping("Other", otherMapping)

	doc := document.NewDocument("x")
	err = mapping.MapDocument(doc, data)
	if err != nil {
		t.Fatal(err)
	}

	// expect doc has only 2 fields
	if len(doc.Fields) != 2 {
		t.Errorf("expected doc with 2 fields, got: %d", len(doc.Fields))
		for _, f := range doc.Fields {
			t.Logf("field named: %s", f.Name())
		}
	}
}

func TestAnonymousStructFields(t *testing.T) {

	type Contact0 string

	type Contact1 struct {
		Name string
	}

	type Contact2 interface{}

	type Contact3 interface{}

	type Thing struct {
		Contact0
		Contact1
		Contact2
		Contact3
	}

	x := Thing{
		Contact0: "hello",
		Contact1: Contact1{
			Name: "marty",
		},
		Contact2: Contact1{
			Name: "will",
		},
		Contact3: "steve",
	}

	doc := document.NewDocument("1")
	m := NewIndexMapping()
	err := m.MapDocument(doc, x)
	if err != nil {
		t.Fatal(err)
	}

	if len(doc.Fields) != 4 {
		t.Fatalf("expected 4 fields, got %d", len(doc.Fields))
	}
	if doc.Fields[0].Name() != "Contact0" {
		t.Errorf("expected field named 'Contact0', got '%s'", doc.Fields[0].Name())
	}
	if doc.Fields[1].Name() != "Name" {
		t.Errorf("expected field named 'Name', got '%s'", doc.Fields[1].Name())
	}
	if doc.Fields[2].Name() != "Contact2.Name" {
		t.Errorf("expected field named 'Contact2.Name', got '%s'", doc.Fields[2].Name())
	}
	if doc.Fields[3].Name() != "Contact3" {
		t.Errorf("expected field named 'Contact3', got '%s'", doc.Fields[3].Name())
	}

	type AnotherThing struct {
		Contact0 `json:"Alternate0"`
		Contact1 `json:"Alternate1"`
		Contact2 `json:"Alternate2"`
		Contact3 `json:"Alternate3"`
	}

	y := AnotherThing{
		Contact0: "hello",
		Contact1: Contact1{
			Name: "marty",
		},
		Contact2: Contact1{
			Name: "will",
		},
		Contact3: "steve",
	}

	doc2 := document.NewDocument("2")
	err = m.MapDocument(doc2, y)
	if err != nil {
		t.Fatal(err)
	}

	if len(doc2.Fields) != 4 {
		t.Fatalf("expected 4 fields, got %d", len(doc2.Fields))
	}
	if doc2.Fields[0].Name() != "Alternate0" {
		t.Errorf("expected field named 'Alternate0', got '%s'", doc2.Fields[0].Name())
	}
	if doc2.Fields[1].Name() != "Alternate1.Name" {
		t.Errorf("expected field named 'Name', got '%s'", doc2.Fields[1].Name())
	}
	if doc2.Fields[2].Name() != "Alternate2.Name" {
		t.Errorf("expected field named 'Alternate2.Name', got '%s'", doc2.Fields[2].Name())
	}
	if doc2.Fields[3].Name() != "Alternate3" {
		t.Errorf("expected field named 'Alternate3', got '%s'", doc2.Fields[3].Name())
	}
}

func TestAnonymousStructFieldWithJSONStructTagEmptString(t *testing.T) {
	type InterfaceThing interface{}
	type Thing struct {
		InterfaceThing `json:""`
	}

	x := Thing{
		InterfaceThing: map[string]interface{}{
			"key": "value",
		},
	}

	doc := document.NewDocument("1")
	m := NewIndexMapping()
	err := m.MapDocument(doc, x)
	if err != nil {
		t.Fatal(err)
	}

	if len(doc.Fields) != 1 {
		t.Fatalf("expected 1 field, got %d", len(doc.Fields))
	}
	if doc.Fields[0].Name() != "key" {
		t.Errorf("expected field named 'key', got '%s'", doc.Fields[0].Name())
	}
}

func TestMappingPrimitives(t *testing.T) {

	tests := []struct {
		data interface{}
	}{
		{data: "marty"},
		{data: int(1)},
		{data: int8(2)},
		{data: int16(3)},
		{data: int32(4)},
		{data: int64(5)},
		{data: uint(6)},
		{data: uint8(7)},
		{data: uint16(8)},
		{data: uint32(9)},
		{data: uint64(10)},
		{data: float32(11.0)},
		{data: float64(12.0)},
		{data: false},
	}

	m := NewIndexMapping()
	for _, test := range tests {
		doc := document.NewDocument("x")
		err := m.MapDocument(doc, test.data)
		if err != nil {
			t.Fatal(err)
		}
		if len(doc.Fields) != 1 {
			t.Errorf("expected 1 field, got %d for %v", len(doc.Fields), test.data)
		}
	}
}

func TestMappingForGeo(t *testing.T) {

	type Location struct {
		Lat float64
		Lon float64
	}

	nameFieldMapping := NewTextFieldMapping()
	nameFieldMapping.Name = "name"
	nameFieldMapping.Analyzer = "standard"

	locFieldMapping := NewGeoPointFieldMapping()

	thingMapping := NewDocumentMapping()
	thingMapping.AddFieldMappingsAt("name", nameFieldMapping)
	thingMapping.AddFieldMappingsAt("location", locFieldMapping)

	mapping := NewIndexMapping()
	mapping.DefaultMapping = thingMapping

	geopoints := []interface{}{}
	expect := [][]float64{} // to contain expected [lon,lat] for geopoints

	// geopoint as a struct
	geopoints = append(geopoints, struct {
		Name     string    `json:"name"`
		Location *Location `json:"location"`
	}{
		Name: "struct",
		Location: &Location{
			Lon: -180,
			Lat: -90,
		},
	})
	expect = append(expect, []float64{-180, -90})

	// geopoint as a map
	geopoints = append(geopoints, struct {
		Name     string                 `json:"name"`
		Location map[string]interface{} `json:"location"`
	}{
		Name: "map",
		Location: map[string]interface{}{
			"lon": -180,
			"lat": -90,
		},
	})
	expect = append(expect, []float64{-180, -90})

	// geopoint as a slice, format: {lon, lat}
	geopoints = append(geopoints, struct {
		Name     string        `json:"name"`
		Location []interface{} `json:"location"`
	}{
		Name: "slice",
		Location: []interface{}{
			-180, -90,
		},
	})
	expect = append(expect, []float64{-180, -90})

	// geopoint as a string, format: "lat,lon"
	geopoints = append(geopoints, struct {
		Name     string        `json:"name"`
		Location []interface{} `json:"location"`
	}{
		Name: "string",
		Location: []interface{}{
			"-90,-180",
		},
	})
	expect = append(expect, []float64{-180, -90})

	// geopoint as a string, format: "lat , lon" with leading/trailing whitespaces
	geopoints = append(geopoints, struct {
		Name     string        `json:"name"`
		Location []interface{} `json:"location"`
	}{
		Name: "string",
		Location: []interface{}{
			"-90    ,    -180",
		},
	})
	expect = append(expect, []float64{-180, -90})

	// geopoint as a string - geohash
	geopoints = append(geopoints, struct {
		Name     string        `json:"name"`
		Location []interface{} `json:"location"`
	}{
		Name: "string",
		Location: []interface{}{
			"000000000000",
		},
	})
	expect = append(expect, []float64{-180, -90})

	// geopoint as a string - geohash
	geopoints = append(geopoints, struct {
		Name     string        `json:"name"`
		Location []interface{} `json:"location"`
	}{
		Name: "string",
		Location: []interface{}{
			"drm3btev3e86",
		},
	})
	expect = append(expect, []float64{-71.34, 41.12})

	for i, geopoint := range geopoints {
		doc := document.NewDocument(string(i))
		err := mapping.MapDocument(doc, geopoint)
		if err != nil {
			t.Fatal(err)
		}

		var foundGeo bool
		for _, f := range doc.Fields {
			if f.Name() == "location" {
				foundGeo = true
				geoF, ok := f.(*document.GeoPointField)
				if !ok {
					t.Errorf("expected a geopoint field!")
				}
				lon, err := geoF.Lon()
				if err != nil {
					t.Errorf("error in fetching lon, err: %v", err)
				}
				lat, err := geoF.Lat()
				if err != nil {
					t.Errorf("error in fetching lat, err: %v", err)
				}
				// round obtained lon, lat to 2 decimal places
				roundLon, _ := strconv.ParseFloat(fmt.Sprintf("%.2f", lon), 64)
				roundLat, _ := strconv.ParseFloat(fmt.Sprintf("%.2f", lat), 64)
				if roundLon != expect[i][0] || roundLat != expect[i][1] {
					t.Errorf("expected geo point: {%v, %v}, got {%v, %v}",
						expect[i][0], expect[i][1], lon, lat)
				}
			}
		}

		if !foundGeo {
			t.Errorf("expected to find geo point, did not")
		}
	}
}

type textMarshalable struct {
	body  string
	Extra string
}

func (t *textMarshalable) MarshalText() ([]byte, error) {
	return []byte(t.body), nil
}

func TestMappingForTextMarshaler(t *testing.T) {
	tm := struct {
		Marshalable *textMarshalable
	}{
		Marshalable: &textMarshalable{
			body:  "text",
			Extra: "stuff",
		},
	}

	// first verify that when using a mapping that doesn't explicitly
	// map the stuct field as text, then we traverse inside the struct
	// and do our best
	m := NewIndexMapping()
	doc := document.NewDocument("x")
	err := m.MapDocument(doc, tm)
	if err != nil {
		t.Fatal(err)
	}

	if len(doc.Fields) != 1 {
		t.Fatalf("expected 1 field, got: %d", len(doc.Fields))
	}
	if doc.Fields[0].Name() != "Marshalable.Extra" {
		t.Errorf("expected field to be named 'Marshalable.Extra', got: '%s'", doc.Fields[0].Name())
	}
	if string(doc.Fields[0].Value()) != tm.Marshalable.Extra {
		t.Errorf("expected field value to be '%s', got: '%s'", tm.Marshalable.Extra, string(doc.Fields[0].Value()))
	}

	// now verify that when a mapping explicitly
	m = NewIndexMapping()
	txt := NewTextFieldMapping()
	m.DefaultMapping.AddFieldMappingsAt("Marshalable", txt)
	doc = document.NewDocument("x")
	err = m.MapDocument(doc, tm)
	if err != nil {
		t.Fatal(err)
	}

	if len(doc.Fields) != 1 {
		t.Fatalf("expected 1 field, got: %d", len(doc.Fields))

	}
	if doc.Fields[0].Name() != "Marshalable" {
		t.Errorf("expected field to be named 'Marshalable', got: '%s'", doc.Fields[0].Name())
	}
	want, err := tm.Marshalable.MarshalText()
	if err != nil {
		t.Fatal(err)
	}
	if string(doc.Fields[0].Value()) != string(want) {
		t.Errorf("expected field value to be  '%s', got: '%s'", string(want), string(doc.Fields[0].Value()))
	}

}

func TestMappingForNilTextMarshaler(t *testing.T) {
	tm := struct {
		Marshalable *time.Time
	}{
		Marshalable: nil,
	}

	// now verify that when a mapping explicitly
	m := NewIndexMapping()
	txt := NewTextFieldMapping()
	m.DefaultMapping.AddFieldMappingsAt("Marshalable", txt)
	doc := document.NewDocument("x")
	err := m.MapDocument(doc, tm)
	if err != nil {
		t.Fatal(err)
	}

	if len(doc.Fields) != 0 {
		t.Fatalf("expected 1 field, got: %d", len(doc.Fields))

	}

}

func TestClosestDocDynamicMapping(t *testing.T) {
	mapping := NewIndexMapping()
	mapping.IndexDynamic = false
	mapping.DefaultMapping = NewDocumentStaticMapping()
	mapping.DefaultMapping.AddFieldMappingsAt("foo", NewTextFieldMapping())

	doc := document.NewDocument("x")
	err := mapping.MapDocument(doc, map[string]interface{}{
		"foo": "value",
		"bar": map[string]string{
			"foo": "value2",
			"baz": "value3",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	if len(doc.Fields) != 1 {
		t.Fatalf("expected 1 field, got: %d", len(doc.Fields))
	}
}
