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

package unicode

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/segment"
)

func TestUnicode(t *testing.T) {

	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		{
			[]byte("Hello World"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      5,
					Term:     []byte("Hello"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    6,
					End:      11,
					Term:     []byte("World"),
					Position: 2,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("steven's"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      8,
					Term:     []byte("steven's"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("こんにちは世界"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      3,
					Term:     []byte("こ"),
					Position: 1,
					Type:     analysis.Ideographic,
				},
				{
					Start:    3,
					End:      6,
					Term:     []byte("ん"),
					Position: 2,
					Type:     analysis.Ideographic,
				},
				{
					Start:    6,
					End:      9,
					Term:     []byte("に"),
					Position: 3,
					Type:     analysis.Ideographic,
				},
				{
					Start:    9,
					End:      12,
					Term:     []byte("ち"),
					Position: 4,
					Type:     analysis.Ideographic,
				},
				{
					Start:    12,
					End:      15,
					Term:     []byte("は"),
					Position: 5,
					Type:     analysis.Ideographic,
				},
				{
					Start:    15,
					End:      18,
					Term:     []byte("世"),
					Position: 6,
					Type:     analysis.Ideographic,
				},
				{
					Start:    18,
					End:      21,
					Term:     []byte("界"),
					Position: 7,
					Type:     analysis.Ideographic,
				},
			},
		},
		{
			[]byte("age 25"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      3,
					Term:     []byte("age"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    4,
					End:      6,
					Term:     []byte("25"),
					Position: 2,
					Type:     analysis.Numeric,
				},
			},
		},
		{
			[]byte("カ"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      3,
					Term:     []byte("カ"),
					Position: 1,
					Type:     analysis.Ideographic,
				},
			},
		},
	}

	for _, test := range tests {
		tokenizer := NewUnicodeTokenizer()
		actual := tokenizer.Tokenize(test.input)

		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("Expected %v, got %v for %s", test.output, actual, string(test.input))
		}
	}
}

var sampleLargeInput = []byte(`There are three characteristics of liquids which are relevant to the discussion of a BLEVE:
If a liquid in a sealed container is boiled, the pressure inside the container increases. As the liquid changes to a gas it expands - this expansion in a vented container would cause the gas and liquid to take up more space. In a sealed container the gas and liquid are not able to take up more space and so the pressure rises. Pressurized vessels containing liquids can reach an equilibrium where the liquid stops boiling and the pressure stops rising. This occurs when no more heat is being added to the system (either because it has reached ambient temperature or has had a heat source removed).
The boiling temperature of a liquid is dependent on pressure - high pressures will yield high boiling temperatures, and low pressures will yield low boiling temperatures. A common simple experiment is to place a cup of water in a vacuum chamber, and then reduce the pressure in the chamber until the water boils. By reducing the pressure the water will boil even at room temperature. This works both ways - if the pressure is increased beyond normal atmospheric pressures, the boiling of hot water could be suppressed far beyond normal temperatures. The cooling system of a modern internal combustion engine is a real-world example.
When a liquid boils it turns into a gas. The resulting gas takes up far more space than the liquid did.
Typically, a BLEVE starts with a container of liquid which is held above its normal, atmospheric-pressure boiling temperature. Many substances normally stored as liquids, such as CO2, oxygen, and other similar industrial gases have boiling temperatures, at atmospheric pressure, far below room temperature. In the case of water, a BLEVE could occur if a pressurized chamber of water is heated far beyond the standard 100 °C (212 °F). That container, because the boiling water pressurizes it, is capable of holding liquid water at very high temperatures.
If the pressurized vessel, containing liquid at high temperature (which may be room temperature, depending on the substance) ruptures, the pressure which prevents the liquid from boiling is lost. If the rupture is catastrophic, where the vessel is immediately incapable of holding any pressure at all, then there suddenly exists a large mass of liquid which is at very high temperature and very low pressure. This causes the entire volume of liquid to instantaneously boil, which in turn causes an extremely rapid expansion. Depending on temperatures, pressures and the substance involved, that expansion may be so rapid that it can be classified as an explosion, fully capable of inflicting severe damage on its surroundings.`)

func BenchmarkTokenizeEnglishText(b *testing.B) {

	tokenizer := NewUnicodeTokenizer()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		tokenizer.Tokenize(sampleLargeInput)
	}

}

func TestConvertType(t *testing.T) {
	tests := []struct {
		in  int
		out analysis.TokenType
	}{
		{
			segment.Ideo, analysis.Ideographic,
		},
		{
			segment.Kana, analysis.Ideographic,
		},
		{
			segment.Number, analysis.Numeric,
		},
		{
			segment.Letter, analysis.AlphaNumeric,
		},
	}

	for _, test := range tests {
		actual := convertType(test.in)
		if actual != test.out {
			t.Errorf("expected %d, got %d for %d", test.out, actual, test.in)
		}
	}
}
