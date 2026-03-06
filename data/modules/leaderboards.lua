-- data/modules/leaderboards.lua
-- Simple Nakama runtime module: create a single global leaderboard and expose RPCs to submit/get records.

local nk = require("nakama")

local GLOBAL_LEADERBOARD_ID = "global_top_scores"

-- Ensure leaderboard exists on server start (no reset schedule - all-time)
nk.run_once(function(ctx)
  -- id, authoritative, sort, operator, resetCron, metadata
  -- authoritative=false (clients may write if allowed); use true if you want server-only writes
  nk.leaderboard_create(GLOBAL_LEADERBOARD_ID, false, "desc", "best", "", { display_name = "Global - All Time" })
  nk.logger_info("Verified/created leaderboard: " .. GLOBAL_LEADERBOARD_ID)
end)

-- RPC: submit a score (server-authoritative endpoint recommended)
-- Payload example: { "leaderboard_id":"global_top_scores", "score":1234, "subscore":0, "metadata":{...} }
local function rpc_submit_score(context, payload)
  local ok, data = pcall(function() return nk.json_decode(payload or "{}") end)
  if not ok or type(data) ~= "table" then
    error({ "invalid payload", 3 })
  end

  local leaderboard_id = data.leaderboard_id or GLOBAL_LEADERBOARD_ID
  local score = tonumber(data.score) or 0
  local subscore = tonumber(data.subscore) or 0
  local metadata = data.metadata or {}

  local user_id = context.user_id
  if not user_id then error({ "unauthenticated", 16 }) end

  -- Attempt to get username (optional)
  local account = nk.account_get_id(user_id)
  local username = ""
  if account and account.username then username = account.username end

  -- Write leaderboard record: nk.leaderboard_record_write(id, owner_id, username, score, subscore, metadata)
  local record = nk.leaderboard_record_write(leaderboard_id, user_id, username, score, subscore, metadata, nil)

  return nk.json_encode({ success = true, record = record })
end
nk.register_rpc(rpc_submit_score, "lb.submit_score")

-- RPC: get leaderboard records (paged)
-- Payload example: { "leaderboard_id":"global_top_scores", "limit":10, "cursor":"", "owner_ids": null, "expiry":0 }
local function rpc_get_leaderboard(context, payload)
  local ok, data = pcall(function() return nk.json_decode(payload or "{}") end)
  if not ok or type(data) ~= "table" then
    error({ "invalid payload", 3 })
  end

  local leaderboard_id = data.leaderboard_id or GLOBAL_LEADERBOARD_ID
  local limit = tonumber(data.limit) or 10
  local cursor = data.cursor or ""
  local owner_ids = data.owner_ids or nil
  local expiry = tonumber(data.expiry) or 0

  local records, owner_records, prev_cursor, next_cursor = nk.leaderboard_records_list(leaderboard_id, owner_ids, limit, cursor, expiry)

  return nk.json_encode({
    leaderboard_id = leaderboard_id,
    records = records,
    owner_records = owner_records,
    prev_cursor = prev_cursor,
    next_cursor = next_cursor
  })
end
nk.register_rpc(rpc_get_leaderboard, "lb.get")

nk.logger_info("leaderboards.lua module loaded (global-only).")

