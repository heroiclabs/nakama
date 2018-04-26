package unsnap

// copyright (c) 2013-2016, Jason E. Aten.
// License: MIT.

import (
	"bytes"
	"math/rand"
	"testing"

	cv "github.com/glycerine/goconvey/convey"
)

func TestNewReaderNewWriterAndIllustrateBasicUse(t *testing.T) {

	cv.Convey("NewReader and NewWrite basic example", t, func() {
		rand.Seed(29)
		data := make([]byte, 2048)
		rand.Read(data)

		var buf bytes.Buffer
		w := NewWriter(&buf)

		// compress
		_, err := w.Write(data)
		if err != nil {
			panic(err)
		}
		w.Close()

		// uncompress
		r := NewReader(&buf)
		data2 := make([]byte, len(data))
		_, err = r.Read(data2)
		if err != nil {
			panic(err)
		}

		cv.So(data2, cv.ShouldResemble, data)

	})
}
