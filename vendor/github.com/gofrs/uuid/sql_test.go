// Copyright (C) 2013-2018 by Maxim Bublis <b@codemonkey.ru>
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

package uuid

import "testing"

func TestSQL(t *testing.T) {
	t.Run("Value", testSQLValue)
	t.Run("Scan", func(t *testing.T) {
		t.Run("Binary", testSQLScanBinary)
		t.Run("String", testSQLScanString)
		t.Run("Text", testSQLScanText)
		t.Run("Unsupported", testSQLScanUnsupported)
		t.Run("Nil", testSQLScanNil)
	})
}

func testSQLValue(t *testing.T) {
	v, err := codecTestUUID.Value()
	if err != nil {
		t.Fatal(err)
	}
	got, ok := v.(string)
	if !ok {
		t.Fatalf("Value() returned %T, want string", v)
	}
	if want := codecTestUUID.String(); got != want {
		t.Errorf("Value() == %q, want %q", got, want)
	}
}

func testSQLScanBinary(t *testing.T) {
	got := UUID{}
	err := got.Scan(codecTestData)
	if err != nil {
		t.Fatal(err)
	}
	if got != codecTestUUID {
		t.Errorf("Scan(%x): got %v, want %v", codecTestData, got, codecTestUUID)
	}
}

func testSQLScanString(t *testing.T) {
	s := "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
	got := UUID{}
	err := got.Scan(s)
	if err != nil {
		t.Fatal(err)
	}
	if got != codecTestUUID {
		t.Errorf("Scan(%q): got %v, want %v", s, got, codecTestUUID)
	}
}

func testSQLScanText(t *testing.T) {
	text := []byte("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
	got := UUID{}
	err := got.Scan(text)
	if err != nil {
		t.Fatal(err)
	}
	if got != codecTestUUID {
		t.Errorf("Scan(%q): got %v, want %v", text, got, codecTestUUID)
	}
}

func testSQLScanUnsupported(t *testing.T) {
	unsupported := []interface{}{
		true,
		42,
	}
	for _, v := range unsupported {
		got := UUID{}
		err := got.Scan(v)
		if err == nil {
			t.Errorf("Scan(%T) succeeded, got %v", v, got)
		}
	}
}

func testSQLScanNil(t *testing.T) {
	got := UUID{}
	err := got.Scan(nil)
	if err == nil {
		t.Errorf("Scan(nil) succeeded, got %v", got)
	}
}

func TestNullUUID(t *testing.T) {
	t.Run("NilValue", func(t *testing.T) {
		nu := NullUUID{}
		got, err := nu.Value()
		if got != nil {
			t.Errorf("null NullUUID.Value returned non-nil driver.Value")
		}
		if err != nil {
			t.Errorf("null NullUUID.Value returned non-nil error")
		}
	})
	t.Run("ValidValue", func(t *testing.T) {
		nu := NullUUID{
			Valid: true,
			UUID:  codecTestUUID,
		}
		got, err := nu.Value()
		if err != nil {
			t.Fatal(err)
		}
		s, ok := got.(string)
		if !ok {
			t.Errorf("Value() returned %T, want string", got)
		}
		want := "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
		if s != want {
			t.Errorf("%v.Value() == %s, want %s", nu, s, want)
		}
	})
	t.Run("ScanValid", func(t *testing.T) {
		s := "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
		u := NullUUID{}
		err := u.Scan(s)
		if err != nil {
			t.Fatal(err)
		}
		if !u.Valid {
			t.Errorf("Valid == false after Scan(%q)", s)
		}
		if u.UUID != codecTestUUID {
			t.Errorf("UUID == %v after Scan(%q), want %v", u.UUID, s, codecTestUUID)
		}
	})
	t.Run("ScanNil", func(t *testing.T) {
		u := NullUUID{}
		err := u.Scan(nil)
		if err != nil {
			t.Fatal(err)
		}
		if u.Valid {
			t.Error("NullUUID is valid after Scan(nil)")
		}
		if u.UUID != Nil {
			t.Errorf("NullUUID.UUID is %v after Scan(nil) want Nil", u.UUID)
		}
	})
}
