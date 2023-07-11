// Copyright 2019 The Nakama Authors
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

package server

import (
	"context"

	"github.com/heroiclabs/nakama/v3/console"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *ConsoleServer) GetRuntime(ctx context.Context, in *emptypb.Empty) (*console.RuntimeInfo, error) {
	toConsole := func(modules []*moduleInfo) []*console.RuntimeInfo_ModuleInfo {
		result := make([]*console.RuntimeInfo_ModuleInfo, 0, len(modules))
		for _, m := range modules {
			result = append(result, &console.RuntimeInfo_ModuleInfo{
				Path:    m.path,
				ModTime: &timestamppb.Timestamp{Seconds: m.modTime.UTC().Unix()},
			})
		}
		return result
	}

	return &console.RuntimeInfo{
		LuaRpcFunctions: s.runtimeInfo.LuaRpcFunctions,
		GoRpcFunctions:  s.runtimeInfo.GoRpcFunctions,
		JsRpcFunctions:  s.runtimeInfo.JavaScriptRpcFunctions,
		GoModules:       toConsole(s.runtimeInfo.GoModules),
		LuaModules:      toConsole(s.runtimeInfo.LuaModules),
		JsModules:       toConsole(s.runtimeInfo.JavaScriptModules),
	}, nil
}
