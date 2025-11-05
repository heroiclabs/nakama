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
  env = {}, -- key-value data set in the runtime.env server configuration.
  execution_mode = "Match",
  match_id = "client-friendly match ID, can be shared with clients and used in match join operations",
  match_node = "name of the Nakama node hosting this match"
}

Params is the optional arbitrary second argument passed to `nk.match_create()`, or `nil` if none was used.

Expected return these values (all required) in order:
1. The initial in-memory state of the match. May be any non-nil Lua term, or nil to end the match.
2. Tick rate representing the desired number of match loop calls per second. Must be between 1 and 30, inclusive.
3. A string label that can be used to filter matches in listing operations. Must be between 0 and 256 characters long.
--]]
local function match_init(context, params)
  local state = {
    debug = (params and params.debug) or false,
    foo = function()
      return "bar"
    end
  }
  if state.debug then
    print("match init context:\n" .. du.print_r(context) .. "match init params:\n" .. du.print_r(params))
  end
  local tick_rate = 1
  local label = (params and params.label) or "skill=100-150"

  return state, tick_rate, label
end

--[[
Called when a user attempts to join the match using the client's match join operation.

Context represents information about the match and server, for information purposes. Format:
{
  env = {}, -- key-value data set in the runtime.env server configuration.
  execution_mode = "Match",
  match_id = "client-friendly match ID, can be shared with clients and used in match join operations",
  match_node = "name of the Nakama node hosting this match",
  match_label = "the label string returned from match_init",
  match_tick_rate = 1 -- the tick rate returned by match_init
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
  match_label_update = function(label)
    -- a new label to set for the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt, match_join, match_leave, match_terminate, or match_signal.

State is the current in-memory match state, may be any Lua term except nil.

Presence is the user attempting to join the match. Format:
{
  user_id: "user unique ID",
  session_id: "session ID of the user's current connection",
  username: "user's unique username",
  node: "name of the Nakama node the user is connected to"
}

Metadata is an optional set of arbitrary key-value pairs received from the client. These may contain information
the client wishes to supply to the match handler in order to process the join attempt, for example: authentication or
match passwords, client version information, preferences etc. Format:
{
  key: "value"
}

Expected return these values (all required) in order:
1. An (optionally) updated state. May be any non-nil Lua term, or nil to end the match.
2. Boolean true if the join attempt should be allowed, false otherwise.
--]]
local function match_join_attempt(context, dispatcher, tick, state, presence, metadata)
  if state.debug then
    print("match join attempt:\n" .. du.print_r(presence))
    print("match join attempt metadata:\n" .. du.print_r(metadata))
  end
  return state, true
end

--[[
Called when one or more users have successfully completed the match join process after their match_join_attempt returns
`true`. When their presences are sent to this function the users are ready to receive match data messages and can be
targets for the dispatcher's `broadcast_message` function.

Context represents information about the match and server, for information purposes. Format:
{
  env = {}, -- key-value data set in the runtime.env server configuration.
  execution_mode = "Match",
  match_id = "client-friendly match ID, can be shared with clients and used in match join operations",
  match_node = "name of the Nakama node hosting this match",
  match_label = "the label string returned from match_init",
  match_tick_rate = 1 -- the tick rate returned by match_init
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
  match_label_update = function(label)
    -- a new label to set for the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt, match_join, match_leave, match_terminate, or match_signal.

State is the current in-memory match state, may be any Lua term except nil.

Presences is a list of users that have joined the match. Format:
{
  {
    user_id: "user unique ID",
    session_id: "session ID of the user's current connection",
    username: "user's unique username",
    node: "name of the Nakama node the user is connected to"
  },
  ...
}

Expected return these values (all required) in order:
1. An (optionally) updated state. May be any non-nil Lua term, or nil to end the match.
--]]
local function match_join(context, dispatcher, tick, state, presences)
  if state.debug then
    print("match join:\n" .. du.print_r(presences))
  end
  return state
end

--[[
Called when one or more users have left the match for any reason, including connection loss.

Context represents information about the match and server, for information purposes. Format:
{
  env = {}, -- key-value data set in the runtime.env server configuration.
  execution_mode = "Match",
  match_id = "client-friendly match ID, can be shared with clients and used in match join operations",
  match_node = "name of the Nakama node hosting this match",
  match_label = "the label string returned from match_init",
  match_tick_rate = 1 -- the tick rate returned by match_init
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
  match_label_update = function(label)
    -- a new label to set for the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt, match_join, match_leave, match_terminate, or match_signal.

State is the current in-memory match state, may be any Lua term except nil.

Presences is a list of users that have left the match. Format:
{
  {
    user_id: "user unique ID",
    session_id: "session ID of the user's current connection",
    username: "user's unique username",
    node: "name of the Nakama node the user is connected to"
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
  env = {}, -- key-value data set in the runtime.env server configuration.
  executionMode = "Match",
  match_id = "client-friendly match ID, can be shared with clients and used in match join operations",
  match_node = "name of the Nakama node hosting this match",
  match_label = "the label string returned from match_init",
  match_tick_rate = 1 -- the tick rate returned by match_init
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
  match_label_update = function(label)
    -- a new label to set for the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt, match_join, match_leave, match_terminate, or match_signal.

State is the current in-memory match state, may be any Lua term except nil.

Messages is a list of data messages received from users between the previous and current ticks. Format:
{
  {
    sender = {
      user_id: "user unique ID",
      session_id: "session ID of the user's current connection",
      username: "user's unique username",
      node: "name of the Nakama node the user is connected to"
    },
    op_code = 1, -- numeric op code set by the sender.
    data = "any string data set by the sender" -- may be nil.
  },
  ...
}

Expected return these values (all required) in order:
1. An (optionally) updated state. May be any non-nil Lua term, or nil to end the match.
--]]
local function match_loop(context, dispatcher, tick, state, messages)
  if state.debug then
    print("match " .. context.match_id .. " tick " .. tick)
    print("match " .. context.match_id .. " messages:\n" .. du.print_r(messages))
  end
  if tick < 10 then
    return state
  end
end

--[[
Called when the server begins a graceful shutdown process. Will not be called if graceful shutdown is disabled.

Context represents information about the match and server, for information purposes. Format:
{
  env = {}, -- key-value data set in the runtime.env server configuration.
  executionMode = "Match",
  match_id = "client-friendly match ID, can be shared with clients and used in match join operations",
  match_node = "name of the Nakama node hosting this match",
  match_label = "the label string returned from match_init",
  match_tick_rate = 1 -- the tick rate returned by match_init
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
  match_label_update = function(label)
    -- a new label to set for the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt, match_join, match_leave, match_terminate, or match_signal.

State is the current in-memory match state, may be any Lua term except nil.

Grace Seconds is the number of seconds remaining until the server will shut down.

Expected return these values (all required) in order:
1. An (optionally) updated state. May be any non-nil Lua term, or nil to end the match.
--]]
local function match_terminate(context, dispatcher, tick, state, grace_seconds)
  if state.debug then
    print("match " .. context.match_id .. " tick " .. tick)
    print("match " .. context.match_id .. " grace_seconds " .. grace_seconds)
  end
  return state
end

--[[
Called when the match handler receives a runtime signal.

Context represents information about the match and server, for information purposes. Format:
{
  env = {}, -- key-value data set in the runtime.env server configuration.
  executionMode = "Match",
  match_id = "client-friendly match ID, can be shared with clients and used in match join operations",
  match_node = "name of the Nakama node hosting this match",
  match_label = "the label string returned from match_init",
  match_tick_rate = 1 -- the tick rate returned by match_init
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
  match_label_update = function(label)
    -- a new label to set for the match
}

Tick is the current match tick number, starts at 0 and increments after every match_loop call. Does not increment with
calls to match_join_attempt, match_join, match_leave, match_terminate, or match_signal.

State is the current in-memory match state, may be any Lua term except nil.

Data is arbitrary input supplied by the runtime caller of the signal.

Expected return these values (all required) in order:
1. An (optionally) updated state. May be any non-nil Lua term, or nil to end the match.
1. Arbitrary data to return to the runtime caller of the signal. May be a string, or nil.
--]]
local function match_signal(context, dispatcher, tick, state, data)
  if state.debug then
    print("match " .. context.match_id .. " tick " .. tick)
    print("match " .. context.match_id .. " data " .. data)
  end
  return state, "signal received: " .. data
end

-- Match modules must return a table with these functions defined. All functions are required.
return {
  match_init = match_init,
  match_join_attempt = match_join_attempt,
  match_join = match_join,
  match_leave = match_leave,
  match_loop = match_loop,
  match_terminate = match_terminate,
  match_signal = match_signal
}
