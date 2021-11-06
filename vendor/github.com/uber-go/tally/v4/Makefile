export GO15VENDOREXPERIMENT=1

BENCH_FLAGS ?= -cpuprofile=cpu.pprof -memprofile=mem.pprof -benchmem
PKGS ?= $(shell glide novendor)
PKG_FILES ?= *.go example/*.go m3/*.go m3/customtransports m3/thriftudp
LINT_IGNORE = m3/thrift\|thirdparty
LICENSE_IGNORE = thirdparty

.PHONY: all
all: lint test

.PHONY: dependencies
dependencies:
	@echo "Installing Glide and locked dependencies..."
	glide --version || go get -u -f github.com/Masterminds/glide
	glide install
	@echo "Installing test dependencies..."
	go install ./vendor/github.com/axw/gocov/gocov
	go install ./vendor/github.com/mattn/goveralls
	@echo "Installing golint..."
	go install ./vendor/github.com/golang/lint/golint

.PHONY: lint
lint: gomodtidy
	@rm -rf lint.log
	@echo "Checking formatting..."
	@gofmt -d -s $(PKG_FILES) 2>&1 | grep -v '$(LINT_IGNORE)' | tee lint.log
	@echo "Installing test dependencies for vet..."
	@go test -i $(PKGS)
	@echo "Checking lint..."
	@$(foreach dir,$(PKGS),golint $(dir) 2>&1 | grep -v '$(LINT_IGNORE)' | tee -a lint.log;)
	@echo "Checking for unresolved FIXMEs..."
	@git grep -i fixme | grep -v -e vendor -e Makefile | grep -v '$(LINT_IGNORE)' | tee -a lint.log
	@echo "Checking for license headers..."
	@./check_license.sh | grep -v '$(LICENSE_IGNORE)' | tee -a lint.log
	@[ ! -s lint.log ]

.PHONY: gomodtidy
gomodtidy: go.mod go.sum
	go mod tidy
	@if ! git diff --quiet $^; then \
		echo "go mod tidy changed files:" && \
		git status --porcelain $^ && \
		false; \
	fi

.PHONY: test
test:
	go test -race -v $(PKGS)

.PHONY: examples
examples:
	mkdir -p ./bin
	go build -o ./bin/print_example ./example/
	go build -o ./bin/m3_example ./m3/example/
	go build -o ./bin/prometheus_example ./prometheus/example/
	go build -o ./bin/statsd_example ./statsd/example/

.PHONY: cover
cover:
	go test -cover -coverprofile cover.out -race -v $(PKGS)

.PHONY: coveralls
coveralls:
	goveralls -service=travis-ci || echo "Coveralls failed"

.PHONY: bench
BENCH ?= .
bench:
	@$(foreach pkg,$(PKGS),go test -bench=$(BENCH) -run="^$$" $(BENCH_FLAGS) $(pkg);)
