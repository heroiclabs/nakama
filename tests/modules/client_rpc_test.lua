--[[
 Copyright 2017 The Nakama Authors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
--]]

local nk = require("nakama")

local client_rpc_test = {}

function client_rpc_test.echo(context, payload)
  return payload
end
nk.register_rpc(client_rpc_test.echo, "client_rpc_test_echo")

function client_rpc_test.fail(context, payload)
  error("fail")
end
nk.register_rpc(client_rpc_test.fail, "client_rpc_test_fail")

return client_rpc_test
