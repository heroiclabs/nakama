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

-- A simple echo example which returns the payload received as input.
local function echo(context, payload)
  return payload
end
nk.register_rpc(echo, "client_rpc_echo")

-- Tests whether a client handles a Lua error gracefully.
local function fail(context, payload)
  error("fail")
end
nk.register_rpc(fail, "client_rpc_fail")

-- Create a leaderboard and insert 15 test records.
-- Expects as input {"leaderboard_id": "<...>"}
local function generate_leaderboard(context, payload)
  local leaderboard_id = nk.json_decode(payload)["leaderboard_id"]
  nk.leaderboard_create(leaderboard_id, "desc")
  for i = 1, 15 do
    nk.leaderboard_submit_set(leaderboard_id, i, nk.uuid_v4())
  end
end
nk.register_rpc(generate_leaderboard, "generate_leaderboard")

-- Generate 15 notifications for the user calling.
local function generate_notifications(context, payload)
  local notifications = {}
  for i = 1, 15 do
    table.insert(notifications, {
      Persistent = true,
      UserId = context.UserId,
      Subject = "test " .. i,
      Content = {
        test = i
      }
    })
  end
  nk.notifications_send_id(notifications)
end
nk.register_rpc(generate_notifications, "generate_notifications")
