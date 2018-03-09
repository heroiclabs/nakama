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

function print_r(arr, indentLevel)
  if type(arr) ~= "table" then
    return tostring(arr)
  end

  local str = ""
  local indentStr = "#"

  if(indentLevel == nil) then
    return print_r(arr, 0)
  end

  for i = 0, indentLevel do
    indentStr = indentStr.."\t"
  end

  for index,Value in pairs(arr) do
    if type(Value) == "table" then
      str = str..indentStr..index..": \n"..print_r(Value, (indentLevel + 1))
    else
      str = str..indentStr..index..": "..tostring(Value).."\n"
    end
  end
  return str
end

local M = {}

M.match_init = function(context, params)
  print("match init context:\n" .. print_r(context))
  print("match init params:\n" .. print_r(params))
  local state = {}
  local tick_rate = 1
  local label = "skill=100-150"

  return state, tick_rate, label
end

M.match_join_attempt = function(context, dispatcher, tick, state, presence)
  return state, true
end

M.match_leave = function(context, dispatcher, tick, state, presences)
  return state
end

M.match_loop = function(context, dispatcher, tick, state, messages)
  print("match " .. context.MatchId .. " tick " .. tick)
  if tick < 10 then
    return state
  end
end

return M
