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

local du = require("debug_utils")

--[[
Called when a match is created as a result of nk.match_create().

Context represents information about the match and server, for information purposes. Format:
{
  Env = {}, -- key-value data set in the runtime.env server configuration.
  ExecutionMode = "Match",
  MatchId = "client-friendly match ID, can be shared with clients and used in match join operations",
  MatchNode = "name of the Nakama node hosting this match"
}

Params is the optional arbitrary second argument passed to `nk.match_create()`, or `nil` if none was used.

Expected return these values (all required) in order:
1. The initial in-memory state of the match. May be any non-nil Lua term, or nil to end the match.
2. Tick rate representing the desired number of match loop calls per second. Must be between 1 and 30, inclusive.
3. A string label that can be used to filter matches in listing operations. Must be between 0 and 256 characters long.
--]]
local function match_init(context, params)
  local state = {
    debug = (params and params.debug) or false
  }
  if state.debug then
    print("match init context:\n" .. du.print_r(context) .. "match init params:\n" .. du.print_r(params))
  end
  local tick_rate = 1
  local label = "skill=100-150"

  return state, tick_rate, label
end

--[[
Called when a user attempts to join the match using the client's match join operation.

Context represents information about the match and server, for information purposes. Format:
{
  Env = {}, -- key-value data set in the runtime.env server configuration.
  ExecutionMode = "Match",
  MatchId = "client-friendly match ID, can be shared with clients and used in match join operations",
  MatchNode = "name of the Nakama node hosting this match",
  MatchLabel = "the label string returned from match_init",
  MatchTickrate = 1 -- the tick rate returned by match_init
}

Dispatcher exposes useful functions to the match. Format:
{
  broadcast_message = function(op_code, data, presences, sender),
    -- numeric message op code
    -- a data payload string, or nil
    -- list of presences (a subset of match participants) to use as message targets, or nil to send to the whole match
    -- a presence to tag on the message as the 'sender', or nil
  match_kick = function(presences)
    -- a list of presences to remove from the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt or match_leave.

State is the current in-memory match state, may be any Lua term except nil.

Presence is the user attempting to join the match. Format:
{
  UserId: "user unique ID",
  SessionId: "session ID of the user's current connection",
  Username: "user's unique username",
  Node: "name of the Nakama node the user is connected to"
}

Expected return these values (all required) in order:
1. An (optionally) updated state. May be any non-nil Lua term, or nil to end the match.
2. Boolean true if the join attempt should be allowed, false otherwise.
--]]
local function match_join_attempt(context, dispatcher, tick, state, presence)
  if state.debug then
    print("match join attempt:\n" .. du.print_r(presence))
  end
  return state, true
end

--[[
Called when one or more users have left the match for any reason, including connection loss.

Context represents information about the match and server, for information purposes. Format:
{
  Env = {}, -- key-value data set in the runtime.env server configuration.
  ExecutionMode = "Match",
  MatchId = "client-friendly match ID, can be shared with clients and used in match join operations",
  MatchNode = "name of the Nakama node hosting this match",
  MatchLabel = "the label string returned from match_init",
  MatchTickrate = 1 -- the tick rate returned by match_init
}

Dispatcher exposes useful functions to the match. Format:
{
  broadcast_message = function(op_code, data, presences, sender),
    -- numeric message op code
    -- a data payload string, or nil
    -- list of presences (a subset of match participants) to use as message targets, or nil to send to the whole match
    -- a presence to tag on the message as the 'sender', or nil
  match_kick = function(presences)
    -- a list of presences to remove from the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt or match_leave.

State is the current in-memory match state, may be any Lua term except nil.

Presences is a list of users that have left the match. Format:
{
  {
    UserId: "user unique ID",
    SessionId: "session ID of the user's current connection",
    Username: "user's unique username",
    Node: "name of the Nakama node the user is connected to"
  },
  ...
}

Expected return these values (all required) in order:
1. An (optionally) updated state. May be any non-nil Lua term, or nil to end the match.
--]]
local function match_leave(context, dispatcher, tick, state, presences)
  if state.debug then
    print("match leave:\n" .. du.print_r(presences))
  end
  return state
end

--[[
Called on an interval based on the tick rate returned by match_init.

Context represents information about the match and server, for information purposes. Format:
{
  Env = {}, -- key-value data set in the runtime.env server configuration.
  ExecutionMode = "Match",
  MatchId = "client-friendly match ID, can be shared with clients and used in match join operations",
  MatchNode = "name of the Nakama node hosting this match",
  MatchLabel = "the label string returned from match_init",
  MatchTickrate = 1 -- the tick rate returned by match_init
}

Dispatcher exposes useful functions to the match. Format:
{
  broadcast_message = function(op_code, data, presences, sender),
    -- numeric message op code
    -- a data payload string, or nil
    -- list of presences (a subset of match participants) to use as message targets, or nil to send to the whole match
    -- a presence to tag on the message as the 'sender', or nil
  match_kick = function(presences)
    -- a list of presences to remove from the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt or match_leave.

State is the current in-memory match state, may be any Lua term except nil.

Messages is a list of data messages received from users between the previous and current ticks. Format:
{
  {
    Sender = {
      UserId: "user unique ID",
      SessionId: "session ID of the user's current connection",
      Username: "user's unique username",
      Node: "name of the Nakama node the user is connected to"
    },
    OpCode = 1, -- numeric op code set by the sender.
    Data = "any string data set by the sender" -- may be nil.
  },
  ...
}

Expected return these values (all required) in order:
1. An (optionally) updated state. May be any non-nil Lua term, or nil to end the match.
--]]
local function match_loop(context, dispatcher, tick, state, messages)
  if state.debug then
    print("match " .. context.MatchId .. " tick " .. tick)
  end
  if tick < 180 then
    return state
  end
end

-- Match modules must return a table with these functions defined. All functions are required.
return {
  match_init = match_init,
  match_join_attempt = match_join_attempt,
  match_leave = match_leave,
  match_loop = match_loop
}
