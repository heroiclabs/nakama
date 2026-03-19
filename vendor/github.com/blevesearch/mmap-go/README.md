mmap-go
=======
[![Tests](https://github.com/blevesearch/mmap-go/actions/workflows/tests.yml/badge.svg?branch=master&event=push)](https://github.com/blevesearch/mmap-go/actions/workflows/tests.yml?query=event%3Apush+branch%3Amaster)
[![Go Reference](https://pkg.go.dev/badge/github.com/blevesearch/mmap-go.svg)](https://pkg.go.dev/github.com/blevesearch/mmap-go)

mmap-go is a portable mmap package for the [Go programming language](http://golang.org).

Operating System Support
========================
This package is tested using GitHub Actions on Linux, macOS, and Windows. It should also work on other Unix-like platforms, but hasn't been tested with them. I'm interested to hear about the results.

This package compiles for Plan 9 and WebAssembly, but its functions always return errors.

Related functions such as `mprotect` and `mincore` aren't included. I haven't found a way to implement them on Windows without introducing significant complexity. If you're running on a Unix-like platform and really need these features, it should still be possible to implement them on top of this package via `syscall`.
