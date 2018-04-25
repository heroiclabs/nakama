package mapping

import (
	"reflect"
	"testing"
)

func TestLookupPropertyPath(t *testing.T) {
	tests := []struct {
		input  interface{}
		path   string
		output interface{}
	}{
		{
			input: map[string]interface{}{
				"Type": "a",
			},
			path:   "Type",
			output: "a",
		},
		{
			input: struct {
				Type string
			}{
				Type: "b",
			},
			path:   "Type",
			output: "b",
		},
		{
			input: &struct {
				Type string
			}{
				Type: "b",
			},
			path:   "Type",
			output: "b",
		},
	}

	for _, test := range tests {
		actual := lookupPropertyPath(test.input, test.path)
		if !reflect.DeepEqual(actual, test.output) {
			t.Fatalf("expected '%v', got '%v', for path '%s' in  %+v", test.output, actual, test.path, test.input)
		}
	}
}
