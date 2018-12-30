package msgp

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestWrapVanillaErrorWithNoAdditionalContext(t *testing.T) {
	err := errors.New("test")
	w := WrapError(err)
	if w == err {
		t.Fatal()
	}
	if w.Error() != err.Error() {
		t.Fatal()
	}
	if w.(errWrapped).Resumable() {
		t.Fatal()
	}
}

func TestWrapVanillaErrorWithAdditionalContext(t *testing.T) {
	err := errors.New("test")
	w := WrapError(err, "foo", "bar")
	if w == err {
		t.Fatal()
	}
	if w.Error() == err.Error() {
		t.Fatal()
	}
	if w.(Error).Resumable() {
		t.Fatal()
	}
	if !strings.HasPrefix(w.Error(), err.Error()) {
		t.Fatal()
	}
	rest := w.Error()[len(err.Error()):]
	if rest != " at foo/bar" {
		t.Fatal()
	}
}

func TestWrapResumableError(t *testing.T) {
	err := ArrayError{}
	w := WrapError(err)
	if !w.(Error).Resumable() {
		t.Fatal()
	}
}

func TestWrapMultiple(t *testing.T) {
	err := &TypeError{}
	w := WrapError(WrapError(err, "b"), "a")
	expected := `msgp: attempted to decode type "<invalid>" with method for "<invalid>" at a/b`
	if expected != w.Error() {
		t.Fatal()
	}
}

func TestCause(t *testing.T) {
	for idx, err := range []error{
		errors.New("test"),
		ArrayError{},
		&ErrUnsupportedType{},
	} {
		t.Run(fmt.Sprintf("%d", idx), func(t *testing.T) {
			cerr := WrapError(err, "test")
			if cerr == err {
				t.Fatal()
			}
			if Cause(err) != err {
				t.Fatal()
			}
		})
	}
}

func TestCauseShortByte(t *testing.T) {
	err := ErrShortBytes
	cerr := WrapError(err, "test")
	if cerr != err {
		t.Fatal()
	}
	if Cause(err) != err {
		t.Fatal()
	}
}
