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
local du = require("debug_utils")

--[[
  Test RPC function calls from client libraries.
--]]

local function rpc(_context, payload)
  nk.event("foo", {bar = "baz"}, 12345, false)
  return payload
end
nk.register_rpc(rpc, "clientrpc.rpc")

local function rpc_error(_context, _payload)
  error("Some error occured.")
end
nk.register_rpc(rpc_error, "clientrpc.rpc_error")

local function rpc_get(_context, _payload)
  local response = {
    message = "PONG"
  }
  return nk.json_encode(response)
end
nk.register_rpc(rpc_get, "clientrpc.rpc_get")

local function send_notification(context, payload)
  local decoded = nk.json_decode(payload)
  local new_notifications = {
    {
      code = 1,
      content = { reward_coins = 1000 },
      persistent = true,
      sender_id = context.user_id,
      subject = "You've unlocked level 100!",
      user_id = decoded.user_id
    }
  }
  nk.notifications_send(new_notifications)
end
nk.register_rpc(send_notification, "clientrpc.send_notification")

local function send_stream_data(context, payload)
  local stream = {
    mode = 20,
    label = "Stream Data Test",
  }
  nk.stream_user_join(context.user_id, context.session_id, stream, false, false)
  nk.stream_send(stream, tostring(payload))
end
nk.register_rpc(send_stream_data, "clientrpc.send_stream_data")

local function create_authoritative_match(_context, payload)
  local decoded = nk.json_decode(payload)
  local params = {
    debug = (decoded and decoded.debug) or true,
    label = (decoded and decoded.label)
  }

  local match_id = nk.match_create("match", params)
  return nk.json_encode({ match_id = match_id })
end
nk.register_rpc(create_authoritative_match, "clientrpc.create_authoritative_match")

local function print_env(context, _)
  print("env:\n" .. du.print_r(context.env))
  local response = {
    message = context.env
  }
  return nk.json_encode(response)
end
nk.register_rpc(print_env, "clientrpc.print_env")

local function create_leaderboard(context, payload)
  local decoded = nk.json_decode(payload)
  local id = nk.uuid_v4()
  local status, result = pcall(nk.leaderboard_create, id, false, "desc", decoded.operator)
  if (not status) then
    nk.logger_error(result)
  end

  local response = {
    leaderboard_id = id
  }
  return nk.json_encode(response)
end
nk.register_rpc(create_leaderboard, "clientrpc.create_leaderboard")
