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

package pt

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestPortugueseLightStemmer(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("doutores"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("doutor"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("doutor"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("doutor"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("homens"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("homem"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("homem"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("homem"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("papéis"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("papel"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("papel"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("papel"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("normais"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("normal"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("normal"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("normal"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("lencóis"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("lencol"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("lencol"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("lencol"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("barris"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("barril"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("barril"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("barril"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("botões"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("bota"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("botão"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("bota"),
				},
			},
		},
		// longer
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("o"),
				},
				&analysis.Token{
					Term: []byte("debate"),
				},
				&analysis.Token{
					Term: []byte("político"),
				},
				&analysis.Token{
					Term: []byte("pelo"),
				},
				&analysis.Token{
					Term: []byte("menos"),
				},
				&analysis.Token{
					Term: []byte("o"),
				},
				&analysis.Token{
					Term: []byte("que"),
				},
				&analysis.Token{
					Term: []byte("vem"),
				},
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("público"),
				},
				&analysis.Token{
					Term: []byte("parece"),
				},
				&analysis.Token{
					Term: []byte("de"),
				},
				&analysis.Token{
					Term: []byte("modo"),
				},
				&analysis.Token{
					Term: []byte("nada"),
				},
				&analysis.Token{
					Term: []byte("surpreendente"),
				},
				&analysis.Token{
					Term: []byte("restrito"),
				},
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("temas"),
				},
				&analysis.Token{
					Term: []byte("menores"),
				},
				&analysis.Token{
					Term: []byte("mas"),
				},
				&analysis.Token{
					Term: []byte("há"),
				},
				&analysis.Token{
					Term: []byte("evidentemente"),
				},
				&analysis.Token{
					Term: []byte("grandes"),
				},
				&analysis.Token{
					Term: []byte("questões"),
				},
				&analysis.Token{
					Term: []byte("em"),
				},
				&analysis.Token{
					Term: []byte("jogo"),
				},
				&analysis.Token{
					Term: []byte("nas"),
				},
				&analysis.Token{
					Term: []byte("eleições"),
				},
				&analysis.Token{
					Term: []byte("que"),
				},
				&analysis.Token{
					Term: []byte("se"),
				},
				&analysis.Token{
					Term: []byte("aproximam"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("o"),
				},
				&analysis.Token{
					Term: []byte("debat"),
				},
				&analysis.Token{
					Term: []byte("politic"),
				},
				&analysis.Token{
					Term: []byte("pelo"),
				},
				&analysis.Token{
					Term: []byte("meno"),
				},
				&analysis.Token{
					Term: []byte("o"),
				},
				&analysis.Token{
					Term: []byte("que"),
				},
				&analysis.Token{
					Term: []byte("vem"),
				},
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("public"),
				},
				&analysis.Token{
					Term: []byte("parec"),
				},
				&analysis.Token{
					Term: []byte("de"),
				},
				&analysis.Token{
					Term: []byte("modo"),
				},
				&analysis.Token{
					Term: []byte("nada"),
				},
				&analysis.Token{
					Term: []byte("surpreendent"),
				},
				&analysis.Token{
					Term: []byte("restrit"),
				},
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("tema"),
				},
				&analysis.Token{
					Term: []byte("menor"),
				},
				&analysis.Token{
					Term: []byte("mas"),
				},
				&analysis.Token{
					Term: []byte("há"),
				},
				&analysis.Token{
					Term: []byte("evident"),
				},
				&analysis.Token{
					Term: []byte("grand"),
				},
				&analysis.Token{
					Term: []byte("questa"),
				},
				&analysis.Token{
					Term: []byte("em"),
				},
				&analysis.Token{
					Term: []byte("jogo"),
				},
				&analysis.Token{
					Term: []byte("nas"),
				},
				&analysis.Token{
					Term: []byte("eleica"),
				},
				&analysis.Token{
					Term: []byte("que"),
				},
				&analysis.Token{
					Term: []byte("se"),
				},
				&analysis.Token{
					Term: []byte("aproximam"),
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
