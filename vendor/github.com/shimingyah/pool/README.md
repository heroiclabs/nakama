# Pool
[![GoDoc](https://godoc.org/github.com/shimingyah/pool?status.svg)](https://godoc.org/github.com/shimingyah/pool)
[![Go Report Card](https://goreportcard.com/badge/github.com/shimingyah/pool?style=flat-square)](https://goreportcard.com/report/github.com/shimingyah/pool)
[![LICENSE](https://img.shields.io/badge/licence-Apache%202.0-brightgreen.svg?style=flat-square)](https://github.com/shimingyah/pool/blob/master/LICENSE)

Connection pool for Go's grpc client that supports connection reuse.

Pool provides additional features:

* `Connection reuse` supported by specific MaxConcurrentStreams param.
* `Failure reconnection` supported by grpc's keepalive.

# Getting started

## Install

Import package:

```
import (
    "github.com/shimingyah/pool"
)
```

```
go get github.com/shimingyah/pool
```

# Usage

```
p, err := pool.New("127.0.0.1:8080", pool.DefaultOptions)
if err != nil {
    log.Fatalf("failed to new pool: %v", err)
}
defer p.Close()

conn, err := p.Get()
if err != nil {
    log.Fatalf("failed to get conn: %v", err)
}
defer conn.Close()

// cc := conn.Value()
// client := pb.NewClient(conn.Value())
```
See the complete example: [https://github.com/shimingyah/pool/tree/master/example](https://github.com/shimingyah/pool/tree/master/example)

# Reference
* [https://github.com/fatih/pool](https://github.com/fatih/pool)
* [https://github.com/silenceper/pool](https://github.com/silenceper/pool)

# License

Pool is under the Apache 2.0 license. See the [LICENSE](https://github.com/shimingyah/pool/blob/master/LICENSE) file for details.