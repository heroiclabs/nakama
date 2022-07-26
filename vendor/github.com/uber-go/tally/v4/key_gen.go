// Copyright (c) 2021 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

package tally

const (
	prefixSplitter  = '+'
	keyPairSplitter = ','
	keyNameSplitter = '='
	nilString       = ""
)

// KeyForStringMap generates a unique key for a map string set combination.
func KeyForStringMap(
	stringMap map[string]string,
) string {
	return KeyForPrefixedStringMap(nilString, stringMap)
}

// KeyForPrefixedStringMap generates a unique key for a
// a prefix and a map string set combination.
func KeyForPrefixedStringMap(
	prefix string,
	stringMap map[string]string,
) string {
	return keyForPrefixedStringMaps(prefix, stringMap)
}
// keyForPrefixedStringMapsAsKey writes a key using the prefix and the tags in a canonical form to
// the given input byte slice and returns a reference to the byte slice. Callers of this method can
// use a stack allocated byte slice to remove heap allocation.
func keyForPrefixedStringMapsAsKey(buf []byte, prefix string, maps ...map[string]string) []byte {
	// stack allocated
	keys := make([]string, 0, 32)
	for _, m := range maps {
		for k := range m {
			keys = append(keys, k)
		}
	}

	insertionSort(keys)

	if prefix != nilString {
		buf = append(buf, prefix...)
		buf = append(buf, prefixSplitter)
	}

	var lastKey string // last key written to the buffer
	for _, k := range keys {
		if len(lastKey) > 0 {
			if k == lastKey {
				// Already wrote this key.
				continue
			}
			buf = append(buf, keyPairSplitter)
		}
		lastKey = k

		buf = append(buf, k...)
		buf = append(buf, keyNameSplitter)

		// Find and write the value for this key. Rightmost map takes
		// precedence.
		for j := len(maps) - 1; j >= 0; j-- {
			if v, ok := maps[j][k]; ok {
				buf = append(buf, v...)
				break
			}
		}
	}

	return buf
}

// keyForPrefixedStringMaps generates a unique key for a prefix and a series
// of maps containing tags.
//
// If a key occurs in multiple maps, keys on the right take precedence.
func keyForPrefixedStringMaps(prefix string, maps ...map[string]string) string {
	return string(keyForPrefixedStringMapsAsKey(make([]byte, 0, 256), prefix, maps...))
}

func insertionSort(keys []string) {
	n := len(keys)
	for i := 1; i < n; i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
}
