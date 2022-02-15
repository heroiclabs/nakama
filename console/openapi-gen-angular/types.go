package main

type Schema struct {
	Paths map[string]map[string]*struct {
		Summary     string
		OperationId string
		Responses   struct {
			Ok struct {
				Schema struct {
					Ref string `json:"$ref"`
				}
			} `json:"200"`
		}
		Parameters []*struct {
			Name     string
			In       string // path, query or body
			Required bool
			Type     string   // used with primitives
			Items    struct { // used with type "array"
				Type 	string
			}
			Schema struct { // used with http body
				Type string
				Ref  string `json:"$ref"`
				Properties map[string]*Property
			}
		}
		Security []map[string][]struct{}
	}
	Tags []struct {
		Name string
	}
	Definitions map[string]Definition
}

// Definition is the schema for interfaces and enums
type Definition struct {
	Properties  map[string]*Property
	Enum        []string
	Description string
	// used only by enums
	Title string
}

// Property of the field
type Property struct {
	Type 				string
	Ref   			string   `json:"$ref"` // used with object
	Items struct { // used with type "array"
		Type string
		Ref  string `json:"$ref"`
	}
	AdditionalProperties struct { // used for dictionaries with string keys (Property.Type=object)
		Type 			string
	}
	Description string
	Title 			string
	Format      string // used with type "boolean"
}
