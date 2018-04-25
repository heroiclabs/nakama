package main

import (
	"fmt"
	"io"
	"os"

	unsnap "github.com/glycerine/go-unsnap-stream"
)

func main() {

	if len(os.Args) > 1 && os.Args[1] == "--help" {
		fmt.Fprintf(os.Stderr, "unsnap: decode from stdin the snappy-framing-format[1][2] that wraps snappy[3] compressed chunks of data. Writes to stdout.\n   [1]https://github.com/glycerine/go-unsnap-stream\n   [2]http://code.google.com/p/snappy/source/browse/trunk/framing_format.txt\n   [3]http://code.google.com/p/snappy\n")
		os.Exit(1)
	}

	snap := &unsnap.SnappyFile{
		Fname:   "stdin",
		Reader:  os.Stdin,
		EncBuf:  *unsnap.NewFixedSizeRingBuf(unsnap.CHUNK_MAX * 2), // buffer of snappy encoded bytes
		DecBuf:  *unsnap.NewFixedSizeRingBuf(unsnap.CHUNK_MAX * 2), // buffer of snapppy decoded bytes
		Writing: false,
	}
	defer snap.Close()

	_, err := io.Copy(os.Stdout, snap)
	if err != nil {
		panic(err)
	}
}
