Angular service code gen
=======

#### An utility tool to generate an angular REST client from the protobuf spec service definitions used by grpc-gateway.

### Usage

#### Setup
Ensure that you have your `$GOPATH` set as the protoc toolchain seems to be unable to resolve imports that are resolved through modules.
You must provide the imports that are specified inside the input proto file to the protoc binary using the `-I` options.
You might also have to set your `$GOBIN`.

Install the `protoc-gen-angular` binary by running:
```shell
go build && go install
```

Otherwise you can install it using go mod as such:
```shell
go get github.com/heroiclabs/nakama/console/protoc-gen-angular
```

#### Options
Options are passed to the `protoc` flag in the following way: `--angular_out=service_name=foo,filename=bar.ts:.`.

* `filename`: The filename for the generated output.
* `service_name`: The name of the generated TypeScript service class.
#### Generate the Angular service
##### Example
```shell
protoc -I. -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway/third_party/googleapis -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway -I../vendor --angular_out=filename=console.service.ts,service_name=ConsoleService:. <input file.proto>
```

The output file is: `console.service.ts`.

### Limitations

The code generator has __only__ been checked against a limited set of grpc-gateway service definitions and might have trouble handling nested enumerables inside message definitions YMMV.
