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

local function create_same_tournament_multiple_times(_context, payload)
  local args = nk.json_decode(payload)
  local id = nk.uuid_v4()
  nk.tournament_create(id, args.sort_order, args.operator, args.category, args.description, args.duration, args.end_time, args.join_required, args.max_size, args.max_num_score, args.start_time, args.title)

  -- should not through a new error
  nk.tournament_create(id, args.sort_order, args.operator, args.category, args.description, args.duration, args.end_time, args.join_required, args.max_size, args.max_num_score, args.start_time, args.title)

  local response = {
    tournament_id = id
  }
  return nk.json_encode(response)
end
nk.register_rpc(create_same_tournament_multiple_times, "clientrpc.create_same_tournament_multiple_times")

local function create_tournament(_context, payload)
  local args = nk.json_decode(payload)

  local id = nk.uuid_v4()

  -- TODO: use args.end_time and args.start_time

  local params = {id, args.sort_order, args.operator, args.category, args.description, args.duration, args.join_required, args.max_size, args.max_num_score, args.title}
  local query = [[
INSERT INTO leaderboard
  (id, authoritative, sort_order, operator, category, description, duration, join_required, max_size, max_num_score, title)
VALUES
  ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ]]

  if args.end_time > 0 then
    params[#params+1] = args.end_time
    query = [[
INSERT INTO leaderboard
  (id, authoritative, sort_order, operator, category, description, duration, join_required, max_size, max_num_score, title, end_time)
VALUES
  ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, CAST($11::BIGINT AS TIMESTAMPTZ))
  ]]
  end

  nk.sql_exec(query, params)
  local response = {
    tournament_id = id
  }
  return nk.json_encode(response)
end
nk.register_rpc(create_tournament, "clientrpc.create_tournament")

local function delete_tournament(_context, payload)
  local args = nk.json_decode(payload)

  local params = {args.tournament_id}
  local query = [[ DELETE FROM leaderboard WHERE id = $1 ]]

  nk.sql_exec(query, params)
end
nk.register_rpc(delete_tournament, "clientrpc.delete_tournament")
