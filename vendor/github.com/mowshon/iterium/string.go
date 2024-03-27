package iterium

// concatMultipleSlices merge more than two slices at once.
func concatMultipleSlices[T any](slices ...[]T) (result []T) {
	for _, s := range slices {
		result = append(result, s...)
	}

	return result
}

// AsciiLowercase represents lower case letters.
var AsciiLowercase = []string{
	"a", "b", "c", "d", "e", "f", "g",
	"h", "i", "j", "k", "l", "m", "n",
	"o", "p", "q", "r", "s", "t", "u",
	"v", "w", "x", "y", "z",
}

// AsciiUppercase represents upper case letters.
var AsciiUppercase = []string{
	"A", "B", "C", "D", "E", "F", "G",
	"H", "I", "J", "K", "L", "M", "N",
	"O", "P", "Q", "R", "S", "T", "U",
	"V", "W", "X", "Y", "Z",
}

// AsciiLetters is a concatenation of AsciiLowercase and AsciiUppercase.
var AsciiLetters = append(AsciiLowercase, AsciiUppercase...)

// Digits is a slice of the digits in the string type.
var Digits = []string{
	"0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
}

// HexDigits represents hexadecimal letters.
var HexDigits = []string{
	"0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
	"a", "b", "c", "d", "e", "f", "A", "B", "C", "D",
	"E", "F",
}

// OctDigits represents octadecimal letters.
var OctDigits = []string{
	"0", "1", "2", "3", "4", "5", "6", "7",
}

// Punctuation is a slice of ASCII characters that
// are considered punctuation marks in the C locale
var Punctuation = []string{
	"!", "\"", "#", "$", "%", "&", "'", "(",
	")", "*", "+", ",", "-", ".", "/", ":",
	";", "<", "=", ">", "?", "@", "[", "\\",
	"]", "^", "_", "`", "{", "|", "}", "~",
}

// Whitespace contains all ASCII characters that are considered whitespace
var Whitespace = []string{
	" ", "\t", "\n", "\r", "\x0b", "\x0c",
}

// Printable is a slice of ASCII characters which are considered printable.
var Printable = concatMultipleSlices(
	AsciiLetters, Digits, Punctuation, Whitespace,
)
