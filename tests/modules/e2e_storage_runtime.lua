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
local user = "4c2ae592-b2a7-445e-98ec-697694478b1c"

function test_storage(user_id)
  -- bad storage_write
  do
    local new_Records = {
      {Bucket = 1, Collection = "settings", Record = "a", UserId = user_id, Value = {}, PermissionRead = 0, PermissionWrite = 0}
    }
    local status, res = pcall(nk.storage_write, new_Records)
    assert(status == false)
    -- before this in the error message is the file path, name, and line number.
    local expected_message = ": bad argument #1 to (anonymous) (bucket must be a string)"
    assert(string.sub(res,-string.len(expected_message)) == expected_message)
  end

  -- storage_write
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settings", Record = "a", UserId = user_id, Value = {}, PermissionRead = 0, PermissionWrite = 0},
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id, Value = {}, PermissionRead = 1, PermissionWrite = 1},
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = user_id, Value = {}, PermissionRead = 2, PermissionWrite = 1},
    }
    local status, res = pcall(nk.storage_write, new_Records)
    if not status then
      print(res)
    end
    assert(status == true)
  end

  -- storage_fetch
  local storage_version_a = ""; --unused
  local storage_version_b = "";
  local storage_version_c = "";
  do
    local Record_keys = {
      {Bucket = "mygame", Collection = "settings", Record = "a", UserId = user_id},
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id},
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = user_id}
    }
    local Records = nk.storage_fetch(Record_keys)
    for i, r in ipairs(Records)
    do
      if r.Record == "a" then
        storage_version_a = r.Version
      elseif r.Record == "b" then
        storage_version_b = r.Version
      elseif r.Record == "c" then
        storage_version_c = r.Version
      end
      assert(#r.Value == 0, "'r.Value' must be '{}'")
    end
  end

  -- storage_write_overwrite
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settings", Record = "a", UserId = user_id, Value = {["hello"]="world"}, PermissionRead = 0, PermissionWrite = 0},
    }
    local status, res = pcall(nk.storage_write, new_Records)
    if not status then
      print(res)
    end
    assert(status == true)
  end

  -- storage_fetch
  do
    local Record_keys = {
      {Bucket = "mygame", Collection = "settings", Record = "a", UserId = user_id},
    }
    local Records = nk.storage_fetch(Record_keys)
    for i, r in ipairs(Records)
    do
      assert(r.Value.hello == 'world', '"r.Value" must be {"hello":"world"}')
    end
  end

  -- storage_write_overwrite_fail
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id, Value = {["hello"]="world"}, Version="*", PermissionRead = 1, PermissionWrite = 1},
    }
    local status, res = pcall(nk.storage_write, new_Records)
    assert(status == false)
  end

  -- storage_fetch
  do
    local Record_keys = {
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id},
    }
    local Records = nk.storage_fetch(Record_keys)
    for i, r in ipairs(Records)
    do
      assert(#r.Value == 0, "'r.Value' must be '{}'")
    end
  end

  -- storage_write_overwrite_version_match
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = user_id, Value = {["hello"]="world"}, Version=storage_version_c, PermissionRead = 2, PermissionWrite = 1},
    }
    local status, res = pcall(nk.storage_write, new_Records)
    if not status then
      print(res)
    end
    assert(status)
  end

  -- storage_write_overwrite_mix_transaction_fail
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id, Value = {["hello"]="world"}, Version=storage_version_b, PermissionRead = 1, PermissionWrite = 1},
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = user_id, Value = {["hello"]="world"}, Version="*", PermissionRead = 2, PermissionWrite = 1},
    }
    local status, res = pcall(nk.storage_write, new_Records)
    if status then
      print(res)
    end
    assert(status == false)
  end

  -- storage_remove
  do
    local Record_keys = {
      {Bucket = "mygame", Collection = "settings", Record = "a", UserId = user_id},
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id},
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = user_id}
    }
    local status, res = pcall(nk.storage_remove, Record_keys)
    if not status then
      print(res)
    end
    assert(status)
  end

  -- storage_write_recreate
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settings", Record = "a", UserId = user_id, Value = {}, PermissionRead = 0, PermissionWrite = 0},
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id, Value = {}, PermissionRead = 1, PermissionWrite = 1},
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = user_id, Value = {}, PermissionRead = 2, PermissionWrite = 1},
    }
    local status, res = pcall(nk.storage_write, new_Records)
    if not status then
      print(res)
    end
    assert(status == true)
  end

  -- storage_fetch_recreated
  do
    local Record_keys = {
      {Bucket = "mygame", Collection = "settings", Record = "a", UserId = user_id},
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id},
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = user_id}
    }
    local Records = nk.storage_fetch(Record_keys)
    for i, r in ipairs(Records)
    do
      assert(#r.Value == 0, "'r.Value' must be '{}'")
    end
  end

  -- storage_write_invalid_user
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settings", Record = "a", UserId = nk.uuid_v4(), Value = {}, PermissionRead = 0, PermissionWrite = 0},
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = nk.uuid_v4(), Value = {}, PermissionRead = 1, PermissionWrite = 1},
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = nk.uuid_v4(), Value = {}, PermissionRead = 2, PermissionWrite = 1},
    }
    local status, res = pcall(nk.storage_write, new_Records)
    assert(status) -- we don't currently check whether user exists or not yet.
  end

  -- storage_fetch_invalid_record
  do
    local Record_keys = {
      {Bucket = "mygame", Collection = "settings", Record = "non_exist_1", UserId = user_id},
      {Bucket = "mygame", Collection = "settings", Record = "b", UserId = user_id},
      {Bucket = "mygame", Collection = "settings", Record = "c", UserId = user_id}
    }
    local status, res = pcall(nk.storage_fetch, Record_keys)
    assert(#res == 2)
    assert(status)
  end

  -- storage_list
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settingslist", Record = "b", UserId = user_id, Value = {}, PermissionRead = 1, PermissionWrite = 0},
      {Bucket = "mygame", Collection = "settingslist", Record = "a", UserId = user_id, Value = {}, PermissionRead = 1, PermissionWrite = 1},
      {Bucket = "mygame", Collection = "settingslist", Record = "c", UserId = user_id, Value = {}, PermissionRead = 0, PermissionWrite = 1},
    }
    local status, res = pcall(nk.storage_write, new_Records)
    if not status then
      print(res)
    end
    assert(status == true)

    local status, values, cursor = pcall(nk.storage_list, user_id, "mygame", "settingslist", 10, nil)
    if not status then
      print(values)
    end
    assert(status == true)
    assert(#values == 3)
    -- assert(values[1].Record == "c")
    -- assert(values[2].Record == "a")
    -- assert(values[3].Record == "b")
  end

  -- storage_update
  do
    local new_Records = {
      {Bucket = "mygame", Collection = "settingsupdate", Record = "a", UserId = user_id, Update = {
          {Op = "init", Path = "/foo", Value = {bar = 1}},
          {Op = "incr", Path = "/foo/bar", Value = 3}
        }
      }
    }

    local status, res = pcall(nk.storage_update, new_Records)
    if not status then
      print(res)
    end
    assert(status == true)

    local status, values, cursor = pcall(nk.storage_list, user_id, "mygame", "settingsupdate", 10, nil)
    if not status then
      print(values)
    end
    assert(status == true)
    assert(#values == 1)
    print(nk.json_encode(values))
    assert(values[1].Value.foo.bar == 4)

    local updated_Records = {
      {Bucket = "mygame", Collection = "settingsupdate", Record = "a", UserId = user_id, Update = {
          {Op = "incr", Path = "/foo/bar", Value = 5}
        }
      }
    }

    local status, res = pcall(nk.storage_update, updated_Records)
    if not status then
      print(res)
    end
    assert(status == true)

    local status, values, cursor = pcall(nk.storage_list, user_id, "mygame", "settingsupdate", 10, nil)
    if not status then
      print(values)
    end
    assert(status == true)
    assert(values[1].Value.foo.bar == 9)
  end
end

test_storage(nil)
test_storage(user)
