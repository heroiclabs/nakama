# Copyright 2017 The Nakama Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

BINNAME := nakama
VERSION := 0.12.1
BUILDDIR := build
COMMITID := $(shell git rev-parse --short HEAD 2>/dev/null || echo nosha)
DOCKERDIR := install/docker/nakama

PROTOC ?= protoc
PROTOCFLAGS := -I . -I vendor --gogoslick_out=plugins=grpc:.
GOBINDATA ?= go-bindata
COCKROACH ?= cockroach

PROTOS  := server/api.proto
GOFLAGS := -gcflags "-trimpath ${CURDIR}"
LDFLAGS := -ldflags "-X main.version=${VERSION} -X main.commitID=${COMMITID}"
PLATFORMS := darwin linux windows

.PHONY: help
default help:
	@echo "Usage: make <command>\n"
	@echo "The commands are:"
	@echo "   all         Alias for '$(BINNAME)' command."
	@echo "   dashboard   Generate outputs for the dashboard web resources."
	@echo "   dbreset     Remove all SQL tables setup with cockroachdb. See also 'dbstart'."
	@echo "   dbsetup     Setup the SQL schema with cockroachdb. See also 'dbstart'."
	@echo "   dbstart     Start a cockroachdb server. See also 'dbstop'."
	@echo "   dbstop      Stop the running cockroachdb server."
	@echo "   gettools    Download and install Go-based build toolchain (uses go-get)."
	@echo "   $(BINNAME)      Build a development version of the server. Runs dependent rules."
	@echo "   proto       Generate the protocol buffer implementation files."
	@echo "   release     Build production release(s). Runs dependent rules."
	@echo "   run         Run development version of the server with the race detector."
	@echo "   test        Execute all development tests."
	@echo "   vet         Perform static error checks against the source.\n"

.PHONY: all
all: $(BINNAME)

$(BINNAME): proto dashboard migration
	go build ${GOFLAGS} ${LDFLAGS} -o ${BUILDDIR}/dev/${BINNAME}

.PHONY: release
release: proto dashboard migration vet test $(PLATFORMS)

$(PLATFORMS): OUTDIR := ${BUILDDIR}/release/${VERSION}/${BINNAME}
$(PLATFORMS):
	@$(foreach arch, amd64,\
		GOOS=$@ GOARCH=${arch} go build ${GOFLAGS} ${LDFLAGS} -o ${OUTDIR}-$@-${arch}/${BINNAME};\
		cp -f LICENSE README.md CHANGELOG.md ${OUTDIR}-$@-${arch}/;\
		tar -czf ${OUTDIR}-${VERSION}-$@-${arch}.tar.gz -C ${OUTDIR}-$@-${arch} .;\
		echo "  Packaged '${OUTDIR}-$@-${arch}'";\
	)

.PHONY: relupload
relupload: JQ := $(shell jq --version)
relupload: TOKEN :=
relupload: TAG   :=
relupload: proto dashboard migration $(PLATFORMS)
	@test -n "${JQ}"    # must be set
	@test -n "${TOKEN}"
	@test -n "${TAG}"
	$(eval OUT = $(shell curl -s -X POST https://api.github.com/repos/heroiclabs/nakama/releases?access_token=${TOKEN}\
		-H 'Content-Type: application/json'\
		-d '{"tag_name": "${TAG}", "name": "${TAG}", "draft": true}' | jq .id\
	))
	@echo "  New draft release ${OUT}"
	@$(foreach release, $(wildcard ${BUILDDIR}/release/${VERSION}/*.tar.gz),\
		curl -s -S -X POST https://uploads.github.com/repos/heroiclabs/nakama/releases/${OUT}/assets?name=${notdir ${release}}\
			-H 'Authorization: token ${TOKEN}'\
			-H 'Content-Type: application/zip'\
			--data-binary @${release} > /dev/null;\
		echo "  Uploaded '${release}'";\
	)
	@echo "  Go to https://github.com/heroiclabs/nakama/releases"

.PHONY: vet
vet:
	go vet ${GOFLAGS} ${LDFLAGS}

.PHONY: test
test:
	@echo "Not yet implemented"

.PHONY: run
run: GOFLAGS := -race
run: $(BINNAME)
	./${BUILDDIR}/dev/${BINNAME}

.PHONY: dashboard
dashboard: build/generated/dashboard/embedded.go

build/generated/dashboard/embedded.go: $(shell find dashboard/src -type f) dashboard/index.html
	cd dashboard; npm run build
	${GOBINDATA} -pkg dashboard -prefix dashboard/dist -o ${BUILDDIR}/generated/dashboard/embedded.go dashboard/dist/...

.PHONY: migration
migration: build/generated/migration/embedded.go

build/generated/migration/embedded.go: $(shell find migrations -type f)
	${GOBINDATA} -pkg migration -prefix migrations -o ${BUILDDIR}/generated/migration/embedded.go migrations/...

.PHONY: proto
proto: $(PROTOS:%.proto=%.pb.go)

pkg/client/client.pb.go: PROTOCFLAGS := -I . -I vendor --gogoslick_out=.

%.pb.go: %.proto
	${PROTOC} ${PROTOCFLAGS} $^

.PHONY: gettools
gettools:
	go get -u github.com/gogo/protobuf/protoc-gen-gogoslick
	go get -u github.com/jteeuwen/go-bindata/...
	cd dashboard; npm install

.PHONY: dbstart
dbstart:
	${COCKROACH} start --background --insecure --store=attrs=ssd,path=/tmp/cockroach

.PHONY: dbstop
dbstop:
	${COCKROACH} quit

.PHONY: dbsetup
dbsetup:
	./${BUILDDIR}/dev/${BINNAME} migrate up

.PHONY: dbreset
dbreset:
	./${BUILDDIR}/dev/${BINNAME} migrate down --limit 0

.PHONY: dockerbuild
dockerbuild:
	docker build --build-arg version=${VERSION} ${DOCKERDIR}

.PHONY: docker
docker: dockerbuild
	$(eval IMAGEID := $(shell docker images --filter "label=version=${VERSION}" --format "{{.ID}}"))
	docker tag ${IMAGEID} heroiclabs/nakama:${VERSION}
	docker tag ${IMAGEID} heroiclabs/nakama:latest

.PHONY: dockerpush
dockerpush:
	docker push heroiclabs/nakama:${VERSION}
	docker push heroiclabs/nakama:latest
