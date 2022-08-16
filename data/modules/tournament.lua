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
  Test Tournament function calls from client libraries.
--]]

local function tournament_end_callback(_context, tournament, sessionEnd, expiry)
  local records, owner_records, nc, pc = nk.leaderboard_records_list(tournament.id, nil, 1, "", expiry)
  if #records >= 1 then
    local user_id = records[1].owner_id
    local metadata = { won = tournament.id }
    nk.account_update_id(user_id, metadata)
  end
end
nk.register_tournament_end(tournament_end_callback)

local function tournament_reset_callback(_context, tournament, sessionEnd, expiry)
  local records, owner_records, nc, pc = nk.leaderboard_records_list(tournament.id)
  if #records >= 1 then
    local user_id = records[1].owner_id
    local metadata = { expiry_tournament = tournament.id }
    nk.account_update_id(user_id, metadata)
  end
end
nk.register_tournament_reset(tournament_reset_callback)

local function leaderboard_reset_callback(_context, leaderboard, expiry)
  local records, owner_records, nc, pc = nk.leaderboard_records_list(leaderboard.id)
  if #records >= 1 then
    local user_id = records[1].owner_id
    local metadata = { expiry_leaderboard = leaderboard.id }
    nk.account_update_id(user_id, metadata)
  end
end
nk.register_leaderboard_reset(leaderboard_reset_callback)

local function create_same_tournament_multiple_times(_context, payload)
  local args = nk.json_decode(payload)
  local id = nk.uuid_v4()
  nk.tournament_create(id, args.authoritative, args.sort_order, args.operator, args.duration, args.reset_schedule, nil,
    args.title, args.description, args.category, args.start_time, args.end_time, args.max_size, args.max_num_score, args.join_required)

  -- should not throw a new error
  nk.tournament_create(id, args.authoritative, args.sort_order, args.operator, args.duration, args.reset_schedule, nil,
    args.title, args.description, args.category, args.start_time, args.end_time, args.max_size, args.max_num_score, args.join_required)

  local response = {
    tournament_id = id
  }
  return nk.json_encode(response)
end
nk.register_rpc(create_same_tournament_multiple_times, "clientrpc.create_same_tournament_multiple_times")

local function create_tournament(_context, payload)
  local args = nk.json_decode(payload)

  local id = nk.uuid_v4()

  nk.tournament_create(id, args.authoritative, args.sort_order, args.operator, args.duration, args.reset_schedule, nil,
    args.title, args.description, args.category, args.start_time, args.end_time, args.max_size, args.max_num_score, args.join_required)

  local response = {
    tournament_id = id
  }
  return nk.json_encode(response)
end
nk.register_rpc(create_tournament, "clientrpc.create_tournament")

local function delete_tournament(_context, payload)
  local args = nk.json_decode(payload)

  nk.tournament_delete(args.tournament_id)
end
nk.register_rpc(delete_tournament, "clientrpc.delete_tournament")

local function addattempt_tournament(_context, payload)
  local args = nk.json_decode(payload)

  nk.tournament_add_attempt(args.tournament_id, args.owner_id, args.count)
end
nk.register_rpc(addattempt_tournament, "clientrpc.addattempt_tournament")
