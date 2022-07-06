// Copyright 2020 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package console

//go:generate protoc -I. -I../vendor -I../vendor/github.com/heroiclabs/nakama-common -I../build/grpc-gateway-v2.3.0/third_party/googleapis -I../vendor/github.com/grpc-ecosystem/grpc-gateway/v2 --go_out=. --go_opt=paths=source_relative --go-grpc_out=. --go-grpc_opt=paths=source_relative --grpc-gateway_out=. --grpc-gateway_opt=paths=source_relative --grpc-gateway_opt=logtostderr=true --grpc-gateway_opt=generate_unbound_methods=true --openapiv2_out=. --openapiv2_opt=json_names_for_fields=false,logtostderr=true console.proto
//go:generate sh -c "(cd openapi-gen-angular && go run . -i '../console.swagger.json' -o '../ui/src/app/console.service.ts' -rm_prefix='console,nakamaconsole,nakama,Console_')"
