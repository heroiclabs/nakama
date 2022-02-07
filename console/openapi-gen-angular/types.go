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
		Parameters []struct {
			Name     string
			In       string // path, query or body
			Required bool
			Type     string   // used with primitives
			Items    struct { // used with type "array"
				Type string
			}
			Schema struct { // used with http body
				Type string
				Ref  string `json:"$ref"`
				Properties map[string]struct { // used when there are parameters outside body
					Type string
					Description string
					AdditionalProperties struct { // used for dictionaries with string keys (Type=object)
						Type string
					}
				}
			}
		}
		Security []map[string][]struct{}
	}
	Tags []struct {
		Name string
	}
	Definitions map[string]Definition
}

type Definition struct {
	Properties map[string]*struct {
		Type  string
		Ref   string   `json:"$ref"` // used with object
		Items struct { // used with type "array"
			Type string
			Ref  string `json:"$ref"`
		}
		AdditionalProperties struct {
			Type string // used with type "map"
		}
		Format      string // used with type "boolean"
		Description string
	}
	Enum        []string
	Description string
	// used only by enums
	Title string
}
