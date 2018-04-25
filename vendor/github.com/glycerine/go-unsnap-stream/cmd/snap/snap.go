package main

import (
	"fmt"
	"io"
	"os"

	unsnap "github.com/glycerine/go-unsnap-stream"
)

func main() {

	if len(os.Args) > 1 && os.Args[1] == "--help" {
		fmt.Fprintf(os.Stderr, "snap: compress stdin with snappy[1] and the snappy-framing-format[2][3]. Writes to stdout.\n   [1]http://code.google.com/p/snappy\n   [2]https://github.com/glycerine/go-unsnap-stream\n   [3]http://code.google.com/p/snappy/source/browse/trunk/framing_format.txt\n")
		os.Exit(1)
	}

	snap := &unsnap.SnappyFile{
		Fname:   "stdout",
		Writer:  os.Stdout,
		EncBuf:  *unsnap.NewFixedSizeRingBuf(unsnap.CHUNK_MAX * 2), // on writing: temp for testing compression
		DecBuf:  *unsnap.NewFixedSizeRingBuf(unsnap.CHUNK_MAX * 2), // on writing: final buffer of snappy framed and encoded bytes
		Writing: true,
	}
	defer snap.Close()

	_, err := io.Copy(snap, os.Stdin)
	if err != nil {
		panic(err)
	}
}
