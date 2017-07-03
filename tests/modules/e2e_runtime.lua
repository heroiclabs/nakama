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
local nx = require("nakamax")

-- NOTE You must preload datasets with "e2e_runtime.sql" before each run.

function print_r(arr, indentLevel)
  local str = ""
  local indentStr = "#"

  if(indentLevel == nil) then
      print(print_r(arr, 0))
      return
  end

  for i = 0, indentLevel do
      indentStr = indentStr.."\t"
  end

  for index,Value in pairs(arr) do
      if type(Value) == "table" then
          str = str..indentStr..index..": \n"..print_r(Value, (indentLevel + 1))
      else
          str = str..indentStr..index..": "..Value.."\n"
      end
  end
  return str
end

--[[
  Nakama module
]]--

-- leaderboard_create
do
  local id = nx.uuid_v4()
  local md = {}
  -- This will error if it fails.
  nk.leaderboard_create(id, "desc", "0 0 * * 1", md, false)
end

-- leaderboard_create - which already exists
do
  local id = "ce042d38-c3db-4ebd-bc99-3aaa0adbdef7"
  -- This will error if it fails.
  -- nk.leaderboard_create(id, "desc", "0 0 * * 1", {}, false)
end

-- logger_info
do
  local message = nk.logger_info(("%q"):format("INFO logger."))
  assert(message == "\"INFO logger.\"")
end

-- logger_warn
do
  local message = nk.logger_warn(("%q"):format("WARN logger."))
  assert(message == "\"WARN logger.\"")
end

-- users_fetch_id
do
  local user_ids = {"4c2ae592-b2a7-445e-98ec-697694478b1c"}
  local users = nk.users_fetch_id(user_ids)
  assert(#users == 1)
  assert(user_ids[1] == users[1].Id)
end

-- users_fetch_handle
do
  local user_handles = {"02ebb2c8"}
  local users = nk.users_fetch_handle(user_handles)
  assert(user_handles[1] == users[1].Handle)
end

-- users_ban
do
  local user_ids = {"4c2ae592-b2a7-445e-98ec-697694478b1c"}
  local status, res = pcall(nk.users_ban, user_ids)
  if not status then
    print(res)
  end
  assert(status == true)
end

--[[
  Nakamax module
]]--

-- uuid_v4
do
  local uuid = nx.uuid_v4()
  assert(uuid, "'uuid' must not be nil")
  assert(type(uuid) == "string", "'uuid' type must be string")
end

-- http_request
do
  local url = "https://google.com/"
  local method = "HEAD"
  local code, headers, respbody = nx.http_request(url, method, {}, nil)
  assert(code == 200, "'code' must equal 200")
end

-- json_decode
do
  local object = nx.json_decode('{"hello": "world"}')
  assert(object.hello, "'object.hello' must not be nil")
  assert(object.hello == "world", "'object.hello' must equal 'world'")
end

-- json_encode
do
  local json = nx.json_encode({["id"] = "blah"})
  assert(json == '{"id":"blah"}', '"json" must equal "{"id":"blah"}"')
end

-- base64_encode_decode
do
  local objectEncode = nx.base64_encode('{"hello": "world"}')
  assert(objectEncode, "'objectEncode' must not be nil")
  local objectDecode = nx.base64_decode(objectEncode)
  assert(objectDecode, "'objectDecode' must not be nil")
  assert(objectDecode == '{"hello": "world"}', '"objectDecode" must equal {"hello": "world"}')
end

-- base16_encode_decode
do
  local objectEncode = nx.base16_encode('{"hello": "world"}')
  assert(objectEncode, "'objectEncode' must not be nil")
  local objectDecode = nx.base16_decode(objectEncode)
  assert(objectDecode, "'objectDecode' must not be nil")
  assert(objectDecode == '{"hello": "world"}', '"objectDecode" must equal {"hello": "world"}')
end
