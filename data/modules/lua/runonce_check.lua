--[[
 Copyright 2018 The Nakama Authors

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

--[[
  Test run_once function calls at server startup.
--]]

nk.run_once(function(context)
  assert(context.execution_mode, "run_once")
--   nk.match_create("match", {debug = true, label = "{\"foo\":123}"})
end)

nk.run_once(function(context)
  error("Should not be executed.")
end)

local function rpc_signal(context, payload)
  local matches = nk.match_list(1, true)
  if #matches < 1 then
    error("no matches")
  end
  return nk.match_signal(matches[1].match_id, payload)
end
nk.register_rpc(rpc_signal, "rpc_signal")
