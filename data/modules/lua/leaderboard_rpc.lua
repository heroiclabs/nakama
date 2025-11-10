--[[
 Copyright 2025 The Nakama Authors

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
  Create all leaderboards persistent RPC function.
  This function creates global and per-game leaderboards with idempotent storage tracking.
--]]
local function create_all_leaderboards_persistent(context, payload)
  local token_url = "https://api.intelli-verse-x.ai/api/admin/oauth/token"
  local games_url = "https://gaming.intelli-verse-x.ai/api/games/games/all"

  local client_id = "54clc0uaqvr1944qvkas63o0rb"
  local client_secret = "1eb7ooua6ft832nh8dpmi37mos4juqq27svaqvmkt5grc3b7e377"

  local sort = "desc"
  local operator = "best"
  local reset_schedule = "0 0 * * 0" -- Weekly reset
  local collection = "leaderboards_registry"

  -- Fetch existing records to skip duplicates
  local existing_records = {}
  local success, records = pcall(nk.storage_read, {{
    collection = collection,
    key = "all_created",
    user_id = context.user_id or "system"
  }})

  if success and records and #records > 0 and records[1].value then
    existing_records = records[1].value
  else
    if not success then
      nk.logger_warn(string.format("Failed to read existing leaderboard records: %s", tostring(records)))
    end
  end

  -- Build set of existing IDs
  local existing_ids = {}
  for _, record in ipairs(existing_records) do
    existing_ids[record.leaderboardId] = true
  end

  local created = {}
  local skipped = {}

  -- Step 1: Request token
  nk.logger_info("Requesting IntelliVerse OAuth token...")
  local token_response
  success, token_response = pcall(nk.http_request, token_url, "post", {
    ["accept"] = "application/json",
    ["Content-Type"] = "application/json"
  }, nk.json_encode({
    client_id = client_id,
    client_secret = client_secret
  }))

  if not success then
    local error_msg = tostring(token_response)
    return nk.json_encode({
      success = false,
      error = string.format("Token request failed: %s", error_msg)
    })
  end

  if token_response.code ~= 200 then
    return nk.json_encode({
      success = false,
      error = string.format("Token request failed with code %d", token_response.code)
    })
  end

  local token_data
  success, token_data = pcall(nk.json_decode, token_response.body)
  if not success then
    return nk.json_encode({
      success = false,
      error = "Invalid token response JSON."
    })
  end

  local access_token = token_data.access_token
  if not access_token then
    return nk.json_encode({
      success = false,
      error = "No access_token in response."
    })
  end

  -- Step 2: Fetch game list
  nk.logger_info("Fetching onboarded game list...")
  local game_response
  success, game_response = pcall(nk.http_request, games_url, "get", {
    ["accept"] = "application/json",
    ["Authorization"] = string.format("Bearer %s", access_token)
  })

  if not success then
    local error_msg = tostring(game_response)
    return nk.json_encode({
      success = false,
      error = string.format("Game fetch failed: %s", error_msg)
    })
  end

  if game_response.code ~= 200 then
    return nk.json_encode({
      success = false,
      error = string.format("Game API responded with %d", game_response.code)
    })
  end

  local games
  success, games = pcall(function()
    local parsed = nk.json_decode(game_response.body)
    return parsed.data or {}
  end)

  if not success then
    return nk.json_encode({
      success = false,
      error = "Invalid games JSON format."
    })
  end

  -- Step 3: Create global leaderboard if missing
  local global_id = "leaderboard_global"
  if not existing_ids[global_id] then
    local create_success, _ = pcall(nk.leaderboard_create, global_id, true, sort, operator, reset_schedule, {
      scope = "global",
      desc = "Global Ecosystem Leaderboard"
    })
    if create_success then
      table.insert(created, global_id)
      table.insert(existing_records, {
        leaderboardId = global_id,
        scope = "global",
        createdAt = os.date("!%Y-%m-%dT%H:%M:%SZ")
      })
    else
      table.insert(skipped, global_id)
    end
  else
    table.insert(skipped, global_id)
  end

  -- Step 4: Create per-game leaderboards
  nk.logger_info(string.format("Processing %d games for leaderboard creation...", #games))
  for _, game in ipairs(games) do
    if game.id then
      local leaderboard_id = string.format("leaderboard_%s", game.id)
      if not existing_ids[leaderboard_id] then
        local create_success, _ = pcall(nk.leaderboard_create, leaderboard_id, true, sort, operator, reset_schedule, {
          desc = string.format("Leaderboard for %s", game.gameTitle or "Untitled Game"),
          gameId = game.id,
          scope = "game"
        })
        if create_success then
          table.insert(created, leaderboard_id)
          table.insert(existing_records, {
            leaderboardId = leaderboard_id,
            gameId = game.id,
            scope = "game",
            createdAt = os.date("!%Y-%m-%dT%H:%M:%SZ")
          })
        else
          table.insert(skipped, leaderboard_id)
        end
      else
        table.insert(skipped, leaderboard_id)
      end
    end
  end

  -- Step 5: Persist record of created leaderboards
  success, _ = pcall(nk.storage_write, {{
    collection = collection,
    key = "all_created",
    user_id = context.user_id or "system",
    value = existing_records,
    permission_read = 1,
    permission_write = 0
  }})

  if not success then
    nk.logger_error(string.format("Failed to write leaderboard records: %s", tostring(_)))
  end

  return nk.json_encode({
    success = true,
    created = created,
    skipped = skipped,
    totalProcessed = #games,
    storedRecords = #existing_records
  })
end

nk.register_rpc(create_all_leaderboards_persistent, "create_all_leaderboards_persistent")
