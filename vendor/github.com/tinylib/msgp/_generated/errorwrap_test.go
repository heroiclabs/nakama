package _generated

import (
	"bytes"
	"io"
	"testing"

	"github.com/tinylib/msgp/msgp"
)

func fillErrorCtxAsMap() *ErrorCtxAsMap {
	v := &ErrorCtxAsMap{}
	v.Val = "foo"
	v.ComplexChild = &ErrorCtxMapChildNotInline{Val1: "a", Val2: "b", Val3: "c", Val4: "d", Val5: "e"}
	v.Child = &ErrorCtxMapChild{Val: "foo"}
	v.Children = []*ErrorCtxMapChild{{Val: "foo"}, {Val: "bar"}}
	v.Map = map[string]string{"foo": "bar", "baz": "qux"}
	v.Nest.Val = "foo"
	v.Nest.Child = &ErrorCtxMapChild{Val: "foo"}
	v.Nest.Children = []*ErrorCtxMapChild{{Val: "foo"}, {Val: "bar"}}
	v.Nest.Map = map[string]string{"foo": "bar", "baz": "qux"}
	v.Nest.Nest.Val = "foo"
	v.Nest.Nest.Child = &ErrorCtxMapChild{Val: "foo"}
	v.Nest.Nest.Children = []*ErrorCtxMapChild{{Val: "foo"}, {Val: "bar"}}
	v.Nest.Nest.Map = map[string]string{"foo": "bar", "baz": "qux"}
	return v
}

func fillErrorCtxAsTuple() *ErrorCtxAsTuple {
	v := &ErrorCtxAsTuple{}
	v.Val = "foo"
	v.ComplexChild = &ErrorCtxTupleChildNotInline{Val1: "a", Val2: "b", Val3: "c", Val4: "d", Val5: "e"}
	v.Child = &ErrorCtxTupleChild{Val: "foo"}
	v.Children = []*ErrorCtxTupleChild{{Val: "foo"}, {Val: "bar"}}
	v.Map = map[string]string{"foo": "bar", "baz": "qux"}
	v.Nest.Val = "foo"
	v.Nest.Child = &ErrorCtxTupleChild{Val: "foo"}
	v.Nest.Children = []*ErrorCtxTupleChild{{Val: "foo"}, {Val: "bar"}}
	v.Nest.Map = map[string]string{"foo": "bar", "baz": "qux"}
	v.Nest.Nest.Val = "foo"
	v.Nest.Nest.Child = &ErrorCtxTupleChild{Val: "foo"}
	v.Nest.Nest.Children = []*ErrorCtxTupleChild{{Val: "foo"}, {Val: "bar"}}
	v.Nest.Nest.Map = map[string]string{"foo": "bar", "baz": "qux"}
	return v
}

type dodgifierBuf struct {
	*bytes.Buffer
	dodgifyString int
	strIdx        int
}

func (o *dodgifierBuf) Write(b []byte) (n int, err error) {
	ilen := len(b)
	if msgp.NextType(b) == msgp.StrType {
		if o.strIdx == o.dodgifyString {
			// Fool msgp into thinking this value is a fixint. msgp will throw
			// a type error for this value.
			b[0] = 1
		}
		o.strIdx++
	}
	_, err = o.Buffer.Write(b)
	return ilen, err
}

type strCounter int

func (o *strCounter) Write(b []byte) (n int, err error) {
	if msgp.NextType(b) == msgp.StrType {
		*o++
	}
	return len(b), nil
}

func countStrings(bts []byte) int {
	r := msgp.NewReader(bytes.NewReader(bts))
	strCounter := strCounter(0)
	for {
		_, err := r.CopyNext(&strCounter)
		if err == io.EOF {
			break
		} else if err != nil {
			panic(err)
		}
	}
	return int(strCounter)
}

func marshalErrorCtx(m msgp.Marshaler) []byte {
	bts, err := m.MarshalMsg(nil)
	if err != nil {
		panic(err)
	}
	return bts
}

// dodgifyMsgpString will wreck the nth string in the msgpack blob
// so that it raises an error when decoded or unmarshaled.
func dodgifyMsgpString(bts []byte, idx int) []byte {
	r := msgp.NewReader(bytes.NewReader(bts))
	out := &dodgifierBuf{Buffer: &bytes.Buffer{}, dodgifyString: idx}
	for {
		_, err := r.CopyNext(out)
		if err == io.EOF {
			break
		} else if err != nil {
			panic(err)
		}
	}
	return out.Bytes()
}

func TestErrorCtxAsMapUnmarshal(t *testing.T) {
	bts := marshalErrorCtx(fillErrorCtxAsMap())
	cnt := countStrings(bts)

	var as []string
	for i := 0; i < cnt; i++ {
		dodgeBts := dodgifyMsgpString(bts, i)

		var ec ErrorCtxAsMap
		_, err := (&ec).UnmarshalMsg(dodgeBts)
		as = append(as, err.Error())
	}

	ok, a, b := diffstrs(as, expectedAsMap())
	if !ok {
		t.Fatal(a, b)
	}
}

func TestErrorCtxAsMapDecode(t *testing.T) {
	bts := marshalErrorCtx(fillErrorCtxAsMap())
	cnt := countStrings(bts)

	var as []string
	for i := 0; i < cnt; i++ {
		dodgeBts := dodgifyMsgpString(bts, i)

		r := msgp.NewReader(bytes.NewReader(dodgeBts))
		var ec ErrorCtxAsMap
		err := (&ec).DecodeMsg(r)
		as = append(as, err.Error())
	}

	ok, a, b := diffstrs(as, expectedAsMap())
	if !ok {
		t.Fatal(a, b)
	}
}

func TestErrorCtxAsTupleUnmarshal(t *testing.T) {
	bts := marshalErrorCtx(fillErrorCtxAsTuple())
	cnt := countStrings(bts)

	var as []string
	for i := 0; i < cnt; i++ {
		dodgeBts := dodgifyMsgpString(bts, i)

		var ec ErrorCtxAsTuple
		_, err := (&ec).UnmarshalMsg(dodgeBts)
		as = append(as, err.Error())
	}

	ok, a, b := diffstrs(as, expectedAsTuple())
	if !ok {
		t.Fatal(a, b)
	}
}

func TestErrorCtxAsTupleDecode(t *testing.T) {
	bts := marshalErrorCtx(fillErrorCtxAsTuple())
	cnt := countStrings(bts)

	var as []string
	for i := 0; i < cnt; i++ {
		dodgeBts := dodgifyMsgpString(bts, i)

		r := msgp.NewReader(bytes.NewReader(dodgeBts))
		var ec ErrorCtxAsTuple
		err := (&ec).DecodeMsg(r)
		as = append(as, err.Error())
	}

	ok, a, b := diffstrs(as, expectedAsTuple())
	if !ok {
		t.Fatal(a, b)
	}
}

func diffstrs(a, b []string) (ok bool, as, bs []string) {
	ma := map[string]bool{}
	mb := map[string]bool{}
	for _, x := range a {
		ma[x] = true
	}
	for _, x := range b {
		mb[x] = true
	}
	for _, x := range a {
		if !mb[x] {
			as = append(as, x)
		}
	}
	for _, x := range b {
		if !ma[x] {
			bs = append(bs, x)
		}
	}
	return len(as)+len(bs) == 0, as, bs
}

var errPrefix = `msgp: attempted to decode type "int" with method for "str"`

func expectedAsTuple() []string {
	var out []string
	for _, s := range []string{
		`Val`,
		`Child/Val`,
		`Children/0/Val`,
		`Children/1/Val`,
		`ComplexChild/Val1`,
		`ComplexChild/Val2`,
		`ComplexChild/Val3`,
		`ComplexChild/Val4`,
		`ComplexChild/Val5`,
		`Map`,
		`Map/baz`,
		`Map`,
		`Map/foo`,
		`Nest`,
		`Nest/Val`,
		`Nest`,
		`Nest/Child/Val`,
		`Nest`,
		`Nest/Children/0/Val`,
		`Nest/Children/1/Val`,
		`Nest`,
		`Nest/Map`,
		`Nest/Map/foo`,
		`Nest/Map`,
		`Nest/Map/baz`,
		`Nest`,
		`Nest/Nest`,
		`Nest/Nest/Val`,
		`Nest/Nest`,
		`Nest/Nest/Child/Val`,
		`Nest/Nest`,
		`Nest/Nest/Children/0/Val`,
		`Nest/Nest/Children/1/Val`,
		`Nest/Nest`,
		`Nest/Nest/Map`,
		`Nest/Nest/Map/foo`,
		`Nest/Nest/Map`,
		`Nest/Nest/Map/baz`,
	} {
		if s == "" {
			out = append(out, errPrefix)
		} else {
			out = append(out, errPrefix+" at "+s)
		}
	}
	return out
}

// there are a lot of extra errors in here at the struct level because we are
// not discriminating between dodgy struct field map key strings and
// values. dodgy struct field map keys have no field context available when
// they are read.
func expectedAsMap() []string {
	var out []string
	for _, s := range []string{
		``,
		`Val`,
		``,
		`Child`,
		`Child/Val`,
		``,
		`Children/0`,
		`Children/0/Val`,
		`Children/1`,
		`Children/1/Val`,
		`ComplexChild`,
		`ComplexChild/Val1`,
		`ComplexChild`,
		`ComplexChild/Val2`,
		`ComplexChild`,
		`ComplexChild/Val3`,
		`ComplexChild`,
		`ComplexChild/Val4`,
		`ComplexChild`,
		`ComplexChild/Val5`,
		`Map`,
		`Map/foo`,
		`Map`,
		`Map/baz`,
		``,
		`Nest`,
		`Nest/Val`,
		`Nest`,
		`Nest/Child`,
		`Nest/Child/Val`,
		`Nest`,
		`Nest/Children/0`,
		`Nest/Children/0/Val`,
		`Nest/Children/1`,
		`Nest/Children/1/Val`,
		`Nest`,
		`Nest/Map`,
		`Nest/Map/foo`,
		`Nest/Map`,
		`Nest/Map/baz`,
		`Nest`,
		`Nest/Nest`,
		`Nest/Nest/Val`,
		`Nest/Nest`,
		`Nest/Nest/Child`,
		`Nest/Nest/Child/Val`,
		`Nest/Nest`,
		`Nest/Nest/Children/0`,
		`Nest/Nest/Children/0/Val`,
		`Nest/Nest/Children/1`,
		`Nest/Nest/Children/1/Val`,
		`Nest/Nest`,
		`Nest/Nest/Map`,
		`Nest/Nest/Map/baz`,
		`Nest/Nest/Map`,
		`Nest/Nest/Map/foo`,
	} {
		if s == "" {
			out = append(out, errPrefix)
		} else {
			out = append(out, errPrefix+" at "+s)
		}
	}
	return out
}
