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

package fr

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestFrenchLightStemmer(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chevaux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("cheval"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("cheval"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("cheval"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("hiboux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("hibou"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("hibou"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("hibou"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chantés"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chanter"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chante"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chant"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baronnes"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baron"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("barons"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baron"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baron"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baron"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("peaux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("peau"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("peau"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("peau"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("anneaux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("aneau"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("anneau"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("aneau"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("neveux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("neveu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("neveu"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("neveu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("affreux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("afreu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("affreuse"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("afreu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("investissement"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("investi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("investir"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("investi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("assourdissant"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("asourdi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("assourdir"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("asourdi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("pratiquement"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("pratiqu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("pratique"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("pratiqu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("administrativement"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("administratif"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("administratif"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("administratif"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("justificatrice"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("justifi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("justificateur"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("justifi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("justifier"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("justifi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("educatrice"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("eduqu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("eduquer"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("eduqu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("communicateur"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("comuniqu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("communiquer"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("comuniqu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("accompagnatrice"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("acompagn"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("accompagnateur"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("acompagn"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("administrateur"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("administr"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("administrer"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("administr"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("productrice"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("product"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("producteur"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("product"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("acheteuse"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("achet"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("acheteur"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("achet"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("planteur"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("plant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("plante"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("plant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("poreuse"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("poreu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("poreux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("poreu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("plieuse"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("plieu"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("bijoutière"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("bijouti"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("bijoutier"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("bijouti"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("caissière"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("caisi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("caissier"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("caisi"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abrasive"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abrasif"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abrasif"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abrasif"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("folle"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("fou"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("fou"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("fou"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("personnelle"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("person"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("personne"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("person"),
				},
			},
		},
		// algo bug: too short length
		// {
		// 	input: analysis.TokenStream{
		// 		&analysis.Token{
		// 			Term: []byte("personnel"),
		// 		},
		// 	},
		// 	output: analysis.TokenStream{
		// 		&analysis.Token{
		// 			Term: []byte("person"),
		// 		},
		// 	},
		// },
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("complète"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("complet"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("complet"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("complet"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("aromatique"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("aromat"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("faiblesse"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("faibl"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("faible"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("faibl"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("patinage"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("patin"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("patin"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("patin"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("sonorisation"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("sono"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ritualisation"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("rituel"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("rituel"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("rituel"),
				},
			},
		},
		// algo bug: masked by rules above
		// {
		// 	input: analysis.TokenStream{
		// 		&analysis.Token{
		// 			Term: []byte("colonisateur"),
		// 		},
		// 	},
		// 	output: analysis.TokenStream{
		// 		&analysis.Token{
		// 			Term: []byte("colon"),
		// 		},
		// 	},
		// },
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("nomination"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("nomin"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("disposition"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("dispos"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("dispose"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("dispos"),
				},
			},
		},
		// SOLR-3463 : abusive compression of repeated characters in numbers
		// Trailing repeated char elision :
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("1234555"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("1234555"),
				},
			},
		},
		// Repeated char within numbers with more than 4 characters :
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("12333345"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("12333345"),
				},
			},
		},
		// Short numbers weren't affected already:
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("1234"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("1234"),
				},
			},
		},
		// Ensure behaviour is preserved for words!
		// Trailing repeated char elision :
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcdeff"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcdef"),
				},
			},
		},
		// Repeated char within words with more than 4 characters :
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcccddeef"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcdef"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("créées"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("cre"),
				},
			},
		},
		// Combined letter and digit repetition
		// 10:00pm
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("22hh00"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("22h00"),
				},
			},
		},
		// bug #214
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("propriétaire"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("proprietair"),
				},
			},
		},
	}

	cache := registry.NewCache()
	filter, err := cache.TokenFilterNamed(LightStemmerName)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range tests {
		actual := filter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output[0].Term, actual[0].Term)
		}
	}
}
