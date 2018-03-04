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
  Test RPC function calls from client libraries.
--]]

local function rpc(_context, payload)
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
      Code = 1,
      Content = { reward_coins = 1000 },
      Persistent = true,
      SenderId = context.UserId,
      Subject = "You've unlocked level 100!",
      UserId = decoded.user_id
    }
  }
  nk.notifications_send(new_notifications)
end
nk.register_rpc(send_notification, "clientrpc.send_notification")
