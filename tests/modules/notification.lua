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

function notification_send(ctx, payload)
  notifications = {
    { Subject="test_notification",Content='{["hello"] = "world"}',UserId=ctx["UserId"],Code=101,Persistent=true },
  }

  local status, res = pcall(nk.notifications_send_id, notifications)
  if not status then
    print(res)
  end
  assert(status == true)
end

nk.register_rpc(notification_send, "notification_send")
