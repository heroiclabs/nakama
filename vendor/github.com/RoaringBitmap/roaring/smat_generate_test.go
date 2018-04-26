// +build gofuzz

package roaring

import (
	"fmt"
	"io/ioutil"
	"os"
	"testing"

	"github.com/mschoch/smat"
)

func TestGenerateSmatCorpus(t *testing.T) {
	for i, actionSeq := range smatActionSeqs {
		byteSequence, err := actionSeq.ByteEncoding(&smatContext{},
			smat.ActionID('S'), smat.ActionID('T'), smatActionMap)
		if err != nil {
			t.Fatalf("error from ByteEncoding, err: %v, i: %d, actonSeq: %#v",
				err, i, actionSeq)
		}
		os.MkdirAll("workdir/corpus", 0700)
		ioutil.WriteFile(fmt.Sprintf("workdir/corpus/%d", i), byteSequence, 0600)
	}
}

var smatActionSeqs = []smat.ActionSeq{
	{
		smat.ActionID('X'),
		smat.ActionID('X'),
		smat.ActionID('Y'),
		smat.ActionID('Y'),
		smat.ActionID('<'),
		smat.ActionID('<'),
		smat.ActionID('*'),
		smat.ActionID('x'),
		smat.ActionID('y'),
		smat.ActionID('*'),
		smat.ActionID('['),
		smat.ActionID('['),
		smat.ActionID('B'),
		smat.ActionID('a'),
		smat.ActionID('o'),
		smat.ActionID('A'),
		smat.ActionID('O'),
		smat.ActionID('#'),
		smat.ActionID('X'),
		smat.ActionID('Y'),
		smat.ActionID('B'),
		smat.ActionID('e'),
		smat.ActionID('f'),
		smat.ActionID('-'),
		smat.ActionID('e'),
	},
}
