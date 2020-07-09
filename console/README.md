# Code generation for the Nakama Console

## Generate Swagger documentation

First, create the `console.swagger.json` file using `protoc`:

`protoc -I. -I$GOPATH/src/ -I../vendor/github.com/grpc-ecosystem/grpc-gateway -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway/third_party/googleapis --swagger_out=. console.proto`

## Generate Go gRPC code

Next, generate the Go backend for the console:

`protoc -I. -I$GOPATH/src/ -I../vendor/github.com/grpc-ecosystem/grpc-gateway -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway/third_party/googleapis --go_out=plugins=grpc,paths=source_relative:. console.proto`

### Generate Client gRPC code

Lastly, generate client code from the Swagger documentation generated earlier. See the corresponding client SDK for scripts related generating code from a Swagger definition.