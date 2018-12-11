//  Copyright (c) 2018 Couchbase, Inc.
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

// converted to Go from Lucene's AsciiFoldingFilter
// https://lucene.apache.org/core/4_0_0/analyzers-common/org/apache/lucene/analysis/miscellaneous/ASCIIFoldingFilter.html

package asciifolding

import (
	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

const Name = "asciifolding"

type AsciiFoldingFilter struct{}

func New() *AsciiFoldingFilter {
	return &AsciiFoldingFilter{}
}

func (s *AsciiFoldingFilter) Filter(input []byte) []byte {
	if len(input) == 0 {
		return input
	}

	in := []rune(string(input))
	length := len(in)

	// Worst-case length required if all runes fold to 4 runes
	out := make([]rune, length, length*4)

	out = foldToASCII(in, 0, out, 0, length)
	return []byte(string(out))
}

func AsciiFoldingFilterConstructor(config map[string]interface{}, cache *registry.Cache) (analysis.CharFilter, error) {
	return New(), nil
}

func init() {
	registry.RegisterCharFilter(Name, AsciiFoldingFilterConstructor)
}

// Converts characters above ASCII to their ASCII equivalents.
// For example, accents are removed from accented characters.
func foldToASCII(input []rune, inputPos int, output []rune, outputPos int, length int) []rune {
	end := inputPos + length
	for pos := inputPos; pos < end; pos++ {
		c := input[pos]

		// Quick test: if it's not in range then just keep current character
		if c < '\u0080' {
			output[outputPos] = c
			outputPos++
		} else {
			switch c {
			case '\u00C0': // À [LATIN CAPITAL LETTER A WITH GRAVE]
				fallthrough
			case '\u00C1': // Á [LATIN CAPITAL LETTER A WITH ACUTE]
				fallthrough
			case '\u00C2': // Â [LATIN CAPITAL LETTER A WITH CIRCUMFLEX]
				fallthrough
			case '\u00C3': // Ã [LATIN CAPITAL LETTER A WITH TILDE]
				fallthrough
			case '\u00C4': // Ä [LATIN CAPITAL LETTER A WITH DIAERESIS]
				fallthrough
			case '\u00C5': // Å [LATIN CAPITAL LETTER A WITH RING ABOVE]
				fallthrough
			case '\u0100': // Ā [LATIN CAPITAL LETTER A WITH MACRON]
				fallthrough
			case '\u0102': // Ă [LATIN CAPITAL LETTER A WITH BREVE]
				fallthrough
			case '\u0104': // Ą [LATIN CAPITAL LETTER A WITH OGONEK]
				fallthrough
			case '\u018F': // Ə http://en.wikipedia.org/wiki/Schwa [LATIN CAPITAL LETTER SCHWA]
				fallthrough
			case '\u01CD': // Ǎ [LATIN CAPITAL LETTER A WITH CARON]
				fallthrough
			case '\u01DE': // Ǟ [LATIN CAPITAL LETTER A WITH DIAERESIS AND MACRON]
				fallthrough
			case '\u01E0': // Ǡ [LATIN CAPITAL LETTER A WITH DOT ABOVE AND MACRON]
				fallthrough
			case '\u01FA': // Ǻ [LATIN CAPITAL LETTER A WITH RING ABOVE AND ACUTE]
				fallthrough
			case '\u0200': // Ȁ [LATIN CAPITAL LETTER A WITH DOUBLE GRAVE]
				fallthrough
			case '\u0202': // Ȃ [LATIN CAPITAL LETTER A WITH INVERTED BREVE]
				fallthrough
			case '\u0226': // Ȧ [LATIN CAPITAL LETTER A WITH DOT ABOVE]
				fallthrough
			case '\u023A': // Ⱥ [LATIN CAPITAL LETTER A WITH STROKE]
				fallthrough
			case '\u1D00': // ᴀ [LATIN LETTER SMALL CAPITAL A]
				fallthrough
			case '\u1E00': // Ḁ [LATIN CAPITAL LETTER A WITH RING BELOW]
				fallthrough
			case '\u1EA0': // Ạ [LATIN CAPITAL LETTER A WITH DOT BELOW]
				fallthrough
			case '\u1EA2': // Ả [LATIN CAPITAL LETTER A WITH HOOK ABOVE]
				fallthrough
			case '\u1EA4': // Ấ [LATIN CAPITAL LETTER A WITH CIRCUMFLEX AND ACUTE]
				fallthrough
			case '\u1EA6': // Ầ [LATIN CAPITAL LETTER A WITH CIRCUMFLEX AND GRAVE]
				fallthrough
			case '\u1EA8': // Ẩ [LATIN CAPITAL LETTER A WITH CIRCUMFLEX AND HOOK ABOVE]
				fallthrough
			case '\u1EAA': // Ẫ [LATIN CAPITAL LETTER A WITH CIRCUMFLEX AND TILDE]
				fallthrough
			case '\u1EAC': // Ậ [LATIN CAPITAL LETTER A WITH CIRCUMFLEX AND DOT BELOW]
				fallthrough
			case '\u1EAE': // Ắ [LATIN CAPITAL LETTER A WITH BREVE AND ACUTE]
				fallthrough
			case '\u1EB0': // Ằ [LATIN CAPITAL LETTER A WITH BREVE AND GRAVE]
				fallthrough
			case '\u1EB2': // Ẳ [LATIN CAPITAL LETTER A WITH BREVE AND HOOK ABOVE]
				fallthrough
			case '\u1EB4': // Ẵ [LATIN CAPITAL LETTER A WITH BREVE AND TILDE]
				fallthrough
			case '\u24B6': // Ⓐ [CIRCLED LATIN CAPITAL LETTER A]
				fallthrough
			case '\uFF21': // Ａ [FULLWIDTH LATIN CAPITAL LETTER A]
				fallthrough
			case '\u1EB6': // Ặ [LATIN CAPITAL LETTER A WITH BREVE AND DOT BELOW]
				output[outputPos] = 'A'
				outputPos++

			case '\u00E0': // à [LATIN SMALL LETTER A WITH GRAVE]
				fallthrough
			case '\u00E1': // á [LATIN SMALL LETTER A WITH ACUTE]
				fallthrough
			case '\u00E2': // â [LATIN SMALL LETTER A WITH CIRCUMFLEX]
				fallthrough
			case '\u00E3': // ã [LATIN SMALL LETTER A WITH TILDE]
				fallthrough
			case '\u00E4': // ä [LATIN SMALL LETTER A WITH DIAERESIS]
				fallthrough
			case '\u00E5': // å [LATIN SMALL LETTER A WITH RING ABOVE]
				fallthrough
			case '\u0101': // ā [LATIN SMALL LETTER A WITH MACRON]
				fallthrough
			case '\u0103': // ă [LATIN SMALL LETTER A WITH BREVE]
				fallthrough
			case '\u0105': // ą [LATIN SMALL LETTER A WITH OGONEK]
				fallthrough
			case '\u01CE': // ǎ [LATIN SMALL LETTER A WITH CARON]
				fallthrough
			case '\u01DF': // ǟ [LATIN SMALL LETTER A WITH DIAERESIS AND MACRON]
				fallthrough
			case '\u01E1': // ǡ [LATIN SMALL LETTER A WITH DOT ABOVE AND MACRON]
				fallthrough
			case '\u01FB': // ǻ [LATIN SMALL LETTER A WITH RING ABOVE AND ACUTE]
				fallthrough
			case '\u0201': // ȁ [LATIN SMALL LETTER A WITH DOUBLE GRAVE]
				fallthrough
			case '\u0203': // ȃ [LATIN SMALL LETTER A WITH INVERTED BREVE]
				fallthrough
			case '\u0227': // ȧ [LATIN SMALL LETTER A WITH DOT ABOVE]
				fallthrough
			case '\u0250': // ɐ [LATIN SMALL LETTER TURNED A]
				fallthrough
			case '\u0259': // ə [LATIN SMALL LETTER SCHWA]
				fallthrough
			case '\u025A': // ɚ [LATIN SMALL LETTER SCHWA WITH HOOK]
				fallthrough
			case '\u1D8F': // ᶏ [LATIN SMALL LETTER A WITH RETROFLEX HOOK]
				fallthrough
			case '\u1D95': // ᶕ [LATIN SMALL LETTER SCHWA WITH RETROFLEX HOOK]
				fallthrough
			case '\u1E01': // ạ [LATIN SMALL LETTER A WITH RING BELOW]
				fallthrough
			case '\u1E9A': // ả [LATIN SMALL LETTER A WITH RIGHT HALF RING]
				fallthrough
			case '\u1EA1': // ạ [LATIN SMALL LETTER A WITH DOT BELOW]
				fallthrough
			case '\u1EA3': // ả [LATIN SMALL LETTER A WITH HOOK ABOVE]
				fallthrough
			case '\u1EA5': // ấ [LATIN SMALL LETTER A WITH CIRCUMFLEX AND ACUTE]
				fallthrough
			case '\u1EA7': // ầ [LATIN SMALL LETTER A WITH CIRCUMFLEX AND GRAVE]
				fallthrough
			case '\u1EA9': // ẩ [LATIN SMALL LETTER A WITH CIRCUMFLEX AND HOOK ABOVE]
				fallthrough
			case '\u1EAB': // ẫ [LATIN SMALL LETTER A WITH CIRCUMFLEX AND TILDE]
				fallthrough
			case '\u1EAD': // ậ [LATIN SMALL LETTER A WITH CIRCUMFLEX AND DOT BELOW]
				fallthrough
			case '\u1EAF': // ắ [LATIN SMALL LETTER A WITH BREVE AND ACUTE]
				fallthrough
			case '\u1EB1': // ằ [LATIN SMALL LETTER A WITH BREVE AND GRAVE]
				fallthrough
			case '\u1EB3': // ẳ [LATIN SMALL LETTER A WITH BREVE AND HOOK ABOVE]
				fallthrough
			case '\u1EB5': // ẵ [LATIN SMALL LETTER A WITH BREVE AND TILDE]
				fallthrough
			case '\u1EB7': // ặ [LATIN SMALL LETTER A WITH BREVE AND DOT BELOW]
				fallthrough
			case '\u2090': // ₐ [LATIN SUBSCRIPT SMALL LETTER A]
				fallthrough
			case '\u2094': // ₔ [LATIN SUBSCRIPT SMALL LETTER SCHWA]
				fallthrough
			case '\u24D0': // ⓐ [CIRCLED LATIN SMALL LETTER A]
				fallthrough
			case '\u2C65': // ⱥ [LATIN SMALL LETTER A WITH STROKE]
				fallthrough
			case '\u2C6F': // Ɐ [LATIN CAPITAL LETTER TURNED A]
				fallthrough
			case '\uFF41': // ａ [FULLWIDTH LATIN SMALL LETTER A]
				output[outputPos] = 'a'
				outputPos++

			case '\uA732': // Ꜳ [LATIN CAPITAL LETTER AA]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'A'
				outputPos++
				output[outputPos] = 'A'
				outputPos++

			case '\u00C6': // Æ [LATIN CAPITAL LETTER AE]
				fallthrough
			case '\u01E2': // Ǣ [LATIN CAPITAL LETTER AE WITH MACRON]
				fallthrough
			case '\u01FC': // Ǽ [LATIN CAPITAL LETTER AE WITH ACUTE]
				fallthrough
			case '\u1D01': // ᴁ [LATIN LETTER SMALL CAPITAL AE]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'A'
				outputPos++
				output[outputPos] = 'E'
				outputPos++

			case '\uA734': // Ꜵ [LATIN CAPITAL LETTER AO]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'A'
				outputPos++
				output[outputPos] = 'O'
				outputPos++

			case '\uA736': // Ꜷ [LATIN CAPITAL LETTER AU]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'A'
				outputPos++
				output[outputPos] = 'U'
				outputPos++

			case '\uA738': // Ꜹ [LATIN CAPITAL LETTER AV]
				fallthrough
			case '\uA73A': // Ꜻ [LATIN CAPITAL LETTER AV WITH HORIZONTAL BAR]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'A'
				outputPos++
				output[outputPos] = 'V'
				outputPos++

			case '\uA73C': // Ꜽ [LATIN CAPITAL LETTER AY]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'A'
				outputPos++
				output[outputPos] = 'Y'
				outputPos++

			case '\u249C': // ⒜ [PARENTHESIZED LATIN SMALL LETTER A]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'a'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\uA733': // ꜳ [LATIN SMALL LETTER AA]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'a'
				outputPos++
				output[outputPos] = 'a'
				outputPos++

			case '\u00E6': // æ [LATIN SMALL LETTER AE]
				fallthrough
			case '\u01E3': // ǣ [LATIN SMALL LETTER AE WITH MACRON]
				fallthrough
			case '\u01FD': // ǽ [LATIN SMALL LETTER AE WITH ACUTE]
				fallthrough
			case '\u1D02': // ᴂ [LATIN SMALL LETTER TURNED AE]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'a'
				outputPos++
				output[outputPos] = 'e'
				outputPos++

			case '\uA735': // ꜵ [LATIN SMALL LETTER AO]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'a'
				outputPos++
				output[outputPos] = 'o'
				outputPos++

			case '\uA737': // ꜷ [LATIN SMALL LETTER AU]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'a'
				outputPos++
				output[outputPos] = 'u'
				outputPos++

			case '\uA739': // ꜹ [LATIN SMALL LETTER AV]
				fallthrough
			case '\uA73B': // ꜻ [LATIN SMALL LETTER AV WITH HORIZONTAL BAR]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'a'
				outputPos++
				output[outputPos] = 'v'
				outputPos++

			case '\uA73D': // ꜽ [LATIN SMALL LETTER AY]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'a'
				outputPos++
				output[outputPos] = 'y'
				outputPos++

			case '\u0181': // Ɓ [LATIN CAPITAL LETTER B WITH HOOK]
				fallthrough
			case '\u0182': // Ƃ [LATIN CAPITAL LETTER B WITH TOPBAR]
				fallthrough
			case '\u0243': // Ƀ [LATIN CAPITAL LETTER B WITH STROKE]
				fallthrough
			case '\u0299': // ʙ [LATIN LETTER SMALL CAPITAL B]
				fallthrough
			case '\u1D03': // ᴃ [LATIN LETTER SMALL CAPITAL BARRED B]
				fallthrough
			case '\u1E02': // Ḃ [LATIN CAPITAL LETTER B WITH DOT ABOVE]
				fallthrough
			case '\u1E04': // Ḅ [LATIN CAPITAL LETTER B WITH DOT BELOW]
				fallthrough
			case '\u1E06': // Ḇ [LATIN CAPITAL LETTER B WITH LINE BELOW]
				fallthrough
			case '\u24B7': // Ⓑ [CIRCLED LATIN CAPITAL LETTER B]
				fallthrough
			case '\uFF22': // Ｂ [FULLWIDTH LATIN CAPITAL LETTER B]
				output[outputPos] = 'B'
				outputPos++

			case '\u0180': // ƀ [LATIN SMALL LETTER B WITH STROKE]
				fallthrough
			case '\u0183': // ƃ [LATIN SMALL LETTER B WITH TOPBAR]
				fallthrough
			case '\u0253': // ɓ [LATIN SMALL LETTER B WITH HOOK]
				fallthrough
			case '\u1D6C': // ᵬ [LATIN SMALL LETTER B WITH MIDDLE TILDE]
				fallthrough
			case '\u1D80': // ᶀ [LATIN SMALL LETTER B WITH PALATAL HOOK]
				fallthrough
			case '\u1E03': // ḃ [LATIN SMALL LETTER B WITH DOT ABOVE]
				fallthrough
			case '\u1E05': // ḅ [LATIN SMALL LETTER B WITH DOT BELOW]
				fallthrough
			case '\u1E07': // ḇ [LATIN SMALL LETTER B WITH LINE BELOW]
				fallthrough
			case '\u24D1': // ⓑ [CIRCLED LATIN SMALL LETTER B]
				fallthrough
			case '\uFF42': // ｂ [FULLWIDTH LATIN SMALL LETTER B]
				output[outputPos] = 'b'
				outputPos++

			case '\u249D': // ⒝ [PARENTHESIZED LATIN SMALL LETTER B]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'b'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u00C7': // Ç [LATIN CAPITAL LETTER C WITH CEDILLA]
				fallthrough
			case '\u0106': // Ć [LATIN CAPITAL LETTER C WITH ACUTE]
				fallthrough
			case '\u0108': // Ĉ [LATIN CAPITAL LETTER C WITH CIRCUMFLEX]
				fallthrough
			case '\u010A': // Ċ [LATIN CAPITAL LETTER C WITH DOT ABOVE]
				fallthrough
			case '\u010C': // Č [LATIN CAPITAL LETTER C WITH CARON]
				fallthrough
			case '\u0187': // Ƈ [LATIN CAPITAL LETTER C WITH HOOK]
				fallthrough
			case '\u023B': // Ȼ [LATIN CAPITAL LETTER C WITH STROKE]
				fallthrough
			case '\u0297': // ʗ [LATIN LETTER STRETCHED C]
				fallthrough
			case '\u1D04': // ᴄ [LATIN LETTER SMALL CAPITAL C]
				fallthrough
			case '\u1E08': // Ḉ [LATIN CAPITAL LETTER C WITH CEDILLA AND ACUTE]
				fallthrough
			case '\u24B8': // Ⓒ [CIRCLED LATIN CAPITAL LETTER C]
				fallthrough
			case '\uFF23': // Ｃ [FULLWIDTH LATIN CAPITAL LETTER C]
				output[outputPos] = 'C'
				outputPos++

			case '\u00E7': // ç [LATIN SMALL LETTER C WITH CEDILLA]
				fallthrough
			case '\u0107': // ć [LATIN SMALL LETTER C WITH ACUTE]
				fallthrough
			case '\u0109': // ĉ [LATIN SMALL LETTER C WITH CIRCUMFLEX]
				fallthrough
			case '\u010B': // ċ [LATIN SMALL LETTER C WITH DOT ABOVE]
				fallthrough
			case '\u010D': // č [LATIN SMALL LETTER C WITH CARON]
				fallthrough
			case '\u0188': // ƈ [LATIN SMALL LETTER C WITH HOOK]
				fallthrough
			case '\u023C': // ȼ [LATIN SMALL LETTER C WITH STROKE]
				fallthrough
			case '\u0255': // ɕ [LATIN SMALL LETTER C WITH CURL]
				fallthrough
			case '\u1E09': // ḉ [LATIN SMALL LETTER C WITH CEDILLA AND ACUTE]
				fallthrough
			case '\u2184': // ↄ [LATIN SMALL LETTER REVERSED C]
				fallthrough
			case '\u24D2': // ⓒ [CIRCLED LATIN SMALL LETTER C]
				fallthrough
			case '\uA73E': // Ꜿ [LATIN CAPITAL LETTER REVERSED C WITH DOT]
				fallthrough
			case '\uA73F': // ꜿ [LATIN SMALL LETTER REVERSED C WITH DOT]
				fallthrough
			case '\uFF43': // ｃ [FULLWIDTH LATIN SMALL LETTER C]
				output[outputPos] = 'c'
				outputPos++

			case '\u249E': // ⒞ [PARENTHESIZED LATIN SMALL LETTER C]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'c'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u00D0': // Ð [LATIN CAPITAL LETTER ETH]
				fallthrough
			case '\u010E': // Ď [LATIN CAPITAL LETTER D WITH CARON]
				fallthrough
			case '\u0110': // Đ [LATIN CAPITAL LETTER D WITH STROKE]
				fallthrough
			case '\u0189': // Ɖ [LATIN CAPITAL LETTER AFRICAN D]
				fallthrough
			case '\u018A': // Ɗ [LATIN CAPITAL LETTER D WITH HOOK]
				fallthrough
			case '\u018B': // Ƌ [LATIN CAPITAL LETTER D WITH TOPBAR]
				fallthrough
			case '\u1D05': // ᴅ [LATIN LETTER SMALL CAPITAL D]
				fallthrough
			case '\u1D06': // ᴆ [LATIN LETTER SMALL CAPITAL ETH]
				fallthrough
			case '\u1E0A': // Ḋ [LATIN CAPITAL LETTER D WITH DOT ABOVE]
				fallthrough
			case '\u1E0C': // Ḍ [LATIN CAPITAL LETTER D WITH DOT BELOW]
				fallthrough
			case '\u1E0E': // Ḏ [LATIN CAPITAL LETTER D WITH LINE BELOW]
				fallthrough
			case '\u1E10': // Ḑ [LATIN CAPITAL LETTER D WITH CEDILLA]
				fallthrough
			case '\u1E12': // Ḓ [LATIN CAPITAL LETTER D WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u24B9': // Ⓓ [CIRCLED LATIN CAPITAL LETTER D]
				fallthrough
			case '\uA779': // Ꝺ [LATIN CAPITAL LETTER INSULAR D]
				fallthrough
			case '\uFF24': // Ｄ [FULLWIDTH LATIN CAPITAL LETTER D]
				output[outputPos] = 'D'
				outputPos++

			case '\u00F0': // ð [LATIN SMALL LETTER ETH]
				fallthrough
			case '\u010F': // ď [LATIN SMALL LETTER D WITH CARON]
				fallthrough
			case '\u0111': // đ [LATIN SMALL LETTER D WITH STROKE]
				fallthrough
			case '\u018C': // ƌ [LATIN SMALL LETTER D WITH TOPBAR]
				fallthrough
			case '\u0221': // ȡ [LATIN SMALL LETTER D WITH CURL]
				fallthrough
			case '\u0256': // ɖ [LATIN SMALL LETTER D WITH TAIL]
				fallthrough
			case '\u0257': // ɗ [LATIN SMALL LETTER D WITH HOOK]
				fallthrough
			case '\u1D6D': // ᵭ [LATIN SMALL LETTER D WITH MIDDLE TILDE]
				fallthrough
			case '\u1D81': // ᶁ [LATIN SMALL LETTER D WITH PALATAL HOOK]
				fallthrough
			case '\u1D91': // ᶑ [LATIN SMALL LETTER D WITH HOOK AND TAIL]
				fallthrough
			case '\u1E0B': // ḋ [LATIN SMALL LETTER D WITH DOT ABOVE]
				fallthrough
			case '\u1E0D': // ḍ [LATIN SMALL LETTER D WITH DOT BELOW]
				fallthrough
			case '\u1E0F': // ḏ [LATIN SMALL LETTER D WITH LINE BELOW]
				fallthrough
			case '\u1E11': // ḑ [LATIN SMALL LETTER D WITH CEDILLA]
				fallthrough
			case '\u1E13': // ḓ [LATIN SMALL LETTER D WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u24D3': // ⓓ [CIRCLED LATIN SMALL LETTER D]
				fallthrough
			case '\uA77A': // ꝺ [LATIN SMALL LETTER INSULAR D]
				fallthrough
			case '\uFF44': // ｄ [FULLWIDTH LATIN SMALL LETTER D]
				output[outputPos] = 'd'
				outputPos++

			case '\u01C4': // Ǆ [LATIN CAPITAL LETTER DZ WITH CARON]
				fallthrough
			case '\u01F1': // Ǳ [LATIN CAPITAL LETTER DZ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'D'
				outputPos++
				output[outputPos] = 'Z'
				outputPos++

			case '\u01C5': // ǅ [LATIN CAPITAL LETTER D WITH SMALL LETTER Z WITH CARON]
				fallthrough
			case '\u01F2': // ǲ [LATIN CAPITAL LETTER D WITH SMALL LETTER Z]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'D'
				outputPos++
				output[outputPos] = 'z'
				outputPos++

			case '\u249F': // ⒟ [PARENTHESIZED LATIN SMALL LETTER D]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'd'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0238': // ȸ [LATIN SMALL LETTER DB DIGRAPH]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'd'
				outputPos++
				output[outputPos] = 'b'
				outputPos++

			case '\u01C6': // ǆ [LATIN SMALL LETTER DZ WITH CARON]
				fallthrough
			case '\u01F3': // ǳ [LATIN SMALL LETTER DZ]
				fallthrough
			case '\u02A3': // ʣ [LATIN SMALL LETTER DZ DIGRAPH]
				fallthrough
			case '\u02A5': // ʥ [LATIN SMALL LETTER DZ DIGRAPH WITH CURL]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'd'
				outputPos++
				output[outputPos] = 'z'
				outputPos++

			case '\u00C8': // È [LATIN CAPITAL LETTER E WITH GRAVE]
				fallthrough
			case '\u00C9': // É [LATIN CAPITAL LETTER E WITH ACUTE]
				fallthrough
			case '\u00CA': // Ê [LATIN CAPITAL LETTER E WITH CIRCUMFLEX]
				fallthrough
			case '\u00CB': // Ë [LATIN CAPITAL LETTER E WITH DIAERESIS]
				fallthrough
			case '\u0112': // Ē [LATIN CAPITAL LETTER E WITH MACRON]
				fallthrough
			case '\u0114': // Ĕ [LATIN CAPITAL LETTER E WITH BREVE]
				fallthrough
			case '\u0116': // Ė [LATIN CAPITAL LETTER E WITH DOT ABOVE]
				fallthrough
			case '\u0118': // Ę [LATIN CAPITAL LETTER E WITH OGONEK]
				fallthrough
			case '\u011A': // Ě [LATIN CAPITAL LETTER E WITH CARON]
				fallthrough
			case '\u018E': // Ǝ [LATIN CAPITAL LETTER REVERSED E]
				fallthrough
			case '\u0190': // Ɛ [LATIN CAPITAL LETTER OPEN E]
				fallthrough
			case '\u0204': // Ȅ [LATIN CAPITAL LETTER E WITH DOUBLE GRAVE]
				fallthrough
			case '\u0206': // Ȇ [LATIN CAPITAL LETTER E WITH INVERTED BREVE]
				fallthrough
			case '\u0228': // Ȩ [LATIN CAPITAL LETTER E WITH CEDILLA]
				fallthrough
			case '\u0246': // Ɇ [LATIN CAPITAL LETTER E WITH STROKE]
				fallthrough
			case '\u1D07': // ᴇ [LATIN LETTER SMALL CAPITAL E]
				fallthrough
			case '\u1E14': // Ḕ [LATIN CAPITAL LETTER E WITH MACRON AND GRAVE]
				fallthrough
			case '\u1E16': // Ḗ [LATIN CAPITAL LETTER E WITH MACRON AND ACUTE]
				fallthrough
			case '\u1E18': // Ḙ [LATIN CAPITAL LETTER E WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u1E1A': // Ḛ [LATIN CAPITAL LETTER E WITH TILDE BELOW]
				fallthrough
			case '\u1E1C': // Ḝ [LATIN CAPITAL LETTER E WITH CEDILLA AND BREVE]
				fallthrough
			case '\u1EB8': // Ẹ [LATIN CAPITAL LETTER E WITH DOT BELOW]
				fallthrough
			case '\u1EBA': // Ẻ [LATIN CAPITAL LETTER E WITH HOOK ABOVE]
				fallthrough
			case '\u1EBC': // Ẽ [LATIN CAPITAL LETTER E WITH TILDE]
				fallthrough
			case '\u1EBE': // Ế [LATIN CAPITAL LETTER E WITH CIRCUMFLEX AND ACUTE]
				fallthrough
			case '\u1EC0': // Ề [LATIN CAPITAL LETTER E WITH CIRCUMFLEX AND GRAVE]
				fallthrough
			case '\u1EC2': // Ể [LATIN CAPITAL LETTER E WITH CIRCUMFLEX AND HOOK ABOVE]
				fallthrough
			case '\u1EC4': // Ễ [LATIN CAPITAL LETTER E WITH CIRCUMFLEX AND TILDE]
				fallthrough
			case '\u1EC6': // Ệ [LATIN CAPITAL LETTER E WITH CIRCUMFLEX AND DOT BELOW]
				fallthrough
			case '\u24BA': // Ⓔ [CIRCLED LATIN CAPITAL LETTER E]
				fallthrough
			case '\u2C7B': // ⱻ [LATIN LETTER SMALL CAPITAL TURNED E]
				fallthrough
			case '\uFF25': // Ｅ [FULLWIDTH LATIN CAPITAL LETTER E]
				output[outputPos] = 'E'
				outputPos++

			case '\u00E8': // è [LATIN SMALL LETTER E WITH GRAVE]
				fallthrough
			case '\u00E9': // é [LATIN SMALL LETTER E WITH ACUTE]
				fallthrough
			case '\u00EA': // ê [LATIN SMALL LETTER E WITH CIRCUMFLEX]
				fallthrough
			case '\u00EB': // ë [LATIN SMALL LETTER E WITH DIAERESIS]
				fallthrough
			case '\u0113': // ē [LATIN SMALL LETTER E WITH MACRON]
				fallthrough
			case '\u0115': // ĕ [LATIN SMALL LETTER E WITH BREVE]
				fallthrough
			case '\u0117': // ė [LATIN SMALL LETTER E WITH DOT ABOVE]
				fallthrough
			case '\u0119': // ę [LATIN SMALL LETTER E WITH OGONEK]
				fallthrough
			case '\u011B': // ě [LATIN SMALL LETTER E WITH CARON]
				fallthrough
			case '\u01DD': // ǝ [LATIN SMALL LETTER TURNED E]
				fallthrough
			case '\u0205': // ȅ [LATIN SMALL LETTER E WITH DOUBLE GRAVE]
				fallthrough
			case '\u0207': // ȇ [LATIN SMALL LETTER E WITH INVERTED BREVE]
				fallthrough
			case '\u0229': // ȩ [LATIN SMALL LETTER E WITH CEDILLA]
				fallthrough
			case '\u0247': // ɇ [LATIN SMALL LETTER E WITH STROKE]
				fallthrough
			case '\u0258': // ɘ [LATIN SMALL LETTER REVERSED E]
				fallthrough
			case '\u025B': // ɛ [LATIN SMALL LETTER OPEN E]
				fallthrough
			case '\u025C': // ɜ [LATIN SMALL LETTER REVERSED OPEN E]
				fallthrough
			case '\u025D': // ɝ [LATIN SMALL LETTER REVERSED OPEN E WITH HOOK]
				fallthrough
			case '\u025E': // ɞ [LATIN SMALL LETTER CLOSED REVERSED OPEN E]
				fallthrough
			case '\u029A': // ʚ [LATIN SMALL LETTER CLOSED OPEN E]
				fallthrough
			case '\u1D08': // ᴈ [LATIN SMALL LETTER TURNED OPEN E]
				fallthrough
			case '\u1D92': // ᶒ [LATIN SMALL LETTER E WITH RETROFLEX HOOK]
				fallthrough
			case '\u1D93': // ᶓ [LATIN SMALL LETTER OPEN E WITH RETROFLEX HOOK]
				fallthrough
			case '\u1D94': // ᶔ [LATIN SMALL LETTER REVERSED OPEN E WITH RETROFLEX HOOK]
				fallthrough
			case '\u1E15': // ḕ [LATIN SMALL LETTER E WITH MACRON AND GRAVE]
				fallthrough
			case '\u1E17': // ḗ [LATIN SMALL LETTER E WITH MACRON AND ACUTE]
				fallthrough
			case '\u1E19': // ḙ [LATIN SMALL LETTER E WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u1E1B': // ḛ [LATIN SMALL LETTER E WITH TILDE BELOW]
				fallthrough
			case '\u1E1D': // ḝ [LATIN SMALL LETTER E WITH CEDILLA AND BREVE]
				fallthrough
			case '\u1EB9': // ẹ [LATIN SMALL LETTER E WITH DOT BELOW]
				fallthrough
			case '\u1EBB': // ẻ [LATIN SMALL LETTER E WITH HOOK ABOVE]
				fallthrough
			case '\u1EBD': // ẽ [LATIN SMALL LETTER E WITH TILDE]
				fallthrough
			case '\u1EBF': // ế [LATIN SMALL LETTER E WITH CIRCUMFLEX AND ACUTE]
				fallthrough
			case '\u1EC1': // ề [LATIN SMALL LETTER E WITH CIRCUMFLEX AND GRAVE]
				fallthrough
			case '\u1EC3': // ể [LATIN SMALL LETTER E WITH CIRCUMFLEX AND HOOK ABOVE]
				fallthrough
			case '\u1EC5': // ễ [LATIN SMALL LETTER E WITH CIRCUMFLEX AND TILDE]
				fallthrough
			case '\u1EC7': // ệ [LATIN SMALL LETTER E WITH CIRCUMFLEX AND DOT BELOW]
				fallthrough
			case '\u2091': // ₑ [LATIN SUBSCRIPT SMALL LETTER E]
				fallthrough
			case '\u24D4': // ⓔ [CIRCLED LATIN SMALL LETTER E]
				fallthrough
			case '\u2C78': // ⱸ [LATIN SMALL LETTER E WITH NOTCH]
				fallthrough
			case '\uFF45': // ｅ [FULLWIDTH LATIN SMALL LETTER E]
				output[outputPos] = 'e'
				outputPos++

			case '\u24A0': // ⒠ [PARENTHESIZED LATIN SMALL LETTER E]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'e'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0191': // Ƒ [LATIN CAPITAL LETTER F WITH HOOK]
				fallthrough
			case '\u1E1E': // Ḟ [LATIN CAPITAL LETTER F WITH DOT ABOVE]
				fallthrough
			case '\u24BB': // Ⓕ [CIRCLED LATIN CAPITAL LETTER F]
				fallthrough
			case '\uA730': // ꜰ [LATIN LETTER SMALL CAPITAL F]
				fallthrough
			case '\uA77B': // Ꝼ [LATIN CAPITAL LETTER INSULAR F]
				fallthrough
			case '\uA7FB': // ꟻ [LATIN EPIGRAPHIC LETTER REVERSED F]
				fallthrough
			case '\uFF26': // Ｆ [FULLWIDTH LATIN CAPITAL LETTER F]
				output[outputPos] = 'F'
				outputPos++

			case '\u0192': // ƒ [LATIN SMALL LETTER F WITH HOOK]
				fallthrough
			case '\u1D6E': // ᵮ [LATIN SMALL LETTER F WITH MIDDLE TILDE]
				fallthrough
			case '\u1D82': // ᶂ [LATIN SMALL LETTER F WITH PALATAL HOOK]
				fallthrough
			case '\u1E1F': // ḟ [LATIN SMALL LETTER F WITH DOT ABOVE]
				fallthrough
			case '\u1E9B': // ẛ [LATIN SMALL LETTER LONG S WITH DOT ABOVE]
				fallthrough
			case '\u24D5': // ⓕ [CIRCLED LATIN SMALL LETTER F]
				fallthrough
			case '\uA77C': // ꝼ [LATIN SMALL LETTER INSULAR F]
				fallthrough
			case '\uFF46': // ｆ [FULLWIDTH LATIN SMALL LETTER F]
				output[outputPos] = 'f'
				outputPos++

			case '\u24A1': // ⒡ [PARENTHESIZED LATIN SMALL LETTER F]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'f'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\uFB00': // ﬀ [LATIN SMALL LIGATURE FF]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'f'
				outputPos++
				output[outputPos] = 'f'
				outputPos++

			case '\uFB03': // ﬃ [LATIN SMALL LIGATURE FFI]
				output = output[:(len(output) + 2)]
				output[outputPos] = 'f'
				outputPos++
				output[outputPos] = 'f'
				outputPos++
				output[outputPos] = 'i'
				outputPos++

			case '\uFB04': // ﬄ [LATIN SMALL LIGATURE FFL]
				output = output[:(len(output) + 2)]
				output[outputPos] = 'f'
				outputPos++
				output[outputPos] = 'f'
				outputPos++
				output[outputPos] = 'l'
				outputPos++

			case '\uFB01': // ﬁ [LATIN SMALL LIGATURE FI]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'f'
				outputPos++
				output[outputPos] = 'i'
				outputPos++

			case '\uFB02': // ﬂ [LATIN SMALL LIGATURE FL]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'f'
				outputPos++
				output[outputPos] = 'l'
				outputPos++

			case '\u011C': // Ĝ [LATIN CAPITAL LETTER G WITH CIRCUMFLEX]
				fallthrough
			case '\u011E': // Ğ [LATIN CAPITAL LETTER G WITH BREVE]
				fallthrough
			case '\u0120': // Ġ [LATIN CAPITAL LETTER G WITH DOT ABOVE]
				fallthrough
			case '\u0122': // Ģ [LATIN CAPITAL LETTER G WITH CEDILLA]
				fallthrough
			case '\u0193': // Ɠ [LATIN CAPITAL LETTER G WITH HOOK]
				fallthrough
			case '\u01E4': // Ǥ [LATIN CAPITAL LETTER G WITH STROKE]
				fallthrough
			case '\u01E5': // ǥ [LATIN SMALL LETTER G WITH STROKE]
				fallthrough
			case '\u01E6': // Ǧ [LATIN CAPITAL LETTER G WITH CARON]
				fallthrough
			case '\u01E7': // ǧ [LATIN SMALL LETTER G WITH CARON]
				fallthrough
			case '\u01F4': // Ǵ [LATIN CAPITAL LETTER G WITH ACUTE]
				fallthrough
			case '\u0262': // ɢ [LATIN LETTER SMALL CAPITAL G]
				fallthrough
			case '\u029B': // ʛ [LATIN LETTER SMALL CAPITAL G WITH HOOK]
				fallthrough
			case '\u1E20': // Ḡ [LATIN CAPITAL LETTER G WITH MACRON]
				fallthrough
			case '\u24BC': // Ⓖ [CIRCLED LATIN CAPITAL LETTER G]
				fallthrough
			case '\uA77D': // Ᵹ [LATIN CAPITAL LETTER INSULAR G]
				fallthrough
			case '\uA77E': // Ꝿ [LATIN CAPITAL LETTER TURNED INSULAR G]
				fallthrough
			case '\uFF27': // Ｇ [FULLWIDTH LATIN CAPITAL LETTER G]
				output[outputPos] = 'G'
				outputPos++

			case '\u011D': // ĝ [LATIN SMALL LETTER G WITH CIRCUMFLEX]
				fallthrough
			case '\u011F': // ğ [LATIN SMALL LETTER G WITH BREVE]
				fallthrough
			case '\u0121': // ġ [LATIN SMALL LETTER G WITH DOT ABOVE]
				fallthrough
			case '\u0123': // ģ [LATIN SMALL LETTER G WITH CEDILLA]
				fallthrough
			case '\u01F5': // ǵ [LATIN SMALL LETTER G WITH ACUTE]
				fallthrough
			case '\u0260': // ɠ [LATIN SMALL LETTER G WITH HOOK]
				fallthrough
			case '\u0261': // ɡ [LATIN SMALL LETTER SCRIPT G]
				fallthrough
			case '\u1D77': // ᵷ [LATIN SMALL LETTER TURNED G]
				fallthrough
			case '\u1D79': // ᵹ [LATIN SMALL LETTER INSULAR G]
				fallthrough
			case '\u1D83': // ᶃ [LATIN SMALL LETTER G WITH PALATAL HOOK]
				fallthrough
			case '\u1E21': // ḡ [LATIN SMALL LETTER G WITH MACRON]
				fallthrough
			case '\u24D6': // ⓖ [CIRCLED LATIN SMALL LETTER G]
				fallthrough
			case '\uA77F': // ꝿ [LATIN SMALL LETTER TURNED INSULAR G]
				fallthrough
			case '\uFF47': // ｇ [FULLWIDTH LATIN SMALL LETTER G]
				output[outputPos] = 'g'
				outputPos++

			case '\u24A2': // ⒢ [PARENTHESIZED LATIN SMALL LETTER G]
				output = output[:(len(output) + 1)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'g'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0124': // Ĥ [LATIN CAPITAL LETTER H WITH CIRCUMFLEX]
				fallthrough
			case '\u0126': // Ħ [LATIN CAPITAL LETTER H WITH STROKE]
				fallthrough
			case '\u021E': // Ȟ [LATIN CAPITAL LETTER H WITH CARON]
				fallthrough
			case '\u029C': // ʜ [LATIN LETTER SMALL CAPITAL H]
				fallthrough
			case '\u1E22': // Ḣ [LATIN CAPITAL LETTER H WITH DOT ABOVE]
				fallthrough
			case '\u1E24': // Ḥ [LATIN CAPITAL LETTER H WITH DOT BELOW]
				fallthrough
			case '\u1E26': // Ḧ [LATIN CAPITAL LETTER H WITH DIAERESIS]
				fallthrough
			case '\u1E28': // Ḩ [LATIN CAPITAL LETTER H WITH CEDILLA]
				fallthrough
			case '\u1E2A': // Ḫ [LATIN CAPITAL LETTER H WITH BREVE BELOW]
				fallthrough
			case '\u24BD': // Ⓗ [CIRCLED LATIN CAPITAL LETTER H]
				fallthrough
			case '\u2C67': // Ⱨ [LATIN CAPITAL LETTER H WITH DESCENDER]
				fallthrough
			case '\u2C75': // Ⱶ [LATIN CAPITAL LETTER HALF H]
				fallthrough
			case '\uFF28': // Ｈ [FULLWIDTH LATIN CAPITAL LETTER H]
				output[outputPos] = 'H'
				outputPos++

			case '\u0125': // ĥ [LATIN SMALL LETTER H WITH CIRCUMFLEX]
				fallthrough
			case '\u0127': // ħ [LATIN SMALL LETTER H WITH STROKE]
				fallthrough
			case '\u021F': // ȟ [LATIN SMALL LETTER H WITH CARON]
				fallthrough
			case '\u0265': // ɥ [LATIN SMALL LETTER TURNED H]
				fallthrough
			case '\u0266': // ɦ [LATIN SMALL LETTER H WITH HOOK]
				fallthrough
			case '\u02AE': // ʮ [LATIN SMALL LETTER TURNED H WITH FISHHOOK]
				fallthrough
			case '\u02AF': // ʯ [LATIN SMALL LETTER TURNED H WITH FISHHOOK AND TAIL]
				fallthrough
			case '\u1E23': // ḣ [LATIN SMALL LETTER H WITH DOT ABOVE]
				fallthrough
			case '\u1E25': // ḥ [LATIN SMALL LETTER H WITH DOT BELOW]
				fallthrough
			case '\u1E27': // ḧ [LATIN SMALL LETTER H WITH DIAERESIS]
				fallthrough
			case '\u1E29': // ḩ [LATIN SMALL LETTER H WITH CEDILLA]
				fallthrough
			case '\u1E2B': // ḫ [LATIN SMALL LETTER H WITH BREVE BELOW]
				fallthrough
			case '\u1E96': // ẖ [LATIN SMALL LETTER H WITH LINE BELOW]
				fallthrough
			case '\u24D7': // ⓗ [CIRCLED LATIN SMALL LETTER H]
				fallthrough
			case '\u2C68': // ⱨ [LATIN SMALL LETTER H WITH DESCENDER]
				fallthrough
			case '\u2C76': // ⱶ [LATIN SMALL LETTER HALF H]
				fallthrough
			case '\uFF48': // ｈ [FULLWIDTH LATIN SMALL LETTER H]
				output[outputPos] = 'h'
				outputPos++

			case '\u01F6': // Ƕ http://en.wikipedia.org/wiki/Hwair [LATIN CAPITAL LETTER HWAIR]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'H'
				outputPos++
				output[outputPos] = 'V'
				outputPos++

			case '\u24A3': // ⒣ [PARENTHESIZED LATIN SMALL LETTER H]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'h'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0195': // ƕ [LATIN SMALL LETTER HV]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'h'
				outputPos++
				output[outputPos] = 'v'
				outputPos++

			case '\u00CC': // Ì [LATIN CAPITAL LETTER I WITH GRAVE]
				fallthrough
			case '\u00CD': // Í [LATIN CAPITAL LETTER I WITH ACUTE]
				fallthrough
			case '\u00CE': // Î [LATIN CAPITAL LETTER I WITH CIRCUMFLEX]
				fallthrough
			case '\u00CF': // Ï [LATIN CAPITAL LETTER I WITH DIAERESIS]
				fallthrough
			case '\u0128': // Ĩ [LATIN CAPITAL LETTER I WITH TILDE]
				fallthrough
			case '\u012A': // Ī [LATIN CAPITAL LETTER I WITH MACRON]
				fallthrough
			case '\u012C': // Ĭ [LATIN CAPITAL LETTER I WITH BREVE]
				fallthrough
			case '\u012E': // Į [LATIN CAPITAL LETTER I WITH OGONEK]
				fallthrough
			case '\u0130': // İ [LATIN CAPITAL LETTER I WITH DOT ABOVE]
				fallthrough
			case '\u0196': // Ɩ [LATIN CAPITAL LETTER IOTA]
				fallthrough
			case '\u0197': // Ɨ [LATIN CAPITAL LETTER I WITH STROKE]
				fallthrough
			case '\u01CF': // Ǐ [LATIN CAPITAL LETTER I WITH CARON]
				fallthrough
			case '\u0208': // Ȉ [LATIN CAPITAL LETTER I WITH DOUBLE GRAVE]
				fallthrough
			case '\u020A': // Ȋ [LATIN CAPITAL LETTER I WITH INVERTED BREVE]
				fallthrough
			case '\u026A': // ɪ [LATIN LETTER SMALL CAPITAL I]
				fallthrough
			case '\u1D7B': // ᵻ [LATIN SMALL CAPITAL LETTER I WITH STROKE]
				fallthrough
			case '\u1E2C': // Ḭ [LATIN CAPITAL LETTER I WITH TILDE BELOW]
				fallthrough
			case '\u1E2E': // Ḯ [LATIN CAPITAL LETTER I WITH DIAERESIS AND ACUTE]
				fallthrough
			case '\u1EC8': // Ỉ [LATIN CAPITAL LETTER I WITH HOOK ABOVE]
				fallthrough
			case '\u1ECA': // Ị [LATIN CAPITAL LETTER I WITH DOT BELOW]
				fallthrough
			case '\u24BE': // Ⓘ [CIRCLED LATIN CAPITAL LETTER I]
				fallthrough
			case '\uA7FE': // ꟾ [LATIN EPIGRAPHIC LETTER I LONGA]
				fallthrough
			case '\uFF29': // Ｉ [FULLWIDTH LATIN CAPITAL LETTER I]
				output[outputPos] = 'I'
				outputPos++

			case '\u00EC': // ì [LATIN SMALL LETTER I WITH GRAVE]
				fallthrough
			case '\u00ED': // í [LATIN SMALL LETTER I WITH ACUTE]
				fallthrough
			case '\u00EE': // î [LATIN SMALL LETTER I WITH CIRCUMFLEX]
				fallthrough
			case '\u00EF': // ï [LATIN SMALL LETTER I WITH DIAERESIS]
				fallthrough
			case '\u0129': // ĩ [LATIN SMALL LETTER I WITH TILDE]
				fallthrough
			case '\u012B': // ī [LATIN SMALL LETTER I WITH MACRON]
				fallthrough
			case '\u012D': // ĭ [LATIN SMALL LETTER I WITH BREVE]
				fallthrough
			case '\u012F': // į [LATIN SMALL LETTER I WITH OGONEK]
				fallthrough
			case '\u0131': // ı [LATIN SMALL LETTER DOTLESS I]
				fallthrough
			case '\u01D0': // ǐ [LATIN SMALL LETTER I WITH CARON]
				fallthrough
			case '\u0209': // ȉ [LATIN SMALL LETTER I WITH DOUBLE GRAVE]
				fallthrough
			case '\u020B': // ȋ [LATIN SMALL LETTER I WITH INVERTED BREVE]
				fallthrough
			case '\u0268': // ɨ [LATIN SMALL LETTER I WITH STROKE]
				fallthrough
			case '\u1D09': // ᴉ [LATIN SMALL LETTER TURNED I]
				fallthrough
			case '\u1D62': // ᵢ [LATIN SUBSCRIPT SMALL LETTER I]
				fallthrough
			case '\u1D7C': // ᵼ [LATIN SMALL LETTER IOTA WITH STROKE]
				fallthrough
			case '\u1D96': // ᶖ [LATIN SMALL LETTER I WITH RETROFLEX HOOK]
				fallthrough
			case '\u1E2D': // ḭ [LATIN SMALL LETTER I WITH TILDE BELOW]
				fallthrough
			case '\u1E2F': // ḯ [LATIN SMALL LETTER I WITH DIAERESIS AND ACUTE]
				fallthrough
			case '\u1EC9': // ỉ [LATIN SMALL LETTER I WITH HOOK ABOVE]
				fallthrough
			case '\u1ECB': // ị [LATIN SMALL LETTER I WITH DOT BELOW]
				fallthrough
			case '\u2071': // ⁱ [SUPERSCRIPT LATIN SMALL LETTER I]
				fallthrough
			case '\u24D8': // ⓘ [CIRCLED LATIN SMALL LETTER I]
				fallthrough
			case '\uFF49': // ｉ [FULLWIDTH LATIN SMALL LETTER I]
				output[outputPos] = 'i'
				outputPos++

			case '\u0132': // Ĳ [LATIN CAPITAL LIGATURE IJ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'I'
				outputPos++
				output[outputPos] = 'J'
				outputPos++

			case '\u24A4': // ⒤ [PARENTHESIZED LATIN SMALL LETTER I]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'i'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0133': // ĳ [LATIN SMALL LIGATURE IJ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'i'
				outputPos++
				output[outputPos] = 'j'
				outputPos++

			case '\u0134': // Ĵ [LATIN CAPITAL LETTER J WITH CIRCUMFLEX]
				fallthrough
			case '\u0248': // Ɉ [LATIN CAPITAL LETTER J WITH STROKE]
				fallthrough
			case '\u1D0A': // ᴊ [LATIN LETTER SMALL CAPITAL J]
				fallthrough
			case '\u24BF': // Ⓙ [CIRCLED LATIN CAPITAL LETTER J]
				fallthrough
			case '\uFF2A': // Ｊ [FULLWIDTH LATIN CAPITAL LETTER J]
				output[outputPos] = 'J'
				outputPos++

			case '\u0135': // ĵ [LATIN SMALL LETTER J WITH CIRCUMFLEX]
				fallthrough
			case '\u01F0': // ǰ [LATIN SMALL LETTER J WITH CARON]
				fallthrough
			case '\u0237': // ȷ [LATIN SMALL LETTER DOTLESS J]
				fallthrough
			case '\u0249': // ɉ [LATIN SMALL LETTER J WITH STROKE]
				fallthrough
			case '\u025F': // ɟ [LATIN SMALL LETTER DOTLESS J WITH STROKE]
				fallthrough
			case '\u0284': // ʄ [LATIN SMALL LETTER DOTLESS J WITH STROKE AND HOOK]
				fallthrough
			case '\u029D': // ʝ [LATIN SMALL LETTER J WITH CROSSED-TAIL]
				fallthrough
			case '\u24D9': // ⓙ [CIRCLED LATIN SMALL LETTER J]
				fallthrough
			case '\u2C7C': // ⱼ [LATIN SUBSCRIPT SMALL LETTER J]
				fallthrough
			case '\uFF4A': // ｊ [FULLWIDTH LATIN SMALL LETTER J]
				output[outputPos] = 'j'
				outputPos++

			case '\u24A5': // ⒥ [PARENTHESIZED LATIN SMALL LETTER J]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'j'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0136': // Ķ [LATIN CAPITAL LETTER K WITH CEDILLA]
				fallthrough
			case '\u0198': // Ƙ [LATIN CAPITAL LETTER K WITH HOOK]
				fallthrough
			case '\u01E8': // Ǩ [LATIN CAPITAL LETTER K WITH CARON]
				fallthrough
			case '\u1D0B': // ᴋ [LATIN LETTER SMALL CAPITAL K]
				fallthrough
			case '\u1E30': // Ḱ [LATIN CAPITAL LETTER K WITH ACUTE]
				fallthrough
			case '\u1E32': // Ḳ [LATIN CAPITAL LETTER K WITH DOT BELOW]
				fallthrough
			case '\u1E34': // Ḵ [LATIN CAPITAL LETTER K WITH LINE BELOW]
				fallthrough
			case '\u24C0': // Ⓚ [CIRCLED LATIN CAPITAL LETTER K]
				fallthrough
			case '\u2C69': // Ⱪ [LATIN CAPITAL LETTER K WITH DESCENDER]
				fallthrough
			case '\uA740': // Ꝁ [LATIN CAPITAL LETTER K WITH STROKE]
				fallthrough
			case '\uA742': // Ꝃ [LATIN CAPITAL LETTER K WITH DIAGONAL STROKE]
				fallthrough
			case '\uA744': // Ꝅ [LATIN CAPITAL LETTER K WITH STROKE AND DIAGONAL STROKE]
				fallthrough
			case '\uFF2B': // Ｋ [FULLWIDTH LATIN CAPITAL LETTER K]
				output[outputPos] = 'K'
				outputPos++

			case '\u0137': // ķ [LATIN SMALL LETTER K WITH CEDILLA]
				fallthrough
			case '\u0199': // ƙ [LATIN SMALL LETTER K WITH HOOK]
				fallthrough
			case '\u01E9': // ǩ [LATIN SMALL LETTER K WITH CARON]
				fallthrough
			case '\u029E': // ʞ [LATIN SMALL LETTER TURNED K]
				fallthrough
			case '\u1D84': // ᶄ [LATIN SMALL LETTER K WITH PALATAL HOOK]
				fallthrough
			case '\u1E31': // ḱ [LATIN SMALL LETTER K WITH ACUTE]
				fallthrough
			case '\u1E33': // ḳ [LATIN SMALL LETTER K WITH DOT BELOW]
				fallthrough
			case '\u1E35': // ḵ [LATIN SMALL LETTER K WITH LINE BELOW]
				fallthrough
			case '\u24DA': // ⓚ [CIRCLED LATIN SMALL LETTER K]
				fallthrough
			case '\u2C6A': // ⱪ [LATIN SMALL LETTER K WITH DESCENDER]
				fallthrough
			case '\uA741': // ꝁ [LATIN SMALL LETTER K WITH STROKE]
				fallthrough
			case '\uA743': // ꝃ [LATIN SMALL LETTER K WITH DIAGONAL STROKE]
				fallthrough
			case '\uA745': // ꝅ [LATIN SMALL LETTER K WITH STROKE AND DIAGONAL STROKE]
				fallthrough
			case '\uFF4B': // ｋ [FULLWIDTH LATIN SMALL LETTER K]
				output[outputPos] = 'k'
				outputPos++

			case '\u24A6': // ⒦ [PARENTHESIZED LATIN SMALL LETTER K]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'k'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0139': // Ĺ [LATIN CAPITAL LETTER L WITH ACUTE]
				fallthrough
			case '\u013B': // Ļ [LATIN CAPITAL LETTER L WITH CEDILLA]
				fallthrough
			case '\u013D': // Ľ [LATIN CAPITAL LETTER L WITH CARON]
				fallthrough
			case '\u013F': // Ŀ [LATIN CAPITAL LETTER L WITH MIDDLE DOT]
				fallthrough
			case '\u0141': // Ł [LATIN CAPITAL LETTER L WITH STROKE]
				fallthrough
			case '\u023D': // Ƚ [LATIN CAPITAL LETTER L WITH BAR]
				fallthrough
			case '\u029F': // ʟ [LATIN LETTER SMALL CAPITAL L]
				fallthrough
			case '\u1D0C': // ᴌ [LATIN LETTER SMALL CAPITAL L WITH STROKE]
				fallthrough
			case '\u1E36': // Ḷ [LATIN CAPITAL LETTER L WITH DOT BELOW]
				fallthrough
			case '\u1E38': // Ḹ [LATIN CAPITAL LETTER L WITH DOT BELOW AND MACRON]
				fallthrough
			case '\u1E3A': // Ḻ [LATIN CAPITAL LETTER L WITH LINE BELOW]
				fallthrough
			case '\u1E3C': // Ḽ [LATIN CAPITAL LETTER L WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u24C1': // Ⓛ [CIRCLED LATIN CAPITAL LETTER L]
				fallthrough
			case '\u2C60': // Ⱡ [LATIN CAPITAL LETTER L WITH DOUBLE BAR]
				fallthrough
			case '\u2C62': // Ɫ [LATIN CAPITAL LETTER L WITH MIDDLE TILDE]
				fallthrough
			case '\uA746': // Ꝇ [LATIN CAPITAL LETTER BROKEN L]
				fallthrough
			case '\uA748': // Ꝉ [LATIN CAPITAL LETTER L WITH HIGH STROKE]
				fallthrough
			case '\uA780': // Ꞁ [LATIN CAPITAL LETTER TURNED L]
				fallthrough
			case '\uFF2C': // Ｌ [FULLWIDTH LATIN CAPITAL LETTER L]
				output[outputPos] = 'L'
				outputPos++

			case '\u013A': // ĺ [LATIN SMALL LETTER L WITH ACUTE]
				fallthrough
			case '\u013C': // ļ [LATIN SMALL LETTER L WITH CEDILLA]
				fallthrough
			case '\u013E': // ľ [LATIN SMALL LETTER L WITH CARON]
				fallthrough
			case '\u0140': // ŀ [LATIN SMALL LETTER L WITH MIDDLE DOT]
				fallthrough
			case '\u0142': // ł [LATIN SMALL LETTER L WITH STROKE]
				fallthrough
			case '\u019A': // ƚ [LATIN SMALL LETTER L WITH BAR]
				fallthrough
			case '\u0234': // ȴ [LATIN SMALL LETTER L WITH CURL]
				fallthrough
			case '\u026B': // ɫ [LATIN SMALL LETTER L WITH MIDDLE TILDE]
				fallthrough
			case '\u026C': // ɬ [LATIN SMALL LETTER L WITH BELT]
				fallthrough
			case '\u026D': // ɭ [LATIN SMALL LETTER L WITH RETROFLEX HOOK]
				fallthrough
			case '\u1D85': // ᶅ [LATIN SMALL LETTER L WITH PALATAL HOOK]
				fallthrough
			case '\u1E37': // ḷ [LATIN SMALL LETTER L WITH DOT BELOW]
				fallthrough
			case '\u1E39': // ḹ [LATIN SMALL LETTER L WITH DOT BELOW AND MACRON]
				fallthrough
			case '\u1E3B': // ḻ [LATIN SMALL LETTER L WITH LINE BELOW]
				fallthrough
			case '\u1E3D': // ḽ [LATIN SMALL LETTER L WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u24DB': // ⓛ [CIRCLED LATIN SMALL LETTER L]
				fallthrough
			case '\u2C61': // ⱡ [LATIN SMALL LETTER L WITH DOUBLE BAR]
				fallthrough
			case '\uA747': // ꝇ [LATIN SMALL LETTER BROKEN L]
				fallthrough
			case '\uA749': // ꝉ [LATIN SMALL LETTER L WITH HIGH STROKE]
				fallthrough
			case '\uA781': // ꞁ [LATIN SMALL LETTER TURNED L]
				fallthrough
			case '\uFF4C': // ｌ [FULLWIDTH LATIN SMALL LETTER L]
				output[outputPos] = 'l'
				outputPos++

			case '\u01C7': // Ǉ [LATIN CAPITAL LETTER LJ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'L'
				outputPos++
				output[outputPos] = 'J'
				outputPos++

			case '\u1EFA': // Ỻ [LATIN CAPITAL LETTER MIDDLE-WELSH LL]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'L'
				outputPos++
				output[outputPos] = 'L'
				outputPos++

			case '\u01C8': // ǈ [LATIN CAPITAL LETTER L WITH SMALL LETTER J]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'L'
				outputPos++
				output[outputPos] = 'j'
				outputPos++

			case '\u24A7': // ⒧ [PARENTHESIZED LATIN SMALL LETTER L]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'l'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u01C9': // ǉ [LATIN SMALL LETTER LJ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'l'
				outputPos++
				output[outputPos] = 'j'
				outputPos++

			case '\u1EFB': // ỻ [LATIN SMALL LETTER MIDDLE-WELSH LL]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'l'
				outputPos++
				output[outputPos] = 'l'
				outputPos++

			case '\u02AA': // ʪ [LATIN SMALL LETTER LS DIGRAPH]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'l'
				outputPos++
				output[outputPos] = 's'
				outputPos++

			case '\u02AB': // ʫ [LATIN SMALL LETTER LZ DIGRAPH]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'l'
				outputPos++
				output[outputPos] = 'z'
				outputPos++

			case '\u019C': // Ɯ [LATIN CAPITAL LETTER TURNED M]
				fallthrough
			case '\u1D0D': // ᴍ [LATIN LETTER SMALL CAPITAL M]
				fallthrough
			case '\u1E3E': // Ḿ [LATIN CAPITAL LETTER M WITH ACUTE]
				fallthrough
			case '\u1E40': // Ṁ [LATIN CAPITAL LETTER M WITH DOT ABOVE]
				fallthrough
			case '\u1E42': // Ṃ [LATIN CAPITAL LETTER M WITH DOT BELOW]
				fallthrough
			case '\u24C2': // Ⓜ [CIRCLED LATIN CAPITAL LETTER M]
				fallthrough
			case '\u2C6E': // Ɱ [LATIN CAPITAL LETTER M WITH HOOK]
				fallthrough
			case '\uA7FD': // ꟽ [LATIN EPIGRAPHIC LETTER INVERTED M]
				fallthrough
			case '\uA7FF': // ꟿ [LATIN EPIGRAPHIC LETTER ARCHAIC M]
				fallthrough
			case '\uFF2D': // Ｍ [FULLWIDTH LATIN CAPITAL LETTER M]
				output[outputPos] = 'M'
				outputPos++

			case '\u026F': // ɯ [LATIN SMALL LETTER TURNED M]
				fallthrough
			case '\u0270': // ɰ [LATIN SMALL LETTER TURNED M WITH LONG LEG]
				fallthrough
			case '\u0271': // ɱ [LATIN SMALL LETTER M WITH HOOK]
				fallthrough
			case '\u1D6F': // ᵯ [LATIN SMALL LETTER M WITH MIDDLE TILDE]
				fallthrough
			case '\u1D86': // ᶆ [LATIN SMALL LETTER M WITH PALATAL HOOK]
				fallthrough
			case '\u1E3F': // ḿ [LATIN SMALL LETTER M WITH ACUTE]
				fallthrough
			case '\u1E41': // ṁ [LATIN SMALL LETTER M WITH DOT ABOVE]
				fallthrough
			case '\u1E43': // ṃ [LATIN SMALL LETTER M WITH DOT BELOW]
				fallthrough
			case '\u24DC': // ⓜ [CIRCLED LATIN SMALL LETTER M]
				fallthrough
			case '\uFF4D': // ｍ [FULLWIDTH LATIN SMALL LETTER M]
				output[outputPos] = 'm'
				outputPos++

			case '\u24A8': // ⒨ [PARENTHESIZED LATIN SMALL LETTER M]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'm'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u00D1': // Ñ [LATIN CAPITAL LETTER N WITH TILDE]
				fallthrough
			case '\u0143': // Ń [LATIN CAPITAL LETTER N WITH ACUTE]
				fallthrough
			case '\u0145': // Ņ [LATIN CAPITAL LETTER N WITH CEDILLA]
				fallthrough
			case '\u0147': // Ň [LATIN CAPITAL LETTER N WITH CARON]
				fallthrough
			case '\u014A': // Ŋ http://en.wikipedia.org/wiki/Eng_(letter) [LATIN CAPITAL LETTER ENG]
				fallthrough
			case '\u019D': // Ɲ [LATIN CAPITAL LETTER N WITH LEFT HOOK]
				fallthrough
			case '\u01F8': // Ǹ [LATIN CAPITAL LETTER N WITH GRAVE]
				fallthrough
			case '\u0220': // Ƞ [LATIN CAPITAL LETTER N WITH LONG RIGHT LEG]
				fallthrough
			case '\u0274': // ɴ [LATIN LETTER SMALL CAPITAL N]
				fallthrough
			case '\u1D0E': // ᴎ [LATIN LETTER SMALL CAPITAL REVERSED N]
				fallthrough
			case '\u1E44': // Ṅ [LATIN CAPITAL LETTER N WITH DOT ABOVE]
				fallthrough
			case '\u1E46': // Ṇ [LATIN CAPITAL LETTER N WITH DOT BELOW]
				fallthrough
			case '\u1E48': // Ṉ [LATIN CAPITAL LETTER N WITH LINE BELOW]
				fallthrough
			case '\u1E4A': // Ṋ [LATIN CAPITAL LETTER N WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u24C3': // Ⓝ [CIRCLED LATIN CAPITAL LETTER N]
				fallthrough
			case '\uFF2E': // Ｎ [FULLWIDTH LATIN CAPITAL LETTER N]
				output[outputPos] = 'N'
				outputPos++

			case '\u00F1': // ñ [LATIN SMALL LETTER N WITH TILDE]
				fallthrough
			case '\u0144': // ń [LATIN SMALL LETTER N WITH ACUTE]
				fallthrough
			case '\u0146': // ņ [LATIN SMALL LETTER N WITH CEDILLA]
				fallthrough
			case '\u0148': // ň [LATIN SMALL LETTER N WITH CARON]
				fallthrough
			case '\u0149': // ŉ [LATIN SMALL LETTER N PRECEDED BY APOSTROPHE]
				fallthrough
			case '\u014B': // ŋ http://en.wikipedia.org/wiki/Eng_(letter) [LATIN SMALL LETTER ENG]
				fallthrough
			case '\u019E': // ƞ [LATIN SMALL LETTER N WITH LONG RIGHT LEG]
				fallthrough
			case '\u01F9': // ǹ [LATIN SMALL LETTER N WITH GRAVE]
				fallthrough
			case '\u0235': // ȵ [LATIN SMALL LETTER N WITH CURL]
				fallthrough
			case '\u0272': // ɲ [LATIN SMALL LETTER N WITH LEFT HOOK]
				fallthrough
			case '\u0273': // ɳ [LATIN SMALL LETTER N WITH RETROFLEX HOOK]
				fallthrough
			case '\u1D70': // ᵰ [LATIN SMALL LETTER N WITH MIDDLE TILDE]
				fallthrough
			case '\u1D87': // ᶇ [LATIN SMALL LETTER N WITH PALATAL HOOK]
				fallthrough
			case '\u1E45': // ṅ [LATIN SMALL LETTER N WITH DOT ABOVE]
				fallthrough
			case '\u1E47': // ṇ [LATIN SMALL LETTER N WITH DOT BELOW]
				fallthrough
			case '\u1E49': // ṉ [LATIN SMALL LETTER N WITH LINE BELOW]
				fallthrough
			case '\u1E4B': // ṋ [LATIN SMALL LETTER N WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u207F': // ⁿ [SUPERSCRIPT LATIN SMALL LETTER N]
				fallthrough
			case '\u24DD': // ⓝ [CIRCLED LATIN SMALL LETTER N]
				fallthrough
			case '\uFF4E': // ｎ [FULLWIDTH LATIN SMALL LETTER N]
				output[outputPos] = 'n'
				outputPos++

			case '\u01CA': // Ǌ [LATIN CAPITAL LETTER NJ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'N'
				outputPos++
				output[outputPos] = 'J'
				outputPos++

			case '\u01CB': // ǋ [LATIN CAPITAL LETTER N WITH SMALL LETTER J]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'N'
				outputPos++
				output[outputPos] = 'j'
				outputPos++

			case '\u24A9': // ⒩ [PARENTHESIZED LATIN SMALL LETTER N]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'n'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u01CC': // ǌ [LATIN SMALL LETTER NJ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'n'
				outputPos++
				output[outputPos] = 'j'
				outputPos++

			case '\u00D2': // Ò [LATIN CAPITAL LETTER O WITH GRAVE]
				fallthrough
			case '\u00D3': // Ó [LATIN CAPITAL LETTER O WITH ACUTE]
				fallthrough
			case '\u00D4': // Ô [LATIN CAPITAL LETTER O WITH CIRCUMFLEX]
				fallthrough
			case '\u00D5': // Õ [LATIN CAPITAL LETTER O WITH TILDE]
				fallthrough
			case '\u00D6': // Ö [LATIN CAPITAL LETTER O WITH DIAERESIS]
				fallthrough
			case '\u00D8': // Ø [LATIN CAPITAL LETTER O WITH STROKE]
				fallthrough
			case '\u014C': // Ō [LATIN CAPITAL LETTER O WITH MACRON]
				fallthrough
			case '\u014E': // Ŏ [LATIN CAPITAL LETTER O WITH BREVE]
				fallthrough
			case '\u0150': // Ő [LATIN CAPITAL LETTER O WITH DOUBLE ACUTE]
				fallthrough
			case '\u0186': // Ɔ [LATIN CAPITAL LETTER OPEN O]
				fallthrough
			case '\u019F': // Ɵ [LATIN CAPITAL LETTER O WITH MIDDLE TILDE]
				fallthrough
			case '\u01A0': // Ơ [LATIN CAPITAL LETTER O WITH HORN]
				fallthrough
			case '\u01D1': // Ǒ [LATIN CAPITAL LETTER O WITH CARON]
				fallthrough
			case '\u01EA': // Ǫ [LATIN CAPITAL LETTER O WITH OGONEK]
				fallthrough
			case '\u01EC': // Ǭ [LATIN CAPITAL LETTER O WITH OGONEK AND MACRON]
				fallthrough
			case '\u01FE': // Ǿ [LATIN CAPITAL LETTER O WITH STROKE AND ACUTE]
				fallthrough
			case '\u020C': // Ȍ [LATIN CAPITAL LETTER O WITH DOUBLE GRAVE]
				fallthrough
			case '\u020E': // Ȏ [LATIN CAPITAL LETTER O WITH INVERTED BREVE]
				fallthrough
			case '\u022A': // Ȫ [LATIN CAPITAL LETTER O WITH DIAERESIS AND MACRON]
				fallthrough
			case '\u022C': // Ȭ [LATIN CAPITAL LETTER O WITH TILDE AND MACRON]
				fallthrough
			case '\u022E': // Ȯ [LATIN CAPITAL LETTER O WITH DOT ABOVE]
				fallthrough
			case '\u0230': // Ȱ [LATIN CAPITAL LETTER O WITH DOT ABOVE AND MACRON]
				fallthrough
			case '\u1D0F': // ᴏ [LATIN LETTER SMALL CAPITAL O]
				fallthrough
			case '\u1D10': // ᴐ [LATIN LETTER SMALL CAPITAL OPEN O]
				fallthrough
			case '\u1E4C': // Ṍ [LATIN CAPITAL LETTER O WITH TILDE AND ACUTE]
				fallthrough
			case '\u1E4E': // Ṏ [LATIN CAPITAL LETTER O WITH TILDE AND DIAERESIS]
				fallthrough
			case '\u1E50': // Ṑ [LATIN CAPITAL LETTER O WITH MACRON AND GRAVE]
				fallthrough
			case '\u1E52': // Ṓ [LATIN CAPITAL LETTER O WITH MACRON AND ACUTE]
				fallthrough
			case '\u1ECC': // Ọ [LATIN CAPITAL LETTER O WITH DOT BELOW]
				fallthrough
			case '\u1ECE': // Ỏ [LATIN CAPITAL LETTER O WITH HOOK ABOVE]
				fallthrough
			case '\u1ED0': // Ố [LATIN CAPITAL LETTER O WITH CIRCUMFLEX AND ACUTE]
				fallthrough
			case '\u1ED2': // Ồ [LATIN CAPITAL LETTER O WITH CIRCUMFLEX AND GRAVE]
				fallthrough
			case '\u1ED4': // Ổ [LATIN CAPITAL LETTER O WITH CIRCUMFLEX AND HOOK ABOVE]
				fallthrough
			case '\u1ED6': // Ỗ [LATIN CAPITAL LETTER O WITH CIRCUMFLEX AND TILDE]
				fallthrough
			case '\u1ED8': // Ộ [LATIN CAPITAL LETTER O WITH CIRCUMFLEX AND DOT BELOW]
				fallthrough
			case '\u1EDA': // Ớ [LATIN CAPITAL LETTER O WITH HORN AND ACUTE]
				fallthrough
			case '\u1EDC': // Ờ [LATIN CAPITAL LETTER O WITH HORN AND GRAVE]
				fallthrough
			case '\u1EDE': // Ở [LATIN CAPITAL LETTER O WITH HORN AND HOOK ABOVE]
				fallthrough
			case '\u1EE0': // Ỡ [LATIN CAPITAL LETTER O WITH HORN AND TILDE]
				fallthrough
			case '\u1EE2': // Ợ [LATIN CAPITAL LETTER O WITH HORN AND DOT BELOW]
				fallthrough
			case '\u24C4': // Ⓞ [CIRCLED LATIN CAPITAL LETTER O]
				fallthrough
			case '\uA74A': // Ꝋ [LATIN CAPITAL LETTER O WITH LONG STROKE OVERLAY]
				fallthrough
			case '\uA74C': // Ꝍ [LATIN CAPITAL LETTER O WITH LOOP]
				fallthrough
			case '\uFF2F': // Ｏ [FULLWIDTH LATIN CAPITAL LETTER O]
				output[outputPos] = 'O'
				outputPos++

			case '\u00F2': // ò [LATIN SMALL LETTER O WITH GRAVE]
				fallthrough
			case '\u00F3': // ó [LATIN SMALL LETTER O WITH ACUTE]
				fallthrough
			case '\u00F4': // ô [LATIN SMALL LETTER O WITH CIRCUMFLEX]
				fallthrough
			case '\u00F5': // õ [LATIN SMALL LETTER O WITH TILDE]
				fallthrough
			case '\u00F6': // ö [LATIN SMALL LETTER O WITH DIAERESIS]
				fallthrough
			case '\u00F8': // ø [LATIN SMALL LETTER O WITH STROKE]
				fallthrough
			case '\u014D': // ō [LATIN SMALL LETTER O WITH MACRON]
				fallthrough
			case '\u014F': // ŏ [LATIN SMALL LETTER O WITH BREVE]
				fallthrough
			case '\u0151': // ő [LATIN SMALL LETTER O WITH DOUBLE ACUTE]
				fallthrough
			case '\u01A1': // ơ [LATIN SMALL LETTER O WITH HORN]
				fallthrough
			case '\u01D2': // ǒ [LATIN SMALL LETTER O WITH CARON]
				fallthrough
			case '\u01EB': // ǫ [LATIN SMALL LETTER O WITH OGONEK]
				fallthrough
			case '\u01ED': // ǭ [LATIN SMALL LETTER O WITH OGONEK AND MACRON]
				fallthrough
			case '\u01FF': // ǿ [LATIN SMALL LETTER O WITH STROKE AND ACUTE]
				fallthrough
			case '\u020D': // ȍ [LATIN SMALL LETTER O WITH DOUBLE GRAVE]
				fallthrough
			case '\u020F': // ȏ [LATIN SMALL LETTER O WITH INVERTED BREVE]
				fallthrough
			case '\u022B': // ȫ [LATIN SMALL LETTER O WITH DIAERESIS AND MACRON]
				fallthrough
			case '\u022D': // ȭ [LATIN SMALL LETTER O WITH TILDE AND MACRON]
				fallthrough
			case '\u022F': // ȯ [LATIN SMALL LETTER O WITH DOT ABOVE]
				fallthrough
			case '\u0231': // ȱ [LATIN SMALL LETTER O WITH DOT ABOVE AND MACRON]
				fallthrough
			case '\u0254': // ɔ [LATIN SMALL LETTER OPEN O]
				fallthrough
			case '\u0275': // ɵ [LATIN SMALL LETTER BARRED O]
				fallthrough
			case '\u1D16': // ᴖ [LATIN SMALL LETTER TOP HALF O]
				fallthrough
			case '\u1D17': // ᴗ [LATIN SMALL LETTER BOTTOM HALF O]
				fallthrough
			case '\u1D97': // ᶗ [LATIN SMALL LETTER OPEN O WITH RETROFLEX HOOK]
				fallthrough
			case '\u1E4D': // ṍ [LATIN SMALL LETTER O WITH TILDE AND ACUTE]
				fallthrough
			case '\u1E4F': // ṏ [LATIN SMALL LETTER O WITH TILDE AND DIAERESIS]
				fallthrough
			case '\u1E51': // ṑ [LATIN SMALL LETTER O WITH MACRON AND GRAVE]
				fallthrough
			case '\u1E53': // ṓ [LATIN SMALL LETTER O WITH MACRON AND ACUTE]
				fallthrough
			case '\u1ECD': // ọ [LATIN SMALL LETTER O WITH DOT BELOW]
				fallthrough
			case '\u1ECF': // ỏ [LATIN SMALL LETTER O WITH HOOK ABOVE]
				fallthrough
			case '\u1ED1': // ố [LATIN SMALL LETTER O WITH CIRCUMFLEX AND ACUTE]
				fallthrough
			case '\u1ED3': // ồ [LATIN SMALL LETTER O WITH CIRCUMFLEX AND GRAVE]
				fallthrough
			case '\u1ED5': // ổ [LATIN SMALL LETTER O WITH CIRCUMFLEX AND HOOK ABOVE]
				fallthrough
			case '\u1ED7': // ỗ [LATIN SMALL LETTER O WITH CIRCUMFLEX AND TILDE]
				fallthrough
			case '\u1ED9': // ộ [LATIN SMALL LETTER O WITH CIRCUMFLEX AND DOT BELOW]
				fallthrough
			case '\u1EDB': // ớ [LATIN SMALL LETTER O WITH HORN AND ACUTE]
				fallthrough
			case '\u1EDD': // ờ [LATIN SMALL LETTER O WITH HORN AND GRAVE]
				fallthrough
			case '\u1EDF': // ở [LATIN SMALL LETTER O WITH HORN AND HOOK ABOVE]
				fallthrough
			case '\u1EE1': // ỡ [LATIN SMALL LETTER O WITH HORN AND TILDE]
				fallthrough
			case '\u1EE3': // ợ [LATIN SMALL LETTER O WITH HORN AND DOT BELOW]
				fallthrough
			case '\u2092': // ₒ [LATIN SUBSCRIPT SMALL LETTER O]
				fallthrough
			case '\u24DE': // ⓞ [CIRCLED LATIN SMALL LETTER O]
				fallthrough
			case '\u2C7A': // ⱺ [LATIN SMALL LETTER O WITH LOW RING INSIDE]
				fallthrough
			case '\uA74B': // ꝋ [LATIN SMALL LETTER O WITH LONG STROKE OVERLAY]
				fallthrough
			case '\uA74D': // ꝍ [LATIN SMALL LETTER O WITH LOOP]
				fallthrough
			case '\uFF4F': // ｏ [FULLWIDTH LATIN SMALL LETTER O]
				output[outputPos] = 'o'
				outputPos++

			case '\u0152': // Œ [LATIN CAPITAL LIGATURE OE]
				fallthrough
			case '\u0276': // ɶ [LATIN LETTER SMALL CAPITAL OE]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'O'
				outputPos++
				output[outputPos] = 'E'
				outputPos++

			case '\uA74E': // Ꝏ [LATIN CAPITAL LETTER OO]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'O'
				outputPos++
				output[outputPos] = 'O'
				outputPos++

			case '\u0222': // Ȣ http://en.wikipedia.org/wiki/OU [LATIN CAPITAL LETTER OU]
				fallthrough
			case '\u1D15': // ᴕ [LATIN LETTER SMALL CAPITAL OU]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'O'
				outputPos++
				output[outputPos] = 'U'
				outputPos++

			case '\u24AA': // ⒪ [PARENTHESIZED LATIN SMALL LETTER O]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'o'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0153': // œ [LATIN SMALL LIGATURE OE]
				fallthrough
			case '\u1D14': // ᴔ [LATIN SMALL LETTER TURNED OE]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'o'
				outputPos++
				output[outputPos] = 'e'
				outputPos++

			case '\uA74F': // ꝏ [LATIN SMALL LETTER OO]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'o'
				outputPos++
				output[outputPos] = 'o'
				outputPos++

			case '\u0223': // ȣ http://en.wikipedia.org/wiki/OU [LATIN SMALL LETTER OU]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'o'
				outputPos++
				output[outputPos] = 'u'
				outputPos++

			case '\u01A4': // Ƥ [LATIN CAPITAL LETTER P WITH HOOK]
				fallthrough
			case '\u1D18': // ᴘ [LATIN LETTER SMALL CAPITAL P]
				fallthrough
			case '\u1E54': // Ṕ [LATIN CAPITAL LETTER P WITH ACUTE]
				fallthrough
			case '\u1E56': // Ṗ [LATIN CAPITAL LETTER P WITH DOT ABOVE]
				fallthrough
			case '\u24C5': // Ⓟ [CIRCLED LATIN CAPITAL LETTER P]
				fallthrough
			case '\u2C63': // Ᵽ [LATIN CAPITAL LETTER P WITH STROKE]
				fallthrough
			case '\uA750': // Ꝑ [LATIN CAPITAL LETTER P WITH STROKE THROUGH DESCENDER]
				fallthrough
			case '\uA752': // Ꝓ [LATIN CAPITAL LETTER P WITH FLOURISH]
				fallthrough
			case '\uA754': // Ꝕ [LATIN CAPITAL LETTER P WITH SQUIRREL TAIL]
				fallthrough
			case '\uFF30': // Ｐ [FULLWIDTH LATIN CAPITAL LETTER P]
				output[outputPos] = 'P'
				outputPos++

			case '\u01A5': // ƥ [LATIN SMALL LETTER P WITH HOOK]
				fallthrough
			case '\u1D71': // ᵱ [LATIN SMALL LETTER P WITH MIDDLE TILDE]
				fallthrough
			case '\u1D7D': // ᵽ [LATIN SMALL LETTER P WITH STROKE]
				fallthrough
			case '\u1D88': // ᶈ [LATIN SMALL LETTER P WITH PALATAL HOOK]
				fallthrough
			case '\u1E55': // ṕ [LATIN SMALL LETTER P WITH ACUTE]
				fallthrough
			case '\u1E57': // ṗ [LATIN SMALL LETTER P WITH DOT ABOVE]
				fallthrough
			case '\u24DF': // ⓟ [CIRCLED LATIN SMALL LETTER P]
				fallthrough
			case '\uA751': // ꝑ [LATIN SMALL LETTER P WITH STROKE THROUGH DESCENDER]
				fallthrough
			case '\uA753': // ꝓ [LATIN SMALL LETTER P WITH FLOURISH]
				fallthrough
			case '\uA755': // ꝕ [LATIN SMALL LETTER P WITH SQUIRREL TAIL]
				fallthrough
			case '\uA7FC': // ꟼ [LATIN EPIGRAPHIC LETTER REVERSED P]
				fallthrough
			case '\uFF50': // ｐ [FULLWIDTH LATIN SMALL LETTER P]
				output[outputPos] = 'p'
				outputPos++

			case '\u24AB': // ⒫ [PARENTHESIZED LATIN SMALL LETTER P]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'p'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u024A': // Ɋ [LATIN CAPITAL LETTER SMALL Q WITH HOOK TAIL]
				fallthrough
			case '\u24C6': // Ⓠ [CIRCLED LATIN CAPITAL LETTER Q]
				fallthrough
			case '\uA756': // Ꝗ [LATIN CAPITAL LETTER Q WITH STROKE THROUGH DESCENDER]
				fallthrough
			case '\uA758': // Ꝙ [LATIN CAPITAL LETTER Q WITH DIAGONAL STROKE]
				fallthrough
			case '\uFF31': // Ｑ [FULLWIDTH LATIN CAPITAL LETTER Q]
				output[outputPos] = 'Q'
				outputPos++

			case '\u0138': // ĸ http://en.wikipedia.org/wiki/Kra_(letter) [LATIN SMALL LETTER KRA]
				fallthrough
			case '\u024B': // ɋ [LATIN SMALL LETTER Q WITH HOOK TAIL]
				fallthrough
			case '\u02A0': // ʠ [LATIN SMALL LETTER Q WITH HOOK]
				fallthrough
			case '\u24E0': // ⓠ [CIRCLED LATIN SMALL LETTER Q]
				fallthrough
			case '\uA757': // ꝗ [LATIN SMALL LETTER Q WITH STROKE THROUGH DESCENDER]
				fallthrough
			case '\uA759': // ꝙ [LATIN SMALL LETTER Q WITH DIAGONAL STROKE]
				fallthrough
			case '\uFF51': // ｑ [FULLWIDTH LATIN SMALL LETTER Q]
				output[outputPos] = 'q'
				outputPos++

			case '\u24AC': // ⒬ [PARENTHESIZED LATIN SMALL LETTER Q]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'q'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0239': // ȹ [LATIN SMALL LETTER QP DIGRAPH]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'q'
				outputPos++
				output[outputPos] = 'p'
				outputPos++

			case '\u0154': // Ŕ [LATIN CAPITAL LETTER R WITH ACUTE]
				fallthrough
			case '\u0156': // Ŗ [LATIN CAPITAL LETTER R WITH CEDILLA]
				fallthrough
			case '\u0158': // Ř [LATIN CAPITAL LETTER R WITH CARON]
				fallthrough
			case '\u0210': // Ȓ [LATIN CAPITAL LETTER R WITH DOUBLE GRAVE]
				fallthrough
			case '\u0212': // Ȓ [LATIN CAPITAL LETTER R WITH INVERTED BREVE]
				fallthrough
			case '\u024C': // Ɍ [LATIN CAPITAL LETTER R WITH STROKE]
				fallthrough
			case '\u0280': // ʀ [LATIN LETTER SMALL CAPITAL R]
				fallthrough
			case '\u0281': // ʁ [LATIN LETTER SMALL CAPITAL INVERTED R]
				fallthrough
			case '\u1D19': // ᴙ [LATIN LETTER SMALL CAPITAL REVERSED R]
				fallthrough
			case '\u1D1A': // ᴚ [LATIN LETTER SMALL CAPITAL TURNED R]
				fallthrough
			case '\u1E58': // Ṙ [LATIN CAPITAL LETTER R WITH DOT ABOVE]
				fallthrough
			case '\u1E5A': // Ṛ [LATIN CAPITAL LETTER R WITH DOT BELOW]
				fallthrough
			case '\u1E5C': // Ṝ [LATIN CAPITAL LETTER R WITH DOT BELOW AND MACRON]
				fallthrough
			case '\u1E5E': // Ṟ [LATIN CAPITAL LETTER R WITH LINE BELOW]
				fallthrough
			case '\u24C7': // Ⓡ [CIRCLED LATIN CAPITAL LETTER R]
				fallthrough
			case '\u2C64': // Ɽ [LATIN CAPITAL LETTER R WITH TAIL]
				fallthrough
			case '\uA75A': // Ꝛ [LATIN CAPITAL LETTER R ROTUNDA]
				fallthrough
			case '\uA782': // Ꞃ [LATIN CAPITAL LETTER INSULAR R]
				fallthrough
			case '\uFF32': // Ｒ [FULLWIDTH LATIN CAPITAL LETTER R]
				output[outputPos] = 'R'
				outputPos++

			case '\u0155': // ŕ [LATIN SMALL LETTER R WITH ACUTE]
				fallthrough
			case '\u0157': // ŗ [LATIN SMALL LETTER R WITH CEDILLA]
				fallthrough
			case '\u0159': // ř [LATIN SMALL LETTER R WITH CARON]
				fallthrough
			case '\u0211': // ȑ [LATIN SMALL LETTER R WITH DOUBLE GRAVE]
				fallthrough
			case '\u0213': // ȓ [LATIN SMALL LETTER R WITH INVERTED BREVE]
				fallthrough
			case '\u024D': // ɍ [LATIN SMALL LETTER R WITH STROKE]
				fallthrough
			case '\u027C': // ɼ [LATIN SMALL LETTER R WITH LONG LEG]
				fallthrough
			case '\u027D': // ɽ [LATIN SMALL LETTER R WITH TAIL]
				fallthrough
			case '\u027E': // ɾ [LATIN SMALL LETTER R WITH FISHHOOK]
				fallthrough
			case '\u027F': // ɿ [LATIN SMALL LETTER REVERSED R WITH FISHHOOK]
				fallthrough
			case '\u1D63': // ᵣ [LATIN SUBSCRIPT SMALL LETTER R]
				fallthrough
			case '\u1D72': // ᵲ [LATIN SMALL LETTER R WITH MIDDLE TILDE]
				fallthrough
			case '\u1D73': // ᵳ [LATIN SMALL LETTER R WITH FISHHOOK AND MIDDLE TILDE]
				fallthrough
			case '\u1D89': // ᶉ [LATIN SMALL LETTER R WITH PALATAL HOOK]
				fallthrough
			case '\u1E59': // ṙ [LATIN SMALL LETTER R WITH DOT ABOVE]
				fallthrough
			case '\u1E5B': // ṛ [LATIN SMALL LETTER R WITH DOT BELOW]
				fallthrough
			case '\u1E5D': // ṝ [LATIN SMALL LETTER R WITH DOT BELOW AND MACRON]
				fallthrough
			case '\u1E5F': // ṟ [LATIN SMALL LETTER R WITH LINE BELOW]
				fallthrough
			case '\u24E1': // ⓡ [CIRCLED LATIN SMALL LETTER R]
				fallthrough
			case '\uA75B': // ꝛ [LATIN SMALL LETTER R ROTUNDA]
				fallthrough
			case '\uA783': // ꞃ [LATIN SMALL LETTER INSULAR R]
				fallthrough
			case '\uFF52': // ｒ [FULLWIDTH LATIN SMALL LETTER R]
				output[outputPos] = 'r'
				outputPos++

			case '\u24AD': // ⒭ [PARENTHESIZED LATIN SMALL LETTER R]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'r'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u015A': // Ś [LATIN CAPITAL LETTER S WITH ACUTE]
				fallthrough
			case '\u015C': // Ŝ [LATIN CAPITAL LETTER S WITH CIRCUMFLEX]
				fallthrough
			case '\u015E': // Ş [LATIN CAPITAL LETTER S WITH CEDILLA]
				fallthrough
			case '\u0160': // Š [LATIN CAPITAL LETTER S WITH CARON]
				fallthrough
			case '\u0218': // Ș [LATIN CAPITAL LETTER S WITH COMMA BELOW]
				fallthrough
			case '\u1E60': // Ṡ [LATIN CAPITAL LETTER S WITH DOT ABOVE]
				fallthrough
			case '\u1E62': // Ṣ [LATIN CAPITAL LETTER S WITH DOT BELOW]
				fallthrough
			case '\u1E64': // Ṥ [LATIN CAPITAL LETTER S WITH ACUTE AND DOT ABOVE]
				fallthrough
			case '\u1E66': // Ṧ [LATIN CAPITAL LETTER S WITH CARON AND DOT ABOVE]
				fallthrough
			case '\u1E68': // Ṩ [LATIN CAPITAL LETTER S WITH DOT BELOW AND DOT ABOVE]
				fallthrough
			case '\u24C8': // Ⓢ [CIRCLED LATIN CAPITAL LETTER S]
				fallthrough
			case '\uA731': // ꜱ [LATIN LETTER SMALL CAPITAL S]
				fallthrough
			case '\uA785': // ꞅ [LATIN SMALL LETTER INSULAR S]
				fallthrough
			case '\uFF33': // Ｓ [FULLWIDTH LATIN CAPITAL LETTER S]
				output[outputPos] = 'S'
				outputPos++

			case '\u015B': // ś [LATIN SMALL LETTER S WITH ACUTE]
				fallthrough
			case '\u015D': // ŝ [LATIN SMALL LETTER S WITH CIRCUMFLEX]
				fallthrough
			case '\u015F': // ş [LATIN SMALL LETTER S WITH CEDILLA]
				fallthrough
			case '\u0161': // š [LATIN SMALL LETTER S WITH CARON]
				fallthrough
			case '\u017F': // ſ http://en.wikipedia.org/wiki/Long_S [LATIN SMALL LETTER LONG S]
				fallthrough
			case '\u0219': // ș [LATIN SMALL LETTER S WITH COMMA BELOW]
				fallthrough
			case '\u023F': // ȿ [LATIN SMALL LETTER S WITH SWASH TAIL]
				fallthrough
			case '\u0282': // ʂ [LATIN SMALL LETTER S WITH HOOK]
				fallthrough
			case '\u1D74': // ᵴ [LATIN SMALL LETTER S WITH MIDDLE TILDE]
				fallthrough
			case '\u1D8A': // ᶊ [LATIN SMALL LETTER S WITH PALATAL HOOK]
				fallthrough
			case '\u1E61': // ṡ [LATIN SMALL LETTER S WITH DOT ABOVE]
				fallthrough
			case '\u1E63': // ṣ [LATIN SMALL LETTER S WITH DOT BELOW]
				fallthrough
			case '\u1E65': // ṥ [LATIN SMALL LETTER S WITH ACUTE AND DOT ABOVE]
				fallthrough
			case '\u1E67': // ṧ [LATIN SMALL LETTER S WITH CARON AND DOT ABOVE]
				fallthrough
			case '\u1E69': // ṩ [LATIN SMALL LETTER S WITH DOT BELOW AND DOT ABOVE]
				fallthrough
			case '\u1E9C': // ẜ [LATIN SMALL LETTER LONG S WITH DIAGONAL STROKE]
				fallthrough
			case '\u1E9D': // ẝ [LATIN SMALL LETTER LONG S WITH HIGH STROKE]
				fallthrough
			case '\u24E2': // ⓢ [CIRCLED LATIN SMALL LETTER S]
				fallthrough
			case '\uA784': // Ꞅ [LATIN CAPITAL LETTER INSULAR S]
				fallthrough
			case '\uFF53': // ｓ [FULLWIDTH LATIN SMALL LETTER S]
				output[outputPos] = 's'
				outputPos++

			case '\u1E9E': // ẞ [LATIN CAPITAL LETTER SHARP S]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'S'
				outputPos++
				output[outputPos] = 'S'
				outputPos++

			case '\u24AE': // ⒮ [PARENTHESIZED LATIN SMALL LETTER S]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 's'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u00DF': // ß [LATIN SMALL LETTER SHARP S]
				output = output[:(len(output) + 1)]
				output[outputPos] = 's'
				outputPos++
				output[outputPos] = 's'
				outputPos++

			case '\uFB06': // ﬆ [LATIN SMALL LIGATURE ST]
				output = output[:(len(output) + 1)]
				output[outputPos] = 's'
				outputPos++
				output[outputPos] = 't'
				outputPos++

			case '\u0162': // Ţ [LATIN CAPITAL LETTER T WITH CEDILLA]
				fallthrough
			case '\u0164': // Ť [LATIN CAPITAL LETTER T WITH CARON]
				fallthrough
			case '\u0166': // Ŧ [LATIN CAPITAL LETTER T WITH STROKE]
				fallthrough
			case '\u01AC': // Ƭ [LATIN CAPITAL LETTER T WITH HOOK]
				fallthrough
			case '\u01AE': // Ʈ [LATIN CAPITAL LETTER T WITH RETROFLEX HOOK]
				fallthrough
			case '\u021A': // Ț [LATIN CAPITAL LETTER T WITH COMMA BELOW]
				fallthrough
			case '\u023E': // Ⱦ [LATIN CAPITAL LETTER T WITH DIAGONAL STROKE]
				fallthrough
			case '\u1D1B': // ᴛ [LATIN LETTER SMALL CAPITAL T]
				fallthrough
			case '\u1E6A': // Ṫ [LATIN CAPITAL LETTER T WITH DOT ABOVE]
				fallthrough
			case '\u1E6C': // Ṭ [LATIN CAPITAL LETTER T WITH DOT BELOW]
				fallthrough
			case '\u1E6E': // Ṯ [LATIN CAPITAL LETTER T WITH LINE BELOW]
				fallthrough
			case '\u1E70': // Ṱ [LATIN CAPITAL LETTER T WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u24C9': // Ⓣ [CIRCLED LATIN CAPITAL LETTER T]
				fallthrough
			case '\uA786': // Ꞇ [LATIN CAPITAL LETTER INSULAR T]
				fallthrough
			case '\uFF34': // Ｔ [FULLWIDTH LATIN CAPITAL LETTER T]
				output[outputPos] = 'T'
				outputPos++

			case '\u0163': // ţ [LATIN SMALL LETTER T WITH CEDILLA]
				fallthrough
			case '\u0165': // ť [LATIN SMALL LETTER T WITH CARON]
				fallthrough
			case '\u0167': // ŧ [LATIN SMALL LETTER T WITH STROKE]
				fallthrough
			case '\u01AB': // ƫ [LATIN SMALL LETTER T WITH PALATAL HOOK]
				fallthrough
			case '\u01AD': // ƭ [LATIN SMALL LETTER T WITH HOOK]
				fallthrough
			case '\u021B': // ț [LATIN SMALL LETTER T WITH COMMA BELOW]
				fallthrough
			case '\u0236': // ȶ [LATIN SMALL LETTER T WITH CURL]
				fallthrough
			case '\u0287': // ʇ [LATIN SMALL LETTER TURNED T]
				fallthrough
			case '\u0288': // ʈ [LATIN SMALL LETTER T WITH RETROFLEX HOOK]
				fallthrough
			case '\u1D75': // ᵵ [LATIN SMALL LETTER T WITH MIDDLE TILDE]
				fallthrough
			case '\u1E6B': // ṫ [LATIN SMALL LETTER T WITH DOT ABOVE]
				fallthrough
			case '\u1E6D': // ṭ [LATIN SMALL LETTER T WITH DOT BELOW]
				fallthrough
			case '\u1E6F': // ṯ [LATIN SMALL LETTER T WITH LINE BELOW]
				fallthrough
			case '\u1E71': // ṱ [LATIN SMALL LETTER T WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u1E97': // ẗ [LATIN SMALL LETTER T WITH DIAERESIS]
				fallthrough
			case '\u24E3': // ⓣ [CIRCLED LATIN SMALL LETTER T]
				fallthrough
			case '\u2C66': // ⱦ [LATIN SMALL LETTER T WITH DIAGONAL STROKE]
				fallthrough
			case '\uFF54': // ｔ [FULLWIDTH LATIN SMALL LETTER T]
				output[outputPos] = 't'
				outputPos++

			case '\u00DE': // Þ [LATIN CAPITAL LETTER THORN]
				fallthrough
			case '\uA766': // Ꝧ [LATIN CAPITAL LETTER THORN WITH STROKE THROUGH DESCENDER]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'T'
				outputPos++
				output[outputPos] = 'H'
				outputPos++

			case '\uA728': // Ꜩ [LATIN CAPITAL LETTER TZ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'T'
				outputPos++
				output[outputPos] = 'Z'
				outputPos++

			case '\u24AF': // ⒯ [PARENTHESIZED LATIN SMALL LETTER T]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 't'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u02A8': // ʨ [LATIN SMALL LETTER TC DIGRAPH WITH CURL]
				output = output[:(len(output) + 1)]
				output[outputPos] = 't'
				outputPos++
				output[outputPos] = 'c'
				outputPos++

			case '\u00FE': // þ [LATIN SMALL LETTER THORN]
				fallthrough
			case '\u1D7A': // ᵺ [LATIN SMALL LETTER TH WITH STRIKETHROUGH]
				fallthrough
			case '\uA767': // ꝧ [LATIN SMALL LETTER THORN WITH STROKE THROUGH DESCENDER]
				output = output[:(len(output) + 1)]
				output[outputPos] = 't'
				outputPos++
				output[outputPos] = 'h'
				outputPos++

			case '\u02A6': // ʦ [LATIN SMALL LETTER TS DIGRAPH]
				output = output[:(len(output) + 1)]
				output[outputPos] = 't'
				outputPos++
				output[outputPos] = 's'
				outputPos++

			case '\uA729': // ꜩ [LATIN SMALL LETTER TZ]
				output = output[:(len(output) + 1)]
				output[outputPos] = 't'
				outputPos++
				output[outputPos] = 'z'
				outputPos++

			case '\u00D9': // Ù [LATIN CAPITAL LETTER U WITH GRAVE]
				fallthrough
			case '\u00DA': // Ú [LATIN CAPITAL LETTER U WITH ACUTE]
				fallthrough
			case '\u00DB': // Û [LATIN CAPITAL LETTER U WITH CIRCUMFLEX]
				fallthrough
			case '\u00DC': // Ü [LATIN CAPITAL LETTER U WITH DIAERESIS]
				fallthrough
			case '\u0168': // Ũ [LATIN CAPITAL LETTER U WITH TILDE]
				fallthrough
			case '\u016A': // Ū [LATIN CAPITAL LETTER U WITH MACRON]
				fallthrough
			case '\u016C': // Ŭ [LATIN CAPITAL LETTER U WITH BREVE]
				fallthrough
			case '\u016E': // Ů [LATIN CAPITAL LETTER U WITH RING ABOVE]
				fallthrough
			case '\u0170': // Ű [LATIN CAPITAL LETTER U WITH DOUBLE ACUTE]
				fallthrough
			case '\u0172': // Ų [LATIN CAPITAL LETTER U WITH OGONEK]
				fallthrough
			case '\u01AF': // Ư [LATIN CAPITAL LETTER U WITH HORN]
				fallthrough
			case '\u01D3': // Ǔ [LATIN CAPITAL LETTER U WITH CARON]
				fallthrough
			case '\u01D5': // Ǖ [LATIN CAPITAL LETTER U WITH DIAERESIS AND MACRON]
				fallthrough
			case '\u01D7': // Ǘ [LATIN CAPITAL LETTER U WITH DIAERESIS AND ACUTE]
				fallthrough
			case '\u01D9': // Ǚ [LATIN CAPITAL LETTER U WITH DIAERESIS AND CARON]
				fallthrough
			case '\u01DB': // Ǜ [LATIN CAPITAL LETTER U WITH DIAERESIS AND GRAVE]
				fallthrough
			case '\u0214': // Ȕ [LATIN CAPITAL LETTER U WITH DOUBLE GRAVE]
				fallthrough
			case '\u0216': // Ȗ [LATIN CAPITAL LETTER U WITH INVERTED BREVE]
				fallthrough
			case '\u0244': // Ʉ [LATIN CAPITAL LETTER U BAR]
				fallthrough
			case '\u1D1C': // ᴜ [LATIN LETTER SMALL CAPITAL U]
				fallthrough
			case '\u1D7E': // ᵾ [LATIN SMALL CAPITAL LETTER U WITH STROKE]
				fallthrough
			case '\u1E72': // Ṳ [LATIN CAPITAL LETTER U WITH DIAERESIS BELOW]
				fallthrough
			case '\u1E74': // Ṵ [LATIN CAPITAL LETTER U WITH TILDE BELOW]
				fallthrough
			case '\u1E76': // Ṷ [LATIN CAPITAL LETTER U WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u1E78': // Ṹ [LATIN CAPITAL LETTER U WITH TILDE AND ACUTE]
				fallthrough
			case '\u1E7A': // Ṻ [LATIN CAPITAL LETTER U WITH MACRON AND DIAERESIS]
				fallthrough
			case '\u1EE4': // Ụ [LATIN CAPITAL LETTER U WITH DOT BELOW]
				fallthrough
			case '\u1EE6': // Ủ [LATIN CAPITAL LETTER U WITH HOOK ABOVE]
				fallthrough
			case '\u1EE8': // Ứ [LATIN CAPITAL LETTER U WITH HORN AND ACUTE]
				fallthrough
			case '\u1EEA': // Ừ [LATIN CAPITAL LETTER U WITH HORN AND GRAVE]
				fallthrough
			case '\u1EEC': // Ử [LATIN CAPITAL LETTER U WITH HORN AND HOOK ABOVE]
				fallthrough
			case '\u1EEE': // Ữ [LATIN CAPITAL LETTER U WITH HORN AND TILDE]
				fallthrough
			case '\u1EF0': // Ự [LATIN CAPITAL LETTER U WITH HORN AND DOT BELOW]
				fallthrough
			case '\u24CA': // Ⓤ [CIRCLED LATIN CAPITAL LETTER U]
				fallthrough
			case '\uFF35': // Ｕ [FULLWIDTH LATIN CAPITAL LETTER U]
				output[outputPos] = 'U'
				outputPos++

			case '\u00F9': // ù [LATIN SMALL LETTER U WITH GRAVE]
				fallthrough
			case '\u00FA': // ú [LATIN SMALL LETTER U WITH ACUTE]
				fallthrough
			case '\u00FB': // û [LATIN SMALL LETTER U WITH CIRCUMFLEX]
				fallthrough
			case '\u00FC': // ü [LATIN SMALL LETTER U WITH DIAERESIS]
				fallthrough
			case '\u0169': // ũ [LATIN SMALL LETTER U WITH TILDE]
				fallthrough
			case '\u016B': // ū [LATIN SMALL LETTER U WITH MACRON]
				fallthrough
			case '\u016D': // ŭ [LATIN SMALL LETTER U WITH BREVE]
				fallthrough
			case '\u016F': // ů [LATIN SMALL LETTER U WITH RING ABOVE]
				fallthrough
			case '\u0171': // ű [LATIN SMALL LETTER U WITH DOUBLE ACUTE]
				fallthrough
			case '\u0173': // ų [LATIN SMALL LETTER U WITH OGONEK]
				fallthrough
			case '\u01B0': // ư [LATIN SMALL LETTER U WITH HORN]
				fallthrough
			case '\u01D4': // ǔ [LATIN SMALL LETTER U WITH CARON]
				fallthrough
			case '\u01D6': // ǖ [LATIN SMALL LETTER U WITH DIAERESIS AND MACRON]
				fallthrough
			case '\u01D8': // ǘ [LATIN SMALL LETTER U WITH DIAERESIS AND ACUTE]
				fallthrough
			case '\u01DA': // ǚ [LATIN SMALL LETTER U WITH DIAERESIS AND CARON]
				fallthrough
			case '\u01DC': // ǜ [LATIN SMALL LETTER U WITH DIAERESIS AND GRAVE]
				fallthrough
			case '\u0215': // ȕ [LATIN SMALL LETTER U WITH DOUBLE GRAVE]
				fallthrough
			case '\u0217': // ȗ [LATIN SMALL LETTER U WITH INVERTED BREVE]
				fallthrough
			case '\u0289': // ʉ [LATIN SMALL LETTER U BAR]
				fallthrough
			case '\u1D64': // ᵤ [LATIN SUBSCRIPT SMALL LETTER U]
				fallthrough
			case '\u1D99': // ᶙ [LATIN SMALL LETTER U WITH RETROFLEX HOOK]
				fallthrough
			case '\u1E73': // ṳ [LATIN SMALL LETTER U WITH DIAERESIS BELOW]
				fallthrough
			case '\u1E75': // ṵ [LATIN SMALL LETTER U WITH TILDE BELOW]
				fallthrough
			case '\u1E77': // ṷ [LATIN SMALL LETTER U WITH CIRCUMFLEX BELOW]
				fallthrough
			case '\u1E79': // ṹ [LATIN SMALL LETTER U WITH TILDE AND ACUTE]
				fallthrough
			case '\u1E7B': // ṻ [LATIN SMALL LETTER U WITH MACRON AND DIAERESIS]
				fallthrough
			case '\u1EE5': // ụ [LATIN SMALL LETTER U WITH DOT BELOW]
				fallthrough
			case '\u1EE7': // ủ [LATIN SMALL LETTER U WITH HOOK ABOVE]
				fallthrough
			case '\u1EE9': // ứ [LATIN SMALL LETTER U WITH HORN AND ACUTE]
				fallthrough
			case '\u1EEB': // ừ [LATIN SMALL LETTER U WITH HORN AND GRAVE]
				fallthrough
			case '\u1EED': // ử [LATIN SMALL LETTER U WITH HORN AND HOOK ABOVE]
				fallthrough
			case '\u1EEF': // ữ [LATIN SMALL LETTER U WITH HORN AND TILDE]
				fallthrough
			case '\u1EF1': // ự [LATIN SMALL LETTER U WITH HORN AND DOT BELOW]
				fallthrough
			case '\u24E4': // ⓤ [CIRCLED LATIN SMALL LETTER U]
				fallthrough
			case '\uFF55': // ｕ [FULLWIDTH LATIN SMALL LETTER U]
				output[outputPos] = 'u'
				outputPos++

			case '\u24B0': // ⒰ [PARENTHESIZED LATIN SMALL LETTER U]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'u'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u1D6B': // ᵫ [LATIN SMALL LETTER UE]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'u'
				outputPos++
				output[outputPos] = 'e'
				outputPos++

			case '\u01B2': // Ʋ [LATIN CAPITAL LETTER V WITH HOOK]
				fallthrough
			case '\u0245': // Ʌ [LATIN CAPITAL LETTER TURNED V]
				fallthrough
			case '\u1D20': // ᴠ [LATIN LETTER SMALL CAPITAL V]
				fallthrough
			case '\u1E7C': // Ṽ [LATIN CAPITAL LETTER V WITH TILDE]
				fallthrough
			case '\u1E7E': // Ṿ [LATIN CAPITAL LETTER V WITH DOT BELOW]
				fallthrough
			case '\u1EFC': // Ỽ [LATIN CAPITAL LETTER MIDDLE-WELSH V]
				fallthrough
			case '\u24CB': // Ⓥ [CIRCLED LATIN CAPITAL LETTER V]
				fallthrough
			case '\uA75E': // Ꝟ [LATIN CAPITAL LETTER V WITH DIAGONAL STROKE]
				fallthrough
			case '\uA768': // Ꝩ [LATIN CAPITAL LETTER VEND]
				fallthrough
			case '\uFF36': // Ｖ [FULLWIDTH LATIN CAPITAL LETTER V]
				output[outputPos] = 'V'
				outputPos++

			case '\u028B': // ʋ [LATIN SMALL LETTER V WITH HOOK]
				fallthrough
			case '\u028C': // ʌ [LATIN SMALL LETTER TURNED V]
				fallthrough
			case '\u1D65': // ᵥ [LATIN SUBSCRIPT SMALL LETTER V]
				fallthrough
			case '\u1D8C': // ᶌ [LATIN SMALL LETTER V WITH PALATAL HOOK]
				fallthrough
			case '\u1E7D': // ṽ [LATIN SMALL LETTER V WITH TILDE]
				fallthrough
			case '\u1E7F': // ṿ [LATIN SMALL LETTER V WITH DOT BELOW]
				fallthrough
			case '\u24E5': // ⓥ [CIRCLED LATIN SMALL LETTER V]
				fallthrough
			case '\u2C71': // ⱱ [LATIN SMALL LETTER V WITH RIGHT HOOK]
				fallthrough
			case '\u2C74': // ⱴ [LATIN SMALL LETTER V WITH CURL]
				fallthrough
			case '\uA75F': // ꝟ [LATIN SMALL LETTER V WITH DIAGONAL STROKE]
				fallthrough
			case '\uFF56': // ｖ [FULLWIDTH LATIN SMALL LETTER V]
				output[outputPos] = 'v'
				outputPos++

			case '\uA760': // Ꝡ [LATIN CAPITAL LETTER VY]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'V'
				outputPos++
				output[outputPos] = 'Y'
				outputPos++

			case '\u24B1': // ⒱ [PARENTHESIZED LATIN SMALL LETTER V]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'v'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\uA761': // ꝡ [LATIN SMALL LETTER VY]
				output = output[:(len(output) + 1)]
				output[outputPos] = 'v'
				outputPos++
				output[outputPos] = 'y'
				outputPos++

			case '\u0174': // Ŵ [LATIN CAPITAL LETTER W WITH CIRCUMFLEX]
				fallthrough
			case '\u01F7': // Ƿ http://en.wikipedia.org/wiki/Wynn [LATIN CAPITAL LETTER WYNN]
				fallthrough
			case '\u1D21': // ᴡ [LATIN LETTER SMALL CAPITAL W]
				fallthrough
			case '\u1E80': // Ẁ [LATIN CAPITAL LETTER W WITH GRAVE]
				fallthrough
			case '\u1E82': // Ẃ [LATIN CAPITAL LETTER W WITH ACUTE]
				fallthrough
			case '\u1E84': // Ẅ [LATIN CAPITAL LETTER W WITH DIAERESIS]
				fallthrough
			case '\u1E86': // Ẇ [LATIN CAPITAL LETTER W WITH DOT ABOVE]
				fallthrough
			case '\u1E88': // Ẉ [LATIN CAPITAL LETTER W WITH DOT BELOW]
				fallthrough
			case '\u24CC': // Ⓦ [CIRCLED LATIN CAPITAL LETTER W]
				fallthrough
			case '\u2C72': // Ⱳ [LATIN CAPITAL LETTER W WITH HOOK]
				fallthrough
			case '\uFF37': // Ｗ [FULLWIDTH LATIN CAPITAL LETTER W]
				output[outputPos] = 'W'
				outputPos++

			case '\u0175': // ŵ [LATIN SMALL LETTER W WITH CIRCUMFLEX]
				fallthrough
			case '\u01BF': // ƿ http://en.wikipedia.org/wiki/Wynn [LATIN LETTER WYNN]
				fallthrough
			case '\u028D': // ʍ [LATIN SMALL LETTER TURNED W]
				fallthrough
			case '\u1E81': // ẁ [LATIN SMALL LETTER W WITH GRAVE]
				fallthrough
			case '\u1E83': // ẃ [LATIN SMALL LETTER W WITH ACUTE]
				fallthrough
			case '\u1E85': // ẅ [LATIN SMALL LETTER W WITH DIAERESIS]
				fallthrough
			case '\u1E87': // ẇ [LATIN SMALL LETTER W WITH DOT ABOVE]
				fallthrough
			case '\u1E89': // ẉ [LATIN SMALL LETTER W WITH DOT BELOW]
				fallthrough
			case '\u1E98': // ẘ [LATIN SMALL LETTER W WITH RING ABOVE]
				fallthrough
			case '\u24E6': // ⓦ [CIRCLED LATIN SMALL LETTER W]
				fallthrough
			case '\u2C73': // ⱳ [LATIN SMALL LETTER W WITH HOOK]
				fallthrough
			case '\uFF57': // ｗ [FULLWIDTH LATIN SMALL LETTER W]
				output[outputPos] = 'w'
				outputPos++

			case '\u24B2': // ⒲ [PARENTHESIZED LATIN SMALL LETTER W]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'w'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u1E8A': // Ẋ [LATIN CAPITAL LETTER X WITH DOT ABOVE]
				fallthrough
			case '\u1E8C': // Ẍ [LATIN CAPITAL LETTER X WITH DIAERESIS]
				fallthrough
			case '\u24CD': // Ⓧ [CIRCLED LATIN CAPITAL LETTER X]
				fallthrough
			case '\uFF38': // Ｘ [FULLWIDTH LATIN CAPITAL LETTER X]
				output[outputPos] = 'X'
				outputPos++

			case '\u1D8D': // ᶍ [LATIN SMALL LETTER X WITH PALATAL HOOK]
				fallthrough
			case '\u1E8B': // ẋ [LATIN SMALL LETTER X WITH DOT ABOVE]
				fallthrough
			case '\u1E8D': // ẍ [LATIN SMALL LETTER X WITH DIAERESIS]
				fallthrough
			case '\u2093': // ₓ [LATIN SUBSCRIPT SMALL LETTER X]
				fallthrough
			case '\u24E7': // ⓧ [CIRCLED LATIN SMALL LETTER X]
				fallthrough
			case '\uFF58': // ｘ [FULLWIDTH LATIN SMALL LETTER X]
				output[outputPos] = 'x'
				outputPos++

			case '\u24B3': // ⒳ [PARENTHESIZED LATIN SMALL LETTER X]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'x'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u00DD': // Ý [LATIN CAPITAL LETTER Y WITH ACUTE]
				fallthrough
			case '\u0176': // Ŷ [LATIN CAPITAL LETTER Y WITH CIRCUMFLEX]
				fallthrough
			case '\u0178': // Ÿ [LATIN CAPITAL LETTER Y WITH DIAERESIS]
				fallthrough
			case '\u01B3': // Ƴ [LATIN CAPITAL LETTER Y WITH HOOK]
				fallthrough
			case '\u0232': // Ȳ [LATIN CAPITAL LETTER Y WITH MACRON]
				fallthrough
			case '\u024E': // Ɏ [LATIN CAPITAL LETTER Y WITH STROKE]
				fallthrough
			case '\u028F': // ʏ [LATIN LETTER SMALL CAPITAL Y]
				fallthrough
			case '\u1E8E': // Ẏ [LATIN CAPITAL LETTER Y WITH DOT ABOVE]
				fallthrough
			case '\u1EF2': // Ỳ [LATIN CAPITAL LETTER Y WITH GRAVE]
				fallthrough
			case '\u1EF4': // Ỵ [LATIN CAPITAL LETTER Y WITH DOT BELOW]
				fallthrough
			case '\u1EF6': // Ỷ [LATIN CAPITAL LETTER Y WITH HOOK ABOVE]
				fallthrough
			case '\u1EF8': // Ỹ [LATIN CAPITAL LETTER Y WITH TILDE]
				fallthrough
			case '\u1EFE': // Ỿ [LATIN CAPITAL LETTER Y WITH LOOP]
				fallthrough
			case '\u24CE': // Ⓨ [CIRCLED LATIN CAPITAL LETTER Y]
				fallthrough
			case '\uFF39': // Ｙ [FULLWIDTH LATIN CAPITAL LETTER Y]
				output[outputPos] = 'Y'
				outputPos++

			case '\u00FD': // ý [LATIN SMALL LETTER Y WITH ACUTE]
				fallthrough
			case '\u00FF': // ÿ [LATIN SMALL LETTER Y WITH DIAERESIS]
				fallthrough
			case '\u0177': // ŷ [LATIN SMALL LETTER Y WITH CIRCUMFLEX]
				fallthrough
			case '\u01B4': // ƴ [LATIN SMALL LETTER Y WITH HOOK]
				fallthrough
			case '\u0233': // ȳ [LATIN SMALL LETTER Y WITH MACRON]
				fallthrough
			case '\u024F': // ɏ [LATIN SMALL LETTER Y WITH STROKE]
				fallthrough
			case '\u028E': // ʎ [LATIN SMALL LETTER TURNED Y]
				fallthrough
			case '\u1E8F': // ẏ [LATIN SMALL LETTER Y WITH DOT ABOVE]
				fallthrough
			case '\u1E99': // ẙ [LATIN SMALL LETTER Y WITH RING ABOVE]
				fallthrough
			case '\u1EF3': // ỳ [LATIN SMALL LETTER Y WITH GRAVE]
				fallthrough
			case '\u1EF5': // ỵ [LATIN SMALL LETTER Y WITH DOT BELOW]
				fallthrough
			case '\u1EF7': // ỷ [LATIN SMALL LETTER Y WITH HOOK ABOVE]
				fallthrough
			case '\u1EF9': // ỹ [LATIN SMALL LETTER Y WITH TILDE]
				fallthrough
			case '\u1EFF': // ỿ [LATIN SMALL LETTER Y WITH LOOP]
				fallthrough
			case '\u24E8': // ⓨ [CIRCLED LATIN SMALL LETTER Y]
				fallthrough
			case '\uFF59': // ｙ [FULLWIDTH LATIN SMALL LETTER Y]
				output[outputPos] = 'y'
				outputPos++

			case '\u24B4': // ⒴ [PARENTHESIZED LATIN SMALL LETTER Y]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'y'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u0179': // Ź [LATIN CAPITAL LETTER Z WITH ACUTE]
				fallthrough
			case '\u017B': // Ż [LATIN CAPITAL LETTER Z WITH DOT ABOVE]
				fallthrough
			case '\u017D': // Ž [LATIN CAPITAL LETTER Z WITH CARON]
				fallthrough
			case '\u01B5': // Ƶ [LATIN CAPITAL LETTER Z WITH STROKE]
				fallthrough
			case '\u021C': // Ȝ http://en.wikipedia.org/wiki/Yogh [LATIN CAPITAL LETTER YOGH]
				fallthrough
			case '\u0224': // Ȥ [LATIN CAPITAL LETTER Z WITH HOOK]
				fallthrough
			case '\u1D22': // ᴢ [LATIN LETTER SMALL CAPITAL Z]
				fallthrough
			case '\u1E90': // Ẑ [LATIN CAPITAL LETTER Z WITH CIRCUMFLEX]
				fallthrough
			case '\u1E92': // Ẓ [LATIN CAPITAL LETTER Z WITH DOT BELOW]
				fallthrough
			case '\u1E94': // Ẕ [LATIN CAPITAL LETTER Z WITH LINE BELOW]
				fallthrough
			case '\u24CF': // Ⓩ [CIRCLED LATIN CAPITAL LETTER Z]
				fallthrough
			case '\u2C6B': // Ⱬ [LATIN CAPITAL LETTER Z WITH DESCENDER]
				fallthrough
			case '\uA762': // Ꝣ [LATIN CAPITAL LETTER VISIGOTHIC Z]
				fallthrough
			case '\uFF3A': // Ｚ [FULLWIDTH LATIN CAPITAL LETTER Z]
				output[outputPos] = 'Z'
				outputPos++

			case '\u017A': // ź [LATIN SMALL LETTER Z WITH ACUTE]
				fallthrough
			case '\u017C': // ż [LATIN SMALL LETTER Z WITH DOT ABOVE]
				fallthrough
			case '\u017E': // ž [LATIN SMALL LETTER Z WITH CARON]
				fallthrough
			case '\u01B6': // ƶ [LATIN SMALL LETTER Z WITH STROKE]
				fallthrough
			case '\u021D': // ȝ http://en.wikipedia.org/wiki/Yogh [LATIN SMALL LETTER YOGH]
				fallthrough
			case '\u0225': // ȥ [LATIN SMALL LETTER Z WITH HOOK]
				fallthrough
			case '\u0240': // ɀ [LATIN SMALL LETTER Z WITH SWASH TAIL]
				fallthrough
			case '\u0290': // ʐ [LATIN SMALL LETTER Z WITH RETROFLEX HOOK]
				fallthrough
			case '\u0291': // ʑ [LATIN SMALL LETTER Z WITH CURL]
				fallthrough
			case '\u1D76': // ᵶ [LATIN SMALL LETTER Z WITH MIDDLE TILDE]
				fallthrough
			case '\u1D8E': // ᶎ [LATIN SMALL LETTER Z WITH PALATAL HOOK]
				fallthrough
			case '\u1E91': // ẑ [LATIN SMALL LETTER Z WITH CIRCUMFLEX]
				fallthrough
			case '\u1E93': // ẓ [LATIN SMALL LETTER Z WITH DOT BELOW]
				fallthrough
			case '\u1E95': // ẕ [LATIN SMALL LETTER Z WITH LINE BELOW]
				fallthrough
			case '\u24E9': // ⓩ [CIRCLED LATIN SMALL LETTER Z]
				fallthrough
			case '\u2C6C': // ⱬ [LATIN SMALL LETTER Z WITH DESCENDER]
				fallthrough
			case '\uA763': // ꝣ [LATIN SMALL LETTER VISIGOTHIC Z]
				fallthrough
			case '\uFF5A': // ｚ [FULLWIDTH LATIN SMALL LETTER Z]
				output[outputPos] = 'z'
				outputPos++

			case '\u24B5': // ⒵ [PARENTHESIZED LATIN SMALL LETTER Z]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = 'z'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2070': // ⁰ [SUPERSCRIPT ZERO]
				fallthrough
			case '\u2080': // ₀ [SUBSCRIPT ZERO]
				fallthrough
			case '\u24EA': // ⓪ [CIRCLED DIGIT ZERO]
				fallthrough
			case '\u24FF': // ⓿ [NEGATIVE CIRCLED DIGIT ZERO]
				fallthrough
			case '\uFF10': // ０ [FULLWIDTH DIGIT ZERO]
				output[outputPos] = '0'
				outputPos++

			case '\u00B9': // ¹ [SUPERSCRIPT ONE]
				fallthrough
			case '\u2081': // ₁ [SUBSCRIPT ONE]
				fallthrough
			case '\u2460': // ① [CIRCLED DIGIT ONE]
				fallthrough
			case '\u24F5': // ⓵ [DOUBLE CIRCLED DIGIT ONE]
				fallthrough
			case '\u2776': // ❶ [DINGBAT NEGATIVE CIRCLED DIGIT ONE]
				fallthrough
			case '\u2780': // ➀ [DINGBAT CIRCLED SANS-SERIF DIGIT ONE]
				fallthrough
			case '\u278A': // ➊ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT ONE]
				fallthrough
			case '\uFF11': // １ [FULLWIDTH DIGIT ONE]
				output[outputPos] = '1'
				outputPos++

			case '\u2488': // ⒈ [DIGIT ONE FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2474': // ⑴ [PARENTHESIZED DIGIT ONE]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u00B2': // ² [SUPERSCRIPT TWO]
				fallthrough
			case '\u2082': // ₂ [SUBSCRIPT TWO]
				fallthrough
			case '\u2461': // ② [CIRCLED DIGIT TWO]
				fallthrough
			case '\u24F6': // ⓶ [DOUBLE CIRCLED DIGIT TWO]
				fallthrough
			case '\u2777': // ❷ [DINGBAT NEGATIVE CIRCLED DIGIT TWO]
				fallthrough
			case '\u2781': // ➁ [DINGBAT CIRCLED SANS-SERIF DIGIT TWO]
				fallthrough
			case '\u278B': // ➋ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT TWO]
				fallthrough
			case '\uFF12': // ２ [FULLWIDTH DIGIT TWO]
				output[outputPos] = '2'
				outputPos++

			case '\u2489': // ⒉ [DIGIT TWO FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '2'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2475': // ⑵ [PARENTHESIZED DIGIT TWO]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '2'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u00B3': // ³ [SUPERSCRIPT THREE]
				fallthrough
			case '\u2083': // ₃ [SUBSCRIPT THREE]
				fallthrough
			case '\u2462': // ③ [CIRCLED DIGIT THREE]
				fallthrough
			case '\u24F7': // ⓷ [DOUBLE CIRCLED DIGIT THREE]
				fallthrough
			case '\u2778': // ❸ [DINGBAT NEGATIVE CIRCLED DIGIT THREE]
				fallthrough
			case '\u2782': // ➂ [DINGBAT CIRCLED SANS-SERIF DIGIT THREE]
				fallthrough
			case '\u278C': // ➌ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT THREE]
				fallthrough
			case '\uFF13': // ３ [FULLWIDTH DIGIT THREE]
				output[outputPos] = '3'
				outputPos++

			case '\u248A': // ⒊ [DIGIT THREE FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '3'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2476': // ⑶ [PARENTHESIZED DIGIT THREE]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '3'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2074': // ⁴ [SUPERSCRIPT FOUR]
				fallthrough
			case '\u2084': // ₄ [SUBSCRIPT FOUR]
				fallthrough
			case '\u2463': // ④ [CIRCLED DIGIT FOUR]
				fallthrough
			case '\u24F8': // ⓸ [DOUBLE CIRCLED DIGIT FOUR]
				fallthrough
			case '\u2779': // ❹ [DINGBAT NEGATIVE CIRCLED DIGIT FOUR]
				fallthrough
			case '\u2783': // ➃ [DINGBAT CIRCLED SANS-SERIF DIGIT FOUR]
				fallthrough
			case '\u278D': // ➍ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT FOUR]
				fallthrough
			case '\uFF14': // ４ [FULLWIDTH DIGIT FOUR]
				output[outputPos] = '4'
				outputPos++

			case '\u248B': // ⒋ [DIGIT FOUR FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '4'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2477': // ⑷ [PARENTHESIZED DIGIT FOUR]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '4'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2075': // ⁵ [SUPERSCRIPT FIVE]
				fallthrough
			case '\u2085': // ₅ [SUBSCRIPT FIVE]
				fallthrough
			case '\u2464': // ⑤ [CIRCLED DIGIT FIVE]
				fallthrough
			case '\u24F9': // ⓹ [DOUBLE CIRCLED DIGIT FIVE]
				fallthrough
			case '\u277A': // ❺ [DINGBAT NEGATIVE CIRCLED DIGIT FIVE]
				fallthrough
			case '\u2784': // ➄ [DINGBAT CIRCLED SANS-SERIF DIGIT FIVE]
				fallthrough
			case '\u278E': // ➎ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT FIVE]
				fallthrough
			case '\uFF15': // ５ [FULLWIDTH DIGIT FIVE]
				output[outputPos] = '5'
				outputPos++

			case '\u248C': // ⒌ [DIGIT FIVE FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '5'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2478': // ⑸ [PARENTHESIZED DIGIT FIVE]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '5'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2076': // ⁶ [SUPERSCRIPT SIX]
				fallthrough
			case '\u2086': // ₆ [SUBSCRIPT SIX]
				fallthrough
			case '\u2465': // ⑥ [CIRCLED DIGIT SIX]
				fallthrough
			case '\u24FA': // ⓺ [DOUBLE CIRCLED DIGIT SIX]
				fallthrough
			case '\u277B': // ❻ [DINGBAT NEGATIVE CIRCLED DIGIT SIX]
				fallthrough
			case '\u2785': // ➅ [DINGBAT CIRCLED SANS-SERIF DIGIT SIX]
				fallthrough
			case '\u278F': // ➏ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT SIX]
				fallthrough
			case '\uFF16': // ６ [FULLWIDTH DIGIT SIX]
				output[outputPos] = '6'
				outputPos++

			case '\u248D': // ⒍ [DIGIT SIX FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '6'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2479': // ⑹ [PARENTHESIZED DIGIT SIX]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '6'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2077': // ⁷ [SUPERSCRIPT SEVEN]
				fallthrough
			case '\u2087': // ₇ [SUBSCRIPT SEVEN]
				fallthrough
			case '\u2466': // ⑦ [CIRCLED DIGIT SEVEN]
				fallthrough
			case '\u24FB': // ⓻ [DOUBLE CIRCLED DIGIT SEVEN]
				fallthrough
			case '\u277C': // ❼ [DINGBAT NEGATIVE CIRCLED DIGIT SEVEN]
				fallthrough
			case '\u2786': // ➆ [DINGBAT CIRCLED SANS-SERIF DIGIT SEVEN]
				fallthrough
			case '\u2790': // ➐ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT SEVEN]
				fallthrough
			case '\uFF17': // ７ [FULLWIDTH DIGIT SEVEN]
				output[outputPos] = '7'
				outputPos++

			case '\u248E': // ⒎ [DIGIT SEVEN FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '7'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u247A': // ⑺ [PARENTHESIZED DIGIT SEVEN]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '7'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2078': // ⁸ [SUPERSCRIPT EIGHT]
				fallthrough
			case '\u2088': // ₈ [SUBSCRIPT EIGHT]
				fallthrough
			case '\u2467': // ⑧ [CIRCLED DIGIT EIGHT]
				fallthrough
			case '\u24FC': // ⓼ [DOUBLE CIRCLED DIGIT EIGHT]
				fallthrough
			case '\u277D': // ❽ [DINGBAT NEGATIVE CIRCLED DIGIT EIGHT]
				fallthrough
			case '\u2787': // ➇ [DINGBAT CIRCLED SANS-SERIF DIGIT EIGHT]
				fallthrough
			case '\u2791': // ➑ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT EIGHT]
				fallthrough
			case '\uFF18': // ８ [FULLWIDTH DIGIT EIGHT]
				output[outputPos] = '8'
				outputPos++

			case '\u248F': // ⒏ [DIGIT EIGHT FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '8'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u247B': // ⑻ [PARENTHESIZED DIGIT EIGHT]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '8'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2079': // ⁹ [SUPERSCRIPT NINE]
				fallthrough
			case '\u2089': // ₉ [SUBSCRIPT NINE]
				fallthrough
			case '\u2468': // ⑨ [CIRCLED DIGIT NINE]
				fallthrough
			case '\u24FD': // ⓽ [DOUBLE CIRCLED DIGIT NINE]
				fallthrough
			case '\u277E': // ❾ [DINGBAT NEGATIVE CIRCLED DIGIT NINE]
				fallthrough
			case '\u2788': // ➈ [DINGBAT CIRCLED SANS-SERIF DIGIT NINE]
				fallthrough
			case '\u2792': // ➒ [DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT NINE]
				fallthrough
			case '\uFF19': // ９ [FULLWIDTH DIGIT NINE]
				output[outputPos] = '9'
				outputPos++

			case '\u2490': // ⒐ [DIGIT NINE FULL STOP]
				output = output[:(len(output) + 1)]
				output[outputPos] = '9'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u247C': // ⑼ [PARENTHESIZED DIGIT NINE]
				output = output[:(len(output) + 2)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '9'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2469': // ⑩ [CIRCLED NUMBER TEN]
				fallthrough
			case '\u24FE': // ⓾ [DOUBLE CIRCLED NUMBER TEN]
				fallthrough
			case '\u277F': // ❿ [DINGBAT NEGATIVE CIRCLED NUMBER TEN]
				fallthrough
			case '\u2789': // ➉ [DINGBAT CIRCLED SANS-SERIF NUMBER TEN]
				fallthrough
			case '\u2793': // ➓ [DINGBAT NEGATIVE CIRCLED SANS-SERIF NUMBER TEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '0'
				outputPos++

			case '\u2491': // ⒑ [NUMBER TEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '0'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u247D': // ⑽ [PARENTHESIZED NUMBER TEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '0'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u246A': // ⑪ [CIRCLED NUMBER ELEVEN]
				fallthrough
			case '\u24EB': // ⓫ [NEGATIVE CIRCLED NUMBER ELEVEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '1'
				outputPos++

			case '\u2492': // ⒒ [NUMBER ELEVEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u247E': // ⑾ [PARENTHESIZED NUMBER ELEVEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u246B': // ⑫ [CIRCLED NUMBER TWELVE]
				fallthrough
			case '\u24EC': // ⓬ [NEGATIVE CIRCLED NUMBER TWELVE]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '2'
				outputPos++

			case '\u2493': // ⒓ [NUMBER TWELVE FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '2'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u247F': // ⑿ [PARENTHESIZED NUMBER TWELVE]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '2'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u246C': // ⑬ [CIRCLED NUMBER THIRTEEN]
				fallthrough
			case '\u24ED': // ⓭ [NEGATIVE CIRCLED NUMBER THIRTEEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '3'
				outputPos++

			case '\u2494': // ⒔ [NUMBER THIRTEEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '3'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2480': // ⒀ [PARENTHESIZED NUMBER THIRTEEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '3'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u246D': // ⑭ [CIRCLED NUMBER FOURTEEN]
				fallthrough
			case '\u24EE': // ⓮ [NEGATIVE CIRCLED NUMBER FOURTEEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '4'
				outputPos++

			case '\u2495': // ⒕ [NUMBER FOURTEEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '4'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2481': // ⒁ [PARENTHESIZED NUMBER FOURTEEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '4'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u246E': // ⑮ [CIRCLED NUMBER FIFTEEN]
				fallthrough
			case '\u24EF': // ⓯ [NEGATIVE CIRCLED NUMBER FIFTEEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '5'
				outputPos++

			case '\u2496': // ⒖ [NUMBER FIFTEEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '5'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2482': // ⒂ [PARENTHESIZED NUMBER FIFTEEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '5'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u246F': // ⑯ [CIRCLED NUMBER SIXTEEN]
				fallthrough
			case '\u24F0': // ⓰ [NEGATIVE CIRCLED NUMBER SIXTEEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '6'
				outputPos++

			case '\u2497': // ⒗ [NUMBER SIXTEEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '6'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2483': // ⒃ [PARENTHESIZED NUMBER SIXTEEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '6'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2470': // ⑰ [CIRCLED NUMBER SEVENTEEN]
				fallthrough
			case '\u24F1': // ⓱ [NEGATIVE CIRCLED NUMBER SEVENTEEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '7'
				outputPos++

			case '\u2498': // ⒘ [NUMBER SEVENTEEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '7'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2484': // ⒄ [PARENTHESIZED NUMBER SEVENTEEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '7'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2471': // ⑱ [CIRCLED NUMBER EIGHTEEN]
				fallthrough
			case '\u24F2': // ⓲ [NEGATIVE CIRCLED NUMBER EIGHTEEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '8'
				outputPos++

			case '\u2499': // ⒙ [NUMBER EIGHTEEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '8'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2485': // ⒅ [PARENTHESIZED NUMBER EIGHTEEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '8'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2472': // ⑲ [CIRCLED NUMBER NINETEEN]
				fallthrough
			case '\u24F3': // ⓳ [NEGATIVE CIRCLED NUMBER NINETEEN]
				output = output[:(len(output) + 1)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '9'
				outputPos++

			case '\u249A': // ⒚ [NUMBER NINETEEN FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '9'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2486': // ⒆ [PARENTHESIZED NUMBER NINETEEN]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '1'
				outputPos++
				output[outputPos] = '9'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u2473': // ⑳ [CIRCLED NUMBER TWENTY]
				fallthrough
			case '\u24F4': // ⓴ [NEGATIVE CIRCLED NUMBER TWENTY]
				output = output[:(len(output) + 1)]
				output[outputPos] = '2'
				outputPos++
				output[outputPos] = '0'
				outputPos++

			case '\u249B': // ⒛ [NUMBER TWENTY FULL STOP]
				output = output[:(len(output) + 2)]
				output[outputPos] = '2'
				outputPos++
				output[outputPos] = '0'
				outputPos++
				output[outputPos] = '.'
				outputPos++

			case '\u2487': // ⒇ [PARENTHESIZED NUMBER TWENTY]
				output = output[:(len(output) + 3)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '2'
				outputPos++
				output[outputPos] = '0'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u00AB': // « [LEFT-POINTING DOUBLE ANGLE QUOTATION MARK]
				fallthrough
			case '\u00BB': // » [RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK]
				fallthrough
			case '\u201C': // “ [LEFT DOUBLE QUOTATION MARK]
				fallthrough
			case '\u201D': // ” [RIGHT DOUBLE QUOTATION MARK]
				fallthrough
			case '\u201E': // „ [DOUBLE LOW-9 QUOTATION MARK]
				fallthrough
			case '\u2033': // ″ [DOUBLE PRIME]
				fallthrough
			case '\u2036': // ‶ [REVERSED DOUBLE PRIME]
				fallthrough
			case '\u275D': // ❝ [HEAVY DOUBLE TURNED COMMA QUOTATION MARK ORNAMENT]
				fallthrough
			case '\u275E': // ❞ [HEAVY DOUBLE COMMA QUOTATION MARK ORNAMENT]
				fallthrough
			case '\u276E': // ❮ [HEAVY LEFT-POINTING ANGLE QUOTATION MARK ORNAMENT]
				fallthrough
			case '\u276F': // ❯ [HEAVY RIGHT-POINTING ANGLE QUOTATION MARK ORNAMENT]
				fallthrough
			case '\uFF02': // ＂ [FULLWIDTH QUOTATION MARK]
				output[outputPos] = '"'
				outputPos++

			case '\u2018': // ‘ [LEFT SINGLE QUOTATION MARK]
				fallthrough
			case '\u2019': // ’ [RIGHT SINGLE QUOTATION MARK]
				fallthrough
			case '\u201A': // ‚ [SINGLE LOW-9 QUOTATION MARK]
				fallthrough
			case '\u201B': // ‛ [SINGLE HIGH-REVERSED-9 QUOTATION MARK]
				fallthrough
			case '\u2032': // ′ [PRIME]
				fallthrough
			case '\u2035': // ‵ [REVERSED PRIME]
				fallthrough
			case '\u2039': // ‹ [SINGLE LEFT-POINTING ANGLE QUOTATION MARK]
				fallthrough
			case '\u203A': // › [SINGLE RIGHT-POINTING ANGLE QUOTATION MARK]
				fallthrough
			case '\u275B': // ❛ [HEAVY SINGLE TURNED COMMA QUOTATION MARK ORNAMENT]
				fallthrough
			case '\u275C': // ❜ [HEAVY SINGLE COMMA QUOTATION MARK ORNAMENT]
				fallthrough
			case '\uFF07': // ＇ [FULLWIDTH APOSTROPHE]
				output[outputPos] = '\''
				outputPos++

			case '\u2010': // ‐ [HYPHEN]
				fallthrough
			case '\u2011': // ‑ [NON-BREAKING HYPHEN]
				fallthrough
			case '\u2012': // ‒ [FIGURE DASH]
				fallthrough
			case '\u2013': // – [EN DASH]
				fallthrough
			case '\u2014': // — [EM DASH]
				fallthrough
			case '\u207B': // ⁻ [SUPERSCRIPT MINUS]
				fallthrough
			case '\u208B': // ₋ [SUBSCRIPT MINUS]
				fallthrough
			case '\uFF0D': // － [FULLWIDTH HYPHEN-MINUS]
				output[outputPos] = '-'
				outputPos++

			case '\u2045': // ⁅ [LEFT SQUARE BRACKET WITH QUILL]
				fallthrough
			case '\u2772': // ❲ [LIGHT LEFT TORTOISE SHELL BRACKET ORNAMENT]
				fallthrough
			case '\uFF3B': // ［ [FULLWIDTH LEFT SQUARE BRACKET]
				output[outputPos] = '['
				outputPos++

			case '\u2046': // ⁆ [RIGHT SQUARE BRACKET WITH QUILL]
				fallthrough
			case '\u2773': // ❳ [LIGHT RIGHT TORTOISE SHELL BRACKET ORNAMENT]
				fallthrough
			case '\uFF3D': // ］ [FULLWIDTH RIGHT SQUARE BRACKET]
				output[outputPos] = ']'
				outputPos++

			case '\u207D': // ⁽ [SUPERSCRIPT LEFT PARENTHESIS]
				fallthrough
			case '\u208D': // ₍ [SUBSCRIPT LEFT PARENTHESIS]
				fallthrough
			case '\u2768': // ❨ [MEDIUM LEFT PARENTHESIS ORNAMENT]
				fallthrough
			case '\u276A': // ❪ [MEDIUM FLATTENED LEFT PARENTHESIS ORNAMENT]
				fallthrough
			case '\uFF08': // （ [FULLWIDTH LEFT PARENTHESIS]
				output[outputPos] = '('
				outputPos++

			case '\u2E28': // ⸨ [LEFT DOUBLE PARENTHESIS]
				output = output[:(len(output) + 1)]
				output[outputPos] = '('
				outputPos++
				output[outputPos] = '('
				outputPos++

			case '\u207E': // ⁾ [SUPERSCRIPT RIGHT PARENTHESIS]
				fallthrough
			case '\u208E': // ₎ [SUBSCRIPT RIGHT PARENTHESIS]
				fallthrough
			case '\u2769': // ❩ [MEDIUM RIGHT PARENTHESIS ORNAMENT]
				fallthrough
			case '\u276B': // ❫ [MEDIUM FLATTENED RIGHT PARENTHESIS ORNAMENT]
				fallthrough
			case '\uFF09': // ） [FULLWIDTH RIGHT PARENTHESIS]
				output[outputPos] = ')'
				outputPos++

			case '\u2E29': // ⸩ [RIGHT DOUBLE PARENTHESIS]
				output = output[:(len(output) + 1)]
				output[outputPos] = ')'
				outputPos++
				output[outputPos] = ')'
				outputPos++

			case '\u276C': // ❬ [MEDIUM LEFT-POINTING ANGLE BRACKET ORNAMENT]
				fallthrough
			case '\u2770': // ❰ [HEAVY LEFT-POINTING ANGLE BRACKET ORNAMENT]
				fallthrough
			case '\uFF1C': // ＜ [FULLWIDTH LESS-THAN SIGN]
				output[outputPos] = '<'
				outputPos++

			case '\u276D': // ❭ [MEDIUM RIGHT-POINTING ANGLE BRACKET ORNAMENT]
				fallthrough
			case '\u2771': // ❱ [HEAVY RIGHT-POINTING ANGLE BRACKET ORNAMENT]
				fallthrough
			case '\uFF1E': // ＞ [FULLWIDTH GREATER-THAN SIGN]
				output[outputPos] = '>'
				outputPos++

			case '\u2774': // ❴ [MEDIUM LEFT CURLY BRACKET ORNAMENT]
				fallthrough
			case '\uFF5B': // ｛ [FULLWIDTH LEFT CURLY BRACKET]
				output[outputPos] = '{'
				outputPos++

			case '\u2775': // ❵ [MEDIUM RIGHT CURLY BRACKET ORNAMENT]
				fallthrough
			case '\uFF5D': // ｝ [FULLWIDTH RIGHT CURLY BRACKET]
				output[outputPos] = '}'
				outputPos++

			case '\u207A': // ⁺ [SUPERSCRIPT PLUS SIGN]
				fallthrough
			case '\u208A': // ₊ [SUBSCRIPT PLUS SIGN]
				fallthrough
			case '\uFF0B': // ＋ [FULLWIDTH PLUS SIGN]
				output[outputPos] = '+'
				outputPos++

			case '\u207C': // ⁼ [SUPERSCRIPT EQUALS SIGN]
				fallthrough
			case '\u208C': // ₌ [SUBSCRIPT EQUALS SIGN]
				fallthrough
			case '\uFF1D': // ＝ [FULLWIDTH EQUALS SIGN]
				output[outputPos] = '='
				outputPos++

			case '\uFF01': // ！ [FULLWIDTH EXCLAMATION MARK]
				output[outputPos] = '!'
				outputPos++

			case '\u203C': // ‼ [DOUBLE EXCLAMATION MARK]
				output = output[:(len(output) + 1)]
				output[outputPos] = '!'
				outputPos++
				output[outputPos] = '!'
				outputPos++

			case '\u2049': // ⁉ [EXCLAMATION QUESTION MARK]
				output = output[:(len(output) + 1)]
				output[outputPos] = '!'
				outputPos++
				output[outputPos] = '?'
				outputPos++

			case '\uFF03': // ＃ [FULLWIDTH NUMBER SIGN]
				output[outputPos] = '#'
				outputPos++

			case '\uFF04': // ＄ [FULLWIDTH DOLLAR SIGN]
				output[outputPos] = '$'
				outputPos++

			case '\u2052': // ⁒ [COMMERCIAL MINUS SIGN]
				fallthrough
			case '\uFF05': // ％ [FULLWIDTH PERCENT SIGN]
				output[outputPos] = '%'
				outputPos++

			case '\uFF06': // ＆ [FULLWIDTH AMPERSAND]
				output[outputPos] = '&'
				outputPos++

			case '\u204E': // ⁎ [LOW ASTERISK]
				fallthrough
			case '\uFF0A': // ＊ [FULLWIDTH ASTERISK]
				output[outputPos] = '*'
				outputPos++

			case '\uFF0C': // ， [FULLWIDTH COMMA]
				output[outputPos] = ','
				outputPos++

			case '\uFF0E': // ． [FULLWIDTH FULL STOP]
				output[outputPos] = '.'
				outputPos++

			case '\u2044': // ⁄ [FRACTION SLASH]
				fallthrough
			case '\uFF0F': // ／ [FULLWIDTH SOLIDUS]
				output[outputPos] = '/'
				outputPos++

			case '\uFF1A': // ： [FULLWIDTH COLON]
				output[outputPos] = ':'
				outputPos++

			case '\u204F': // ⁏ [REVERSED SEMICOLON]
				fallthrough
			case '\uFF1B': // ； [FULLWIDTH SEMICOLON]
				output[outputPos] = ';'
				outputPos++

			case '\uFF1F': // ？ [FULLWIDTH QUESTION MARK]
				output[outputPos] = '?'
				outputPos++

			case '\u2047': // ⁇ [DOUBLE QUESTION MARK]
				output = output[:(len(output) + 1)]
				output[outputPos] = '?'
				outputPos++
				output[outputPos] = '?'
				outputPos++

			case '\u2048': // ⁈ [QUESTION EXCLAMATION MARK]
				output = output[:(len(output) + 1)]
				output[outputPos] = '?'
				outputPos++
				output[outputPos] = '!'
				outputPos++

			case '\uFF20': // ＠ [FULLWIDTH COMMERCIAL AT]
				output[outputPos] = '@'
				outputPos++

			case '\uFF3C': // ＼ [FULLWIDTH REVERSE SOLIDUS]
				output[outputPos] = '\\'
				outputPos++

			case '\u2038': // ‸ [CARET]
				fallthrough
			case '\uFF3E': // ＾ [FULLWIDTH CIRCUMFLEX ACCENT]
				output[outputPos] = '^'
				outputPos++

			case '\uFF3F': // ＿ [FULLWIDTH LOW LINE]
				output[outputPos] = '_'
				outputPos++

			case '\u2053': // ⁓ [SWUNG DASH]
				fallthrough
			case '\uFF5E': // ～ [FULLWIDTH TILDE]
				output[outputPos] = '~'
				outputPos++
				break

			default:
				output[outputPos] = c
				outputPos++
			}
		}
	}
	return output
}
