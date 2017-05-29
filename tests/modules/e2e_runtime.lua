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

-- logger_error
do
  local message = nk.logger_error(("%q"):format("ERROR logger."))
  assert(message == "\"ERROR logger.\"")
end

-- storage_write
do
  local new_records = {
    {bucket = "mygame", collection = "settings", record = "a", user_id = nil, value = "{}"},
    {bucket = "mygame", collection = "settings", record = "b", user_id = nil, value = "{}"},
    {bucket = "mygame", collection = "settings", record = "c", user_id = nil, value = "{}"}
  }
  -- This will error if it fails.
  nk.storage_write(new_records)
end

-- storage_fetch
do
  local record_keys = {
    {bucket = "mygame", collection = "settings", record = "a", user_id = nil},
    {bucket = "mygame", collection = "settings", record = "b", user_id = nil},
    {bucket = "mygame", collection = "settings", record = "c", user_id = nil}
  }
  local records = nk.storage_fetch(record_keys)
  for i, r in ipairs(records)
  do
    assert(r.value == "{}", "'r.value' must be '{}'")
  end
end

-- storage_remove
do
  local record_keys = {
    {bucket = "mygame", collection = "settings", record = "a", user_id = nil},
    {bucket = "mygame", collection = "settings", record = "b", user_id = nil},
    {bucket = "mygame", collection = "settings", record = "c", user_id = nil}
  }
  -- This will error if it fails.
  nk.storage_remove(record_keys)
end

-- user_fetch_id
do
  local user_ids = {"4c2ae592-b2a7-445e-98ec-697694478b1c"}
  local users = nk.user_fetch_id(user_ids)
  assert(#users == 1)
  assert(user_ids[1] == users[1].id)
end

-- user_fetch_handle
do
  local user_handles = {"02ebb2c8"}
  local users = nk.user_fetch_handle(user_handles)
  assert(#users == 1)
  assert(user_handles[1] == users[1].handle)
end

--[[
  Nakamax module
]]--

-- http_request
do
  local url = "https://google.com/"
  local method = "HEAD"
  local code, headers, respbody = nx.http_request(url, method, {}, nil)
  assert(code == 200, "'code' must equal 200")
end

-- json_decode
do
  local object = nx.json_decode("{'hello': 'world'}")
  assert(object.hello, "'object.hello' must not be nil")
  assert(object.hello == "world", "'object.hello' must equal 'world'")
end

-- json_encode
do
  local json = nx.json_encode({["id"] = "blah"})
  assert(json == "{'id': 'blah'}", "'json' must equal '{'id': 'blah'}'")
end

-- uuid_v4
do
  local uuid = nx.uuid_v4()
  assert(uuid, "'uuid' must not be nil")
  assert(type(uuid) == "string", "'uuid' type must be string")
end
