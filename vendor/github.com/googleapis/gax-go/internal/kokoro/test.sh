#!/bin/bash

# TODO(deklerk) Add integration tests when it's secure to do so. b/64723143

# Fail on any error
set -eo pipefail

# Display commands being run
set -x

# cd to project dir on Kokoro instance
cd github/gax-go

go version

# Set $GOPATH
export GOPATH="$HOME/go"
export GAX_HOME=$GOPATH/src/googleapis/gax-go
export PATH="$GOPATH/bin:$PATH"
mkdir -p $GAX_HOME

# Move code into $GOPATH and get dependencies
git clone . $GAX_HOME
cd $GAX_HOME

try3() { eval "$*" || eval "$*" || eval "$*"; }
try3 go get -v -t ./...

./internal/kokoro/vet.sh

# Run tests and tee output to log file, to be pushed to GCS as artifact.
go test -race -v ./... 2>&1 | tee $KOKORO_ARTIFACTS_DIR/$KOKORO_GERRIT_CHANGE_NUMBER.txt