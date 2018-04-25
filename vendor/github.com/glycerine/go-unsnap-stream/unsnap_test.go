package unsnap

// copyright (c) 2013-2014, Jason E. Aten.
// License: MIT.

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"testing"

	cv "github.com/glycerine/goconvey/convey"
)

func TestSnappyFileUncompressedChunk(t *testing.T) {
	orig := "unenc.txt"
	compressed := "unenc.txt.snappy"
	myUncomp := "testout.unsnap"

	cv.Convey("SnappyFile should read snappy compressed with uncompressed chunk file.", t, func() {
		f, err := Open(compressed)

		out, err := os.Create(myUncomp)
		if err != nil {
			panic(err)
		}

		io.Copy(out, f)
		out.Close()
		f.Close()

		cs := []string{orig, myUncomp}
		cmd := exec.Command("/usr/bin/diff", cs...)
		bs, err := cmd.Output()
		if err != nil {
			fmt.Printf("\nproblem attempting: diff %s %s\n", cs[0], cs[1])
			fmt.Printf("output: %v\n", string(bs))
			panic(err)
		}
		cv.So(len(bs), cv.ShouldEqual, 0)

	})
}

func TestSnappyFileCompressed(t *testing.T) {
	orig := "binary.dat"
	compressed := "binary.dat.snappy"
	myUncomp := "testout2.unsnap"

	cv.Convey("SnappyFile should read snappy compressed with compressed chunk file.", t, func() {
		f, err := Open(compressed)

		out, err := os.Create(myUncomp)
		if err != nil {
			panic(err)
		}

		io.Copy(out, f)
		out.Close()
		f.Close()

		cs := []string{orig, myUncomp}
		cmd := exec.Command("/usr/bin/diff", cs...)
		bs, err := cmd.Output()
		if err != nil {
			fmt.Printf("\nproblem attempting: diff %s %s\n", cs[0], cs[1])
			fmt.Printf("output: %v\n", string(bs))
			panic(err)
		}
		cv.So(len(bs), cv.ShouldEqual, 0)

	})
}

func TestSnappyOnBinaryHardToCompress(t *testing.T) {

	// now we check our Write() method, in snap.go

	orig := "binary.dat"
	myCompressed := "testout_binary.dat.snappy"
	knownGoodCompressed := "binary.dat.snappy"

	cv.Convey("SnappyFile should write snappy compressed in streaming format, when fed lots of compressing stuff.", t, func() {

		f, err := os.Open(orig)
		if err != nil {
			panic(err)
		}

		out, err := Create(myCompressed)
		if err != nil {
			panic(err)
		}

		io.Copy(out, f)
		out.Close()
		f.Close()

		cs := []string{knownGoodCompressed, myCompressed}
		cmd := exec.Command("/usr/bin/diff", cs...)
		bs, err := cmd.Output()
		if err != nil {
			fmt.Printf("\nproblem attempting: diff %s %s\n", cs[0], cs[1])
			fmt.Printf("output: %v\n", string(bs))
			panic(err)
		}
		cv.So(len(bs), cv.ShouldEqual, 0)

	})
}
