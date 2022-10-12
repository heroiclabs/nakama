# "go install"-ed binaries will be placed here during development.
export GOBIN ?= $(shell pwd)/bin

BENCH_FLAGS ?= -cpuprofile=cpu.pprof -memprofile=mem.pprof -benchmem
GO_FILES = $(shell find . \
	   '(' -path '*/.*' -o -path './thirdparty/*' -prune ')' -o \
	   '(' -type f -a -name '*.go' ')' -print)
MODULES = . ./tools

LINT_IGNORE = m3/thrift\|thirdparty
LICENSE_IGNORE = m3/thrift\|thirdparty
STATICCHECK_IGNORE = m3/thrift\|thirdparty\|m3/resource_pool.go:.*releaseProto is unused\|m3/reporter.go:.* argument should be pointer-like to avoid allocations

GOLINT = $(GOBIN)/golint
STATICCHECK = $(GOBIN)/staticcheck

.PHONY: all
all: lint test

.PHONY: lint
lint: gofmt golint gomodtidy staticcheck license

.PHONY: golint
golint: $(GOLINT)
	@echo "Checking lint..."
	@$(eval LOG := $(shell mktemp -t log.XXXXX))
	@$(GOLINT) ./... | grep -v '$(LINT_IGNORE)' > $(LOG) || true
	@[ ! -s "$(LOG)" ] || \
		(echo "golint failed:" | \
		cat - $(LOG) && false)

$(GOLINT): tools/go.mod
	cd tools && go install golang.org/x/lint/golint

.PHONY: staticcheck
staticcheck: $(STATICCHECK)
	@echo "Checking staticcheck..."
	@$(eval LOG := $(shell mktemp -t log.XXXXX))
	@$(STATICCHECK) ./... | grep -v '$(STATICCHECK_IGNORE)' > $(LOG) || true
	@[ ! -s "$(LOG)" ] || \
		(echo "staticcheck failed:" | \
		cat - $(LOG) && false)

$(STATICCHECK):
	cd tools && go install honnef.co/go/tools/cmd/staticcheck

.PHONY: gofmt
gofmt:
	@echo "Checking formatting..."
	$(eval LOG := $(shell mktemp -t log.XXXXX))
	@gofmt -e -s -l $(GO_FILES) | grep -v '$(LINT_IGNORE)' > $(LOG) || true
	@[ ! -s "$(LOG)" ] || \
		(echo "gofmt failed. Please reformat the following files:" | \
		cat - $(LOG) && false)


.PHONY: gomodtidy
gomodtidy: go.mod go.sum
	@echo "Checking go.mod and go.sum..."
	@$(foreach mod,$(MODULES),\
		(cd $(mod) && go mod tidy) &&) true
	@if ! git diff --quiet $^; then \
		echo "go mod tidy changed files:" && \
		git status --porcelain $^ && \
		false; \
	fi

.PHONY: license
license: check_license.sh
	@echo "Checking for license headers..."
	$(eval LOG := $(shell mktemp -t log.XXXXX))
	@./check_license.sh | grep -v '$(LICENSE_IGNORE)' > $(LOG) || true
	@[ ! -s "$(LOG)" ] || \
		(echo "Missing license headers in some files:" | \
		cat - $(LOG) && false)

.PHONY: test
test:
	go test -race -v ./...

.PHONY: examples
examples:
	mkdir -p ./bin
	go build -o ./bin/print_example ./example/
	go build -o ./bin/m3_example ./m3/example/
	go build -o ./bin/prometheus_example ./prometheus/example/
	go build -o ./bin/statsd_example ./statsd/example/

.PHONY: cover
cover:
	go test -cover -coverprofile=cover.out -coverpkg=./... -race -v ./...
	go tool cover -html=cover.out -o cover.html

.PHONY: bench
BENCH ?= .
bench:
	go test -bench=$(BENCH) -run="^$$" $(BENCH_FLAGS) ./...

