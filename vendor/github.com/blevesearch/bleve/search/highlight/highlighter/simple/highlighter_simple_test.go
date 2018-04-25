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

package simple

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/highlight/format/ansi"
	sfrag "github.com/blevesearch/bleve/search/highlight/fragmenter/simple"
)

const (
	reset                = "\x1b[0m"
	DefaultAnsiHighlight = "\x1b[43m"
)

func TestSimpleHighlighter(t *testing.T) {
	fragmenter := sfrag.NewFragmenter(100)
	formatter := ansi.NewFragmentFormatter(ansi.DefaultAnsiHighlight)
	highlighter := NewHighlighter(fragmenter, formatter, DefaultSeparator)

	docMatch := search.DocumentMatch{
		ID:    "a",
		Score: 1.0,
		Locations: search.FieldTermLocationMap{
			"desc": search.TermLocationMap{
				"quick": []*search.Location{
					{
						Pos:   2,
						Start: 4,
						End:   9,
					},
				},
				"fox": []*search.Location{
					{
						Pos:   4,
						Start: 16,
						End:   19,
					},
				},
			},
		},
	}

	expectedFragment := "the " + DefaultAnsiHighlight + "quick" + reset + " brown " + DefaultAnsiHighlight + "fox" + reset + " jumps over the lazy dog"
	doc := document.NewDocument("a").AddField(document.NewTextField("desc", []uint64{}, []byte("the quick brown fox jumps over the lazy dog")))

	fragment := highlighter.BestFragmentInField(&docMatch, doc, "desc")
	if fragment != expectedFragment {
		t.Errorf("expected `%s`, got `%s`", expectedFragment, fragment)
	}
}

func TestSimpleHighlighterLonger(t *testing.T) {

	fieldBytes := []byte(`Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mauris sed semper nulla, sed pellentesque urna. Suspendisse potenti. Aliquam dignissim pulvinar erat vel ullamcorper. Nullam sed diam at dolor dapibus varius. Vestibulum at semper nunc. Integer ullamcorper enim ut nisi condimentum lacinia. Nulla ipsum ipsum, dictum in dapibus non, bibendum eget neque. Vestibulum malesuada erat quis malesuada dictum. Mauris luctus viverra lorem, nec hendrerit lacus lacinia ut. Donec suscipit sit amet nisi et dictum. Maecenas ultrices mollis diam, vel commodo libero lobortis nec. Nunc non dignissim dolor. Nulla non tempus risus, eget porttitor lectus. Suspendisse vitae gravida magna, a sagittis urna. Curabitur nec dui volutpat, hendrerit nisi non, adipiscing erat. Maecenas aliquet sem sit amet nibh ultrices accumsan.

Mauris lobortis sem sed blandit bibendum. In scelerisque eros sed metus aliquet convallis ac eget metus. Donec eget feugiat sem. Quisque venenatis, augue et blandit vulputate, velit odio viverra dolor, eu iaculis eros urna ut nunc. Duis faucibus mattis enim ut ultricies. Donec scelerisque volutpat elit, vel varius ante porttitor vel. Duis neque nulla, ultrices vel est id, molestie semper odio. Maecenas condimentum felis vitae nibh venenatis, ut feugiat risus vehicula. Suspendisse non sapien neque. Etiam et lorem consequat lorem aliquam ullamcorper. Pellentesque id vestibulum neque, at aliquam turpis. Aenean ultrices nec erat sit amet aliquam. Morbi eu sem in augue cursus ullamcorper a sed dolor. Integer et lobortis nulla, sit amet laoreet elit. In elementum, nibh nec volutpat pretium, lectus est pulvinar arcu, vehicula lobortis tellus sem id mauris. Maecenas ac blandit purus, sit amet scelerisque magna.

In hac habitasse platea dictumst. In lacinia elit non risus venenatis viverra. Nulla vestibulum laoreet turpis ac accumsan. Vivamus eros felis, rhoncus vel interdum bibendum, imperdiet nec diam. Etiam sed eros sed orci pellentesque sagittis. Praesent a fermentum leo. Vivamus ipsum risus, faucibus a dignissim ut, ullamcorper nec risus. Etiam quis adipiscing velit. Nam ac cursus arcu. Sed bibendum lectus quis massa dapibus dapibus. Vestibulum fermentum eros vitae hendrerit condimentum.

Fusce viverra eleifend iaculis. Maecenas tempor dictum cursus. Mauris faucibus, tortor in bibendum ornare, nibh lorem sollicitudin est, sed consectetur nulla dui imperdiet urna. Fusce aliquet odio fermentum massa mollis, id feugiat lacus egestas. Integer et eleifend metus. Duis neque tellus, vulputate nec dui eu, euismod sodales orci. Vivamus turpis erat, consectetur et pulvinar nec, ornare a quam. Maecenas fermentum, ligula vitae consectetur lobortis, mi lacus fermentum ante, ut semper lacus lectus porta orci. Nulla vehicula sodales eros, in iaculis ante laoreet at. Sed venenatis interdum metus, egestas scelerisque orci laoreet ut. Donec fermentum enim eget nibh blandit laoreet. Proin lacinia adipiscing lorem vel ornare. Donec ullamcorper massa elementum urna varius viverra. Proin pharetra, erat at feugiat rhoncus, velit eros condimentum mi, ac mattis sapien dolor non elit. Aenean viverra purus id tincidunt vulputate.

Etiam vel augue vel nisl commodo suscipit et ac nisl. Quisque eros diam, porttitor et aliquet sed, vulputate in odio. Aenean feugiat est quis neque vehicula, eget vulputate nunc tempor. Donec quis nulla ut quam feugiat consectetur ut et justo. Nulla congue, metus auctor facilisis scelerisque, nunc risus vulputate urna, in blandit urna nibh et neque. Etiam quis tortor ut nulla dignissim dictum non sed ligula. Vivamus accumsan ligula eget ipsum ultrices, a tincidunt urna blandit. In hac habitasse platea dictumst.`)

	doc := document.NewDocument("a").AddField(document.NewTextField("full", []uint64{}, fieldBytes))
	docMatch := search.DocumentMatch{
		ID:    "a",
		Score: 1.0,
		Locations: search.FieldTermLocationMap{
			"full": search.TermLocationMap{
				"metus": []*search.Location{
					{
						Pos:   0,
						Start: 883,
						End:   888,
					},
					{
						Pos:   0,
						Start: 915,
						End:   920,
					},
					{
						Pos:   0,
						Start: 2492,
						End:   2497,
					},
					{
						Pos:   0,
						Start: 2822,
						End:   2827,
					},
					{
						Pos:   0,
						Start: 3417,
						End:   3422,
					},
				},
				"interdum": []*search.Location{
					{
						Pos:   0,
						Start: 1891,
						End:   1899,
					},
					{
						Pos:   0,
						Start: 2813,
						End:   2821,
					},
				},
				"venenatis": []*search.Location{
					{
						Pos:   0,
						Start: 954,
						End:   963,
					},
					{
						Pos:   0,
						Start: 1252,
						End:   1261,
					},
					{
						Pos:   0,
						Start: 1795,
						End:   1804,
					},
					{
						Pos:   0,
						Start: 2803,
						End:   2812,
					},
				},
			},
		},
	}

	expectedFragments := []string{
		"…eros, in iaculis ante laoreet at. Sed " + DefaultAnsiHighlight + "venenatis" + reset + " " + DefaultAnsiHighlight + "interdum" + reset + " " + DefaultAnsiHighlight + "metus" + reset + ", egestas scelerisque orci laoreet ut.…",
		"… eros sed " + DefaultAnsiHighlight + "metus" + reset + " aliquet convallis ac eget " + DefaultAnsiHighlight + "metus" + reset + ". Donec eget feugiat sem. Quisque " + DefaultAnsiHighlight + "venenatis" + reset + ", augue et…",
		"… odio. Maecenas condimentum felis vitae nibh " + DefaultAnsiHighlight + "venenatis" + reset + ", ut feugiat risus vehicula. Suspendisse non s…",
		"… id feugiat lacus egestas. Integer et eleifend " + DefaultAnsiHighlight + "metus" + reset + ". Duis neque tellus, vulputate nec dui eu, euism…",
		"… accumsan. Vivamus eros felis, rhoncus vel " + DefaultAnsiHighlight + "interdum" + reset + " bibendum, imperdiet nec diam. Etiam sed eros sed…",
	}

	fragmenter := sfrag.NewFragmenter(100)
	formatter := ansi.NewFragmentFormatter(ansi.DefaultAnsiHighlight)
	highlighter := NewHighlighter(fragmenter, formatter, DefaultSeparator)
	fragments := highlighter.BestFragmentsInField(&docMatch, doc, "full", 5)

	if !reflect.DeepEqual(fragments, expectedFragments) {
		t.Errorf("expected %#v, got %#v", expectedFragments, fragments)
	}

}
