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

local function print_r(arr, indentLevel)
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

return {
  print_r = print_r
}
