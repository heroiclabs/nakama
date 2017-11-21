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

-- qwertyuiopasdfghjklzxcvbnm
charset = {}
for i = 97, 122 do table.insert(charset, string.char(i)) end

function string.random(length)
  math.randomseed(os.time())

  if length > 0 then
    return string.random(length - 1) .. charset[math.random(1, #charset)]
  else
    return ""
  end
end

function string.ends(str, with)
  return with == '' or string.sub(str, -string.len(with)) == with
end

--[[
  Nakama module
]]--

-- leaderboard_create
do
  local id = nk.uuid_v4()
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

-- leaderboard_create
do
  local id = nk.uuid_v4()
  local status, res = pcall(nk.leaderboard_create, id, "desc", "0 0 * * 1", {}, true)
  if not status then
    print(res)
  end
  assert(status == true)

  local status, res = pcall(nk.leaderboard_submit_set, id, 10, "4c2ae592-b2a7-445e-98ec-697694478b1c", "02ebb2c8")
  if not status then
    print(res)
  end
  assert(status == true)
end

-- leaderboard_records_list_users
do
  local id = nk.uuid_v4()
  local status, res = pcall(nk.leaderboard_create, id, "desc", "0 0 * * 1", {}, true)
  if not status then
    print(res)
  end
  assert(status == true)

  local status, res = pcall(nk.leaderboard_submit_set, id, 22, "4c2ae592-b2a7-445e-98ec-697694478b1c", "02ebb2c8")
  if not status then
    print(res)
  end
  assert(status == true)

  local status, res, cursor = pcall(nk.leaderboard_records_list_users, id, {"4c2ae592-b2a7-445e-98ec-697694478b1c"}, 10, nil)
  if not status then
    print(res)
  end
  assert(#res == 1)
  assert(res[1].OwnerId == "4c2ae592-b2a7-445e-98ec-697694478b1c")
  assert(res[1].Score == 22)
  assert(cursor == nil)
end

-- leaderboard_records_list_user
do
  local id = nk.uuid_v4()
  local status, res = pcall(nk.leaderboard_create, id, "desc", "0 0 * * 1", {}, true)
  if not status then
    print(res)
  end
  assert(status == true)

  local status, res = pcall(nk.leaderboard_submit_set, id, 33, "4c2ae592-b2a7-445e-98ec-697694478b1c", "02ebb2c8")
  if not status then
    print(res)
  end
  assert(status == true)

  local status, res, cursor = pcall(nk.leaderboard_records_list_user, id, "4c2ae592-b2a7-445e-98ec-697694478b1c", 10)
  if not status then
    print(res)
  end
  assert(#res == 1)
  assert(res[1].OwnerId == "4c2ae592-b2a7-445e-98ec-697694478b1c")
  assert(res[1].Score == 33)
  assert(cursor == nil)
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

-- groups create
do
  local name = nk.uuid_v4()
  local status, res = pcall(nk.groups_create, {{ Name=name,Description="test_description",Lang="Lang",Private=true,CreatorId="4c2ae592-b2a7-445e-98ec-697694478b1c" }})
  assert(status == true)
  assert(#res == 1)
end

-- groups user list
do
  local group_name_1 = nk.uuid_v4()
  local group_name_2 = nk.uuid_v4()
  local user_id = nk.uuid_v4()

  local status, res = pcall(nk.groups_create, {
    { Name = group_name_1, Private = true, CreatorId = user_id },
    { Name = group_name_2, Private = true, CreatorId = user_id }
  })
  assert(status == true)
  assert(#res == 2)

  local status_list, res_list = pcall(nk.groups_user_list, user_id)
  assert(status_list == true)
  assert(#res_list == 2)
  assert(((res_list[1].Group.Name == group_name_1) and (res_list[2].Group.Name == group_name_2)) or
    ((res_list[1].Group.Name == group_name_2) and (res_list[2].Group.Name == group_name_1)))
end

-- group update
do
  local user_id = nk.uuid_v4()
  local group_name = nk.uuid_v4()

  local status, res = pcall(nk.groups_create, {{ Name = group_name, Private = true, CreatorId = user_id }})
  assert(status == true)
  assert(#res == 1)

  local group_id = res[1].Id
  local updated_group_name = nk.uuid_v4()

  local status_update, res_update = pcall(nk.groups_update, {{ GroupId = group_id, Name = updated_group_name, Private = true }})
  assert(status_update == true)

  local status_list, res_list = pcall(nk.groups_user_list, user_id)
  if not status_list then
    print(res_list)
  end
  assert(status_list == true)
  assert(#res_list == 1)
  assert(res_list[1].Group.Name == updated_group_name)
end

-- group users list
do
  local status, res = pcall(nk.groups_create, {{ Name = nk.uuid_v4(), Private = true, CreatorId = "4c2ae592-b2a7-445e-98ec-697694478b1c" }})
  assert(status == true)
  assert(#res == 1)

  local group_id = res[1].Id

  -- NOTE: will fail if DB is not seeded with the expected user.
  local status_list, res_list = pcall(nk.group_users_list, group_id)
  assert(status_list == true)
  assert(#res_list == 1)
  assert(res_list[1].User.Id == "4c2ae592-b2a7-445e-98ec-697694478b1c")
end

-- users update
do
  local users_before = nk.users_fetch_id({"4c2ae592-b2a7-445e-98ec-697694478b1c"})
  assert(#users_before == 1)
  assert(users_before[1].Handle == "02ebb2c8")

  local status, reason = pcall(nk.users_update, {{UserId = "4c2ae592-b2a7-445e-98ec-697694478b1c", Handle = "updated!"}})
  if not status then
    print(reason)
  end
  assert(status == true)

  local users_after = nk.users_fetch_id({"4c2ae592-b2a7-445e-98ec-697694478b1c"})
  assert(#users_after == 1)
  assert(users_after[1].Handle == "updated!")
end

-- notifications_send_id
do
  -- This will error if it fails.
  nk.notifications_send_id({
    { Subject="test_notification",Content={["hello"] = "world"},UserId="4c2ae592-b2a7-445e-98ec-697694478b1c",Code=101,Persistent=true },
    { Subject="test_notification_2",Content={["hello"] = "world"},UserId="4c2ae592-b2a7-445e-98ec-697694478b1c",Code=102,Persistent=true },
  })
end

-- uuid_v4
do
  local uuid = nk.uuid_v4()
  assert(uuid, "'uuid' must not be nil")
  assert(type(uuid) == "string", "'uuid' type must be string")
end

-- http_request
do
  local url = "https://google.com/"
  local method = "HEAD"
  local code, headers, respbody = nk.http_request(url, method, {}, nil)
  assert(code == 200, "'code' must equal 200")
end

-- json_decode
do
  local object = nk.json_decode('{"hello": "world"}')
  assert(object.hello, "'object.hello' must not be nil")
  assert(object.hello == "world", "'object.hello' must equal 'world'")
end

-- json_decode_array
do
  local object = nk.json_decode('[{"hello": "world"}, {"hello": "world"}]')
  assert(#object == 2)
end

-- json_decode_primitive
do
  local object = nk.json_decode('"hello"')
  assert(object == "hello")
end

-- json_encode
do
  local json = nk.json_encode({["id"] = "blah"})
  assert(json == '{"id":"blah"}', '"json" must equal "{"id":"blah"}"')
end

-- json_encode_array
do
  local json = nk.json_encode({{["id"] = "blah"},{["id"] = "blah"}})
  assert(json == '[{"id":"blah"},{"id":"blah"}]', '"json" must equal "[{"id":"blah"}",{"id":"blah"}]')
end

-- json_encode_primitive
do
  local json = nk.json_encode("hello")
  assert(json == '"hello"')
end

-- base64_encode_decode
do
  local objectEncode = nk.base64_encode('{"hello": "world"}')
  assert(objectEncode, "'objectEncode' must not be nil")
  local objectDecode = nk.base64_decode(objectEncode)
  assert(objectDecode, "'objectDecode' must not be nil")
  assert(objectDecode == '{"hello": "world"}', '"objectDecode" must equal {"hello": "world"}')
end

-- base16_encode_decode
do
  local objectEncode = nk.base16_encode('{"hello": "world"}')
  assert(objectEncode, "'objectEncode' must not be nil")
  local objectDecode = nk.base16_decode(objectEncode)
  assert(objectDecode, "'objectDecode' must not be nil")
  assert(objectDecode == '{"hello": "world"}', '"objectDecode" must equal {"hello": "world"}')
end

-- cron_next
do
  -- Normally use os.time() here.
  local time = 1506433906
  local next = nk.cron_next("1 * * * *", time)
  assert(next == 1506434460)
end

-- sql_exec and sql_query
do
  -- Table names cannot start with a number so we can't use our usual UUID here.
  local t = string.random(20)

  local query = "CREATE TABLE " .. t .. " ( foo VARCHAR(20), bar BIGINT )"
  local params = {}
  local status, result = pcall(nk.sql_exec, query, params)
  if not status then
    print(result)
  end
  assert(result == 0)

  local query = "INSERT INTO " .. t .. " (foo, bar) VALUES ($1, $2), ($3, $4), ($5, $6)"
  local params = {"foo1", 1, "foo2", 2, "foo3", 3}
  local status, result = pcall(nk.sql_exec, query, params)
  if not status then
    print(result)
  end
  assert(result == 3)

  local query = "SELECT * FROM " .. t .. " WHERE bar = $1"
  local params = {2}
  local status, result = pcall(nk.sql_query, query, params)
  if not status then
    print(result)
  end
  assert(#result == 1)
  assert(result[1].foo == "foo2")
  assert(result[1].bar == 2)

  local query = "SELECT * FROM " .. t .. " WHERE bar >= $1 ORDER BY bar DESC"
  local params = {2}
  local status, result = pcall(nk.sql_query, query, params)
  if not status then
    print(result)
  end
  assert(#result == 2)
  assert(result[1].foo == "foo3")
  assert(result[1].bar == 3)
  assert(result[2].foo == "foo2")
  assert(result[2].bar == 2)

  local query = "DELETE FROM " .. t .. " WHERE bar = $1"
  local params = {2}
  local status, result = pcall(nk.sql_exec, query, params)
  if not status then
    print(result)
  end
  assert(result == 1)

  local status, result = pcall(nk.sql_exec, query, params)
  if not status then
    print(result)
  end
  assert(result == 0)

  local query = "SELECT * FROM " .. t .. " WHERE bar >= $1 ORDER BY bar DESC"
  local params = {2}
  local status, result = pcall(nk.sql_query, query, params)
  if not status then
    print(result)
  end
  assert(#result == 1)
  assert(result[1].foo == "foo3")
  assert(result[1].bar == 3)

  local query = "DROP TABLE " .. t
  local params = {}
  local status, result = pcall(nk.sql_exec, query, params)
  if not status then
    print(result)
  end
  assert(result == 0)

  local query = "SELECT * FROM " .. t
  local params = {}
  local status, result = pcall(nk.sql_query, query, params)
  if not status then
    print(result)
  end
  assert(not status)
  assert(string.ends(result, 'sql query error: pq: relation "' .. t .. '" does not exist'))
end
