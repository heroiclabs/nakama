package main

type Swagger struct {
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
				Type string
			}
			Schema Schema // used with http body
		}
		Security []map[string][]struct{}
	}
	Tags []struct {
		Name string
	}
	Definitions map[string]*Definition
}

// Schema is the parameters body schema
type Schema struct {
	Type       string
	Ref        string `json:"$ref"`
	Properties map[string]*Property
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
	Type  string
	Ref   string   `json:"$ref"` // used with object
	Items struct { // used with type "array"
		Type string
		Ref  string `json:"$ref"`
	}
	AdditionalProperties struct { // used for dictionaries with string keys (Property.Type=object)
		Type string
		Ref  string `json:"$ref"`
	}
	Description string
	Title       string
	Format      string // used with type "boolean"
}
