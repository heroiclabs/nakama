## nakama

```
protoc -I/usr/local/include -I. -I$GOPATH/src -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway/third_party/googleapis --go_out=plugins=grpc:. ./api/api.proto
 
protoc -I/usr/local/include -I. -I$GOPATH/src -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway/third_party/googleapis --grpc-gateway_out=logtostderr=true:. ./api/api.proto

go-bindata -pkg migration -prefix migrations -o migrations/embedded.go -ignore=embedded.go migrations/...

go build -i

./nakama migrate up

./nakama --name=nakama --log.stdout --log.verbose

curl -X POST "http://127.0.0.1:7351/v2/account/authenticate/custom?create=true" -d '{"id":"foo"}' -v
```
