package main

import (
	"fmt"
	"io"
	"os"

	"compress/flate"
)

func main() {

	if len(os.Args) > 1 && os.Args[1] == "--help" {
		fmt.Fprintf(os.Stderr, "inflate: decompress stdin with DEFLATE (RFC 1951) decompression, write to stdout.\n")
		os.Exit(1)
	}

	inflated := flate.NewReader(os.Stdin)
	defer inflated.Close()

	_, err := io.Copy(os.Stdout, inflated)
	if err != nil {
		panic(err)
	}
}
