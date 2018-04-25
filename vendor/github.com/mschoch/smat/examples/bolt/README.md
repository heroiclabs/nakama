# boltsmat

An example project, showing how you can use [smat](https://github.com/mschoch/smat) to test [Bolt](https://github.com/boltdb/bolt).

## Prerequisites

    $ go get github.com/dvyukov/go-fuzz/go-fuzz
    $ go get github.com/dvyukov/go-fuzz/go-fuzz-build

## Steps

1.  Generate initial fuzz corpus:
```
    $ go test -tags=gofuzz -run=TestGenerateFuzzData
```

2.  Build go-fuzz test program with instrumentation:
```
    $ go-fuzz-build github.com/mschoch/smat/examples/bolt
```

3.  Run go-fuzz:
```
    $ go-fuzz -bin=./boltsmat-fuzz.zip -workdir=workdir/ -timeout=60
```    

### If you find a crasher...

You can copy the contents of the .output file provided by go-fuzz, and paste it into the `crasher` variable of the `TestCrasher` function in crash_test.go.  Then run:

    $ go test -v -run=TestCrasher

This will reproduce the crash with additional logging of the state machine turned on.
