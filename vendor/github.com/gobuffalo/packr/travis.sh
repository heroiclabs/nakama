#!/bin/sh

rm -rf packrd
rm -rf v2/packrd
go get -t ./...
go install -v ./packr
packr clean
go test -v -timeout=5s -race ./...
