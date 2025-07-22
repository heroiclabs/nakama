//  Copyright (c) 2020 Couchbase, Inc.
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

package querystr

import (
	"bufio"
	"io"
	"log"
	"strings"
	"unicode"
)

const reservedChars = "+-=&|><!(){}[]^\"~*?:\\/ "

func unescape(escaped string) string {
	// see if this character can be escaped
	if strings.ContainsAny(escaped, reservedChars) {
		return escaped
	}
	// otherwise return it with the \ intact
	return "\\" + escaped
}

type queryStringLex struct {
	in            *bufio.Reader
	buf           string
	currState     lexState
	currConsumed  bool
	inEscape      bool
	nextToken     *yySymType
	nextTokenType int
	seenDot       bool
	nextRune      rune
	nextRuneSize  int
	atEOF         bool
	debugLexer    bool
	logger        *log.Logger
}

func (l *queryStringLex) reset() {
	l.buf = ""
	l.inEscape = false
	l.seenDot = false
}

func (l *queryStringLex) Error(msg string) {
	panic(msg)
}

func (l *queryStringLex) Lex(lval *yySymType) int {
	var err error

	for l.nextToken == nil {
		if l.currConsumed {
			l.nextRune, l.nextRuneSize, err = l.in.ReadRune()
			if err != nil && err == io.EOF {
				l.nextRune = 0
				l.atEOF = true
			} else if err != nil {
				return 0
			}
		}
		l.currState, l.currConsumed = l.currState(l, l.nextRune, l.atEOF)
		if l.currState == nil {
			return 0
		}
	}

	*lval = *l.nextToken
	rv := l.nextTokenType
	l.nextToken = nil
	l.nextTokenType = 0
	return rv
}

func newQueryStringLex(in io.Reader, options QueryStringOptions) *queryStringLex {
	return &queryStringLex{
		in:           bufio.NewReader(in),
		currState:    startState,
		currConsumed: true,
		debugLexer:   options.debugLexer,
		logger:       options.logger,
	}
}

type lexState func(l *queryStringLex, next rune, eof bool) (lexState, bool)

func startState(l *queryStringLex, next rune, eof bool) (lexState, bool) {
	if eof {
		return nil, false
	}

	// handle inside escape case up front
	if l.inEscape {
		l.inEscape = false
		l.buf += unescape(string(next))
		return inStrState, true
	}

	switch next {
	case '"':
		return inPhraseState, true
	case '+', '-', ':', '>', '<', '=':
		l.buf += string(next)
		return singleCharOpState, true
	case '^':
		return inBoostState, true
	case '~':
		return inTildeState, true
	}

	switch {
	case !l.inEscape && next == '\\':
		l.inEscape = true
		return startState, true
	case unicode.IsDigit(next):
		l.buf += string(next)
		return inNumOrStrState, true
	case !unicode.IsSpace(next):
		l.buf += string(next)
		return inStrState, true
	}

	// doesn't look like anything, just eat it and stay here
	l.reset()
	return startState, true
}

func inPhraseState(l *queryStringLex, next rune, eof bool) (lexState, bool) {
	// unterminated phrase eats the phrase
	if eof {
		l.Error("unterminated quote")
		return nil, false
	}

	// only a non-escaped " ends the phrase
	if !l.inEscape && next == '"' {
		// end phrase
		l.nextTokenType = tPHRASE
		l.nextToken = &yySymType{
			s: l.buf,
		}
		l.logDebugTokensf("PHRASE - '%s'", l.nextToken.s)
		l.reset()
		return startState, true
	} else if !l.inEscape && next == '\\' {
		l.inEscape = true
	} else if l.inEscape {
		// if in escape, end it
		l.inEscape = false
		l.buf += unescape(string(next))
	} else {
		l.buf += string(next)
	}

	return inPhraseState, true
}

func singleCharOpState(l *queryStringLex, next rune, eof bool) (lexState, bool) {
	l.nextToken = &yySymType{}

	switch l.buf {
	case "+":
		l.nextTokenType = tPLUS
		l.logDebugTokensf("PLUS")
	case "-":
		l.nextTokenType = tMINUS
		l.logDebugTokensf("MINUS")
	case ":":
		l.nextTokenType = tCOLON
		l.logDebugTokensf("COLON")
	case ">":
		l.nextTokenType = tGREATER
		l.logDebugTokensf("GREATER")
	case "<":
		l.nextTokenType = tLESS
		l.logDebugTokensf("LESS")
	case "=":
		l.nextTokenType = tEQUAL
		l.logDebugTokensf("EQUAL")
	}

	l.reset()
	return startState, false
}

func inBoostState(l *queryStringLex, next rune, eof bool) (lexState, bool) {
	return inBoostOrTildeState(l, next, eof, tBOOST, "BOOST", inBoostState)
}

func inTildeState(l *queryStringLex, next rune, eof bool) (lexState, bool) {
	return inBoostOrTildeState(l, next, eof, tTILDE, "TILDE", inTildeState)
}

func inBoostOrTildeState(l *queryStringLex, next rune, eof bool, nextTokenType int, name string,
	inState lexState) (lexState, bool) {

	// only a non-escaped space ends the boost (or eof)
	if eof || (!l.inEscape && next == ' ') {
		// end boost or tilde
		l.nextTokenType = nextTokenType
		if l.buf == "" {
			l.buf = "1"
		}
		l.nextToken = &yySymType{
			s: l.buf,
		}
		l.logDebugTokensf("%s - '%s'", name, l.nextToken.s)
		l.reset()
		return startState, true
	} else if !l.inEscape && next == '\\' {
		l.inEscape = true
	} else if l.inEscape {
		// if in escape, end it
		l.inEscape = false
		l.buf += unescape(string(next))
	} else {
		l.buf += string(next)
	}

	return inState, true
}

func inNumOrStrState(l *queryStringLex, next rune, eof bool) (lexState, bool) {
	// end on non-escaped space, colon, tilde, boost (or eof)
	if eof || (!l.inEscape && (next == ' ' || next == ':' || next == '^' || next == '~')) {
		// end number
		l.nextTokenType = tNUMBER
		l.nextToken = &yySymType{
			s: l.buf,
		}
		l.logDebugTokensf("NUMBER - '%s'", l.nextToken.s)
		l.reset()

		consumed := true
		if !eof && (next == ':' || next == '^' || next == '~') {
			consumed = false
		}

		return startState, consumed
	} else if !l.inEscape && next == '\\' {
		l.inEscape = true
		return inNumOrStrState, true
	} else if l.inEscape {
		// if in escape, end it
		l.inEscape = false
		l.buf += unescape(string(next))
		// go directly to string, no successfully or unsuccessfully
		// escaped string results in a valid number
		return inStrState, true
	}

	// see where to go
	if !l.seenDot && next == '.' {
		// stay in this state
		l.seenDot = true
		l.buf += string(next)
		return inNumOrStrState, true
	} else if unicode.IsDigit(next) {
		l.buf += string(next)
		return inNumOrStrState, true
	}

	// doesn't look like an number, transition
	l.buf += string(next)
	return inStrState, true
}

func inStrState(l *queryStringLex, next rune, eof bool) (lexState, bool) {
	// end on non-escaped space, colon, tilde, boost (or eof)
	if eof || (!l.inEscape && (next == ' ' || next == ':' || next == '^' || next == '~')) {
		// end string
		l.nextTokenType = tSTRING
		l.nextToken = &yySymType{
			s: l.buf,
		}
		l.logDebugTokensf("STRING - '%s'", l.nextToken.s)
		l.reset()

		consumed := true
		if !eof && (next == ':' || next == '^' || next == '~') {
			consumed = false
		}

		return startState, consumed
	} else if !l.inEscape && next == '\\' {
		l.inEscape = true
	} else if l.inEscape {
		// if in escape, end it
		l.inEscape = false
		l.buf += unescape(string(next))
	} else {
		l.buf += string(next)
	}

	return inStrState, true
}

func (l *queryStringLex) logDebugTokensf(format string, v ...interface{}) {
	if l.debugLexer {
		l.logger.Printf(format, v...)
	}
}
