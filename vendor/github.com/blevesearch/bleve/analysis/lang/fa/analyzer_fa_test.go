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

package fa

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestPersianAnalyzerVerbs(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		// active present indicative
		{
			input: []byte("می‌خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active preterite indicative
		{
			input: []byte("خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active imperfective preterite indicative
		{
			input: []byte("می‌خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active future indicative
		{
			input: []byte("خواهد خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active present progressive indicative
		{
			input: []byte("دارد می‌خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active preterite progressive indicative
		{
			input: []byte("داشت می‌خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active perfect indicative
		{
			input: []byte("خورده‌است"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active imperfective perfect indicative
		{
			input: []byte("می‌خورده‌است"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active pluperfect indicative
		{
			input: []byte("خورده بود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active imperfective pluperfect indicative
		{
			input: []byte("می‌خورده بود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active preterite subjunctive
		{
			input: []byte("خورده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active imperfective preterite subjunctive
		{
			input: []byte("می‌خورده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active pluperfect subjunctive
		{
			input: []byte("خورده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active imperfective pluperfect subjunctive
		{
			input: []byte("می‌خورده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive present indicative
		{
			input: []byte("خورده می‌شود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive preterite indicative
		{
			input: []byte("خورده شد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective preterite indicative
		{
			input: []byte("خورده می‌شد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive perfect indicative
		{
			input: []byte("خورده شده‌است"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective perfect indicative
		{
			input: []byte("خورده می‌شده‌است"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive pluperfect indicative
		{
			input: []byte("خورده شده بود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective pluperfect indicative
		{
			input: []byte("خورده می‌شده بود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive future indicative
		{
			input: []byte("خورده خواهد شد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive present progressive indicative
		{
			input: []byte("دارد خورده می‌شود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive preterite progressive indicative
		{
			input: []byte("داشت خورده می‌شد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive present subjunctive
		{
			input: []byte("خورده شود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive preterite subjunctive
		{
			input: []byte("خورده شده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective preterite subjunctive
		{
			input: []byte("خورده می‌شده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive pluperfect subjunctive
		{
			input: []byte("خورده شده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective pluperfect subjunctive
		{
			input: []byte("خورده می‌شده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active present subjunctive
		{
			input: []byte("بخورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("بخورد"),
				},
			},
		},
	}

	cache := registry.NewCache()
	analyzer, err := cache.AnalyzerNamed(AnalyzerName)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range tests {
		actual := analyzer.Analyze(test.input)
		if len(actual) != len(test.output) {
			t.Fatalf("expected length: %d, got %d", len(test.output), len(actual))
		}
		for i, tok := range actual {
			if !reflect.DeepEqual(tok.Term, test.output[i].Term) {
				t.Errorf("expected term %s (% x) got %s (% x)", test.output[i].Term, test.output[i].Term, tok.Term, tok.Term)
			}
		}
	}
}

func TestPersianAnalyzerVerbsDefective(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		// active present indicative
		{
			input: []byte("مي خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active preterite indicative
		{
			input: []byte("خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active imperfective preterite indicative
		{
			input: []byte("مي خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active future indicative
		{
			input: []byte("خواهد خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active present progressive indicative
		{
			input: []byte("دارد مي خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active preterite progressive indicative
		{
			input: []byte("داشت مي خورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورد"),
				},
			},
		},
		// active perfect indicative
		{
			input: []byte("خورده است"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active imperfective perfect indicative
		{
			input: []byte("مي خورده است"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active pluperfect indicative
		{
			input: []byte("خورده بود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active imperfective pluperfect indicative
		{
			input: []byte("مي خورده بود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active preterite subjunctive
		{
			input: []byte("خورده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active imperfective preterite subjunctive
		{
			input: []byte("مي خورده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active pluperfect subjunctive
		{
			input: []byte("خورده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active imperfective pluperfect subjunctive
		{
			input: []byte("مي خورده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive present indicative
		{
			input: []byte("خورده مي شود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive preterite indicative
		{
			input: []byte("خورده شد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective preterite indicative
		{
			input: []byte("خورده مي شد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive perfect indicative
		{
			input: []byte("خورده شده است"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective perfect indicative
		{
			input: []byte("خورده مي شده است"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive pluperfect indicative
		{
			input: []byte("خورده شده بود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective pluperfect indicative
		{
			input: []byte("خورده مي شده بود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive future indicative
		{
			input: []byte("خورده خواهد شد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive present progressive indicative
		{
			input: []byte("دارد خورده مي شود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive preterite progressive indicative
		{
			input: []byte("داشت خورده مي شد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive present subjunctive
		{
			input: []byte("خورده شود"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive preterite subjunctive
		{
			input: []byte("خورده شده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective preterite subjunctive
		{
			input: []byte("خورده مي شده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive pluperfect subjunctive
		{
			input: []byte("خورده شده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// passive imperfective pluperfect subjunctive
		{
			input: []byte("خورده مي شده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		// active present subjunctive
		{
			input: []byte("بخورد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("بخورد"),
				},
			},
		},
	}

	cache := registry.NewCache()
	analyzer, err := cache.AnalyzerNamed(AnalyzerName)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range tests {
		actual := analyzer.Analyze(test.input)
		if len(actual) != len(test.output) {
			t.Fatalf("expected length: %d, got %d", len(test.output), len(actual))
		}
		for i, tok := range actual {
			if !reflect.DeepEqual(tok.Term, test.output[i].Term) {
				t.Errorf("expected term %s (% x) got %s (% x)", test.output[i].Term, test.output[i].Term, tok.Term, tok.Term)
			}
		}
	}
}

func TestPersianAnalyzerOthers(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		// nouns
		{
			input: []byte("برگ ها"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("برگ"),
				},
			},
		},
		{
			input: []byte("برگ‌ها"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("برگ"),
				},
			},
		},
		// non persian
		{
			input: []byte("English test."),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("english"),
				},
				&analysis.Token{
					Term: []byte("test"),
				},
			},
		},
		// others
		{
			input: []byte("خورده مي شده بوده باشد"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("خورده"),
				},
			},
		},
		{
			input: []byte("برگ‌ها"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("برگ"),
				},
			},
		},
	}

	cache := registry.NewCache()
	analyzer, err := cache.AnalyzerNamed(AnalyzerName)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range tests {
		actual := analyzer.Analyze(test.input)
		if len(actual) != len(test.output) {
			t.Fatalf("expected length: %d, got %d", len(test.output), len(actual))
		}
		for i, tok := range actual {
			if !reflect.DeepEqual(tok.Term, test.output[i].Term) {
				t.Errorf("expected term %s (% x) got %s (% x)", test.output[i].Term, test.output[i].Term, tok.Term, tok.Term)
			}
		}
	}
}
