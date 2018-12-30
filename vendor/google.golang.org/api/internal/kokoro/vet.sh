#!/bin/bash

# Fail on any error
set -eo pipefail

# Display commands being run
set -x

# Only run the linter on go1.11, since it needs type aliases (and we only care about its output once).
# TODO(deklerk) We should pass an environment variable from kokoro to decide this logic instead.
if [[ `go version` != *"go1.11"* ]]; then
    exit 0
fi

pwd

try3() { eval "$*" || eval "$*" || eval "$*"; }

try3 go get -u \
  golang.org/x/lint/golint \
  golang.org/x/tools/cmd/goimports \
  golang.org/x/lint/golint \
  honnef.co/go/tools/cmd/staticcheck

# Look at all .go files (ignoring .pb.go files) and make sure they have a Copyright. Fail if any don't.
git ls-files "*[^.pb].go" | xargs grep -L "\(Copyright [0-9]\{4,\}\)" 2>&1 | tee /dev/stderr | (! read)
gofmt -s -d -l . 2>&1 | tee /dev/stderr | (! read)
goimports -l . 2>&1 | tee /dev/stderr | (! read)

# Runs the linter. Regrettably the linter is very simple and does not provide the ability to exclude rules or files,
# so we rely on inverse grepping to do this for us.
golint ./... 2>&1 | ( \
    grep -v "gen.go" | \
    grep -v "disco.go" | \
    grep -v "exported const DefaultDelayThreshold should have comment" | \
    grep -v "exported const DefaultBundleCountThreshold should have comment" | \
    grep -v "exported const DefaultBundleByteThreshold should have comment" | \
    grep -v "exported const DefaultBufferedByteLimit should have comment" | \
    grep -v "error var Done should have name of the form ErrFoo" | \
    grep -v "exported method APIKey.RoundTrip should have comment or be unexported" | \
    grep -v "exported method MarshalStyle.JSONReader should have comment or be unexported" | \
    grep -v "UnmarshalJSON should have comment or be unexported" | \
    grep -v "MarshalJSON should have comment or be unexported" | \
    grep -vE "\.pb\.go:" || true) | tee /dev/stderr | (! read)

staticcheck -ignore '
*:SA1019
' ./...