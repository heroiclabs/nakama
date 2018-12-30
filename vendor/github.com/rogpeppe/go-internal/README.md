This repository factors out an opinionated selection of internal packages and functionality from the Go standard
library. Currently this consists mostly of packages and testing code from within the Go tool implementation.

Included are the following:

- dirhash: calculate hashes over directory trees the same way that the Go tool does.
- goproxytest: a GOPROXY implementation designed for test use.
- gotooltest: Use the Go tool inside test scripts (see testscript below)
- imports: list of known architectures and OSs, and support for reading import import statements.
- modfile: read and write `go.mod` files while preserving formatting and comments.
- module: module paths and versions.
- par: do work in parallel.
- semver: semantic version parsing.
- testenv: information on the current testing environment.
- testscript: script-based testing based on txtar files
- txtar: simple text-based file archives for testing.
