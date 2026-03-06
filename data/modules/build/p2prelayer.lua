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

local function create(context, _)
  local match_id = nk.match_create("p2prelayer", {})
  return nk.json_encode({ match_id = match_id })
end
nk.register_rpc(create, "p2prelayer.create")

local M = {}

function M.match_init(context, params)
  local state = {}
  local tick_rate = 1
  local label = "skill=100-150"

  return state, tick_rate, label
end

function M.match_join_attempt(context, dispatcher, tick, state, presence)
  -- let anyone join.
  state.presences = state.presences or {}
  print(nk.json_encode(presence))
  state.presences[presence.user_id] = presence
  return state, true
end

function M.match_join(context, dispatcher, tick, state, presences)
  return state
end

function M.match_leave(context, dispatcher, tick, state, presence)
  return state
end

function M.match_loop(context, dispatcher, tick, state, messages)
  if (tick < 10) then
    local message = nk.json_encode({ hello = "world!" })
    dispatcher.broadcast_message(1, message)
    return state
  else
    print(nk.json_encode(state))
    return nil -- stop match.
  end
end

function M.match_terminate(context, dispatcher, tick, state, grace_seconds)
  return nil
end

return M
