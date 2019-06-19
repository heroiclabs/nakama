TAGS ?= "sqlite"
GO_BIN ?= go

install:
	packr2
	$(GO_BIN) install -v .

deps:
	$(GO_BIN) get github.com/gobuffalo/release
	$(GO_BIN) get github.com/gobuffalo/packr/v2/packr2
	$(GO_BIN) get -tags ${TAGS} -t ./...
ifeq ($(GO111MODULE),on)
	$(GO_BIN) mod tidy
endif

build:
	packr2
	$(GO_BIN) build -v .

test:
	packr2
	$(GO_BIN) test -tags ${TAGS} ./...

ci-test:
	$(GO_BIN) test -tags ${TAGS} -race ./...

lint:
	gometalinter --vendor ./... --deadline=1m --skip=internal

update:
	$(GO_BIN) get -u -tags ${TAGS}
ifeq ($(GO111MODULE),on)
	$(GO_BIN) mod tidy
endif
	packr2
	make test
	make install
ifeq ($(GO111MODULE),on)
	$(GO_BIN) mod tidy
endif

release-test:
	$(GO_BIN) test -tags ${TAGS} -race ./...

release:
	release -y -f version.go
