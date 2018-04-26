package main

import (
	"fmt"
	"io"
	"os"

	"compress/flate"
)

func main() {

	if len(os.Args) > 1 && os.Args[1] == "--help" {
		fmt.Fprintf(os.Stderr, "deflate: compress stdin with DEFLATE (RFC 1951) best-compression setting, write to stdout.\n")
		os.Exit(1)
	}

	deflated, err := flate.NewWriter(os.Stdout, flate.BestCompression)
	if err != nil {
		panic(err)
	}
	defer deflated.Close()

	_, err = io.Copy(deflated, os.Stdin)
	if err != nil {
		panic(err)
	}
}
