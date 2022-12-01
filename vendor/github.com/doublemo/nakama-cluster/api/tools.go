//go:build tools
// +build tools

package api

import (
	_ "github.com/heroiclabs/nakama-common/rtapi"
	_ "google.golang.org/grpc/cmd/protoc-gen-go-grpc"
	_ "google.golang.org/protobuf/cmd/protoc-gen-go"
	_ "google.golang.org/protobuf/types/known/wrapperspb"
)

// go install \
//     google.golang.org/protobuf/cmd/protoc-gen-go \
//     google.golang.org/grpc/cmd/protoc-gen-go-grpc
